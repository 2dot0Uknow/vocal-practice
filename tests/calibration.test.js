// A5 (noise floor -> pitch gate) and A2 (the piano leaking into the mic), as pure functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noiseGate, detectPianoLeak, createCalibration, rms, DEFAULT_GATE, MIN_GATE } from '../js/calibration.js';
import { detect } from '../js/pitch.js';
import { sine, noisySine, whiteNoise, silence } from './helpers/signals.js';

const many = (value, count = 20) => Array.from({ length: count }, () => value);

test('rms of known signals', () => {
  assert.equal(rms(silence(100)), 0);
  assert.ok(Math.abs(rms(sine(220, 48000, 4800, 0.3)) - 0.3 / Math.SQRT2) < 1e-3);
  assert.equal(rms(new Float32Array(0)), 0);
});

test('A5: gate = 3 x the median floor, between 0.004 and 0.012', () => {
  assert.ok(Math.abs(noiseGate(many(0.002)) - 0.006) < 1e-12);
  assert.ok(Math.abs(noiseGate(many(0.003)) - 0.009) < 1e-12);
  assert.equal(noiseGate(many(0.0001)), MIN_GATE, 'a very quiet room: the lowest gate');
  assert.equal(noiseGate(many(0)), MIN_GATE);
  assert.equal(noiseGate(many(0.01)), DEFAULT_GATE, 'a noisy room never pushes the gate above today\'s value');
  assert.equal(noiseGate(many(0.5)), DEFAULT_GATE);
});

test('A5: the median ignores a few loud frames (a cough) and too few readings keep the default', () => {
  const readings = [...many(0.002, 17), 0.3, 0.3, 0.3];
  assert.ok(Math.abs(noiseGate(readings) - 0.006) < 1e-12);
  assert.equal(noiseGate(many(0.002, 9)), DEFAULT_GATE);
  assert.equal(noiseGate([]), DEFAULT_GATE);
  assert.equal(noiseGate(undefined), DEFAULT_GATE);
});

test('A5: quiet singing is read with the lower gate and missed with the old one (real detector)', () => {
  const quietVoice = noisySine(220, 48000, 2048, 0.014, 0.0005, 3);   // RMS about 0.01 minus a little: under 0.012
  const level = rms(quietVoice);
  assert.ok(level < DEFAULT_GATE && level > 0.006, `level ${level}`);
  assert.equal(detect(quietVoice, 48000), null, 'today\'s gate: silence');
  const floor = rms(whiteNoise(2048, 0.002, 5));                      // a quiet room
  const gate = noiseGate(many(floor));
  assert.ok(gate < level);
  const found = detect(quietVoice, 48000, { gate, min: 0.6 });
  assert.ok(found && Math.abs(found.f - 220) < 2);
  // And the room's own noise is still below that gate: no phantom notes.
  assert.equal(detect(whiteNoise(2048, 0.002, 6), 48000, { gate, min: 0.6 }), null);
});

const chord = { m: [48, 52, 55], t: 1, d: 0.67 };   // C3 E3 G3
const probe = (m, c = 0.9) => ({ m, c });

test('A2: the chord note in any octave, within 50 cents, for more than 40% of frames is a leak', () => {
  const frames = [...many(probe(48.2), 10), ...many(probe(null), 10)];   // 50%
  const result = detectPianoLeak(frames, chord.m);
  assert.equal(result.leak, true);
  assert.equal(result.share, 0.5);
  assert.equal(detectPianoLeak([...many(probe(55 + 12.3), 10), ...many(probe(null), 10)], chord.m).leak, true, 'an octave up (harmonic)');
  assert.equal(detectPianoLeak([...many(probe(52 - 24 + 0.4), 10), ...many(probe(null), 10)], chord.m).leak, true, 'two octaves down');
});

test('A2: exactly 40%, a non-chord pitch, a vague pitch, silence and too few frames are not a leak', () => {
  assert.equal(detectPianoLeak([...many(probe(48), 8), ...many(probe(null), 12)], chord.m).leak, false, '40% is not more than 40%');
  assert.equal(detectPianoLeak(many(probe(50)), chord.m).leak, false, 'D is not in the chord (C E G)');
  assert.equal(detectPianoLeak(many(probe(48.6)), chord.m).leak, false, '60 cents off');
  assert.equal(detectPianoLeak(many(probe(48, 0.5)), chord.m).leak, false, 'low clarity is not confident');
  assert.equal(detectPianoLeak(many(probe(null)), chord.m).leak, false);
  assert.equal(detectPianoLeak(many(probe(48), 9), chord.m).leak, false, 'fewer than 10 frames: not enough to say');
  assert.equal(detectPianoLeak([], chord.m).leak, false);
});

test('A2: real detector on synthetic frames: a C3 tone in the chord window leaks, a voice on D does not', () => {
  const probes = (frequency) => Array.from({ length: 25 }, () => {
    const found = detect(noisySine(frequency, 48000, 2048, 0.05, 0.001, 9), 48000, { gate: 0.002, min: 0.6 });
    return found ? { m: 69 + 12 * Math.log2(found.f / 440), c: found.c } : { m: null };
  });
  assert.equal(detectPianoLeak(probes(130.81), chord.m).leak, true);
  assert.equal(detectPianoLeak(probes(146.83), chord.m).leak, false);
});

test('createCalibration: collects only inside the first chord window and answers once it is over', () => {
  const calibration = createCalibration(chord);
  assert.ok(Math.abs(calibration.from - 1.1) < 1e-12 && Math.abs(calibration.to - 1.97) < 1e-12);
  assert.equal(calibration.collecting(0.5), false);
  assert.equal(calibration.collecting(1.5), true);
  calibration.add(0.5, 0.5, probe(48));          // before the window: ignored
  for (let t = 1.1; t <= 1.97; t += 0.02) calibration.add(t, 0.002, probe(null));
  assert.equal(calibration.finish(1.5), null, 'not over yet');
  const result = calibration.finish(2.0);
  assert.equal(result.pianoLeak, false);
  assert.ok(Math.abs(result.gate - 0.006) < 1e-12);
  assert.equal(calibration.finish(5), result, 'the same answer every time');
  assert.equal(calibration.collecting(1.5), false, 'closed');
});

test('createCalibration: a leaking piano is flagged, and rms readings marked unusable (null) leave the default gate', () => {
  const calibration = createCalibration(chord);
  for (let t = 1.1; t <= 1.97; t += 0.02) calibration.add(t, null, probe(52.1));
  const result = calibration.finish(3);
  assert.equal(result.pianoLeak, true);
  assert.equal(result.gate, DEFAULT_GATE);
});
