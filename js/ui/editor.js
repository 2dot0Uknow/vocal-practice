// The Add / Edit screen: paste text -> Convert all -> a card per exercise to check and fix -> Save.
// Also "Hear one round", a quick piano preview of an exercise.

import { $, esc } from './dom.js';
import { state, saveExercises } from '../state.js';
import { store, KEYS } from '../store.js';
import { noteName, toMidi, parsePat, rootsOf, spellingOf, accidentalOf } from '../music.js';
import { normEx, planRounds, placeRound } from '../exercise.js';
import { parseAll } from '../converter.js';
import { ensureAudio, getAudioContext, createPreviewBus, playPianoNote } from '../audio.js';
import { navTo, goHome } from './navigation.js';

let review = [];      // the exercises being edited (one when editing, any number after Convert)
let cardInfo = [];    // per card, same order as review: {guessNote, original, dirty}. Never saved (B5, B8).
let replaceTimer = null; // while "Replace your edited cards?" is waiting for its second tap
let editMode = false; // true when editing one saved exercise rather than adding
let preview = null;   // the "Hear one round" playback: {gain, oscillators}

/** Fade out and stop a "Hear one round" preview that is still playing. */
export function stopPreview() {
  const playing = preview;
  preview = null;
  if (!playing) return;
  try {
    const now = playing.gain.context.currentTime;
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
    playing.gain.gain.linearRampToValueAtTime(0, now + 0.03);
    playing.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop(now + 0.05);
      } catch (error) {
        // Already stopped.
      }
    });
    setTimeout(() => {
      try {
        playing.gain.disconnect();
      } catch (error) {
        // Already disconnected.
      }
    }, 120);
  } catch (error) {
    // The audio context may already be closed.
  }
}

/** Open the screen to add exercises (exercise = null) or to edit one. */
export function openEditor(exercise) {
  editMode = !!exercise;
  navTo('add');
  $('addTitle').textContent = exercise ? 'Edit exercise' : "Add your coach's exercises";
  $('inBox').hidden = !!exercise;
  $('dStart').value = noteName(state.defaultRange.start, 'auto');
  $('dEnd').value = noteName(state.defaultRange.end, 'auto');
  review = exercise ? [{ ...exercise, vows: [...exercise.vows] }] : [];
  cardInfo = review.map(() => ({ guessNote: '', original: '', dirty: false }));
  clearMessages();
  renderCards();
}

const selectHTML = (key, options, value) => `<select data-k="${key}">${options.map(([optionValue, text]) => `<option value="${optionValue}"${String(optionValue) == String(value) ? ' selected' : ''}>${text}</option>`).join('')}</select>`;

function cardHTML(exercise, index) {
  const info = cardInfo[index] || {};
  const spelling = spellingOf(exercise);
  return `<div class="card ed" data-i="${index}">
  <h3>${editMode ? '' : (index + 1) + '. '}${esc(exercise.name)}</h3>
  ${info.original ? `<p class="from">From your notes: “${esc(info.original)}”</p>` : ''}
  ${info.guessNote ? `<p class="guess" data-guess>${esc(info.guessNote)}</p>` : ''}
  <label>Name</label><input data-k="name" value="${esc(exercise.name)}">
  <label>Pattern: scale degrees, ~ means hold</label><input data-k="pat" value="${esc(exercise.pat)}">
  <div class="grid">
    <div><label>Sounds (commas = one pass each)</label><input data-k="vows" value="${esc(exercise.vows.join(', '))}" placeholder="ah"></div>
    <div><label>Sound on root notes (optional)</label><input data-k="rootVow" value="${esc(exercise.rootVow)}"></div>
    <div><label>From</label><input data-k="start" value="${noteName(exercise.start, spelling)}" data-shown="${noteName(exercise.start, spelling)}"></div>
    <div><label>To</label><input data-k="end" value="${noteName(exercise.end, spelling)}" data-shown="${noteName(exercise.end, spelling)}"></div>
    <div><label>From–To means</label>${selectHTML('top', [[0, 'Starting notes'], [1, 'Whole range sung']], exercise.top ? 1 : 0)}</div>
    <div><label>Move each round</label>${selectHTML('step', [[1, 'Half step'], [2, 'Whole step']], exercise.step)}</div>
    <div><label>Tempo (bpm)</label><input data-k="bpm" type="number" inputmode="numeric" min="30" max="200" value="${exercise.bpm}"></div>
    <div><label>Held notes (~) last</label>${selectHTML('hold', [[1, '1 beat'], [2, '2 beats'], [3, '3 beats'], [4, '4 beats']], exercise.hold)}</div>
  </div>
  <label class="chk"><input type="checkbox" data-k="both"${exercise.both ? ' checked' : ''}> Come back down after reaching the top</label>
  <p class="note sum"></p>
  <div class="row"><button data-a="hear">Hear one round</button><button class="ghost" data-a="del">${editMode ? 'Delete' : 'Remove'}</button></div></div>`;
}

/** Play the first round of an exercise on the piano. A new tap cuts off the previous preview. */
function hearOneRound(exercise) {
  ensureAudio();
  stopPreview();
  const bus = createPreviewBus();
  preview = { gain: bus, oscillators: [] };
  // The same round plan the practice screen uses (B12): round 1, first sound only, starting at the first note (no cue chord).
  const placed = placeRound(planRounds(exercise).rounds[0], 0);
  const notes = placed.targets.filter((target) => target.pass === 0);
  const begin = getAudioContext().currentTime + 0.1 - notes[0].t0;
  notes.forEach((note) => playPianoNote(note.m, begin + note.t0, note.t1 - note.t0, bus, preview.oscillators));
}

function renderCards() {
  resetReplaceConfirm();
  $('eds').innerHTML = review.map(cardHTML).join('');
  $('saveRow').hidden = !review.length;
  $('saveBtn').textContent = editMode ? 'Save changes' : `Save ${review.length} exercise${review.length == 1 ? '' : 's'}`;
  $('eds').querySelectorAll('.ed').forEach((card) => {
    const index = +card.dataset.i;
    const updateFromCard = () => {
      const exercise = readCard(card);
      if (exercise) review[index] = exercise;
    };
    card.addEventListener('input', (event) => {
      // Any typing makes the card "edited": Convert will ask before replacing it (B8).
      cardInfo[index].dirty = true;
      // Once the pattern has been looked at, the "I guessed" note has done its job.
      if (event.target.dataset && event.target.dataset.k == 'pat') {
        cardInfo[index].guessNote = '';
        card.querySelector('[data-guess]')?.remove();
      }
      updateFromCard();
    });
    card.addEventListener('change', updateFromCard);
    readCard(card);
    card.querySelector('[data-a=hear]').onclick = () => {
      const exercise = readCard(card);
      if (!exercise) return;
      hearOneRound(exercise);
    };
    const deleteButton = card.querySelector('[data-a=del]');
    deleteButton.onclick = () => {
      if (editMode) {
        // Editing a saved exercise: Delete needs a second tap.
        if (deleteButton.dataset.sure) {
          state.exercises = state.exercises.filter((x) => x.id != review[0].id);
          saveExercises();
          goHome();
        } else {
          deleteButton.dataset.sure = 1;
          deleteButton.textContent = 'Tap again to delete';
        }
        return;
      }
      review.splice(index, 1);
      cardInfo.splice(index, 1);
      renderCards();
    };
  });
}

/** Mark (or unmark) fields as needing a look. Only once a Save has been tried, so typing is never nagged. */
function markFields(card, invalidKeys) {
  if (!card.dataset.checked) return;
  card.querySelectorAll('[data-k]').forEach((field) => {
    if (invalidKeys.includes(field.dataset.k)) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  });
}

/** Read one card's fields into an exercise and update its summary line. Returns null when a field is invalid. */
function readCard(card) {
  const field = (key) => card.querySelector(`[data-k=${key}]`);
  const summary = card.querySelector('.sum');
  const start = toMidi(field('start').value);
  const end = toMidi(field('end').value);
  const pattern = field('pat').value.trim();
  const notes = parsePat(pattern);
  const invalidKeys = [start == null ? 'start' : '', end == null ? 'end' : '', notes ? '' : 'pat'].filter(Boolean);
  markFields(card, invalidKeys);
  if (invalidKeys.length) {
    summary.textContent = 'Check the pattern (like 1-3-5-8~-5-3-1) and the notes (like E2, Eb5).';
    return null;
  }
  // Only a note the user changed counts as "typed": the fields show an automatic spelling that was not their choice.
  const typedIn = (key) => (field(key).value == field(key).dataset.shown ? '' : accidentalOf(field(key).value));
  const typedAccidental = typedIn('start') || typedIn('end');
  const exercise = normEx({
    id: review[+card.dataset.i]?.id,
    name: field('name').value.trim() || pattern,
    pat: pattern,
    vows: field('vows').value.split(',').map((x) => x.trim()).filter(Boolean),
    rootVow: field('rootVow').value.trim(),
    start,
    end,
    top: field('top').value == '1',
    step: +field('step').value,
    bpm: Math.min(200, Math.max(30, +field('bpm').value || 90)),
    hold: +field('hold').value,
    both: field('both').checked,
    // Remember how the notes were written: a typed flat or sharp wins, else keep what the card had.
    spell: typedAccidental === 'b' ? 'b' : typedAccidental === '#' ? '#' : review[+card.dataset.i]?.spell,
  });
  const spelling = spellingOf(exercise);
  const roots = rootsOf(exercise, notes);
  const highestOffset = Math.max(...notes.map((note) => note.s));
  const passes = Math.max(1, exercise.vows.length);
  const firstRound = notes.map((note) => noteName(roots[0] + note.s, spelling)).join(' ');
  summary.textContent = `${roots.length} round${roots.length > 1 ? 's' : ''}${passes > 1 ? ` × ${passes} passes (${exercise.vows.join(', then ')})` : ''}. First round: ${firstRound}. Highest note: ${noteName(Math.max(...roots) + highestOffset, spelling)}.${roots.length >= 48 ? ' (Capped at 48 rounds.)' : ''}`;
  return exercise;
}

/** Small helpers for the one-line messages under the Convert and Save buttons. */
function showMessage(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function clearMessages() {
  showMessage('parseMsg', '');
  showMessage('saveMsg', '');
  $('dStart').removeAttribute('aria-invalid');
  $('dEnd').removeAttribute('aria-invalid');
}

/** Put the Convert button back to its normal wording after "Replace your edited cards?". */
function resetReplaceConfirm() {
  clearTimeout(replaceTimer);
  replaceTimer = null;
  if ($('parseBtn').dataset.sure) {
    delete $('parseBtn').dataset.sure;
    $('parseBtn').textContent = 'Convert all';
  }
}

/** Convert all: check the box and the default range, ask before replacing edited cards, then convert. */
function convertAll() {
  clearMessages();
  if (!$('notes').value.trim()) {
    showMessage('parseMsg', 'Add at least one line first.');
    return;
  }
  const defaultStart = toMidi($('dStart').value);
  const defaultEnd = toMidi($('dEnd').value);
  const badRange = [[defaultStart, 'dStart', 'From'], [defaultEnd, 'dEnd', 'To']].find(([midi]) => midi == null);
  if (badRange) {
    $(badRange[1]).setAttribute('aria-invalid', 'true');
    $(badRange[1]).closest('details').open = true;
    showMessage('parseMsg', `Use a note like C3 or Eb4 for ${badRange[2]}.`);
    return;
  }
  // Edited cards would be lost: ask first, with the same two-step tap as Delete.
  if (cardInfo.some((info) => info.dirty) && !$('parseBtn').dataset.sure) {
    $('parseBtn').dataset.sure = 1;
    $('parseBtn').textContent = 'Replace your edited cards?';
    replaceTimer = setTimeout(resetReplaceConfirm, 8000);
    return;
  }
  resetReplaceConfirm();
  state.defaultRange = { start: defaultStart, end: defaultEnd };
  store.set(KEYS.defaultRange, state.defaultRange);
  const converted = parseAll($('notes').value, state.defaultRange);
  // The guess note and the original line stay with the card; the exercises themselves are plain exercises.
  cardInfo = converted.map(({ guessNote, original }) => ({ guessNote, original, dirty: false }));
  review = converted.map(({ guessed, guessKind, guessNote, original, ...exercise }) => exercise);
  renderCards();
  if (review.length) $('eds').scrollIntoView({ behavior: 'smooth' });
}

/** Save all cards, or point at the first one that needs a look (B8). */
function saveAll() {
  showMessage('saveMsg', '');
  const cards = [...$('eds').querySelectorAll('.ed')];
  cards.forEach((card) => { card.dataset.checked = 1; });
  const exercises = cards.map(readCard);
  const firstBad = exercises.findIndex((x) => !x);
  if (firstBad >= 0) {
    const card = cards[firstBad];
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.querySelector('[aria-invalid="true"]')?.focus({ preventScroll: true });
    showMessage('saveMsg', cards.length > 1 ? `Card ${firstBad + 1} needs a look before saving. The marked field shows where.` : 'This exercise needs a look before saving. The marked field shows where.');
    return;
  }
  exercises.forEach((exercise) => {
    const existing = state.exercises.findIndex((x) => x.id == exercise.id);
    if (existing >= 0) state.exercises[existing] = exercise;
    else state.exercises.push(exercise);
  });
  saveExercises();
  goHome();
}

export function initEditor() {
  $('newBtn').onclick = () => {
    $('notes').value = '';
    $('ocr').hidden = true;
    openEditor(null);
  };
  $('notes').addEventListener('input', () => {
    resetReplaceConfirm();
    showMessage('parseMsg', '');
  });
  ['dStart', 'dEnd'].forEach((id) => $(id).addEventListener('input', () => {
    $(id).removeAttribute('aria-invalid');
    showMessage('parseMsg', '');
  }));
  $('parseBtn').onclick = convertAll;
  $('saveBtn').onclick = saveAll;
}
