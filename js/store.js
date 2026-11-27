// Thin wrapper around localStorage. Reads fall back to a default; writes never throw
// (private mode / full storage simply means nothing is remembered).

export const KEYS = {
  exercises: 'vp_ex',
  history: 'vp_hist',
  defaultRange: 'vp_def',
  pictureDelay: 'vp_lat',
  voiceLag: 'vp_vlag',
  theme: 'vp_theme',
  schema: 'vp_schema', // integer data-shape version, see migrate.js (absent = 1)
};

// Values to use instead of what is saved, for keys whose migration failed (see migrate.js and main.js).
// Writing a key saves for real and drops its stand-in.
const inMemory = new Map();

export const store = {
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
  set(key, value) {
    inMemory.delete(key);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Ignored on purpose: see the comment at the top of the file.
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
