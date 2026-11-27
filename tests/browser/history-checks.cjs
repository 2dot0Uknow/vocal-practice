// Browser checks for PR 4 (B9 history by exercise id, A4 richer entries, P7 schema migration).
// Seeds schema-1 data (no vp_schema, history entries without exId) before the app loads, then checks:
//  - the library's journey numbers are the same as before, vp_schema becomes 2, entries gain exId
//  - a finished run saves an entry with the new fields, and the report's cheer compares with the migrated history
//  - renaming the exercise keeps the comparison working
const path = require('node:path');
const { openApp } = require('./scenario.cjs');

const DAY = 86400000;
const QUICK = { id: 'xq', name: 'Quick rounds', pat: '1-3-5', vows: ['ah'], rootVow: '', start: 48, end: 49, top: false, both: false, step: 1, bpm: 200, hold: 2 };
const OTHER = { id: 'xo', name: 'Other drill', pat: '1-5-1', vows: ['ee'], rootVow: '', start: 50, end: 52, top: false, both: false, step: 1, bpm: 90, hold: 2 };
const now = Date.now();
const HISTORY = [
  { name: 'Quick rounds', pct: 20, ts: now - DAY, date: 'Nov 26', keepMe: 'unknown field' },
  { name: 'Other drill', pct: 90, ts: now - 2 * DAY, date: 'Nov 25' },
  { name: 'Quick rounds', pct: 35, ts: now - 3 * DAY, date: 'Nov 24' },
  { name: 'Deleted exercise', pct: 50, ts: now - 4 * DAY, date: 'Nov 23' },
];

// Seeds once per browser tab so reloads keep what the app saved.
const seed = (extra = {}) => `
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('vp_ex', ${JSON.stringify(JSON.stringify([QUICK, OTHER]))});
    localStorage.setItem('vp_hist', ${JSON.stringify(JSON.stringify(HISTORY))});
    localStorage.setItem('vp_def', '{"start":48,"end":55}');
    localStorage.setItem('vp_theme', '"dark"');
    ${Object.entries(extra).map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n')}
  }`;

/** The cheer the report should show for this pct against these earlier runs (same rules as summarizeSession). */
function expectedCheer(pct, previous) {
  if (!previous.length) return 'First run logged. This is your starting point.';
  const best = Math.max(...previous.map((run) => run.pct));
  const last = previous[0].pct;
  if (pct > best) return `Your best yet on this one (previous best ${best}%)!`;
  if (pct > last) return `Up ${pct - last} from last time. Nice progress.`;
  if (pct == last) return 'Right where you were last time. Consistency builds skill.';
  return 'Every run teaches your voice something. Keep going.';
}

async function runHistoryChecks(baseUrl) {
  const problems = [];
  const expect = (condition, message) => { if (!condition) problems.push(message); };
  const errors = [];

  // Reference: the same data with a "newer than known" schema, so nothing is migrated. Journey text must match.
  const reference = await openApp(baseUrl, { initScript: seed({ vp_schema: '99' }) });
  const journeyBefore = await reference.page.evaluate(() => document.getElementById('journey').innerText);
  const histBefore = await reference.page.evaluate(() => document.getElementById('hist').innerText);
  errors.push(...reference.errors);
  expect(await reference.page.evaluate(() => localStorage.getItem('vp_hist')) === JSON.stringify(HISTORY), 'schema 99: history should be untouched');
  expect(await reference.page.evaluate(() => localStorage.getItem('vp_schema')) === '99', 'schema 99: vp_schema should stay 99');
  await reference.browser.close();

  const { browser, page, errors: pageErrors } = await openApp(baseUrl, { initScript: seed() });
  errors.push(...pageErrors);
  const stored = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  const text = (id) => page.evaluate((i) => document.getElementById(i).innerText, id);
  const warnings = [];
  page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()); });

  try {
    // Migration at startup.
    expect((await page.evaluate(() => localStorage.getItem('vp_schema'))) === '2', 'vp_schema should be 2 after startup');
    const history = await stored('vp_hist');
    expect(history.length === 4, 'no history entry should be lost');
    expect(history.map((entry) => entry.exId).join() === 'xq,xo,xq,', `exIds linked wrongly: ${history.map((entry) => entry.exId)}`);
    expect(history[0].keepMe === 'unknown field', 'unknown field on an entry was dropped');
    expect((await text('journey')) === journeyBefore, 'journey numbers changed by the migration');
    expect((await text('hist')) === histBefore, 'journey list changed by the migration');
    expect(JSON.stringify(await stored('vp_ex')) === JSON.stringify([QUICK, OTHER]), 'exercises were changed');
    expect((await page.evaluate(() => localStorage.getItem('vp_theme'))) === '"dark"', 'vp_theme changed');
    expect(warnings.length === 0, `unexpected warnings: ${warnings.join(' | ')}`);

    // A finished run: a new entry with the A4 fields, and a cheer that compares with the migrated history.
    const runOnce = async () => {
      await page.click('#list button[data-a=p][data-i="0"]');
      await page.click('#goBtn');
      await page.waitForFunction(() => document.querySelector('section.on')?.id === 'rep', null, { timeout: 40000 });
      return page.evaluate(() => document.getElementById('cheer').textContent);
    };
    const cheer1 = await runOnce();
    const afterFirst = await stored('vp_hist');
    const entry = afterFirst[0];
    expect(afterFirst.length === 5, `finished run should add one entry (saw ${afterFirst.length}${cheer1 ? '' : ', no cheer'})`);
    expect(entry.exId === 'xq' && entry.name === 'Quick rounds', 'new entry: name / exId');
    for (const key of ['pct', 'ts', 'date', 'avgCents', 'lean', 'steadiness', 'clarity', 'ring', 'topNote', 'rounds', 'notes']) {
      expect(key in entry, `new entry lacks ${key}`);
    }
    expect(entry.rounds === 2 && entry.notes === 6, `rounds/notes should be 2 and 6, saw ${entry.rounds} / ${entry.notes}`);
    expect(cheer1 === expectedCheer(entry.pct, [HISTORY[0], HISTORY[2]]), `cheer "${cheer1}" does not match the migrated history for pct ${entry.pct}`);
    expect(!cheer1.startsWith('First run'), 'cheer ignored the migrated history');
    expect((await page.evaluate(() => document.getElementById('sSub').textContent)).startsWith(`Average ${entry.avgCents} cents off`), 'report subtitle and saved avgCents differ');

    // Rename the exercise, run again: still compared with its history (now three earlier runs).
    await page.click('#repBack, #backBtn').catch(() => {});
    await page.evaluate(() => document.querySelector('[data-go=lib]')?.click());
    await page.waitForSelector('#list');
    if ((await page.evaluate(() => document.querySelector('section.on')?.id)) !== 'lib') await page.goto(baseUrl);
    await page.waitForSelector('#list button[data-a=e][data-i="0"]');
    await page.click('#list button[data-a=e][data-i="0"]');
    await page.fill('[data-k=name]', 'Renamed rounds');
    await page.click('#saveBtn');
    await page.waitForSelector('#list');
    expect((await page.evaluate(() => document.querySelector('#list b').textContent)) === 'Renamed rounds', 'rename did not stick');
    expect((await stored('vp_ex'))[0].id === 'xq', 'rename changed the id');
    const cheer2 = await runOnce();
    const afterSecond = await stored('vp_hist');
    expect(afterSecond[0].exId === 'xq' && afterSecond[0].name === 'Renamed rounds', 'second entry: name / exId');
    expect(cheer2 === expectedCheer(afterSecond[0].pct, [afterFirst[0], HISTORY[0], HISTORY[2]]), `after rename, cheer "${cheer2}" does not match the exercise's history (pct ${afterSecond[0].pct})`);
    expect(afterSecond.length === 6, 'second run should add one entry');
  } catch (error) {
    problems.push(`threw ${error.message}`);
  }
  await browser.close();
  return { errors: [...errors, ...problems.map((p) => `history check failed: ${p}`)], problems };
}

module.exports = { runHistoryChecks };

if (require.main === module) {
  const { serve } = require('./serve.cjs');
  (async () => {
    const server = await serve(path.resolve(__dirname, '../..'));
    const { errors } = await runHistoryChecks(server.url);
    server.stop();
    console.log(JSON.stringify({ errors }, null, 2));
    process.exit(errors.length ? 1 : 0);
  })();
}
