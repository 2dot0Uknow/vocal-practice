// The scoreNotes and activeAt of before B12, copied unchanged: they walk every frame / target. The equivalence
// tests check the indexed versions in js/scoring.js give identical answers.
import { err, scoringTail, median, mean, stdDev } from '../../js/scoring.js';

export const legacyActiveAt = (targets, t) => targets.find((target) => t >= target.t0 && t < target.t1 + 0.15);

export function legacyScoreNotes(targets, frames) {
  return targets.map((target, index) => {
    const duration = target.t1 - target.t0;
    const windowStart = target.t0 + Math.min(0.35 * duration, 0.06);
    const windowEnd = target.t1 + scoringTail(target);
    const previousTarget = targets[index - 1];
    const nextTarget = targets[index + 1];
    const usable = frames.filter((frame) => {
      if (frame.m == null || frame.t < windowStart || frame.t > windowEnd) return false;
      const centsOff = Math.abs(err(frame.m, target.m));
      if (centsOff > 450) return false;
      if (nextTarget && nextTarget.m != target.m && frame.t > target.t1 - 0.03 && Math.abs(err(frame.m, nextTarget.m)) < centsOff) return false;
      if (previousTarget && previousTarget.m != target.m && frame.t < target.t0 + 0.2 && Math.abs(err(frame.m, previousTarget.m)) < centsOff) return false;
      return true;
    });
    if (usable.length < 3) return { ...target, miss: true };
    const cents = usable.map((frame) => err(frame.m, target.m));
    const medianCents = median(cents);
    return {
      ...target,
      med: medianCents,
      sd: stdDev(cents.filter((c) => Math.abs(c - medianCents) < 150)),
      clar: mean(usable.map((frame) => frame.c)),
      ring: mean(usable.map((frame) => frame.ring)),
    };
  });
}
