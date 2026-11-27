// The practice screen: plays the piano, listens through the mic, draws the pitch roll and, when
// the session ends, hands the recorded frames to the report.

import { $, fillRange } from './dom.js';
import { state } from '../state.js';
import { store, KEYS } from '../store.js';
import { noteName, hzToMidi, spellingOf } from '../music.js';
import { buildSession, describeExercise } from '../exercise.js';
import { detect } from '../pitch.js';
import { err, strictAt, estimateLag, activeAt, median, summarizeSession } from '../scoring.js';
import {
  ensureAudio, setPianoVolume, openMic, micInputLatency, outputDelayEstimate, getAudioContext,
  resetTrillMode, setTrillMode, captureMicSamples, analysisWindow, brightness, playPianoNote, closeAudio,
} from '../audio.js';
import { navTo, goHome, currentScreen } from './navigation.js';
import { createSessionMachine, decideEnd, reportTitle, MIC_MESSAGES } from '../session.js';
import { acquireWakeLock, releaseWakeLock } from '../wakelock.js';
import { createRoll } from './roll.js';
import { showReport } from './report.js';
import { previousRunsOf } from '../history.js';

let currentExercise = null;
let sequence = null;            // the built session: {targets, plays, end}
let frames = [];                // one entry per analysis of the microphone
const session = createSessionMachine();   // idle -> starting -> running -> stopping -> idle
let sessionToken = 0;           // changes whenever a session starts or is torn down, so a late mic answer can tell it is stale
let animationFrame = 0;
const isRunning = () => session.state === 'running';

// Delay between the piano being scheduled and you hearing it (output latency), in seconds.
// null = work it out automatically at Start. The picture-delay slider overrides it (saved as vp_lat).
let outputLatency = store.get(KEYS.pictureDelay, null);
// Delay between you singing and the mic frame being analysed.
let inputLatency = 0.02;
// Voice lag: how long after a note sounds the singer's matching pitch shows up (saved as vp_vlag).
let voiceLag = store.get(KEYS.voiceLag, 0.15);
let lastLagEstimateAt = 0;
let recentTrillPitches = [];    // trill mode: pitches from the last ~0.15 s, for smoothing

let roll = null;

/** The song clock: audio time minus what the player hears late. */
const songTime = () => getAudioContext().currentTime - outputLatency;

function showPictureDelay() {
  $('sync').value = Math.round((outputLatency ?? 0.1) * 1000);
  fillRange($('sync'));
  $('syncV').textContent = outputLatency == null ? 'auto' : Math.round(outputLatency * 1000) + ' ms';
}

function drawRoll(now = isRunning() ? songTime() : 0) {
  roll.draw({ sequence, frames, now, running: isRunning(), voiceLag, spelling: spellingOf(currentExercise) });
}

/** Re-read the theme colours and redraw (called after the theme changes). */
export function refreshRoll() {
  roll.readColours();
  drawRoll();
}

/** Put the practice screen back to its idle look for the current exercise. */
function resetPracticeView() {
  sequence = buildSession(currentExercise, 0);
  frames = [];
  $('goBtn').textContent = 'Start';
  $('goBtn').disabled = false;
  $('rSyl').textContent = sequence.targets[0]?.syl || '–';
  roll.fit(sequence, 0, false);
  drawRoll();
}

export function openPractice(exercise) {
  abortSession();
  hideMicCard();
  currentExercise = exercise;
  navTo('prac');
  $('pName').textContent = exercise.name + (state.queue.length ? `  ·  ${state.queue.length} more after this` : '');
  $('pInfo').textContent = describeExercise(exercise);
  resetPracticeView();
}

function showMicCard(reason) {
  $('micCardMsg').textContent = MIC_MESSAGES[reason] || MIC_MESSAGES.other;
  $('micCard').hidden = false;
}

function hideMicCard() {
  $('micCard').hidden = true;
}

async function startSession() {
  if (!session.can('starting')) return;   // already starting, running or stopping: a second tap does nothing
  session.go('starting');
  const token = ++sessionToken;
  hideMicCard();
  $('goBtn').disabled = true;
  $('goBtn').textContent = 'Starting…';
  ensureAudio();
  const mic = await openMic();
  // Anything may have happened while the browser was asking: Back, the phone locking, another Start.
  if (token !== sessionToken) return;     // already torn down by whoever changed things
  if (!mic.ok) {
    abortSession();
    if (mic.reason !== 'cancelled') showMicCard(mic.reason);
    return;
  }
  if (session.state !== 'starting' || currentScreen() !== 'prac') {
    abortSession();
    return;
  }
  if (outputLatency == null) {
    const estimate = outputDelayEstimate();
    outputLatency = Math.min(0.5, estimate > 0.01 ? estimate : 0.1);
  }
  inputLatency = micInputLatency();
  showPictureDelay();
  // Start 0.6 s from now so the first chord is scheduled in good time.
  const startTime = getAudioContext().currentTime + 0.6;
  sequence = buildSession(currentExercise, startTime);
  frames = [];
  resetTrillMode();
  recentTrillPitches = [];
  lastLagEstimateAt = 0;
  sequence.plays.forEach((play) => play.m.forEach((midi) => playPianoNote(midi, play.t, play.d)));
  session.go('running');
  acquireWakeLock();
  $('goBtn').disabled = false;
  $('goBtn').textContent = 'Stop';
  loop();
}

/** Release the piano, the microphone, the wake lock and the animation loop. Does not touch the session state. */
function teardown() {
  sessionToken++;
  cancelAnimationFrame(animationFrame);
  closeAudio();
  releaseWakeLock();
}

/**
 * Silently end whatever is going on (leaving the screen, opening another exercise): no report.
 * main.js hands this to the navigation as "stop the session".
 */
export function abortSession() {
  hideMicCard();                      // leaving the screen (or ending a start) clears any mic message
  if (session.state === 'idle') return;
  if (session.state === 'running') session.go('stopping');
  teardown();
  if (session.can('idle')) session.go('idle');
  $('goBtn').textContent = 'Start';
  $('goBtn').disabled = false;
}

/**
 * The one way a session ends with a report decision. reason: 'finished' (ran to the end),
 * 'stopped' (Stop button) or 'hidden' (phone locked / app switched). See decideEnd in session.js.
 */
function endSession(reason) {
  if (session.state === 'idle' || session.state === 'stopping') return;
  const wasRunning = isRunning();
  const exercise = currentExercise;
  const endedAt = wasRunning ? songTime() : null;   // read the clock before the audio is closed
  const { targets } = sequence;
  const recorded = frames;
  abortSession();
  if (!wasRunning) return;                          // still waiting for the mic: nothing was sung
  const decision = decideEnd({ reason, songTime: endedAt, targets, voiceLag });
  if (!decision.showReport) {
    resetPracticeView();                            // under one round: back to a quiet, idle practice screen
    return;
  }
  const summary = summarizeSession({
    targets: decision.scoredTargets,
    frames: recorded,
    voiceLag,
    previousRuns: decision.partial ? [] : previousRunsOf(store.get(KEYS.history, []), exercise),
    partial: decision.partial,
  });
  // The learned voice lag is calibration, not progress, so it is kept even for a stopped run.
  voiceLag = summary.voiceLag;
  store.set(KEYS.voiceLag, voiceLag);
  showReport(exercise, summary, { title: reportTitle(exercise.name, decision), save: decision.save });
}

/** One animation frame: listen, detect the pitch, update the readouts and the roll. */
function loop() {
  if (!isRunning()) return;
  captureMicSamples();
  const now = songTime();
  const target = activeAt(sequence.targets, now) || sequence.targets.find((x) => x.t0 > now);
  const trill = !!(target && target.trill);
  setTrillMode(trill);
  const { samples, sampleRate } = analysisWindow(trill);
  const pitch = trill
    ? detect(samples, sampleRate, { gate: 0.004, min: 0.4 })
    : detect(samples, sampleRate);
  const frame = { t: now - inputLatency, m: null, tr: trill };
  if (pitch) {
    frame.m = hzToMidi(pitch.f);
    frame.c = pitch.c;
    frame.ring = brightness();
  }
  if (trill) {
    // Smooth over the flutter: median of the last ~0.15 s, and bridge short dropouts.
    if (frame.m != null) recentTrillPitches.push({ t: now, m: frame.m });
    const windowSeconds = target ? Math.min(0.15, Math.max(0.06, (target.t1 - target.t0) * 0.3)) : 0.15;
    recentTrillPitches = recentTrillPitches.filter((entry) => now - entry.t < windowSeconds);
    if (recentTrillPitches.length) frame.m = median(recentTrillPitches.map((entry) => entry.m));
  } else {
    recentTrillPitches = [];
  }
  frames.push(frame);

  // Every 1.5 s, nudge the voice lag toward what the last 8 s of singing suggests.
  if (now - lastLagEstimateAt > 1.5) {
    lastLagEstimateAt = now;
    const estimate = estimateLag(frames.filter((f) => f.t > now - 8), sequence.targets);
    if (estimate != null) voiceLag = voiceLag + (estimate - voiceLag) * 0.5;
  }

  // The note the voice is judged against: the one sounding when it was sung (after lag), else the current one.
  const judgedTarget = frame.m != null ? (strictAt(sequence.targets, frame.t - voiceLag) || target) : target;
  $('rTarget').textContent = target ? noteName(target.m, spellingOf(currentExercise)) : '–';
  $('rSyl').textContent = target && target.syl ? target.syl : '–';
  if (frame.m != null) {
    $('rNote').textContent = noteName(frame.m, spellingOf(currentExercise));
    if (judgedTarget) {
      const cents = err(frame.m, judgedTarget.m);
      $('rCents').textContent = (cents > 0 ? '+' : '') + Math.round(cents) + ' cents';
      // The needle spans +-100 cents across the meter.
      $('needle').style.left = `calc(${50 + Math.max(-50, Math.min(50, cents / 2))}% - 2px)`;
    }
  }
  drawRoll(now);
  if (now > sequence.end) {
    endSession('finished');
    return;
  }
  animationFrame = requestAnimationFrame(loop);
}

export function initPractice() {
  roll = createRoll($('cv'));
  new ResizeObserver(() => {
    roll.resize();
    drawRoll();
  }).observe($('cv'));
  new MutationObserver(() => roll.readColours()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  setPianoVolume(+$('vol').value);
  $('vol').oninput = () => setPianoVolume(+$('vol').value);
  $('sync').oninput = () => {
    outputLatency = +$('sync').value / 1000;
    store.set(KEYS.pictureDelay, outputLatency);
    showPictureDelay();
  };
  showPictureDelay();

  $('syncReset').onclick = () => {
    outputLatency = null;
    store.remove(KEYS.pictureDelay);
    showPictureDelay();
  };

  $('goBtn').onclick = () => (isRunning() ? endSession('stopped') : startSession());
  $('micRetry').onclick = startSession;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (session.state === 'starting' || isRunning()) endSession('hidden');
    } else if (isRunning()) {
      acquireWakeLock();   // the browser drops the lock when the page is hidden
    }
  });
  $('backBtn').onclick = goHome;
  $('againBtn').onclick = () => openPractice(currentExercise);
  $('nextBtn').onclick = () => openPractice(state.queue.shift());
}
