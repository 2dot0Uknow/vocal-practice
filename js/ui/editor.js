// The Add / Edit screen: paste text -> Convert all -> a card per exercise to check and fix -> Save.
// Also "Hear one round", a quick piano preview of an exercise.

import { $, esc } from './dom.js';
import { state, saveExercises } from '../state.js';
import { store, KEYS } from '../store.js';
import { noteName, toMidi, parsePat, rootsOf } from '../music.js';
import { normEx } from '../exercise.js';
import { parseAll } from '../converter.js';
import { ensureAudio, getAudioContext, createPreviewBus, playPianoNote } from '../audio.js';
import { navTo, goHome } from './navigation.js';

let review = [];      // the exercises being edited (one when editing, any number after Convert)
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
  $('dStart').value = noteName(state.defaultRange.start);
  $('dEnd').value = noteName(state.defaultRange.end);
  review = exercise ? [{ ...exercise, vows: [...exercise.vows] }] : [];
  renderCards();
}

const selectHTML = (key, options, value) => `<select data-k="${key}">${options.map(([optionValue, text]) => `<option value="${optionValue}"${String(optionValue) == String(value) ? ' selected' : ''}>${text}</option>`).join('')}</select>`;

function cardHTML(exercise, index) {
  return `<div class="card ed" data-i="${index}">
  <h3>${editMode ? '' : (index + 1) + '. '}${esc(exercise.name)}</h3>
  <label>Name</label><input data-k="name" value="${esc(exercise.name)}">
  <label>Pattern: scale degrees, ~ means hold</label><input data-k="pat" value="${esc(exercise.pat)}">
  <div class="grid">
    <div><label>Sounds (commas = one pass each)</label><input data-k="vows" value="${esc(exercise.vows.join(', '))}" placeholder="ah"></div>
    <div><label>Sound on root notes (optional)</label><input data-k="rootVow" value="${esc(exercise.rootVow)}"></div>
    <div><label>From</label><input data-k="start" value="${noteName(exercise.start)}"></div>
    <div><label>To</label><input data-k="end" value="${noteName(exercise.end)}"></div>
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
  const secondsPerBeat = 60 / exercise.bpm;
  const notes = parsePat(exercise.pat);
  const root = rootsOf(exercise, notes)[0];
  let time = getAudioContext().currentTime + 0.1;
  notes.forEach((note) => {
    const duration = secondsPerBeat * (note.h ? exercise.hold : 1);
    playPianoNote(root + note.s, time, duration, bus, preview.oscillators);
    time += duration;
  });
}

function renderCards() {
  $('eds').innerHTML = review.map(cardHTML).join('');
  $('saveRow').hidden = !review.length;
  $('saveBtn').textContent = editMode ? 'Save changes' : `Save ${review.length} exercise${review.length == 1 ? '' : 's'}`;
  $('eds').querySelectorAll('.ed').forEach((card) => {
    const index = +card.dataset.i;
    const updateFromCard = () => {
      const exercise = readCard(card);
      if (exercise) review[index] = exercise;
    };
    card.addEventListener('input', updateFromCard);
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
      renderCards();
    };
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
  if (start == null || end == null || !notes) {
    summary.textContent = 'Check the pattern (like 1-3-5-8~-5-3-1) and the notes (like E2, Eb5).';
    return null;
  }
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
  });
  const roots = rootsOf(exercise, notes);
  const highestOffset = Math.max(...notes.map((note) => note.s));
  const passes = Math.max(1, exercise.vows.length);
  const firstRound = notes.map((note) => noteName(roots[0] + note.s)).join(' ');
  summary.textContent = `${roots.length} round${roots.length > 1 ? 's' : ''}${passes > 1 ? ` × ${passes} passes (${exercise.vows.join(', then ')})` : ''}. First round: ${firstRound}. Highest note: ${noteName(Math.max(...roots) + highestOffset)}.${roots.length >= 48 ? ' (Capped at 48 rounds.)' : ''}`;
  return exercise;
}

export function initEditor() {
  $('newBtn').onclick = () => {
    $('notes').value = '';
    $('ocr').hidden = true;
    openEditor(null);
  };
  $('parseBtn').onclick = () => {
    const defaultStart = toMidi($('dStart').value);
    const defaultEnd = toMidi($('dEnd').value);
    if (defaultStart != null && defaultEnd != null) {
      state.defaultRange = { start: defaultStart, end: defaultEnd };
      store.set(KEYS.defaultRange, state.defaultRange);
    }
    if (!$('notes').value.trim()) return;
    review = parseAll($('notes').value, state.defaultRange);
    renderCards();
    if (review.length) $('eds').scrollIntoView({ behavior: 'smooth' });
  };
  $('saveBtn').onclick = () => {
    const cards = [...$('eds').querySelectorAll('.ed')];
    const exercises = cards.map(readCard);
    if (exercises.some((x) => !x)) return;
    exercises.forEach((exercise) => {
      const existing = state.exercises.findIndex((x) => x.id == exercise.id);
      if (existing >= 0) state.exercises[existing] = exercise;
      else state.exercises.push(exercise);
    });
    saveExercises();
    goHome();
  };
}
