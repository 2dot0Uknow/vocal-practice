// The session report screen. summarizeSession() (scoring.js) does the maths; this file only
// turns that data into HTML, saves the run to history and shows the screen.

import { $, esc } from './dom.js';
import { navTo } from './navigation.js';
import { noteName, spellingOf } from '../music.js';
import { store, KEYS } from '../store.js';
import { state } from '../state.js';
import { historyEntry, addToHistory } from '../history.js';

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
    // A1: a note about an octave from the piano shows as "8vb" / "8va" instead of a number like -1200.
    const shown = result.miss ? '—' : result.octaveOff ? (result.med < 0 ? '8vb' : '8va') : (result.med > 0 ? '+' : '') + Math.round(result.med);
    return `<div class="cell${result.miss ? ' miss' : ''}" style="${background ? 'background:' + background : ''}"><b>${noteName(result.m, spellingOf(exercise))}</b>${shown}</div>`;
  }).join('')}</div>`).join('');
}

let debugUrl = null;   // object URL of the current debug download, released when the next report opens

/**
 * Fill the report screen from a summary, save the run if anything was heard, and open it.
 * options.title replaces the heading; options.save = false shows the report without saving it (stopped runs).
 * options.debugSession (A7, only with ?debug=1): the session's data, offered as a JSON download.
 */
export function showReport(exercise, summary, { title = exercise.name, save = true, debugSession = null } = {}) {
  $('repTitle').textContent = title;
  $('sPct').textContent = summary.pct + '%';
  $('sSub').textContent = summary.subtitle;
  $('stats').innerHTML = statRowsHTML(summary.rows);
  $('tips').innerHTML = listItemsHTML(summary.tips);
  $('good').innerHTML = listItemsHTML(summary.good);
  $('cheer').textContent = summary.cheer;
  $('notesOut').innerHTML = noteStripsHTML(summary.results, exercise);
  if (save && summary.saveable) {
    store.set(KEYS.history, addToHistory(store.get(KEYS.history, []), historyEntry(exercise, summary)));
    state.historyShown = 3;
  }
  $('trNote').hidden = !summary.hasTrillNotes;
  $('toneNote').hidden = summary.toneHidden;
  $('leakNote').textContent = summary.leakNote;
  $('leakNote').hidden = !summary.leakNote;
  if (debugUrl) URL.revokeObjectURL(debugUrl);
  debugUrl = null;
  $('debugRow').hidden = !debugSession;
  if (debugSession) {
    debugUrl = URL.createObjectURL(new Blob([JSON.stringify(debugSession)], { type: 'application/json' }));
    $('debugLink').href = debugUrl;
    $('debugLink').download = `vocal-practice-session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  }
  $('nextBtn').hidden = !state.queue.length;
  if (state.queue.length) $('nextBtn').textContent = 'Next: ' + state.queue[0].name;
  navTo('rep');
}
