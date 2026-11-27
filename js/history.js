// The journey history (vp_hist): what one finished run saves, which earlier runs belong to an exercise,
// and the 200-entry cap. Pure: no storage, no DOM. Entries are newest first.

export const MAX_HISTORY = 200;

const roundTo = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * What gets saved for a finished run. The numbers come straight from summarizeSession(), so they match the report.
 *   name, exId   the exercise as it was called and its id (exId is what links later runs; name is a label)
 *   pct          % of notes landed in tune
 *   avgCents     average cents off, ignoring sharp / flat (whole number)
 *   lean         signed average cents: negative = flat, positive = sharp (whole number)
 *   steadiness   typical wobble on held notes in cents (1 decimal)
 *   clarity      0 to 1 (2 decimals), null when there were no tone notes (e.g. a pure lip trill)
 *   ring         0 to 1-ish (2 decimals), null when there were no tone notes
 *   topNote      MIDI number of the highest note landed within 50 cents, null if none
 *   rounds       rounds completed;  notes: notes in the run
 *   ts, date     when (Date.now() and a short display date such as "Nov 27")
 */
export function historyEntry(exercise, summary, now = new Date()) {
  const heard = summary.results.filter((result) => !result.miss);
  const landed = heard.filter((result) => Math.abs(result.med) <= 50);
  const hasTone = summary.toneCount > 0;
  return {
    name: exercise.name,
    ...(exercise.id ? { exId: exercise.id } : {}),
    pct: summary.pct,
    ts: now.getTime(),
    date: now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    avgCents: Math.round(summary.avgAbs),
    lean: Math.round(summary.lean),
    steadiness: roundTo(summary.stability, 1),
    clarity: hasTone ? roundTo(summary.clarity, 2) : null,
    ring: hasTone ? roundTo(summary.ring, 2) : null,
    topNote: landed.length ? Math.max(...landed.map((result) => result.m)) : null,
    rounds: new Set(summary.results.map((result) => result.round)).size,
    notes: summary.total,
  };
}

/** Earlier runs of this exercise, matched by its id (so renaming keeps the history). Newest first. */
export const previousRunsOf = (history, exercise) => history.filter((entry) => entry && exercise.id && entry.exId === exercise.id);

/** The history with a new run on the front, cut to the most recent MAX_HISTORY. */
export const addToHistory = (history, entry) => [entry, ...history].slice(0, MAX_HISTORY);

/** The name to show for an entry: the linked exercise's current name, else the name saved with the run. */
export const entryLabel = (entry, exercises) => exercises.find((exercise) => entry.exId != null && exercise.id === entry.exId)?.name ?? entry.name;
