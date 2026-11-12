'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/server');
const { createStore } = require('../src/store');
const { inv, stubPayPal, stubCheck } = require('./helpers');

async function start(o = {}) {
  const paypal = o.paypal || stubPayPal(o);
  const store = createStore(null);
  const app = createApp({
    config: { paypal: { clientId: 'x', clientSecret: 'y', env: 'sandbox' }, llm: { apiKey: 'k', baseUrl: 'http://x', model: 'm' } },
    paypal, store, checkInvoice: o.checkInvoice || stubCheck(o), webhookId: o.webhookId === undefined ? 'WH' : o.webhookId,
    renderPayerView: o.renderPayerView || (async () => ({ ok: false, reason: 'RENDER_FAILED', explanation: 'x' })),
    probes: o.probes, rateLimitMax: o.rateLimitMax,
  });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch { /* none */ }
    return { status: r.status, body: j, headers: r.headers };
  };
  return { call, paypal, store, close: () => { server.close(); server.closeAllConnections(); } };
}

test('health reports statuses from probes', async () => {
  const s = await start({ probes: { paypal: async () => { const e = new Error('x'); throw e; }, llm: async () => {} } });
  const r = await s.call('GET', '/api/health');
  assert.deepEqual(r.body, { paypal: 'unreachable', llm: 'ok', model: 'm', env: 'sandbox' });
  s.close();
});

test('/api/check pasted text has provenance message; LLM down -> 503 LLM_UNAVAILABLE', async () => {
  const s = await start();
  const r = await s.call('POST', '/api/check', { note: 'hello', invoicer: 'X' });
  assert.equal(r.status, 200);
  assert.equal(r.body.provenance.source, 'pasted_text');
  assert.equal(r.body.provenance.message, "You pasted this text; HangUp can't confirm PayPal sent it.");
  assert.equal(r.body.result.verdict, 'NO_CALLBACK_PATTERN');
  s.close();
  const s2 = await start({ throwLLM: true });
  const r2 = await s2.call('POST', '/api/check', { note: 'hello' });
  assert.deepEqual([r2.status, r2.body.error], [503, 'LLM_UNAVAILABLE']);
  s2.close();
});

test('/api/check url: lookalike -> 400; unreachable render -> 502 PAYPAL_UNREACHABLE; ok render -> paypal provenance', async () => {
  const s = await start({ renderPayerView: require('../src/payerview').renderPayerView });
  const r = await s.call('POST', '/api/check', { url: 'https://www.paypal.com.evil.com/invoice/p/#x' });
  assert.deepEqual([r.status, r.body.error], [400, 'NOT_PAYPAL_INVOICE_HOST']);
  s.close();
  const s2 = await start();
  const r2 = await s2.call('POST', '/api/check', { url: 'https://www.paypal.com/invoice/p/#x' });
  assert.deepEqual([r2.status, r2.body.error], [502, 'PAYPAL_UNREACHABLE']);
  s2.close();
  const s3 = await start({ renderPayerView: async (u) => ({ ok: true, provenance: { source: 'paypal_payer_view_render', url: u, fetched_at: 't' }, invoicer: 'A', items: [], note: 'SCAMMY note', raw_text: 'r' }) });
  const r3 = await s3.call('POST', '/api/check', { url: 'https://www.paypal.com/invoice/p/#x' });
  assert.equal(r3.body.provenance.source, 'paypal_payer_view_render');
  assert.equal(r3.body.result.verdict, 'LIKELY_CALLBACK_SCAM');
  s3.close();
});

test('/api/check extension_dom validates page_url host', async () => {
  const s = await start();
  const bad = await s.call('POST', '/api/check', { source: 'extension_dom', page_url: 'https://evil.com/invoice/p/#a', note: 'x' });
  assert.equal(bad.status, 400);
  const ok = await s.call('POST', '/api/check', { source: 'extension_dom', page_url: 'https://www.sandbox.paypal.com/invoice/p/#a', note: 'x' });
  assert.equal(ok.body.provenance.source, 'extension_dom');
  s.close();
});

test('CORS: chrome-extension allowed, foreign origin rejected, body limit, rate limit', async () => {
  const s = await start({ rateLimitMax: 2 });
  const e = await s.call('POST', '/api/check', { note: 'x' }, { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' });
  assert.equal(e.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');
  const f = await s.call('POST', '/api/check', { note: 'x' }, { origin: 'https://evil.example' });
  assert.equal(f.status, 403);
  assert.equal(f.headers.get('access-control-allow-origin'), null);
  const big = await s.call('POST', '/api/check', { note: 'x'.repeat(70000) });
  assert.equal(big.status, 413);
  await s.call('POST', '/api/check', { note: 'x' });
  const lim = await s.call('POST', '/api/check', { note: 'x' });
  assert.equal(lim.status, 429);
  s.close();
});

test('gate routes: allow, hold, release, block, campaigns', async () => {
  const s = await start();
  const a = await s.call('POST', '/api/gate/invoices', inv('dana', 'fine'));
  assert.equal(a.body.action, 'ALLOW');
  assert.equal(a.body.paypal.status, 'SENT');
  const h = await s.call('POST', '/api/gate/invoices', inv('s1', 'MAYBE'));
  assert.equal(h.body.action, 'HOLD');
  const rel = await s.call('POST', `/api/gate/decisions/${h.body.id}/release`);
  assert.equal(rel.body.status, 'RELEASED');
  const again = await s.call('POST', `/api/gate/decisions/${h.body.id}/release`);
  assert.equal(again.status, 409);
  const b = await s.call('POST', '/api/gate/invoices', inv('s2', 'SCAMMY 1-888-555-0142'));
  assert.equal(b.body.action, 'BLOCK');
  assert.equal((await s.call('GET', '/api/gate/decisions')).body.length, 3);
  assert.ok(Array.isArray((await s.call('GET', '/api/gate/campaigns')).body));
  assert.equal((await s.call('POST', '/api/gate/decisions/nope/block')).status, 404);
  assert.equal((await s.call('POST', '/api/gate/invoices', { seller_id: 'x' })).status, 400);
  s.close();
});

test('gate: PayPal unreachable -> 502 PAYPAL_UNREACHABLE (never faked)', async () => {
  const paypal = stubPayPal();
  paypal.createInvoice = async () => { const e = new Error('down'); e.code = 'PAYPAL_UNREACHABLE'; throw e; };
  const s = await start({ paypal });
  const r = await s.call('POST', '/api/gate/invoices', inv('d', 'fine'));
  assert.deepEqual([r.status, r.body.error], [502, 'PAYPAL_UNREACHABLE']);
  assert.equal(r.body.decision.status, 'PAYPAL_FAILED');
  const seed = await s.call('POST', '/api/demo/seed');
  assert.deepEqual([seed.status, seed.body.error], [502, 'PAYPAL_UNREACHABLE']);
  s.close();
});

test('demo seed: staged flags; A and B sent ungated, C blocked, all 3 clustered; plumber and IT reseller allowed (stub judge)', async () => {
  // stub judge: scam text in seed mentions "TotalDefend" -> map to SCAMMY via wrapper
  const base = stubCheck();
  const checkInvoice = (f) => base({ ...f, note: /TotalDefend/.test(f.note || '') ? 'SCAMMY ' + f.note : f.note });
  const s = await start({ checkInvoice });
  const r = await s.call('POST', '/api/demo/seed');
  assert.equal(r.status, 200);
  assert.equal(r.body.decisions.length, 5);
  assert.ok(r.body.decisions.every((d) => d.staged === true));
  const acts = r.body.decisions.map((d) => d.action);
  assert.deepEqual(acts, ['SENT_WITHOUT_GATE', 'SENT_WITHOUT_GATE', 'BLOCK', 'ALLOW', 'ALLOW']);
  const camps = (await s.call('GET', '/api/gate/campaigns')).body;
  const flagged = camps.filter((c) => c.flagged);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].seller_count, 3);
  s.close();
});

test('webhook: unverified events stored but change nothing; verified update status', async () => {
  const body = JSON.stringify({ id: 'WH-1', event_type: 'INVOICING.INVOICE.CANCELLED', resource: { invoice: { id: 'INV2-1', status: 'CANCELLED' } } });
  const hdrs = { 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': 'x', 'paypal-cert-url': 'u', 'paypal-auth-algo': 'a' };
  const s = await start({ verify: false });
  const a = await s.call('POST', '/api/gate/invoices', inv('dana', 'fine'));
  assert.equal(a.body.invoice_id, 'INV2-1');
  const r = await s.call('POST', '/webhooks/paypal', body, hdrs);
  assert.equal(r.status, 401);
  assert.equal(s.store.webhookEvents()[0].verified, false);
  assert.equal(s.store.getInvoice('INV2-1').status, 'SENT');
  assert.equal(s.store.getDecision(a.body.id).invoice_status, 'SENT');
  // verify call received the raw body
  const vcall = s.paypal.calls.find((c) => c[0] === 'verify');
  assert.equal(vcall[1].body, body);
  assert.equal(vcall[1].webhookId, 'WH');
  s.close();

  const s2 = await start({ verify: true });
  const a2 = await s2.call('POST', '/api/gate/invoices', inv('dana', 'fine'));
  const r2 = await s2.call('POST', '/webhooks/paypal', body, hdrs);
  assert.equal(r2.status, 200);
  assert.equal(s2.store.webhookEvents()[0].verified, true);
  assert.equal(s2.store.getInvoice('INV2-1').status, 'CANCELLED');
  assert.equal(s2.store.getDecision(a2.body.id).invoice_status, 'CANCELLED');
  s2.close();
});

test('webhook without PAYPAL_WEBHOOK_ID is never verified', async () => {
  const s = await start({ verify: true, webhookId: null });
  const a = await s.call('POST', '/api/gate/invoices', inv('dana', 'fine'));
  const r = await s.call('POST', '/webhooks/paypal', JSON.stringify({ id: 'e', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: a.body.invoice_id } } }));
  assert.equal(r.status, 401);
  assert.equal(s.store.getInvoice(a.body.invoice_id).status, 'SENT');
  s.close();
});


test('/api/check passes unfamiliar_seller through as context (true/false/null) and reports where it came from', async () => {
  const seen = [];
  const s = await start({ checkInvoice: async (f, o) => { seen.push(o && o.ctx && o.ctx.unfamiliar_seller); return stubCheck()(f, o); } });
  const a = await s.call('POST', '/api/check', { note: 'hello', unfamiliar_seller: 'true' });
  assert.deepEqual(a.body.context, { unfamiliar_seller: true, source: 'user_input' });
  const b = await s.call('POST', '/api/check', { note: 'hello', unfamiliar_seller: 'false' });
  assert.deepEqual(b.body.context, { unfamiliar_seller: false, source: 'user_input' });
  const c = await s.call('POST', '/api/check', { note: 'hello', unfamiliar_seller: 'garbage' });
  assert.deepEqual(c.body.context, { unfamiliar_seller: null, source: null });
  const d = await s.call('POST', '/api/check', { note: 'hello' });
  assert.deepEqual(d.body.context, { unfamiliar_seller: null, source: null });
  assert.deepEqual(seen, [true, false, null, null]);
  s.close();
});
