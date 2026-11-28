// Web Audio: the audio context, the piano (recorded samples, with the synthesised piano as fallback), the microphone chain and trill mode.
// This module owns all audio state; nothing else touches AudioContext objects directly.

import { midiToHz } from './music.js';
import { classifyMicError } from './session.js';
import { SAMPLE_MIDIS, sampleName, sampleFor, noteEnvelope, sustainLayer, LAYER_OCTAVE } from './piano.js';

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
    masterGain = context.createGain();
    masterGain.gain.value = pianoVolume;
    // F5: a limiter after the volume, so a cue chord (three notes) can never clip.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    masterGain.connect(limiter).connect(context.destination);
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

// F5: the recorded piano. Samples are fetched and decoded once (lazily, see loadPianoSamples) and kept for the page's
// lifetime: an AudioBuffer does not belong to one audio context, and the context is closed after every session.
const pianoBuffers = new Map();   // sample name ("Ds2") -> AudioBuffer
let pianoState = 'idle';          // 'idle' | 'loading' | 'ready' | 'failed'
let pianoLoading = null;          // the promise while loading

/** For checks and the UI: where the sample loading stands. */
export const pianoStatus = () => ({ state: pianoState, loaded: pianoBuffers.size, total: SAMPLE_MIDIS.length });

/**
 * Fetch and decode all piano samples (once; a second call while loading shares the first). Resolves true when every
 * sample is ready, false when any failed (then the synthesised piano keeps playing; a console.warn, never an error).
 * A later call after a failure tries again.
 */
export function loadPianoSamples() {
  if (pianoState === 'ready') return Promise.resolve(true);
  if (pianoLoading) return pianoLoading;
  pianoState = 'loading';
  // Decode on a throwaway offline context: it needs no sound card, and it is not closed when a session ends.
  const decoder = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
  pianoLoading = Promise.all(SAMPLE_MIDIS.map(async (midi) => {
    const name = sampleName(midi);
    const response = await fetch(new URL(`../audio/piano/${name}.mp3`, import.meta.url));
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    pianoBuffers.set(name, await decoder.decodeAudioData(await response.arrayBuffer()));
  })).then(() => {
    pianoState = 'ready';
    return true;
  }).catch((error) => {
    console.warn('Piano samples could not be loaded; using the built-in piano sound.', error);
    pianoBuffers.clear();
    pianoState = 'failed';
    return false;
  }).finally(() => {
    pianoLoading = null;
  });
  return pianoLoading;
}

/** Resolves when the samples are ready or after `timeoutMs`, whichever comes first (never rejects). */
export function pianoReady(timeoutMs) {
  if (pianoState !== 'loading') return Promise.resolve(pianoState === 'ready');
  return Promise.race([pianoLoading, new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
}

/**
 * Play one piano note. With the recorded samples loaded it is the nearest sample at the right speed; until then (or
 * if loading failed) it is the synthesised piano. Same handle either way, for cancelPianoNote().
 * Pass `oscillators` (an array) to collect the sound sources (oscillators or the sample's buffer source) so they can be stopped early.
 */
export function playPianoNote(midi, startTime, duration, output = masterGain, oscillators) {
  if (pianoState === 'ready') return playSampledNote(midi, startTime, duration, output, oscillators);
  return playSynthNote(midi, startTime, duration, output, oscillators);
}

/**
 * A recorded note: ~5 ms attack, the recording's own decay, then a 0.25 s release from the end of the note, so a held
 * note ends cleanly. The recordings are 2.8 s long: a note held longer simply rings out like a real piano (no looping).
 * The note's nodes disconnect themselves when the source has ended.
 */
function playSampledNote(midi, startTime, duration, output, oscillators) {
  const { name, rate } = sampleFor(midi);
  const source = context.createBufferSource();
  source.buffer = pianoBuffers.get(name);
  source.playbackRate.value = rate;
  const times = noteEnvelope(startTime, duration);
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, startTime);
  envelope.gain.linearRampToValueAtTime(1, times.attackEnd);
  envelope.gain.setValueAtTime(1, times.releaseStart);
  envelope.gain.linearRampToValueAtTime(0, times.releaseEnd);
  source.connect(envelope).connect(output);
  source.start(startTime);
  source.stop(times.releaseEnd + 0.02);
  const handle = { startTime, envelope, oscillators: [source], gains: [] };
  let last = source;
  // A held note outlasts the recording: a soft sustain layer keeps the pitch there until the note's end.
  const layer = sustainLayer(startTime, duration);
  if (layer) {
    const layerGain = context.createGain();
    layerGain.gain.setValueAtTime(0, startTime);
    layerGain.gain.setValueAtTime(0, layer.fadeStart);
    layerGain.gain.linearRampToValueAtTime(layer.level, layer.fadeEnd);
    layerGain.gain.setValueAtTime(layer.level, layer.releaseStart);
    layerGain.gain.linearRampToValueAtTime(0, layer.releaseEnd);
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2000;
    tone.connect(layerGain).connect(output);
    [[1, 1], [2, LAYER_OCTAVE]].forEach(([multiple, share]) => {
      const oscillator = context.createOscillator();
      const part = context.createGain();
      part.gain.value = share;
      oscillator.frequency.value = midiToHz(midi) * multiple;
      oscillator.connect(part).connect(tone);
      oscillator.start(layer.fadeStart);
      oscillator.stop(layer.releaseEnd + 0.02);
      handle.oscillators.push(oscillator);
      handle.gains.push(part);
      if (oscillators) oscillators.push(oscillator);
      last = oscillator;
    });
    handle.gains.push(tone);
    handle.layerGain = layerGain;
  }
  // Let go of the whole note when the last of its sources has ended (the layer outlasts a short recording).
  last.onended = () => disconnectNote(handle);
  if (oscillators) oscillators.push(source);
  return handle;
}

/**
 * The fallback: six slightly stretched harmonics under a quick-attack, slow-decay envelope.
 * Returns a handle for cancelPianoNote(). The note's nodes disconnect themselves once it has ended (B12),
 * so a long session does not leave thousands of dead nodes around.
 */
function playSynthNote(midi, startTime, duration, output, oscillators) {
  const frequency = midiToHz(midi);
  const envelope = context.createGain();
  // A gentle low-pass takes the harsh edge off the synthetic piano.
  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 5000;
  envelope.connect(lowpass).connect(output);
  envelope.gain.setValueAtTime(0, startTime);
  envelope.gain.linearRampToValueAtTime(0.3, startTime + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.11, startTime + 0.3);
  envelope.gain.exponentialRampToValueAtTime(0.0005, startTime + duration + 0.6);
  const handle = { startTime, envelope, oscillators: [], gains: [], lowpass };
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
    if (handle.layerGain) handle.layerGain.disconnect();
    if (handle.lowpass) handle.lowpass.disconnect();
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
    if (handle.layerGain) {
      handle.layerGain.gain.cancelScheduledValues(now);
      handle.layerGain.gain.setValueAtTime(handle.layerGain.gain.value, now);
      handle.layerGain.gain.linearRampToValueAtTime(0, now + 0.03);
    }
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

/** A3: the microphone track's own sample rate (Hz), or 0 when the browser does not say. 16000 or less means narrow-band (e.g. Bluetooth call mode). */
export function micSampleRate() {
  try {
    return micStream.getAudioTracks()[0].getSettings().sampleRate || 0;
  } catch (error) {
    return 0;
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

let lastHighBandRatio = 0;

/**
 * Ratio of energy above 2 kHz to energy below it (up to 4 kHz): higher = brighter, "ringing" sound.
 * Side effect (A3): also works out, from the same spectrum, the energy above 4 kHz over the energy below it
 * (see highBandRatio), to tell narrow-band input from a normal mic.
 */
export function brightness() {
  analyser.getFloatFrequencyData(spectrumBuffer);
  const binWidth = context.sampleRate / analyser.fftSize;
  let low = 0;
  let high = 0;
  let above = 0;
  for (let i = 2; i < spectrumBuffer.length; i++) {
    const frequency = i * binWidth;
    const power = 10 ** (spectrumBuffer[i] / 10);
    if (frequency > 4000) above += power;
    else if (frequency < 2000) low += power;
    else high += power;
  }
  lastHighBandRatio = low + high ? above / (low + high) : 0;
  return low ? high / low : 0;
}

/** Energy above 4 kHz over energy below it, from the last brightness() call. Near zero for narrow-band input. */
export const highBandRatio = () => lastHighBandRatio;

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
