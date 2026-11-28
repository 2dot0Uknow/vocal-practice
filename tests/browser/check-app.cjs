// Usage: node tests/browser/check-app.cjs [baseUrl] [--shots dir]
// Starts a static server for the repo root (unless a URL is given), tours every screen in headless Chrome
// and exits non-zero if there is any console error, page error or failed request.
const fs = require('node:fs');
const path = require('node:path');
const { runScenario } = require('./scenario.cjs');
const { serve } = require('./serve.cjs');
const { runSessionChecks } = require('./session-checks.cjs');
const { runConverterChecks } = require('./converter-checks.cjs');
const { runHistoryChecks } = require('./history-checks.cjs');
const { runFlowChecks } = require('./flow-checks.cjs');
const { runScoringChecks } = require('./scoring-checks.cjs');
const { runPolishChecks } = require('./polish-checks.cjs');
const { runA11yChecks } = require('./a11y-checks.cjs');
const { runPerfChecks } = require('./perf-checks.cjs');
const { runOfflineChecks } = require('./offline-checks.cjs');

(async () => {
  const args = process.argv.slice(2);
  const shotsIndex = args.indexOf('--shots');
  const shotsDir = shotsIndex >= 0 ? args.splice(shotsIndex, 2)[1] : null;
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
  let server = null;
  let baseUrl = args.find((arg) => !arg.startsWith('--'));
  if (!baseUrl) {
    server = await serve(path.resolve(__dirname, '../..'));
    baseUrl = server.url;
  }
  const shots = shotsDir ? (name, page) => page.screenshot({ path: path.join(shotsDir, name + '.png') }) : undefined;
  const { errors, observations } = await runScenario(baseUrl, { shots });
  // PR 2: start / stop / visibility / mic-failure behaviour (skip with --no-session).
  if (!args.includes('--no-session')) {
    const session = await runSessionChecks(baseUrl);
    errors.push(...session.errors);
  }
  // PR 3: converter honesty, flats, editor / convert feedback (skip with --no-converter).
  if (!args.includes('--no-converter')) {
    const converter = await runConverterChecks(baseUrl);
    errors.push(...converter.errors);
  }
  // PR 4: schema migration, history by exercise id, richer entries (skip with --no-history).
  if (!args.includes('--no-history')) {
    const history = await runHistoryChecks(baseUrl);
    errors.push(...history.errors);
  }
  // PR 5: Pause / Again / Skip and the look-ahead scheduler (skip with --no-flow).
  if (!args.includes('--no-flow')) {
    const flow = await runFlowChecks(baseUrl);
    errors.push(...flow.errors);
  }
  // PR 6: octave scoring, piano-leak notice, narrow-band tone rows, ?debug=1 download (skip with --no-scoring).
  if (!args.includes('--no-scoring')) {
    const scoring = await runScoringChecks(baseUrl);
    errors.push(...scoring.errors);
  }
  // PR 7: recorded piano, practice screen layout, readouts, library reorder / undo, set summary, sparkline, first launch (skip with --no-polish).
  if (!args.includes('--no-polish')) {
    const polish = await runPolishChecks(baseUrl, { shotsDir });
    errors.push(...polish.errors);
  }
  // PR 8: accessibility audit on every screen in both themes, plus the visual-polish behaviours (skip with --no-a11y).
  if (!args.includes('--no-a11y')) {
    const a11y = await runA11yChecks(baseUrl, { shotsDir });
    errors.push(...a11y.errors);
  }
  // PR 9: service worker, offline session, update toast, installability, export / import, failed saves (skip with --no-offline).
  if (!args.includes('--no-offline')) {
    const offline = await runOfflineChecks(baseUrl, { shotsDir });
    errors.push(...offline.errors);
  }
  // PR 5: the two-minute 24-round performance run (only with --perf; also runnable alone: node tests/browser/perf-checks.cjs).
  if (args.includes('--perf')) {
    const perf = await runPerfChecks(baseUrl);
    errors.push(...perf.errors);
    console.log(JSON.stringify(perf.numbers, null, 2));
  }
  if (server) server.stop();
  console.log(JSON.stringify({ visited: observations.visitedScreens, errors }, null, 2));
  process.exit(errors.length ? 1 : 0);
})();
