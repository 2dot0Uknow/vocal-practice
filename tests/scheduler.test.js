// B12: the look-ahead scheduler, driven with a fake clock and fake audio calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler, LOOK_AHEAD } from '../js/scheduler.js';
import { createRun } from '../js/run.js';
import { planRounds, normEx } from '../js/exercise.js';

function setup(options = {}) {
  const clock = { t: 0 };
  const log = { played: [], cancelled: [], timers: [] };
  const scheduler = createScheduler({
    now: () => clock.t,
    play: (midi, t, d) => {
      const handle = { midi, t, d, id: log.played.length };
      log.played.push(handle);
      return handle;
    },
    cancel: (handle, now) => log.cancelled.push({ handle, now }),
    setTimer: (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; },
    clearTimer: (id) => { log.timers[id - 1].cleared = true; },
    ...options,
  });
  return { clock, log, scheduler };
}
const note = (t, midi = 60, d = 0.5) => ({ m: [midi], t, d });

test('only notes starting within the look-ahead are handed to the audio layer, the rest wait', () => {
  const { clock, log, scheduler } = setup();
  scheduler.add([note(1), note(5), note(30), { m: [60, 64, 67], t: 1.5, d: 1 }]);
  scheduler.tick();
  assert.deepEqual(log.played.map((p) => p.t), [1, 1.5, 1.5, 1.5], 'a chord is three notes at one time');
  assert.equal(scheduler.stats.queued, 2);
  clock.t = 3.1;
  scheduler.tick();
  assert.deepEqual(log.played.map((p) => p.t).slice(4), [5], 'the note at 5 is due once the clock reaches 3.1 (look-ahead 2)');
  clock.t = 28.5;
  scheduler.tick();
  assert.equal(log.played.length, 6);
  assert.equal(scheduler.stats.queued, 0);
  assert.equal(LOOK_AHEAD, 2);
});

test('notes are handed over in time order whatever order they were added in, and never twice', () => {
  const { clock, log, scheduler } = setup();
  scheduler.add([note(3, 62), note(1, 60)]);
  scheduler.add([note(2, 61)]);
  clock.t = 5;
  scheduler.tick();
  scheduler.tick();
  assert.deepEqual(log.played.map((p) => p.midi), [60, 61, 62]);
});

test('finished notes are forgotten, so what is alive stays small however long the run is', () => {
  const { clock, log, scheduler } = setup();
  const plays = [];
  for (let i = 0; i < 2000; i++) plays.push(note(i * 0.5, 60, 0.5));   // a 1000 s run
  scheduler.add(plays);
  let most = 0;
  for (clock.t = 0; clock.t < 1005; clock.t += 0.025) {
    scheduler.tick();
    most = Math.max(most, scheduler.stats.sounding + 0);
  }
  assert.equal(log.played.length, 2000);
  // 2 s ahead + the note's own length + release tail: a handful, never thousands.
  assert.ok(most <= 8, `most notes alive at once: ${most}`);
});

test('cancelFrom takes back notes that have not started: queued ones vanish, handed-over ones are cancelled; sounding ones are left', () => {
  const { clock, log, scheduler } = setup();
  scheduler.add([note(0.5, 60), note(1.5, 62), note(2.5, 64), note(9, 65)]);
  clock.t = 1;
  scheduler.tick();   // hands over everything before 3
  assert.equal(log.played.length, 3);
  scheduler.cancelFrom(2);
  assert.deepEqual(log.cancelled.map((c) => c.handle.midi), [64], 'the note at 2.5 had not started');
  assert.equal(log.cancelled[0].now, 1);
  assert.equal(scheduler.stats.queued, 0, 'the queued note at 9 is dropped too');
  clock.t = 20;
  scheduler.tick();
  assert.equal(log.played.length, 3, 'nothing comes back');
});

test('cancelAll silences everything, sounding notes included, and empties the queue', () => {
  const { clock, log, scheduler } = setup();
  scheduler.add([note(0.2, 60), note(1, 62), note(20, 64)]);
  clock.t = 0.5;
  scheduler.tick();
  scheduler.cancelAll();
  assert.deepEqual(log.cancelled.map((c) => c.handle.midi).sort(), [60, 62]);
  assert.equal(scheduler.stats.queued, 0);
  assert.equal(scheduler.stats.sounding, 0);
  clock.t = 30;
  scheduler.tick();
  assert.equal(log.played.length, 2);
});

test('onTick runs first on every tick (the run places rounds there), and start / stop manage one timer of 25 ms', () => {
  let ticks = 0;
  const { log, scheduler } = setup({ onTick: () => ticks++ });
  scheduler.start();
  scheduler.start();
  assert.equal(log.timers.length, 1, 'starting twice makes one timer');
  assert.equal(log.timers[0].ms, 25);
  log.timers[0].fn();
  log.timers[0].fn();
  assert.equal(ticks, 2);
  scheduler.stop();
  assert.equal(log.timers[0].cleared, true);
});

test('with a run: round 2 reaches the piano only about 2 s before it starts, and a pause takes it back', () => {
  const exercise = normEx({ id: 'x', name: 'T', pat: '1-3-5', vows: ['ah'], start: 48, end: 51, bpm: 120, hold: 2 });   // rounds at 0, 4, 8, 12
  const { clock, log, scheduler } = setup();
  const run = createRun(planRounds(exercise));
  scheduler.add(run.start(0).plays);
  const drive = (to) => {
    for (; clock.t <= to; clock.t += 0.025) {
      run.advance(clock.t, 4.5).placed.forEach((round) => scheduler.add(round.plays));
      scheduler.tick();
    }
  };
  drive(1.9);
  assert.equal(Math.max(...log.played.map((p) => p.t)) < 4, true, 'round 2 (cue chord at 4) is not scheduled before 2 s ahead');
  assert.equal(log.played.filter((p) => p.t === 4).length, 0);
  // Pause at 1.95: round 2 is placed (inside 4.5 s) but nothing of it has been handed over, and nothing will be.
  const { withdrawn } = run.requestPause(clock.t);
  scheduler.cancelFrom(withdrawn[0].start);
  drive(10);
  assert.equal(log.played.filter((p) => p.t >= 4).length, 0, 'no notes while paused');
  assert.equal(log.cancelled.length, 0, 'nothing had been handed over yet, so nothing to cancel');
});

test('with a run: a pause asked inside the last 2 s hands over then cancels the next round\'s cue chord', () => {
  const exercise = normEx({ id: 'x', name: 'T', pat: '1-3-5', vows: ['ah'], start: 48, end: 51, bpm: 120, hold: 2 });
  const { clock, log, scheduler } = setup();
  const run = createRun(planRounds(exercise));
  scheduler.add(run.start(0).plays);
  for (; clock.t <= 2.5; clock.t += 0.025) {
    run.advance(clock.t, 4.5).placed.forEach((round) => scheduler.add(round.plays));
    scheduler.tick();
  }
  assert.equal(log.played.filter((p) => p.t === 4).length, 3, 'round 2 chord has been handed over (4 < 2.5 + 2)');
  const { withdrawn } = run.requestPause(clock.t);
  scheduler.cancelFrom(withdrawn[0].start);
  assert.equal(log.cancelled.length, 3, 'the three chord notes are cancelled before they sound');
});
