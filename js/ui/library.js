// The library screen: journey stats, exercise list, history.

import { $, esc } from './dom.js';
import { state, saveExercises, startSet, endSet, DEFAULT_RANGE } from '../state.js';
import { store, KEYS } from '../store.js';
import { describeExercise, SAMPLES } from '../exercise.js';
import { noteName } from '../music.js';
import { moveExercise, shouldOnboard, readComfortableRange, rebaseSamples } from '../library-ops.js';
import { entryLabel } from '../history.js';
import { openPractice } from './practice.js';
import { openEditor } from './editor.js';

const EDIT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';

const DAY_MS = 864e5;

/** Sessions so far, sessions in the last 7 days, and the current daily streak (today may still be empty). */
export function journeyStats(history, nowMs = Date.now()) {
  const dayKey = (time) => new Date(time).toDateString();
  const daysPracticed = new Set(history.filter((entry) => entry.ts).map((entry) => dayKey(entry.ts)));
  let streak = 0;
  const day = new Date(nowMs);
  if (!daysPracticed.has(dayKey(day))) day.setDate(day.getDate() - 1);
  while (daysPracticed.has(dayKey(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  const thisWeek = history.filter((entry) => entry.ts && nowMs - entry.ts < 7 * DAY_MS).length;
  return { sessions: history.length, thisWeek, streak };
}

/** Journey list: newest 3, then 6 more each time "Load more" is tapped. */
function renderHistory(history = store.get(KEYS.history, [])) {
  $('hist').innerHTML = history.length
    ? history.slice(0, state.historyShown).map((entry) => `<div class="stat" style="grid-template-columns:minmax(0,1fr) auto"><span>${esc(entryLabel(entry, state.exercises))} <small>· ${esc(entry.date)}</small></span><span>${esc(entry.pct)}% landed</span></div>`).join('')
    : state.exercises.length
      ? 'Your journey starts with your first run. Tap ▶ on an exercise above to begin.'
      : 'Your journey starts with your first run.';
  const left = history.length - state.historyShown;
  $('moreBtn').hidden = left <= 0;
  if (left > 0) $('moreBtn').textContent = `Load more (${Math.min(6, left)} of ${left} left)`;
}

const MOVE_UP_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
const MOVE_DOWN_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

let reordering = false;   // F6: the list shows move up / move down buttons instead of edit / practice

function exerciseRowHTML(exercise, i, count) {
  const name = esc(exercise.name);
  const buttons = reordering
    ? `<div class="moves"><button class="ghost ico" data-i="${i}" data-a="up" aria-label="Move ${name} up" title="Move up"${i == 0 ? ' disabled' : ''}>${MOVE_UP_ICON}</button><button class="ghost ico" data-i="${i}" data-a="down" aria-label="Move ${name} down" title="Move down"${i == count - 1 ? ' disabled' : ''}>${MOVE_DOWN_ICON}</button></div>`
    : `<button class="ghost ico" data-i="${i}" data-a="e" aria-label="Edit ${name}" title="Edit">${EDIT_ICON}</button><button class="pri ico" data-i="${i}" data-a="p" aria-label="Practice ${name}" title="Practice">${PLAY_ICON}</button>`;
  return `<div class="card ex"><div class="t"><b>${name}</b><small>${esc(describeExercise(exercise))}</small></div>${buttons}</div>`;
}

/** F6: move one exercise, save, redraw, and keep the focus on the button that was used (or its twin when it hit the end). */
function moveInList(index, delta) {
  const moved = moveExercise(state.exercises, index, delta);
  if (moved === state.exercises) return;
  const name = state.exercises[index].name;
  state.exercises = moved;
  saveExercises();
  renderLibrary();
  const newIndex = index + delta;
  const wanted = delta < 0 ? 'up' : 'down';
  const button = $('list').querySelector(`button[data-i="${newIndex}"][data-a=${wanted}]:not(:disabled)`) || $('list').querySelector(`button[data-i="${newIndex}"]:not(:disabled)`);
  if (button) button.focus();
  $('reorderNote').textContent = `${name} is now number ${newIndex + 1} of ${state.exercises.length}.`;
  $('reorderNote').hidden = false;
}

export function renderLibrary() {
  if (state.exercises.length < 2) reordering = false;
  $('list').innerHTML = state.exercises.map((exercise, i) => exerciseRowHTML(exercise, i, state.exercises.length)).join('')
    || '<div class="card warn"><b>Nothing here yet</b><p class="note">Add your coach\'s exercises and they will show up here as piano-guided drills. Type them in, paste them, or photograph the page.</p><button class="pri" data-a="add">+ Add exercises</button></div>';
  $('list').querySelectorAll('button').forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.a;
      if (action == 'add') return openEditor(null);
      const index = +button.dataset.i;
      if (action == 'up') return moveInList(index, -1);
      if (action == 'down') return moveInList(index, 1);
      const exercise = state.exercises[index];
      if (action == 'p') {
        endSet();
        openPractice(exercise);
      } else {
        openEditor(exercise);
      }
    };
  });
  $('reorderBtn').hidden = state.exercises.length < 2;
  $('reorderBtn').textContent = reordering ? 'Done' : 'Reorder';
  $('reorderBtn').setAttribute('aria-pressed', String(reordering));
  if (!reordering) $('reorderNote').hidden = true;
  renderOnboarding();
  $('allBtn').disabled = !state.exercises.length;
  const history = store.get(KEYS.history, []);
  const stats = journeyStats(history);
  $('journey').innerHTML = `<div><b>${stats.sessions}</b><span>sessions</span></div><div><b>${stats.thisWeek}</b><span>this week</span></div><div><b>${stats.streak}</b><span>day streak</span></div>`;
  renderHistory(history);
  const micAvailable = window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  $('micWarn').hidden = !!micAvailable;
  $('micWarn').textContent = "The microphone can't be used here. Open this app from its https:// web address so it can hear you.";
}

// ---- F10: the one-time "comfortable range" card ----

/** Show the card on a fresh profile (nothing saved, nothing sung, never answered). */
function renderOnboarding() {
  const fresh = shouldOnboard({
    hasExercises: store.get(KEYS.exercises, null) != null,
    hasHistory: store.get(KEYS.history, []).length > 0,
    onboarded: !!store.get(KEYS.onboarded, 0),
  });
  if ($('onboard').hidden && fresh) {
    // Offer the range the samples use today.
    const range = store.get(KEYS.defaultRange, DEFAULT_RANGE);
    $('obLow').value = noteName(range.start, 'auto');
    $('obHigh').value = noteName(range.end, 'auto');
    $('obMsg').hidden = true;
  }
  $('onboard').hidden = !fresh;
}

function saveOnboarding() {
  const range = readComfortableRange($('obLow').value, $('obHigh').value);
  if (!range.ok) {
    $('obMsg').textContent = range.message;
    $('obMsg').hidden = false;
    $(range.field == 'low' ? 'obLow' : 'obHigh').setAttribute('aria-invalid', 'true');
    $(range.field == 'low' ? 'obLow' : 'obHigh').focus();
    return;
  }
  state.defaultRange = { start: range.low, end: range.high };
  store.set(KEYS.defaultRange, state.defaultRange);
  state.exercises = rebaseSamples(SAMPLES, range.low, range.high);
  saveExercises();
  store.set(KEYS.onboarded, 1);
  renderLibrary();
}

function dismissOnboarding() {
  store.set(KEYS.onboarded, 1);
  $('onboard').hidden = true;
}

export function initLibrary() {
  $('obSave').onclick = saveOnboarding;
  $('obSkip').onclick = dismissOnboarding;
  ['obLow', 'obHigh'].forEach((id) => $(id).addEventListener('input', () => {
    $(id).removeAttribute('aria-invalid');
    $('obMsg').hidden = true;
  }));
  $('reorderBtn').onclick = () => {
    reordering = !reordering;
    renderLibrary();
  };
  $('moreBtn').onclick = () => {
    state.historyShown += 6;
    renderHistory();
  };
  $('allBtn').onclick = () => {
    openPractice(startSet(state.exercises));
  };
}
