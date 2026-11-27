// B12: the round plan, placing a round on the clock, and the invariant that an uninterrupted run places rounds at
// exactly the times the old one-big-timeline buildSession() did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRounds, placeRound, buildSession, normEx, SAMPLES } from '../js/exercise.js';
import { createRun } from '../js/run.js';
import { rootsOf, parsePat } from '../js/music.js';
import { SESSION_EXERCISES, ROOT_EXERCISES } from './tools/cases.mjs';

const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} vs ${b}`);

const EXERCISES = [
  ...Object.entries(SESSION_EXERCISES).map(([label, exercise]) => [label, normEx(exercise)]),
  ...SAMPLES.map((exercise) => [exercise.name, exercise]),
  ...ROOT_EXERCISES.map(({ label, ...exercise }, i) => [label, normEx({ ...exercise, name: label, vows: i % 2 ? ['ah', 'ee'] : ['ah'], bpm: 60 + i * 10 })]),
];

test('planRounds: one round per root, cue chord, notes with relative times that run back to back', () => {
  const exercise = normEx({ name: 'T', pat: '1-3-5~', vows: ['ah', 'ee'], start: 48, end: 50, bpm: 120, hold: 2 });
  const { rounds } = planRounds(exercise);
  assert.equal(rounds.length, 3);
  assert.deepEqual(rounds.map((round) => round.root), rootsOf(exercise, parsePat(exercise.pat)));
  const round = rounds[0];
  assert.deepEqual(round.cue, { m: [48, 52, 55], off: 0, d: 0.75 });
  // spb = 0.5: cue slot 2 beats + 1 s gap, then pass 1 (0.5 + 0.5 + 1.0), a beat of space, pass 2, then a beat before the next round.
  assert.equal(round.notes.length, 6);
  assert.deepEqual(round.notes.map((note) => note.off), [2, 2.5, 3, 4.5, 5, 5.5]);
  assert.deepEqual(round.notes.map((note) => note.pass), [0, 0, 0, 1, 1, 1]);
  assert.deepEqual(round.notes.map((note) => note.syl), ['ah', 'ah', 'ah', 'ee', 'ee', 'ee']);
  assert.equal(round.length, 6.5 + 0.5);
  round.notes.forEach((note, i) => i && assert.equal(note.off >= round.notes[i - 1].end, true));
  // Within a pass a note ends exactly where the next begins (no rounding drift).
  assert.equal(round.notes[0].end, round.notes[1].off);
  assert.equal(round.notes[1].end, round.notes[2].off);
  assert.deepEqual(rounds.map((r) => r.index), [0, 1, 2]);
});

test('planRounds: trill sounds are marked, and the root sound replaces the sound on degree 1', () => {
  const { rounds } = planRounds(normEx(SESSION_EXERCISES.twoPass));
  const notes = rounds[0].notes;
  assert.deepEqual(notes.map((n) => [n.syl, n.trill]).slice(0, 5), [['ee', false], ['lip trill', true], ['lip trill', true], ['lip trill', true], ['ee', false]]);
});

test('planRounds: an exercise with no sounds is a single pass on no particular sound', () => {
  const { rounds } = planRounds(normEx({ name: 'T', pat: '1-3', vows: [], start: 48, end: 48, bpm: 60 }));
  assert.deepEqual(rounds[0].notes.map((n) => n.syl), ['', '']);
});

test('placeRound puts a round on the clock: cue chord first, targets and plays line up', () => {
  const exercise = normEx(SESSION_EXERCISES.scale);
  const round = planRounds(exercise).rounds[1];
  const placed = placeRound(round, 10);
  assert.equal(placed.index, 1);
  assert.equal(placed.start, 10);
  close(placed.end, 10 + round.length, 'end');
  assert.deepEqual(placed.plays[0], { m: [49, 53, 56], t: 10, d: round.cue.d });
  assert.equal(placed.plays.length, round.notes.length + 1);
  assert.equal(placed.targets.length, round.notes.length);
  placed.targets.forEach((target, i) => {
    assert.equal(target.round, 1);
    close(target.t0, 10 + round.notes[i].off, 't0');
    assert.equal(placed.plays[i + 1].t, target.t0);
    close(placed.plays[i + 1].d, target.t1 - target.t0, 'duration');
    assert.deepEqual(placed.plays[i + 1].m, [target.m]);
  });
  // Placing the same round later only shifts it.
  const later = placeRound(round, 25);
  close(later.targets[3].t0 - placed.targets[3].t0, 15, 'shift');
});

/** Drive a run the way the app does, with a clock that ticks every 25 ms, and gather what was placed. */
function uninterrupted(exercise, startTime) {
  const run = createRun(planRounds(exercise));
  const placed = [run.start(startTime)];
  for (let now = startTime - 0.6; run.endTime() === Infinity; now += 0.025) placed.push(...run.advance(now, 4.5).placed);
  return { run, placed };
}

for (const [label, exercise] of EXERCISES) {
  test(`B12 invariant: an uninterrupted run places the same targets, piano plays and end as the old buildSession: ${label}`, () => {
    for (const startTime of [0, 0.6, 123.456]) {
      const reference = buildSession(exercise, startTime);
      const { run, placed } = uninterrupted(exercise, startTime);
      const targets = run.targets();
      assert.equal(targets.length, reference.targets.length);
      targets.forEach((target, i) => {
        const old = reference.targets[i];
        assert.equal(target.m, old.m);
        assert.equal(target.round, old.round);
        assert.equal(target.pass, old.pass);
        assert.equal(target.syl, old.syl);
        assert.equal(target.trill, old.trill);
        close(target.t0, old.t0, `t0 #${i}`);
        close(target.t1, old.t1, `t1 #${i}`);
      });
      const plays = placed.flatMap((round) => round.plays);
      assert.equal(plays.length, reference.plays.length);
      plays.forEach((play, i) => {
        assert.deepEqual(play.m, reference.plays[i].m);
        close(play.t, reference.plays[i].t, `play t #${i}`);
        close(play.d, reference.plays[i].d, `play d #${i}`);
      });
      close(run.endTime(), reference.end, 'end');
      // Rounds were placed in order, once each.
      assert.deepEqual(placed.map((round) => round.index), placed.map((_, i) => i));
      assert.equal(placed.length, planRounds(exercise).rounds.length);
    }
  });
}
