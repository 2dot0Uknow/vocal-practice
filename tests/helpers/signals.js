// Synthetic inputs shared by the tests and by tools/generate-expected.mjs.
// Everything here is deterministic (no Math.random) so fixtures stay stable.

/** Small seeded pseudo-random generator (LCG), returns numbers in [0, 1). */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A pure sine wave. */
export function sine(frequency, sampleRate, length, amplitude = 0.3) {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return samples;
}

/** A voice-like tone: the first `harmonics` partials, each weaker than the last. */
export function harmonicTone(frequency, sampleRate, length, amplitude = 0.3, harmonics = 6) {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let n = 1; n <= harmonics; n++) {
      sum += Math.sin((2 * Math.PI * frequency * n * i) / sampleRate) / n ** 1.2;
    }
    samples[i] = amplitude * sum * 0.5;
  }
  return samples;
}

/** Sine plus seeded noise. */
export function noisySine(frequency, sampleRate, length, amplitude, noiseLevel, seed) {
  const random = seededRandom(seed);
  const samples = sine(frequency, sampleRate, length, amplitude);
  for (let i = 0; i < length; i++) samples[i] += (random() - 0.5) * 2 * noiseLevel;
  return samples;
}

export function silence(length) {
  return new Float32Array(length);
}

/** Pure noise, no pitch. */
export function whiteNoise(length, amplitude, seed) {
  const random = seededRandom(seed);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) samples[i] = (random() - 0.5) * 2 * amplitude;
  return samples;
}

const midiOf = (hz) => 69 + 12 * Math.log2(hz / 440);

/**
 * Fake "voice frames" as the practice loop would record them.
 * `targets` come from a built session. The singer follows the target that was
 * active `lag` seconds earlier, plus `offsetCents`, with a little seeded wobble.
 * Frames are produced every `step` seconds. `dropEvery` (if set) turns every
 * n-th frame into silence (m = null).
 */
export function singerFrames(targets, {
  lag = 0.2,
  offsetCents = 0,
  octaveShift = 0,
  wobbleCents = 6,
  step = 0.02,
  dropEvery = 0,
  seed = 1,
  clarity = 0.9,
  ring = 0.1,
} = {}) {
  const random = seededRandom(seed);
  const frames = [];
  const end = targets[targets.length - 1].t1 + 0.5;
  let index = 0;
  for (let t = 0; t < end; t += step, index++) {
    const target = targets.find((x) => t - lag >= x.t0 && t - lag < x.t1);
    if (!target || (dropEvery && index % dropEvery === 0)) {
      frames.push({ t, m: null, tr: false });
      continue;
    }
    const wobble = (random() - 0.5) * 2 * wobbleCents;
    frames.push({
      t,
      m: target.m + octaveShift + (offsetCents + wobble) / 100,
      tr: false,
      c: clarity + (random() - 0.5) * 0.04,
      ring: ring + (random() - 0.5) * 0.02,
    });
  }
  return frames;
}

export { midiOf };
