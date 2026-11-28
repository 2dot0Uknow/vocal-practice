// Export / Import of everything the app keeps on the phone (P5). Pure: no DOM and no storage of its own;
// js/ui/data.js does the file and button work and hands in a store-like object where one is needed.
//
// A backup file is JSON:
//   { app: "vocal-practice", schema: 2, exportedAt: "2026-11-27T09:30:00.000Z",
//     data: { vp_ex: [...], vp_hist: [...], vp_def: {...}, vp_lat: 0.1, vp_vlag: 0.15, vp_theme: "dark", vp_onboarded: 1 } }
// `data` holds a key only when the phone has a value for it, so a restore can tell "automatic" from "set".

import { KEYS } from './store.js';
import { migrate, CURRENT_SCHEMA } from './migrate.js';
import { MAX_HISTORY } from './history.js';

export const BACKUP_APP = 'vocal-practice';

/** Every saved key that belongs in a backup: all of KEYS except the data-shape version, which the file carries as `schema`. */
export const BACKUP_KEYS = Object.values(KEYS).filter((key) => key !== KEYS.schema);

/** The backup file's contents. `read(key)` gives a saved value or undefined / null when there is none. */
export function buildBackup(read, now = new Date()) {
  const data = {};
  BACKUP_KEYS.forEach((key) => {
    const value = read(key);
    if (value !== undefined && value !== null) data[key] = value;
  });
  return { app: BACKUP_APP, schema: CURRENT_SCHEMA, exportedAt: now.toISOString(), data };
}

const pad = (number) => String(number).padStart(2, '0');

/** vocal-practice-backup-2026-11-27.json (the phone's local date). */
export const backupFileName = (now = new Date()) => `vocal-practice-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;

// ---- checking a file ----

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const NOT_A_BACKUP = "That doesn't look like a Vocal Practice backup. Pick a file made with Export.";
const DAMAGED = 'That backup file looks damaged, so I left everything as it was.';

/** Why one key's value is not usable, or null when it is fine. */
function problemWith(key, value) {
  switch (key) {
    case KEYS.exercises:
      return Array.isArray(value) && value.every((exercise) => isObject(exercise) && exercise.id != null && typeof exercise.pat === 'string' && isNumber(exercise.start) && isNumber(exercise.end) && (exercise.vows === undefined || Array.isArray(exercise.vows)))
        ? null
        : 'exercises';
    case KEYS.history:
      return Array.isArray(value) && value.every((entry) => isObject(entry) && (entry.ts === undefined || isNumber(entry.ts))) ? null : 'history';
    case KEYS.defaultRange:
      return isObject(value) && isNumber(value.start) && isNumber(value.end) ? null : 'range';
    case KEYS.pictureDelay:
    case KEYS.voiceLag:
      return isNumber(value) && value >= 0 && value <= 5 ? null : key;
    case KEYS.theme:
      return value === '' || value === 'light' || value === 'dark' ? null : 'theme';
    case KEYS.onboarded:
      return value === 1 || value === true ? null : 'onboarded';
    default:
      return null;
  }
}

/** The in-memory stand-in for localStorage that migrate() runs on. */
function memoryStorage(values) {
  const map = new Map(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

/**
 * Read a backup file's text. Returns {ok: true, schema, data, counts: {exercises, sessions}} (data already brought
 * up to the current data shape, only known keys) or {ok: false, message} with a friendly reason.
 */
export function parseBackup(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: NOT_A_BACKUP };
  }
  if (!isObject(file) || file.app !== BACKUP_APP) return { ok: false, message: NOT_A_BACKUP };
  if (!Number.isInteger(file.schema) || file.schema < 1) return { ok: false, message: DAMAGED };
  if (file.schema > CURRENT_SCHEMA) {
    return { ok: false, message: 'That backup was made by a newer version of the app. Update this app first (close and reopen it), then try again.' };
  }
  if (!isObject(file.data)) return { ok: false, message: DAMAGED };

  let data = {};
  for (const key of BACKUP_KEYS) {
    const value = file.data[key];
    if (value === undefined || value === null) continue;
    if (problemWith(key, value)) return { ok: false, message: DAMAGED };
    data[key] = value;
  }

  if (file.schema < CURRENT_SCHEMA) {
    // An older backup goes through the same steps as old data on the phone.
    const storage = memoryStorage({ ...data, [KEYS.schema]: file.schema });
    const result = migrate(storage);
    if (result.failed || result.to !== CURRENT_SCHEMA) return { ok: false, message: DAMAGED };
    data = { ...data };
    [KEYS.exercises, KEYS.history].forEach((key) => {
      const raw = storage.getItem(key);
      if (raw != null) data[key] = JSON.parse(raw);
    });
  }
  return { ok: true, schema: file.schema, data, counts: countsOf(data) };
}

/** How much a backup holds, for the summary shown before anything is changed. */
export const countsOf = (data) => ({
  exercises: Array.isArray(data[KEYS.exercises]) ? data[KEYS.exercises].length : 0,
  sessions: Array.isArray(data[KEYS.history]) ? data[KEYS.history].length : 0,
});

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "12 exercises, 48 sessions" */
export const describeCounts = ({ exercises, sessions }) => `${plural(exercises, 'exercise')}, ${plural(sessions, 'session')}`;

// ---- Merge and Replace ----

/** Which run an entry is: when it happened and which exercise (entries from long ago may lack either). */
const entryKey = (entry) => `${entry.ts ?? `${entry.name}|${entry.date}`}|${entry.exId ?? ''}`;

/**
 * Merge: exercises by id (what is on the phone stays, new ones are added after it); history is the union of both
 * (same ts + exercise counts once, the phone's copy wins), newest first, at most MAX_HISTORY.
 * Settings (range, picture delay, theme, ...) are left alone. Returns the values to save, keyed by storage key.
 */
export function mergeData(current, incoming) {
  const ownExercises = Array.isArray(current.exercises) ? current.exercises : [];
  const ownIds = new Set(ownExercises.map((exercise) => exercise.id));
  const newExercises = (incoming[KEYS.exercises] || []).filter((exercise) => !ownIds.has(exercise.id));
  const seen = new Set();
  const history = [...(Array.isArray(current.history) ? current.history : []), ...(incoming[KEYS.history] || [])].filter((entry) => {
    const key = entryKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const decorated = history.map((entry, index) => ({ entry, index }));
  decorated.sort((a, b) => (b.entry.ts ?? -Infinity) - (a.entry.ts ?? -Infinity) || a.index - b.index);
  const writes = { [KEYS.history]: decorated.map(({ entry }) => entry).slice(0, MAX_HISTORY) };
  // The library only becomes a saved list when something is added (otherwise the built-in samples stay as they are).
  if (newExercises.length) writes[KEYS.exercises] = [...ownExercises, ...newExercises];
  return writes;
}

/** Replace: every key takes the backup's value; a key the backup does not have is cleared (undefined). */
export function replaceData(incoming) {
  return Object.fromEntries(BACKUP_KEYS.map((key) => [key, incoming[key]]));
}

/**
 * Save `writes` (key -> value, undefined = clear) through `target` ({get, set, remove}, like the app's store), then the data-shape version.
 * If anything fails to save, what was there before is put back and false is returned.
 */
export function applyWrites(target, writes) {
  const keys = Object.keys(writes);
  const before = new Map(keys.map((key) => [key, target.get(key, undefined)]));
  const restore = () => before.forEach((value, key) => (value === undefined ? target.remove(key) : target.set(key, value)));
  for (const key of keys) {
    if (writes[key] === undefined) {
      target.remove(key);
    } else if (!target.set(key, writes[key])) {
      restore();
      return false;
    }
  }
  if (!target.set(KEYS.schema, CURRENT_SCHEMA)) {
    restore();
    return false;
  }
  return true;
}
