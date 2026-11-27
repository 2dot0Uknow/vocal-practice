// B12: schedules the piano a little ahead of time instead of all at once. Pure apart from the timer: the
// audio calls (`play`, `cancel`) and the clock are handed in, so it runs under Node with a fake clock.
//
// Plays ({m: [midi...], t, d}, t on the audio clock) wait in a queue. Every tick (~25 ms) any play starting
// within the next `lookAhead` seconds is handed to the audio layer, and its handles are kept so that a note
// that has not sounded yet can still be cancelled (pause, skip, again, stop). Not tied to requestAnimationFrame.

export const LOOK_AHEAD = 2;       // seconds of piano scheduled ahead of the clock
export const TICK_MS = 25;

/**
 * deps: {
 *   now(): the audio clock, seconds
 *   play(midi, t, d): start one note, returns a handle
 *   cancel(handle, now): silence the note (not yet started: never plays; sounding: quick fade)
 *   onTick(): optional, called at the start of every tick (the run places its rounds here)
 *   lookAhead, tickMs: optional
 *   setTimer / clearTimer: optional, for tests
 * }
 */
export function createScheduler(deps) {
  const { now, play, cancel, onTick, lookAhead = LOOK_AHEAD, tickMs = TICK_MS } = deps;
  const setTimer = deps.setTimer || ((fn, ms) => setInterval(fn, ms));
  const clearTimer = deps.clearTimer || ((id) => clearInterval(id));
  let queue = [];     // plays not yet handed to the audio layer, in time order
  let sounding = [];  // {t, end, handles} handed over and not yet finished
  let timer = null;
  let created = 0;    // notes handed to the audio layer, ever (for the performance check)

  // A note keeps sounding a little after its written end (the release tail); after that nothing is left to cancel.
  const RELEASE = 0.8;

  const scheduler = {
    /** Queue plays (any order). */
    add(plays) {
      queue.push(...plays);
      queue.sort((a, b) => a.t - b.t);
    },

    /** One tick: let the run place rounds, hand over what is due, forget what has finished. */
    tick() {
      if (onTick) onTick();
      const clock = now();
      while (queue.length && queue[0].t < clock + lookAhead) {
        const entry = queue.shift();
        const handles = entry.m.map((midi) => play(midi, entry.t, entry.d));
        created += handles.length;
        sounding.push({ t: entry.t, end: entry.t + entry.d + RELEASE, handles });
      }
      if (sounding.length) sounding = sounding.filter((entry) => entry.end > clock);
    },

    /** Drop every play that has not started by `time` or later (rounds taken back before they began). */
    cancelFrom(time) {
      const clock = now();
      queue = queue.filter((entry) => entry.t < time);
      sounding = sounding.filter((entry) => {
        if (entry.t < time || entry.t <= clock) return true;
        entry.handles.forEach((handle) => cancel(handle, clock));
        return false;
      });
    },

    /** Silence everything: queued plays are dropped, handed-over notes are cancelled or faded. */
    cancelAll() {
      const clock = now();
      queue = [];
      sounding.forEach((entry) => entry.handles.forEach((handle) => cancel(handle, clock)));
      sounding = [];
    },

    start() {
      if (timer == null) timer = setTimer(() => scheduler.tick(), tickMs);
    },

    stop() {
      if (timer != null) clearTimer(timer);
      timer = null;
      queue = [];
      sounding = [];
    },

    /** Counts for checks: queued = waiting, sounding = handed over and not yet finished, created = ever handed over. */
    get stats() {
      return { queued: queue.length, sounding: sounding.length, created };
    },
  };
  return scheduler;
}
