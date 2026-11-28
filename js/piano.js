// F5: the maths behind the recorded piano. Pure: no audio, no DOM, no network, so it runs under Node.
//
// audio/piano/ holds one sample per minor third from C2 to C6 (C, D#, F#, A in every octave: 17 files).
// A note between two samples plays the nearest one, sped up or slowed down (playbackRate) to the right pitch.

/** MIDI numbers of the recorded samples: C2 (36), D#2 (39) ... C6 (84). */
export const SAMPLE_MIDIS = [];
for (let midi = 36; midi <= 84; midi += 3) SAMPLE_MIDIS.push(midi);

const FILE_NAMES = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' };

/** File name (without extension) of a sample's MIDI number: 36 -> "C2", 39 -> "Ds2", 81 -> "A5". */
export const sampleName = (midi) => `${FILE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** The sample to use for a note: the nearest one (notes outside C2 to C6 use the end sample). Ties cannot happen: the gaps are 3 semitones. */
export function nearestSample(midi) {
  let best = SAMPLE_MIDIS[0];
  SAMPLE_MIDIS.forEach((candidate) => {
    if (Math.abs(candidate - midi) < Math.abs(best - midi)) best = candidate;
  });
  return best;
}

/** Playback rate that turns a sample of pitch `sampleMidi` into `midi`: each semitone is a factor 2^(1/12). */
export const playbackRateFor = (midi, sampleMidi) => 2 ** ((midi - sampleMidi) / 12);

/** Everything the sampler needs for one note: which file, and how fast to play it. */
export function sampleFor(midi) {
  const sampleMidi = nearestSample(midi);
  return { sampleMidi, name: sampleName(sampleMidi), rate: playbackRateFor(midi, sampleMidi) };
}

export const ATTACK = 0.005;   // seconds: a click-free start
export const RELEASE = 0.25;   // seconds: how long a note takes to fade once its written time is up

/**
 * Times (audio clock) of one note's volume envelope: up to full over ATTACK, stay (the recording decays by itself),
 * then fade out over RELEASE from the end of the note. A note shorter than the attack is not cut before it is up.
 */
export function noteEnvelope(startTime, duration) {
  const attackEnd = startTime + ATTACK;
  const releaseStart = Math.max(attackEnd, startTime + duration);
  return { attackEnd, releaseStart, releaseEnd: releaseStart + RELEASE };
}

// A held note outlasts the 2.8 s recording (which has also faded a lot by 2 s), and a sustain drill needs the pitch
// to stay audible to the end. So a note longer than LONG_NOTE gets a soft sustain layer (a sine on the pitch plus a quiet
// octave) that fades in under the dying sample and ends with the same release.
export const LONG_NOTE = 2;          // seconds: notes up to this long are the sample alone
export const LAYER_FADE_START = 1.2; // seconds after the note starts
export const LAYER_FADE_END = 1.6;
export const LAYER_LEVEL = 0.018;    // sine peak: about -18 dB under the sample's level (the samples sit at -20 dBFS RMS)
export const LAYER_OCTAVE = 1 / 3;   // the octave's share of the layer

/** null for a short note, else the layer's times on the audio clock: fades in from 1.2 s to 1.6 s, releases with the sample. */
export function sustainLayer(startTime, duration) {
  if (!(duration > LONG_NOTE)) return null;
  const { releaseStart, releaseEnd } = noteEnvelope(startTime, duration);
  return { fadeStart: startTime + LAYER_FADE_START, fadeEnd: startTime + LAYER_FADE_END, level: LAYER_LEVEL, releaseStart, releaseEnd };
}
