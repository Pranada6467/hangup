'use strict';
// Browser test of the AG Grid screening console: real server, stub PayPal, stub judge, headless Chromium.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { createApp } = require('../src/server');
const { createStore } = require('../src/store');
const { stubPayPal, stubCheck } = require('./helpers');

function judge() {
  const base = stubCheck();
  return (f, o) => base({ ...f, note: /TotalDefend/.test(f.note || '') ? 'SCAMMY ' + f.note : /TeamViewer/.test(f.note || '') ? 'MAYBE ' + f.note : f.note }, o);
}

async function start() {
  const paypal = stubPayPal();
  const store = createStore(null);
  const app = createApp({ config: { paypal: { clientId: 'x', clientSecret: 'y', env: 'sandbox' }, llm: { apiKey: 'k', baseUrl: 'http://x', model: 'm' } }, paypal, store, checkInvoice: judge() });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { base, call, paypal, store, close: () => { server.close(); server.closeAllConnections(); } };
}

// Staged story plus one honest seller that quotes the same callback number (it must never be cancellable).
async function seed(s) {
  const r = await s.call('POST', '/api/demo/seed');
  assert.equal(r.status, 200);
  const honest = await s.call('POST', '/api/gate/invoices', { seller_id: 'honest-co', seller_name: 'Honest Co Plumbing', recipient_email: 'c@example.com', items: [{ name: 'Callout', quantity: 1, unit_amount: '90.00' }], note: 'Questions? Call us on 1-888-555-0142.' });
  assert.equal(honest.body.action, 'ALLOW');
  const ds = (await s.call('GET', '/api/gate/decisions')).body;
  const by = (n) => ds.find((d) => (d.seller_name || '').includes(n));
  return { honest: honest.body, bright: by('Brightline'), a: by('Maple Bay'), b: by('Northgate'), c: by('Pinecrest'), dana: by("Dana's") };
}

async function withPage(fn) {
  const s = await start();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await fn(s, page);
  } finally { await browser.close(); s.close(); }
}
const row = (page, id) => page.locator(`#grid .ag-row[row-id="${id}"]`).first();
const centerRow = (page, id) => page.locator(`#grid .ag-center-cols-container .ag-row[row-id="${id}"]`);
const tick = (page, id) => page.locator(`#grid .ag-pinned-left-cols-container .ag-row[row-id="${id}"] input[type=checkbox]`).first();
const ready = async (page, n) => { await page.waitForSelector('html[data-grid="ag-grid"]'); await page.waitForFunction((k) => document.querySelectorAll('#grid .ag-center-cols-container .ag-row').length >= k, n, { timeout: 15000 }); };

test('grid renders every decision with badges, STAGED labels and campaign membership', { timeout: 60000 }, async () => {
  await withPage(async (s, page) => {
    const d = await seed(s);
    await page.goto(s.base + '/console.html');
    await ready(page, 6);
    const text = await centerRow(page, d.bright.id).innerText();
    assert.match(text, /Brightline IT Supply/); assert.match(text, /HOLD/); assert.match(text, /SUSPICIOUS/); assert.match(text, /STAGED/);
    assert.match(await centerRow(page, d.a.id).innerText(), /SENT_WITHOUT_GATE/);
    assert.match(await centerRow(page, d.a.id).innerText(), /FLAGGED, 4 sellers/);
    assert.match(await centerRow(page, d.c.id).innerText(), /BLOCK/);
    assert.match(await centerRow(page, d.dana.id).innerText(), /ALLOW/);
    // evidence span is highlighted inside the snippet
    assert.ok(await centerRow(page, d.c.id).locator('mark').count() >= 1);
    // verdict colouring of rows
    assert.ok((await row(page, d.c.id).getAttribute('class')).includes('v-LIKELY_CALLBACK_SCAM'));
    assert.ok((await row(page, d.bright.id).getAttribute('class')).includes('v-SUSPICIOUS'));
  });
});

test('Needs review filter shows only HELD rows; bulk release calls the endpoint and re-fetches PayPal', { timeout: 60000 }, async () => {
  await withPage(async (s, page) => {
    const d = await seed(s);
    await page.goto(s.base + '/console.html');
    await ready(page, 6);
    await page.click('[data-filter="review"]');
    await page.waitForFunction(() => document.querySelectorAll('#grid .ag-center-cols-container .ag-row').length === 1);
    assert.match(await page.locator('#grid .ag-center-cols-container .ag-row').first().innerText(), /Brightline/);
    assert.equal(await page.locator('#bulkRelease').isDisabled(), true);
    await tick(page, d.bright.id).check();
    await page.waitForFunction(() => !document.getElementById('bulkRelease').disabled);
    assert.equal(await page.locator('#bulkCancel').isDisabled(), true);
    await page.click('#bulkRelease');
    const listed = await page.locator('#dlgB [data-inv]').allInnerTexts();
    assert.deepEqual(listed, [d.bright.invoice_id]);
    const sendsBefore = s.paypal.calls.filter((c) => c[0] === 'send').length;
    await page.click('#dlgOk');
    await page.waitForSelector('#bulkMsg .banner');
    assert.equal(s.paypal.calls.filter((c) => c[0] === 'send' && c[1] === d.bright.invoice_id).length, 1);
    assert.equal(s.paypal.calls.filter((c) => c[0] === 'send').length, sendsBefore + 1);
    assert.equal(s.store.getDecision(d.bright.id).status, 'RELEASED');
    // the invoice status was re-read from PayPal (a GET after the send) and shown on the row
    const gets = s.paypal.calls.filter((c) => c[0] === 'get' && c[1] === d.bright.invoice_id);
    assert.ok(gets.length >= 1);
    await page.click('[data-filter="all"]');
    await page.waitForFunction((id) => { const el = document.querySelector(`#grid .ag-center-cols-container .ag-row[row-id="${id}"]`); return el && /Released/.test(el.innerText) && /SENT/.test(el.innerText); }, d.bright.id);
  });
});

test('bulk cancel never includes a benign row, and the server refuses it too', { timeout: 60000 }, async () => {
  await withPage(async (s, page) => {
    const d = await seed(s);
    await page.goto(s.base + '/console.html');
    await ready(page, 6);
    // the honest seller shares the number but has no checkbox and says why
    assert.equal(await tick(page, d.honest.id).isDisabled(), true); // AG Grid renders it disabled via isRowSelectable
    assert.match(await centerRow(page, d.honest.id).innerText(), /Benign invoice: HangUp never cancels it/);
    assert.match(await centerRow(page, d.dana.id).innerText(), /Benign invoice/);
    // select all (header checkbox): only actionable rows get ticked
    await page.locator('#grid .ag-header-select-all input[type=checkbox]').first().check();
    await page.waitForFunction(() => /selected/.test(document.getElementById('selInfo').textContent));
    const info = await page.locator('#selInfo').innerText();
    assert.match(info, /mixing held and sent rows/); // Brightline (held) plus the sent campaign rows: no bulk action offered
    assert.equal(await page.locator('#bulkCancel').isDisabled(), true);
    assert.equal(await page.locator('#bulkRelease').isDisabled(), true);
  });
  await withPage(async (s, page) => {
    const d = await seed(s);
    // release Brightline first so that the remaining selectable rows are only campaign members
    await s.call('POST', `/api/gate/decisions/${d.bright.id}/release`);
    await page.goto(s.base + '/console.html');
    await ready(page, 6);
    await page.locator('#grid .ag-header-select-all input[type=checkbox]').first().check();
    await page.waitForFunction(() => !document.getElementById('bulkCancel').disabled);
    await page.click('#bulkCancel');
    const listed = (await page.locator('#dlgB [data-inv]').allInnerTexts()).sort();
    assert.deepEqual(listed, [d.a.invoice_id, d.b.invoice_id].sort());
    assert.ok(!listed.includes(d.honest.invoice_id));
    assert.match(await page.locator('#dlgB').innerText(), /1 benign invoice share this number and will NOT be touched/);
    await page.click('#dlgOk');
    await page.waitForSelector('#bulkMsg .banner');
    const cancelled = s.paypal.calls.filter((c) => c[0] === 'cancel').map((c) => c[1]).sort();
    assert.deepEqual(cancelled, [d.a.invoice_id, d.b.invoice_id].sort());
    assert.equal(s.store.getDecision(d.honest.id).invoice_status, 'SENT');
    await page.waitForFunction((id) => /CANCELLED/.test(document.querySelector(`#grid .ag-center-cols-container .ag-row[row-id="${id}"]`).innerText), d.a.id);
    // server side: even a hand-made request that names the benign row cannot cancel it
    const r = await s.call('POST', `/api/gate/campaigns/8885550142/cancel`, { decision_ids: [d.honest.id, d.dana.id] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results, []);
    assert.deepEqual(r.body.refused.map((x) => x.decision_id).sort(), [d.honest.id, d.dana.id].sort());
    assert.equal(s.paypal.calls.filter((c) => c[0] === 'cancel').length, 2);
  });
});

test('row drawer, campaign grid with pinned totals, CSV export, live flash', { timeout: 60000 }, async () => {
  await withPage(async (s, page) => {
    const d = await seed(s);
    await page.goto(s.base + '/console.html');
    await ready(page, 6);
    // drawer
    await centerRow(page, d.c.id).locator('.ag-cell[col-id="seller"]').click();
    await page.waitForSelector('#drawer:not(.hidden) mark');
    const drawer = await page.locator('#drawer').innerText();
    assert.match(drawer, /TotalDefend/); assert.match(drawer, /Why HangUp says this/); assert.match(drawer, /Action history/); assert.match(drawer, /Form the AI filled/);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#drawer.hidden', { state: 'attached' });
    // quick filter + CSV of the filtered view
    await page.fill('#quick', 'Brightline');
    await page.waitForFunction(() => document.querySelectorAll('#grid .ag-center-cols-container .ag-row').length === 1);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(csv, /Seller/); assert.match(csv, /Brightline/); assert.doesNotMatch(csv, /Pinecrest/);
    assert.equal(csv.trim().split('\n').length, 2);
    await page.click('#clearFilters');
    // campaigns tab: one flagged number, pinned totals row
    await page.click('#tabCamp');
    await page.waitForSelector('#cgrid .ag-row[row-id="8885550142"]');
    assert.match(await page.locator('#cgrid .ag-row[row-id="8885550142"]').first().innerText(), /FLAGGED CAMPAIGN/);
    const camp = page.locator('#cgrid .ag-center-cols-container .ag-row[row-id="8885550142"]');
    assert.equal((await camp.locator('.ag-cell[col-id=benign]').innerText()).trim(), '1'); // Honest Co shares the number
    assert.equal((await camp.locator('.ag-cell[col-id=cancellable]').innerText()).trim(), '2');
    const pinned = await page.locator('#cgrid .ag-floating-top').innerText();
    assert.match(pinned, /TOTAL/); assert.match(pinned, /1 flagged/); assert.doesNotMatch(pinned, /NaN/);
    await page.click('#tabDec');
    // live update flash: change a row on the server, the grid updates in place and the cell flashes
    await s.call('POST', `/api/gate/decisions/${d.bright.id}/release`);
    await page.waitForSelector('#grid .ag-cell-data-changed, #grid .ag-cell-data-changed-animation', { timeout: 12000 });
  });
});

test('falls back to a plain table when AG Grid cannot load', { timeout: 60000 }, async () => {
  await withPage(async (s, page) => {
    await seed(s);
    await page.route(/vendor\/ag-grid|cdn\.jsdelivr\.net/, (r) => r.abort());
    await page.goto(s.base + '/console.html');
    await page.waitForSelector('html[data-grid="fallback"]', { timeout: 15000 });
    await page.waitForSelector('#fallback table tbody tr');
    assert.ok((await page.locator('#fallback tbody tr').count()) >= 6);
    await page.locator('#fallback tbody tr', { hasText: 'Brightline' }).click();
    await page.waitForSelector('#drawer:not(.hidden)');
    assert.match(await page.locator('#drawer').innerText(), /Brightline/);
  });
});

test('story: empty state, progress while a step runs, auto-retry after a 502 with no duplicate invoices, A and B read CANCELLED right after step 3', { timeout: 90000 }, async () => {
  await withPage(async (s, page) => {
    await page.goto(s.base + '/console.html');
    await page.waitForSelector('html[data-grid="ag-grid"]');
    await page.waitForSelector('#empty:not(.hidden)');
    assert.match(await page.locator('#empty').innerText(), /Press Reset demo, then step 1/);
    const box = await page.locator('#empty').boundingBox(); assert.ok(box && box.y + box.height < 780, 'the empty state sits over the grid, inside the first screen (it was below the fold)');

    // Simulate the hosted proxy: the first POST /api/demo/ungated reaches the server and succeeds, but the browser gets a 502.
    let hits = 0, slow = true;
    await page.route('**/api/demo/ungated', async (route) => {
      hits += 1;
      const real = await route.fetch();
      if (hits === 1) { await new Promise((r) => setTimeout(r, 1500)); return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' }); }
      return route.fulfill({ response: real });
    });
    await page.evaluate(() => { window.__t = window.setTimeout; window.setTimeout = (f, ms, ...a) => window.__t(f, ms > 1000 ? 50 : ms, ...a); }); // shrink backoff for the test
    await page.click('#stp1');
    await page.waitForSelector('[data-testid=story-progress]');
    const prog = await page.locator('[data-testid=story-progress]').innerText();
    assert.match(prog, /Creating and sending 2 sandbox invoices in PayPal/); assert.match(prog, /elapsed/);
    assert.match(await page.locator('#stp1').innerText(), /Working/);
    await page.waitForFunction(() => document.querySelector('#stp2') && !document.querySelector('#stp2').disabled, null, { timeout: 20000 });
    assert.equal(hits, 2, 'one automatic retry');
    assert.equal(s.paypal.calls.filter((c) => c[0] === 'create').length, 2, 'the retry replayed the staged invoices, it did not create new ones');
    assert.equal(await page.locator('[data-testid=story-error]').count(), 0);

    await page.click('#stp2');
    await page.waitForFunction(() => document.querySelector('#stp3') && !document.querySelector('#stp3').disabled, null, { timeout: 30000 });
    await page.click('#stp3');
    await page.locator('#dlgOk').click({ timeout: 1500 }).catch(() => {}); // step 3 has no confirm dialog; harmless if absent
    await page.waitForFunction(() => document.querySelectorAll('#grid .st-CANCELLED').length >= 2, null, { timeout: 15000 });
    const d = (await s.call('GET', '/api/gate/decisions')).body;
    assert.equal(d.filter((x) => x.invoice_status === 'CANCELLED').length, 2);
    void slow;
  });
});

test('story: when retries are exhausted the step shows an error and a Retry button that works', { timeout: 60000 }, async () => {
  await withPage(async (s, page) => {
    await page.goto(s.base + '/console.html');
    await page.waitForSelector('html[data-grid="ag-grid"]');
    let fail = true, hits = 0;
    await page.route('**/api/demo/ungated', (route) => { hits += 1; return fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"LLM_UNAVAILABLE","message":"busy"}' }) : route.continue(); });
    await page.evaluate(() => { window.__t = window.setTimeout; window.setTimeout = (f, ms, ...a) => window.__t(f, ms > 1000 ? 20 : ms, ...a); });
    await page.click('#stp1');
    await page.waitForSelector('[data-testid=story-error]');
    assert.equal(hits, 3, 'first try plus two retries');
    assert.match(await page.locator('[data-testid=story-error]').innerText(), /Retry step 1/);
    fail = false;
    await page.click('#storyRetry');
    await page.waitForFunction(() => document.querySelector('#stp2') && !document.querySelector('#stp2').disabled, null, { timeout: 20000 });
    assert.equal(s.paypal.calls.filter((c) => c[0] === 'create').length, 2);
  });
});

test('evidence column shows the quote with the phone number or remote-access mention, not the harmless first quote', { timeout: 60000 }, async () => {
  await withPage(async (s, page) => {
    const note = 'On 12 March our technician took remote control of your PC with TeamViewer. Questions about this bill? Call our support desk on (503) 555-0188.';
    s.store.addDecision({ id: 'gate-ev1', created_at: new Date().toISOString(), staged: true, seller_id: 'x', seller_name: 'hangup STAGED Evidence Co', recipient_email: 'a@example.com', input: { items: [{ name: 'Support' }], note, terms: '' },
      verdict: 'SUSPICIOUS', action: 'HOLD', status: 'HELD', reasons: ['PHONE_IN_TEXT', 'REMOTE_ACCESS_OR_REFUND'], evidence: ['Questions about this bill? Call our support desk on +15035550188.', 'took remote control of your PC with TeamViewer'], phones: ['5035550188'], invoice_id: null, review: [] });
    await page.goto(s.base + '/console.html');
    await ready(page, 1);
    const mark = await centerRow(page, 'gate-ev1').locator('[col-id=evidence] mark').innerText();
    assert.match(mark, /remote control/);
    assert.match(await centerRow(page, 'gate-ev1').locator('[col-id=seller]').innerText(), /Evidence Co/);
    assert.doesNotMatch(await centerRow(page, 'gate-ev1').locator('[col-id=seller]').innerText(), /hangup STAGED/);
  });
});
