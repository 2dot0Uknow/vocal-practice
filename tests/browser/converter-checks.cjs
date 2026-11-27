// Browser checks for the converter and editor (PR 3: B5-B8) in real headless Chrome.
//   B5  a guessed line shows "From your notes" and a gentle note; nothing extra is saved
//   B6  the confirmed wrong lines convert to the expected patterns and names
//   B7  Eb shows as Eb in the library, editor, practice screen and report
//   B8  Save with a bad card scrolls to and marks it; Convert with an empty box / bad range explains itself;
//       re-Convert over edited cards needs a second tap
const { openApp, sleep } = require('./scenario.cjs');

async function runConverterChecks(baseUrl) {
  const { browser, page, errors } = await openApp(baseUrl);
  const problems = [];
  const expect = (condition, message) => { if (!condition) problems.push(`converter: ${message}`); };
  const active = () => page.evaluate(() => [...document.querySelectorAll('section.on')].map((s) => s.id).join(','));
  const cards = () => page.evaluate(() => [...document.querySelectorAll('#eds .ed')].map((card) => ({
    title: card.querySelector('h3').textContent,
    from: card.querySelector('.from')?.textContent ?? null,
    guess: card.querySelector('[data-guess]')?.textContent ?? null,
    summary: card.querySelector('.sum').textContent,
    fields: Object.fromEntries([...card.querySelectorAll('[data-k]')].map((f) => [f.dataset.k, f.type === 'checkbox' ? f.checked : f.value])),
    invalid: [...card.querySelectorAll('[aria-invalid="true"]')].map((f) => f.dataset.k),
  })));
  const text = (selector) => page.evaluate((sel) => { const node = document.querySelector(sel); return node && !node.hidden ? node.textContent : null; }, selector);
  const convert = async (lines) => {
    await page.fill('#notes', lines.join('\n'));
    await page.click('#parseBtn');
  };

  try {
    await page.click('#newBtn');

    // --- B6 + B5: the confirmed wrong parses, and the guess note ---
    await convert([
      '1 2 3 4 5 4 3 2 1 x2 on nay',
      '1-3-5 hold 5 for 4 beats',
      'Bb2 to F4 lip trills 1 3 5 3 1',
      'Sirens up to A4',
      'Lip roll arpeggios, E2 - E flat 5',
    ]);
    const converted = await cards();
    expect(converted.length === 5, `5 cards expected, got ${converted.length}`);
    expect(converted[0].fields.pat === '1-2-3-4-5-4-3-2-1~', `x2 line pattern: ${converted[0].fields.pat}`);
    expect(converted[0].from === 'From your notes: “1 2 3 4 5 4 3 2 1 x2 on nay”', `original line shown: ${converted[0].from}`);
    expect(converted[0].guess === null, 'a line with a pattern shows no guess note');
    expect(converted[1].fields.pat === '1-3-5~' && converted[1].fields.hold === '4', `hold line: ${converted[1].fields.pat} hold ${converted[1].fields.hold}`);
    expect(converted[2].fields.name === '1-3-5-3-1~ on lip trill', `Bb line name: ${converted[2].fields.name}`);
    expect(converted[2].fields.start === 'Bb2' && converted[2].fields.end === 'F4', `Bb line range shows flats: ${converted[2].fields.start} ${converted[2].fields.end}`);
    expect(converted[3].fields.name === 'Sirens', `Sirens name: ${converted[3].fields.name}`);
    expect(converted[3].guess === "I couldn't find a pattern in this line, so I started you with a 5-note scale. Change it below.", `Sirens guess note: ${converted[3].guess}`);
    expect(converted[4].guess === 'I used a standard arpeggio for this. Change the pattern below if your coach meant something else.', `keyword guess note: ${converted[4].guess}`);
    expect(converted[4].fields.end === 'Eb5' && !/D#/.test(converted[4].summary), `Eb5 stays Eb5: ${converted[4].fields.end} / ${converted[4].summary}`);

    // Editing the pattern of a guessed card retires its note.
    await page.fill('#eds .ed:nth-child(4) [data-k=pat]', '1-3-5');
    expect((await cards())[3].guess === null, 'guess note goes once the pattern is edited');

    // --- B8: Save with a bad card scrolls to it and marks the field ---
    await page.fill('#eds .ed:nth-child(5) [data-k=pat]', 'nonsense');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#saveBtn');
    await sleep(900);
    expect(await active() === 'add', 'invalid Save stays on the add screen');
    const afterSave = await cards();
    expect(afterSave[4].invalid.join() === 'pat', `bad field marked: ${afterSave[4].invalid}`);
    expect(afterSave.slice(0, 4).every((card) => card.invalid.length === 0), 'good cards are not marked');
    expect(/Check the pattern/.test(afterSave[4].summary), 'the helpful summary message is kept');
    const where = await page.evaluate(() => {
      const box = document.querySelector('#eds .ed:nth-child(5)').getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: innerHeight };
    });
    expect(where.bottom > 0 && where.top < where.height, `bad card scrolled into view (${JSON.stringify(where)})`);
    expect(/Card 5 needs a look/.test(await text('#saveMsg') || ''), `save message: ${await text('#saveMsg')}`);
    const outline = await page.evaluate(() => getComputedStyle(document.querySelector('#eds .ed:nth-child(5) [data-k=pat]')).outlineStyle);
    expect(outline === 'solid', `bad field has a visible outline (${outline})`);
    await page.fill('#eds .ed:nth-child(5) [data-k=pat]', '1-3-5-3-1');
    expect((await cards())[4].invalid.length === 0, 'mark clears once the field is fixed');

    // --- B8: second Convert over edited cards needs a second tap ---
    await page.click('#parseBtn');
    expect(await text('#parseBtn') === 'Replace your edited cards?', `first tap asks: ${await text('#parseBtn')}`);
    expect((await cards())[3].fields.name === 'Sirens' && (await cards()).length === 5, 'cards untouched after the first tap');
    await page.fill('#eds .ed:nth-child(1) [data-k=name]', 'My edit');
    await page.click('#parseBtn');
    const secondTap = await cards();
    expect(await text('#parseBtn') === 'Convert all', `button back to normal: ${await text('#parseBtn')}`);
    expect(secondTap.length === 5 && secondTap[0].fields.name === '1-2-3-4-5-4… on nay', `second tap replaces the cards: ${secondTap[0]?.fields.name}`);
    // Untouched cards convert again without asking.
    await page.click('#parseBtn');
    expect(await text('#parseBtn') === 'Convert all', 'no confirmation when nothing was edited');

    // --- B8: empty box and bad default range ---
    await page.fill('#notes', '   ');
    await page.click('#parseBtn');
    expect(await text('#parseMsg') === 'Add at least one line first.', `empty box: ${await text('#parseMsg')}`);
    await page.fill('#notes', '1-3-5 on ah');
    expect(await text('#parseMsg') === null, 'message clears when typing');
    await page.evaluate(() => { document.querySelector('#add details').open = false; });
    await page.evaluate(() => { document.getElementById('dStart').value = 'zz'; });
    await page.click('#parseBtn');
    expect(await text('#parseMsg') === 'Use a note like C3 or Eb4 for From.', `bad From: ${await text('#parseMsg')}`);
    expect(await page.evaluate(() => document.getElementById('dStart').getAttribute('aria-invalid')) === 'true', 'bad From field marked');
    expect(await page.evaluate(() => document.querySelector('#add details').open), 'the range section opens to show the bad field');
    await page.fill('#dStart', 'C3');
    await page.fill('#dEnd', '');
    await page.click('#parseBtn');
    expect(await text('#parseMsg') === 'Use a note like C3 or Eb4 for To.', `bad To: ${await text('#parseMsg')}`);
    await page.fill('#dEnd', 'G3');

    // --- B7: Eb in the library, editor, practice screen and report ---
    await convert(['Hum on ah 1 2 3, Eb3 to Eb3, 200 bpm']);
    const eb = (await cards())[0];
    expect(eb.fields.start === 'Eb3' && eb.fields.end === 'Eb3', `editor fields: ${eb.fields.start} ${eb.fields.end}`);
    expect(/First round: Eb3 F3 G3/.test(eb.summary), `editor summary: ${eb.summary}`);
    await page.click('#saveBtn');
    expect(await active() === 'lib', 'valid Save goes to the library');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('vp_ex')));
    const saved = stored[stored.length - 1];
    expect(saved.spell === 'b', `spell saved as b: ${saved.spell}`);
    expect(!('guessed' in saved) && !('original' in saved) && !('guessNote' in saved) && !('guessKind' in saved), 'no review extras in saved data');
    const libraryText = await page.evaluate(() => document.getElementById('list').innerText);
    expect(/Eb3–Eb3/.test(libraryText) && !/D#3/.test(libraryText), `library: ${libraryText}`);
    // An old exercise with no spelling at all shows the automatic spelling (Eb, not D#).
    await page.evaluate(() => {
      localStorage.setItem('vp_ex', JSON.stringify([{ id: 'old1', name: 'Old one', pat: '1-3-5', vows: ['ah'], rootVow: '', start: 51, end: 54, top: false, both: false, step: 1, bpm: 200, hold: 2 }]));
    });
    await page.reload();
    await page.waitForSelector('#list .ex');
    const oldText = await page.evaluate(() => document.getElementById('list').innerText);
    expect(/Eb3–F#3/.test(oldText), `old data uses auto spelling: ${oldText}`);
    await page.click('#list button[data-a=e][data-i="0"]');
    const oldCard = (await cards())[0];
    expect(oldCard.fields.start === 'Eb3' && oldCard.fields.end === 'F#3', `old exercise in editor: ${oldCard.fields.start} ${oldCard.fields.end}`);
    await page.click('#saveBtn');
    const resaved = await page.evaluate(() => JSON.parse(localStorage.getItem('vp_ex'))[0]);
    expect(!('spell' in resaved), 'saving an untouched old exercise does not invent a spelling');
    // Typing a sharp in the editor sets spell '#', and the fields follow it next time.
    await page.click('#list button[data-a=e][data-i="0"]');
    await page.fill('#eds .ed [data-k=start]', 'D#3');
    await page.click('#saveBtn');
    const sharpText = await page.evaluate(() => document.getElementById('list').innerText);
    expect(/D#3–F#3/.test(sharpText), `typed sharp is remembered: ${sharpText}`);
    await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('vp_ex'));
      list[0].spell = 'b';
      localStorage.setItem('vp_ex', JSON.stringify(list));
    });
    await page.reload();
    await page.waitForSelector('#list .ex');
    await page.click('#list button[data-a=p][data-i="0"]');
    await page.click('#goBtn');
    await page.waitForFunction(() => /^[A-G]/.test(document.getElementById('rTarget').textContent), null, { timeout: 8000 });
    const target = await text('#rTarget');
    expect(target === 'Eb3', `practice target readout: ${target}`);
    await page.waitForSelector('section#rep.on', { timeout: 20000 });
    const cells = await page.evaluate(() => [...document.querySelectorAll('#notesOut .cell b')].map((b) => b.textContent));
    expect(cells.length > 0 && cells.every((name) => !name.includes('#')), `report cells: ${cells}`);
    expect(cells.includes('Eb3'), `report cells use the spelling: ${cells}`);
  } catch (error) {
    problems.push(`converter checks failed: ${error.stack || error}`);
  } finally {
    await browser.close();
  }
  return { errors: [...errors, ...problems] };
}

module.exports = { runConverterChecks };
