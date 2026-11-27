// B12: finding things in time-ordered lists without walking all of them. Pure functions only.
// Frames ({t, ...}) and targets ({t0, t1, ...}) are both kept in time order, so a window of time is a
// contiguous slice that two binary searches can find.

/**
 * The first index in [from, to) whose item passes `test`, or `to` when none does.
 * `test` must be monotone: false for a while, then true for every later item.
 */
export function firstIndexWhere(items, test, from = 0, to = items.length) {
  let low = from;
  let high = to;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (test(items[mid])) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** True when frames are in non-decreasing time order (what the binary searches rely on). */
export function isSortedByTime(frames) {
  for (let i = 1; i < frames.length; i++) if (frames[i].t < frames[i - 1].t) return false;
  return true;
}

/** The slice [start, end) of time-ordered frames with fromTime <= t <= toTime. */
export function frameRange(frames, fromTime, toTime) {
  const start = firstIndexWhere(frames, (frame) => frame.t >= fromTime);
  const end = firstIndexWhere(frames, (frame) => frame.t > toTime, start);
  return { start, end };
}

/** The slice [start, end) of time-ordered, non-overlapping targets that touch the time span fromTime..toTime. */
export function targetRange(targets, fromTime, toTime) {
  const start = firstIndexWhere(targets, (target) => target.t1 >= fromTime);
  const end = firstIndexWhere(targets, (target) => target.t0 > toTime, start);
  return { start, end };
}

/** The first target that starts after time t (what is coming up), or undefined. */
export const nextTargetAfter = (targets, t) => targets[firstIndexWhere(targets, (target) => target.t0 > t)];

/** The target whose start is nearest to time t (the earlier one on a tie); undefined when there are no targets. */
export function nearestTargetByStart(targets, t) {
  if (!targets.length) return undefined;
  const after = firstIndexWhere(targets, (target) => target.t0 >= t);
  if (after === 0) return targets[0];
  if (after === targets.length) return targets[after - 1];
  return Math.abs(targets[after].t0 - t) < Math.abs(targets[after - 1].t0 - t) ? targets[after] : targets[after - 1];
}

/**
 * The microphone frames of a session, kept in time order. Frames arrive in order, so adding is a push;
 * an out-of-order frame (should not happen) is inserted where it belongs.
 */
export function createFrameStore() {
  let frames = [];
  return {
    /** The frames, oldest first. The array is replaced by clear() / discardAfter(), so read it again each time. */
    get frames() {
      return frames;
    },
    get length() {
      return frames.length;
    },
    add(frame) {
      const last = frames[frames.length - 1];
      if (!last || frame.t >= last.t) {
        frames.push(frame);
        return;
      }
      frames.splice(firstIndexWhere(frames, (other) => other.t > frame.t), 0, frame);
    },
    /** The frames recorded after time t (exclusive), oldest first. */
    since(t) {
      return frames.slice(firstIndexWhere(frames, (frame) => frame.t > t));
    },
    /** Throw away every frame later than time t (used when a round is replayed). Returns how many were dropped. */
    discardAfter(t) {
      const keep = firstIndexWhere(frames, (frame) => frame.t > t);
      const dropped = frames.length - keep;
      frames = frames.slice(0, keep);
      return dropped;
    },
    clear() {
      frames = [];
    },
  };
}
