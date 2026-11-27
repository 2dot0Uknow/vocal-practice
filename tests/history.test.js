// History entries (A4), matching runs to an exercise by id (B9) and the 200-entry cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyEntry, previousRunsOf, addToHistory, MAX_HISTORY } from '../js/history.js';
import { summarizeSession } from '../js/scoring.js';
import { buildSession, normEx } from '../js/exercise.js';
import { singerFrames } from './helpers/signals.js';
import { SESSION_EXERCISES, SINGER_SCENARIOS } from './tools/cases.mjs';

const NOW = new Date(2026, 10, 27, 9, 30);

function runOf(key, scenarioName) {
  const exercise = normEx({ ...SESSION_EXERCISES[key], id: 'x-' + key });
  const { targets } = buildSession(exercise, 0);
  const frames = singerFrames(targets, SINGER_SCENARIOS[scenarioName]);
  const summary = summarizeSession({ targets, frames, voiceLag: 0.15, previousRuns: [] });
  return { exercise, summary };
}

test('A4: a new entry carries the exercise id and the report numbers, rounded as specified', () => {
  const { exercise, summary } = runOf('scale', Object.keys(SINGER_SCENARIOS)[0]);
  const entry = historyEntry(exercise, summary, NOW);
  assert.equal(entry.name, exercise.name);
  assert.equal(entry.exId, exercise.id);
  assert.equal(entry.pct, summary.pct);
  assert.equal(entry.ts, NOW.getTime());
  assert.equal(typeof entry.date, 'string');
  assert.equal(entry.avgCents, Math.round(summary.avgAbs));
  assert.equal(entry.lean, Math.round(summary.lean));
  assert.equal(entry.steadiness, Math.round(summary.stability * 10) / 10);
  assert.equal(entry.clarity, Math.round(summary.clarity * 100) / 100);
  assert.equal(entry.ring, Math.round(summary.ring * 100) / 100);
  assert.equal(entry.notes, summary.total);
  assert.equal(entry.rounds, new Set(summary.results.map((r) => r.round)).size);
  assert.ok(Number.isInteger(entry.avgCents) && Number.isInteger(entry.lean));
  assert.ok(entry.clarity > 0 && entry.clarity <= 1);
  // topNote: highest target note that was heard within 50 cents.
  const landed = summary.results.filter((r) => !r.miss && Math.abs(r.med) <= 50).map((r) => r.m);
  assert.equal(entry.topNote, Math.max(...landed));
  assert.deepEqual(Object.keys(entry), ['name', 'exId', 'pct', 'ts', 'date', 'avgCents', 'lean', 'steadiness', 'clarity', 'ring', 'topNote', 'rounds', 'notes']);
});

test('A4: the entry matches the report subtitle ("Average N cents off")', () => {
  const { exercise, summary } = runOf('scale', Object.keys(SINGER_SCENARIOS)[0]);
  assert.ok(summary.subtitle.startsWith(`Average ${historyEntry(exercise, summary, NOW).avgCents} cents off`));
});

test('A4: a run with no tone notes (pure lip trill) stores clarity and ring as null', () => {
  const exercise = normEx({ id: 'trill', name: 'Trill', pat: '1-3-5-3-1~', vows: ['lip trill'], start: 48, end: 49 });
  const { targets } = buildSession(exercise, 0);
  const frames = singerFrames(targets, SINGER_SCENARIOS[Object.keys(SINGER_SCENARIOS)[0]]);
  const summary = summarizeSession({ targets, frames, voiceLag: 0.15, previousRuns: [] });
  assert.equal(summary.toneCount, 0);
  assert.ok(summary.heardCount > 0);
  const entry = historyEntry(exercise, summary, NOW);
  assert.equal(entry.clarity, null);
  assert.equal(entry.ring, null);
  assert.equal(typeof entry.avgCents, 'number');
});

test('A4: topNote is null when no note was landed within 50 cents; topNote ignores sung-but-way-off notes', () => {
  const exercise = { id: 'e', name: 'E' };
  const base = { pct: 0, avgAbs: 60.4, lean: -3.6, stability: 7.26, clarity: 0.9, ring: 0.1, toneCount: 2, total: 3 };
  const off = historyEntry(exercise, { ...base, results: [{ m: 60, round: 0, med: 80 }, { m: 62, round: 0, miss: true }] }, NOW);
  assert.equal(off.topNote, null);
  const mixed = historyEntry(exercise, {
    ...base,
    results: [{ m: 60, round: 0, med: -49 }, { m: 64, round: 1, med: 51 }, { m: 62, round: 1, med: 20 }, { m: 67, round: 1, miss: true }],
  }, NOW);
  assert.equal(mixed.topNote, 62);
  assert.equal(mixed.rounds, 2);
  assert.equal(mixed.avgCents, 60);
  assert.equal(mixed.lean, -4);
  assert.equal(mixed.steadiness, 7.3);
});

test('B9: previousRunsOf matches by exercise id, newest first, not by name', () => {
  const history = [
    { name: 'Scale', exId: 'a', pct: 90 },
    { name: 'Scale', exId: 'b', pct: 40 },     // a different exercise that happens to share the name
    { name: 'Scale', pct: 30 },                // legacy entry that never got linked
    { name: 'Old name', exId: 'a', pct: 70 },
  ];
  assert.deepEqual(previousRunsOf(history, { id: 'a', name: 'Scale' }).map((e) => e.pct), [90, 70]);
  assert.deepEqual(previousRunsOf(history, { id: 'zzz', name: 'Scale' }), []);
  assert.deepEqual(previousRunsOf(history, { name: 'Scale' }), [], 'an exercise without an id matches nothing');
});

test('B9: renaming an exercise keeps its history; deleting it leaves the entries in place', () => {
  const exercise = { id: 'a', name: 'Five-note scale' };
  let history = addToHistory([], historyEntry(exercise, runOf('scale', Object.keys(SINGER_SCENARIOS)[0]).summary, NOW));
  const renamed = { ...exercise, name: 'Warm-up scale' };
  assert.equal(previousRunsOf(history, renamed).length, 1);
  // After the exercise is deleted the entries remain (they still count in the journey).
  assert.equal(history.length, 1);
});

test('the history keeps the newest 200 entries', () => {
  let history = [];
  for (let i = 0; i < MAX_HISTORY + 15; i++) history = addToHistory(history, { name: 'x', pct: i });
  assert.equal(history.length, 200);
  assert.equal(history[0].pct, 214);
  assert.equal(history[199].pct, 15);
});

test('old entries without the new fields still work everywhere that reads history', async () => {
  const { journeyStats } = await import('../js/ui/library.js');
  const legacy = [{ name: 'Scale', exId: 'a', pct: 60, ts: NOW.getTime(), date: 'Nov 27' }];
  assert.equal(previousRunsOf(legacy, { id: 'a' })[0].pct, 60);
  assert.equal(journeyStats(legacy, NOW.getTime()).sessions, 1);
  const summary = summarizeSession({ ...(() => { const { exercise } = runOf('scale', Object.keys(SINGER_SCENARIOS)[0]); const { targets } = buildSession(exercise, 0); return { targets, frames: singerFrames(targets, SINGER_SCENARIOS[Object.keys(SINGER_SCENARIOS)[0]]) }; })(), voiceLag: 0.15, previousRuns: legacy });
  assert.ok(summary.cheer.length > 0);
});
