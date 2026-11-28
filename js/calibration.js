// What the first cue chord is used for (nobody should be singing then): A5 how noisy the room is, and A2 whether
// the piano is leaking into the microphone. Pure functions: no DOM, no audio.

/** The pitch gate (minimum RMS level) before anything is measured, and its ceiling: today's value. */
export const DEFAULT_GATE = 0.012;
/** The lowest gate: below this the detector would start reading hiss. */
export const MIN_GATE = 0.004;
/** The gate is this many times the measured noise floor. */
export const GATE_FACTOR = 3;
/** Fewest RMS readings (about 0.2 s) that make a floor worth believing. */
export const MIN_FLOOR_READINGS = 10;

/** Root mean square level of a block of samples. */
export function rms(samples) {
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  return samples.length ? Math.sqrt(energy / samples.length) : 0;
}

const medianOf = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * A5: the pitch gate for the rest of the session: 3 x the median RMS heard during the first cue chord, kept
 * between MIN_GATE and DEFAULT_GATE. Too few readings: the default. A quiet room lets quiet singing through
 * instead of being read as missed; a noisy room (or a leaking piano) can never push the gate above today's value.
 */
export function noiseGate(rmsReadings) {
  if (!rmsReadings || rmsReadings.length < MIN_FLOOR_READINGS) return DEFAULT_GATE;
  return Math.min(DEFAULT_GATE, Math.max(MIN_GATE, GATE_FACTOR * medianOf(rmsReadings)));
}

/** Pitch distance in cents between two MIDI pitches, folded to the nearest octave (here octave-equivalence is right: speakers produce harmonics). */
const foldedCents = (a, b) => {
  const distance = (a - b) * 100;
  return distance - 1200 * Math.round(distance / 1200);
};

/** Share of the chord's analysed frames that must match a chord note before it is called a leak. */
export const LEAK_SHARE = 0.4;
export const LEAK_CENTS = 50;
export const LEAK_MIN_CLARITY = 0.7;
export const LEAK_MIN_FRAMES = 10;

/**
 * A2: is the piano reaching the microphone? `probes` are every analysis made during the first cue chord:
 * {m (midi or null when nothing pitched was heard), c (clarity)}. A frame matches when it is confident
 * (clarity at least LEAK_MIN_CLARITY) and within LEAK_CENTS of any chord note in any octave. A leak is more than
 * LEAK_SHARE of ALL the analysed frames (silent ones count). Returns {leak, share, analysed, matched}.
 */
export function detectPianoLeak(probes, chordMidis) {
  const analysed = probes.length;
  const matched = probes.filter((probe) => probe.m != null && (probe.c ?? 0) >= LEAK_MIN_CLARITY
    && chordMidis.some((note) => Math.abs(foldedCents(probe.m, note)) <= LEAK_CENTS)).length;
  const share = analysed ? matched / analysed : 0;
  return { leak: analysed >= LEAK_MIN_FRAMES && share > LEAK_SHARE, share, analysed, matched };
}

/**
 * Collects the first cue chord's readings as the session runs and gives the answers once the chord is over.
 *  - chord: {m: [midi...], t (song time it starts), d (seconds)} (the first of the run's piano plays)
 * The window skips the chord's first 0.1 s (the mic hears it a moment late) and runs 0.3 s past its end (it rings on).
 *   add(t, rmsLevel, probe)  record one analysis (rmsLevel may be null: not usable, e.g. trill mode's boosted chain)
 *   finish(t)                null until the window is over, then {gate, pianoLeak, leak: {...}} (the same object every time)
 */
export function createCalibration(chord) {
  const from = chord.t + 0.1;
  const to = chord.t + chord.d + 0.3;
  const levels = [];
  const probes = [];
  let result = null;
  return {
    from,
    to,
    /** True while the chord window is open (the practice loop only measures then). */
    collecting: (t) => !result && t >= from && t <= to,
    add(t, rmsLevel, probe) {
      if (result || t < from || t > to) return;
      if (rmsLevel != null) levels.push(rmsLevel);
      probes.push(probe);
    },
    finish(t) {
      if (result) return result;
      if (t <= to) return null;
      const leak = detectPianoLeak(probes, chord.m);
      result = { gate: noiseGate(levels), pianoLeak: leak.leak, leak };
      return result;
    },
  };
}
