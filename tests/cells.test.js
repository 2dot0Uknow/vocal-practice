// V2: note cells carry a second cue besides colour, and a spoken label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteStripsHTML, cellLabel } from '../js/ui/report.js';
import { normEx } from '../js/exercise.js';

const exercise = normEx({ pat: '1-3', start: 48, end: 48, spell: '#' });
const one = (result) => noteStripsHTML([{ round: 0, pass: 0, m: 48, miss: false, ...result }], exercise);
const cue = (html) => (html.match(/<span class="cue">([^<]*)<\/span>/) || [])[1] ?? '';

test('landed notes (within 25 cents) get a tick, whichever side they are on', () => {
  for (const med of [0, 12, -12, 25, -25]) assert.equal(cue(one({ med })), '✓', `med ${med}`);
});

test('beyond 25 cents: an up arrow for sharp, a down arrow for flat', () => {
  assert.equal(cue(one({ med: 26 })), '↑');
  assert.equal(cue(one({ med: 70 })), '↑');
  assert.equal(cue(one({ med: -26 })), '↓');
  assert.equal(cue(one({ med: -90 })), '↓');
});

test('an octave away keeps 8vb / 8va and has no arrow; a missed note shows a dash and no mark', () => {
  const below = one({ med: -1200, octaveOff: true });
  assert.ok(below.includes('8vb') && cue(below) === '');
  assert.ok(one({ med: 1190, octaveOff: true }).includes('8va'));
  const missed = one({ miss: true, med: 0 });
  assert.ok(missed.includes('—') && cue(missed) === '');
});

test('each cell has an aria-label in words, and the strip is a list of list items', () => {
  assert.equal(cellLabel('C3', { med: 12 }), 'C3, 12 cents sharp, landed');
  assert.equal(cellLabel('C3', { med: -1 }), 'C3, 1 cent flat, landed');
  assert.equal(cellLabel('C3', { med: 0.2 }), 'C3, in tune, landed');
  assert.equal(cellLabel('D3', { med: -40 }), 'D3, 40 cents flat, close');
  assert.equal(cellLabel('E3', { med: 88 }), 'E3, 88 cents sharp, still finding it');
  assert.equal(cellLabel('C3', { miss: true }), 'C3, not heard');
  assert.equal(cellLabel('C3', { med: -1200, octaveOff: true }), 'C3, an octave below the piano, still finding it');
  const html = one({ med: 12 });
  assert.match(html, /<div class="strip" role="list" aria-label="Round 1">/);
  assert.match(html, /<div class="cell on" role="listitem" aria-label="C3, 12 cents sharp, landed">/);
});

test('cells and bars carry no inline style attribute', () => {
  assert.ok(!/style=/.test(one({ med: 12 })));
  assert.ok(!/style=/.test(noteStripsHTML([{ round: 0, pass: 0, m: 48, miss: true, med: 0 }], exercise)));
});
