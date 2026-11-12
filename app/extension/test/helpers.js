'use strict';
// Shared by gmail.test.js and scripts/verify_gmail_fixture.js: a real HangUp app on a random port, and a page with a fake chrome.* runtime.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createApp } = require('../../src/server');
const { createStore } = require('../../src/store');
const { stubPayPal } = require('../../test/helpers');

const EXT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const BANNER = read('banner.js'), GMAIL = read('gmail.js');
const FIXTURE = 'file://' + path.join(EXT, 'test/fixtures/gmail-like.html');
const DEMO = 'file://' + path.resolve(EXT, '../public/demo-email.html');

// Deterministic stand-in for the LLM check: a phone number plus "call" in the note -> scam, quoting the note.
async function fakeCheck(fields) {
  const note = fields.note || '';
  const phone = /\+?1?[-. (]*\d{3}[-. )]*\d{3}[-. ]*\d{4}/.exec(note);
  const callback = /\bcall\b/i.test(note) && /(did not authori[sz]e|didn't make|fraud alert|refund)/i.test(note);
  const verdict = callback && phone ? 'LIKELY_CALLBACK_SCAM' : 'NO_CALLBACK_PATTERN';
  const i = phone ? note.indexOf(phone[0]) : -1;
  return {
    verdict, headline: verdict, advice: verdict === 'NO_CALLBACK_PATTERN' ? [] : ['Do not call the number. Open PayPal yourself.'],
    reasons: verdict === 'NO_CALLBACK_PATTERN' ? [] : ['PHONE_IN_TEXT', 'CALLBACK_DEMANDED'], evidence: verdict === 'NO_CALLBACK_PATTERN' ? [] : [phone[0]],
    evidence_spans: verdict === 'NO_CALLBACK_PATTERN' ? [] : [{ field: 'note', start: i, end: i + phone[0].length }],
    form: { explanation_plain: verdict === 'NO_CALLBACK_PATTERN' ? '' : 'The note asks you to phone a number. PayPal did not write it.' }, features: { phones: phone ? [phone[0]] : [], urls: [] }, model: 'test-stub', latency_ms: 1,
  };
}

// live = true: the app's real checker (real LLM via the configured key). Default: the stub above.
async function startServer(live) {
  const base0 = { paypal: stubPayPal(), store: createStore(null), webhookId: 'WH', renderPayerView: async () => ({ ok: false, reason: 'x', explanation: 'x' }), rateLimitMax: 1000 };
  const app = createApp(live ? base0 : { ...base0, config: { paypal: { clientId: 'x', clientSecret: 'y', env: 'sandbox' }, llm: { apiKey: 'k', baseUrl: 'http://x', model: 'm' } }, checkInvoice: fakeCheck });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => { server.close(); server.closeAllConnections(); } };
}

// Opens a page with a fake chrome.* runtime. Requests the content script makes are recorded in `sent`.
async function open(browser, srv, url, o = {}) {
  const page = await browser.newPage();
  const sent = [];
  await page.exposeFunction('__bg', async (msg) => {
    sent.push(msg.payload);
    if (o.serverDown) return { ok: false, status: 0, data: { error: 'NETWORK', message: 'Could not reach the HangUp server' } };
    const res = await fetch(srv.base + '/api/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg.payload) });
    return { ok: res.ok, status: res.status, data: await res.json() };
  });
  await page.addInitScript((opts) => {
    // Record closed shadow roots so the test can read them (the extension itself keeps them closed).
    window.__roots = [];
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) { const r = orig.call(this, init); window.__roots.push({ host: this, root: r, mode: init.mode }); return r; };
    window.chrome = { runtime: { lastError: null, sendMessage: (m, cb) => { window.__bg(m).then(cb); } }, storage: { sync: { get: (k, cb) => cb(opts.storage || {}) } } };
  }, { storage: o.storage });
  await page.goto(url);
  await page.addScriptTag({ content: BANNER });
  await page.addScriptTag({ content: GMAIL });
  return { page, sent };
}
// Visible banners: [{mode, cls, head, text}]
const banners = (page) => page.evaluate(() => window.__roots.filter((r) => r.host.isConnected && r.host.getClientRects().length && r.host.id === 'hangup-gmail-banner').map((r) => ({ mode: r.mode, cls: r.root.querySelector('.bar').className, head: r.root.querySelector('.h').textContent, text: r.root.querySelector('.bar').textContent })));
const settle = (page) => page.waitForTimeout(900);


module.exports = { startServer, open, banners, settle, fakeCheck, BANNER, GMAIL, FIXTURE, DEMO };
