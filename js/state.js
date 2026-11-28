// In-memory app state shared by the screens. Persistent copies live in localStorage (see store.js).

import { store, KEYS } from './store.js';
import { normEx, SAMPLES } from './exercise.js';
import { requestPersistence } from './persist.js';

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

/** Said when the browser refuses a save (as a toast once per visit, and inline where the person is working). */
export const SAVE_FAILED_MESSAGE = "I couldn't save that. Your phone's storage might be full. Try exporting a backup.";

/** Save the library. Returns false when the browser would not store it (the person is told once, see main.js). */
export function saveExercises() {
  const saved = store.set(KEYS.exercises, state.exercises);
  if (saved) requestPersistence();   // P5: once the library is worth keeping, ask the browser not to clear it
  return saved;
}

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
