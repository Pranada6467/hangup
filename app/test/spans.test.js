'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalise } = require('../src/normalise');
const { checkInvoice } = require('../src/decide');
const { REASON_LABELS, reasonLabel } = require('../src/labels');

const form = (quotes) => ({ callback_demanded: true, disputes_unrecognised_charge: true, brand_impersonated: null, brand_matches_invoicer: null,
  urgency_deadline: false, remote_access_or_refund_hint: false, payment_outside_paypal: false, injection_attempt: false,
  looks_like_callback_scam: true, evidence_quotes: quotes, explanation_plain: 'x' });
const judgeFor = (quotes) => async () => ({ form: form(quotes), model: 'm', latency_ms: 1, usage: {} });

test('normalise returns replacements with positions in the output text', () => {
  const n = normalise('Please call 503 555 0173 today');
  assert.equal(n.text, 'Please call +15035550173 today');
  assert.deepEqual(n.replacements, [{ canonical: '+15035550173', original: '503 555 0173', start: 12, end: 24 }]);
  assert.equal(n.text.slice(12, 24), '+15035550173');
});

test('evidence span maps a spaced-digit phone back to the original', async () => {
  const note = 'Hello. Your account was charged $499. Call 5 0 3 5 5 5 0 1 7 3 now to cancel.';
  const n = normalise(note);
  const quote = n.text.match(/Call \+\d+ now/)[0];
  const r = await checkInvoice({ note, items: [] }, { judge: judgeFor([quote]) });
  assert.equal(r.evidence_spans.length, 1);
  const s = r.evidence_spans[0];
  assert.equal(s.field, 'note');
  assert.equal(s.text, 'Call 5 0 3 5 5 5 0 1 7 3 now');
  assert.equal(note.slice(s.start, s.end), s.text);
});

test('evidence span maps a dotted phone, picks the right sentence, is case-insensitive', async () => {
  const note = 'Thanks for your order. Dial 503.555.0173 to dispute this charge. Have a nice day.';
  const n = normalise(note);
  const quote = n.text.match(/dial \+\d+ to dispute/i)[0].toLowerCase();
  const r = await checkInvoice({ note, terms: 'Dial 800 later', items: [{ name: 'Pipe', description: 'x' }] }, { judge: judgeFor([quote, 'no such text']) });
  assert.equal(r.evidence_spans.length, 1);
  assert.equal(r.evidence_spans[0].text, 'Dial 503.555.0173 to dispute');
  assert.equal(r.evidence_spans[0].start, note.indexOf('Dial'));
});

test('evidence span finds quotes in terms and item fields', async () => {
  const r = await checkInvoice({ note: 'n', terms: 'Refund by calling us', items: [{ name: 'Geek  Squad plan', description: 'd' }] },
    { judge: judgeFor(['geek squad plan', 'refund by calling']) });
  assert.deepEqual(r.evidence_spans.map((s) => s.field).sort(), ['item_name', 'terms']);
});

test('reason labels cover every code in en, es, fr', () => {
  const codes = Object.keys(REASON_LABELS.en);
  assert.equal(codes.length, 9);
  for (const l of ['es', 'fr']) for (const c of codes) assert.ok(REASON_LABELS[l][c], l + ' ' + c);
  assert.equal(reasonLabel('PHONE_IN_TEXT'), 'It contains a phone number');
  assert.equal(reasonLabel('NOPE'), 'NOPE');
});

test('UI copies of the reason labels match src/labels.js', () => {
  const fs = require('node:fs'), path = require('node:path');
  for (const f of ['../public/check.js', '../extension/banner.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\\'/g, "'");
    for (const l of Object.keys(REASON_LABELS)) for (const [c, label] of Object.entries(REASON_LABELS[l])) assert.ok(src.includes(label), `${f} ${l} ${c}`);
  }
});
