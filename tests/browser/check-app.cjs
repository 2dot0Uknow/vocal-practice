// Usage: node tests/browser/check-app.cjs [baseUrl] [--shots dir]
// Starts a static server for the repo root (unless a URL is given), tours every screen in headless Chrome
// and exits non-zero if there is any console error, page error or failed request.
const fs = require('node:fs');
const path = require('node:path');
const { runScenario } = require('./scenario.cjs');
const { serve } = require('./serve.cjs');

(async () => {
  const args = process.argv.slice(2);
  const shotsIndex = args.indexOf('--shots');
  const shotsDir = shotsIndex >= 0 ? args.splice(shotsIndex, 2)[1] : null;
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
  let server = null;
  let baseUrl = args[0];
  if (!baseUrl) {
    server = await serve(path.resolve(__dirname, '../..'));
    baseUrl = server.url;
  }
  const shots = shotsDir ? (name, page) => page.screenshot({ path: path.join(shotsDir, name + '.png') }) : undefined;
  const { errors, observations } = await runScenario(baseUrl, { shots });
  if (server) server.stop();
  console.log(JSON.stringify({ visited: observations.visitedScreens, errors }, null, 2));
  process.exit(errors.length ? 1 : 0);
})();
