// F2, F3, F8: small pure rules for the practice flow: the round line, the count-in word, when the readouts fade,
// and the "practice all" set summary. No DOM, no audio.

import { noteName } from './music.js';

/** "Round 3 of 12 · starting on D3". `index` counts from 0. */
export const roundLabel = (index, total, rootMidi, spelling) => `Round ${index + 1} of ${total} · starting on ${noteName(rootMidi, spelling)}`;

/** How far through the run (0 to 1): finished rounds plus the share of the current round. */
export function progressFraction(index, total, within = 0) {
  if (!total) return 0;
  const share = Math.max(0, Math.min(1, within));
  return Math.max(0, Math.min(1, (index + share) / total));
}

export const COUNT_IN_WORD = 'Ready…';

/**
 * F2: what the "Sing" readout says. During the first cue chord (nobody sings yet) it says "Ready…"; after that,
 * the sound of the next note (or a dash when there is none). Times are on the song clock.
 */
export function singReadout({ now, firstChordEnd, syllable }) {
  if (firstChordEnd != null && now < firstChordEnd) return COUNT_IN_WORD;
  return syllable || '–';
}

/** F3: how long (ms) without a voiced frame before "You" and the needle fade to a dash. */
export const FADE_AFTER_MS = 300;

/** F3: has the voice been silent long enough to fade? `lastVoicedAt` is null before anything was heard (nothing to fade). */
export const readoutsFaded = (lastVoicedAt, nowMs) => lastVoicedAt == null || nowMs - lastVoicedAt > FADE_AFTER_MS;

/** F8: "Exercise 2 of 5". */
export const setLabel = (position, total) => `Exercise ${position} of ${total}`;

/** F8: the set's results with this one added (replacing an earlier result for the same exercise, e.g. after "Go again"). */
export function recordSetResult(results, entry) {
  const at = results.findIndex((result) => result.id === entry.id);
  if (at < 0) return [...results, entry];
  return results.map((result, i) => (i === at ? entry : result));
}

/**
 * F8: the lines of the set summary card. A result is {id, name, pct, saved, partial}. A stopped run is marked
 * "stopped, not saved"; a finished run that heard nothing, "not saved".
 */
export const setSummaryRows = (results) => results.map((result) => ({
  name: result.name,
  text: `${result.pct}%${result.partial ? ' · stopped, not saved' : result.saved ? '' : ' · not saved'}`,
}));
