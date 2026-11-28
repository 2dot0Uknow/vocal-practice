// Scoring: compare the singer's pitch frames with the target notes, and turn the result into
// the session report's numbers and wording. Pure functions only: no DOM, no storage.
//
// A "frame" is one analysis of the microphone: {t (seconds), m (midi pitch or null), c (clarity),
// ring (brightness), tr (trill mode)}. A "target" comes from placeRound() (exercise.js, via run.js).

import { firstIndexWhere, frameRange, isSortedByTime } from './timeindex.js';
import { mainSound, compareTone, baselineLabel, CLARITY_WORDS, RING_WORDS } from './tone.js';

/**
 * A1: signed distance in cents from target pitch `targetMidi` to `midi`, exactly as sung (no octave folding).
 * 100 cents = one semitone. The singer is expected to sing in the piano's octave, so an octave away is 1200 off.
 */
export const cents = (midi, targetMidi) => (midi - targetMidi) * 100;

/**
 * The same distance folded to the nearest octave (so an octave away reads as 0). A1: this is no longer used to
 * score anything. It is only used where "which note is this frame about" is the question (neighbour-note
 * disambiguation in scoreNotes), where octave-equivalence is the right notion.
 */
export const err = (midi, targetMidi) => {
  const distance = cents(midi, targetMidi);
  return distance - 1200 * Math.round(distance / 1200);
};

/** A1: true when a distance in cents (either sign) is about one octave: 1200 plus or minus 150. */
export const OCTAVE_SLACK = 150;
export const isOctaveAway = (distance) => Math.abs(Math.abs(distance) - 1200) <= OCTAVE_SLACK;

// Two frames count as neighbours when they are at most this far apart in time (analysis runs at ~50/s = 0.02 s).
const NEIGHBOUR_GAP = 0.1;

/**
 * A1: drop detector octave glitches. A single frame (or a run of two) whose pitch is about an octave (1200 plus or
 * minus 150 cents) from BOTH its neighbours, where those two neighbours agree with each other (within 100 cents),
 * is the detector jumping an octave, not the singer. It becomes a silent frame (m = null), so it is neither scored nor drawn.
 * A real octave leap is never touched: its neighbours on either side do not agree with each other, and a
 * longer run is real singing. Frames must be in time order. Returns the same array when nothing was dropped.
 */
export function dropOctaveGlitches(frames) {
  let result = null;
  const isVoiced = (frame) => frame && frame.m != null;
  const adjacent = (a, b) => b.t - a.t <= NEIGHBOUR_GAP;
  for (let i = 1; i < frames.length - 1; i++) {
    if (!isVoiced(frames[i]) || (result && result[i].m == null)) continue;
    for (const length of [1, 2]) {
      const previous = frames[i - 1];
      const next = frames[i + length];
      const run = frames.slice(i, i + length);
      if (!isVoiced(previous) || !isVoiced(next) || run.length < length || !run.every(isVoiced)) continue;
      if (!adjacent(previous, run[0]) || !adjacent(run[length - 1], next)) continue;
      if (!run.every((frame, k) => k == 0 || adjacent(run[k - 1], frame))) continue;
      if (Math.abs(cents(previous.m, next.m)) > 100) continue;       // the neighbours must agree
      const consensus = (previous.m + next.m) / 2;
      if (!run.every((frame) => isOctaveAway(cents(frame.m, consensus)))) continue;
      result = result || frames.slice();
      for (let k = 0; k < length; k++) result[i + k] = { ...frames[i + k], m: null };
      break;
    }
  }
  return result || frames;
}

/** How long after a note ends its scoring window still collects frames (late finishes count), in seconds. */
export const scoringTail = (target) => Math.min(0.3, 0.6 * (target.t1 - target.t0));

/**
 * True when a note can be scored fairly at song time `songTime`: its whole scoring window
 * (end + scoringTail, shifted later by the voice lag, since frames are shifted back by it) has been heard.
 */
export const noteFinishedBy = (target, songTime, voiceLag = 0) => target.t1 + voiceLag + scoringTail(target) <= songTime;

/**
 * The note being sung at time t, allowing 0.15 s of grace after it ends (so a late finish still counts).
 * Targets are in time order and do not overlap, so this is a binary search (B12): the first target still
 * inside its grace period at t, if it has started. Same answer as scanning the whole list.
 */
export function activeAt(targets, t) {
  const candidate = targets[firstIndexWhere(targets, (target) => t < target.t1 + 0.15)];
  return candidate && t >= candidate.t0 ? candidate : undefined;
}

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
  const voiced = dropOctaveGlitches(frames).filter((frame) => frame.m != null);
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
      // Each frame's miss is capped at 300 cents so one wild frame cannot dominate. A1: real cents, no folding:
      // a voice a whole octave off scores 300 at every offset, so no lag looks better and null comes back.
      totalCost += Math.min(Math.abs(cents(frame.m, target.m)), 300);
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
 * {...target, med (median cents off, as sung: -1200 is an octave below), octaveOff, sd (steadiness), clar (clarity), ring}.
 * Callers drop detector octave glitches first (dropOctaveGlitches); summarizeSession does.
 */
export function scoreNotes(targets, frames) {
  // B12: with the frames in time order only the frames inside a note's window are looked at (two binary
  // searches); the checks and their order are unchanged, so the numbers are identical. Unsorted input
  // (not produced by the app) takes the original walk over every frame.
  const sorted = isSortedByTime(frames);
  return targets.map((target, index) => {
    const duration = target.t1 - target.t0;
    const windowStart = target.t0 + Math.min(0.35 * duration, 0.06);
    const windowEnd = target.t1 + scoringTail(target);
    const previousTarget = targets[index - 1];
    const nextTarget = targets[index + 1];
    let candidates = frames;
    if (sorted) {
      const { start, end } = frameRange(frames, windowStart, windowEnd);
      candidates = frames.slice(start, end);
    }
    const usable = candidates.filter((frame) => {
      if (frame.m == null || frame.t < windowStart || frame.t > windowEnd) return false;
      // A1: judged as sung. Frames more than 450 cents away are not this note (they are noise or another note),
      // EXCEPT frames about an octave away (1200 +- 150): a voice in the wrong octave is "off", not "missed".
      const sung = cents(frame.m, target.m);
      if (Math.abs(sung) > 450 && !isOctaveAway(sung)) return false;
      // Which note a frame belongs to is judged octave-equivalently (err), so the boundary rules below work the same
      // for a voice an octave away as for one in the piano's octave.
      const centsOff = Math.abs(err(frame.m, target.m));
      // Near the end of this note, a frame that is closer to the next note belongs to that note.
      if (nextTarget && nextTarget.m != target.m && frame.t > target.t1 - 0.03 && Math.abs(err(frame.m, nextTarget.m)) < centsOff) return false;
      // Near the start, a frame closer to the previous note is still the previous note's tail.
      if (previousTarget && previousTarget.m != target.m && frame.t < target.t0 + 0.2 && Math.abs(err(frame.m, previousTarget.m)) < centsOff) return false;
      return true;
    });
    if (usable.length < 3) return { ...target, miss: true };
    const sungCents = usable.map((frame) => cents(frame.m, target.m));
    const medianCents = median(sungCents);
    return {
      ...target,
      med: medianCents,
      // A1: the voice is about an octave from the piano (flagged so the report can say so gently).
      octaveOff: isOctaveAway(medianCents),
      // Steadiness ignores wild outliers (more than 150 cents from the median).
      sd: stdDev(sungCents.filter((c) => Math.abs(c - medianCents) < 150)),
      clar: mean(usable.map((frame) => frame.c)),
      ring: mean(usable.map((frame) => frame.ring)),
    };
  });
}

/** The cheer line of a stopped run (it is never compared with earlier runs). */
export const PARTIAL_CHEER = 'Partial run. Not saved to your journey.';

// Pick a label from three words by two thresholds (lower value = first word).
const pickLabel = (value, firstLimit, secondLimit, words) => (value < firstLimit ? words[0] : value < secondLimit ? words[1] : words[2]);

/** A1: the report tip when most notes were sung about an octave away from the piano. */
export const OCTAVE_TIP = "It sounds like you're singing an octave below the piano (or above). Try matching the piano's octave. If it feels too low or high, change the range in the editor.";

/** A2: the report line when the piano was heard through the microphone. */
export const LEAK_NOTE = 'Your score may be a little generous this time. I could hear the piano through the mic.';

// A note that is an octave off is "off" (it never counts as in tune), but the report's averages use how far it is
// from the nearest octave, so one such note does not turn "average cents off" into 1200.
const statCents = (result) => (result.octaveOff ? result.med - 1200 * Math.round(result.med / 1200) : result.med);

/**
 * Everything the report screen shows, as plain data.
 *  - targets, frames: the session; frames are as recorded (not yet shifted by the voice lag)
 *  - voiceLag: the current lag estimate (seconds)
 *  - previousRuns: earlier history entries for this exercise, newest first ({pct, clarity, ring, sound})
 *  - partial: a stopped run. `targets` is then only the notes that finished: every number is based on
 *    those notes alone, the cheer line does not compare with earlier runs, and the result is not saveable.
 *  - narrowBand (A3): the mic input is narrow-band (see tone.js): tone rows and tone tips are left out
 *  - pianoLeak (A2): the piano was heard through the mic: the report says the score may be generous
 * Returns {voiceLag (updated), results, heardCount, total, inTune, pct, avgAbs, lean, stability, clarity,
 * ring, toneCount (how many notes the tone numbers rest on), missCount, subtitle, rows [{name, value 0..100, label}], tips, good, cheer, hasTrillNotes, saveable,
 * sound (the run's main sound), toneHidden, octaveMode, leakNote (string, '' when none)}.
 */
export function summarizeSession({ targets, frames, voiceLag, previousRuns, partial = false, narrowBand = false, pianoLeak = false }) {
  // A1: a detector octave glitch is neither scored nor used to find the lag.
  const cleanFrames = dropOctaveGlitches(frames);
  const estimate = estimateLag(cleanFrames, targets);
  const lag = estimate != null ? estimate : voiceLag;
  const results = scoreNotes(targets, cleanFrames.map((frame) => ({ ...frame, t: frame.t - lag })));
  const heard = results.filter((result) => !result.miss);
  const total = results.length;
  const inTune = heard.filter((result) => Math.abs(result.med) <= 25).length;
  const pct = total ? Math.round((inTune / total) * 100) : 0;
  const saveable = !partial && heard.length > 0;

  // A1: most heard notes about an octave from the piano: say so gently, and leave out the advice that only makes sense in-octave.
  const octaveMode = heard.length > 0 && heard.filter((result) => result.octaveOff).length / heard.length > 0.5;

  // Tone readings are unreliable for buzzy sounds, so tone stats use only the non-trill notes.
  const toneNotes = heard.filter((result) => !result.trill);
  const allTrill = heard.length > 0 && toneNotes.length === 0;
  // A3: narrow-band input hides the tone rows and tips altogether.
  const toneHidden = narrowBand || toneNotes.length === 0;
  const avgAbs = mean(heard.map((result) => Math.abs(statCents(result))));
  const lean = mean(heard.map(statCents));
  const stability = median((toneNotes.length ? toneNotes : heard).map((result) => result.sd)) ?? 0;
  const clarity = mean(toneNotes.map((result) => result.clar));
  const ring = mean(toneNotes.map((result) => result.ring));
  const missCount = total - heard.length;
  const stabilityLimit = allTrill ? 30 : 18;

  // A3: tone as a trend against the singer's own earlier runs of this exercise on this sound.
  const sound = mainSound(toneNotes.length ? toneNotes : heard);
  const tone = compareTone({ previousRuns, sound, clarity, ring });

  // Compare the lowest third of notes with the highest third.
  const byPitch = [...heard].sort((a, b) => a.m - b.m);
  const third = Math.max(1, Math.floor(byPitch.length / 3));
  const lowError = mean(byPitch.slice(0, third).map((result) => Math.abs(statCents(result))));
  const highError = mean(byPitch.slice(-third).map((result) => Math.abs(statCents(result))));
  // Average error per sound (vowel / syllable).
  const errorBySound = {};
  heard.forEach((result) => {
    if (result.syl) (errorBySound[result.syl] = errorBySound[result.syl] || []).push(Math.abs(statCents(result)));
  });

  const subtitle = !heard.length
    ? "Didn't hear you this time"
    : octaveMode
      ? 'Sounds like an octave away from the piano'
      : `Average ${Math.round(avgAbs)} cents off · tends ${Math.abs(lean) < 8 ? 'centred' : lean < 0 ? 'flat' : 'sharp'}`;

  const toneRows = toneHidden
    ? []
    : [
      { name: 'Clear tone', value: Math.max(0, Math.min(100, ((clarity - 0.75) / 0.23) * 100)), label: tone.ready ? CLARITY_WORDS[tone.clarityTrend] : baselineLabel(tone.count, saveable) },
      { name: 'Ring', value: Math.max(0, Math.min(100, ring * 400)), label: tone.ready ? RING_WORDS[tone.ringTrend] : baselineLabel(tone.count, saveable) },
    ];
  const rows = [
    { name: 'Pitch accuracy', value: Math.max(0, 100 - avgAbs * 1.6), label: pickLabel(avgAbs, 15, 35, ['Strong', 'Close', 'Growing']) },
    {
      name: 'Steadiness',
      value: Math.max(0, 100 - stability * (allTrill ? 1.5 : 2.5)),
      label: allTrill
        ? pickLabel(stability, 20, 35, ['Steady', 'Mostly steady', 'Settling'])
        : pickLabel(stability, 12, 25, ['Steady', 'Mostly steady', 'Settling']),
    },
    ...toneRows,
    { name: 'Notes held', value: total ? (heard.length / total) * 100 : 0, label: `${heard.length} of ${total}` },
  ];

  const tips = [];
  if (!heard.length) {
    tips.push("I couldn't hear you this time. Check the mic permission, keep the phone 30–50 cm away, and sing out. You've got this.");
  } else {
    if (octaveMode) tips.push(OCTAVE_TIP);
    if (!octaveMode && lean < -12) tips.push('Your notes tend to sit a touch low. Keep your breath energy up through the end of each phrase, especially on the way down. Think "up" as the notes descend.');
    if (!octaveMode && lean > 12) tips.push('Your notes tend to sit a touch high. Ease off the push: lighter volume and a relaxed jaw usually bring the pitch down.');
    if (!octaveMode && byPitch.length >= 6 && highError > lowError + 12) tips.push(`Your top notes are still settling in (around ${Math.round(highError)} cents vs ${Math.round(lowError)} at the bottom). Try a lighter, heady sound up high, open the vowel slightly, and stay at this top note until it settles before going higher.`);
    if (!octaveMode && byPitch.length >= 6 && lowError > highError + 12) tips.push("Your lowest notes have the most room to grow. Don't press down for them; keep them light and speech-like, and skip notes below your comfortable range.");
    const sounds = Object.keys(errorBySound);
    if (!octaveMode && sounds.length > 1) {
      const ranked = sounds.map((sound) => [sound, mean(errorBySound[sound])]).sort((a, b) => b[1] - a[1]);
      const worst = ranked[0];
      const best = ranked[ranked.length - 1];
      if (worst[1] > best[1] + 10) tips.push(`"${worst[0]}" is a little less settled (${Math.round(worst[1])} cents) than on "${best[0]}" (${Math.round(best[1])} cents). Try keeping the same mouth space and placement when you switch sounds.`);
    }
    if (stability >= stabilityLimit) tips.push(allTrill ? 'Pitch drifts during the trill. Keep the airflow steady and the lips loose; if the trill keeps stopping, lightly press your cheeks forward with your fingertips.' : 'Held notes are still finding their center. Aim for a steady, even airflow: practise a gentle "sss" hiss for 10 seconds, then sing the note with the same steady feeling. (A wide vibrato can also show up here.)');
    // A3: tone tips only once there is a baseline, and only when today is below the singer's own usual.
    if (!toneHidden && tone.ready && tone.clarityTrend === 'airier') tips.push('Your tone is on the airy side. Try starting notes with a gentle, clean onset, or warm up on "ng" or a hum to get the cords meeting more firmly.');
    if (!toneHidden && tone.ready && tone.ringTrend === 'softer') tips.push('Your sound is warm and soft. For more ring, try a buzzy "ng" or "nyah" and aim the sound forward, toward the front of your face.');
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
    if (!octaveMode && byPitch.length >= 6 && lowError + 12 < highError) good.push('Your lower notes were especially accurate.');
    if (!octaveMode && byPitch.length >= 6 && highError + 12 < lowError) good.push("Your top notes were especially accurate. That's the hard part!");
    if (!octaveMode && Math.abs(lean) < 8) good.push('You stayed centred: not habitually sharp or flat.');
    if (stability < (allTrill ? 20 : 12)) good.push(allTrill ? 'Your trill held a steady pitch.' : 'Your held notes were steady.');
    if (!toneHidden && clarity >= 0.92) good.push('Clear, focused tone.');
    if (total && heard.length / total >= 0.9) good.push('You sustained nearly every note.');
    const sounds = Object.keys(errorBySound);
    if (!octaveMode && sounds.length > 1) {
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
    toneHidden,
    sound,
    octaveMode,
    missCount,
    subtitle,
    rows,
    tips: tips.slice(0, 2),
    good: good.slice(0, 4),
    cheer,
    leakNote: pianoLeak ? LEAK_NOTE : '',
    hasTrillNotes: results.some((result) => result.trill),
    saveable,
  };
}
