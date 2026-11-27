// Characterization: these pin down what the converter does TODAY, including answers that are
// plainly wrong (later PRs fix those and update the expectations deliberately).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseAll } from '../js/converter.js';
import { toMidi } from '../js/music.js';
import { normEx } from '../js/exercise.js';
import { fixture, assertSame, withoutId } from './helpers/fixture.js';
import { ALT_RANGE } from './tools/cases.mjs';

const DEFAULT_RANGE = { start: 48, end: 55 };
// parseLine's result also carries review-card extras (guessed, guessKind, guessNote, original). Those are not part of
// the saved exercise, so the pinned comparisons leave them out (and a test below checks them).
const withoutReviewExtras = ({ guessed, guessKind, guessNote, original, ...exercise }) => exercise;
const run = (line, range = DEFAULT_RANGE) => {
  const result = parseLine(line, range);
  return result ? withoutReviewExtras(withoutId(result)) : null;
};

// Pinned expectations that changed ON PURPOSE. The fixture file still holds the original behaviour; these patches
// are applied on top, line by line, so every other pinned line stays exactly as the original app had it.
const CHANGED_ON_PURPOSE = {
  // B7: the line wrote a flat, so the exercise remembers 'b' (shown as Eb, not D#).
  '- Lip roll arpeggios, E2 - E flat 5': { spell: 'b' },
  // B6: "x2" is a repeat count, not a note.
  '1 2 3 4 5 4 3 2 1 x2 on nay': { pat: '1-2-3-4-5-4-3-2-1~' },
  // B6: "hold 5 for 4 beats" holds the existing last 5 for 4 beats; the name is built from the pattern.
  '1-3-5 hold 5 for 4 beats': { name: '1-3-5~', pat: '1-3-5~', hold: 4 },
  // B6 (name built from pattern + sound, not "Bb") and B7 (typed a flat).
  'Bb2 to F4 lip trills 1 3 5 3 1': { name: '1-3-5-3-1~ on lip trill', spell: 'b' },
  // B6: the trailing "up to A" is cut from the name.
  'Sirens up to A4': { name: 'Sirens' },
};
const expectedFor = (line, expected) => ({ ...expected, ...CHANGED_ON_PURPOSE[line] });

test('parseLine matches the original on the four textarea placeholder lines and 20 other lines', () => {
  assert.equal(fixture.parseLine.length, 24);
  for (const { line, expected } of fixture.parseLine) assertSame(run(line), expected && expectedFor(line, expected), JSON.stringify(line));
});

test('parseLine uses the range it is given when a line has none', () => {
  for (const { line, expected } of fixture.parseLineAltRange) assertSame(run(line, ALT_RANGE), expected && expectedFor(line, expected), JSON.stringify(line));
});

test('placeholder line 1: lip roll arpeggios, E2 - E flat 5', () => {
  const exercise = run('- Lip roll arpeggios, E2 - E flat 5');
  assert.equal(exercise.name, 'Lip roll arpeggios');
  assert.equal(exercise.pat, '1-3-5-8-5-3-1~');
  assert.deepEqual(exercise.vows, ['lip roll']);
  assert.equal(exercise.start, toMidi('E2'));
  assert.equal(exercise.end, toMidi('Eb5'));
  assert.equal(exercise.top, true, 'a dash means the whole range is sung');
});

test('placeholder line 2: two sounds become two passes', () => {
  const exercise = run('- 1, 3, 2, 4, 3, 5, 4, 3, 2, 1 once with gee and once with gah');
  assert.equal(exercise.pat, '1-3-2-4-3-5-4-3-2-1~');
  assert.deepEqual(exercise.vows, ['gee', 'gah']);
  assert.equal(exercise.name, '1-3-2-4-3-5… on gee/gah');
});

test('placeholder line 3: hold and octave words', () => {
  assert.equal(run('- 1 3 5 hold octave, then 7, 8, 9 then down all the way back to 1').pat, '1-3-5-8~-7-8-9-8-7-6-5-4-3-2-1');
});

test('placeholder line 4: etc... to the octave, sound on root and on the intervals', () => {
  const exercise = run('- Intervals, 1,2,1,3,1,4, etc... to the octave. Eee on root, yah on the intervals');
  assert.equal(exercise.pat, '1-2-1-3-1-4-1-5-1-6-1-7-1-8~');
  assert.equal(exercise.rootVow, 'ee');
  assert.deepEqual(exercise.vows, ['yah']);
});

test('parseLine skips empty lines and parseAll converts one exercise per line', () => {
  assert.equal(parseLine('   ', DEFAULT_RANGE), null);
  assert.equal(parseLine('', DEFAULT_RANGE), null);
  const all = parseAll(fixture.parseAll.text, DEFAULT_RANGE).map(withoutId).map(withoutReviewExtras);
  const lines = fixture.parseAll.text.split('\n');
  assertSame(all, fixture.parseAll.expected.map((expected, i) => expectedFor(lines[i], expected)));
  assert.equal(parseAll('\n\n1-3-5 on ah\n\n', DEFAULT_RANGE).length, 1);
});

test('exercises get a unique id each time', () => {
  const a = parseLine('1-3-5', DEFAULT_RANGE);
  const b = parseLine('1-3-5', DEFAULT_RANGE);
  assert.ok(a.id && b.id && a.id !== b.id);
});

// B6: the four lines that used to parse wrongly.
test('B6: x2, 2x, "x 2", "times 2" and "twice" are repeat counts, not notes', () => {
  for (const repeat of ['x2', '2x', 'x 2', 'times 2', 'twice', 'X2']) {
    assert.equal(run(`1 2 3 4 5 4 3 2 1 ${repeat} on nay`).pat, '1-2-3-4-5-4-3-2-1~', repeat);
  }
  const exercise = run('1 2 3 4 5 4 3 2 1 x2 on nay');
  assert.deepEqual(exercise.vows, ['nay']);
  assert.equal(exercise.name, '1-2-3-4-5-4… on nay');
  assert.equal(run('1 3 5 2 x').pat, '1-3-5~', 'a bare "x" after a note is not a note either');
});

test('B6: "hold 5 for 4 beats" holds the existing last note for 4 beats', () => {
  const exercise = run('1-3-5 hold 5 for 4 beats');
  assert.equal(exercise.pat, '1-3-5~');
  assert.equal(exercise.hold, 4);
});

test('B6: other ways to say how long to hold, clamped to the editor\'s 1-4 beats', () => {
  assert.deepEqual([run('1-3-5 hold for 3 beats').pat, run('1-3-5 hold for 3 beats').hold], ['1-3-5~', 3]);
  assert.deepEqual([run('1-3-5, 4 beat hold').pat, run('1-3-5, 4 beat hold').hold], ['1-3-5~', 4]);
  assert.equal(run('1-3-5 hold 5 for 9 beats').hold, 4);
  assert.equal(run('1-3-5 hold 5 for 0 beats').hold, 1);
  assert.equal(run('1-3-5').hold, 2, 'no hold phrase: the usual two beats');
  // Holding a note that is not last marks the last note with that degree.
  assert.equal(run('1-3-5-3-1 hold 3 for 4 beats').pat, '1-3-5-3~-1');
});

test('B6: a line that leads with a note name or range gets a name built from pattern + sound', () => {
  assert.equal(run('Bb2 to F4 lip trills 1 3 5 3 1').name, '1-3-5-3-1~ on lip trill');
  assert.equal(run('E2 - Eb5 hum 1 3 5 3 1').name, '1-3-5-3-1~ on hum');
  assert.equal(run('Hum, A2 - A3, 1 2 3 2 1').name, 'Hum', 'real leading words still make the name');
});

test('B6: a trailing "up to" / "from" / "on" is cut from the name', () => {
  assert.equal(run('Sirens up to A4').name, 'Sirens');
  assert.equal(run('Sirens to A4').name, 'Sirens');
  assert.equal(run('Hum on C3').name, 'Hum');
  assert.equal(run('Hum on C3 1 2 3').name, 'Hum');
  assert.equal(run('Major scale from E3 up to E4 at 120 bpm').name, 'Major scale from E', 'pinned: left as the original app named it');
});

// B5: the converter says when it guessed.
test('B5: guessed is true for the final fallback and for keyword defaults, false for a pattern it read', () => {
  const sirens = parseLine('Sirens up to A4', DEFAULT_RANGE);
  assert.equal(sirens.guessed, true);
  assert.equal(sirens.guessKind, 'fallback');
  assert.equal(sirens.guessNote, "I couldn't find a pattern in this line, so I started you with a 5-note scale. Change it below.");
  assert.equal(sirens.pat, '1-2-3-4-5-4-3-2-1~');
  const lines = {
    'Lip trill arpeggio': 'a standard arpeggio',
    'Intervals please': 'a standard intervals pattern',
    'Octave jumps with "ng"': 'a standard octave jump',
    'Triad on ah': 'a standard triad',
    'Major scale on ee': 'a standard 8-note scale',
    '9 note scale on oo': 'a standard 9-note scale',
  };
  for (const [line, what] of Object.entries(lines)) {
    const guessed = parseLine(line, DEFAULT_RANGE);
    assert.equal(guessed.guessed, true, line);
    assert.equal(guessed.guessKind, 'keyword', line);
    assert.equal(guessed.guessNote, `I used ${what} for this. Change the pattern below if your coach meant something else.`, line);
  }
  assert.equal(parseLine('Lip roll arpeggios, E2 - E flat 5', DEFAULT_RANGE).guessNote, 'I used a standard arpeggio for this. Change the pattern below if your coach meant something else.');
  for (const line of ['1-3-5 on ah', 'do re mi fa sol on gee', '1 3 5 8 5 3 1 lip trill', 'b3-5-#7 with zz']) {
    const read = parseLine(line, DEFAULT_RANGE);
    assert.equal(read.guessed, false, line);
    assert.equal(read.guessKind, null, line);
    assert.equal(read.guessNote, '', line);
  }
});

test('B5: the original line rides along for the review card ("From your notes")', () => {
  assert.equal(parseLine('- Sirens up to A4', DEFAULT_RANGE).original, 'Sirens up to A4');
  assert.equal(parseLine('  1. Hum on 1-3-5 ', DEFAULT_RANGE).original, 'Hum on 1-3-5');
});

test('B5: review extras are not part of the exercise shape that normEx (and so storage) uses', () => {
  const converted = parseLine('Sirens up to A4', DEFAULT_RANGE);
  const saved = normEx(converted);
  assert.deepEqual(Object.keys(saved).sort(), ['both', 'bpm', 'end', 'hold', 'id', 'name', 'pat', 'rootVow', 'start', 'step', 'top', 'vows']);
});

// B7: the converter remembers how the user spelled their notes.
test('B7: spell is set from a typed accidental and left out otherwise', () => {
  assert.equal(parseLine('Hum, Eb3 - Bb3, 1 2 3 2 1', DEFAULT_RANGE).spell, 'b');
  assert.equal(parseLine('Hum, F#3 - C#4, 1 2 3 2 1', DEFAULT_RANGE).spell, '#');
  assert.equal(parseLine('Hum, E flat 3 - B flat 3, 1 2 3 2 1', DEFAULT_RANGE).spell, 'b');
  assert.equal(parseLine('Hum, C3 - G3, 1 2 3 2 1', DEFAULT_RANGE).spell, undefined);
  assert.equal(parseLine('b3-5-#7 with zz', DEFAULT_RANGE).spell, undefined, 'accidentals on scale degrees are not note names');
});
