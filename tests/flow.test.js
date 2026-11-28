// F2, F3, F8: round line, count-in word, readout fade, set summary (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundLabel, progressFraction, singReadout, readoutsFaded, FADE_AFTER_MS, setLabel, recordSetResult, setSummaryRows } from '../js/flow.js';

test('F2: round label reads "Round 3 of 12 · starting on D3" and follows the exercise\'s spelling', () => {
  assert.equal(roundLabel(2, 12, 50, 'auto'), 'Round 3 of 12 · starting on D3');
  assert.equal(roundLabel(0, 5, 48, 'auto'), 'Round 1 of 5 · starting on C3');
  assert.equal(roundLabel(1, 5, 49, 'b'), 'Round 2 of 5 · starting on Db3');
  assert.equal(roundLabel(1, 5, 49, '#'), 'Round 2 of 5 · starting on C#3');
  assert.equal(roundLabel(3, 5, 51, 'auto'), 'Round 4 of 5 · starting on Eb3');
});

test('F2: progress is finished rounds plus the share of this one, kept between 0 and 1', () => {
  assert.equal(progressFraction(0, 4, 0), 0);
  assert.equal(progressFraction(1, 4, 0.5), 0.375);
  assert.equal(progressFraction(3, 4, 1), 1);
  assert.equal(progressFraction(3, 4, 7), 1);
  assert.equal(progressFraction(0, 4, -3), 0);
  assert.equal(progressFraction(0, 0, 0), 0);
});

test('F2: "Ready…" during the first cue chord, then the first note\'s sound', () => {
  assert.equal(singReadout({ now: 0.7, firstChordEnd: 1.5, syllable: 'ah' }), 'Ready…');
  assert.equal(singReadout({ now: 1.5, firstChordEnd: 1.5, syllable: 'ah' }), 'ah');
  assert.equal(singReadout({ now: 3, firstChordEnd: 1.5, syllable: '' }), '–');
  assert.equal(singReadout({ now: 0.7, firstChordEnd: null, syllable: 'ee' }), 'ee');   // later rounds: no count-in
});

test('F3: readouts fade to a dash after 300 ms without a voiced frame', () => {
  assert.equal(FADE_AFTER_MS, 300);
  assert.equal(readoutsFaded(1000, 1250), false);
  assert.equal(readoutsFaded(1000, 1300), false);
  assert.equal(readoutsFaded(1000, 1301), true);
  assert.equal(readoutsFaded(null, 50), true);   // nothing heard yet: a dash
});

test('F8: "Exercise 2 of 5"', () => {
  assert.equal(setLabel(2, 5), 'Exercise 2 of 5');
});

test('F8: a set result replaces an earlier one for the same exercise (Go again), keeping the order', () => {
  let results = [];
  results = recordSetResult(results, { id: 'a', name: 'A', pct: 50, saved: true, partial: false });
  results = recordSetResult(results, { id: 'b', name: 'B', pct: 60, saved: true, partial: false });
  const again = recordSetResult(results, { id: 'a', name: 'A', pct: 80, saved: true, partial: false });
  assert.deepEqual(again.map((r) => [r.id, r.pct]), [['a', 80], ['b', 60]]);
  assert.equal(results[0].pct, 50);   // the input is not changed
});

test('F8: summary rows mark stopped runs "stopped, not saved" and unsaved finished runs "not saved"', () => {
  const rows = setSummaryRows([
    { id: 'a', name: 'Scale', pct: 72, saved: true, partial: false },
    { id: 'b', name: 'Trill', pct: 40, saved: false, partial: true },
    { id: 'c', name: 'Hum', pct: 0, saved: false, partial: false },
  ]);
  assert.deepEqual(rows, [
    { name: 'Scale', text: '72%' },
    { name: 'Trill', text: '40% · stopped, not saved' },
    { name: 'Hum', text: '0% · not saved' },
  ]);
});
