import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteName, toMidi, midiToHz, hzToMidi, parsePat, rootsOf } from '../js/music.js';
import { fixture, assertSame } from './helpers/fixture.js';

test('noteName matches the original for every MIDI number 0-127 (sharps only)', () => {
  fixture.noteNames.forEach((expected, midi) => assert.equal(noteName(midi), expected));
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(75), 'D#5');
});

test('toMidi', () => {
  for (const { input, expected } of fixture.toMidi) assert.equal(toMidi(input), expected, JSON.stringify(input));
  assert.equal(toMidi('Eb5'), 75);
});

test('midiToHz and hzToMidi', () => {
  for (const { midi, expected } of fixture.hz) assertSame(midiToHz(midi), expected);
  for (const { freq, expected } of fixture.fToM) assertSame(hzToMidi(freq), expected);
  assert.equal(midiToHz(69), 440);
});

test('parsePat matches the original for valid and invalid patterns', () => {
  for (const { input, expected } of fixture.parsePat) assertSame(parsePat(input), expected, JSON.stringify(input));
});

test('parsePat: a few readable examples', () => {
  assert.deepEqual(parsePat('1-3-5~'), [
    { deg: 1, s: 0, h: false },
    { deg: 3, s: 4, h: false },
    { deg: 5, s: 7, h: true },
  ]);
  assert.equal(parsePat('1'), null, 'a single note is not a pattern');
  assert.equal(parsePat('1-16'), null, 'degrees stop at 15');
  assert.equal(parsePat('1-8').at(-1).s, 12, 'degree 8 is an octave up');
});

test('rootsOf matches the original (top / both / step variants and the 48-round cap)', () => {
  for (const { exercise, expected } of fixture.rootsOf) {
    assertSame(rootsOf(exercise, parsePat(exercise.pat)), expected, exercise.label);
  }
});

test('rootsOf: the cap is 48 rounds per leg (so up to 95 with "come back down")', () => {
  const capped = fixture.rootsOf.filter((c) => c.exercise.label.startsWith('48-round'));
  const lengths = Object.fromEntries(capped.map((c) => [c.exercise.label, c.expected.length]));
  assert.deepEqual(lengths, {
    '48-round cap, ascending': 48,
    '48-round cap, descending': 48,
    '48-round cap, top': 48,
    '48-round cap, both': 95,
  });
});
