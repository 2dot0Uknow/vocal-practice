// B12 / F1: a practice run as rounds placed on the song clock one at a time. Pure: no audio, no DOM, no timers.
//
// planRounds() (exercise.js) says what each round contains relative to its own start. A run places a round
// on the clock only when it is reached, which is what lets a run be paused between rounds, replay a round
// ("Again") or leave one out ("Skip"). Uninterrupted, the rounds follow each other back to back, so the
// times are the same as the old one-big-timeline buildSession().
//
// All times are on the audio clock in seconds (the same clock the targets use). The caller passes `now`.
//
// What it keeps ("live"): only the CURRENT attempt of each round that was not skipped. Replaying a round
// replaces its attempt; skipping removes it. So `targets()` is exactly what is drawn and scored: the last
// attempt of every round that was sung, in time order, and nothing from skipped rounds.

import { placeRound } from './exercise.js';

/** Gap between pressing Resume and the next round's cue chord, seconds. */
export const RESUME_GAP = 0.6;
/** Gap before a replayed round, or the round after a skip, starts (enough to schedule the chord in time), seconds. */
export const RESTART_GAP = 0.15;
/** Seconds after the last round's end before a run counts as finished (as before B12). */
export const END_PAD = 0.3;

/**
 * phase: 'idle' (not started), 'running', 'held' (paused at a round boundary, waiting for resume())
 * or 'done' (the last round was skipped; the run ends at endTime()).
 */
export function createRun(plan) {
  const rounds = plan.rounds;
  const total = rounds.length;
  let live = [];              // placed rounds {index, placement (how many times this round has been placed), start, end, targets, plays}, oldest first
  const attempts = new Map(); // round index -> times placed
  let nextIndex = 0;          // the next round to place
  let phase = 'idle';
  let pausePending = false;
  let heldAt = null;          // when the hold began (audio clock)
  let forcedEnd = null;       // set when the last round is skipped
  let targetsCache = null;

  const changed = () => {
    targetsCache = null;
  };

  function place(index, start) {
    const record = { ...placeRound(rounds[index], start), placement: (attempts.get(index) || 0) + 1 };
    attempts.set(index, record.placement);
    live.push(record);
    nextIndex = index + 1;
    changed();
    return record;
  }

  /** Take back every live round from `fromIndex` on (they have not been sung to the end). Returns the removed rounds. */
  function withdraw(fromIndex) {
    const removed = live.filter((record) => record.index >= fromIndex);
    if (removed.length) {
      live = live.filter((record) => record.index < fromIndex);
      changed();
    }
    nextIndex = Math.min(nextIndex, fromIndex);
    return removed;
  }

  /** The round being sung at `now`: the last placed round that has started, else the first one placed (still in its lead-in). */
  function current(now) {
    let found = live[0] || null;
    for (const record of live) if (record.start <= now) found = record;
    return found;
  }

  const lastLive = () => live[live.length - 1] || null;

  const run = {
    get phase() {
      return phase;
    },
    get pausePending() {
      return pausePending;
    },
    get total() {
      return total;
    },
    /** When the current hold began (audio clock), or null. */
    get heldAt() {
      return heldAt;
    },
    /** Rounds on the clock now (current attempts only, oldest first). */
    get rounds() {
      return live;
    },
    /** Index of the round being sung at `now` (0-based), or -1 when none. */
    currentIndex: (now) => (current(now) ? current(now).index : -1),

    /** Begin: round 1 is placed at `startTime`. Returns the placed round (its plays go to the scheduler). */
    start(startTime) {
      if (phase !== 'idle') throw new Error('the run has already started');
      phase = 'running';
      return place(0, startTime);
    },

    /**
     * Move the run on to `now`: place the rounds that start within `horizon` seconds (so the roll can show them
     * and the scheduler can reach them), and begin a requested hold when the current round has ended.
     * Returns {placed: [rounds placed just now], held: true when a hold just began}.
     */
    advance(now, horizon) {
      const result = { placed: [], held: false };
      if (phase !== 'running') return result;
      let last = lastLive();
      if (pausePending && last && now >= last.end) {
        pausePending = false;
        if (nextIndex < total) {
          phase = 'held';
          heldAt = last.end;
          result.held = true;
        }
        return result;
      }
      if (pausePending) return result;   // nothing further is placed while waiting to hold
      while (nextIndex < total && last && last.end <= now + horizon) {
        last = place(nextIndex, last.end);
        result.placed.push(last);
      }
      return result;
    },

    /** Can Pause do anything now? Not on the last round (the run simply ends there) and not while held. */
    canPause: (now) => phase === 'running' && (pausePending || (current(now) ? current(now).index < total - 1 : false)),

    /**
     * Pause, to take effect at the end of the round being sung. A second call cancels a pause that has not happened yet.
     * Returns {pending, withdrawn}: `withdrawn` are rounds already placed after the current one (take their notes back).
     */
    requestPause(now) {
      if (phase !== 'running') return { pending: false, withdrawn: [] };
      if (pausePending) {
        pausePending = false;
        return { pending: false, withdrawn: [] };
      }
      const here = current(now);
      if (!here || here.index >= total - 1) return { pending: false, withdrawn: [] };
      pausePending = true;
      return { pending: true, withdrawn: withdraw(here.index + 1) };
    },

    /** Leave the hold: the next round starts with its cue chord RESUME_GAP from now. Returns {placed}. */
    resume(now) {
      if (phase !== 'held') return { placed: null };
      phase = 'running';
      heldAt = null;
      return { placed: place(nextIndex, now + RESUME_GAP) };
    },

    /**
     * Replay the current round from its cue chord, right away. The attempt in progress is thrown away (its targets
     * leave the live list; `discardFrom` is where it began, so the caller can drop the frames recorded since).
     * A pause that was waiting still takes effect after the replayed round.
     * Returns {withdrawn, placed, discardFrom}, or null when not running.
     */
    again(now) {
      const here = phase === 'running' ? current(now) : null;
      if (!here) return null;
      const withdrawn = withdraw(here.index);
      return { withdrawn, placed: place(here.index, now + RESTART_GAP), discardFrom: here.start };
    },

    /**
     * End the current round now and move to the next round's cue chord. The skipped round is not scored (its targets
     * are gone from the live list, so it is not a miss either). Returns null when not running, else
     *  {withdrawn, discardFrom, placed, held, last, sung}:
     *  - on a round that is not the last: placed = the next round (RESTART_GAP from now), or held = true when a pause was waiting
     *  - on the last round: last = true, the run is 'done' and ends at endTime(); sung = whether any round was sung
     */
    skip(now) {
      const here = phase === 'running' ? current(now) : null;
      if (!here) return null;
      const withdrawn = withdraw(here.index);
      const result = { withdrawn, discardFrom: here.start, placed: null, held: false, last: false, sung: live.length > 0 };
      if (here.index >= total - 1) {
        phase = 'done';
        pausePending = false;
        result.last = true;
        forcedEnd = Math.max(now, lastLive() ? lastLive().end + END_PAD : now);
        return result;
      }
      nextIndex = here.index + 1;
      if (pausePending) {
        pausePending = false;
        phase = 'held';
        heldAt = now;
        result.held = true;
      } else {
        result.placed = place(nextIndex, now + RESTART_GAP);
      }
      return result;
    },

    /** The live targets in time order (the last attempt of every round that was not skipped). Same array until something changes. */
    targets() {
      if (!targetsCache) targetsCache = live.flatMap((record) => record.targets);
      return targetsCache;
    },

    /** Song time at which the run is over: after the last round plus END_PAD, or at once after skipping the last round. Infinity while rounds remain. */
    endTime() {
      if (forcedEnd != null) return forcedEnd;
      if (phase === 'running' && nextIndex >= total && lastLive()) return lastLive().end + END_PAD;
      return Infinity;
    },

    /** Has the run ended by song time `songTime`? */
    finishedBy: (songTime) => songTime > run.endTime(),
  };
  return run;
}
