// The exercise model and the timeline built from it.

import { parsePat, rootsOf, noteName, spellingOf } from './music.js';

/** Fill in defaults so every exercise (saved, sample or converted) has the same shape. */
export const normEx = (exercise) => ({
  id: exercise.id || 'x' + Date.now() + Math.random().toString(36).slice(2, 6),
  name: exercise.name || exercise.pat,
  pat: exercise.pat,
  vows: exercise.vows || (exercise.vow ? [exercise.vow] : []),
  rootVow: exercise.rootVow || '',
  start: exercise.start,
  end: exercise.end,
  top: !!exercise.top,
  both: !!exercise.both,
  step: exercise.step || 1,
  bpm: exercise.bpm || 90,
  hold: exercise.hold || 2,
  // Optional: how the notes were written ('b' flats, '#' sharps). Absent = automatic spelling.
  ...(exercise.spell == 'b' || exercise.spell == '#' ? { spell: exercise.spell } : {}),
});

/** Shown the very first time, before anything has been saved. */
export const SAMPLES = [
  { id: 's1', name: '5-note scale', pat: '1-2-3-4-5-4-3-2-1~', vows: ['ah'], start: 48, end: 55 },
  { id: 's2', name: 'Arpeggio lip trill', pat: '1-3-5-8-5-3-1~', vows: ['lip trill'], start: 48, end: 53 },
  { id: 's3', name: 'Sustain on "ng"', pat: '1~-5~-1~', vows: ['ng'], start: 48, end: 52, bpm: 60, hold: 4 },
].map(normEx);

// Sounds like these (lip trills, rolls, raspberries) buzz, so they are analysed in "trill mode".
const TRILL_SOUND = /trill|roll|bubble|raspberr|brr|lip/i;
export const isTrill = (sound) => TRILL_SOUND.test(sound || '');

// Extra seconds of space between the cue chord's slot and the round's first note.
const CUE_GAP = 1;

/**
 * Lay an exercise out on a timeline starting at startTime (seconds).
 * Returns:
 *  - targets: the notes to sing, {m (midi), t0, t1, round, pass, syl (sound), trill}
 *  - plays:   everything the piano plays, {m: [midi...], t, d}: a cue chord before each round, then the notes
 *  - end:     when the whole session is over
 */
export function buildSession(exercise, startTime) {
  const secondsPerBeat = 60 / exercise.bpm;
  const notes = parsePat(exercise.pat);
  const roots = rootsOf(exercise, notes);
  const passes = exercise.vows.length ? exercise.vows : [''];
  const targets = [];
  const plays = [];
  let t = startTime;
  roots.forEach((root, round) => {
    // Cue chord: root, major third, fifth.
    plays.push({ m: [root, root + 4, root + 7], t, d: secondsPerBeat * 1.5 });
    t += secondsPerBeat * 2 + CUE_GAP;
    passes.forEach((vowel, pass) => {
      if (pass) t += secondsPerBeat;
      notes.forEach((note) => {
        const duration = secondsPerBeat * (note.h ? exercise.hold : 1);
        plays.push({ m: [root + note.s], t, d: duration });
        const sound = exercise.rootVow && note.deg == 1 ? exercise.rootVow : vowel;
        targets.push({ m: root + note.s, t0: t, t1: t + duration, round, pass, syl: sound, trill: isTrill(sound) });
        t += duration;
      });
    });
    t += secondsPerBeat;
  });
  return { targets, plays, end: t + 0.3 };
}

/** The one-line description under an exercise's name, e.g. "1 3 5 · ah · C3–G3 · 90 bpm". */
export const describeExercise = (exercise) => `${exercise.pat.replace(/-/g, ' ')}${exercise.vows.length ? ' · ' + exercise.vows.join(' / ') : ''}${exercise.rootVow ? ' (root: ' + exercise.rootVow + ')' : ''} · ${noteName(exercise.start, spellingOf(exercise))}–${noteName(exercise.end, spellingOf(exercise))}${exercise.top ? ' range' : ''} · ${exercise.bpm} bpm`;
