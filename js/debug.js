// A7: the hidden ?debug=1 switch. It adds a "Download session data" link to the report: one JSON file with everything
// needed to replay the session through summarizeSession() later (as a regression fixture). Pure: no DOM, no storage.

/** The app's version string. There is no build step to stamp a git hash, so it is a constant (P2 may replace it). */
export const APP_VERSION = 'dev';

/** True when the page address asks for debug mode (e.g. "?debug=1"). */
export const isDebugMode = (search) => new URLSearchParams(search || '').get('debug') === '1';

const round = (value, decimals) => (typeof value === 'number' ? Math.round(value * 10 ** decimals) / 10 ** decimals : value);

/**
 * What the downloaded file holds:
 *  exercise, targets (as scored), frames [{t, m, c, ring, tr}] (as recorded, before the voice-lag shift),
 *  voiceLag (the lag the session started the report with), outputLatency, gate (the pitch gate used after calibration),
 *  pianoLeak, narrowBand, micSampleRate, userAgent, appVersion.
 */
export function buildDebugSession({ exercise, targets, frames, voiceLag, outputLatency, gate, pianoLeak, narrowBand, micSampleRate, userAgent, appVersion = APP_VERSION }) {
  return {
    exercise,
    targets,
    frames: frames.map((frame) => {
      const out = { t: round(frame.t, 4), m: round(frame.m, 4), tr: !!frame.tr };
      if (frame.c !== undefined) out.c = round(frame.c, 3);
      if (frame.ring !== undefined) out.ring = round(frame.ring, 4);
      return out;
    }),
    voiceLag,
    outputLatency,
    gate,
    pianoLeak: !!pianoLeak,
    narrowBand: !!narrowBand,
    micSampleRate: micSampleRate ?? null,
    userAgent: userAgent ?? '',
    appVersion,
  };
}

/** The input summarizeSession() needs, from a downloaded (or hand-made) session file. */
export function summaryInputFrom(session) {
  return {
    targets: session.targets,
    frames: session.frames,
    voiceLag: session.voiceLag ?? 0.15,
    previousRuns: [],
    narrowBand: !!session.narrowBand,
    pianoLeak: !!session.pianoLeak,
  };
}
