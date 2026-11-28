// F6 reorder / duplicate / delete + undo, F10 first-launch range (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveExercise, duplicateExercise, removeExercise, restoreExercise, shouldOnboard, readComfortableRange, rebaseSamples } from '../js/library-ops.js';
import { SAMPLES } from '../js/exercise.js';

const list = () => ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), vows: ['ah'], start: 48, end: 55 }));
const ids = (l) => l.map((x) => x.id).join('');

test('F6: move up and down swap neighbours; the ends stay put and nothing is mutated', () => {
  const original = list();
  assert.equal(ids(moveExercise(original, 2, -1)), 'acbd');
  assert.equal(ids(moveExercise(original, 1, 1)), 'acbd');
  assert.equal(ids(original), 'abcd');
  assert.equal(moveExercise(original, 0, -1), original);
  assert.equal(moveExercise(original, 3, 1), original);
  assert.equal(moveExercise(original, 9, 1), original);
});

test('F6: duplicate adds "<name> (copy)" with a new id right after the original; the original is untouched', () => {
  const original = list();
  const { list: next, copy } = duplicateExercise(original, 'b', 'new1');
  assert.deepEqual(next.map((x) => x.id), ['a', 'b', 'new1', 'c', 'd']);
  assert.equal(copy.name, 'B (copy)');
  assert.equal(copy.id, 'new1');
  assert.notEqual(copy.vows, original[1].vows);   // its own array
  assert.equal(original.length, 4);
  assert.equal(duplicateExercise(original, 'zzz', 'n').copy, null);
});

test('F6: a copy has no history: history is linked by exercise id, and the new id matches no entry', async () => {
  const { previousRunsOf } = await import('../js/history.js');
  const history = [{ exId: 'b', pct: 70 }, { exId: 'a', pct: 40 }];
  const { copy } = duplicateExercise(list(), 'b', 'new1');
  assert.deepEqual(previousRunsOf(history, copy), []);
});

test('F6: delete then Undo puts the same exercise (same id) back at its old position', () => {
  const original = list();
  const { list: after, removed } = removeExercise(original, 'c');
  assert.equal(ids(after), 'abd');
  assert.equal(removed.index, 2);
  assert.equal(removed.exercise.id, 'c');
  const restored = restoreExercise(after, removed);
  assert.equal(ids(restored), 'abcd');
  assert.equal(restored[2], original[2]);   // the very same object, so id, name and settings are all as before
});

test('F6: Undo after the list got shorter puts it at the end; Undo twice does not duplicate', () => {
  const { list: after, removed } = removeExercise(list(), 'd');
  const shorter = after.slice(0, 1);
  assert.equal(ids(restoreExercise(shorter, removed)), 'ad');
  const once = restoreExercise(after, removed);
  assert.equal(restoreExercise(once, removed), once);
  assert.equal(removeExercise(list(), 'nope').removed, null);
  assert.equal(restoreExercise(list(), null).length, 4);
});

test('F10: the card shows only on a truly fresh profile', () => {
  assert.equal(shouldOnboard({ hasExercises: false, hasHistory: false, onboarded: false }), true);
  assert.equal(shouldOnboard({ hasExercises: true, hasHistory: false, onboarded: false }), false);
  assert.equal(shouldOnboard({ hasExercises: false, hasHistory: true, onboarded: false }), false);
  assert.equal(shouldOnboard({ hasExercises: false, hasHistory: false, onboarded: true }), false);
});

test('F10: reading the two note boxes', () => {
  assert.deepEqual(readComfortableRange('A2', 'e3'), { ok: true, low: 45, high: 52 });
  assert.equal(readComfortableRange('hello', 'G3').field, 'low');
  assert.equal(readComfortableRange('C3', '').field, 'high');
  assert.equal(readComfortableRange('G3', 'C3').field, 'high');
  assert.equal(readComfortableRange('C3', 'C3').ok, true);
});

test('F10: with the default range (C3 to G3) the samples are exactly as they were', () => {
  assert.deepEqual(rebaseSamples(SAMPLES, 48, 55), SAMPLES);
});

test('F10: the samples start on the low note and never start above the high one, keeping their own lengths', () => {
  const rebased = rebaseSamples(SAMPLES, 45, 50);   // A2 to D3
  assert.deepEqual(rebased.map((x) => [x.start, x.end]), [[45, 50], [45, 50], [45, 49]]);
  const narrow = rebaseSamples(SAMPLES, 60, 60);
  assert.ok(narrow.every((x) => x.start === 60 && x.end === 60));
  const wide = rebaseSamples(SAMPLES, 40, 79);
  assert.deepEqual(wide.map((x) => x.end - x.start), SAMPLES.map((x) => x.end - x.start));
  assert.deepEqual(rebased.map((x) => x.pat), SAMPLES.map((x) => x.pat));   // everything else untouched
  assert.deepEqual(SAMPLES.map((x) => [x.start, x.end]), [[48, 55], [48, 53], [48, 52]]);
});
