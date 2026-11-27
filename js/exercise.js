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
 * B12: the plan of an exercise, round by round, with every time RELATIVE to the start of its round.
 * Nothing here knows about the clock, so a round can be placed on the song clock whenever it is reached
 * (and placed again for "Again", or never for "Skip"). Returns {rounds: [...]} where a round is
 *  - index, root (midi), length (seconds from the round's start to the next round's start)
 *  - cue:   {m: [midi...], off: 0, d}                     the chord before the round
 *  - notes: [{m, off, end, d, pass, syl, trill}]          what is sung; off / end are seconds from the round's start
 * A note's `end` is exactly the next note's `off` (no rounding drift between neighbours).
 */
export function planRounds(exercise) {
  const secondsPerBeat = 60 / exercise.bpm;
  const pattern = parsePat(exercise.pat);
  const roots = rootsOf(exercise, pattern);
  const passes = exercise.vows.length ? exercise.vows : [''];
  const rounds = roots.map((root, index) => {
    // Cue chord: root, major third, fifth.
    const cue = { m: [root, root + 4, root + 7], off: 0, d: secondsPerBeat * 1.5 };
    let offset = secondsPerBeat * 2 + CUE_GAP;
    const notes = [];
    passes.forEach((vowel, pass) => {
      if (pass) offset += secondsPerBeat;
      pattern.forEach((note) => {
        const duration = secondsPerBeat * (note.h ? exercise.hold : 1);
        const sound = exercise.rootVow && note.deg == 1 ? exercise.rootVow : vowel;
        const end = offset + duration;
        notes.push({ m: root + note.s, off: offset, end, d: duration, pass, syl: sound, trill: isTrill(sound) });
        offset = end;
      });
    });
    return { index, root, length: offset + secondsPerBeat, cue, notes };
  });
  return { rounds };
}

/**
 * Put one planned round on the song clock, starting at `start` seconds.
 * Returns {index, start, end (when the next round would start), targets, plays}:
 *  - targets: the notes to sing, {m (midi), t0, t1, round, pass, syl (sound), trill}
 *  - plays:   what the piano plays, {m: [midi...], t, d}: the cue chord, then the notes
 */
export function placeRound(round, start) {
  const targets = [];
  const plays = [{ m: round.cue.m, t: start + round.cue.off, d: round.cue.d }];
  round.notes.forEach((note) => {
    const t0 = start + note.off;
    plays.push({ m: [note.m], t: t0, d: note.d });
    targets.push({ m: note.m, t0, t1: start + note.end, round: round.index, pass: note.pass, syl: note.syl, trill: note.trill });
  });
  return { index: round.index, start, end: start + round.length, targets, plays };
}

/**
 * REFERENCE ONLY (the app no longer uses it): the whole exercise laid out on one fixed timeline starting at
 * startTime, exactly as the app did before B12. The characterization fixture pins its output, and
 * tests/rounds.test.js checks that placing the rounds one by one (planRounds + placeRound, driven by run.js)
 * gives the same times for an uninterrupted run. It adds times one after another, so its numbers can differ
 * from the per-round ones by about 1e-13 seconds.
 * Returns {targets, plays, end}; `end` is when the whole session is over.
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
