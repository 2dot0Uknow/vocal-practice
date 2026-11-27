// Web Audio: the audio context, the synthesised piano, the microphone chain and trill mode.
// This module owns all audio state; nothing else touches AudioContext objects directly.

import { midiToHz } from './music.js';
import { classifyMicError } from './session.js';

let context = null;       // AudioContext (created on first use, closed when a session ends)
let masterGain = null;    // piano volume
let analyser = null;      // microphone analyser
let timeBuffer = null;    // latest microphone samples (analyser.fftSize long)
let spectrumBuffer = null;
let micStream = null;
let trillLowpass = null;  // microphone filter that is narrowed in trill mode
let trillGain = null;     // microphone boost in trill mode
let decimated = null;     // half-rate copy of the samples for trill mode
let trillMode = null;     // null = not set yet this session, then true / false
let pianoVolume = 0.6;

const ANALYSER_SIZE = 4096;
const TRILL_WINDOW = 2048;

export const getAudioContext = () => context;

/** Create the audio context on first use (and wake it if the browser suspended it). */
export function ensureAudio() {
  if (!context) {
    context = new (window.AudioContext || window.webkitAudioContext)();
    // A gentle low-pass takes the harsh edge off the synthetic piano.
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 5000;
    masterGain = context.createGain();
    masterGain.gain.value = pianoVolume;
    masterGain.connect(lowpass).connect(context.destination);
  }
  if (context.state == 'suspended') context.resume();
}

export function setPianoVolume(volume) {
  pianoVolume = volume;
  if (masterGain) masterGain.gain.value = volume;
}

/** A gain node feeding the piano, so a preview can be faded out on its own. */
export function createPreviewBus() {
  const bus = context.createGain();
  bus.connect(masterGain);
  return bus;
}

/**
 * Play one piano note: six slightly stretched harmonics under a quick-attack, slow-decay envelope.
 * Pass `oscillators` (an array) to collect the oscillators so they can be stopped early.
 * Returns a handle for cancelPianoNote(). The note's nodes disconnect themselves once it has ended (B12),
 * so a long session does not leave thousands of dead nodes around.
 */
export function playPianoNote(midi, startTime, duration, output = masterGain, oscillators) {
  const frequency = midiToHz(midi);
  const envelope = context.createGain();
  envelope.connect(output);
  envelope.gain.setValueAtTime(0, startTime);
  envelope.gain.linearRampToValueAtTime(0.3, startTime + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.11, startTime + 0.3);
  envelope.gain.exponentialRampToValueAtTime(0.0005, startTime + duration + 0.6);
  const handle = { startTime, envelope, oscillators: [], gains: [] };
  [1, 2, 3, 4, 5, 6].forEach((harmonic) => {
    const oscillator = context.createOscillator();
    const harmonicGain = context.createGain();
    // Real strings are slightly sharp in the upper partials: nudge each one up a little.
    oscillator.frequency.value = frequency * harmonic * (1 + 0.0004 * harmonic * harmonic);
    harmonicGain.gain.value = 1 / harmonic ** 1.6;
    oscillator.connect(harmonicGain).connect(envelope);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.7);
    handle.oscillators.push(oscillator);
    handle.gains.push(harmonicGain);
    if (oscillators) oscillators.push(oscillator);
  });
  // When the last harmonic has ended, let go of the whole note.
  handle.oscillators[5].onended = () => disconnectNote(handle);
  return handle;
}

function disconnectNote(handle) {
  try {
    handle.oscillators.forEach((oscillator) => oscillator.disconnect());
    handle.gains.forEach((gain) => gain.disconnect());
    handle.envelope.disconnect();
  } catch (error) {
    // Already disconnected.
  }
}

/**
 * Silence a note from playPianoNote(). A note that has not started yet never plays; one that is sounding
 * fades out in 30 ms (no click). `now` is the audio clock.
 */
export function cancelPianoNote(handle, now) {
  try {
    if (handle.startTime > now) {
      handle.oscillators.forEach((oscillator) => oscillator.stop(now));
      // An oscillator told to stop before it starts never sounds, and its onended disconnects the whole note.
      return;
    }
    const gain = handle.envelope.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + 0.03);
    handle.oscillators.forEach((oscillator) => oscillator.stop(now + 0.05));
  } catch (error) {
    // Already stopped or the context is closed.
  }
}

/**
 * Ask for the microphone and build the analysis chain.
 * Resolves {ok: true}, or {ok: false, reason} where reason is 'denied', 'notfound', 'insecure', 'other'
 * (see classifyMicError) or 'cancelled' (the audio was closed while the permission prompt was open).
 */
export async function openMic() {
  if (micStream) return { ok: true };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { ok: false, reason: 'insecure' };
  const contextAtStart = context;
  // Raw signal: the browser's voice processing would distort the pitch readings.
  const constraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  } catch (error) {
    return { ok: false, reason: classifyMicError(error) };
  }
  if (!contextAtStart || context !== contextAtStart) {
    // The session was abandoned while the browser was asking: let the mic go.
    stream.getTracks().forEach((track) => track.stop());
    return { ok: false, reason: 'cancelled' };
  }
  micStream = stream;
  const source = context.createMediaStreamSource(micStream);
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 60;
  trillLowpass = context.createBiquadFilter();
  trillLowpass.type = 'lowpass';
  trillLowpass.frequency.value = 8000;
  trillGain = context.createGain();
  analyser = context.createAnalyser();
  analyser.fftSize = ANALYSER_SIZE;
  analyser.smoothingTimeConstant = 0;
  source.connect(highpass).connect(trillLowpass).connect(trillGain).connect(analyser);
  timeBuffer = new Float32Array(analyser.fftSize);
  decimated = new Float32Array(TRILL_WINDOW);
  spectrumBuffer = new Float32Array(analyser.frequencyBinCount);
  return { ok: true };
}

/** The microphone's own reported input latency in seconds (a guess of 20 ms when it is unknown). */
export function micInputLatency() {
  try {
    return micStream.getAudioTracks()[0].getSettings().latency || 0.02;
  } catch (error) {
    return 0.02;
  }
}

/** The browser's estimate of the delay before played sound is heard, in seconds. */
export const outputDelayEstimate = () => (context.outputLatency || 0) + (context.baseLatency || 0);

/** Forget the trill-mode setting so the next session sets it afresh. */
export function resetTrillMode() {
  trillMode = null;
}

/**
 * Trill mode: filter out buzz/air above ~1.1 kHz, boost the level, and (see analysisWindow)
 * look at a longer stretch of sound at half the sample rate.
 */
export function setTrillMode(on) {
  if (trillMode === on) return;
  trillMode = on;
  const now = context.currentTime;
  trillLowpass.frequency.setTargetAtTime(on ? 1100 : 8000, now, 0.02);
  trillGain.gain.setTargetAtTime(on ? 2.5 : 1, now, 0.02);
}

/** Copy the latest microphone samples into the shared buffer. */
export function captureMicSamples() {
  analyser.getFloatTimeDomainData(timeBuffer);
}

/** The samples (and their sample rate) to run pitch detection on, from the last capture. */
export function analysisWindow(trill) {
  if (trill) {
    for (let i = 0; i < TRILL_WINDOW; i++) decimated[i] = (timeBuffer[2 * i] + timeBuffer[2 * i + 1]) / 2;
    return { samples: decimated, sampleRate: context.sampleRate / 2 };
  }
  return { samples: timeBuffer.subarray(2048), sampleRate: context.sampleRate };
}

/** Ratio of energy above 2 kHz to energy below it (up to 4 kHz): higher = brighter, "ringing" sound. */
export function brightness() {
  analyser.getFloatFrequencyData(spectrumBuffer);
  const binWidth = context.sampleRate / analyser.fftSize;
  let low = 0;
  let high = 0;
  for (let i = 2; i < spectrumBuffer.length; i++) {
    const frequency = i * binWidth;
    if (frequency > 4000) break;
    const power = 10 ** (spectrumBuffer[i] / 10);
    if (frequency < 2000) low += power;
    else high += power;
  }
  return low ? high / low : 0;
}

/** Release everything: piano, microphone and the audio context. */
export function closeAudio() {
  if (!context) return;
  if (masterGain) masterGain.disconnect();
  masterGain = null;
  context.close();
  context = null;
  if (micStream) micStream.getTracks().forEach((track) => track.stop());
  micStream = null;
}
