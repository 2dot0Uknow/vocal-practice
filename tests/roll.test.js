// V5: the pitch roll's two pure helpers: which notes get a label on the left edge, and when a held note glows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentRoundPitches, heldInTune } from '../js/ui/roll.js';

const targets = [
  { m: 48, t0: 0, t1: 1, round: 0 }, { m: 52, t0: 1, t1: 2, round: 0 }, { m: 55, t0: 2, t1: 3, round: 0 }, { m: 48, t0: 3, t1: 4, round: 0 },
  { m: 49, t0: 6, t1: 7, round: 1 }, { m: 53, t0: 7, t1: 8, round: 1 }, { m: 56, t0: 8, t1: 9, round: 1 },
];

test('round labels: the distinct pitches of the round being sung, highest first', () => {
  assert.deepEqual(currentRoundPitches(targets, 1.5), [55, 52, 48]);
  assert.deepEqual(currentRoundPitches(targets, 0), [55, 52, 48]);
});

test('round labels: between rounds it is the next round, after the last note it stays on the last round, nothing without targets', () => {
  assert.deepEqual(currentRoundPitches(targets, 5), [56, 53, 49]);
  assert.deepEqual(currentRoundPitches(targets, 50), [56, 53, 49]);
  assert.deepEqual(currentRoundPitches([], 1), []);
});

// Frames every 20 ms on A3-ish target m = 57; a frame is {t, m} with m in MIDI.
const frames = (from, to, midi, step = 0.02) => {
  const out = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push({ t: +t.toFixed(3), m: midi });
  return out;
};
const target = { m: 57, t0: 10, t1: 12 };

test('glow: none until the voice has been within 25 cents for 0.3 s, then it grows to 1', () => {
  assert.equal(heldInTune(frames(10, 10.2, 57.1), target, 10.2, 0), 0);
  const at = (now) => heldInTune(frames(10, now, 57.1), target, now, 0);
  assert.equal(at(10.29), 0);
  assert.ok(at(10.32) > 0 && at(10.32) < 1);
  assert.equal(at(10.7), 1);
});

test('glow: out of tune, silent, or stale frames give none; one stray frame does not break the run', () => {
  assert.equal(heldInTune(frames(10, 11, 57.5), target, 11, 0), 0, '50 cents sharp');
  assert.equal(heldInTune(frames(10, 11, 57.1), target, 11.8, 0), 0, 'the newest frame is 0.8 s old');
  assert.equal(heldInTune(frames(10, 11, 57.1), target, 11.3, 0), 1, 'a frame 0.3 s old still counts (input latency + voice lag)');
  assert.equal(heldInTune([...frames(10, 10.8, 57.1), { t: 10.82, m: null }], target, 10.82, 0), 0, 'newest frame is silent');
  const stray = frames(10, 10.8, 57.1).map((f) => (Math.abs(f.t - 10.5) < 0.001 ? { ...f, m: 58.2 } : f));
  assert.equal(heldInTune(stray, target, 10.8, 0), 1);
});

test('glow: the voice lag shifts the frames back, and frames before the note do not count', () => {
  assert.ok(heldInTune(frames(10.2, 11, 57.1), target, 10.8, 0.2) > 0);
  assert.equal(heldInTune(frames(9, 10.2, 57.1), target, 10.2, 0), 0, 'only 0.2 s inside the note');
});
