// The library screen: journey stats, exercise list, history.

import { $, esc } from './dom.js';
import { state } from '../state.js';
import { store, KEYS } from '../store.js';
import { describeExercise } from '../exercise.js';
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
    : 'No sessions yet.';
  const left = history.length - state.historyShown;
  $('moreBtn').hidden = left <= 0;
  if (left > 0) $('moreBtn').textContent = `Load more (${Math.min(6, left)} of ${left} left)`;
}

export function renderLibrary() {
  $('list').innerHTML = state.exercises.map((exercise, i) => `<div class="card ex"><div class="t"><b>${esc(exercise.name)}</b><small>${esc(describeExercise(exercise))}</small></div><button class="ghost ico" data-i="${i}" data-a="e" aria-label="Edit ${esc(exercise.name)}" title="Edit">${EDIT_ICON}</button><button class="pri ico" data-i="${i}" data-a="p" aria-label="Practice ${esc(exercise.name)}" title="Practice">${PLAY_ICON}</button></div>`).join('') || '<p class="note">No exercises yet. Tap "Add exercises".</p>';
  $('list').querySelectorAll('button').forEach((button) => {
    button.onclick = () => {
      const exercise = state.exercises[+button.dataset.i];
      if (button.dataset.a == 'p') {
        state.queue = [];
        openPractice(exercise);
      } else {
        openEditor(exercise);
      }
    };
  });
  $('allBtn').disabled = !state.exercises.length;
  const history = store.get(KEYS.history, []);
  const stats = journeyStats(history);
  $('journey').innerHTML = `<div><b>${stats.sessions}</b><span>sessions</span></div><div><b>${stats.thisWeek}</b><span>this week</span></div><div><b>${stats.streak}</b><span>day streak</span></div>`;
  renderHistory(history);
  const micAvailable = window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  $('micWarn').hidden = !!micAvailable;
  $('micWarn').textContent = "The microphone can't be used here. Open this app from its https:// web address so it can hear you.";
}

export function initLibrary() {
  $('moreBtn').onclick = () => {
    state.historyShown += 6;
    renderHistory();
  };
  $('allBtn').onclick = () => {
    state.queue = state.exercises.slice(1);
    openPractice(state.exercises[0]);
  };
}
