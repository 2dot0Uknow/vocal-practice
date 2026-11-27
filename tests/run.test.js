// F1: Pause / Again / Skip as state transitions of a run, and what each does to scoring. Pure: a fake clock, no audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, RESUME_GAP, RESTART_GAP, END_PAD } from '../js/run.js';
import { planRounds, normEx } from '../js/exercise.js';
import { scoreNotes, summarizeSession, scoringTail } from '../js/scoring.js';
import { completedRounds, decideEnd, reportTitle } from '../js/session.js';
import { singerFrames } from './helpers/signals.js';

// 4 rounds of 1-3-5 at 120 bpm (a beat is 0.5 s): a round is 2 + 1.5 + 0.5 = 4 s with its cue chord, so rounds start at 0, 4, 8, 12.
const exercise = normEx({ id: 'x', name: 'Test', pat: '1-3-5', vows: ['ah'], start: 48, end: 51, bpm: 120, hold: 2 });
const HORIZON = 4.5;
const newRun = () => {
  const run = createRun(planRounds(exercise));
  run.start(0);
  return run;
};
const roundsOf = (run) => [...new Set(run.targets().map((t) => t.round))];
const startsOf = (run) => run.rounds.map((r) => [r.index, r.start]);

test('a run starts with round 1 only, then places rounds as they come within the horizon', () => {
  const run = newRun();
  assert.equal(run.phase, 'running');
  assert.deepEqual(startsOf(run), [[0, 0]]);
  assert.equal(run.advance(0, HORIZON).placed.length, 1, 'round 2 starts at 4, inside 0 + 4.5');
  assert.deepEqual(startsOf(run), [[0, 0], [1, 4]]);
  assert.equal(run.advance(3, HORIZON).placed.length, 0, 'round 3 starts at 8, beyond 3 + 4.5');
  assert.equal(run.advance(3.5, HORIZON).placed.length, 1, 'round 3 starts at 8, inside 3.5 + 4.5');
  assert.equal(run.advance(3.5, HORIZON).placed.length, 0, 'nothing more until the clock moves');
  run.advance(100, HORIZON);
  assert.deepEqual(startsOf(run).map(([i]) => i), [0, 1, 2, 3]);
  assert.equal(run.total, 4);
  assert.throws(() => run.start(0), /already started/);
});

test('the run ends END_PAD after the last round, and not before every round is placed', () => {
  const run = newRun();
  assert.equal(run.endTime(), Infinity);
  run.advance(100, HORIZON);
  assert.equal(run.endTime(), 16 + END_PAD);
  assert.equal(run.finishedBy(16.3), false);
  assert.equal(run.finishedBy(16.31), true);
});

test('currentIndex: the lead-in counts as round 1, then the last round that has started', () => {
  const run = newRun();
  run.advance(0, HORIZON);
  assert.equal(run.currentIndex(-0.5), 0);
  assert.equal(run.currentIndex(3.99), 0);
  assert.equal(run.currentIndex(4), 1);
  assert.equal(createRun(planRounds(exercise)).currentIndex(0), -1, 'nothing placed yet');
});

// ---- Pause ----

test('Pause takes effect at the end of the current round: the next round placed ahead is taken back', () => {
  const run = newRun();
  run.advance(1, HORIZON);   // round 2 (starts at 4) is inside 1 + 4.5; round 3 (8) is not
  assert.deepEqual(startsOf(run), [[0, 0], [1, 4]]);
  const { pending, withdrawn } = run.requestPause(1);
  assert.equal(pending, true);
  assert.deepEqual(withdrawn.map((r) => r.index), [1]);
  assert.equal(run.pausePending, true);
  assert.deepEqual(roundsOf(run), [0], "round 2's notes are gone from the live targets");
  // While waiting, nothing new is placed and the round plays on.
  assert.deepEqual(run.advance(3.9, HORIZON), { placed: [], held: false });
  assert.equal(run.phase, 'running');
  // At the boundary the run holds.
  const boundary = run.advance(4, HORIZON);
  assert.deepEqual(boundary, { placed: [], held: true });
  assert.equal(run.phase, 'held');
  assert.equal(run.heldAt, 4);
  assert.equal(run.pausePending, false);
  assert.deepEqual(run.advance(50, HORIZON), { placed: [], held: false }, 'nothing is scheduled while paused');
  assert.deepEqual(roundsOf(run), [0]);
  assert.equal(run.endTime(), Infinity, 'a paused run is not over');
});

test('Resume starts the next round with its cue chord RESUME_GAP later, and the clock carries on from there (the pause is a gap)', () => {
  const run = newRun();
  run.advance(1, HORIZON);
  run.requestPause(1);
  run.advance(4, HORIZON);
  const { placed } = run.resume(20);
  assert.equal(placed.index, 1);
  assert.equal(placed.start, 20 + RESUME_GAP);
  assert.deepEqual(placed.plays[0].m, [49, 53, 56], 'it begins with the cue chord');
  assert.equal(placed.plays[0].t, placed.start);
  assert.equal(run.phase, 'running');
  assert.equal(run.heldAt, null);
  // The targets carry absolute times: round 1 as it was, round 2 after the gap.
  const targets = run.targets();
  assert.equal(targets[0].t0, 2, 'round 1 untouched');
  assert.equal(targets.find((t) => t.round === 1).t0, 20.6 + 2);
  // Later rounds follow back to back from the resumed round.
  run.advance(21, HORIZON);
  assert.deepEqual(startsOf(run).slice(1), [[1, 20.6], [2, 24.6]]);
  assert.deepEqual(run.resume(30), { placed: null }, 'resume when not held does nothing');
});

test('Pause tapped a second time cancels a pause that has not happened yet', () => {
  const run = newRun();
  run.advance(1, HORIZON);
  run.requestPause(1);
  assert.equal(run.requestPause(2).pending, false);
  assert.equal(run.pausePending, false);
  assert.equal(run.advance(2, HORIZON).placed.length, 1, 'the next round is placed again');
  assert.deepEqual(run.advance(4, HORIZON).held, false);
});

test('Pause during the last round does nothing (the run just ends)', () => {
  const run = newRun();
  run.advance(100, HORIZON);
  assert.equal(run.canPause(12.5), false);
  assert.equal(run.canPause(3), true);
  assert.equal(run.requestPause(12.5).pending, false);
  assert.equal(run.pausePending, false);
});

test('Pause is only possible while running, and Again / Skip do nothing while held', () => {
  const run = newRun();
  run.advance(1, HORIZON);
  run.requestPause(1);
  run.advance(4, HORIZON);
  assert.equal(run.canPause(5), false, 'held: the button says Resume');
  assert.equal(run.again(5), null);
  assert.equal(run.skip(5), null);
  assert.equal(run.requestPause(5).pending, false);
});

// ---- Again ----

test('Again replays the current round from its cue chord right away and drops the attempt in progress', () => {
  const run = newRun();
  run.advance(5, HORIZON);   // rounds 1, 2 placed (starts 4, 8)
  const result = run.again(5);
  assert.equal(result.discardFrom, 4, 'frames recorded since this round began are to be dropped');
  assert.deepEqual(result.withdrawn.map((r) => r.index), [1, 2]);
  assert.equal(result.placed.index, 1);
  assert.equal(result.placed.start, 5 + RESTART_GAP);
  assert.deepEqual(result.placed.plays[0].m, [49, 53, 56]);
  assert.equal(result.placed.placement, 2);
  assert.deepEqual(startsOf(run), [[0, 0], [1, 5.15]]);
  // Only one attempt of the round is live.
  assert.equal(run.targets().filter((t) => t.round === 1).length, 3);
  // Later rounds follow the replayed one.
  run.advance(6, HORIZON);
  assert.deepEqual(startsOf(run), [[0, 0], [1, 5.15], [2, 9.15]]);
});

test('Again twice in a row keeps just the last attempt, and Again in the lead-in re-places round 1', () => {
  const run = newRun();
  run.advance(6, HORIZON);
  run.again(6);
  run.again(6.5);
  assert.deepEqual(startsOf(run).filter(([i]) => i === 1), [[1, 6.65]]);
  const early = newRun();
  early.advance(0, HORIZON);
  const result = early.again(0.2);
  assert.equal(result.placed.index, 0);
  assert.equal(result.discardFrom, 0);
  assert.equal(early.rounds[0].start, 0.2 + RESTART_GAP);
});

test('Again with a pause waiting: the replayed round is played, then the run holds', () => {
  const run = newRun();
  run.advance(5, HORIZON);
  run.requestPause(5);
  run.again(6);
  assert.equal(run.pausePending, true);
  assert.deepEqual(run.advance(8, HORIZON).placed, [], 'still nothing beyond the replayed round');
  const end = run.rounds[run.rounds.length - 1].end;
  assert.equal(run.advance(end, HORIZON).held, true);
});

test('Again on the last round re-places it and the run still ends after it', () => {
  const run = newRun();
  run.advance(100, HORIZON);
  run.again(13);
  assert.equal(run.rounds[run.rounds.length - 1].index, 3);
  assert.equal(run.endTime(), 13.15 + 4 + END_PAD);
});

// ---- Skip ----

test('Skip ends the current round now: the next round starts with its cue chord, the skipped round is not scored', () => {
  const run = newRun();
  run.advance(5, HORIZON);
  const result = run.skip(5);
  assert.deepEqual(result.withdrawn.map((r) => r.index), [1, 2]);
  assert.equal(result.discardFrom, 4);
  assert.equal(result.placed.index, 2);
  assert.equal(result.placed.start, 5 + RESTART_GAP);
  assert.equal(result.last, false);
  assert.equal(result.sung, true);
  assert.deepEqual(roundsOf(run), [0, 2], 'round 2 (index 1) is gone');
  run.advance(6, HORIZON);
  assert.deepEqual(startsOf(run), [[0, 0], [2, 5.15], [3, 9.15]]);
});

test('Skip with a pause waiting holds right away; Resume then starts the round after the skipped one', () => {
  const run = newRun();
  run.advance(5, HORIZON);
  run.requestPause(5);
  const result = run.skip(6);
  assert.equal(result.held, true);
  assert.equal(result.placed, null);
  assert.equal(run.phase, 'held');
  assert.equal(run.heldAt, 6);
  const { placed } = run.resume(10);
  assert.equal(placed.index, 2);
  assert.equal(placed.start, 10.6);
});

test('Skipping the last round ends the run: finished when something was sung, nothing sung otherwise', () => {
  const run = newRun();
  run.advance(100, HORIZON);
  const result = run.skip(13);
  assert.equal(result.last, true);
  assert.equal(result.sung, true);
  assert.equal(run.phase, 'done');
  assert.deepEqual(roundsOf(run), [0, 1, 2]);
  assert.equal(run.endTime(), 13, 'rounds 1 to 3 ended long ago: no reason to wait');
  assert.equal(run.finishedBy(13.01), true);
  assert.equal(run.finishedBy(12.9), false);
  assert.equal(run.advance(20, HORIZON).placed.length, 0);

  // A run of one round: skipping it leaves nothing sung.
  const single = createRun(planRounds(normEx({ ...exercise, start: 48, end: 48 })));
  single.start(0);
  const skipped = single.skip(1);
  assert.equal(skipped.last, true);
  assert.equal(skipped.sung, false);
  assert.deepEqual(single.targets(), []);

  // Skipping everything one by one also leaves nothing.
  const all = newRun();
  all.advance(0, HORIZON);
  let sung = true;
  for (let now = 1; now < 5; now++) sung = all.skip(now)?.sung;
  assert.equal(sung, false);
  assert.equal(all.targets().length, 0);
});

test('skip right after the previous round: the previous round still gets its END_PAD before the run ends', () => {
  const run = newRun();
  run.advance(100, HORIZON);
  const result = run.skip(12.0);   // round 4 begins at 12; round 3 ended at 12
  assert.equal(result.last, true);
  assert.equal(run.endTime(), 12 + END_PAD);
});

// ---- scoring of last attempts / skipped rounds ----

const perfectFor = (targets, lag = 0) => singerFrames(targets, { lag, offsetCents: 0, wobbleCents: 0, seed: 1 });

test('scoring uses the LAST attempt of a round only: the first, badly sung attempt does not count', () => {
  const run = newRun();
  run.advance(1, HORIZON);
  // Round 1 sung flat (-60 cents) up to now = 5, then Again; attempt 2 sung perfectly.
  const firstAttempt = run.targets().filter((t) => t.round === 1);
  const flatFrames = singerFrames(firstAttempt, { lag: 0, offsetCents: -60, wobbleCents: 0, seed: 2 }).filter((f) => f.t < 5.3);
  const again = run.again(5.3);
  const secondAttempt = again.placed.targets;
  assert.equal(secondAttempt[0].t0 > 5.3, true);
  const goodFrames = perfectFor(secondAttempt).filter((f) => f.t >= 5.3);
  const frames = [...flatFrames, ...goodFrames];
  // Even without discarding the old frames, only live targets are scored, so every round-2 note is judged on attempt 2.
  const results = scoreNotes(run.targets().filter((t) => t.round === 1), frames);
  assert.equal(results.length, 3, 'each round counts once');
  assert.ok(results.every((r) => !r.miss && Math.abs(r.med) < 1), JSON.stringify(results.map((r) => r.med)));
  assert.equal(new Set(results.map((r) => r.t0)).size, 3);
});

test('a skipped round is not in the scored targets, so it is not a miss; the other rounds are unaffected', () => {
  const run = newRun();
  run.advance(100, HORIZON);
  run.skip(5);   // round index 1 skipped
  run.advance(20, HORIZON);
  const targets = run.targets();
  assert.deepEqual([...new Set(targets.map((t) => t.round))], [0, 2, 3]);
  const frames = perfectFor(targets);
  const summary = summarizeSession({ targets, frames, voiceLag: 0.15, previousRuns: [] });
  assert.equal(summary.total, 9);
  assert.equal(summary.missCount, 0);
  assert.equal(summary.pct, 100);
  assert.deepEqual([...new Set(summary.results.map((r) => r.round))], [0, 2, 3], 'the report strips never mention round 2');
});

test('a run with a pause gap scores exactly like the same notes without the gap (absolute times)', () => {
  const paused = newRun();
  paused.advance(1, HORIZON);
  paused.requestPause(1);
  paused.advance(4, HORIZON);
  paused.resume(9.4);          // round 2 starts at 10, a 6 s gap
  paused.advance(1000, HORIZON);
  const targets = paused.targets();
  assert.equal(targets.find((t) => t.round === 1).t0, 12);
  const frames = perfectFor(targets, 0.2);
  const summary = summarizeSession({ targets, frames, voiceLag: 0.2, previousRuns: [] });
  assert.equal(summary.pct, 100);
  assert.equal(summary.total, 12);
  assert.ok(Math.abs(summary.voiceLag - 0.2) < 0.021, 'the lag estimator is unaffected by the gap');
});

// ---- decideEnd / completedRounds with the new structure ----

const settled = (targets, round, lag = 0) => Math.max(...targets.filter((t) => t.round === round).map((t) => t.t1 + lag + scoringTail(t)));

test('a stopped run counts the rounds whose last attempt fully finished (replayed rounds included)', () => {
  const run = newRun();
  run.advance(5, HORIZON);
  run.again(5);                   // round 2 replayed: now 5.15 .. 9.15
  run.advance(7, HORIZON);
  const targets = run.targets();
  assert.equal(completedRounds(targets, settled(targets, 0)), 1);
  assert.equal(completedRounds(targets, settled(targets, 1) - 0.01), 1, 'the replayed round is not finished yet');
  assert.equal(completedRounds(targets, settled(targets, 1)), 2);
  const decision = decideEnd({ reason: 'stopped', songTime: settled(targets, 1) + 0.1, targets });
  assert.equal(decision.lastRound, 2);
  assert.equal(reportTitle('Test', decision), 'Test · Stopped after round 2');
  assert.equal(decision.save, false);
  assert.equal(new Set(decision.scoredTargets.map((t) => t.round)).size, 2);
});

test('completedRounds passes over a skipped round instead of stopping there', () => {
  const run = newRun();
  run.advance(100, HORIZON);
  run.skip(5);                    // round index 1 skipped, round index 2 placed at 5.15
  run.advance(7, HORIZON);
  const targets = run.targets();
  assert.equal(completedRounds(targets, settled(targets, 2)), 3, 'rounds 1 and 3 are done; round 2 was skipped');
  assert.equal(completedRounds(targets, settled(targets, 2) - 0.01), 1);
  const decision = decideEnd({ reason: 'hidden', songTime: settled(targets, 2) + 0.2, targets });
  assert.equal(decision.showReport, true);
  assert.equal(decision.lastRound, 3);
  assert.ok(decision.scoredTargets.every((t) => t.round !== 1));
});

test('completedRounds with nothing finished, or no targets, is 0', () => {
  assert.equal(completedRounds([], 100), 0);
  const targets = createRun(planRounds(exercise)).targets();
  assert.equal(completedRounds(targets, 100), 0);
});

test('decideEnd: a run that ended with every round skipped (no targets) shows no report, even as "finished"', () => {
  const decision = decideEnd({ reason: 'finished', songTime: 100, targets: [] });
  assert.equal(decision.showReport, false);
  assert.equal(decision.save, false);
});

test('decideEnd: skipping the last round after singing the others is a finished, saveable run of the rounds that were sung', () => {
  const run = newRun();
  run.advance(100, HORIZON);
  run.skip(5);
  run.advance(20, HORIZON);
  run.skip(13);        // the last round (index 3, started at 9.15); rounds index 0 and 2 stay
  const decision = decideEnd({ reason: 'finished', songTime: 14, targets: run.targets() });
  assert.deepEqual({ showReport: decision.showReport, save: decision.save, partial: decision.partial, lastRound: decision.lastRound }, { showReport: true, save: true, partial: false, lastRound: 3 });
  assert.deepEqual([...new Set(decision.scoredTargets.map((t) => t.round))], [0, 2]);
});

test('a hold at a round boundary does not break completedRounds: stopping while paused counts the finished rounds', () => {
  const run = newRun();
  run.advance(1, HORIZON);
  run.requestPause(1);
  run.advance(4, HORIZON);
  const targets = run.targets();
  assert.equal(completedRounds(targets, 4 + 0.3), 1);
  assert.equal(decideEnd({ reason: 'stopped', songTime: 20, targets }).lastRound, 1);
});
