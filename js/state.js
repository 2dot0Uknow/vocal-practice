// In-memory app state shared by the screens. Persistent copies live in localStorage (see store.js).

import { store, KEYS } from './store.js';
import { normEx, SAMPLES } from './exercise.js';

export const DEFAULT_RANGE = { start: 48, end: 55 };

export const state = {
  exercises: [],                      // the library
  defaultRange: { ...DEFAULT_RANGE }, // range used when a converted line gives none (MIDI start / end)
  queue: [],                          // exercises still to come in "Practice all in order"
  set: null,                          // "Practice all" in progress: {total, position (1-based), results: [...]} (F8), else null
  historyShown: 3,                    // how many journey entries the library shows
};

export function loadState() {
  state.exercises = (store.get(KEYS.exercises, null) || SAMPLES).map(normEx);
  state.defaultRange = store.get(KEYS.defaultRange, DEFAULT_RANGE);
}

export const saveExercises = () => store.set(KEYS.exercises, state.exercises);

/** Start "Practice all in order": the first exercise is the current one, the rest wait in the queue. */
export function startSet(exercises) {
  state.queue = exercises.slice(1);
  state.set = { total: exercises.length, position: 1, results: [] };
  return exercises[0];
}

/** Leave "Practice all" (Back, Done, or opening a single exercise). */
export function endSet() {
  state.queue = [];
  state.set = null;
}
