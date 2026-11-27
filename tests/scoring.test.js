import { test } from 'node:test';
import assert from 'node:assert/strict';
import { err, strictAt, estimateLag, scoreNotes } from '../js/scoring.js';
import { normEx, buildSession } from '../js/exercise.js';
import { fixture, assertSame } from './helpers/fixture.js';
import { singerFrames } from './helpers/signals.js';
import { SESSION_EXERCISES, SINGER_SCENARIOS } from './tools/cases.mjs';

test('err matches the original (signed cents, folded to the nearest octave)', () => {
  assert.ok(fixture.err.length >= 40);
  for (const { m, tm, expected } of fixture.err) assertSame(err(m, tm), expected, `${m} vs ${tm}`);
});

test('err: readable examples', () => {
  assert.equal(err(60, 60), 0);
  assert.equal(Math.round(err(60.3, 60)), 30);
  assert.equal(Math.round(err(59.5, 60)), -50);
  // Characterization: an octave away counts as perfect today (a later PR changes this on purpose).
  assert.equal(err(48, 60), 0);
  assert.equal(err(72.1, 60).toFixed(6), '10.000000');
});

test('strictAt finds the note sounding at a time, with no grace period', () => {
  for (const [key, entry] of Object.entries(fixture.sessions)) {
    const { targets } = buildSession(normEx(SESSION_EXERCISES[key]), 0);
    for (const { t, expected } of entry.strictAt) assertSame(strictAt(targets, t), expected, `${key} t=${t}`);
  }
});

for (const [key, entry] of Object.entries(fixture.sessions)) {
  test(`estimateLag and scoreNotes match the original on synthetic singers: ${key}`, () => {
    const { targets } = buildSession(normEx(SESSION_EXERCISES[key]), 0);
    for (const [name, scenario] of Object.entries(SINGER_SCENARIOS)) {
      const frames = singerFrames(targets, scenario);
      const expected = entry.scenarios[name];
      assertSame(estimateLag(frames, targets), expected.estimateLag, `${key}/${name} lag`);
      const shifted = frames.map((f) => ({ ...f, t: f.t - scenario.lag }));
      assertSame(scoreNotes(targets, shifted), expected.scoreNotes, `${key}/${name} notes`);
    }
    assertSame(estimateLag(singerFrames(targets, { step: 2 }), targets), entry.fewFrames.estimateLag, 'few frames');
  });
}

test('estimateLag recovers a known delay, and needs enough frames', () => {
  const { targets } = buildSession(normEx(SESSION_EXERCISES.scale), 0);
  const frames = singerFrames(targets, { lag: 0.3, wobbleCents: 3 });
  assert.ok(Math.abs(estimateLag(frames, targets) - 0.3) < 0.021);
  assert.equal(estimateLag(frames.slice(0, 30), targets), null);
});

test('scoreNotes: a steady in-tune singer lands every note; a sparse one is marked missed', () => {
  const { targets } = buildSession(normEx(SESSION_EXERCISES.scale), 0);
  const good = scoreNotes(targets, singerFrames(targets, { lag: 0, wobbleCents: 2 }));
  assert.ok(good.every((r) => !r.miss && Math.abs(r.med) <= 25));
  const sparse = scoreNotes(targets, singerFrames(targets, { lag: 0, step: 0.5 }));
  assert.ok(sparse.some((r) => r.miss));
});

test('scoreNotes CHARACTERIZATION: a voice one octave below every target still scores as perfect today', () => {
  const { targets } = buildSession(normEx(SESSION_EXERCISES.scale), 0);
  const results = scoreNotes(targets, singerFrames(targets, { lag: 0, octaveShift: -12, wobbleCents: 2 }));
  assert.ok(results.every((r) => !r.miss && Math.abs(r.med) <= 25));
});
