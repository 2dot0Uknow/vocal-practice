// F6 and F10: the library's list operations and the first-launch range, as pure functions on arrays of exercises.
// Nothing here touches storage or the page; every function returns new arrays and leaves its input alone.

import { toMidi } from './music.js';

/** Move the exercise at `index` up (delta -1) or down (+1). Returns the same array when it cannot move. */
export function moveExercise(list, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** A copy named "<name> (copy)" with a new id, placed right after the original. Its history starts empty (history is linked by id). */
export function duplicateExercise(list, id, newId) {
  const at = list.findIndex((exercise) => exercise.id === id);
  if (at < 0) return { list, copy: null };
  const copy = { ...list[at], vows: [...list[at].vows], id: newId, name: `${list[at].name} (copy)` };
  return { list: [...list.slice(0, at + 1), copy, ...list.slice(at + 1)], copy };
}

/** Remove an exercise. Returns the new list and what Undo needs: {exercise, index}, or removed = null when it was not there. */
export function removeExercise(list, id) {
  const index = list.findIndex((exercise) => exercise.id === id);
  if (index < 0) return { list, removed: null };
  return { list: list.filter((exercise) => exercise.id !== id), removed: { exercise: list[index], index } };
}

/** Undo a removal: the same exercise (same id, so its history is still linked) back at its old position. Does nothing if its id is already there. */
export function restoreExercise(list, removed) {
  if (!removed || list.some((exercise) => exercise.id === removed.exercise.id)) return list;
  const at = Math.min(removed.index, list.length);
  return [...list.slice(0, at), removed.exercise, ...list.slice(at)];
}

// ---- F10: first launch ----

/** The question card shows only on a truly fresh profile: nothing saved, nothing sung, never answered or dismissed. */
export const shouldOnboard = ({ hasExercises, hasHistory, onboarded }) => !hasExercises && !hasHistory && !onboarded;

/** Read the two note boxes. Returns {ok: true, low, high} (MIDI) or {ok: false, field: 'low' | 'high', message}. */
export function readComfortableRange(lowText, highText) {
  const low = toMidi(lowText);
  const high = toMidi(highText);
  if (low == null) return { ok: false, field: 'low', message: 'Use a note like C3 or Eb3 for the lowest note.' };
  if (high == null) return { ok: false, field: 'high', message: 'Use a note like G3 or Bb3 for the highest note.' };
  if (high < low) return { ok: false, field: 'high', message: 'Put the lower note first, then the higher one.' };
  return { ok: true, low, high };
}

/**
 * Fit the sample exercises to a range of starting notes: each starts on `low` and keeps its own number of rounds (the span
 * between its start and end), but never starts a round above `high`. Other fields are untouched.
 */
export const rebaseSamples = (samples, low, high) => samples.map((sample) => ({
  ...sample,
  start: low,
  end: Math.max(low, Math.min(high, low + (sample.end - sample.start))),
}));
