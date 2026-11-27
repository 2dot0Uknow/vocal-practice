import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../js/pitch.js';
import { fixture, assertSame } from './helpers/fixture.js';
import { sine, harmonicTone, noisySine, silence, whiteNoise } from './helpers/signals.js';
import { TONE_FREQUENCIES, TONE_SAMPLE_RATES } from './tools/cases.mjs';

// Rebuild every signal exactly as the generator did, in the same order.
function signalFor(label, sampleRate, length) {
  const [kind, frequency] = label.split(' ');
  switch (kind) {
    case 'sine': return sine(+frequency, sampleRate, length);
    case 'harmonic': return harmonicTone(+frequency, sampleRate, length);
    default: return null;
  }
}

const special = {
  'harmonic 220 long window': () => harmonicTone(220, 48000, 4096),
  silence: () => silence(2048),
  'too quiet sine': () => sine(220, 48000, 2048, 0.01),
  'too quiet sine, trill gate': () => sine(220, 24000, 2048, 0.01),
  'white noise': () => whiteNoise(2048, 0.2, 5),
  'noisy sine': () => noisySine(300, 48000, 2048, 0.3, 0.1, 6),
  'very noisy sine': () => noisySine(300, 48000, 2048, 0.2, 0.3, 7),
  'trill-mode sine': () => sine(196, 24000, 2048, 0.05),
  'trill-mode harmonic': () => harmonicTone(330, 24000, 2048, 0.05),
  'below 65 Hz': () => sine(50, 48000, 2048),
};

test('detect matches the original on every captured synthetic signal', () => {
  assert.ok(fixture.detect.length >= 40);
  for (const entry of fixture.detect) {
    const samples = special[entry.label] ? special[entry.label]() : signalFor(entry.label, entry.sampleRate, entry.length);
    const actual = entry.options ? detect(samples, entry.sampleRate, entry.options) : detect(samples, entry.sampleRate);
    assertSame(actual, entry.expected, `${entry.label} @${entry.sampleRate}`);
  }
});

test('detect finds the pitch of sines and harmonic tones within 5 cents (sanity check)', () => {
  for (const sampleRate of TONE_SAMPLE_RATES) {
    for (const frequency of TONE_FREQUENCIES) {
      for (const make of [sine, harmonicTone]) {
        const found = detect(make(frequency, sampleRate, 2048), sampleRate);
        if (!found) continue; // a few very high / low tones are missed today; the fixture test pins which
        const cents = 1200 * Math.log2(found.f / frequency);
        assert.ok(Math.abs(cents) < 5, `${make.name} ${frequency} Hz read as ${found.f}`);
      }
    }
  }
});

test('detect returns null for silence, quiet signals, noise and pitches below 65 Hz', () => {
  assert.equal(detect(silence(2048), 48000), null);
  assert.equal(detect(sine(220, 48000, 2048, 0.01), 48000), null, 'under the 0.012 gate');
  assert.equal(detect(whiteNoise(2048, 0.2, 5), 48000), null);
  assert.equal(detect(sine(50, 48000, 2048), 48000), null);
});

test('detect: the quieter gate used in trill mode lets a faint signal through', () => {
  const faint = sine(220, 24000, 2048, 0.01);
  assert.equal(detect(faint, 24000), null, 'default gate (0.012) rejects it');
  const found = detect(faint, 24000, { gate: 0.004, min: 0.4 });
  assert.ok(found && Math.abs(found.f - 220) < 0.1, 'trill-mode gate (0.004) accepts it');
});
