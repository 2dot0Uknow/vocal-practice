// F5: the recorded piano's note choice, playback rate and envelope times (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SAMPLE_MIDIS, sampleName, nearestSample, playbackRateFor, sampleFor, noteEnvelope, ATTACK, RELEASE } from '../js/piano.js';

test('F5: 17 samples, one per minor third from C2 to C6', () => {
  assert.equal(SAMPLE_MIDIS.length, 17);
  assert.equal(SAMPLE_MIDIS[0], 36);
  assert.equal(SAMPLE_MIDIS.at(-1), 84);
  SAMPLE_MIDIS.slice(1).forEach((midi, i) => assert.equal(midi - SAMPLE_MIDIS[i], 3));
});

test('F5: file names use the note name with s for sharp, and every one exists in audio/piano', () => {
  assert.deepEqual(SAMPLE_MIDIS.slice(0, 5).map(sampleName), ['C2', 'Ds2', 'Fs2', 'A2', 'C3']);
  assert.equal(sampleName(84), 'C6');
  SAMPLE_MIDIS.forEach((midi) => assert.ok(fs.existsSync(new URL(`../audio/piano/${sampleName(midi)}.mp3`, import.meta.url)), sampleName(midi)));
  assert.equal(fs.readdirSync(new URL('../audio/piano/', import.meta.url)).filter((f) => f.endsWith('.mp3')).length, 17);
});

test('F5: the sample files together stay under 500 KB', () => {
  const total = SAMPLE_MIDIS.reduce((sum, midi) => sum + fs.statSync(new URL(`../audio/piano/${sampleName(midi)}.mp3`, import.meta.url)).size, 0);
  assert.ok(total < 500 * 1024, `total ${total} bytes`);
});

test('F5: the nearest sample is chosen, and an exact note plays at rate 1', () => {
  assert.equal(nearestSample(48), 48);
  assert.equal(nearestSample(49), 48);   // C#3 -> C3, up one semitone
  assert.equal(nearestSample(50), 51);   // D3 -> D#3, down one
  assert.equal(nearestSample(52), 51);   // E3 -> D#3
  assert.equal(nearestSample(53), 54);   // F3 -> F#3
  assert.equal(nearestSample(55), 54);   // G3 -> F#3
  assert.equal(nearestSample(56), 57);   // G#3 -> A3
  assert.equal(playbackRateFor(48, 48), 1);
  // Never more than one semitone away inside the range.
  for (let midi = 36; midi <= 84; midi++) assert.ok(Math.abs(midi - nearestSample(midi)) <= 1, `midi ${midi}`);
});

test('F5: playbackRate = 2^((midi - sampleMidi) / 12)', () => {
  assert.ok(Math.abs(playbackRateFor(49, 48) - 1.0594630943592953) < 1e-12);
  assert.ok(Math.abs(playbackRateFor(47, 48) - 0.9438743126816935) < 1e-12);
  assert.equal(playbackRateFor(60, 48), 2);
  assert.equal(playbackRateFor(36, 48), 0.5);
  assert.deepEqual(sampleFor(50), { sampleMidi: 51, name: 'Ds3', rate: 2 ** (-1 / 12) });
});

test('F5: notes outside C2 to C6 use the end sample, shifted further', () => {
  assert.equal(nearestSample(30), 36);
  assert.equal(nearestSample(90), 84);
  assert.equal(sampleFor(90).rate, 2 ** (6 / 12));
});

test('F5: envelope: ~5 ms attack, a 0.25 s release from the end of the note', () => {
  const times = noteEnvelope(10, 1.5);
  assert.ok(Math.abs(times.attackEnd - 10.005) < 1e-12);
  assert.equal(times.releaseStart, 11.5);
  assert.equal(times.releaseEnd, 11.75);
  assert.equal(ATTACK, 0.005);
  assert.equal(RELEASE, 0.25);
});

test('F5: a note shorter than the attack still gets its full attack before the release', () => {
  const times = noteEnvelope(5, 0.001);
  assert.ok(times.releaseStart >= times.attackEnd);
});

import { sustainLayer, LONG_NOTE } from '../js/piano.js';

test('F5: notes up to 2 s are the sample alone; longer ones get a sustain layer', () => {
  assert.equal(LONG_NOTE, 2);
  assert.equal(sustainLayer(10, 0.6), null);
  assert.equal(sustainLayer(10, 2), null);
  assert.ok(sustainLayer(10, 2.01));
});

test('F5: the layer fades in from 1.2 s to 1.6 s, stays soft, and ends with the sample\'s own release', () => {
  const layer = sustainLayer(10, 4);
  const env = noteEnvelope(10, 4);
  assert.ok(Math.abs(layer.fadeStart - 11.2) < 1e-9);
  assert.ok(Math.abs(layer.fadeEnd - 11.6) < 1e-9);
  assert.equal(layer.releaseStart, env.releaseStart);
  assert.equal(layer.releaseEnd, env.releaseEnd);
  assert.equal(layer.releaseEnd, 14.25);
  // about -18 dB under the sample level (peak 1 at gain 1, RMS -20 dBFS => peak ~ -17 dBFS ~ 0.14; the layer is ~ -18 dB under that)
  assert.ok(layer.level > 0.01 && layer.level < 0.03);
  assert.ok(layer.fadeEnd < layer.releaseStart);
});

test('F5: an 8 s hold (4 beats at 30 bpm) is covered to its end', () => {
  const layer = sustainLayer(0, 8);
  assert.equal(layer.releaseEnd, 8.25);
});
