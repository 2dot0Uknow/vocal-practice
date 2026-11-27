// Turns a coach's written exercise ("1 3 5 hold octave, E2 - Eb5, eee on root") into an exercise.
// Heuristic and forgiving: it looks for a range, tempo, a pattern and sounds in free text.
// Pure functions only. The default range used when a line gives none is passed in.

import { toMidi, parsePat, typedSpelling } from './music.js';
import { normEx } from './exercise.js';

// Words that are not sounds when they follow "with" / "on".
const NOT_A_SOUND = new Set(['the', 'root', 'roots', 'intervals', 'interval', 'each', 'every', 'top', 'bottom', 'half', 'whole', 'beat', 'beats', 'repeat', 'tonic', 'other', 'others', 'rest', 'one', 'a', 'an', 'and', 'then', 'notes', 'note', 'scale', 'steps', 'step']);

// Known sounds to fall back on when the line does not say "with ..." or "... on ...".
const KNOWN_SOUNDS = /\b(lip trills?|lip rolls?|lip bubbles?|tongue trills?|straw|sirens?|hum|ng|mm|ah|eh|ee|ih|oh|oo|nay|mum|gee|gah|goo|bub|yah|zz|vv)\b/;

// Note names written inside the line, e.g. "E2", "Bb3" (removed before reading the pattern).
const NOTE_NAME_IN_TEXT = /\b([A-G]|[ac-g])\s?([#b]?)([0-7])\b/g;

const FALLBACK_PATTERN = '1-2-3-4-5-4-3-2-1~';

/** Tidy typography: en dashes to hyphens, unicode flats/sharps, "E flat 5" -> "Eb5". */
const normText = (text) => text
  .replace(/[–—]/g, '-')
  .replace(/♭/g, 'b')
  .replace(/♯/g, '#')
  .replace(/\b([A-Ga-g])\s*-?\s*(flat|sharp)\s*(\d)\b/gi, (whole, letter, accidental, octave) => letter.toUpperCase() + (accidental.toLowerCase() == 'flat' ? 'b' : '#') + octave);

// Phrases that only say how many times to repeat ("x2", "2x", "x 2", "times 2", "twice"). The app has no
// repeat count, so they are ignored (B6: "x2" used to leak into the pattern as a note).
const REPEAT_WORDS = /\b(?:x\s*\d+|\d+x|times\s+\d+|twice|thrice)\b/g;

// How long to hold: "hold 5 for 4 beats", "hold for 4 beats", "4 beat hold".
const HOLD_DEGREE_FOR = /\b(?:hold|held|sustain)(?:ing)?\s+(?:the\s+)?(\d{1,2})\s+for\s+(\d)\s*(?:beats?|counts?)\b/i;
const HOLD_FOR = /\b(?:hold|held|sustain)(?:ing)?\s+(?:it\s+|them\s+|that\s+|the\s+last(?:\s+note)?\s+)?for\s+(\d)\s*(?:beats?|counts?)\b/i;
const BEAT_HOLD = /\b(\d)[- ]?(?:beats?|counts?)[- ]+(?:hold|held|sustain)\b/i;

/** Pull a hold phrase out of the text: returns {text without it, beats (1-4), degree (or null)} or null. */
function takeHold(text) {
  let match;
  let found = null;
  if ((match = text.match(HOLD_DEGREE_FOR))) found = { beats: +match[2], degree: +match[1] };
  else if ((match = text.match(HOLD_FOR)) || (match = text.match(BEAT_HOLD))) found = { beats: +match[1], degree: null };
  if (!found) return null;
  return { text: text.replace(match[0], ' '), beats: Math.min(4, Math.max(1, found.beats)), degree: found.degree };
}

/** Clean a sound word: lower case, "eeee" -> "ee", "trills" -> "trill". */
const fixVowel = (word) => word
  .toLowerCase()
  .replace(/(.)\1{2,}/g, '$1$1')
  .replace(/s$/, (letter) => (/(trill|roll|bubble|siren)s$/.test(word.toLowerCase()) ? '' : letter));

/** "... 5 to 8": walk step by step from the last degree to degree `target`. */
function stepwise(degrees, target) {
  const last = degrees.length ? degrees[degrees.length - 1].d : 1;
  const direction = target > last ? 1 : -1;
  for (let k = last + direction; direction > 0 ? k <= target : k >= target; k += direction) degrees.push({ d: k, h: false });
}

/** "1,2,1,3,1,4, etc to 8": continue the pattern seen so far up to degree `target`. */
function extrapolate(degrees, target) {
  const values = degrees.map((entry) => entry.d);
  const count = values.length;
  const evens = values.filter((_, i) => i % 2 == 0);
  const odds = values.filter((_, i) => i % 2);
  // Root, interval, root, interval... with the intervals climbing by one.
  if (count >= 4 && evens.every((x) => x == evens[0]) && odds.every((x, i) => i == 0 || x == odds[i - 1] + 1)) {
    const root = evens[0];
    let next = odds[odds.length - 1] + 1;
    while (next <= target) {
      if (degrees.length % 2 == 0) degrees.push({ d: root, h: false });
      degrees.push({ d: next, h: false });
      next++;
    }
    return;
  }
  // A constant step between the last notes (1-3-5 -> 7, 9, ...).
  const lastStep = count >= 2 ? values[count - 1] - values[count - 2] : 0;
  const stepBefore = count >= 3 ? values[count - 2] - values[count - 3] : lastStep;
  if (lastStep && lastStep == stepBefore) {
    let k = values[count - 1] + lastStep;
    while (lastStep > 0 ? k <= target : k >= target) {
      degrees.push({ d: k, h: false });
      k += lastStep;
    }
    return;
  }
  stepwise(degrees, target);
}

/** Pull scale degrees (and "hold" markers) out of the text that is left once ranges and tempo are removed. */
function degreesFrom(body) {
  const tokens = body.match(/[b#]?\d{1,2}\b|\b(?:hold|held|sustain|down|up|back|etc|to)\b|\.{3}|…/g) || [];
  const degrees = [];
  let holdNext = false;
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    if (/\d/.test(word)) {
      const degree = +word.replace(/\D/g, '');
      if (degree < 1 || degree > 15) continue;
      if (tokens[i - 1] == 'to' && degrees.length) {
        const sawEtc = tokens.slice(Math.max(0, i - 4), i).some((x) => x == 'etc' || x == '...' || x == '…');
        if (sawEtc) extrapolate(degrees, degree);
        else stepwise(degrees, degree);
        continue;
      }
      degrees.push({ d: degree, acc: word[0] == 'b' || word[0] == '#' ? word[0] : '', h: holdNext });
      holdNext = false;
      continue;
    }
    if (word == 'hold' || word == 'held' || word == 'sustain') {
      if (/\d/.test(tokens[i + 1] || '')) holdNext = true;
      else if (degrees.length) degrees[degrees.length - 1].h = true;
    }
  }
  return degrees;
}

/** The gentle note shown on a review card when the pattern was a guess. */
export function guessNote(guess) {
  if (guess.kind == 'keyword') return `I used ${guess.what} for this. Change the pattern below if your coach meant something else.`;
  return "I couldn't find a pattern in this line, so I started you with a 5-note scale. Change it below.";
}

// Words that dangle at the end of a name cut short by a note name ("Sirens up to").
const DANGLING_END = /\s+(?:up to|down to|ending on|end on|starting on|start on|until|through|thru|to|from|on|at)$/i;
// "... up to A" where the note's octave digit cut the name short: drop the lone note letter as well.
const CUT_NOTE_AFTER_TO = /\s+(?:up to|down to|ending on|end on|until|through|thru|to|on|at)\s+[A-G][#b]?$/;

/** The name made of the line's leading words ("Lip roll arpeggios"), or '' when the line leads with a note name or digits. */
function leadingName(raw) {
  let name = (raw.match(/^[A-Za-z][^,.:\d(]{1,38}/) || [''])[0].trim();
  // Only a note name ("Bb" of "Bb2 to F4 ...") is no name at all.
  if (/^[A-Ga-g][#b]?(\s+(to|-)\s+[A-Ga-g][#b]?)?$/.test(name)) return '';
  name = name.replace(CUT_NOTE_AFTER_TO, '');
  // A trailing connector is stripped repeatedly ("Sirens up to" -> "Sirens").
  while (DANGLING_END.test(name)) name = name.replace(DANGLING_END, '');
  return name.trim();
}

/** "1-2-3-4-5-4… on gee/gah": a name made from the pattern and the sounds. */
function builtName(pattern, vows) {
  const parts = pattern.split('-');
  return (parts.length > 6 ? parts.slice(0, 6).join('-') + '…' : pattern) + (vows.length ? ' on ' + vows.join('/') : '');
}

/**
 * Convert one line of text into an exercise (or null for an empty line).
 * defaultRange = {start, end} (MIDI) is used when the line names no starting note.
 */
export function parseLine(line, defaultRange) {
  const raw = line.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim();
  if (!raw) return null;
  const text = normText(raw);
  const lower = text.toLowerCase();
  let match;

  // --- range ---
  let start = null;
  let end = null;
  let top = false;
  const rangeMatch = text.match(/\b([A-G][#b]?\d)\s*(?:-|to)\s*([A-G][#b]?\d)\b/);
  if (rangeMatch && !/start|begin|from/i.test(text)) {
    // "E2 - Eb5" (with a dash) means the whole range sung; "E2 to Eb5" means starting notes.
    start = toMidi(rangeMatch[1]);
    end = toMidi(rangeMatch[2]);
    top = rangeMatch[0].includes('-');
  } else {
    if ((match = text.match(/(?:start(?:ing)?|begin(?:ning)?|from)\s*(?:on|at|from)?\s*([A-G][#b]?\d)/i))) start = toMidi(match[1]);
    if ((match = text.match(/(?:up to|down to|until|through|thru|ending on|end on|\bto)\s+([A-G][#b]?\d)/i))) end = toMidi(match[1]);
  }
  if (start == null) {
    start = defaultRange.start;
    end = end ?? defaultRange.end;
  }
  if (end == null) end = start + 7;

  // --- step and tempo ---
  const step = /whole[- ]?(step|tone)/.test(lower) ? 2 : 1;
  const bpmMatch = lower.match(/(\d{2,3})\s*(?:bpm|beats per)/) || lower.match(/tempo\s*(?:of|=|:)?\s*(\d{2,3})/);
  const bpm = bpmMatch ? Math.min(200, Math.max(30, +bpmMatch[1])) : 90;

  // --- pattern ---
  // Remove everything that is not part of the pattern (note names, tempo, "4 beats", "5-note").
  const holdPhrase = takeHold(text);
  let body = (holdPhrase ? holdPhrase.text : text)
    .replace(NOTE_NAME_IN_TEXT, ' ')
    .toLowerCase()
    .replace(REPEAT_WORDS, ' ')
    .replace(/\d{2,3}\s*(bpm|beats per minute)/g, ' ')
    .replace(/tempo\s*\S+/g, ' ')
    .replace(/\b\d+\s*(beats?|counts?|times|x)\b/g, ' ')
    .replace(/\b(\d+|five|nine|eight)[- ]note\b/g, ' ');
  const digitCount = (body.match(/\b\d{1,2}\b/g) || []).length;
  if (digitCount >= 2) body = body.replace(/\b(the\s+)?octave\b/g, ' 8 ');
  const degrees = degreesFrom(body);
  let pattern = '';
  let solfege;
  let guess = null; // null, or {kind: 'fallback' | 'keyword', what} when the pattern was not read from the line
  if (degrees.length >= 2) {
    if (holdPhrase && holdPhrase.degree != null) {
      // "hold 5 for 4 beats": hold the last note with that degree (it is already in the pattern), else the last note.
      const held = degrees.map((entry) => entry.d).lastIndexOf(holdPhrase.degree);
      degrees[held >= 0 ? held : degrees.length - 1].h = true;
    } else if (holdPhrase) {
      degrees[degrees.length - 1].h = true;
    }
    pattern = degrees.map((entry) => (entry.acc || '') + entry.d + (entry.h ? '~' : '')).join('-');
  } else if ((solfege = lower.match(/\b(?:do|re|mi|fa|sol|so|la|ti)\b(?:[\s,\-]+(?:do|re|mi|fa|sol|so|la|ti)\b){2,}/))) {
    const degreeOfSyllable = { do: 1, re: 2, mi: 3, fa: 4, sol: 5, so: 5, la: 6, ti: 7 };
    pattern = solfege[0].split(/[\s,\-]+/).map((word) => degreeOfSyllable[word]).join('-');
  } else {
    const keyword = [
      [/arpeggio/, '1-3-5-8-5-3-1~', 'a standard arpeggio'],
      [/interval/, '1-2-1-3-1-4-1-5-1-6-1-7-1-8~', 'a standard intervals pattern'],
      [/(9|nine)[- ]note/, '1-2-3-4-5-6-7-8-9-8-7-6-5-4-3-2-1~', 'a standard 9-note scale'],
      [/(octave|major) scale|(8|eight)[- ]note/, '1-2-3-4-5-6-7-8-7-6-5-4-3-2-1~', 'a standard 8-note scale'],
      [/octave/, '1-8~-1~', 'a standard octave jump'],
      [/triad/, '1-3-5-3-1~', 'a standard triad'],
    ].find(([word]) => word.test(lower));
    pattern = keyword ? keyword[1] : FALLBACK_PATTERN;
    guess = keyword ? { kind: 'keyword', what: keyword[2] } : { kind: 'fallback' };
  }
  if (!/~/.test(pattern)) pattern += '~';
  if (!parsePat(pattern)) {
    pattern = FALLBACK_PATTERN;
    guess = { kind: 'fallback' };
  }

  // --- sounds ---
  let rootVow = '';
  let vows = [];
  if ((match = lower.match(/([a-z]+)\s+on\s+(?:the\s+)?(?:root|roots|tonic|1)\b/))) rootVow = fixVowel(match[1]);
  if ((match = lower.match(/([a-z]+)\s+on\s+(?:the\s+)?(?:intervals?|others?|rest|other notes|top notes?|everything else)\b/))) vows = [fixVowel(match[1])];
  if (!vows.length) {
    const words = [...lower.matchAll(/\b(?:with|on)\s+(?:an?\s+)?["'“‘]?([a-z]+(?:\s(?:trills?|rolls?|bubbles?))?)(?![\d#])/g)]
      .map((found) => fixVowel(found[1]))
      .filter((word) => word.length > 1 && !NOT_A_SOUND.has(word) && word != rootVow && !/^[a-g][b#]?$/.test(word));
    vows = [...new Set(words)];
  }
  if (!vows.length && (match = lower.match(KNOWN_SOUNDS))) vows = [fixVowel(match[1])];
  if (!vows.length && (match = text.match(/["“‘']([A-Za-z ]{1,12})["”’']/))) vows = [fixVowel(match[1])];

  // --- name: the leading words of the line, else built from the pattern and sound ---
  const name = leadingName(raw) || builtName(pattern, vows);

  const spell = typedSpelling(text);
  const exercise = normEx({
    name,
    pat: pattern,
    vows,
    rootVow,
    start,
    end,
    top,
    step,
    bpm,
    hold: holdPhrase ? holdPhrase.beats : 2,
    both: /up and (back )?down|ascend(ing)? and descend/.test(lower),
    spell,
  });
  // The review card also needs to know what was guessed and what the coach wrote. These ride along on the
  // returned object only: the editor builds the saved exercise afresh from its fields, so they are never stored.
  return {
    ...exercise,
    guessed: !!guess,
    guessKind: guess ? guess.kind : null,
    guessNote: guess ? guessNote(guess) : '',
    original: raw,
  };
}

/** One exercise per line; blank lines are skipped. */
export const parseAll = (text, defaultRange) => text.split(/\n+/).map((line) => parseLine(line, defaultRange)).filter(Boolean);
