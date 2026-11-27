// B12: frames and targets are found by binary search. The indexed scoreNotes / activeAt must give exactly
// the answers of the old walk-everything versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstIndexWhere, frameRange, targetRange, nextTargetAfter, nearestTargetByStart, createFrameStore, isSortedByTime } from '../js/timeindex.js';
import { scoreNotes, activeAt, summarizeSession } from '../js/scoring.js';
import { buildSession, normEx, planRounds } from '../js/exercise.js';
import { createRun } from '../js/run.js';
import { singerFrames } from './helpers/signals.js';
import { legacyScoreNotes, legacyActiveAt } from './helpers/legacy-scoring.js';
import { SESSION_EXERCISES, SINGER_SCENARIOS } from './tools/cases.mjs';

const frameAt = (t, m = 60) => ({ t, m, c: 0.9, ring: 0.1 });

test('firstIndexWhere finds the boundary of a monotone test', () => {
  const items = [1, 3, 3, 5, 8];
  assert.equal(firstIndexWhere(items, (x) => x >= 3), 1);
  assert.equal(firstIndexWhere(items, (x) => x > 3), 3);
  assert.equal(firstIndexWhere(items, (x) => x > 100), 5);
  assert.equal(firstIndexWhere(items, (x) => x >= 0), 0);
  assert.equal(firstIndexWhere([], () => true), 0);
});

test('frameRange: frames with fromTime <= t <= toTime, ends included', () => {
  const frames = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) => frameAt(t));
  const { start, end } = frameRange(frames, 0.1, 0.4);
  assert.deepEqual(frames.slice(start, end).map((f) => f.t), [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(frameRange(frames, 0.45, 0.46), { start: 5, end: 5 }, 'nothing in the window');
  assert.deepEqual(frameRange(frames, -5, 9), { start: 0, end: 6 });
  assert.deepEqual(frameRange([], 0, 1), { start: 0, end: 0 });
});

test('targetRange: the targets that touch a span', () => {
  const targets = [[0, 1], [1, 2], [3, 4], [5, 6]].map(([t0, t1]) => ({ t0, t1, m: 60 }));
  const slice = (from, to) => { const r = targetRange(targets, from, to); return targets.slice(r.start, r.end).map((t) => t.t0); };
  assert.deepEqual(slice(1.5, 3.5), [1, 3]);
  assert.deepEqual(slice(2.2, 2.8), [], 'the gap between rounds');
  assert.deepEqual(slice(-9, 9), [0, 1, 3, 5]);
  assert.deepEqual(slice(6, 7), [5], 'touching the end counts');
});

test('nextTargetAfter and nearestTargetByStart', () => {
  const targets = [[0, 1], [1, 2], [3, 4]].map(([t0, t1]) => ({ t0, t1, m: 60 }));
  assert.equal(nextTargetAfter(targets, 0.5).t0, 1);
  assert.equal(nextTargetAfter(targets, 3), undefined);
  assert.equal(nearestTargetByStart(targets, 2.4).t0, 3, 'closer to 3 than 1');
  assert.equal(nearestTargetByStart(targets, 2).t0, 1, 'a tie goes to the earlier note');
  assert.equal(nearestTargetByStart(targets, -9).t0, 0);
  assert.equal(nearestTargetByStart(targets, 99).t0, 3);
  assert.equal(nearestTargetByStart([], 1), undefined);
});

test('nearestTargetByStart matches the old reduce on every time of a real session', () => {
  const { targets } = buildSession(normEx(SESSION_EXERCISES.twoPass), 0);
  for (let t = -1; t < targets[targets.length - 1].t1 + 2; t += 0.037) {
    const old = targets.reduce((a, b) => (Math.abs(b.t0 - t) < Math.abs(a.t0 - t) ? b : a));
    assert.equal(nearestTargetByStart(targets, t), old, `t=${t}`);
  }
});

test('activeAt (binary search) matches the old find on every time of every session, and across round gaps', () => {
  for (const key of Object.keys(SESSION_EXERCISES)) {
    const { targets } = buildSession(normEx(SESSION_EXERCISES[key]), 3);
    for (let t = 2; t < targets[targets.length - 1].t1 + 1; t += 0.011) assert.equal(activeAt(targets, t), legacyActiveAt(targets, t), `${key} t=${t}`);
    // Exactly on the boundaries (start, end, end + grace).
    for (const target of targets) {
      for (const t of [target.t0, target.t1, target.t1 + 0.15, target.t0 - 1e-9, target.t1 + 0.15 - 1e-9]) assert.equal(activeAt(targets, t), legacyActiveAt(targets, t), `${key} edge ${t}`);
    }
  }
  assert.equal(activeAt([], 1), undefined);
});

test('the frame store keeps time order, finds recent frames, and discards a replayed round', () => {
  const store = createFrameStore();
  [0, 0.02, 0.04, 0.06, 0.08].forEach((t) => store.add(frameAt(t)));
  store.add(frameAt(0.05)); // out of order: goes where it belongs
  assert.deepEqual(store.frames.map((f) => f.t), [0, 0.02, 0.04, 0.05, 0.06, 0.08]);
  assert.ok(isSortedByTime(store.frames));
  assert.deepEqual(store.since(0.04).map((f) => f.t), [0.05, 0.06, 0.08]);
  assert.equal(store.discardAfter(0.05), 2);
  assert.deepEqual(store.frames.map((f) => f.t), [0, 0.02, 0.04, 0.05]);
  assert.equal(store.length, 4);
  store.clear();
  assert.equal(store.length, 0);
});

// ---- scoreNotes: old walk-everything vs indexed ----

test('scoreNotes (indexed) is identical to the old version on every exercise x singer scenario', () => {
  for (const [key, exercise] of Object.entries(SESSION_EXERCISES)) {
    const { targets } = buildSession(normEx(exercise), 0);
    for (const [name, scenario] of Object.entries(SINGER_SCENARIOS)) {
      const frames = singerFrames(targets, scenario).map((f) => ({ ...f, t: f.t - scenario.lag }));
      assert.deepEqual(scoreNotes(targets, frames), legacyScoreNotes(targets, frames), `${key}/${name}`);
    }
  }
});

test('scoreNotes (indexed) is identical on a long 24-round run, a run with a pause gap and rounds taken out', () => {
  const exercise = normEx({ name: 'Arp', pat: '1-3-5-8-5-3-1~', vows: ['ah'], start: 48, end: 71, bpm: 120, hold: 2 });
  const plan = planRounds(exercise);
  assert.equal(plan.rounds.length, 24);
  const run = createRun(plan);
  run.start(0.6);
  // Place every round, then leave out two and push the rest later (as pause gaps would).
  run.advance(1e9, 0);
  const full = run.targets();
  const thinned = full.filter((target) => target.round !== 5 && target.round !== 6).map((target) => (target.round >= 10 ? { ...target, t0: target.t0 + 7, t1: target.t1 + 7 } : target));
  for (const targets of [full, thinned]) {
    const frames = singerFrames(targets, { lag: 0.15, offsetCents: 8, wobbleCents: 10, seed: 3, dropEvery: 7 });
    assert.deepEqual(scoreNotes(targets, frames), legacyScoreNotes(targets, frames));
  }
});

test('scoreNotes: frames exactly on window edges, duplicated times and null pitches give identical results', () => {
  const { targets } = buildSession(normEx(SESSION_EXERCISES.scale), 0);
  const frames = [];
  for (const target of targets.slice(0, 6)) {
    const duration = target.t1 - target.t0;
    const windowStart = target.t0 + Math.min(0.35 * duration, 0.06);
    for (const t of [windowStart, windowStart, target.t1, target.t1 + Math.min(0.3, 0.6 * duration), target.t0 + duration / 2, target.t0 + duration / 2 + 0.01]) {
      frames.push(frameAt(t, target.m + 0.1));
      frames.push({ t, m: null });
    }
  }
  frames.sort((a, b) => a.t - b.t);
  assert.deepEqual(scoreNotes(targets, frames), legacyScoreNotes(targets, frames));
});

test('scoreNotes falls back to the plain walk when frames are not in time order (same answer)', () => {
  const { targets } = buildSession(normEx(SESSION_EXERCISES.scale), 0);
  const frames = singerFrames(targets, { lag: 0, wobbleCents: 3, seed: 5 });
  const shuffled = [...frames.slice(50), ...frames.slice(0, 50)];
  assert.equal(isSortedByTime(shuffled), false);
  assert.deepEqual(scoreNotes(targets, shuffled), legacyScoreNotes(targets, shuffled));
});

test('scoreNotes only looks at the frames near each note (counts frame visits on a long run)', () => {
  const exercise = normEx({ name: 'Arp', pat: '1-3-5-8-5-3-1~', vows: ['ah'], start: 48, end: 71, bpm: 120, hold: 2 });
  const run = createRun(planRounds(exercise));
  run.start(0);
  run.advance(1e9, 0);
  const targets = run.targets();
  const frames = singerFrames(targets, { lag: 0, wobbleCents: 3 });
  let visits = 0;
  const counted = frames.map((frame) => new Proxy(frame, { get(object, key) { if (key === 'm') visits++; return object[key]; } }));
  scoreNotes(targets, counted);
  // Old version: every note looks at every frame (targets x frames). New: about the frames inside each window.
  assert.ok(visits < targets.length * frames.length * 0.02, `visited ${visits} of ${targets.length * frames.length}`);
});

test('the whole report of a 24-round run (~5000 frames, 168 notes) is worked out in well under half a second', () => {
  const exercise = normEx({ name: 'Arp', pat: '1-3-5-8-5-3-1~', vows: ['ah'], start: 48, end: 71, bpm: 200 });
  const { targets } = buildSession(exercise, 0.6);
  const frames = singerFrames(targets, { lag: 0.15, wobbleCents: 8, seed: 2 });
  const began = performance.now();
  summarizeSession({ targets, frames, voiceLag: 0.15, previousRuns: [] });
  const took = performance.now() - began;
  // A loose bound (CI machines vary); it only has to catch an accidental quadratic walk, which takes seconds.
  assert.ok(took < 500, `summarizeSession took ${Math.round(took)} ms for ${frames.length} frames`);
});
