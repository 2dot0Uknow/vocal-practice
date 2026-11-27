// B1-B3, B10: the session state machine, what ending a session means, and the mic failure wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionMachine, completedRounds, decideEnd, reportTitle, classifyMicError, MIC_MESSAGES } from '../js/session.js';
import { summarizeSession, scoreNotes, PARTIAL_CHEER } from '../js/scoring.js';
import { buildSession, normEx } from '../js/exercise.js';
import { singerFrames } from './helpers/signals.js';

// 3 rounds (C3, C#3, D3) of 1-3-5 with two sounds, so each round has two passes. Time starts at 0.
const exercise = normEx({ id: 'x', name: 'Test', pat: '1-3-5', vows: ['ah', 'ee'], start: 48, end: 50, bpm: 120, hold: 2 });
const { targets } = buildSession(exercise, 0);
const roundEnd = (round) => Math.max(...targets.filter((t) => t.round === round).map((t) => t.t1));
const perfectFrames = () => singerFrames(targets, { lag: 0, offsetCents: 0, wobbleCents: 0, seed: 1 });

test('the session machine allows only idle > starting > running > stopping > idle (and a cancelled start)', () => {
  const machine = createSessionMachine();
  assert.equal(machine.state, 'idle');
  assert.equal(machine.can('running'), false);
  machine.go('starting');
  assert.equal(machine.can('starting'), false, 'a second Start tap must be refused while starting');
  assert.throws(() => machine.go('starting'));
  machine.go('running');
  assert.throws(() => machine.go('idle'), /cannot go/);
  machine.go('stopping');
  machine.go('idle');
  machine.go('starting');
  machine.go('idle'); // start cancelled before it got going
  assert.equal(machine.state, 'idle');
});

test('completedRounds counts only unbroken, fully ended rounds (every pass)', () => {
  assert.equal(completedRounds(targets, 0), 0);
  assert.equal(completedRounds(targets, roundEnd(0) - 0.01), 0, 'last note of round 1 not over yet');
  assert.equal(completedRounds(targets, roundEnd(0) + 0.01), 1);
  assert.equal(completedRounds(targets, roundEnd(1) + 0.01), 2);
  assert.equal(completedRounds(targets, 1e6), 3);
  assert.equal(completedRounds([], 100), 0);
  // The first sound pass of round 1 being over is not enough.
  const firstPassEnd = Math.max(...targets.filter((t) => t.round === 0 && t.pass === 0).map((t) => t.t1));
  assert.ok(firstPassEnd < roundEnd(0));
  assert.equal(completedRounds(targets, firstPassEnd + 0.01), 0);
});

test('decideEnd: a finished run is reported and saved with every note', () => {
  const decision = decideEnd({ reason: 'finished', songTime: 1e6, targets });
  assert.deepEqual({ ...decision, scoredTargets: decision.scoredTargets.length }, { showReport: true, save: true, partial: false, scoredTargets: targets.length, lastRound: 3 });
});

for (const reason of ['stopped', 'hidden']) {
  test(`decideEnd (${reason}): under one round there is no report`, () => {
    const decision = decideEnd({ reason, songTime: roundEnd(0) - 0.05, targets });
    assert.equal(decision.showReport, false);
    assert.equal(decision.save, false);
    assert.equal(decision.lastRound, 0);
    assert.equal(decideEnd({ reason, songTime: null, targets }).showReport, false);
  });

  test(`decideEnd (${reason}): after a round, report only the finished notes and never save`, () => {
    const stopAt = roundEnd(1) + 0.4; // two rounds done, partway into round 3's cue/first note
    const decision = decideEnd({ reason, songTime: stopAt, targets });
    assert.equal(decision.showReport, true);
    assert.equal(decision.save, false, 'stopped runs are never saved to history');
    assert.equal(decision.partial, true);
    assert.equal(decision.lastRound, 2);
    assert.ok(decision.scoredTargets.length > 0);
    assert.ok(decision.scoredTargets.every((t) => t.t1 < stopAt));
    const expected = targets.filter((t) => t.t1 < stopAt).length;
    assert.equal(decision.scoredTargets.length, expected);
  });
}

test('decideEnd: notes of the next round that already finished are scored too (t1 before the stop time)', () => {
  const nextRoundFirst = targets.find((t) => t.round === 1);
  const stopAt = nextRoundFirst.t1 + 0.01;
  const decision = decideEnd({ reason: 'stopped', songTime: stopAt, targets });
  assert.equal(decision.lastRound, 1);
  assert.ok(decision.scoredTargets.includes(nextRoundFirst));
  assert.equal(decision.scoredTargets.filter((t) => t.round === 1).length, 1);
});

test('reportTitle names the round a stopped run reached', () => {
  assert.equal(reportTitle('Test', { partial: false, lastRound: 3 }), 'Test');
  assert.equal(reportTitle('Test', { partial: true, lastRound: 2 }), 'Test · Stopped after round 2');
});

test('summarizeSession on a partial run counts only the completed notes and is never saveable', () => {
  const stopAt = roundEnd(0) + 0.01;
  const { scoredTargets } = decideEnd({ reason: 'stopped', songTime: stopAt, targets });
  const frames = perfectFrames().filter((f) => f.t < stopAt);
  const partial = summarizeSession({ targets: scoredTargets, frames, voiceLag: 0.15, previousRuns: [{ pct: 90 }], partial: true });
  assert.equal(partial.total, scoredTargets.length);
  assert.equal(partial.results.length, scoredTargets.length);
  assert.equal(partial.pct, 100, 'percent is of the completed notes, not of the whole exercise');
  assert.equal(partial.saveable, false);
  assert.equal(partial.cheer, PARTIAL_CHEER);
  assert.equal(partial.cheer, 'Partial run. Not saved to your journey.');
  // Scoring all targets against the same cut-off frames would drag the percentage down: that is what the subset avoids.
  const naive = summarizeSession({ targets, frames, voiceLag: 0.15, previousRuns: [] });
  assert.ok(naive.pct < 50);
});

test('summarizeSession: the same notes score the same whether or not the run was partial; only cheer and saveable differ', () => {
  const subset = targets.filter((t) => t.round === 0);
  const frames = perfectFrames();
  const full = summarizeSession({ targets: subset, frames, voiceLag: 0.15, previousRuns: [{ pct: 40 }] });
  const partial = summarizeSession({ targets: subset, frames, voiceLag: 0.15, previousRuns: [{ pct: 40 }], partial: true });
  assert.equal(partial.pct, full.pct);
  assert.deepEqual(partial.rows, full.rows);
  assert.notEqual(partial.cheer, full.cheer);
  assert.equal(full.saveable, true);
  assert.equal(partial.saveable, false);
});

test('a partial run counts a silent completed note as missed, not a skipped one', () => {
  const stopAt = roundEnd(0) + 0.01;
  const { scoredTargets } = decideEnd({ reason: 'hidden', songTime: stopAt, targets });
  const frames = perfectFrames().filter((f) => f.t < stopAt && !(f.t >= scoredTargets[0].t0 && f.t < scoredTargets[0].t1));
  const partial = summarizeSession({ targets: scoredTargets, frames, voiceLag: 0, previousRuns: [], partial: true });
  assert.equal(partial.missCount, 1);
  assert.equal(partial.total, scoredTargets.length);
  assert.ok(scoreNotes(scoredTargets, frames)[0].miss);
});

test('classifyMicError tells permission, missing mic and other errors apart', () => {
  assert.equal(classifyMicError({ name: 'NotAllowedError' }), 'denied');
  assert.equal(classifyMicError({ name: 'SecurityError' }), 'denied');
  assert.equal(classifyMicError({ name: 'NotFoundError' }), 'notfound');
  assert.equal(classifyMicError({ name: 'OverconstrainedError' }), 'notfound');
  assert.equal(classifyMicError({ name: 'NotReadableError' }), 'other');
  assert.equal(classifyMicError(new Error('boom')), 'other');
  assert.equal(classifyMicError(undefined), 'other');
});

test('mic messages: friendly wording for each reason, and the https message is kept', () => {
  assert.match(MIC_MESSAGES.denied, /lock icon/);
  assert.match(MIC_MESSAGES.notfound, /couldn't find a microphone/);
  assert.match(MIC_MESSAGES.insecure, /https:\/\//);
  for (const text of Object.values(MIC_MESSAGES)) assert.match(text, /\.$/);
  assert.ok(MIC_MESSAGES.other.length > 10);
});
