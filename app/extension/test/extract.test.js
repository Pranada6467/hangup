const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const fixture = 'file://' + path.resolve(__dirname, '../../public/fixtures/payer-view-sample.html');
const contentJs = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');

test('content script extracts fields from the fixture', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(fixture);
    await page.addScriptTag({ content: contentJs }); // no chrome.runtime here: only the hook is defined
    const r = await page.evaluate(() => globalThis.__hangupExtract(document));
    assert.equal(r.source, 'extension_dom');
    assert.match(r.invoicer, /Norton Secure Renewals/);
    assert.equal(r.amount, 499.99);
    assert.equal(r.currency, 'USD');
    assert.match(r.note, /call our billing team immediately at 1-808-555-0142/);
    assert.ok(!r.raw, 'structured note should be found');
    assert.match(r.terms, /Refund requests/);
    assert.equal(r.items.length, 1);
    assert.match(r.items[0].name, /Annual protection plan/);
    assert.match(r.items[0].description, /Auto-renewed/);
    assert.equal(r.invoice_number, 'FIXTURE-0001');
    assert.equal(r.status, 'DUE');
    assert.doesNotMatch(r.note, /Items/);
  } finally { await browser.close(); }
});

test('falls back to raw visible text when no note label exists', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<body><h1>Some Seller</h1><p>Pay now or call 555-0100 today</p></body>');
    await page.addScriptTag({ content: contentJs });
    const r = await page.evaluate(() => globalThis.__hangupExtract(document));
    assert.equal(r.raw, true);
    assert.match(r.note, /call 555-0100/);
  } finally { await browser.close(); }
});

test('live item-card layout: each item keeps its own description (empty item-details skipped)', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + path.resolve(__dirname, '../../test/fixtures/payerview_fixture_item_card.html'));
    await page.addScriptTag({ content: contentJs });
    const r = await page.evaluate(() => globalThis.__hangupExtract(document));
    assert.deepEqual(r.items.map((i) => [i.name, i.description]), [
      ['Water heater flush and valve replacement', 'Job at 14 Elm St, 12 March'],
      ['Call-out fee', 'Call 1-888-555-0142 to cancel'],
    ]);
  } finally { await browser.close(); }
});

test('content script: unfamiliar_seller is true only when the page itself says so, else null (never false)', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<body><h2>Some Seller</h2><p>Note from seller</p><p>Call 555-0100</p><p>You don’t have any payments with this seller in the last year.</p></body>'); // fixture, not a live page
    await page.addScriptTag({ content: contentJs });
    assert.equal((await page.evaluate(() => globalThis.__hangupExtract(document))).unfamiliar_seller, true);
    await page.setContent('<body><h2>Some Seller</h2><p>Note from seller</p><p>Call 555-0100</p></body>');
    await page.addScriptTag({ content: contentJs });
    assert.equal((await page.evaluate(() => globalThis.__hangupExtract(document))).unfamiliar_seller, null);
  } finally { await browser.close(); }
});
