// Thin wrapper around localStorage. Reads fall back to a default; writes never throw
// (private mode / full storage simply means nothing is remembered).

export const KEYS = {
  exercises: 'vp_ex',
  history: 'vp_hist',
  defaultRange: 'vp_def',
  pictureDelay: 'vp_lat',
  voiceLag: 'vp_vlag',
  theme: 'vp_theme',
};

export const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch (error) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Ignored on purpose: see the comment at the top of the file.
    }
  },
};
