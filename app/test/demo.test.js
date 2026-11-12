'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/server');
const { createStore } = require('../src/store');
const { stubPayPal, stubCheck } = require('./helpers');

// Stub judge: TotalDefend text is a scam, Brightline (remote support over TeamViewer) is suspicious.
function judge() {
  const base = stubCheck();
  return (f, o) => base({ ...f, note: /TotalDefend/.test(f.note || '') ? 'SCAMMY ' + f.note : /TeamViewer/.test(f.note || '') ? 'MAYBE ' + f.note : f.note }, o);
}

async function start(o = {}) {
  const paypal = o.paypal || stubPayPal(o);
  const store = createStore(null);
  const app = createApp({ config: { paypal: { clientId: 'x', clientSecret: 'y', env: 'sandbox' }, llm: { apiKey: 'k', baseUrl: 'http://x', model: 'm' } }, paypal, store, checkInvoice: judge() });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { call, paypal, store, close: () => { server.close(); server.closeAllConnections(); } };
}

test('ungated: A and B are sent with NO screening, no verdicts, never emailed', async () => {
  const judged = [];
  const base = judge();
  const s = await start({ checkInvoice: async (f, o) => { judged.push(f); return base(f, o); } });
  const r = await s.call('POST', '/api/demo/ungated');
  assert.equal(r.status, 200);
  assert.equal(r.body.decisions.length, 2);
  assert.equal(judged.length, 0, 'judge must not run at send time');
  for (const d of r.body.decisions) {
    assert.equal(d.gate_bypassed, true);
    assert.equal(d.staged, true);
    assert.equal(d.action, 'SENT_WITHOUT_GATE');
    assert.equal(d.verdict, null);
    assert.deepEqual(d.phones, []);
    assert.equal(d.invoice_status, 'SENT');
    assert.ok(d.invoice_id && d.payer_view_url);
  }
  assert.deepEqual((await s.call('GET', '/api/gate/campaigns')).body, []);
  const creates = s.paypal.calls.filter((c) => c[0] === 'create');
  assert.ok(creates.every((c) => /^hangup STAGED /.test(c[1].invoicer.business_name)));
  assert.ok(s.paypal.calls.filter((c) => c[0] === 'send').every((c) => c[2].send_to_recipient === false));
  s.close();
});

test('full story: backfill supplies the verdicts, C blocked, campaign cancel hits A and B only, story re-fetches', async () => {
  const foreign = [{ id: 'FOREIGN-1', name: 'Other Team Widgets' }, { id: 'FOREIGN-2', name: 'Another Co' }];
  const s = await start({ foreign });
  await s.call('POST', '/api/demo/ungated');
  let story = (await s.call('GET', '/api/demo/story')).body.beats;
  assert.equal(story.monday.state, 'done');
  assert.equal(story.tuesday.state, 'pending');

  const bf = await s.call('POST', '/api/gate/backfill', { days: 30 });
  assert.equal(bf.status, 200);
  assert.equal(bf.body.foreign_skipped, 2);
  assert.equal(bf.body.scanned, 2);
  assert.equal(bf.body.flagged, 2);
  assert.ok(bf.body.results.every((x) => x.verdict === 'LIKELY_CALLBACK_SCAM'));

  const g = await s.call('POST', '/api/demo/gated');
  assert.deepEqual(g.body.decisions.map((d) => d.action), ['BLOCK', 'ALLOW', 'HOLD']);
  const [c, dana, bright] = g.body.decisions;
  assert.equal(c.invoice_id, null);
  assert.equal(dana.invoice_status, 'SENT');
  assert.equal(bright.invoice_status, 'DRAFT');

  const camps = (await s.call('GET', '/api/gate/campaigns')).body;
  const flagged = camps.filter((x) => x.flagged);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].seller_count, 3);
  assert.equal(flagged[0].cancellable.length, 2);
  const ab = s.store.decisions().filter((d) => d.gate_bypassed).map((d) => d.invoice_id);
  assert.ok(s.store.decisions().filter((d) => d.gate_bypassed).every((d) => d.source === 'backfill'));
  assert.deepEqual([...flagged[0].cancellable].sort(), [...ab].sort());

  story = (await s.call('GET', '/api/demo/story')).body.beats;
  assert.equal(story.tuesday.state, 'done');
  assert.equal(story.tuesday.backfill.foreign_skipped, 2);
  assert.equal(story.tuesday.found.length, 2);
  assert.equal(story.campaign.state, 'ready');
  assert.equal(story.tuesday.blocked.action, 'BLOCK');

  const cancel = await s.call('POST', `/api/gate/campaigns/${flagged[0].phone}/cancel`);
  assert.deepEqual(cancel.body.results.filter((x) => x.status === 'CANCELLED').map((x) => x.invoice_id).sort(), [...ab].sort());
  assert.equal(s.paypal.calls.filter((x) => x[0] === 'cancel').length, 2);
  assert.ok(!s.paypal.calls.some((x) => x[0] === 'get' && /FOREIGN/.test(x[1])));

  story = (await s.call('GET', '/api/demo/story?verify=1')).body.beats;
  assert.equal(story.campaign.state, 'done');
  assert.equal(story.result.state, 'done');
  assert.deepEqual(story.result.invoices.map((i) => i.paypal_live.status), ['CANCELLED', 'CANCELLED']);

  const rel = await s.call('POST', `/api/gate/decisions/${bright.id}/release`);
  assert.equal(rel.body.invoice_status, 'SENT');
  s.close();
});

test('webhook events endpoint lists stored events with verified flag', async () => {
  const s = await start();
  s.store.addWebhookEvent({ id: 'E1', event_type: 'INVOICING.INVOICE.PAID', received_at: 'x', verified: false, verify_error: 'NO_WEBHOOK_ID', resource_id: 'I' });
  const r = await s.call('GET', '/api/webhook-events');
  assert.deepEqual([r.body.length, r.body[0].verified], [1, false]);
  s.close();
});

test('reset clears staged decisions and deletes only our DRAFT invoices; seed = ungated + gated', async () => {
  const s = await start();
  const seed = await s.call('POST', '/api/demo/seed');
  assert.deepEqual(seed.body.decisions.map((d) => d.action), ['SENT_WITHOUT_GATE', 'SENT_WITHOUT_GATE', 'BLOCK', 'ALLOW', 'HOLD']);
  assert.equal(seed.body.backfill.scanned, 2);
  s.store.addDecision({ id: 'real_1', staged: false, seller_id: 'real', phones: [], invoice_id: 'REAL-1', invoice_status: 'DRAFT' });
  const draftId = seed.body.decisions[4].invoice_id;
  const r = await s.call('POST', '/api/demo/reset');
  assert.equal(r.body.cleared, 5);
  assert.deepEqual(r.body.deleted_drafts, [draftId]);
  assert.deepEqual(s.paypal.calls.filter((c) => c[0] === 'delete').map((c) => c[1]), [draftId]);
  assert.deepEqual(s.store.decisions().map((d) => d.id), ['real_1']);
  s.close();
});

// ---- retry safety: a retried step (after a 502 from the proxy) must never create a second invoice
test('retry safety: repeating ungated/gated/backfill/cancel replays the stored decisions, no duplicate invoices', async () => {
  const s = await start({});
  const creates = () => s.paypal.calls.filter((c) => c[0] === 'create').length;
  const first = await s.call('POST', '/api/demo/ungated');
  const again = await s.call('POST', '/api/demo/ungated');
  assert.equal(creates(), 2);
  assert.equal(again.body.replayed, 2);
  assert.deepEqual(again.body.decisions.map((d) => d.invoice_id), first.body.decisions.map((d) => d.invoice_id));
  await s.call('POST', '/api/gate/backfill', { days: 30, demo: true });
  await s.call('POST', '/api/gate/backfill', { days: 30, demo: true });
  const g1 = await s.call('POST', '/api/demo/gated');
  const g2 = await s.call('POST', '/api/demo/gated');
  assert.equal(creates(), 4, 'A, B, Dana, Brightline: C is blocked and never created');
  assert.deepEqual(g2.body.decisions.map((d) => d.id), g1.body.decisions.map((d) => d.id));
  assert.equal(s.store.decisions().filter((d) => d.staged).length, 5, 'one decision per staged seller');
  const phone = (await s.call('GET', '/api/gate/campaigns')).body.find((c) => c.flagged).phone;
  await s.call('POST', `/api/gate/campaigns/${phone}/cancel`);
  const c2 = await s.call('POST', `/api/gate/campaigns/${phone}/cancel`);
  assert.equal(s.paypal.calls.filter((c) => c[0] === 'cancel').length, 2, 'second cancel finds nothing cancellable');
  assert.ok(c2.body.results.every((x) => x.status === 'SKIPPED' || x.ok === undefined));
  s.close();
});

test('retry safety: concurrent duplicate requests (first still in flight) share one run', async () => {
  const s = await start({});
  const [a, b] = await Promise.all([s.call('POST', '/api/demo/ungated'), s.call('POST', '/api/demo/ungated')]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(s.paypal.calls.filter((c) => c[0] === 'create').length, 2);
  assert.deepEqual(a.body.decisions.map((d) => d.invoice_id), b.body.decisions.map((d) => d.invoice_id));
  s.close();
});

test('retry safety: after Reset the staged sellers can be created again', async () => {
  const s = await start({});
  await s.call('POST', '/api/demo/ungated');
  await s.call('POST', '/api/demo/reset');
  const r = await s.call('POST', '/api/demo/ungated');
  assert.equal(r.body.replayed, 0);
  assert.equal(s.paypal.calls.filter((c) => c[0] === 'create').length, 4);
  s.close();
});
