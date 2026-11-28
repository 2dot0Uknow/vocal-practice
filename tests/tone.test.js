// A3: tone as a trend against the singer's own history for the same exercise + sound; narrow-band input hides tone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTone, mainSound, baselineLabel, isNarrowBand, CLARITY_BAND, CLARITY_WORDS, RING_WORDS, BASELINE_WINDOW } from '../js/tone.js';
import { summarizeSession } from '../js/scoring.js';
import { historyEntry } from '../js/history.js';
import { buildSession, normEx } from '../js/exercise.js';
import { singerFrames } from './helpers/signals.js';
import { SESSION_EXERCISES } from './tools/cases.mjs';

const run = (clarity, ring, sound = 'ah', pct = 80) => ({ pct, clarity, ring, sound });
const three = (clarity = 0.9, ring = 0.1) => [run(clarity, ring), run(clarity, ring), run(clarity, ring)];

test('mainSound: most common syllable, first wins a tie, empty when none', () => {
  assert.equal(mainSound([{ syl: 'ah' }, { syl: 'ah' }, { syl: 'ee' }]), 'ah');
  assert.equal(mainSound([{ syl: 'ee' }, { syl: 'ah' }]), 'ee');
  assert.equal(mainSound([{ syl: '' }, {}]), '');
  assert.equal(mainSound([]), '');
});

test('compareTone: not ready until three earlier runs of the same sound', () => {
  assert.deepEqual(compareTone({ previousRuns: [], sound: 'ah', clarity: 0.9, ring: 0.1 }), { ready: false, count: 0 });
  assert.equal(compareTone({ previousRuns: three().slice(0, 2), sound: 'ah', clarity: 0.9, ring: 0.1 }).ready, false);
  assert.equal(compareTone({ previousRuns: three(), sound: 'ah', clarity: 0.9, ring: 0.1 }).ready, true);
});

test('compareTone: other sounds, old entries (no sound) and entries without tone do not count', () => {
  const mixed = [run(0.9, 0.1, 'oo'), { pct: 70, clarity: 0.9, ring: 0.1 }, run(null, null), run(0.9, 0.1), run(0.9, 0.1)];
  assert.equal(compareTone({ previousRuns: mixed, sound: 'ah', clarity: 0.9, ring: 0.1 }).count, 2);
  assert.equal(compareTone({ previousRuns: mixed, sound: 'ah', clarity: 0.9, ring: 0.1 }).ready, false);
  // No sound at all ('') matches only entries saved with sound '' (never old entries).
  assert.equal(compareTone({ previousRuns: [run(0.9, 0.1, ''), run(0.9, 0.1, ''), run(0.9, 0.1, '')], sound: '', clarity: 0.9, ring: 0.1 }).ready, true);
  assert.equal(compareTone({ previousRuns: [{ pct: 1, clarity: 0.9, ring: 0.1 }, { pct: 1, clarity: 0.9, ring: 0.1 }, { pct: 1, clarity: 0.9, ring: 0.1 }], sound: '', clarity: 0.9, ring: 0.1 }).ready, false);
});

test('compareTone: clarity thresholds (average 0.90, band 0.025)', () => {
  const trend = (clarity) => compareTone({ previousRuns: three(0.9, 0.1), sound: 'ah', clarity, ring: 0.1 }).clarityTrend;
  assert.equal(trend(0.9), 'usual');
  assert.equal(trend(0.9 + CLARITY_BAND - 0.001), 'usual');
  assert.equal(trend(0.9 - CLARITY_BAND + 0.001), 'usual');
  assert.equal(trend(0.9 + CLARITY_BAND + 0.001), 'clearer');
  assert.equal(trend(0.9 - CLARITY_BAND - 0.001), 'airier');
});

test('compareTone: ring thresholds are relative to the average (25%, at least 0.015)', () => {
  const trend = (ring, average = 0.1) => compareTone({ previousRuns: three(0.9, average), sound: 'ah', clarity: 0.9, ring }).ringTrend;
  assert.equal(trend(0.1), 'usual');
  assert.equal(trend(0.12), 'usual');
  assert.equal(trend(0.13), 'brighter');
  assert.equal(trend(0.07), 'softer');
  assert.equal(trend(0.08), 'usual');
  // A very low average: the 0.015 floor stops tiny wobbles counting.
  assert.equal(trend(0.03, 0.02), 'usual');
  assert.equal(trend(0.04, 0.02), 'brighter');
});

test('compareTone: only the newest ten runs form the baseline', () => {
  const old = Array.from({ length: 5 }, () => run(0.7, 0.1));
  const recent = Array.from({ length: BASELINE_WINDOW }, () => run(0.9, 0.1));
  const result = compareTone({ previousRuns: [...recent, ...old], sound: 'ah', clarity: 0.9, ring: 0.1 });
  assert.equal(result.count, BASELINE_WINDOW);
  assert.ok(Math.abs(result.clarityAverage - 0.9) < 1e-12);
});

test('labels: wording', () => {
  assert.deepEqual(CLARITY_WORDS, { clearer: 'a little clearer than usual', usual: 'about your usual', airier: 'a little airier than usual' });
  assert.deepEqual(RING_WORDS, { brighter: 'brighter than usual', usual: 'about your usual', softer: 'softer than usual' });
  assert.equal(baselineLabel(0, true), 'Getting a baseline (1 of 3)');
  assert.equal(baselineLabel(2, true), 'Getting a baseline (3 of 3)');
  assert.equal(baselineLabel(2, false), 'Getting a baseline (2 of 3)');
  assert.equal(baselineLabel(0, false), 'Getting a baseline (0 of 3)');
});

test('isNarrowBand: sample rate at or below 16 kHz, or no energy above 4 kHz over enough readings', () => {
  assert.equal(isNarrowBand({ sampleRate: 16000 }), true);
  assert.equal(isNarrowBand({ sampleRate: 8000 }), true);
  assert.equal(isNarrowBand({ sampleRate: 48000 }), false);
  assert.equal(isNarrowBand({}), false);
  const readings = (value, count = 40) => Array.from({ length: count }, () => value);
  assert.equal(isNarrowBand({ sampleRate: 48000, highBandRatios: readings(1e-8) }), true);
  assert.equal(isNarrowBand({ sampleRate: 48000, highBandRatios: readings(1e-3) }), false);
  assert.equal(isNarrowBand({ sampleRate: 48000, highBandRatios: readings(1e-8, 10) }), false, 'too few readings to decide');
  assert.equal(isNarrowBand({ highBandRatios: [...readings(1e-8, 10), ...readings(1e-3, 30)] }), false, 'the median decides');
});

// Summary integration -------------------------------------------------------------------------------------------

const exercise = normEx(SESSION_EXERCISES.scale);
const { targets } = buildSession(exercise, 0);
const frames = singerFrames(targets, { lag: 0, wobbleCents: 3, clarity: 0.9, ring: 0.1, seed: 4 });
const toneRows = (summary) => summary.rows.filter((row) => row.name === 'Clear tone' || row.name === 'Ring');
const TONE_TIP = /airy side|warm and soft/;

test('A3: no baseline yet: neutral label with a count, no tone tips (even for a very airy, soft sound)', () => {
  const airy = singerFrames(targets, { lag: 0, wobbleCents: 3, clarity: 0.7, ring: 0.01, seed: 4 });
  for (const previousRuns of [[], [run(0.9, 0.1, 'ah')], [run(0.9, 0.1, 'ah'), run(0.9, 0.1, 'ah')]]) {
    const summary = summarizeSession({ targets, frames: airy, voiceLag: 0, previousRuns });
    assert.deepEqual(toneRows(summary).map((row) => row.label), Array(2).fill(`Getting a baseline (${previousRuns.length + 1} of 3)`));
    assert.ok(!summary.tips.some((tip) => TONE_TIP.test(tip)));
  }
});

test('A3: with three earlier runs of the same sound, the rows are trends and an airier day gets the tip', () => {
  const usual = summarizeSession({ targets, frames, voiceLag: 0, previousRuns: three(0.9, 0.1) });
  assert.equal(usual.sound, 'ah');
  assert.deepEqual(toneRows(usual).map((row) => row.label), ['about your usual', 'about your usual']);
  const clearer = summarizeSession({ targets, frames: singerFrames(targets, { lag: 0, clarity: 0.95, ring: 0.2, seed: 4 }), voiceLag: 0, previousRuns: three(0.9, 0.1) });
  assert.deepEqual(toneRows(clearer).map((row) => row.label), ['a little clearer than usual', 'brighter than usual']);
  const airier = summarizeSession({ targets, frames: singerFrames(targets, { lag: 0, clarity: 0.8, ring: 0.05, seed: 4 }), voiceLag: 0, previousRuns: three(0.9, 0.1), });
  assert.deepEqual(toneRows(airier).map((row) => row.label), ['a little airier than usual', 'softer than usual']);
  assert.ok(airier.tips.some((tip) => /airy side/.test(tip)) || airier.tips.some((tip) => /warm and soft/.test(tip)), 'tone tips appear on a worse-than-usual day');
  assert.ok(!usual.tips.some((tip) => TONE_TIP.test(tip)), 'no tone tip on a usual day');
});

test('A3: earlier runs on a different sound do not form the baseline', () => {
  const summary = summarizeSession({ targets, frames, voiceLag: 0, previousRuns: [run(0.9, 0.1, 'oo'), run(0.9, 0.1, 'oo'), run(0.9, 0.1, 'oo')] });
  assert.match(toneRows(summary)[0].label, /^Getting a baseline \(1 of 3\)$/);
});

test('A3: narrow-band input hides the tone rows, the tone tips and the tone praise, and shows nothing alarming', () => {
  const airy = singerFrames(targets, { lag: 0, wobbleCents: 3, clarity: 0.7, ring: 0.01, seed: 4 });
  const summary = summarizeSession({ targets, frames: airy, voiceLag: 0, previousRuns: three(0.95, 0.2), narrowBand: true });
  assert.equal(toneRows(summary).length, 0);
  assert.equal(summary.toneHidden, true);
  assert.ok(!summary.tips.some((tip) => TONE_TIP.test(tip)));
  assert.ok(!summary.good.some((line) => /tone/.test(line)));
  assert.deepEqual(summary.rows.map((row) => row.name), ['Pitch accuracy', 'Steadiness', 'Notes held']);
  // Pitch is unaffected.
  assert.equal(summary.pct, summarizeSession({ targets, frames: airy, voiceLag: 0, previousRuns: [] }).pct);
});

test('A3: history stores the sound, and stores no tone numbers for a narrow-band run', () => {
  const ex = { ...exercise, id: 'e1' };
  const normal = summarizeSession({ targets, frames, voiceLag: 0, previousRuns: [] });
  const entry = historyEntry(ex, normal, new Date(2026, 10, 27));
  assert.equal(entry.sound, 'ah');
  assert.equal(typeof entry.clarity, 'number');
  const narrow = historyEntry(ex, summarizeSession({ targets, frames, voiceLag: 0, previousRuns: [], narrowBand: true }), new Date(2026, 10, 27));
  assert.equal(narrow.clarity, null);
  assert.equal(narrow.ring, null);
  assert.equal(narrow.sound, 'ah');
  // The entries it saves feed the next baseline.
  const next = summarizeSession({ targets, frames, voiceLag: 0, previousRuns: [entry, entry, entry] });
  assert.equal(toneRows(next)[0].label, 'about your usual');
});

test('A2: the report says the score may be generous only when the piano was heard', () => {
  assert.equal(summarizeSession({ targets, frames, voiceLag: 0, previousRuns: [] }).leakNote, '');
  assert.equal(summarizeSession({ targets, frames, voiceLag: 0, previousRuns: [], pianoLeak: true }).leakNote, 'Your score may be a little generous this time. I could hear the piano through the mic.');
});
