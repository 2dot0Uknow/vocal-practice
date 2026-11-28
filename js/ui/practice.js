// The practice screen: plays the piano, listens through the mic, draws the pitch roll and, when
// the session ends, hands the recorded frames to the report.

import { $, fillRange } from './dom.js';
import { state } from '../state.js';
import { roundLabel, progressFraction, singReadout, readoutsFaded, setLabel } from '../flow.js';
import { store, KEYS } from '../store.js';
import { noteName, hzToMidi, spellingOf } from '../music.js';
import { planRounds, describeExercise } from '../exercise.js';
import { parsePat } from '../music.js';
import { detect } from '../pitch.js';
import { cents, strictAt, estimateLag, activeAt, median, summarizeSession } from '../scoring.js';
import { createCalibration, rms, DEFAULT_GATE } from '../calibration.js';
import { isNarrowBand } from '../tone.js';
import { isDebugMode, buildDebugSession } from '../debug.js';
import { createFrameStore, nextTargetAfter } from '../timeindex.js';
import { createRun } from '../run.js';
import { createScheduler } from '../scheduler.js';
import {
  ensureAudio, setPianoVolume, openMic, micInputLatency, outputDelayEstimate, getAudioContext,
  resetTrillMode, setTrillMode, captureMicSamples, analysisWindow, brightness, playPianoNote, cancelPianoNote, closeAudio,
  micSampleRate, highBandRatio, loadPianoSamples, pianoReady,
} from '../audio.js';
import { navTo, goHome, currentScreen, pageTitle } from './navigation.js';
import { createSessionMachine, decideEnd, reportTitle, MIC_MESSAGES } from '../session.js';
import { acquireWakeLock, releaseWakeLock } from '../wakelock.js';
import { createRoll } from './roll.js';
import { showReport } from './report.js';
import { openEditor } from './editor.js';
import { previousRunsOf } from '../history.js';

let currentExercise = null;
let plan = null;               // planRounds(currentExercise): the round list (for the round line's root notes)
let firstChordEnd = null;       // F2: song time at which the first cue chord ends ("Ready…" until then); null when idle
let lastVoicedAt = null;        // F3: performance.now() of the last analysis that heard a voice
let roundLineShown = '';        // what the round line / progress bar last showed, so the loop only touches the page on change
let run = null;                 // the rounds placed on the song clock so far (run.js); run.targets() is what is drawn and scored
const frameStore = createFrameStore();   // one entry per analysis of the microphone, in time order
let scheduler = null;           // hands the piano to the audio layer ~2 s ahead (scheduler.js)
let analysisTimer = 0;          // setInterval id: pitch analysis every ANALYSIS_MS, independent of drawing
let latest = { target: null, frame: null, judgedTarget: null };   // what the last analysis saw, for the readouts
let holdView = null;            // while paused: the song time the roll stays at
let holdAnalysisUntil = 0;      // while paused: keep listening until the last round's late notes are in (song time)
const session = createSessionMachine();   // idle -> starting -> running -> stopping -> idle
let sessionToken = 0;           // changes whenever a session starts or is torn down, so a late mic answer can tell it is stale
let animationFrame = 0;
const ANALYSIS_MS = 20;         // pitch analysis rate (~50 per second)
const PLACE_AHEAD = 4.5;        // seconds ahead that rounds are placed on the clock (the roll shows 4 s ahead)
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
// A5 / A2: what the first cue chord (nobody singing) tells us. See calibration.js.
let calibration = null;         // collects the first chord's readings; null once it has answered (or before a session)
let gate = DEFAULT_GATE;        // pitch gate for non-trill listening: 3 x the noise floor once measured, else today's 0.012
let pianoLeak = false;          // the piano was heard through the mic during the first chord
// A3: narrow-band detection (Bluetooth call mode etc.): the mic track's sample rate, and the spectrum's high-band readings.
let micRate = 0;
let highBandRatios = [];
// Trill mode keeps its own fixed gate: its mic chain is filtered and boosted 2.5x, so the floor measured on the plain
// chain does not apply, and 0.004 is already the lowest gate calibration may choose.
const TRILL_GATE = 0.004;

let roll = null;

/** The song clock: audio time minus what the player hears late. */
const songTime = () => getAudioContext().currentTime - outputLatency;

/** After a backup is restored (P5): read the picture delay and voice lag again from storage. */
export function reloadSavedSettings() {
  outputLatency = store.get(KEYS.pictureDelay, null);
  voiceLag = store.get(KEYS.voiceLag, 0.15);
  showPictureDelay();
}

function showPictureDelay() {
  $('sync').value = Math.round((outputLatency ?? 0.1) * 1000);
  fillRange($('sync'));
  $('syncV').textContent = outputLatency == null ? 'auto' : Math.round(outputLatency * 1000) + ' ms';
}

const viewTargets = () => (run ? run.targets() : []);

function drawRoll(now = isRunning() ? (holdView ?? songTime()) : 0) {
  roll.draw({ targets: viewTargets(), frames: frameStore.frames, now, running: isRunning(), voiceLag, spelling: spellingOf(currentExercise) });
}

/** Re-read the theme colours and redraw (called after the theme changes). */
export function refreshRoll() {
  roll.readColours();
  drawRoll();
}

/** Put the practice screen back to its idle look for the current exercise. */
function resetPracticeView() {
  // Idle preview: the first rounds laid out from time 0, as a run would place them.
  try {
    plan = planRounds(currentExercise);
    run = createRun(plan);
    run.start(0);
    run.advance(0, PLACE_AHEAD);
  } catch (error) {
    // A saved exercise whose pattern does not parse: show an empty roll; Start explains (see startSession).
    console.warn('Could not lay out this exercise', error);
    run = null;
    plan = null;
  }
  frameStore.clear();
  holdView = null;
  firstChordEnd = null;
  lastVoicedAt = null;
  showReadoutsQuiet();
  $('goBtn').textContent = 'Start';
  $('goBtn').disabled = false;
  updateControls();
  $('rSyl').textContent = run?.targets()[0]?.syl || '–';
  roundLineShown = '';
  updateRoundLine(0);
  if (run) roll.fit(run.targets(), 0, false);
  drawRoll();
}

/** F2: "Round 3 of 12 · starting on D3" and the thin progress bar, from the run and the heard song time `view`. */
function updateRoundLine(view) {
  if (!run || !plan) {
    $('roundLine').textContent = '';
    $('progFill').style.width = '0%';
    return;
  }
  const index = Math.max(0, run.currentIndex(view));
  const record = run.rounds.find((placed) => placed.index === index);
  const within = record && record.end > record.start ? (view - record.start) / (record.end - record.start) : 0;
  const fraction = isRunning() || holdView != null ? progressFraction(index, run.total, within) : 0;
  const text = roundLabel(index, run.total, plan.rounds[index].root, spellingOf(currentExercise));
  const key = `${text}|${Math.round(fraction * 200)}`;
  if (key === roundLineShown) return;
  roundLineShown = key;
  $('roundLine').textContent = text;
  $('progFill').style.width = fraction * 100 + '%';
  $('prog').setAttribute('aria-valuenow', Math.round(fraction * 100));
}

/** F3: "You" and the needle show a dash. */
function showReadoutsQuiet() {
  $('rNote').textContent = '–';
  $('rNote').classList.add('quiet');
  $('rCents').innerHTML = '&nbsp;';
  $('needle').classList.add('quiet');
}

export function openPractice(exercise) {
  abortSession();
  hideMicCard();
  hideLeakCard();
  currentExercise = exercise;
  // The heading is filled in before the screen opens, because opening it moves focus there (V4).
  $('pName').textContent = exercise.name + (state.set ? `  ·  ${setLabel(state.set.position, state.set.total)}` : '');
  navTo('prac', pageTitle('prac', exercise.name));
  loadPianoSamples();   // F5: the recorded piano loads while the screen is open (the synth plays until it is ready)
  $('pInfo').textContent = describeExercise(exercise);
  resetPracticeView();
}

function showMicCard(reason) {
  $('micCardMsg').textContent = MIC_MESSAGES[reason] || MIC_MESSAGES.other;
  $('micRetry').hidden = false;
  $('editFix').hidden = true;
  $('micCard').hidden = false;
}

/** The exercise itself could not be started (a pattern that does not parse): say so, and offer the editor instead of Try again. */
function showExerciseCard() {
  $('micCardMsg').textContent = parsePat(currentExercise.pat) ? "I couldn't start this exercise. Tap Edit to check it." : "This exercise's pattern needs fixing. Tap Edit to check it.";
  $('micRetry').hidden = true;
  $('editFix').hidden = false;
  $('micCard').hidden = false;
}

function hideMicCard() {
  $('micCard').hidden = true;
}

function hideLeakCard() {
  $('leakCard').hidden = true;
}

async function startSession() {
  if (!session.can('starting')) return;   // already starting, running or stopping: a second tap does nothing
  session.go('starting');
  const token = ++sessionToken;
  try {
    await beginSession(token);
  } catch (error) {
    // Anything unexpected (e.g. a pattern that does not parse): let go of mic and audio, back to idle, and explain.
    console.warn('Could not start the session', error);
    if (token !== sessionToken) return;
    abortSession();
    showExerciseCard();
  }
}

async function beginSession(token) {
  hideMicCard();
  hideLeakCard();
  $('goBtn').disabled = true;
  $('goBtn').textContent = 'Starting…';
  ensureAudio();
  const mic = await openMic();
  if (mic.ok) await pianoReady(1000);   // F5: if the samples are still on their way, give them a moment so the first chord is not the synth
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
  micRate = micSampleRate();
  highBandRatios = [];
  gate = DEFAULT_GATE;
  pianoLeak = false;
  showPictureDelay();
  // Start 0.6 s from now so the first chord is scheduled in good time.
  const context = getAudioContext();
  frameStore.clear();
  holdView = null;
  latest = { target: null, frame: null, judgedTarget: null };
  resetTrillMode();
  recentTrillPitches = [];
  lastLagEstimateAt = 0;
  plan = planRounds(currentExercise);
  run = createRun(plan);
  lastVoicedAt = null;
  roundLineShown = '';
  scheduler = createScheduler({
    now: () => context.currentTime,
    play: (midi, t, d) => playPianoNote(midi, t, d),
    cancel: cancelPianoNote,
    onTick: schedulerTick,
  });
  const firstPlays = run.start(context.currentTime + 0.6).plays;
  firstChordEnd = firstPlays[0].t + firstPlays[0].d;   // F2: "Ready…" until the first chord has finished
  scheduler.add(firstPlays);
  // The first play is the first round's cue chord: nobody should be singing then (A5, A2).
  calibration = createCalibration(firstPlays[0]);
  session.go('running');
  acquireWakeLock();
  $('goBtn').disabled = false;
  $('goBtn').textContent = 'Stop';
  updateControls();
  scheduler.tick();
  scheduler.start();
  analysisTimer = setInterval(analyse, ANALYSIS_MS);
  loop();
}

/**
 * Every ~25 ms (the scheduler's tick): put the rounds that are about to be reached on the clock, begin a
 * requested pause at the round boundary, and notice when the run is over. Independent of drawing.
 */
function schedulerTick() {
  if (!isRunning()) return;
  const audioNow = getAudioContext().currentTime;
  const { placed, held } = run.advance(audioNow, PLACE_AHEAD);
  placed.forEach((round) => scheduler.add(round.plays));
  if (held) beginHold();
  if (run.finishedBy(songTime())) endSession('finished');
}

/** A pause has just taken effect: no piano, the roll holds still, and listening stops once the last notes are in. */
function beginHold() {
  holdView = run.heldAt - outputLatency;
  lastVoicedAt = null;
  holdAnalysisUntil = holdView + 0.3 + voiceLag + 0.15;   // the last note's scoring tail plus the voice lag
  recentTrillPitches = [];
  latest = { target: null, frame: null, judgedTarget: null };
  updateControls();
}

/** The Pause / Resume button. */
function pauseOrResume() {
  if (!isRunning()) return;
  const audioNow = getAudioContext().currentTime;
  if (run.phase === 'held') {
    const { placed } = run.resume(audioNow);
    if (placed) scheduler.add(placed.plays);
    holdView = null;
    recentTrillPitches = [];
  } else {
    const { withdrawn } = run.requestPause(audioNow);
    // Rounds that were already placed after this one are taken back: nothing of them has sounded yet.
    if (withdrawn.length) scheduler.cancelFrom(withdrawn[0].start);
  }
  updateControls();
}

/** After Again or Skip: silence the piano, forget the frames of the attempt that was thrown away. */
function cutCurrentRound(discardFrom) {
  scheduler.cancelAll();
  // Frames within the voice lag after the round's start still belong to the previous round's last note.
  frameStore.discardAfter(discardFrom + voiceLag);
  recentTrillPitches = [];
  lastVoicedAt = null;
  latest = { target: null, frame: null, judgedTarget: null };
}

/** Again: play this round again from its cue chord, right away. */
function againRound() {
  if (!isRunning()) return;
  const audioNow = getAudioContext().currentTime;
  const result = run.again(audioNow);
  if (!result) return;
  cutCurrentRound(result.discardFrom);
  scheduler.add(result.placed.plays);
  updateControls();
}

/** Skip: leave this round (it is not scored) and go to the next round's cue chord. */
function skipRound() {
  if (!isRunning()) return;
  const audioNow = getAudioContext().currentTime;
  const result = run.skip(audioNow);
  if (!result) return;
  cutCurrentRound(result.discardFrom);
  if (result.last) {
    // Skipping the last round ends the run; it is a finished run when any round was sung, otherwise it is just a stop.
    if (!result.sung) endSession('stopped');
    return;                  // else the scheduler tick ends it as 'finished' (run.endTime)
  }
  if (result.placed) scheduler.add(result.placed.plays);
  if (result.held) beginHold();
  updateControls();
}

let controlsShown = '';   // what the three buttons last showed, so the drawing loop only touches the page when something changes

/** Show or hide Pause / Again / Skip and set their words, from the run's state. */
function updateControls() {
  const running = isRunning() && run;
  const held = running && run.phase === 'held';
  const pending = running && run.pausePending;
  const canPause = running && !held && run.canPause(getAudioContext().currentTime);
  const key = [!!running, !!held, !!pending, !!canPause, running && run.phase === 'done'].join();
  if (key === controlsShown) return;
  controlsShown = key;
  $('pauseBtn').hidden = !running;
  $('repeatBtn').hidden = !running;
  $('skipBtn').hidden = !running;
  $('pauseNote').hidden = !(held || pending);
  if (!running) return;
  $('pauseBtn').textContent = held ? 'Resume' : pending ? 'Pausing…' : 'Pause';
  $('pauseBtn').disabled = !held && !canPause;
  $('repeatBtn').disabled = held || run.phase === 'done';
  $('skipBtn').disabled = held || run.phase === 'done';
  $('pauseNote').textContent = held ? 'Paused. Resume starts the next round with its chord.' : 'Pausing after this round…';
}

/** Release the piano, the microphone, the wake lock and the animation loop. Does not touch the session state. */
function teardown() {
  sessionToken++;
  cancelAnimationFrame(animationFrame);
  clearInterval(analysisTimer);
  if (scheduler) scheduler.stop();
  scheduler = null;
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
  holdView = null;
  updateControls();
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
  const targets = run.targets();     // the last attempt of every round that was not skipped
  const recorded = frameStore.frames;
  abortSession();
  if (!wasRunning) return;                          // still waiting for the mic: nothing was sung
  const decision = decideEnd({ reason, songTime: endedAt, targets, voiceLag });
  if (!decision.showReport) {
    resetPracticeView();                            // under one round: back to a quiet, idle practice screen
    return;
  }
  const narrowBand = isNarrowBand({ sampleRate: micRate, highBandRatios });
  const lagUsed = voiceLag;
  const summary = summarizeSession({
    targets: decision.scoredTargets,
    frames: recorded,
    voiceLag,
    previousRuns: decision.partial ? [] : previousRunsOf(store.get(KEYS.history, []), exercise),
    partial: decision.partial,
    narrowBand,
    pianoLeak,
  });
  // The learned voice lag is calibration, not progress, so it is kept even for a stopped run.
  voiceLag = summary.voiceLag;
  store.set(KEYS.voiceLag, voiceLag);
  // A7: with ?debug=1 the report offers the session as a JSON download.
  const debugSession = isDebugMode(location.search)
    ? buildDebugSession({
      exercise,
      targets: decision.scoredTargets,
      frames: recorded,
      voiceLag: lagUsed,
      outputLatency,
      gate,
      pianoLeak,
      narrowBand,
      micSampleRate: micRate,
      userAgent: navigator.userAgent,
    })
    : null;
  showReport(exercise, summary, { title: reportTitle(exercise.name, decision), save: decision.save, debugSession });
}

/**
 * One pitch analysis (every ~20 ms, on its own timer so it keeps its pace whatever the screen is doing):
 * listen, detect the pitch, record a frame, nudge the voice lag. Drawing happens separately in loop().
 */
function analyse() {
  if (!isRunning()) return;
  const now = songTime();
  const held = run.phase === 'held';
  // Paused: the last round's late notes are still being collected for a moment, then listening stops.
  if (held && now > holdAnalysisUntil) return;
  if (run.phase === 'done') return;
  const targets = run.targets();
  captureMicSamples();
  const target = activeAt(targets, now) || nextTargetAfter(targets, now);
  const trill = !!(target && target.trill);
  setTrillMode(trill);
  const { samples, sampleRate } = analysisWindow(trill);
  if (calibration) calibrate(now, samples, sampleRate, trill);
  const pitch = trill
    ? detect(samples, sampleRate, { gate: TRILL_GATE, min: 0.4 })
    : detect(samples, sampleRate, { gate, min: 0.6 });
  const frame = { t: now - inputLatency, m: null, tr: trill };
  if (pitch) {
    lastVoicedAt = performance.now();
    frame.m = hzToMidi(pitch.f);
    frame.c = pitch.c;
    frame.ring = brightness();
    if (!trill) highBandRatios.push(highBandRatio());   // trill mode filters above 1.1 kHz on purpose: not a sign of a narrow mic
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
  frameStore.add(frame);

  // Every 1.5 s, nudge the voice lag toward what the last 8 s of singing suggests.
  if (now - lastLagEstimateAt > 1.5) {
    lastLagEstimateAt = now;
    const estimate = estimateLag(frameStore.since(now - 8), targets);
    if (estimate != null) voiceLag = voiceLag + (estimate - voiceLag) * 0.5;
  }

  // The note the voice is judged against: the one sounding when it was sung (after lag), else the current one.
  const judgedTarget = frame.m != null ? (strictAt(targets, frame.t - voiceLag) || target) : target;
  latest = { target, frame, judgedTarget };
}

/**
 * A5 + A2, during the first cue chord (nobody should be singing): remember how loud the room is and what pitch the
 * detector hears (with a gentler gate than singing uses, since a leaking piano is quiet). When the chord is over,
 * adopt the new pitch gate and, if the piano is reaching the mic, say so right away.
 */
function calibrate(now, samples, sampleRate, trill) {
  if (calibration.collecting(now)) {
    const heard = detect(samples, sampleRate, { gate: 0.002, min: 0.6 });
    // Trill mode's boosted, filtered chain would give a floor that means something else: leave it out.
    calibration.add(now, trill ? null : rms(samples), { m: heard ? hzToMidi(heard.f) : null, c: heard ? heard.c : 0 });
    return;
  }
  const answer = calibration.finish(now);
  if (!answer) return;
  calibration = null;
  gate = answer.gate;
  pianoLeak = answer.pianoLeak;
  if (pianoLeak) $('leakCard').hidden = false;
}

/** One animation frame: update the readouts from the latest analysis and draw the roll. */
function loop() {
  if (!isRunning()) return;
  const { target, frame, judgedTarget } = latest;
  const spelling = spellingOf(currentExercise);
  const view = holdView ?? songTime();
  $('rTarget').textContent = target ? noteName(target.m, spelling) : '–';
  $('rSyl').textContent = singReadout({ now: view, firstChordEnd, syllable: target && target.syl });
  // F3: after 300 ms without a voiced frame "You" and the needle fade to a dash.
  if (readoutsFaded(lastVoicedAt, performance.now())) {
    if (!$('rNote').classList.contains('quiet')) showReadoutsQuiet();
  } else if (frame && frame.m != null) {
    $('rNote').classList.remove('quiet');
    $('needle').classList.remove('quiet');
    $('rNote').textContent = noteName(frame.m, spelling);
    if (judgedTarget) {
      // A1: as sung, no octave folding (an octave away reads +-1200 and the needle sits at the end of the meter).
      const off = cents(frame.m, judgedTarget.m);
      $('rCents').textContent = (off > 0 ? '+' : '') + Math.round(off) + ' cents';
      // The needle spans +-100 cents across the meter.
      $('needle').style.left = `calc(${50 + Math.max(-50, Math.min(50, off / 2))}% - 2px)`;
    }
  }
  updateRoundLine(view);
  updateControls();
  drawRoll();
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
  $('pauseBtn').onclick = pauseOrResume;
  $('repeatBtn').onclick = againRound;
  $('skipBtn').onclick = skipRound;
  $('micRetry').onclick = startSession;
  $('editFix').onclick = () => openEditor(currentExercise);
  $('leakDismiss').onclick = hideLeakCard;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (session.state === 'starting' || isRunning()) endSession('hidden');
    } else if (isRunning()) {
      acquireWakeLock();   // the browser drops the lock when the page is hidden
    }
  });
  $('backBtn').onclick = goHome;
  $('againBtn').onclick = () => openPractice(currentExercise);
  $('nextBtn').onclick = () => {
    if (state.set) state.set.position++;
    openPractice(state.queue.shift());
  };
}
