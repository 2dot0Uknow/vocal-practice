// Data-shape versions. `vp_schema` says which shape the saved data has (absent = 1, how the app first saved it).
// migrate() runs once at startup, before the data is loaded, and brings saved data up to CURRENT_SCHEMA.
//
// Rules every step follows:
//  - a step is a pure function {exercises, history} -> {exercises, history}; it never mutates its input
//  - it keeps what it does not understand (unknown fields, odd entries): add things, never drop them
//  - it is safe to run twice
// migrate() itself only writes after every step has worked, writes vp_schema last, and puts everything
// back if a write fails. A broken step or a newer-than-known version leaves saved data exactly as it was.

import { KEYS } from './store.js';
import { SAMPLES } from './exercise.js';

export const CURRENT_SCHEMA = 2;

/**
 * 1 -> 2 (B9, A4): history entries get `exId`, the id of the exercise with the same name today.
 * With several exercises of one name the first wins. Entries with no match (deleted or renamed long ago)
 * stay without exId: they still count in the journey, they just are not compared in "best yet".
 * New fields from A4 (avgCents, lean, ...) only appear on new entries; old entries simply lack them.
 */
export function addExerciseIds({ exercises, history }) {
  if (!Array.isArray(history)) return { exercises, history };
  const idByName = new Map();
  if (Array.isArray(exercises)) {
    exercises.forEach((exercise) => {
      if (exercise && exercise.name != null && exercise.id != null && !idByName.has(exercise.name)) idByName.set(exercise.name, exercise.id);
    });
  }
  const linked = history.map((entry) => {
    if (!entry || typeof entry != 'object' || entry.exId != null || !idByName.has(entry.name)) return entry;
    return { ...entry, exId: idByName.get(entry.name) };
  });
  return { exercises, history: linked };
}

/** Steps in order. `from` is the version a step starts at; it produces version from + 1. */
export const STEPS = [{ from: 1, run: addExerciseIds }];

const parse = (raw) => {
  if (raw == null) return { present: false };
  try {
    return { present: true, value: JSON.parse(raw) };
  } catch (error) {
    return { present: true, unreadable: true };
  }
};

/**
 * Bring saved data up to date. `storage` is anything with getItem / setItem / removeItem (default localStorage).
 * Returns {from, to, changed, failed, data}. `data` ({vp_ex, vp_hist}) is the in-memory result and is only
 * given when something went wrong and the saved data could not be updated, so the app can run on it anyway.
 */
export function migrate(storage = globalThis.localStorage, { steps = STEPS, target = CURRENT_SCHEMA } = {}) {
  const result = { from: 1, to: 1, changed: false, failed: false, data: null };
  try {
    const rawVersion = storage.getItem(KEYS.schema);
    let version = 1;
    if (rawVersion != null) {
      version = Number(JSON.parse(rawVersion));
      if (!Number.isInteger(version) || version < 1) {
        console.warn(`Saved data has an unrecognised version (${rawVersion}); leaving it as it is.`);
        result.failed = true;
        return result;
      }
    }
    result.from = result.to = version;
    if (version > target) {
      console.warn(`Saved data is from a newer version of the app (schema ${version}); leaving it as it is.`);
      return result;
    }
    if (version == target) return result;

    const originals = {
      [KEYS.exercises]: storage.getItem(KEYS.exercises),
      [KEYS.history]: storage.getItem(KEYS.history),
    };
    const exercisesRead = parse(originals[KEYS.exercises]);
    const historyRead = parse(originals[KEYS.history]);
    // No saved library yet means the three built-in samples are shown, so link against those.
    let data = {
      exercises: exercisesRead.present ? exercisesRead.value : SAMPLES,
      history: historyRead.unreadable ? undefined : historyRead.value,
    };
    let reached = version;
    try {
      while (reached < target) {
        const step = steps.find((candidate) => candidate.from == reached);
        if (!step) throw new Error(`no migration from schema ${reached}`);
        data = step.run(data);
        reached++;
      }
    } catch (error) {
      console.warn('Could not update saved data; it is left as it was and this visit uses the unchanged data.', error);
      result.failed = true;
      result.data = data.history === undefined ? {} : { [KEYS.history]: data.history };
      return result;
    }

    // Write only what changed, the version last. If any write fails, put the old values back.
    const writes = [];
    if (historyRead.present && !historyRead.unreadable && data.history !== historyRead.value) writes.push([KEYS.history, JSON.stringify(data.history)]);
    const written = [];
    try {
      writes.forEach(([key, text]) => {
        storage.setItem(key, text);
        written.push(key);
      });
      storage.setItem(KEYS.schema, String(target));
    } catch (error) {
      console.warn('Could not save the updated data; it is left as it was and this visit uses the updated copy.', error);
      written.forEach((key) => {
        try {
          if (originals[key] == null) storage.removeItem(key);
          else storage.setItem(key, originals[key]);
        } catch (restoreError) {
          // Nothing more can be done.
        }
      });
      result.failed = true;
      result.data = data.history === undefined ? {} : { [KEYS.history]: data.history };
      return result;
    }
    result.to = target;
    result.changed = writes.length > 0;
    return result;
  } catch (error) {
    console.warn('Could not check the saved data version; leaving it as it is.', error);
    result.failed = true;
    return result;
  }
}
