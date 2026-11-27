// Scoring: compare the singer's pitch frames with the target notes, and turn the result into
// the session report's numbers and wording. Pure functions only: no DOM, no storage.
//
// A "frame" is one analysis of the microphone: {t (seconds), m (midi pitch or null), c (clarity),
// ring (brightness), tr (trill mode)}. A "target" comes from buildSession().

/**
 * Signed distance in cents from target pitch `targetMidi` to `midi`, folded to the nearest octave
 * (so singing an octave away still counts as the right note). 100 cents = one semitone.
 */
export const err = (midi, targetMidi) => {
  const cents = (midi - targetMidi) * 100;
  return cents - 1200 * Math.round(cents / 1200);
};

/** How long after a note ends its scoring window still collects frames (late finishes count), in seconds. */
export const scoringTail = (target) => Math.min(0.3, 0.6 * (target.t1 - target.t0));

/**
 * True when a note can be scored fairly at song time `songTime`: its whole scoring window
 * (end + scoringTail, shifted later by the voice lag, since frames are shifted back by it) has been heard.
 */
export const noteFinishedBy = (target, songTime, voiceLag = 0) => target.t1 + voiceLag + scoringTail(target) <= songTime;

/** The note being sung at time t, allowing 0.15 s of grace after it ends (so a late finish still counts). */
export const activeAt = (targets, t) => targets.find((target) => t >= target.t0 && t < target.t1 + 0.15);

/** The target sounding at time t exactly (no grace period), or null. Targets are in time order. */
export function strictAt(targets, t) {
  let low = 0;
  let high = targets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (targets[mid].t1 <= t) low = mid + 1;
    else if (targets[mid].t0 > t) high = mid - 1;
    else return targets[mid];
  }
  return null;
}

/**
 * Voice lag: mic delay (big on Bluetooth) plus the singer's natural reaction time. Learned by sliding
 * the voice track against the notes (0 to 0.8 s) and keeping the offset where the pitches match best.
 * Returns the best offset in seconds, or null when there is too little data or no clear best offset.
 */
export function estimateLag(frames, targets) {
  const voiced = frames.filter((frame) => frame.m != null);
  if (voiced.length < 40) return null;
  let bestLag = null;
  let bestCost = 1e9;
  const costs = [];
  for (let lag = 0; lag <= 0.8; lag += 0.02) {
    let totalCost = 0;
    let counted = 0;
    for (const frame of voiced) {
      const target = strictAt(targets, frame.t - lag);
      if (!target) continue;
      // Each frame's miss is capped at 300 cents so one wild frame cannot dominate.
      totalCost += Math.min(Math.abs(err(frame.m, target.m)), 300);
      counted++;
    }
    if (counted < 30) continue;
    const averageCost = totalCost / counted;
    costs.push(averageCost);
    if (averageCost < bestCost) {
      bestCost = averageCost;
      bestLag = lag;
    }
  }
  // Reject a flat cost curve (no lag fits noticeably better than the others) or a poor best fit.
  if (bestLag == null || bestCost > 120 || Math.max(...costs) - bestCost < 15) return null;
  return bestLag;
}

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  return count ? (count % 2 ? sorted[count >> 1] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2) : null;
};
export const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
export const stdDev = (values) => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((x) => (x - average) ** 2)));
};

/**
 * Match voice frames to notes. Timing isn't scored, so each note's window stretches to allow
 * for coming in late, and frames near a boundary go to whichever neighbouring note they're closer to in pitch.
 * Returns one result per target: either {...target, miss: true} (fewer than 3 usable frames) or
 * {...target, med (median cents off), sd (steadiness), clar (clarity), ring}.
 */
export function scoreNotes(targets, frames) {
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
      // Near the end of this note, a frame that is closer to the next note belongs to that note.
      if (nextTarget && nextTarget.m != target.m && frame.t > target.t1 - 0.03 && Math.abs(err(frame.m, nextTarget.m)) < centsOff) return false;
      // Near the start, a frame closer to the previous note is still the previous note's tail.
      if (previousTarget && previousTarget.m != target.m && frame.t < target.t0 + 0.2 && Math.abs(err(frame.m, previousTarget.m)) < centsOff) return false;
      return true;
    });
    if (usable.length < 3) return { ...target, miss: true };
    const cents = usable.map((frame) => err(frame.m, target.m));
    const medianCents = median(cents);
    return {
      ...target,
      med: medianCents,
      // Steadiness ignores wild outliers (more than 150 cents from the median).
      sd: stdDev(cents.filter((c) => Math.abs(c - medianCents) < 150)),
      clar: mean(usable.map((frame) => frame.c)),
      ring: mean(usable.map((frame) => frame.ring)),
    };
  });
}

/** The cheer line of a stopped run (it is never compared with earlier runs). */
export const PARTIAL_CHEER = 'Partial run. Not saved to your journey.';

// Pick a label from three words by two thresholds (lower value = first word).
const pickLabel = (value, firstLimit, secondLimit, words) => (value < firstLimit ? words[0] : value < secondLimit ? words[1] : words[2]);

/**
 * Everything the report screen shows, as plain data.
 *  - targets, frames: the session; frames are as recorded (not yet shifted by the voice lag)
 *  - voiceLag: the current lag estimate (seconds)
 *  - previousRuns: earlier history entries for this exercise, newest first ({pct})
 *  - partial: a stopped run. `targets` is then only the notes that finished: every number is based on
 *    those notes alone, the cheer line does not compare with earlier runs, and the result is not saveable.
 * Returns {voiceLag (updated), results, heardCount, total, inTune, pct, avgAbs, lean, stability, clarity,
 * ring, toneCount (how many notes the tone numbers rest on), missCount, subtitle, rows [{name, value 0..100, label}], tips, good, cheer, hasTrillNotes, saveable}.
 */
export function summarizeSession({ targets, frames, voiceLag, previousRuns, partial = false }) {
  const estimate = estimateLag(frames, targets);
  const lag = estimate != null ? estimate : voiceLag;
  const results = scoreNotes(targets, frames.map((frame) => ({ ...frame, t: frame.t - lag })));
  const heard = results.filter((result) => !result.miss);
  const total = results.length;
  const inTune = heard.filter((result) => Math.abs(result.med) <= 25).length;
  const pct = total ? Math.round((inTune / total) * 100) : 0;

  // Tone readings are unreliable for buzzy sounds, so tone stats use only the non-trill notes.
  const toneNotes = heard.filter((result) => !result.trill);
  const allTrill = heard.length > 0 && toneNotes.length === 0;
  const avgAbs = mean(heard.map((result) => Math.abs(result.med)));
  const lean = mean(heard.map((result) => result.med));
  const stability = median((toneNotes.length ? toneNotes : heard).map((result) => result.sd)) ?? 0;
  const clarity = mean(toneNotes.map((result) => result.clar));
  const ring = mean(toneNotes.map((result) => result.ring));
  const missCount = total - heard.length;
  const stabilityLimit = allTrill ? 30 : 18;

  // Compare the lowest third of notes with the highest third.
  const byPitch = [...heard].sort((a, b) => a.m - b.m);
  const third = Math.max(1, Math.floor(byPitch.length / 3));
  const lowError = mean(byPitch.slice(0, third).map((result) => Math.abs(result.med)));
  const highError = mean(byPitch.slice(-third).map((result) => Math.abs(result.med)));
  // Average error per sound (vowel / syllable).
  const errorBySound = {};
  heard.forEach((result) => {
    if (result.syl) (errorBySound[result.syl] = errorBySound[result.syl] || []).push(Math.abs(result.med));
  });

  const subtitle = heard.length
    ? `Average ${Math.round(avgAbs)} cents off · tends ${Math.abs(lean) < 8 ? 'centred' : lean < 0 ? 'flat' : 'sharp'}`
    : "Didn't hear you this time";

  const rows = [
    { name: 'Pitch accuracy', value: Math.max(0, 100 - avgAbs * 1.6), label: pickLabel(avgAbs, 15, 35, ['Strong', 'Close', 'Growing']) },
    {
      name: 'Steadiness',
      value: Math.max(0, 100 - stability * (allTrill ? 1.5 : 2.5)),
      label: allTrill
        ? pickLabel(stability, 20, 35, ['Steady', 'Mostly steady', 'Settling'])
        : pickLabel(stability, 12, 25, ['Steady', 'Mostly steady', 'Settling']),
    },
    ...(toneNotes.length
      ? [
        { name: 'Clear tone', value: Math.max(0, Math.min(100, ((clarity - 0.75) / 0.23) * 100)), label: clarity >= 0.93 ? 'Clear' : clarity >= 0.86 ? 'Slightly airy' : 'Airy' },
        { name: 'Ring', value: Math.max(0, Math.min(100, ring * 400)), label: ring >= 0.15 ? 'Bright, ringing' : ring >= 0.06 ? 'Balanced' : 'Warm, soft' },
      ]
      : []),
    { name: 'Notes held', value: total ? (heard.length / total) * 100 : 0, label: `${heard.length} of ${total}` },
  ];

  const tips = [];
  if (!heard.length) {
    tips.push("I couldn't hear you this time. Check the mic permission, keep the phone 30–50 cm away, and sing out. You've got this.");
  } else {
    if (lean < -12) tips.push('Your notes tend to sit a touch low. Keep your breath energy up through the end of each phrase, especially on the way down. Think "up" as the notes descend.');
    if (lean > 12) tips.push('Your notes tend to sit a touch high. Ease off the push: lighter volume and a relaxed jaw usually bring the pitch down.');
    if (byPitch.length >= 6 && highError > lowError + 12) tips.push(`Your top notes are still settling in (around ${Math.round(highError)} cents vs ${Math.round(lowError)} at the bottom). Try a lighter, heady sound up high, open the vowel slightly, and stay at this top note until it settles before going higher.`);
    if (byPitch.length >= 6 && lowError > highError + 12) tips.push("Your lowest notes have the most room to grow. Don't press down for them; keep them light and speech-like, and skip notes below your comfortable range.");
    const sounds = Object.keys(errorBySound);
    if (sounds.length > 1) {
      const ranked = sounds.map((sound) => [sound, mean(errorBySound[sound])]).sort((a, b) => b[1] - a[1]);
      const worst = ranked[0];
      const best = ranked[ranked.length - 1];
      if (worst[1] > best[1] + 10) tips.push(`"${worst[0]}" is a little less settled (${Math.round(worst[1])} cents) than on "${best[0]}" (${Math.round(best[1])} cents). Try keeping the same mouth space and placement when you switch sounds.`);
    }
    if (stability >= stabilityLimit) tips.push(allTrill ? 'Pitch drifts during the trill. Keep the airflow steady and the lips loose; if the trill keeps stopping, lightly press your cheeks forward with your fingertips.' : 'Held notes are still finding their center. Aim for a steady, even airflow: practise a gentle "sss" hiss for 10 seconds, then sing the note with the same steady feeling. (A wide vibrato can also show up here.)');
    if (toneNotes.length && clarity < 0.88) tips.push('Your tone is on the airy side. Try starting notes with a gentle, clean onset, or warm up on "ng" or a hum to get the cords meeting more firmly.');
    if (toneNotes.length && ring < 0.06) tips.push('Your sound is warm and soft. For more ring, try a buzzy "ng" or "nyah" and aim the sound forward, toward the front of your face.');
    if (missCount > 0 && results.some((result) => result.miss && result.trill)) tips.push('Some trill notes were too faint to read. Hold the phone a bit closer (about 20–30 cm) and keep the trill going through the whole note.');
    else if (missCount > 0) tips.push(`${missCount} note${missCount > 1 ? 's were' : ' was'} too short or quiet to hear. Sustain through the full length of each note.`);
    if (pct >= 85 && stability < 15) tips.push('Ready for a new challenge? Extend the range one step, or bump the tempo by 10 bpm.');
    if (!tips.length) tips.push('Nothing big to fix. Run it once more and enjoy nudging the gold and lavender notes toward green.');
  }

  const good = [];
  if (heard.length) {
    if (pct >= 50) good.push(`${inTune} of ${total} notes landed right in tune.`);
    else if (inTune) good.push(`${inTune} note${inTune == 1 ? '' : 's'} landed right in tune. Each one is a step forward.`);
    else good.push(`You sang ${heard.length} of ${total} notes all the way through.`);
    if (byPitch.length >= 6 && lowError + 12 < highError) good.push('Your lower notes were especially accurate.');
    if (byPitch.length >= 6 && highError + 12 < lowError) good.push("Your top notes were especially accurate. That's the hard part!");
    if (Math.abs(lean) < 8) good.push('You stayed centred: not habitually sharp or flat.');
    if (stability < (allTrill ? 20 : 12)) good.push(allTrill ? 'Your trill held a steady pitch.' : 'Your held notes were steady.');
    if (toneNotes.length && clarity >= 0.92) good.push('Clear, focused tone.');
    if (total && heard.length / total >= 0.9) good.push('You sustained nearly every note.');
    const sounds = Object.keys(errorBySound);
    if (sounds.length > 1) {
      const best = sounds.map((sound) => [sound, mean(errorBySound[sound])]).sort((a, b) => a[1] - b[1])[0];
      if (best[1] < 20) good.push(`"${best[0]}" sounded especially secure.`);
    }
  } else {
    good.push('You showed up to practise. That counts.');
  }

  let cheer = '';
  if (partial) {
    cheer = PARTIAL_CHEER;
  } else if (heard.length) {
    if (!previousRuns.length) {
      cheer = 'First run logged. This is your starting point.';
    } else {
      const bestPrevious = Math.max(...previousRuns.map((run) => run.pct));
      const lastPct = previousRuns[0].pct;
      if (pct > bestPrevious) cheer = `Your best yet on this one (previous best ${bestPrevious}%)!`;
      else if (pct > lastPct) cheer = `Up ${pct - lastPct} from last time. Nice progress.`;
      else if (pct == lastPct) cheer = 'Right where you were last time. Consistency builds skill.';
      else cheer = 'Every run teaches your voice something. Keep going.';
    }
  }

  return {
    voiceLag: lag,
    results,
    heardCount: heard.length,
    total,
    inTune,
    pct,
    avgAbs,
    lean,
    stability,
    clarity,
    ring,
    toneCount: toneNotes.length,
    missCount,
    subtitle,
    rows,
    tips: tips.slice(0, 2),
    good: good.slice(0, 4),
    cheer,
    hasTrillNotes: results.some((result) => result.trill),
    saveable: !partial && heard.length > 0,
  };
}
