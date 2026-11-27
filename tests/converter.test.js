// Characterization: these pin down what the converter does TODAY, including answers that are
// plainly wrong (later PRs fix those and update the expectations deliberately).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseAll } from '../js/converter.js';
import { toMidi } from '../js/music.js';
import { fixture, assertSame, withoutId } from './helpers/fixture.js';
import { ALT_RANGE } from './tools/cases.mjs';

const DEFAULT_RANGE = { start: 48, end: 55 };
const run = (line, range = DEFAULT_RANGE) => {
  const result = parseLine(line, range);
  return result ? withoutId(result) : null;
};

test('parseLine matches the original on the four textarea placeholder lines and 20 other lines', () => {
  assert.equal(fixture.parseLine.length, 24);
  for (const { line, expected } of fixture.parseLine) assertSame(run(line), expected, JSON.stringify(line));
});

test('parseLine uses the range it is given when a line has none', () => {
  for (const { line, expected } of fixture.parseLineAltRange) assertSame(run(line, ALT_RANGE), expected, JSON.stringify(line));
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
  const all = parseAll(fixture.parseAll.text, DEFAULT_RANGE).map(withoutId);
  assertSame(all, fixture.parseAll.expected);
  assert.equal(parseAll('\n\n1-3-5 on ah\n\n', DEFAULT_RANGE).length, 1);
});

test('exercises get a unique id each time', () => {
  const a = parseLine('1-3-5', DEFAULT_RANGE);
  const b = parseLine('1-3-5', DEFAULT_RANGE);
  assert.ok(a.id && b.id && a.id !== b.id);
});

// Known wrong answers, recorded as they are today. Each is fixed in a later PR (see the plan).
test('KNOWN TODAY (bugs kept for now): x2 becomes a note, hold N beats ignored, odd names, no flag', () => {
  assert.equal(run('1 2 3 4 5 4 3 2 1 x2 on nay').pat, '1-2-3-4-5-4-3-2-1-2~');
  assert.equal(run('1-3-5 hold 5 for 4 beats').pat, '1-3-5-5~');
  assert.equal(run('Bb2 to F4 lip trills 1 3 5 3 1').name, 'Bb');
  assert.equal(run('Sirens up to A4').name, 'Sirens up to A');
});
