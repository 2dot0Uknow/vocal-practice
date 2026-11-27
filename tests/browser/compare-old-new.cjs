// Usage: node tests/browser/compare-old-new.cjs [baselineCommit] [--keep dir]
// Runs the same scripted tour against the baseline build (index.html as of that commit, default 2aaf0bd)
// and the working tree, then checks that:
//   - neither build logs a console error / page error / failed request,
//   - every observation (library text, editor summaries, converted cards, localStorage...) is identical,
//   - screenshots of the main screens are pixel-identical.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runScenario } = require('./scenario.cjs');
const { serve } = require('./serve.cjs');

// Observations that depend on the live (fake) microphone are only checked loosely.
const LOOSE = new Set(['reports', 'storageAfterRun', 'storageEnd', 'practiceRunning']);

function diff(a, b, where, out) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[key], b[key], `${where}.${key}`, out);
  } else {
    out.push(`${where}\n    old: ${JSON.stringify(a)?.slice(0, 300)}\n    new: ${JSON.stringify(b)?.slice(0, 300)}`);
  }
}

(async () => {
  const args = process.argv.slice(2);
  const keepIndex = args.indexOf('--keep');
  const keepDir = keepIndex >= 0 ? args.splice(keepIndex, 2)[1] : fs.mkdtempSync(path.join(os.tmpdir(), 'vp-compare-'));
  const baseline = args[0] || '2aaf0bd';
  const repoRoot = path.resolve(__dirname, '../..');

  const oldDir = path.join(keepDir, 'old');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'index.html'), execFileSync('git', ['show', `${baseline}:index.html`], { cwd: repoRoot, maxBuffer: 1 << 26 }));

  const results = {};
  for (const [label, dir] of [['old', oldDir], ['new', repoRoot]]) {
    const server = await serve(dir);
    const shotDir = path.join(keepDir, 'shots-' + label);
    fs.mkdirSync(shotDir, { recursive: true });
    results[label] = await runScenario(server.url, { shots: (name, page) => page.screenshot({ path: path.join(shotDir, name + '.png') }) });
    server.stop();
  }

  let failed = false;
  for (const label of ['old', 'new']) {
    const { errors } = results[label];
    console.log(`${label}: ${errors.length} error(s)${errors.length ? '\n  ' + errors.join('\n  ') : ''}`);
    if (errors.length) failed = true;
  }

  const differences = [];
  const oldObs = results.old.observations;
  const newObs = results.new.observations;
  for (const key of new Set([...Object.keys(oldObs), ...Object.keys(newObs)])) {
    if (LOOSE.has(key)) continue;
    diff(oldObs[key], newObs[key], key, differences);
  }
  // Loose checks: the same keys exist and the saved history has the same shape.
  for (const key of LOOSE) {
    if (JSON.stringify(Object.keys(oldObs[key] || {}).sort()) !== JSON.stringify(Object.keys(newObs[key] || {}).sort())) differences.push(`${key}: different keys`);
  }
  const historyShape = (obs) => JSON.parse(obs.storageEnd.vp_hist || '[]').map((entry) => Object.keys(entry).sort().join());
  if (JSON.stringify(historyShape(oldObs)) !== JSON.stringify(historyShape(newObs))) differences.push('vp_hist entries have a different shape');

  // Screenshots.
  const shotNames = fs.readdirSync(path.join(keepDir, 'shots-old')).filter((f) => f.endsWith('.png'));
  for (const name of shotNames) {
    if (name.startsWith('rep-')) continue; // the report depends on the fake microphone, so it is only compared by structure
    const a = fs.readFileSync(path.join(keepDir, 'shots-old', name));
    const b = fs.readFileSync(path.join(keepDir, 'shots-new', name));
    if (!a.equals(b)) differences.push(`screenshot ${name} differs (see ${keepDir})`);
  }
  console.log(`compared ${Object.keys(oldObs).length} observation groups and ${shotNames.length} screenshots`);
  if (differences.length) {
    failed = true;
    console.log('DIFFERENCES:\n' + differences.join('\n'));
  } else {
    console.log('old and new are identical');
  }
  fs.writeFileSync(path.join(keepDir, 'observations.json'), JSON.stringify({ old: oldObs, new: newObs }, null, 1));
  console.log('details in ' + keepDir);
  process.exit(failed ? 1 : 0);
})();
