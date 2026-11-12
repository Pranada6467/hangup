'use strict';
// Tests for extension/gmail.js against a Gmail-LIKE fixture (extension/test/fixtures/gmail-like.html). NOT live Gmail.
// The HangUp server is the real app (createApp) with a stubbed checker: the LLM is not called here, so verdicts below prove
// the extension plumbing (detection, extraction, banner, switching), not the model. The background worker is simulated by a
// Node-side fetch to that server, as background.js does.
const test = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');

const { startServer, open, banners, settle, GMAIL, FIXTURE, DEMO } = require('./helpers');

test('parser: real quoted invoice and money-request emails (800notes), incl. the unfamiliar-seller line', () => {
  const g = (t) => { const ctx = {}; new Function('globalThis', 'chrome', '"use strict";' + GMAIL).call(null, ctx, undefined); return ctx.__hangupGmail.parseEmail(t); };
  const a = g("Hello, x\nPayPal\nHere's your invoice\nExceed in Coding, LLC sent you an invoice for $1,099.99 USD\nDue on receipt.\nInvoice details\nAmount requested\n$1,099.99 USD\nNote from seller\nIf you did not authorize this order, please reach out to PayPal right away to cancel it.\nFor assistance, please call +1(864) 555-0119.\nInvoice number\nTRX-#864efa\nView and Pay Invoice");
  assert.equal(a.kind, 'invoice'); assert.equal(a.invoicer, 'Exceed in Coding, LLC'); assert.equal(a.amount, 1099.99); assert.equal(a.currency, 'USD');
  assert.match(a.note, /555-0119/); assert.doesNotMatch(a.note, /TRX/); assert.equal(a.unfamiliar_seller, null); assert.equal(a.invoice_number, 'TRX-#864efa');
  const b = g("PayPal\nHere's your invoice\nAngela Rettmann sent you an invoice for $799.00 USD\nDue on receipt.\nInvoice details\nAmount requested\n$799.00 USD\nNote from seller\nFraud Alert: Didn't make this order? Call at 1-833-555-0120\nInvoice number\n0002\nView and Pay Invoice");
  assert.equal(b.note, "Fraud Alert: Didn't make this order? Call at 1-833-555-0120"); assert.equal(b.amount, 799);
  const c = g("Rosemary Beede sent you a money request\nPayment request details\nAmount requested\n$299.99 USD\nNote from Rosemary Beede:\nFraud Alert: Didn’t make this order? Call at 1-844-555-0123\nView and Pay Request");
  assert.equal(c.kind, 'money request'); assert.equal(c.invoicer, 'Rosemary Beede'); assert.equal(c.amount, 299.99); assert.match(c.note, /555-0123/);
  const d = g("X sent you an invoice for $5.00 USD\nDue on receipt.\nX\nYou don’t have any payments with this seller in the last year.\nInvoice details\nAmount requested\n$5.00 USD\nNote from seller\nhi");
  assert.equal(d.unfamiliar_seller, true);
  assert.equal(g('You sent $20.00 USD to Corner Bakery\nTransaction ID\n123'), null);
  assert.equal(g('Saturday plans: Sam sent you an invoice for the venue, call me'), null, 'marker without the details section is not enough');
});

test('payload carries seller-written fields only', () => {
  const ctx = {}; new Function('globalThis', 'chrome', '"use strict";' + GMAIL).call(null, ctx, undefined);
  const p = ctx.__hangupGmail.payloadFor({ kind: 'invoice', invoicer: 'S', amount: 1, currency: 'USD', items: [], note: 'n', terms: '', invoice_number: 'T1', unfamiliar_seller: true });
  assert.deepEqual(Object.keys(p).sort(), ['amount', 'currency', 'invoicer', 'items', 'note', 'source', 'terms', 'unfamiliar_seller', 'unfamiliar_source']);
  assert.equal(p.source, 'extension_gmail');
});

test('scam invoice email: banner above the body, closed shadow root, exact payload, one request', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    const { page, sent } = await open(browser, srv, FIXTURE + '#inbox/scam');
    await settle(page);
    const b = await banners(page);
    assert.equal(b.length, 1);
    assert.equal(b[0].mode, 'closed');
    assert.match(b[0].cls, /scam/);
    assert.equal(b[0].head, "Don't call the number in this invoice.");
    assert.match(b[0].text, /not by PayPal/);
    // the banner sits directly above the message body inside the message wrapper
    assert.equal(await page.evaluate(() => { const h = window.__roots.find((r) => r.host.isConnected && r.host.id === 'hangup-gmail-banner').host; return h.nextElementSibling.classList.contains('a3s'); }), true);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { source: 'extension_gmail', invoicer: 'Florida Public Benefit Corporation', amount: 999.99, currency: 'USD', items: [], note: "Fraud Alert: Didn't make this order? Call at 1-844-555-0124", terms: '', unfamiliar_seller: true, unfamiliar_source: 'email_line' });
    const dump = JSON.stringify(sent);
    for (const s of ['service@paypal', 'Hello', 'Invoice from', 'mail.google', 'fixture', 'fx', 'TRX', 'inbox']) assert.ok(!dump.includes(s), 'must not send: ' + s);
    // Why? shows the plain-language reasons and the highlighted note
    const why = await page.evaluate(() => { const r = window.__roots.find((x) => x.host.isConnected && x.host.id === 'hangup-gmail-banner').root; r.querySelector('.whyb').click(); return { hidden: r.querySelector('.why').hasAttribute('hidden'), t: r.querySelector('.why').textContent, mark: (r.querySelector('mark') || {}).textContent }; });
    assert.equal(why.hidden, false); assert.match(why.t, /It contains a phone number/); assert.match(why.t, /It tells you to phone them/); assert.equal(why.mark, '1-844-555-0124');
  } finally { await browser.close(); srv.close(); }
});

test('money request email is recognised', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    const { page, sent } = await open(browser, srv, FIXTURE + '#inbox/request');
    await settle(page);
    const b = await banners(page);
    assert.equal(b.length, 1); assert.equal(b[0].head, "Don't call the number in this money request.");
    assert.equal(sent[0].invoicer, 'Rosemary Beede'); assert.equal(sent[0].unfamiliar_seller, null); assert.equal(sent[0].unfamiliar_source, undefined);
  } finally { await browser.close(); srv.close(); }
});

test('legit plumber invoice (with the unfamiliar-seller line) is not flagged as a scam', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    const { page, sent } = await open(browser, srv, FIXTURE + '#inbox/legit');
    await settle(page);
    const b = await banners(page);
    assert.equal(b.length, 1); assert.match(b[0].cls, /none/); assert.doesNotMatch(b[0].head, /Don't call/); assert.match(b[0].head, /No callback-scam pattern found/);
    assert.equal(sent.length, 1); assert.equal(sent[0].invoicer, "Dana's Plumbing"); assert.equal(sent[0].unfamiliar_seller, true);
    assert.equal(sent[0].items[0].name, 'Water heater flush and valve replacement');
    assert.match(sent[0].items[0].description, /Job at 14 Elm St/);
  } finally { await browser.close(); srv.close(); }
});

test('non-PayPal, look-alike sender, and PayPal non-invoice mail: no network call, no banner', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    for (const id of ['plain', 'lookalike', 'receipt']) {
      const { page, sent } = await open(browser, srv, FIXTURE + '#inbox/' + id);
      await settle(page);
      assert.equal(sent.length, 0, id + ' must not call the server');
      assert.equal((await banners(page)).length, 0, id + ' must not show a banner');
      await page.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test('switching messages updates or removes the banner; coming back does not re-send', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    const { page, sent } = await open(browser, srv, FIXTURE + '#inbox/scam');
    await settle(page);
    assert.match((await banners(page))[0].head, /Don't call/);
    await page.evaluate(() => { location.hash = '#inbox/legit'; }); await settle(page);
    let b = await banners(page); assert.equal(b.length, 1); assert.match(b[0].head, /No callback-scam pattern found/);
    await page.evaluate(() => { location.hash = '#inbox/plain'; }); await settle(page);
    assert.equal((await banners(page)).length, 0, 'banner gone on a non-PayPal message');
    await page.evaluate(() => { location.hash = '#inbox/scam'; }); await settle(page);
    b = await banners(page); assert.equal(b.length, 1); assert.match(b[0].head, /Don't call/);
    await page.evaluate(() => { location.hash = '#inbox'; }); await settle(page);
    assert.equal((await banners(page)).length, 0, 'no banner in the list view');
    assert.equal(sent.length, 2, 'scam once, legit once; the return to scam is served from memory');
  } finally { await browser.close(); srv.close(); }
});

test('the same element re-rendered with another message: old banner replaced', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    const { page, sent } = await open(browser, srv, FIXTURE + '#inbox/scam');
    await settle(page);
    await page.evaluate(() => window.__replaceBody('legit')); await settle(page);
    const b = await banners(page); assert.equal(b.length, 1); assert.match(b[0].head, /No callback-scam pattern found/);
    await page.evaluate(() => window.__replaceBody('plain')); await settle(page);
    assert.equal((await banners(page)).length, 0);
    assert.equal(sent.length, 2);
  } finally { await browser.close(); srv.close(); }
});

test('a conversation with a friend and a PayPal invoice: banner only on the invoice, only it is sent', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    const { page, sent } = await open(browser, srv, FIXTURE + '#inbox/thread');
    await settle(page);
    assert.equal((await banners(page)).length, 1);
    assert.equal(sent.length, 1); assert.equal(sent[0].invoicer, 'Florida Public Benefit Corporation');
    assert.ok(!JSON.stringify(sent).includes('Saturday'));
  } finally { await browser.close(); srv.close(); }
});

test('dismiss removes the banner and it does not come back on rescan', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    const { page } = await open(browser, srv, FIXTURE + '#inbox/scam');
    await settle(page);
    await page.evaluate(() => window.__roots.find((r) => r.host.isConnected && r.host.id === 'hangup-gmail-banner').root.querySelector('.x').click());
    assert.equal((await banners(page)).length, 0);
    await page.evaluate(() => document.body.appendChild(document.createElement('div'))); await settle(page);
    assert.equal((await banners(page)).length, 0);
  } finally { await browser.close(); srv.close(); }
});

test('stricter mode (Options) marks the seller unfamiliar; server down shows an honest could-not-check banner', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    let r = await open(browser, srv, FIXTURE + '#inbox/request', { storage: { treatUnfamiliar: true } });
    await settle(r.page);
    assert.equal(r.sent.at(-1).unfamiliar_seller, true); assert.equal(r.sent.at(-1).unfamiliar_source, 'user_setting');
    r = await open(browser, srv, FIXTURE + '#inbox/scam', { serverDown: true });
    await settle(r.page);
    const b = await banners(r.page); assert.equal(b.length, 1); assert.match(b[0].head, /could not check/); assert.match(b[0].text, /does not mean/);
  } finally { await browser.close(); srv.close(); }
});

test('server: extension_gmail needs no page URL, is labelled, and the email line is reported as the context source', async () => {
  const srv = await startServer();
  try {
    const res = await fetch(srv.base + '/api/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'extension_gmail', invoicer: 'X', note: 'did not authorize, call 1-844-555-0124', unfamiliar_seller: true, unfamiliar_source: 'email_line' }) });
    const j = await res.json();
    assert.equal(res.status, 200); assert.equal(j.provenance.source, 'extension_gmail'); assert.equal(j.context.source, 'email_line'); assert.equal(j.provenance.url, undefined);
  } finally { srv.close(); }
});

test('hosted demo-email page (labelled mock inbox): staged TotalDefend scam gets the banner', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    const { page, sent } = await open(browser, srv, DEMO);
    await page.getByText('Invoice from hangup STAGED Maple Bay Digital', { exact: false }).first().click();
    await settle(page);
    assert.match(await page.locator('body').innerText(), /mock inbox/i);
    assert.match(await page.locator('body').innerText(), /TEST EMAIL \(staged\)/);
    const b = await banners(page); assert.equal(b.length, 1); assert.match(b[0].head, /Don't call/);
    assert.match(sent[0].note, /TotalDefend/); assert.match(sent[0].note, /1-888-555-0142/);
    assert.equal(sent.length, 1);
  } finally { await browser.close(); srv.close(); }
});

test('mock inbox: "Preview without the extension" calls /api/check with the Gmail script payload and renders the same banner (no extension installed)', async () => {
  const srv = await startServer(), browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const sent = [];
    await page.route('**/api/check', (route) => { sent.push(JSON.parse(route.request().postData())); return route.continue(); });
    await page.goto(srv.base + '/demo-email.html');
    const body = await page.locator('body').innerText();
    assert.match(body, /NOT Gmail/); assert.doesNotMatch(await page.title(), /gmail|paypal/i);
    await page.getByText('Invoice from hangup STAGED Maple Bay Digital', { exact: false }).first().click();
    await page.getByRole('button', { name: 'Preview without the extension' }).click();
    await page.waitForFunction(() => { const h = document.getElementById('hangup-preview-banner'); return h && h.shadowRoot && /Don't call/.test(h.shadowRoot.textContent); }, null, { timeout: 15000 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].source, 'extension_gmail');
    assert.match(sent[0].note, /TotalDefend/); assert.match(sent[0].note, /1-888-555-0142/);
    assert.equal(sent[0].unfamiliar_seller, true);
    assert.equal(await page.locator('#hangup-gmail-banner').count(), 0, 'no extension banner: this is the page-drawn preview');
    // the staged genuine email gets the neutral banner, and the bakery email has no preview button at all
    await page.getByText("Invoice from hangup STAGED Dana's Plumbing", { exact: false }).first().click();
    await page.locator('.adn:visible').getByRole('button', { name: 'Preview without the extension' }).click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#hangup-preview-banner')).some((h) => h.getClientRects().length && /No callback-scam pattern/.test(h.shadowRoot.textContent)), null, { timeout: 15000 });
    await page.getByText('Your order is ready', { exact: false }).first().click();
    await page.getByText('Your order is ready for pickup').waitFor();
    assert.equal(await page.locator('.adn:visible [data-preview]').count(), 0);
  } finally { await browser.close(); srv.close(); }
});
