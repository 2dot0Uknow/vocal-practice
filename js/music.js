// Note names, pitch conversions and the pattern language ("1-3-5-8~-5-3-1").
// Pure functions only: no DOM, no audio, no storage.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Semitones above the root for scale degrees 1..7 (major scale).
const MAJOR_SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

// A single exercise never runs for more than this many rounds.
export const MAX_ROUNDS = 48;

// Flat spellings, for exercises written with flats.
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Pitch classes spelled as flats when nothing is known about how the exercise was written:
// Db, Eb, Ab, Bb (but F#, not Gb).
const AUTO_FLAT = new Set([1, 3, 8, 10]);

/**
 * MIDI number -> "C4" style name. `spelling` picks the accidentals:
 *  - 'b' (or true): flats everywhere (Gb, Db, ...)
 *  - 'auto': Db, Eb, Ab, Bb and F# (what an exercise shows when it has no saved spelling)
 *  - anything else, including nothing: sharps everywhere (C#, D#, F#, G#, A#)
 */
export function noteName(midi, spelling) {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  const pitchClass = ((rounded % 12) + 12) % 12;
  const flat = spelling === 'b' || spelling === true || (spelling === 'auto' && AUTO_FLAT.has(pitchClass));
  return (flat ? FLAT_NAMES : NOTE_NAMES)[pitchClass] + octave;
}

/** The spelling an exercise shows its notes in: its saved `spell` ('b' or '#'), else 'auto'. */
export const spellingOf = (exercise) => (exercise && (exercise.spell === 'b' || exercise.spell === '#') ? exercise.spell : 'auto');

/** A single typed note name ("eb4", "F#3") -> 'b', '#', or '' when it has no accidental. */
export function accidentalOf(note) {
  const match = /^\s*[A-Ga-g]\s*([#b])\s*\d\s*$/.exec(String(note || ''));
  return match ? match[1] : '';
}

/** The accidental typed in note names inside `text` ("Eb5" -> 'b', "F#3" -> '#'), or '' when none was typed. */
export function typedSpelling(text) {
  const match = /(?:^|[^A-Za-z])[A-G]\s?([#b])\s?\d/.exec(String(text || '').replace(/♭/g, 'b').replace(/♯/g, '#'));
  return match ? (match[1] == 'b' ? 'b' : '#') : '';
}

/** "Eb5" / "c#3" -> MIDI number, or null if it is not a note name. */
export function toMidi(text) {
  const match = /^\s*([A-Ga-g])\s*([#b]?)\s*(\d)\s*$/.exec(text || '');
  if (!match) return null;
  const semitoneOfLetter = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
  const accidental = match[2] == '#' ? 1 : match[2] == 'b' ? -1 : 0;
  return semitoneOfLetter + accidental + (+match[3] + 1) * 12;
}

/** MIDI number -> frequency in Hz (A4 = 69 = 440 Hz). */
export const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Frequency in Hz -> (fractional) MIDI number. */
export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

/**
 * Parse a pattern like "1-3-5-8~-5-3-1". Tokens are [b|#]degree[~], where ~ means "hold".
 * Returns [{deg, s, h}] (s = semitones above the round's root, h = held) or null when the
 * text is not a valid pattern of at least `minNotes` notes. One note is a valid pattern ("1~" is a sustain drill);
 * the text converter asks for two (minNotes = 2), because a lone digit in prose is usually not a pattern.
 */
export function parsePat(pattern, minNotes = 1) {
  const tokens = String(pattern).split(/[\s,\-]+/).filter(Boolean);
  const notes = [];
  for (const token of tokens) {
    const match = /^([b#]?)(\d{1,2})(~?)$/.exec(token);
    if (!match) return null;
    const degree = +match[2];
    if (degree < 1 || degree > 15) return null;
    const accidental = match[1] == '#' ? 1 : match[1] == 'b' ? -1 : 0;
    // Degrees 8..15 continue into the next octave: degree 8 = root + 12.
    const semitones = MAJOR_SCALE_SEMITONES[(degree - 1) % 7] + 12 * Math.floor((degree - 1) / 7) + accidental;
    notes.push({ deg: degree, s: semitones, h: !!match[3] });
  }
  return notes.length >= minNotes && notes.length > 0 ? notes : null;
}

/**
 * The root note (MIDI) of every round of an exercise.
 *  - exercise.top: start..end is the whole range sung, so roots run from "lowest note = start"
 *    up to "highest note = end".
 *  - otherwise start..end are the starting notes, stepping up or down depending on direction.
 *  - exercise.both: come back down again after reaching the top.
 * Each leg is capped at MAX_ROUNDS rounds.
 */
export function rootsOf(exercise, notes) {
  const offsets = notes.map((note) => note.s);
  const highestOffset = Math.max(...offsets);
  const lowestOffset = Math.min(...offsets);
  let roots = [];
  if (exercise.top) {
    const lowNote = Math.min(exercise.start, exercise.end);
    const highNote = Math.max(exercise.start, exercise.end);
    const firstRoot = lowNote - lowestOffset;
    const lastRoot = Math.max(firstRoot, highNote - highestOffset);
    for (let root = firstRoot; root <= lastRoot && roots.length < MAX_ROUNDS; root += exercise.step) roots.push(root);
  } else {
    const direction = exercise.end >= exercise.start ? 1 : -1;
    for (let root = exercise.start; direction > 0 ? root <= exercise.end : root >= exercise.end; root += exercise.step * direction) {
      roots.push(root);
      if (roots.length >= MAX_ROUNDS) break;
    }
  }
  if (exercise.both && roots.length > 1) roots = roots.concat(roots.slice(0, -1).reverse());
  return roots;
}
