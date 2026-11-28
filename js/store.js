// Thin wrapper around localStorage. Reads fall back to a default; writes never throw.
// A write that fails (private mode, full storage) returns false, and the first failure of a visit also calls the handler
// given to onWriteFailed(), so the person can be told once (P6) instead of on every write.

export const KEYS = {
  exercises: 'vp_ex',
  history: 'vp_hist',
  defaultRange: 'vp_def',
  pictureDelay: 'vp_lat',
  voiceLag: 'vp_vlag',
  theme: 'vp_theme',
  onboarded: 'vp_onboarded', // 1 once the first-launch range card was answered or dismissed (F10)
  schema: 'vp_schema', // integer data-shape version, see migrate.js (absent = 1)
};

// Values to use instead of what is saved, for keys whose migration failed (see migrate.js and main.js).
// Writing a key saves for real and drops its stand-in.
const inMemory = new Map();

let failureHandler = null;
let failureReported = false;

export const store = {
  /** `handler(error)` runs on the first failed write of the visit (and never again). Pass null to stop. */
  onWriteFailed(handler) {
    failureHandler = handler;
    failureReported = false;
  },
  /** Use these values (key -> value) for reads until the key is next written. */
  useInMemory(values) {
    Object.entries(values).forEach(([key, value]) => inMemory.set(key, value));
  },
  get(key, fallback) {
    if (inMemory.has(key)) return inMemory.get(key) ?? fallback;
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch (error) {
      return fallback;
    }
  },
  /** Save `value` under `key`. Returns true when it was saved, false when the browser refused. */
  set(key, value) {
    inMemory.delete(key);
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      if (failureHandler && !failureReported) {
        failureReported = true;
        try {
          failureHandler(error);
        } catch (handlerError) {
          // Telling the person must never make a failed save worse.
        }
      }
      return false;
    }
  },
  remove(key) {
    inMemory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch (error) {
      // Ignored on purpose.
    }
  },
};
