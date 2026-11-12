'use strict';
const test = require('node:test');
const assert = require('node:assert');
const gate = require('../src/gate');
const { inv, deps, stubPayPal } = require('./helpers');

const NUM = '1-888-555-0142';

test('ALLOW: creates and sends; send_to_recipient false in sandbox', async () => {
  const d = deps();
  const r = await gate.gateInvoice(inv('dana', 'Thanks! Call Dana (503) 555-0173'), d);
  assert.equal(r.action, 'ALLOW');
  assert.equal(r.status, 'SENT');
  assert.equal(r.invoice_status, 'SENT');
  assert.ok(r.invoice_id && r.payer_view_url);
  const send = d.paypal.calls.find((c) => c[0] === 'send');
  assert.equal(send[2].send_to_recipient, false);
});

test('HOLD: draft only, no send, expires in 72h', async () => {
  const d = deps();
  const r = await gate.gateInvoice(inv('s1', 'MAYBE call us'), d);
  assert.equal(r.action, 'HOLD');
  assert.equal(r.status, 'HELD');
  assert.equal(r.invoice_status, 'DRAFT');
  assert.equal(d.paypal.calls.some((c) => c[0] === 'send'), false);
  const ms = new Date(r.expires_at) - new Date(r.created_at);
  assert.equal(ms, 72 * 3600 * 1000);
});

test('BLOCK: nothing created at PayPal; evidence and phones recorded', async () => {
  const d = deps();
  const r = await gate.gateInvoice(inv('s1', `SCAMMY call ${NUM}`), d);
  assert.equal(r.action, 'BLOCK');
  assert.equal(d.paypal.calls.length, 0);
  assert.deepEqual(r.phones, ['8885550142']);
  assert.ok(r.evidence.length && r.form);
});

test('judge runs on seller name and items too (not only the note)', async () => {
  const d = deps();
  const r = await gate.gateInvoice(inv('SCAMMY Co', 'fine'), d);
  assert.equal(r.action, 'BLOCK');
  const r2 = await gate.gateInvoice({ ...inv('ok', 'fine'), items: [{ name: 'MAYBE item', quantity: 1, unit_amount: '1' }] }, d);
  assert.equal(r2.action, 'HOLD');
});

test('LLM unavailable fails closed: nothing sent, error propagates', async () => {
  const d = deps({ throwLLM: true });
  await assert.rejects(gate.gateInvoice(inv('x', 'hi'), d), (e) => e.code === 'LLM_UNAVAILABLE');
  assert.equal(d.paypal.calls.length, 0);
  assert.equal(d.store.decisions().length, 0);
});

test('PayPal unreachable on ALLOW: decision recorded as PAYPAL_FAILED, error carries decision', async () => {
  const d = deps();
  d.paypal.createInvoice = async () => { const e = new Error('down'); e.code = 'PAYPAL_UNREACHABLE'; throw e; };
  await assert.rejects(gate.gateInvoice(inv('x', 'hi'), d), (e) => e.code === 'PAYPAL_UNREACHABLE' && e.decision.status === 'PAYPAL_FAILED');
});

test('release sends the draft; expired hold needs reconfirm and is never auto-sent', async () => {
  let t = 1_000_000;
  const d = deps({ now: () => t });
  const h = await gate.gateInvoice(inv('s1', 'MAYBE'), d);
  const r = await gate.release(h.id, d);
  assert.equal(r.status, 'RELEASED');
  assert.equal(d.paypal.calls.filter((c) => c[0] === 'send').length, 1);

  const h2 = await gate.gateInvoice(inv('s2', 'MAYBE'), d);
  t += 73 * 3600 * 1000;
  assert.equal(gate.listDecisions(d).find((x) => x.id === h2.id).status, 'EXPIRED_NEEDS_REVIEW');
  await assert.rejects(gate.release(h2.id, d), (e) => e.code === 'HOLD_EXPIRED');
  assert.equal(d.paypal.calls.filter((c) => c[0] === 'send').length, 1);
  assert.equal((await gate.release(h2.id, d, { reconfirm: true })).status, 'RELEASED');
});

test('rewrite: replaces note with template, drops draft, creates+sends; refused if other fields still flagged', async () => {
  const d = deps();
  const h = await gate.gateInvoice(inv('s1', 'MAYBE call'), d);
  const r = await gate.rewrite(h.id, d);
  assert.equal(r.status, 'REWRITTEN_SENT');
  const creates = d.paypal.calls.filter((c) => c[0] === 'create');
  assert.equal(creates[1][1].detail.note, gate.SAFE_NOTE);
  assert.ok(d.paypal.calls.some((c) => c[0] === 'delete'));

  const b = await gate.gateInvoice({ ...inv('s2', 'SCAMMY'), seller_name: 'SCAMMY Inc' }, d);
  await assert.rejects(gate.rewrite(b.id, d), (e) => e.code === 'REWRITE_STILL_FLAGGED');
});

test('rewrite from BLOCK with clean other fields works', async () => {
  const d = deps();
  const b = await gate.gateInvoice(inv('s2', 'SCAMMY note'), d);
  assert.equal(b.action, 'BLOCK');
  const r = await gate.rewrite(b.id, d);
  assert.equal(r.status, 'REWRITTEN_SENT');
});

test('confirmBlock deletes the draft', async () => {
  const d = deps();
  const h = await gate.gateInvoice(inv('s1', 'MAYBE'), d);
  const r = await gate.confirmBlock(h.id, d);
  assert.equal(r.status, 'BLOCK_CONFIRMED');
  assert.ok(d.paypal.calls.some((c) => c[0] === 'delete'));
});

test('campaign flags >=3 distinct sellers sharing a number with a non-benign member; cancel works', async () => {
  const d = deps();
  const sent = [];
  for (const s of ['a', 'b']) sent.push(await gate.gateInvoice(inv(s, `MAYBE call ${NUM}`), d));
  assert.equal(gate.campaigns(d)[0].flagged, false); // only 2 sellers
  // third scam seller: allowed by judge (benign text with number) to prove SENT invoices exist in cluster
  await gate.gateInvoice(inv('c', `MAYBE ${NUM}`), d);
  const c = gate.campaigns(d).find((x) => x.phone === '8885550142');
  assert.equal(c.flagged, true);
  assert.equal(c.seller_count, 3);
  // all three are HELD drafts -> nothing to cancel yet
  const res = await gate.cancelCampaign('+1 (888) 555-0142', d);
  assert.ok(res.results.every((r) => r.status === 'SKIPPED'));
});

test('cancelCampaign cancels SENT scam-flagged invoices only', async () => {
  const d = deps();
  const a = await gate.gateInvoice(inv('a', `MAYBE ${NUM}`), d);
  const b = await gate.gateInvoice(inv('b', `MAYBE ${NUM}`), d);
  const c = await gate.gateInvoice(inv('c', `MAYBE ${NUM}`), d);
  for (const x of [a, b, c]) await gate.release(x.id, d); // reviewer released (simulating already-sent campaign)
  const out = await gate.cancelCampaign(NUM, d);
  assert.equal(out.results.filter((r) => r.ok).length, 3);
  assert.equal(d.paypal.calls.filter((x) => x[0] === 'cancel').length, 3);
  assert.equal(d.store.getDecision(a.id).invoice_status, 'CANCELLED');
});

test('cancelCampaign refuses unflagged clusters', async () => {
  const d = deps();
  await gate.gateInvoice(inv('a', `MAYBE ${NUM}`), d);
  await assert.rejects(gate.cancelCampaign(NUM, d), (e) => e.code === 'NOT_FLAGGED');
});

test('POISONING: attacker puts Dana\'s real number in 3 scam invoices; scams held/blocked, Dana still ALLOWed and never cancelled', async () => {
  const d = deps();
  const DANA = '(503) 555-0173';
  const scams = [];
  scams.push(await gate.gateInvoice(inv('evil1', `SCAMMY call billing ${DANA}`), d));
  scams.push(await gate.gateInvoice(inv('evil2', `MAYBE call ${DANA}`), d));
  scams.push(await gate.gateInvoice(inv('evil3', `SCAMMY call ${DANA}`), d));
  assert.ok(scams.every((s) => s.action !== 'ALLOW'));
  // Dana's benign invoice after the poisoning: judged on its own text, still ALLOW
  const dana = await gate.gateInvoice(inv('dana', `Thanks for your business. Questions? Call Dana ${DANA}`), d);
  assert.equal(dana.action, 'ALLOW');
  assert.equal(dana.status, 'SENT');
  const c = gate.campaigns(d).find((x) => x.phone === '5035550173');
  assert.equal(c.flagged, true); // cluster is flagged (it IS being abused)...
  assert.ok(c.benign_members.includes(dana.id)); // ...but Dana is identified as benign
  assert.ok(!c.cancellable.includes(dana.invoice_id));
  // Dana's invoice is still listed on the card (it exists in PayPal), marked as not flagged
  assert.deepEqual(c.invoices.find((x) => x.invoice_id === dana.invoice_id), { invoice_id: dana.invoice_id, status: 'SENT', flagged: false });
  // release the held scam so there is something to cancel, then bulk-cancel: Dana's invoice must survive
  await gate.release(scams[1].id, d);
  const out = await gate.cancelCampaign(DANA, d);
  assert.deepEqual(out.skipped_benign, [dana.id]);
  assert.equal(d.paypal.calls.some((x) => x[0] === 'cancel' && x[1] === dana.invoice_id), false);
  assert.equal(d.store.getDecision(dana.id).invoice_status, 'SENT');
});

test('a merchant\'s own number in benign invoices (even from 3+ sellers) does not flag a cluster', async () => {
  const d = deps();
  for (const s of ['a', 'b', 'c']) await gate.gateInvoice(inv(s, 'Call us (503) 555-0173'), d);
  assert.equal(gate.campaigns(d)[0].flagged, false);
});

test('normPhone', () => {
  assert.equal(gate.normPhone('+1 (888) 555-0142'), '8885550142');
  assert.equal(gate.normPhone('12'), null);
});

test('backfillScan: judges only OUR invoices from the API response; foreign ones are counted, never read/judged/cancelled', async () => {
  const foreign = [{ id: 'F-1', name: 'Rival Team SCAMMY Co' }, { id: 'F-2', name: 'Rival Two' }];
  const paypal = stubPayPal({ foreign });
  const judged = [];
  const base = require('./helpers').stubCheck();
  const d = deps({ paypal, checkInvoice: async (f, o) => { judged.push(f); return base(f, o); } });
  const mk = (id, name, note) => ({ seller_id: id, seller_name: name, recipient_email: `${id}@example.com`, currency: 'USD', items: [{ name: 'Thing', quantity: 1, unit_amount: '10.00' }], note, terms: '' });
  const a = await gate.sendWithoutGate(mk('sa', 'hangup STAGED A', `SCAMMY call ${NUM}`), d);
  const b = await gate.sendWithoutGate(mk('sb', 'hangup STAGED B', `SCAMMY call ${NUM}`), d);
  assert.equal(judged.length, 0);
  assert.equal(a.verdict, null);
  // an invoice we created but whose name lacks the prefix is still ours (id in store)
  const c = await gate.sendWithoutGate(mk('sc', 'Plain Name', 'thanks'), d);
  // a non-sent draft of ours is skipped
  const r = await gate.backfillScan(d, { days: 30, pageSize: 2 });
  assert.equal(r.listed, 5);
  assert.equal(r.foreign_skipped, 2);
  assert.equal(r.ours, 3);
  assert.equal(r.scanned, 3);
  assert.equal(r.flagged, 2);
  assert.ok(r.pages >= 3, 'pages through results');
  assert.equal(judged.length, 3);
  assert.ok(judged.every((f) => !/Rival/.test(JSON.stringify(f))));
  assert.ok(!d.paypal.calls.some((x) => ['get', 'cancel', 'delete', 'send'].includes(x[0]) && /^F-/.test(x[1])));
  assert.ok(!JSON.stringify(r).includes('Rival'));
  const da = d.store.getDecision(a.id);
  assert.equal(da.source, 'backfill');
  assert.equal(da.verdict, 'LIKELY_CALLBACK_SCAM');
  assert.deepEqual(da.phones, ['8885550142']);
  assert.equal(d.store.getDecision(c.id).verdict, 'NO_CALLBACK_PATTERN');
  // second run does not re-judge
  const again = await gate.backfillScan(d, { days: 30 });
  assert.equal(again.already_screened, 3);
  assert.equal(judged.length, 3);
  // campaign uses backfilled data
  assert.equal(gate.campaigns(d)[0].phone, '8885550142');
  assert.equal(b.status, 'SENT_WITHOUT_GATE');
});

test('backfillScan: since ignores older invoices of ours', async () => {
  const d = deps();
  await gate.sendWithoutGate({ ...inv('sa', 'SCAMMY x'), seller_name: 'hangup STAGED A' }, d);
  const r = await gate.backfillScan(d, { days: 30, since: Date.now() + 60000 });
  assert.equal(r.scanned, 0);
  assert.equal(r.too_old, 1);
});

test('cancelCampaign re-reads live status: a stale stored DRAFT (late CREATED webhook) does not block the cancel', async () => {
  const d = deps();
  const ids = [];
  for (const s of ['a', 'b', 'c']) { const x = await gate.gateInvoice(inv(s, `MAYBE ${NUM}`), d); await gate.release(x.id, d); ids.push(x.id); }
  for (const id of ids) d.store.updateDecision(id, { invoice_status: 'DRAFT' }); // simulate the race
  const out = await gate.cancelCampaign(NUM, d);
  assert.equal(out.results.filter((r) => r.ok).length, 3);
});

// ---- unfamiliar-seller context at the gate ----
test('gate: familiar = earlier SENT/RELEASED/PAID decision to the SAME recipient; held, blocked or other recipients do not count', async () => {
  const d = deps();
  d.unfamiliarSignal = true;
  const seen = [];
  const base = d.checkInvoice;
  d.checkInvoice = async (f, o) => { seen.push(o && o.ctx && o.ctx.unfamiliar_seller); return base(f, o); };
  const a = await gate.gateInvoice(inv('plumb', 'Thanks for the job'), d);              // first ever: unfamiliar
  assert.equal(a.unfamiliar_seller, true); assert.equal(a.unfamiliar_source, 'gate_history');
  const b = await gate.gateInvoice(inv('plumb', 'Thanks again'), d);                    // a was SENT: familiar
  assert.equal(b.unfamiliar_seller, false);
  const other = await gate.gateInvoice({ ...inv('plumb', 'Thanks'), recipient_email: 'someone-else@example.com' }, d);
  assert.equal(other.unfamiliar_seller, true);                                         // different recipient
  const held = await gate.gateInvoice(inv('shady', 'MAYBE call us'), d);               // HELD does not make a seller familiar
  const held2 = await gate.gateInvoice(inv('shady', 'Thanks'), d);
  assert.equal(held.unfamiliar_seller, true); assert.equal(held2.unfamiliar_seller, true);
  assert.deepEqual(seen, [true, false, true, true, true]);
});
test('gate: signal is OFF by default (null) and an explicit caller value is honoured', async () => {
  const d = deps();
  const seen = [];
  const base = d.checkInvoice;
  d.checkInvoice = async (f, o) => { seen.push(o.ctx.unfamiliar_seller); return base(f, o); };
  const r = await gate.gateInvoice(inv('x1', 'hello'), d);
  assert.equal(r.unfamiliar_seller, null); assert.equal(r.unfamiliar_source, null);
  const r2 = await gate.gateInvoice({ ...inv('x2', 'hello'), unfamiliar_seller: true }, d);
  assert.equal(r2.unfamiliar_seller, true); assert.equal(r2.unfamiliar_source, 'caller');
  assert.deepEqual(seen, [null, true]);
});

test('cancelCampaign with a selection narrows the cancel and refuses benign or foreign ids', async () => {
  const d = deps();
  const a = await gate.gateInvoice(inv('s1', `SCAMMY call ${NUM}`), { ...d, checkInvoice: d.checkInvoice });
  const ids = [];
  for (const s of ['s1', 's2', 's3']) {
    const x = await gate.sendWithoutGate(inv(s, `x ${NUM}`), d);
    ids.push(x.id);
    d.store.updateDecision(x.id, { verdict: 'LIKELY_CALLBACK_SCAM', phones: ['8885550142'], invoice_status: 'SENT' });
  }
  const benign = await gate.gateInvoice(inv('honest', `Call us on ${NUM}`), d);
  assert.equal(benign.action, 'ALLOW');
  const out = await gate.cancelCampaign(NUM, d, { only: [ids[0], benign.id, 'nope'] });
  assert.deepEqual(out.results.map((r) => r.decision_id), [ids[0]]);
  assert.deepEqual(out.refused.map((r) => r.decision_id).sort(), [benign.id, 'nope'].sort());
  assert.equal(out.refused.find((r) => r.decision_id === benign.id).reason, 'benign invoice: never cancelled');
  const cancelled = d.paypal.calls.filter((c) => c[0] === 'cancel').map((c) => c[1]);
  assert.deepEqual(cancelled, [d.store.getDecision(ids[0]).invoice_id]);
  assert.equal(d.store.getDecision(benign.id).invoice_status, 'SENT');
  assert.ok(a);
});

test('refreshStatuses re-reads PayPal for our invoices only', async () => {
  const d = deps();
  const x = await gate.gateInvoice(inv('dana', 'hello'), d);
  d.store.updateDecision(x.id, { invoice_status: 'DRAFT' });
  const out = await gate.refreshStatuses([x.id, 'missing'], d);
  assert.equal(out[0].status, 'SENT');
  assert.equal(out[0].fetched, true);
  assert.equal(out[1].error, 'NOT_FOUND');
  assert.equal(d.store.getDecision(x.id).invoice_status, 'SENT');
});
