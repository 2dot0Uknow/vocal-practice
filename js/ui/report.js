// The session report screen. summarizeSession() (scoring.js) does the maths; this file only
// turns that data into HTML, saves the run to history and shows the screen.

import { $, esc } from './dom.js';
import { navTo } from './navigation.js';
import { noteName } from '../music.js';
import { store, KEYS } from '../store.js';
import { state } from '../state.js';

const MAX_HISTORY = 200;

/** The stat bars: label, a coloured bar, and a word. */
export const statRowsHTML = (rows) => rows.map(({ name, value, label }) => `<div class="stat"><span>${name}</span><span class="b"><i style="width:${Math.round(value)}%;background:${value >= 70 ? 'var(--on)' : value >= 45 ? 'var(--near)' : 'var(--far)'}"></i></span><span>${esc(label)}</span></div>`).join('');

export const listItemsHTML = (items) => items.map((text) => `<li>${esc(text)}</li>`).join('');

/** "Note by note": one strip per round (and per sound pass), one cell per note. */
export function noteStripsHTML(results, exercise) {
  const groups = {};
  results.forEach((result) => {
    const key = result.round + '-' + result.pass;
    (groups[key] = groups[key] || []).push(result);
  });
  return Object.values(groups).map((strip) => `<div class="strip"><span class="rl">Round ${strip[0].round + 1}${exercise.vows.length > 1 ? ' · ' + esc(exercise.vows[strip[0].pass]) : ''}</span>${strip.map((result) => {
    const cents = result.miss ? null : Math.abs(result.med);
    const background = result.miss ? '' : cents <= 25 ? 'var(--on)' : cents <= 50 ? 'var(--near)' : 'var(--far)';
    return `<div class="cell${result.miss ? ' miss' : ''}" style="${background ? 'background:' + background : ''}"><b>${noteName(result.m)}</b>${result.miss ? '—' : (result.med > 0 ? '+' : '') + Math.round(result.med)}</div>`;
  }).join('')}</div>`).join('');
}

/** What gets saved to history for a finished run (vp_hist entries, newest first). */
export const historyEntry = (exercise, pct, now = new Date()) => ({
  name: exercise.name,
  pct,
  ts: now.getTime(),
  date: now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
});

/** Earlier runs of the same exercise (matched by name), newest first. */
export const previousRunsOf = (exercise) => store.get(KEYS.history, []).filter((entry) => entry.name == exercise.name);

/** Fill the report screen from a summary, save the run if anything was heard, and open it. */
export function showReport(exercise, summary) {
  $('repTitle').textContent = exercise.name;
  $('sPct').textContent = summary.pct + '%';
  $('sSub').textContent = summary.subtitle;
  $('stats').innerHTML = statRowsHTML(summary.rows);
  $('tips').innerHTML = listItemsHTML(summary.tips);
  $('good').innerHTML = listItemsHTML(summary.good);
  $('cheer').textContent = summary.cheer;
  $('notesOut').innerHTML = noteStripsHTML(summary.results, exercise);
  if (summary.saveable) {
    const history = store.get(KEYS.history, []);
    history.unshift(historyEntry(exercise, summary.pct));
    store.set(KEYS.history, history.slice(0, MAX_HISTORY));
    state.historyShown = 3;
  }
  $('trNote').hidden = !summary.hasTrillNotes;
  $('nextBtn').hidden = !state.queue.length;
  if (state.queue.length) $('nextBtn').textContent = 'Next: ' + state.queue[0].name;
  navTo('rep');
}
