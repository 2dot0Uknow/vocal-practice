// Pitch detection (McLeod pitch method). Pure maths on an array of samples.

const DEFAULT_OPTIONS = { gate: 0.012, min: 0.6 };

/**
 * Find the pitch of a short audio window.
 *  - samples: Float32Array of audio, sampleRate in Hz
 *  - options.gate: minimum RMS level; quieter windows return null (silence)
 *  - options.min: minimum clarity (0..1) a peak needs to be believed
 * Returns {f: frequency in Hz, c: clarity 0..1} or null when there is no clear pitch.
 */
export function detect(samples, sampleRate, options = DEFAULT_OPTIONS) {
  const length = samples.length;
  let energy = 0;
  for (let i = 0; i < length; i++) energy += samples[i] * samples[i];
  if (Math.sqrt(energy / length) < options.gate) return null;

  // Normalised square difference at each lag (1.0 = the signal repeats perfectly after that lag).
  // Only lags down to ~65 Hz are searched.
  const maxLag = Math.min(length >> 1, Math.floor(sampleRate / 65));
  const nsdf = new Float32Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let crossSum = 0;
    let powerSum = 0;
    for (let i = 0; i < length - lag; i++) {
      const a = samples[i];
      const b = samples[i + lag];
      crossSum += a * b;
      powerSum += a * a + b * b;
    }
    nsdf[lag] = powerSum ? (2 * crossSum) / powerSum : 0;
  }

  // Skip the first lobe (the trivial match at tiny lags) ...
  let lag = 1;
  while (lag < maxLag && nsdf[lag] > 0) lag++;
  // ... find the tallest remaining peak ...
  let best = 0;
  for (let t = lag; t <= maxLag; t++) if (nsdf[t] > best) best = nsdf[t];
  if (best < options.min) return null;
  // ... and take the FIRST peak that is at least 90% as tall (avoids octave-down errors).
  for (let t = lag + 1; t <= maxLag; t++) {
    if (nsdf[t] >= 0.9 * best && nsdf[t] > nsdf[t - 1] && nsdf[t] >= nsdf[t + 1]) {
      // Parabolic interpolation around the peak for sub-sample accuracy.
      const before = nsdf[t - 1];
      const peak = nsdf[t];
      const after = nsdf[t + 1];
      const curvature = before - 2 * peak + after;
      const shift = curvature ? (before - after) / (2 * curvature) : 0;
      const frequency = sampleRate / (t + shift);
      return frequency > 60 && frequency < 1200 ? { f: frequency, c: peak } : null;
    }
  }
  return null;
}
