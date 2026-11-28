// A3: tone readings (clarity, ring) depend on the vowel, the note and the mic, so on their own they say little.
// What is useful is how today compares with the singer's OWN earlier runs of the same exercise on the same sound.
// Pure functions: no DOM, no storage.

/** Saved runs of the same exercise + sound needed before tone is shown as a trend. */
export const BASELINE_RUNS = 3;
/** Only the newest runs form the baseline, so it follows the voice as it improves. */
export const BASELINE_WINDOW = 10;

// How far from the singer's own average counts as "different". Chosen from the spread of the synthetic singers and
// the usual run-to-run wobble of the clarity measure (about 0.01 to 0.02); to be tuned with real sessions (A7).
/** Clarity (0 to 1): more than this above / below the average is "clearer" / "airier". */
export const CLARITY_BAND = 0.025;
/** Ring (brightness ratio): more than this fraction of the average (and at least RING_MIN_BAND) is "brighter" / "softer". */
export const RING_BAND = 0.25;
export const RING_MIN_BAND = 0.015;

export const CLARITY_WORDS = { clearer: 'a little clearer than usual', usual: 'about your usual', airier: 'a little airier than usual' };
export const RING_WORDS = { brighter: 'brighter than usual', usual: 'about your usual', softer: 'softer than usual' };

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

/** The sound a run was mostly sung on: the most common syllable among its notes (the first wins a tie); '' when there is none. */
export function mainSound(results) {
  const counts = new Map();
  results.forEach((result) => {
    if (result.syl) counts.set(result.syl, (counts.get(result.syl) ?? 0) + 1);
  });
  let best = '';
  let bestCount = 0;
  counts.forEach((count, sound) => {
    if (count > bestCount) {
      best = sound;
      bestCount = count;
    }
  });
  return best;
}

/**
 * Compare this run's tone with the singer's earlier runs of the same exercise on the same sound.
 *  - previousRuns: earlier history entries of this exercise, newest first (old entries have no `sound` and never match)
 *  - sound: this run's main sound; clarity, ring: this run's tone numbers
 * Returns {ready: false, count} until BASELINE_RUNS earlier runs match, then
 * {ready: true, count, clarityTrend: 'clearer'|'usual'|'airier', ringTrend: 'brighter'|'usual'|'softer', clarityAverage, ringAverage}.
 */
export function compareTone({ previousRuns, sound, clarity, ring }) {
  const same = previousRuns
    .filter((run) => run && run.sound === sound && typeof run.clarity === 'number' && typeof run.ring === 'number')
    .slice(0, BASELINE_WINDOW);
  if (same.length < BASELINE_RUNS) return { ready: false, count: same.length };
  const clarityAverage = mean(same.map((run) => run.clarity));
  const ringAverage = mean(same.map((run) => run.ring));
  const clarityDelta = clarity - clarityAverage;
  const ringBand = Math.max(RING_BAND * ringAverage, RING_MIN_BAND);
  const ringDelta = ring - ringAverage;
  return {
    ready: true,
    count: same.length,
    clarityAverage,
    ringAverage,
    clarityTrend: clarityDelta > CLARITY_BAND ? 'clearer' : clarityDelta < -CLARITY_BAND ? 'airier' : 'usual',
    ringTrend: ringDelta > ringBand ? 'brighter' : ringDelta < -ringBand ? 'softer' : 'usual',
  };
}

/** "Getting a baseline (2 of 3)": n counts this run too when it will be saved. */
export const baselineLabel = (count, willBeSaved) => `Getting a baseline (${Math.min(BASELINE_RUNS, count + (willBeSaved ? 1 : 0))} of ${BASELINE_RUNS})`;

// Narrow-band input (a Bluetooth headset in call mode, 8 or 16 kHz): there is almost nothing above 4 kHz, so
// clarity and ring mean something else. Estimated from the track's sample rate or from the spectrum.
export const NARROW_SAMPLE_RATE = 16000;
/** Energy above 4 kHz over energy below it (100 Hz to 4 kHz): a median under this means "no high band" (about -50 dB). To be tuned on a real device. */
export const NARROW_HIGH_RATIO = 1e-5;
/** Spectrum readings needed before the spectrum may decide (about half a second of singing). */
export const NARROW_MIN_READINGS = 25;

/**
 * True when the microphone input looks narrow-band.
 *  - sampleRate: the mic track's getSettings().sampleRate (undefined / 0 when the browser does not say)
 *  - highBandRatios: one reading per voiced non-trill frame (trill mode filters above 1.1 kHz on purpose, so it is left out)
 */
export function isNarrowBand({ sampleRate, highBandRatios = [] }) {
  if (sampleRate && sampleRate <= NARROW_SAMPLE_RATE) return true;
  if (highBandRatios.length < NARROW_MIN_READINGS) return false;
  const sorted = [...highBandRatios].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return median < NARROW_HIGH_RATIO;
}
