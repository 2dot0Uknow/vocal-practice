// In-memory app state shared by the screens. Persistent copies live in localStorage (see store.js).

import { store, KEYS } from './store.js';
import { normEx, SAMPLES } from './exercise.js';

export const DEFAULT_RANGE = { start: 48, end: 55 };

export const state = {
  exercises: [],                      // the library
  defaultRange: { ...DEFAULT_RANGE }, // range used when a converted line gives none (MIDI start / end)
  queue: [],                          // exercises still to come in "Practice all in order"
  historyShown: 3,                    // how many journey entries the library shows
};

export function loadState() {
  state.exercises = (store.get(KEYS.exercises, null) || SAMPLES).map(normEx);
  state.defaultRange = store.get(KEYS.defaultRange, DEFAULT_RANGE);
}

export const saveExercises = () => store.set(KEYS.exercises, state.exercises);
