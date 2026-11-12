'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createPayPalClient, buildInvoiceBody } = require('../src/paypal');

function resp(status, body, headers = {}) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: new Map(Object.entries(headers)), text: async () => text };
}
function mk(handler, extra = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts, body: opts.body && (() => { try { return JSON.parse(opts.body); } catch { return opts.body; } })() });
    if (url.endsWith('/v1/oauth2/token')) return resp(200, { access_token: 'tok' + calls.filter((c) => c.url.endsWith('/v1/oauth2/token')).length, expires_in: 32400 });
    return handler(url, opts, calls);
  };
  const client = createPayPalClient({ clientId: 'id', clientSecret: 'sec', apiBase: 'https://api-m.sandbox.paypal.com', fetchImpl, logger: () => {}, ...extra });
  return { client, calls };
}

test('token: basic auth, client_credentials, cached', async () => {
  const { client, calls } = mk(() => resp(200, { invoice_number: '0001' }));
  await client.generateNextInvoiceNumber();
  await client.generateNextInvoiceNumber();
  const tokenCalls = calls.filter((c) => c.url.endsWith('/v1/oauth2/token'));
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].opts.headers.Authorization, 'Basic ' + Buffer.from('id:sec').toString('base64'));
  assert.equal(tokenCalls[0].opts.body, 'grant_type=client_credentials');
  assert.match(tokenCalls[0].opts.headers['Content-Type'], /x-www-form-urlencoded/);
});

test('token refreshes after expiry', async () => {
  let t = 0;
  const { client, calls } = mk(() => resp(200, {}), { now: () => t });
  await client.getToken();
  t = 40000 * 1000;
  await client.getToken();
  assert.equal(calls.filter((c) => c.url.endsWith('/v1/oauth2/token')).length, 2);
});

test('createInvoice request shape and result', async () => {
  const body = buildInvoiceBody({ seller_name: 'Acme', recipient_email: 'a@example.com', currency: 'USD', items: [{ name: 'W', description: 'd', quantity: 2, unit_amount: '5.00' }], note: 'hi', terms: 't' });
  assert.deepEqual(body.detail, { currency_code: 'USD', note: 'hi', terms_and_conditions: 't' });
  assert.deepEqual(body.invoicer, { business_name: 'Acme' });
  assert.deepEqual(body.primary_recipients, [{ billing_info: { email_address: 'a@example.com' } }]);
  assert.deepEqual(body.items[0], { name: 'W', description: 'd', quantity: '2', unit_amount: { currency_code: 'USD', value: '5.00' } });
  const { client, calls } = mk(() => resp(201, { id: 'INV2-1', status: 'DRAFT', links: [{ rel: 'payer-view', href: 'https://www.sandbox.paypal.com/invoice/p/#X' }] }));
  const r = await client.createInvoice(body, { requestId: 'rid-1' });
  const c = calls[1];
  assert.equal(c.url, 'https://api-m.sandbox.paypal.com/v2/invoicing/invoices');
  assert.equal(c.opts.method, 'POST');
  assert.equal(c.opts.headers['PayPal-Request-Id'], 'rid-1');
  assert.equal(c.opts.headers.Prefer, 'return=representation');
  assert.match(c.opts.headers.Authorization, /^Bearer tok/);
  assert.equal(r.id, 'INV2-1');
  assert.equal(r.payer_view_url, 'https://www.sandbox.paypal.com/invoice/p/#X');
});

test('createInvoice without representation: id from href', async () => {
  const { client } = mk(() => resp(201, { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-9', method: 'GET' }));
  assert.equal((await client.createInvoice({})).id, 'INV2-9');
});

test('sendInvoice, getInvoice, cancelInvoice, generate number shapes', async () => {
  const { client, calls } = mk((url, opts) => {
    if (url.endsWith('/send')) return resp(200, { rel: 'payer-view', href: 'https://www.sandbox.paypal.com/invoice/p/#Y', method: 'GET' });
    if (url.endsWith('/cancel')) return resp(204);
    if (url.endsWith('generate-next-invoice-number')) return resp(200, { invoice_number: '0042' });
    return resp(200, { id: 'INV2-1', status: 'SENT', detail: { metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#Z' } } });
  });
  const s = await client.sendInvoice('INV2-1', { send_to_recipient: false, send_to_invoicer: false });
  assert.equal(s.payer_view_url, 'https://www.sandbox.paypal.com/invoice/p/#Y');
  assert.deepEqual(calls[1].body, { send_to_recipient: false, send_to_invoicer: false });
  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-1/send');
  const g = await client.getInvoice('INV2-1');
  assert.equal(calls[2].opts.method, 'GET');
  assert.equal(client.payerViewUrl(g), 'https://www.sandbox.paypal.com/invoice/p/#Z');
  await client.cancelInvoice('INV2-1', { subject: 's', note: 'n', send_to_recipient: false, send_to_invoicer: false });
  assert.equal(calls[3].url.endsWith('/v2/invoicing/invoices/INV2-1/cancel'), true);
  assert.deepEqual(calls[3].body, { subject: 's', note: 'n', send_to_recipient: false, send_to_invoicer: false });
  assert.equal(await client.generateNextInvoiceNumber(), '0042');
});

test('verifyWebhookSignature builds documented body and embeds raw event', async () => {
  const { client, calls } = mk(() => resp(200, { verification_status: 'SUCCESS' }));
  const raw = '{"id":"WH-1","event_type":"INVOICING.INVOICE.PAID","resource":{"x":1.10}}';
  const ok = await client.verifyWebhookSignature({
    headers: { 'PAYPAL-AUTH-ALGO': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'tid', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': '2024-01-01T00:00:00Z' },
    body: Buffer.from(raw), webhookId: 'WHID',
  });
  assert.equal(ok, true);
  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
  assert.ok(calls[1].opts.body.includes('"webhook_event":' + raw), 'raw bytes preserved');
  assert.deepEqual(Object.keys(calls[1].body).sort(), ['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time', 'webhook_event', 'webhook_id']);
  assert.equal(calls[1].body.auth_algo, 'SHA256withRSA');
  assert.equal(calls[1].body.webhook_id, 'WHID');
});

test('verifyWebhookSignature FAILURE -> false', async () => {
  const { client } = mk(() => resp(200, { verification_status: 'FAILURE' }));
  assert.equal(await client.verifyWebhookSignature({ headers: {}, body: '{}', webhookId: 'w' }), false);
});

test('createWebhook / listWebhooks shapes', async () => {
  const { client, calls } = mk((url, opts) => (opts.method === 'POST' ? resp(201, { id: 'WH' }) : resp(200, { webhooks: [{ id: 'WH' }] })));
  await client.createWebhook('https://x.example/webhooks/paypal', ['INVOICING.INVOICE.PAID']);
  assert.deepEqual(calls[1].body, { url: 'https://x.example/webhooks/paypal', event_types: [{ name: 'INVOICING.INVOICE.PAID' }] });
  assert.deepEqual(await client.listWebhooks(), [{ id: 'WH' }]);
});

test('PayPal error mapping with debug_id', async () => {
  const logs = [];
  const { client } = mk(() => resp(422, { name: 'UNPROCESSABLE_ENTITY', message: 'bad', debug_id: 'dbg123', details: [{ issue: 'X' }] }), { logger: (m) => logs.push(m) });
  await assert.rejects(client.getInvoice('x'), (e) => {
    assert.equal(e.code, 'PAYPAL_ERROR');
    assert.deepEqual({ status: e.paypal.status, name: e.paypal.name, debug_id: e.paypal.debug_id, details: e.paypal.details }, { status: 422, name: 'UNPROCESSABLE_ENTITY', debug_id: 'dbg123', details: [{ issue: 'X' }] });
    return true;
  });
  assert.ok(logs.some((l) => l.includes('dbg123')));
});

test('401 triggers one token refresh and retry', async () => {
  let n = 0;
  const { client, calls } = mk(() => (++n === 1 ? resp(401, { name: 'AUTHENTICATION_FAILURE' }) : resp(200, { id: 'ok' })));
  assert.equal((await client.getInvoice('a')).id, 'ok');
  assert.equal(calls.filter((c) => c.url.endsWith('/oauth2/token')).length, 2);
});

test('network failure -> PAYPAL_UNREACHABLE', async () => {
  const client = createPayPalClient({ clientId: 'a', clientSecret: 'b', fetchImpl: async () => { throw new TypeError('fetch failed'); }, logger: () => {} });
  await assert.rejects(client.getInvoice('x'), (e) => e.code === 'PAYPAL_UNREACHABLE');
});

test('missing credentials -> PAYPAL_UNCONFIGURED', async () => {
  const client = createPayPalClient({ fetchImpl: async () => { throw new Error('should not be called'); } });
  await assert.rejects(client.getToken(), (e) => e.code === 'PAYPAL_UNCONFIGURED');
});

test('listInvoices / searchInvoices: query paging, body filter, normalised shape', async () => {
  const { client, calls } = mk(() => resp(200, { total_items: 3, total_pages: 2, items: [{ id: 'I1' }, { id: 'I2' }] }));
  const l = await client.listInvoices({ page: 2, page_size: 500, total_required: true });
  assert.equal(calls[1].opts.method, 'GET');
  assert.ok(calls[1].url.endsWith('/v2/invoicing/invoices?page=2&page_size=100&total_required=true'));
  assert.deepEqual([l.total_items, l.total_pages, l.items.length], [3, 2, 2]);
  const s = await client.searchInvoices({ status: ['SENT'] }, { page: 1, page_size: 10 });
  assert.equal(calls[2].opts.method, 'POST');
  assert.ok(calls[2].url.includes('/v2/invoicing/search-invoices?page=1&page_size=10'));
  assert.deepEqual(calls[2].body, { status: ['SENT'] });
  assert.equal(s.items.length, 2);
});
