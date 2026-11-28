// Browser checks for PR 8 (V1 to V9): an accessibility audit and the visual-polish behaviours. Real headless Chrome,
// fake mic, a Pixel-like 412 x 915 viewport. No axe-core is available offline, so the audit is a small stand-in written here.
//
// On each screen (library, add with cards, edit, practice idle, practice running, report), in both themes, it asserts:
//   - every input / select / textarea has an accessible name (label, aria-label or aria-labelledby)
//   - every button (and summary, link) has a name
//   - every svg / img / canvas is decorative (aria-hidden) or labelled
//   - no duplicate ids
//   - the screen has a visible heading, and after navigating, focus is on it and document.title is right
//   - colour contrast of visible text against its computed background is at least 4.5:1 (text nodes, form-control text and
//     placeholders; transparent backgrounds are resolved by walking the ancestors and compositing; the morning-glow gradient at the
//     top of the page is checked against its glow end; canvas is skipped)
// Left out of the contrast pass on purpose: disabled controls (WCAG exempts inactive components) and the faded "You" readout, which is
// a deliberate dash while nothing is heard (F3).
// Then the V2 to V9 behaviour checks (cell cues and labels, editor labels, photo input, theme-color, favicon, roll labels and glow,
// no inline styles, fades and count-up with and without reduced motion).
//
//   node tests/browser/a11y-checks.cjs [--shots dir]       (also run by check-app.cjs)
const fs = require('node:fs');
const path = require('node:path');
const { openApp, sleep } = require('./scenario.cjs');
const { serve } = require('./serve.cjs');

const VIEWPORT = { width: 412, height: 915 };

const EX = (id, name, pat, extra = {}) => ({ id, name, pat, vows: ['ah'], rootVow: '', start: 55, end: 55, top: false, both: false, step: 1, bpm: 200, hold: 2, ...extra });
// G3 is the pitch of the fake mic's steady tone, so these have something to score.
const SHAPES = EX('xs', 'Quick shapes', '1-2-3-1');            // G3 lands; A3 and B3 are far off (flat arrows)
const HELD = EX('xh', 'Held G', '1~', { bpm: 90, hold: 4 });    // a long G3: the "held in tune" glow
const QUICKG = EX('xg', 'Quick G', '1~');                       // a short run that lands 100%
const HISTORY = [
  { name: 'Quick shapes', exId: 'xs', pct: 80, ts: Date.now() - 36e5, date: 'Nov 27' },
  { name: 'Held G', exId: 'xh', pct: 64, ts: Date.now() - 864e5, date: 'Nov 26' },
  { name: 'Quick shapes', exId: 'xs', pct: 52, ts: Date.now() - 2 * 864e5, date: 'Nov 25' },
];

const seed = (page, theme, extra = {}) => page.evaluate(([exercises, history, themeName, more]) => {
  localStorage.clear();
  localStorage.setItem('vp_ex', JSON.stringify(exercises));
  localStorage.setItem('vp_hist', JSON.stringify(history));
  localStorage.setItem('vp_onboarded', '1');
  if (themeName) localStorage.setItem('vp_theme', themeName);
  Object.entries(more).forEach(([key, value]) => localStorage.setItem(key, value));
}, [[SHAPES, HELD, QUICKG], HISTORY, theme, extra]);

const reload = async (page) => {
  await page.reload();
  await page.waitForSelector('#list');
};

// ------------------------------------------------------------------------------------------- the in-page audit
/** Runs in the page. Returns {problems: [...], counts: {...}} for what is on screen now. */
function auditInPage() {
  const problems = [];
  const counts = { controls: 0, buttons: 0, graphics: 0, textNodes: 0, contrastMin: Infinity };
  const openedDetails = [...document.querySelectorAll('details:not([open])')];
  openedDetails.forEach((d) => { d.open = true; });

  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const describe = (el) => `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className == 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}${el.dataset && el.dataset.k ? ` data-k=${el.dataset.k}` : ''}>`;

  // Text of a subtree as a screen reader would build a name: skips aria-hidden and hidden parts, uses alt / aria-label for graphics.
  const textOf = (node) => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    if (node.getAttribute('aria-hidden') === 'true' || node.hidden) return '';
    const label = node.getAttribute('aria-label');
    if (label && label.trim()) return label;
    if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
    if (node.tagName === 'SVG' || node.tagName === 'svg') return (node.querySelector('title') || {}).textContent || '';
    if (node.tagName === 'SELECT' || node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') return '';
    return [...node.childNodes].map(textOf).join('');
  };
  const labelledBy = (el) => (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean).map((n) => textOf(n)).join(' ');
  const nameOfControl = (el) => {
    const byRef = labelledBy(el).trim();
    if (byRef) return byRef;
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const labels = [...(el.labels || [])].map((label) => textOf(label)).join(' ').trim();
    if (labels) return labels;
    return (el.getAttribute('title') || '').trim();
  };
  const nameOfButton = (el) => labelledBy(el).trim() || (el.getAttribute('aria-label') || '').trim() || textOf(el).trim() || (el.getAttribute('title') || '').trim();

  // 1. form controls
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    if (el.type === 'hidden') return;
    if (!visible(el)) return;
    counts.controls++;
    if (!nameOfControl(el)) problems.push(`no accessible name: ${describe(el)}`);
    if (el.labels && el.labels.length && el.id) {
      const forLabels = [...el.labels].filter((l) => l.htmlFor === el.id);
      if (!forLabels.length && !el.closest('label')) problems.push(`label is not tied by for/id: ${describe(el)}`);
    }
  });
  // 2. buttons, summaries, links, role=button
  document.querySelectorAll('button, summary, a[href], [role=button]').forEach((el) => {
    if (!visible(el)) return;
    counts.buttons++;
    if (!nameOfButton(el)) problems.push(`button/link without a name: ${describe(el)}`);
  });
  // 3. graphics
  document.querySelectorAll('svg, img, canvas').forEach((el) => {
    if (!visible(el)) return;
    counts.graphics++;
    if (el.closest('[aria-hidden=true]')) return;
    const labelled = (el.getAttribute('aria-label') || '').trim() || labelledBy(el).trim() || (el.querySelector && el.querySelector('title')) || (el.tagName === 'IMG' && el.hasAttribute('alt'));
    if (!labelled) problems.push(`graphic neither hidden nor labelled: ${describe(el)}`);
    if (el.tagName !== 'IMG' && !el.getAttribute('role') && labelled) problems.push(`labelled graphic has no role=img: ${describe(el)}`);
  });
  // 4. duplicate ids
  const seen = new Map();
  document.querySelectorAll('[id]').forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1));
  seen.forEach((count, id) => { if (count > 1) problems.push(`duplicate id: ${id} (x${count})`); });
  // 5. the screen has a heading
  const screen = document.querySelector('section.on');
  const headings = [...document.querySelectorAll('h1, h2, h3')].filter(visible);
  if (!headings.length) problems.push('no visible heading');
  if (screen && !screen.querySelector('h1, h2')) problems.push(`screen ${screen.id} has no h1/h2 of its own`);
  headings.forEach((h) => { if (!h.textContent.trim()) problems.push(`empty heading: ${describe(h)}`); });
  if (!document.title.trim()) problems.push('empty document.title');
  if (!document.documentElement.lang) problems.push('no lang on <html>');
  // list roles: only listitems inside a list
  document.querySelectorAll('[role=list]').forEach((list) => {
    [...list.children].forEach((child) => { if (child.getAttribute('role') !== 'listitem' && child.getAttribute('aria-hidden') !== 'true') problems.push(`list child is not a listitem: ${describe(child)}`); });
  });

  // 6. colour contrast
  const scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const parse = (value) => {
    scratch.clearRect(0, 0, 1, 1);
    scratch.fillStyle = '#000';
    scratch.fillStyle = value;
    scratch.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = scratch.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const over = (top, bottom) => {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const glowColour = (() => { const probe = document.createElement('span'); probe.style.color = 'var(--glow)'; document.body.appendChild(probe); const c = parse(getComputedStyle(probe).color); probe.remove(); return c; })();

  /** The colour behind an element: its ancestors' backgrounds composited until one is opaque. Also returns whether the page gradient shows through. */
  const backgroundOf = (el) => {
    const layers = [];
    let throughPage = true;
    for (let node = el; node; node = node.parentElement) {
      const colour = parse(getComputedStyle(node).backgroundColor);
      if (colour.a > 0) {
        layers.push(colour);
        if (node !== document.body && node !== document.documentElement) throughPage = false;
        if (colour.a >= 1) break;
      }
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) result = over(layers[i], result);
    return { colour: result, throughPage };
  };
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };

  const check = (el, label, pageY) => {
    const style = getComputedStyle(el);
    const { colour: bg, throughPage } = backgroundOf(el);
    const fgRaw = parse(style.color);
    const fg = { ...fgRaw, a: fgRaw.a * opacityOf(el) };
    const backgrounds = [bg];
    // The page gradient runs from --glow at the top to --bg 320px down: test the glow end too while the element is in that stretch.
    if (throughPage && pageY < 320) backgrounds.push(glowColour);
    backgrounds.forEach((back) => {
      const solid = over(fg, back);
      const value = ratio(solid, back);
      counts.contrastMin = Math.min(counts.contrastMin, value);
      if (value < 4.5) problems.push(`contrast ${value.toFixed(2)}:1 ${label} ${describe(el)} (rgb ${Math.round(solid.r)},${Math.round(solid.g)},${Math.round(solid.b)} on ${Math.round(back.r)},${Math.round(back.g)},${Math.round(back.b)})`);
    });
  };
  const exempt = (el) => el.closest('canvas, script, style, option, textarea, select, :disabled, .quiet, .visually-hidden, [hidden]');

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const checked = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || exempt(el) || !visible(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    counts.textNodes++;
    if (checked.has(el)) continue;
    checked.add(el);
    check(el, `"${node.textContent.trim().slice(0, 28)}"`, rect.top + scrollY);
  }
  // Text inside form controls and placeholders (not text nodes).
  document.querySelectorAll('input:not([type=range]):not([type=checkbox]):not([type=file]), select, textarea').forEach((el) => {
    if (!visible(el) || exempt(el.parentElement || el)) return;
    if (el.disabled || el.classList.contains('visually-hidden')) return;
    if (el.value) check(el, 'value of', el.getBoundingClientRect().top + scrollY);
    if (el.placeholder && !el.value) {
      const placeholderStyle = getComputedStyle(el, '::placeholder');
      const { colour: bg } = backgroundOf(el);
      const fgRaw = parse(placeholderStyle.color);
      const solid = over({ ...fgRaw, a: fgRaw.a * parseFloat(placeholderStyle.opacity || 1) }, bg);
      const value = ratio(solid, bg);
      counts.contrastMin = Math.min(counts.contrastMin, value);
      if (value < 4.5) problems.push(`contrast ${value.toFixed(2)}:1 placeholder of ${describe(el)}`);
    }
  });
  openedDetails.forEach((d) => { d.open = false; });
  counts.contrastMin = Math.round(counts.contrastMin * 100) / 100;
  return { problems, counts };
}

// ------------------------------------------------------------------------------------------------ the runner
async function runA11yChecks(baseUrl, { shotsDir = null } = {}) {
  const problems = [];
  const errors = [];
  const observations = { audits: [] };
  const expect = (condition, message) => { if (!condition) problems.push(message); };
  const guard = async (name, body) => {
    try {
      await body();
    } catch (error) {
      problems.push(`${name}: threw ${error.message}`);
    }
  };
  const shot = async (page, name, fullPage = false) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, name + '.png'), fullPage }); };
  const active = (page) => page.evaluate(() => [...document.querySelectorAll('section.on')].map((s) => s.id).join(','));
  const focusInfo = (page) => page.evaluate(() => ({
    id: document.activeElement && document.activeElement.id,
    visible: !!document.activeElement && document.activeElement.matches(':focus-visible'),
    outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : '',
    title: document.title,
  }));
  const audit = async (page, label) => {
    const result = await page.evaluate(auditInPage);
    observations.audits.push({ label, ...result.counts, problems: result.problems.length });
    result.problems.forEach((p) => problems.push(`[${label}] ${p}`));
  };
  const expectFocus = async (page, label, headingId, title, { keyboard = false } = {}) => {
    await sleep(60);
    const info = await focusInfo(page);
    expect(info.id === headingId, `[${label}] focus should be on #${headingId} (it is on #${info.id})`);
    expect(info.title === title, `[${label}] document.title should be "${title}" (it is "${info.title}")`);
    if (keyboard) expect(info.visible && info.outline !== 'none', `[${label}] a keyboard user should see a focus ring on the heading (visible ${info.visible}, outline ${info.outline})`);
    else expect(!info.visible || info.outline === 'none', `[${label}] a tap should not flash a focus ring on the heading (visible ${info.visible}, outline ${info.outline})`);
  };
  const waitFor = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout });
  const clickPlay = async (page, name) => {
    const index = await page.evaluate((n) => [...document.querySelectorAll('#list .ex b')].findIndex((b) => b.textContent === n), name);
    await page.click(`#list button[data-a=p][data-i="${index}"]`);
  };
  const home = async (page) => {
    await page.evaluate(() => document.querySelector('[data-go=lib]')?.click());
    await page.waitForSelector('section#lib.on');
  };

  // ------------------------------------------------------------------ 0. the audit itself: it must catch known-bad markup
  {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { viewport: VIEWPORT });
    errors.push(...pageErrors);
    await guard('audit self-test', async () => {
      await seed(page, '');
      await reload(page);
      const clean = await page.evaluate(auditInPage);
      expect(clean.problems.length === 0, `audit self-test: the library should start clean (${clean.problems.join('; ')})`);
      await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'lib';   // a duplicate id
        host.innerHTML = '<input id="bad1"><button id="bad2"></button><svg id="bad3" width="10" height="10"><circle r="4"/></svg>' +
          '<p id="bad4" style="color:#bdbdbd;background:#fff">pale text</p><select id="bad5"><option>x</option></select>' +
          '<div id="bad6" style="color:#fff;background:#17a673">white on green</div><div role="list"><span>not an item</span></div>';
        document.querySelector('section.on').appendChild(host);
      });
      const bad = (await page.evaluate(auditInPage)).problems.join('\n');
      for (const [pattern, what] of [[/no accessible name: <input#bad1/, 'an input without a label'], [/without a name: <button#bad2/, 'a nameless button'], [/neither hidden nor labelled: <svg#bad3/, 'an unlabelled svg'],
        [/duplicate id: lib/, 'a duplicate id'], [/contrast 1\.\d+:1.*bad4/, 'pale grey text'], [/no accessible name: <select#bad5/, 'a select without a label'], [/contrast 3\.\d+:1.*bad6/, 'white text on the old green'], [/list child is not a listitem/, 'a bad list child']]) {
        expect(pattern.test(bad), `audit self-test: should flag ${what}`);
      }
    });
    await browser.close();
  }

  // ------------------------------------------------------------------ 1. the audit tour, both themes
  for (const theme of ['light', 'dark']) {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { colorScheme: theme, steadyTone: true, samples: false, viewport: VIEWPORT });
    errors.push(...pageErrors);
    await guard(`tour ${theme}`, async () => {
      await seed(page, theme);
      await reload(page);
      // Library
      await audit(page, `lib ${theme}`);
      await shot(page, `library-${theme}`);
      // Add: tap New, type, Convert (with a guessed line so the guess note shows too)
      await page.click('#newBtn');
      await expectFocus(page, `add ${theme}`, 'addTitle', 'Add exercises · Vocal Practice');
      await audit(page, `add (empty) ${theme}`);
      await page.fill('#notes', '- Sirens up to A4\n1-3-5-3-1 on ah, C3 to G3\n1 2 3 4 5 with lip trill and a note on each root');
      await page.click('#parseBtn');
      await sleep(900);
      await audit(page, `add (cards) ${theme}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `add-editor-${theme}`);
      await shot(page, `add-editor-full-${theme}`, true);
      // An invalid field shows the gentle mark; the audit still has to pass.
      await page.fill('#eds .ed [data-k=start]', 'zzz');
      await page.click('#saveBtn');
      await audit(page, `add (a field marked) ${theme}`);
      await page.fill('#eds .ed [data-k=start]', 'C3');
      await home(page);
      await expectFocus(page, `back to lib ${theme}`, 'libTitle', 'Vocal Practice');
      // Edit one
      await page.click('#list button[data-a=e][data-i="0"]');
      await expectFocus(page, `edit ${theme}`, 'addTitle', 'Edit exercise · Vocal Practice');
      await audit(page, `edit ${theme}`);
      await home(page);
      // Practice: idle, then running
      await clickPlay(page, 'Held G');
      await expectFocus(page, `practice ${theme}`, 'pName', 'Held G · Vocal Practice');
      await audit(page, `practice idle ${theme}`);
      await shot(page, `practice-idle-${theme}`);
      await page.click('#goBtn');
      await waitFor(page, () => document.getElementById('goBtn').textContent === 'Stop');
      await sleep(4200);   // past the cue chord and into the held G
      await audit(page, `practice running ${theme}`);
      await shot(page, `practice-running-${theme}`);
      await page.click('#goBtn');   // Stop
      await sleep(300);
      await home(page);
      // Report
      await clickPlay(page, 'Quick shapes');
      await page.click('#goBtn');
      await waitFor(page, () => document.querySelector('section.on')?.id === 'rep', null, 40000);
      await expectFocus(page, `report ${theme}`, 'repTitle', 'Report · Vocal Practice');
      await sleep(700);
      await audit(page, `report ${theme}`);
      await shot(page, `report-${theme}`);
      await shot(page, `report-full-${theme}`, true);
      // Library again, now with history from the run
      await home(page);
      await audit(page, `lib after a run ${theme}`);
    });
    await browser.close();
  }

  // ------------------------------------------------------------------ 2. keyboard: focus ring on the heading, photo input
  {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { steadyTone: true, viewport: VIEWPORT });
    errors.push(...pageErrors);
    await guard('keyboard', async () => {
      await seed(page, '');
      await reload(page);
      await page.focus('#newBtn');
      await page.keyboard.press('Enter');
      await expectFocus(page, 'add by keyboard', 'addTitle', 'Add exercises · Vocal Practice', { keyboard: true });
      // V3: the photo input is visually hidden but reachable by Tab, and its label shows the focus ring.
      const photo = await page.evaluate(() => {
        const input = document.getElementById('photo');
        const label = input.closest('label');
        const box = input.getBoundingClientRect();
        return { hiddenAttr: input.hidden, cls: input.className, w: box.width, h: box.height, labelFor: label.htmlFor, tabindex: input.tabIndex, display: getComputedStyle(input).display, labelText: label.textContent.trim() };
      });
      expect(!photo.hiddenAttr && photo.display !== 'none', 'V3: the photo input must not use the hidden attribute');
      expect(photo.cls.includes('visually-hidden') && photo.w <= 2 && photo.h <= 2, `V3: the photo input is visually hidden (class ${photo.cls}, ${photo.w}x${photo.h})`);
      expect(photo.labelFor === 'photo' && photo.labelText.includes('Photo or screenshot'), 'V3: the photo label is tied to the input and says what it does');
      let reached = false;
      await page.focus('#notes');
      for (let i = 0; i < 4 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() => document.activeElement.id === 'photo');
      }
      expect(reached, 'V3: Tab reaches the photo input from the text box');
      const ring = await page.evaluate(() => { const label = document.getElementById('photo').closest('label'); const s = getComputedStyle(label); return { style: s.outlineStyle, width: s.outlineWidth }; });
      expect(ring.style !== 'none' && ring.width !== '0px', `V3: the photo label shows a focus ring when the input is focused (${JSON.stringify(ring)})`);
      // The editor's cards: ids unique per card, every label tied by for/id.
      await page.fill('#notes', '1-3-5 on ah, C3 to G3\n1-2-3 on oo, D3 to A3');
      await page.click('#parseBtn');
      const cards = await page.evaluate(() => [...document.querySelectorAll('#eds .ed')].map((card) => {
        const fields = [...card.querySelectorAll('[data-k]')];
        return {
          ids: fields.map((f) => f.id),
          allLabelled: fields.every((f) => f.id && [...f.labels].some((l) => l.htmlFor === f.id && l.textContent.trim())),
          group: card.getAttribute('aria-labelledby') && document.getElementById(card.getAttribute('aria-labelledby'))?.textContent,
        };
      }));
      expect(cards.length === 2 && cards.every((c) => c.allLabelled), `V3: every field in every card has a label tied by for/id (${JSON.stringify(cards.map((c) => c.allLabelled))})`);
      const allIds = cards.flatMap((c) => c.ids);
      expect(new Set(allIds).size === allIds.length && allIds.length === 22, `V3: ids are unique across cards (${allIds.length} ids)`);
      expect(!!(await page.evaluate(() => document.querySelector('label[for=notes]'))), 'V3: the exercises text box has a label');
      // Clicking a label focuses its field.
      await page.click('#eds .ed:nth-child(2) label[for="ed1-pat"]');
      expect(await page.evaluate(() => document.activeElement.id) === 'ed1-pat', 'V3: clicking a label focuses its field (card 2, Pattern)');
    });
    await browser.close();
  }

  // ------------------------------------------------------------------ 3. the report's note cells (V2)
  {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { steadyTone: true, viewport: VIEWPORT });
    errors.push(...pageErrors);
    await guard('cells', async () => {
      await seed(page, '');
      await reload(page);
      await clickPlay(page, 'Quick shapes');
      await page.click('#goBtn');
      await waitFor(page, () => document.querySelector('section.on')?.id === 'rep', null, 40000);
      const cells = await page.evaluate(() => [...document.querySelectorAll('#notesOut .cell')].map((c) => ({
        text: c.innerText.replace(/\s+/g, ' ').trim(), label: c.getAttribute('aria-label'), role: c.getAttribute('role'), cls: c.className, style: c.getAttribute('style'),
        bg: getComputedStyle(c).backgroundColor, fg: getComputedStyle(c).color,
      })));
      const strip = await page.evaluate(() => { const s = document.querySelector('#notesOut .strip'); return s && { role: s.getAttribute('role'), label: s.getAttribute('aria-label'), children: [...s.children].map((c) => c.getAttribute('role')) }; });
      observations.cells = cells.map((c) => `${c.text} | ${c.label}`);
      expect(cells.length >= 4, `V2: expected the 4 notes of the exercise as cells (saw ${cells.length})`);
      expect(strip && strip.role === 'list' && strip.children.every((r) => r === 'listitem'), `V2: the strip is a role=list of role=listitem cells (${JSON.stringify(strip)})`);
      const first = cells[0];
      expect(/^G3 ✓ [+-]?\d+$/.test(first.text) && /^G3, (in tune|\d+ cents? (sharp|flat)), landed$/.test(first.label), `V2: the held G lands with a tick and a label (saw "${first.text}" / "${first.label}")`);
      const off = cells.slice(1, 3);
      expect(off.every((c) => /^[AB]3 [↑↓] [+-]\d+$/.test(c.text) && /^[AB]3, \d+ cents? (sharp|flat), (close|still finding it)$/.test(c.label)), `V2: notes beyond 25 cents show an arrow and a label (saw ${off.map((c) => c.text + ' / ' + c.label).join('; ')})`);
      expect(off.every((c) => c.text.includes(c.label.includes('flat') ? '↓' : '↑')), 'V2: the arrow matches the label (sharp up, flat down)');
      expect(cells.every((c) => c.style === null), 'V6: cells have no inline style');
      expect(cells.every((c) => c.fg === 'rgb(16, 26, 48)'), `V1: cell text is dark ink (saw ${[...new Set(cells.map((c) => c.fg))].join(' / ')})`);
    });
    await browser.close();
  }

  // ------------------------------------------------------------------ 4. V5 roll: left-edge labels, canvas fonts from CSS, glow
  const rollSpy = `
    (() => {
      const rec = window.__roll = { texts: [], fonts: [], blurs: [] };
      const proto = CanvasRenderingContext2D.prototype;
      const realFill = proto.fillText;
      proto.fillText = function (text, ...rest) { if (this.canvas.id === 'cv') { rec.texts.push(String(text)); rec.fonts.push(this.font); } return realFill.call(this, text, ...rest); };
      const blur = Object.getOwnPropertyDescriptor(proto, 'shadowBlur');
      Object.defineProperty(proto, 'shadowBlur', { get() { return blur.get.call(this); }, set(v) { if (this.canvas.id === 'cv' && v > 0) rec.blurs.push(v); blur.set.call(this, v); } });
    })();`;
  for (const reduce of [false, true]) {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { steadyTone: true, viewport: VIEWPORT, initScript: rollSpy, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    errors.push(...pageErrors);
    await guard(`roll ${reduce ? 'reduced motion' : 'motion'}`, async () => {
      await seed(page, '');
      await reload(page);
      await clickPlay(page, 'Quick shapes');
      await sleep(300);
      const idle = await page.evaluate(() => ({ texts: [...window.__roll.texts], fonts: [...window.__roll.fonts] }));
      if (!reduce) {
        // Idle: the first round's notes (G3 A3 B3) are named on the left edge, with the exercise's spelling (G3 is G either way).
        expect(['G3', 'A3', 'B3'].every((n) => idle.texts.includes(n)), `V5: the round's notes are labelled on the roll (drawn: ${[...new Set(idle.texts)].join(' ')})`);
        // Fonts come from --roll-font / --roll-size-note: change them and the next draw follows.
        expect(idle.fonts.some((f) => /12px/.test(f)) && idle.fonts.some((f) => /11px/.test(f)), `V5: sizes come from the CSS custom properties (fonts used: ${[...new Set(idle.fonts)].join(' | ')})`);
        await page.evaluate(() => {
          document.documentElement.style.setProperty('--roll-size-note', '17px');
          document.documentElement.style.setProperty('--roll-font', 'serif');
          window.__roll.fonts.length = 0;
          document.getElementById('themeBtn').click();   // the theme button makes the roll re-read the CSS and redraw
        });
        await sleep(300);
        const changed = await page.evaluate(() => [...new Set(window.__roll.fonts)]);
        expect(changed.some((f) => /17px/.test(f) && /serif/.test(f)), `V5: changing --roll-size-note / --roll-font changes the canvas text (fonts: ${changed.join(' | ')})`);
        await page.evaluate(() => {
          document.documentElement.style.removeProperty('--roll-size-note');
          document.documentElement.style.removeProperty('--roll-font');
          document.getElementById('themeBtn').click();
          document.getElementById('themeBtn').click();   // Light -> Dark -> Auto
        });
      }
      await home(page);
      // The glow: a long held G3 against the fake mic's steady G3.
      await clickPlay(page, 'Held G');
      await page.click('#goBtn');
      await waitFor(page, () => document.getElementById('goBtn').textContent === 'Stop');
      await page.evaluate(() => { window.__roll.blurs.length = 0; });
      await sleep(5500);
      const blurs = await page.evaluate(() => window.__roll.blurs.length);
      observations[reduce ? 'glowReduced' : 'glowMotion'] = blurs;
      if (reduce) expect(blurs === 0, `V5: no glow under reduced motion (saw ${blurs} blurred draws)`);
      else expect(blurs > 5, `V5: a held in-tune note glows (saw ${blurs} blurred draws)`);
      await page.click('#goBtn');
    });
    await browser.close();
  }

  // ------------------------------------------------------------------ 5. V6 inline styles, V7 meta / favicon, V9 motion
  for (const reduce of [false, true]) {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { steadyTone: true, viewport: VIEWPORT, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    errors.push(...pageErrors);
    await guard(`motion ${reduce ? 'reduced' : 'normal'}`, async () => {
      await seed(page, '');
      await reload(page);
      if (!reduce) {
        // V6: no inline style attributes in the markup, nor in what the app generates.
        const source = await page.evaluate(async () => (await (await fetch('index.html')).text()));
        expect(!/\sstyle\s*=/.test(source), 'V6: index.html has no style attributes');
        await page.click('#newBtn');
        await page.fill('#notes', '1-3-5 on ah, C3 to G3');
        await page.click('#parseBtn');
        await home(page);
        const inline = await page.evaluate(() => ['list', 'hist', 'eds', 'journey', 'notesOut', 'setRows'].map((id) => [id, document.querySelectorAll(`#${id} [style]`).length]).filter(([, n]) => n));
        expect(inline.length === 0, `V6: generated HTML has no style attributes (${JSON.stringify(inline)})`);
        const staticStyled = await page.evaluate(() => [...document.querySelectorAll('[style]')].map((el) => el.id || el.tagName));
        observations.styleAttributesOnLibrary = staticStyled;
        // V7: viewport-fit, theme-color metas, favicon
        const head = await page.evaluate(() => ({
          viewport: document.querySelector('meta[name=viewport]').content,
          metas: [...document.querySelectorAll('meta[name=theme-color]')].map((m) => [m.media, m.content]),
          icons: [...document.querySelectorAll('link[rel=icon]')].map((l) => [l.getAttribute('href'), l.type, l.sizes.toString()]),
        }));
        expect(/viewport-fit=cover/.test(head.viewport), 'V7: viewport-fit=cover');
        expect(head.metas.length === 2 && head.metas.some(([m, c]) => /light/.test(m) && c === '#fdfbf7') && head.metas.some(([m, c]) => /dark/.test(m) && c === '#0f1828'), `V7: a theme-color per scheme (${JSON.stringify(head.metas)})`);
        const iconStatus = await page.evaluate(async (icons) => Promise.all(icons.map(async ([href]) => { const r = await fetch(href); return [href, r.status, r.headers.get('content-type')]; })), head.icons);
        expect(iconStatus.length === 2 && iconStatus.every(([, status]) => status === 200), `V7: both favicons load (${JSON.stringify(iconStatus)})`);
        // The theme button: Auto -> Light -> Dark -> Auto. The metas follow the choice, and go back to one per scheme.
        const metaAfter = [];
        for (let i = 0; i < 3; i++) {
          await page.click('#themeBtn');
          metaAfter.push(await page.evaluate(() => [...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.content)));
        }
        expect(JSON.stringify(metaAfter) === JSON.stringify([['#fdfbf7', '#fdfbf7'], ['#0f1828', '#0f1828'], ['#fdfbf7', '#0f1828']]), `V7: theme-color follows the theme button (${JSON.stringify(metaAfter)})`);
        // Back to the library of the earlier navigation: nothing else to do
      }
      // V9: the fade between screens
      const fade = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('section.on')); return { name: s.animationName, duration: s.animationDuration }; });
      if (reduce) expect(fade.name === 'none', `V9: no screen fade under reduced motion (animation ${fade.name})`);
      else expect(fade.name === 'screen-in' && fade.duration === '0.15s', `V9: a 150 ms fade between screens (saw ${JSON.stringify(fade)})`);
      // V9: the percent counts up once, within 600 ms (not at all under reduced motion)
      await seed(page, '');
      await reload(page);
      await clickPlay(page, 'Quick G');
      await page.evaluate(() => {
        window.__counts = [];
        new MutationObserver(() => window.__counts.push([performance.now(), document.getElementById('sPct').textContent])).observe(document.getElementById('sPct'), { childList: true, characterData: true, subtree: true });
      });
      await page.click('#goBtn');
      await waitFor(page, () => document.querySelector('section.on')?.id === 'rep', null, 40000);
      await sleep(900);
      const counts = await page.evaluate(() => ({ seen: window.__counts, final: document.getElementById('sPct').textContent, real: document.getElementById('sPctText').textContent }));
      const values = counts.seen.map(([, text]) => parseInt(text, 10));
      const span = counts.seen.length ? counts.seen[counts.seen.length - 1][0] - counts.seen[0][0] : 0;
      observations[reduce ? 'countUpReduced' : 'countUp'] = { updates: values.length, spanMs: Math.round(span), final: counts.final };
      expect(counts.final === '100%' && counts.real === '100%', `V9: the report ends on 100% (saw ${counts.final} / ${counts.real})`);
      if (reduce) {
        expect(values.length <= 1, `V9: no count-up under reduced motion (${values.length} updates)`);
      } else {
        expect(values.length > 4 && values[0] < 50, `V9: the percent counts up from a low number (${values.slice(0, 6).join(',')}...)`);
        expect(values.every((v, i) => i === 0 || v >= values[i - 1]), `V9: the count only goes up (${values.join(',')})`);
        expect(span <= 650, `V9: the count-up takes at most 600 ms (took ${Math.round(span)} ms)`);
        await page.evaluate(() => { window.__counts.length = 0; });
        await sleep(400);
        expect(await page.evaluate(() => window.__counts.length) === 0, 'V9: it counts up once, then stays');
      }
    });
    await browser.close();
  }

  return { errors: [...errors, ...problems.map((p) => `a11y-check: ${p}`)], observations };
}

module.exports = { runA11yChecks, auditInPage };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const shotsIndex = args.indexOf('--shots');
    const shotsDir = shotsIndex >= 0 ? args[shotsIndex + 1] : null;
    if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
    const server = await serve(path.resolve(__dirname, '../..'));
    const { errors, observations } = await runA11yChecks(server.url, { shotsDir });
    server.stop();
    console.log(JSON.stringify({ observations, errors }, null, 2));
    process.exit(errors.length ? 1 : 0);
  })();
}
