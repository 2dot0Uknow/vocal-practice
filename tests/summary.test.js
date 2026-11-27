// The session report. The original report() wrote straight into the page; its output was captured
// through a fake DOM (tests/tools/generate-expected.mjs). summarizeSession() + the HTML builders in
// ui/report.js must reproduce every captured string exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSession, activeAt } from '../js/scoring.js';
import { buildSession, normEx, describeExercise } from '../js/exercise.js';
import { statRowsHTML, listItemsHTML, noteStripsHTML } from '../js/ui/report.js';
import { journeyStats } from '../js/ui/library.js';
import { fixture, assertSame } from './helpers/fixture.js';
import { singerFrames } from './helpers/signals.js';
import { SESSION_EXERCISES, SINGER_SCENARIOS } from './tools/cases.mjs';

function summaryFor(entry) {
  const exercise = normEx(SESSION_EXERCISES[entry.key]);
  const { targets } = buildSession(exercise, 0);
  let frames = singerFrames(targets, SINGER_SCENARIOS[entry.scenarioName]);
  if (entry.silent) frames = frames.map((f) => ({ t: f.t, m: null, tr: false }));
  const summary = summarizeSession({ targets, frames, voiceLag: entry.voiceLagIn, previousRuns: entry.previousRuns });
  return { exercise, summary };
}

test('there are enough captured report scenarios', () => {
  assert.ok(fixture.report.length >= 18);
});

for (const entry of fixture.report) {
  test(`report content matches the original: ${entry.key} / ${entry.scenarioName}${entry.silent ? ' (silent)' : ''}${entry.previousRuns.length ? ` (${entry.previousRuns.length} earlier)` : ''}`, () => {
    const { exercise, summary } = summaryFor(entry);
    const nodes = entry.nodes;
    assert.equal(summary.pct + '%', nodes.sPct.textContent);
    assert.equal(summary.subtitle, nodes.sSub.textContent);
    assert.equal(summary.cheer, nodes.cheer.textContent);
    assert.equal(statRowsHTML(summary.rows), nodes.stats.innerHTML);
    assert.equal(listItemsHTML(summary.tips), nodes.tips.innerHTML);
    assert.equal(listItemsHTML(summary.good), nodes.good.innerHTML);
    // B7: the original app only spelled sharps, so the pinned cells are rendered with spell '#' (exercises now default to auto).
    assert.equal(noteStripsHTML(summary.results, { ...exercise, spell: '#' }), nodes.notesOut.innerHTML);
    assert.equal(!summary.hasTrillNotes, nodes.trNote.hidden);
    assertSame(summary.voiceLag, entry.voiceLagOut, 'voice lag');
    assert.equal(summary.saveable, entry.savedEntry !== null);
    if (entry.savedEntry) assert.equal(summary.pct, entry.savedEntry.pct);
  });
}

test('summarizeSession returns plain data (numbers, strings, arrays) and caps tips at 2 and good at 4', () => {
  for (const entry of fixture.report) {
    const { summary } = summaryFor(entry);
    assert.ok(summary.tips.length >= 1 && summary.tips.length <= 2);
    assert.ok(summary.good.length >= 1 && summary.good.length <= 4);
    assert.ok(Number.isInteger(summary.pct) && summary.pct >= 0 && summary.pct <= 100);
    assert.doesNotThrow(() => JSON.stringify(summary));
    for (const row of summary.rows) assert.ok(row.name && typeof row.label === 'string' && row.value >= 0 && row.value <= 100);
  }
});

test('summarizeSession: nobody sang -> encouraging copy, nothing to save, voice lag unchanged', () => {
  const entry = fixture.report.find((r) => r.silent && r.key === 'scale');
  const { summary } = summaryFor(entry);
  assert.equal(summary.pct, 0);
  assert.equal(summary.saveable, false);
  assert.equal(summary.voiceLag, 0.15);
  assert.equal(summary.subtitle, "Didn't hear you this time");
  assert.deepEqual(summary.good, ['You showed up to practise. That counts.']);
});

test('journeyStats: sessions, this week and the day streak', () => {
  const day = 864e5;
  const now = new Date(2026, 10, 27, 12, 0).getTime();
  const history = [
    { ts: now - 1000 }, { ts: now - day }, { ts: now - 2 * day }, { ts: now - 4 * day }, { ts: now - 10 * day }, { name: 'old entry without ts' },
  ];
  assert.deepEqual(journeyStats(history, now), { sessions: 6, thisWeek: 4, streak: 3 });
  // Nothing yet today: yesterday still keeps the streak alive.
  assert.equal(journeyStats([{ ts: now - day }, { ts: now - 2 * day }], now).streak, 2);
  assert.equal(journeyStats([{ ts: now - 3 * day }], now).streak, 0);
  assert.deepEqual(journeyStats([], now), { sessions: 0, thisWeek: 0, streak: 0 });
});

test('activeAt allows 0.15 s of grace after a note ends', () => {
  const { targets } = buildSession(normEx(SESSION_EXERCISES.scale), 0);
  const first = targets[0];
  assert.equal(activeAt(targets, first.t0), first);
  assert.equal(activeAt(targets, first.t1 + 0.1), first);
  assert.notEqual(activeAt(targets, first.t1 + 0.16), first);
  assert.equal(activeAt(targets, -1), undefined);
});

test('describeExercise matches the library text', () => {
  assert.equal(describeExercise(normEx({ pat: '1-3-5~', vows: ['ah', 'oo'], rootVow: 'ee', start: 48, end: 55, top: true, bpm: 100 })), '1 3 5~ · ah / oo (root: ee) · C3–G3 range · 100 bpm');
  assert.equal(describeExercise(normEx({ pat: '1-3-5~', start: 48, end: 55 })), '1 3 5~ · C3–G3 · 90 bpm');
});

test('B7: describeExercise uses the exercise spelling (auto: Eb, F#; saved: as written)', () => {
  const base = { pat: '1-3-5~', start: 51, end: 54 };
  assert.equal(describeExercise(normEx(base)), '1 3 5~ · Eb3–F#3 · 90 bpm');
  assert.equal(describeExercise(normEx({ ...base, spell: '#' })), '1 3 5~ · D#3–F#3 · 90 bpm');
  assert.equal(describeExercise(normEx({ ...base, spell: 'b' })), '1 3 5~ · Eb3–Gb3 · 90 bpm');
});

test('B7: report note cells follow the exercise spelling', () => {
  const results = [{ round: 0, pass: 0, m: 51, med: 3, miss: false }, { round: 0, pass: 0, m: 54, med: -4, miss: false }];
  const names = (exercise) => [...noteStripsHTML(results, exercise).matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(names(normEx({ pat: '1-3', start: 48, end: 50 })), ['Eb3', 'F#3'], 'auto');
  assert.deepEqual(names(normEx({ pat: '1-3', start: 48, end: 50, spell: 'b' })), ['Eb3', 'Gb3']);
  assert.deepEqual(names(normEx({ pat: '1-3', start: 48, end: 50, spell: '#' })), ['D#3', 'F#3']);
});
