// The rules of a practice session, as pure functions (no DOM, no audio, no storage):
// the session state machine, what happens when a session ends, and how a microphone failure is explained.

import { noteFinishedBy } from './scoring.js';

// idle -> starting (asking for the mic) -> running -> stopping -> idle. A start that is cancelled
// before it got going goes straight from starting back to idle.
const NEXT_STATES = {
  idle: ['starting'],
  starting: ['running', 'idle'],
  running: ['stopping'],
  stopping: ['idle'],
};

export function createSessionMachine() {
  let current = 'idle';
  return {
    get state() {
      return current;
    },
    can: (next) => NEXT_STATES[current].includes(next),
    go(next) {
      if (!NEXT_STATES[current].includes(next)) throw new Error(`session cannot go from ${current} to ${next}`);
      current = next;
    },
  };
}

/**
 * How many rounds, counting from round 1, are completely finished (every note of every sound pass can be
 * scored fairly, see noteFinishedBy) by song time `songTime`. Rounds count only while unbroken.
 */
export function completedRounds(targets, songTime, voiceLag = 0) {
  const finished = new Map();
  targets.forEach((target) => finished.set(target.round, (finished.get(target.round) ?? true) && noteFinishedBy(target, songTime, voiceLag)));
  let rounds = 0;
  while (finished.get(rounds)) rounds++;
  return rounds;
}

/**
 * Decide what ending a session means.
 *  - reason: 'finished' (ran to the end), 'stopped' (Stop button) or 'hidden' (phone locked / app switched)
 *  - songTime: the song clock when it ended; targets: every target of the session
 *  - voiceLag: the current voice lag (seconds), because the scoring looks for the voice that much later
 * Returns {showReport, save (to history and the streak), partial, scoredTargets, lastRound}.
 * A stopped run is scored only on notes whose scoring window had fully passed (so nothing is marked missed just because Stop came first), and is never saved.
 * Under one full round there is nothing fair to report, so no report is shown.
 */
export function decideEnd({ reason, songTime, targets, voiceLag = 0 }) {
  if (reason === 'finished') {
    const lastRound = targets.reduce((most, target) => Math.max(most, target.round + 1), 0);
    return { showReport: true, save: true, partial: false, scoredTargets: targets, lastRound };
  }
  const lastRound = songTime == null ? 0 : completedRounds(targets, songTime, voiceLag);
  if (lastRound < 1) return { showReport: false, save: false, partial: true, scoredTargets: [], lastRound: 0 };
  return {
    showReport: true,
    save: false,
    partial: true,
    scoredTargets: targets.filter((target) => noteFinishedBy(target, songTime, voiceLag)),
    lastRound,
  };
}

/** The report's heading: the exercise name, plus how far a stopped run got. */
export const reportTitle = (name, decision) => (decision.partial ? `${name} · Stopped after round ${decision.lastRound}` : name);

/** Why the microphone could not be opened: 'denied', 'notfound', 'insecure' or 'other'. */
export function classifyMicError(error) {
  const name = error && error.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'notfound';
  return 'other';
}

export const MIC_MESSAGES = {
  denied: 'Microphone access is off for this site. Tap the lock icon by the address, allow the microphone, then try again.',
  notfound: "I couldn't find a microphone. Plug in your headphones' mic or check your phone's settings, then try again.",
  insecure: 'Mic unavailable. Allow access, and open from the https:// address.',
  other: "I couldn't start the microphone. Check that no other app is using it, then try again.",
};
