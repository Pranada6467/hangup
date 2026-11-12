'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, checkInvoice } = require('../src/decide');

const base = { callback_demanded: false, disputes_unrecognised_charge: false, brand_impersonated: null, brand_matches_invoicer: null,
  urgency_deadline: false, remote_access_or_refund_hint: false, payment_outside_paypal: false, injection_attempt: false,
  looks_like_callback_scam: false };
const ph = { hasPhone: true, phones: ['+18085550142'] }, noph = { hasPhone: false, phones: [] };

const L = { looks_like_callback_scam: true };
const table = [
  ['callback + dispute + looks_like + phone', { ...L, callback_demanded: true, disputes_unrecognised_charge: true }, ph, 'LIKELY_CALLBACK_SCAM'],
  ['callback + dispute + looks_like, no digits extracted', { ...L, callback_demanded: true, disputes_unrecognised_charge: true }, noph, 'LIKELY_CALLBACK_SCAM'],
  ['callback + brand mismatch + looks_like', { ...L, callback_demanded: true, brand_impersonated: 'Norton', brand_matches_invoicer: false }, ph, 'LIKELY_CALLBACK_SCAM'],
  ['callback + remote access + looks_like', { ...L, callback_demanded: true, remote_access_or_refund_hint: true }, ph, 'LIKELY_CALLBACK_SCAM'],
  ['dispute + callback but LLM says not a scam', { callback_demanded: true, disputes_unrecognised_charge: true }, ph, 'NO_CALLBACK_PATTERN'],
  ['looks_like but no callback demanded', { ...L, disputes_unrecognised_charge: true }, ph, 'NO_CALLBACK_PATTERN'],
  ['callback + looks_like but no concrete signal', { ...L, callback_demanded: true }, ph, 'SUSPICIOUS'],
  ['callback + remote access, looks_like false', { callback_demanded: true, remote_access_or_refund_hint: true }, ph, 'SUSPICIOUS'],
  ['callback + dispute + urgency, looks_like false', { callback_demanded: true, disputes_unrecognised_charge: true, urgency_deadline: true }, ph, 'SUSPICIOUS'],
  ['dispute + urgency without callback', { disputes_unrecognised_charge: true, urgency_deadline: true }, ph, 'NO_CALLBACK_PATTERN'],
  ['callback + urgency only (no concrete signal)', { callback_demanded: true, urgency_deadline: true }, ph, 'NO_CALLBACK_PATTERN'],
  ['legit "to cancel your maintenance plan call us" (looks_like false)', { callback_demanded: true }, ph, 'NO_CALLBACK_PATTERN'],
  ['plain callback (legit contact line)', { callback_demanded: true }, ph, 'NO_CALLBACK_PATTERN'],
  ['injection only', { injection_attempt: true }, noph, 'SUSPICIOUS'],
  ['brand mismatch + phone, LLM reads no scam (honest reseller)', { brand_impersonated: 'Geek Squad', brand_matches_invoicer: false }, ph, 'NO_CALLBACK_PATTERN'],
  ['reseller: Norton renewal "as agreed", call to cancel, LLM reads no scam', { callback_demanded: true, brand_impersonated: 'Norton', brand_matches_invoicer: false }, ph, 'NO_CALLBACK_PATTERN'],
  ['brand mismatch + phone + unrecognised charge, looks_like false', { brand_impersonated: 'Geek Squad', brand_matches_invoicer: false, disputes_unrecognised_charge: true }, ph, 'SUSPICIOUS'],
  ['brand mismatch + phone, no callback, LLM says looks like scam', { ...L, brand_impersonated: 'Geek Squad', brand_matches_invoicer: false }, ph, 'SUSPICIOUS'],
  ['brand mismatch, no phone', { brand_impersonated: 'Geek Squad', brand_matches_invoicer: false }, noph, 'NO_CALLBACK_PATTERN'],
  ['payment outside paypal', { payment_outside_paypal: true }, noph, 'SUSPICIOUS'],
  ['brand matches invoicer, looks_like false', { callback_demanded: true, brand_impersonated: 'Hana', brand_matches_invoicer: true }, ph, 'NO_CALLBACK_PATTERN'],
  ['nothing', {}, noph, 'NO_CALLBACK_PATTERN'],
];
for (const [name, over, norm, want] of table) {
  test(`decide: ${name}`, () => assert.equal(decide({ ...base, ...over }, norm).verdict, want));
}
test('headline wording never says safe', () => {
  const d = decide(base, noph);
  assert.equal(d.headline, "No callback-scam pattern found in this invoice's text");
  for (const v of [d, decide({ ...base, injection_attempt: true }, noph), decide({ ...base, ...L, callback_demanded: true, disputes_unrecognised_charge: true }, ph)]) {
    assert.ok(!/\bsafe\b/i.test(v.headline));
  }
});
test('scam advice text', () => {
  const d = decide({ ...base, ...L, callback_demanded: true, disputes_unrecognised_charge: true }, ph);
  assert.equal(d.advice[0], "Don't call the number in this invoice.");
  assert.equal(d.advice.length, 4);
  assert.ok(d.reasons.includes('CALLBACK_DEMANDED'));
});
test('checkInvoice end to end with injected judge stub (unit-test stub, not a model)', async () => {
  let seen;
  const judge = async (nf) => { seen = nf; return { form: { ...base, ...L, callback_demanded: true, disputes_unrecognised_charge: true, evidence_quotes: [] }, model: 'stub', latency_ms: 1, usage: {} }; };
  const r = await checkInvoice({ invoicer: 'Bob', note: 'call eight zero eight five five five zero one four two', items: [{ name: 'x', description: 'y' }], declared_contact: '808-555-0142' }, { judge });
  assert.equal(r.verdict, 'LIKELY_CALLBACK_SCAM');
  assert.deepEqual(r.features.phones, ['+18085550142']);
  assert.ok(seen.note.includes('+18085550142'));
});

// ---- unfamiliar-seller signal -------------------------------------------------------------------------------------
// ctx.unfamiliar_seller: true | false | null (unknown). null/false/missing must behave exactly like before.
const { substanceOf } = require('../src/decide');
const bare = { words: 0, describes_goods: false };
const bareNote = { words: 8, describes_goods: false };           // e.g. "If you have any issues, do let us know +1..."
const ordinary = { words: 24, describes_goods: true };            // Dana: items name the job, note explains it
const verdictOf = (form, norm, ctx) => decide({ ...base, ...form }, norm, ctx).verdict;

test('unfamiliar: terse note + phone, LLM says no scam (r-020 shape) -> SUSPICIOUS', () => {
  const d = decide({ ...base, callback_demanded: true }, ph, { unfamiliar_seller: true, substance: bareNote });
  assert.equal(d.verdict, 'SUSPICIOUS');
  assert.ok(d.reasons.includes('UNFAMILIAR_SELLER'));
});
test('unfamiliar: bare phone number + LLM scam reading (r-019 shape) -> LIKELY', () => {
  assert.equal(verdictOf({ ...L, callback_demanded: true }, ph, { unfamiliar_seller: true, substance: bare }), 'LIKELY_CALLBACK_SCAM');
});
test('unfamiliar: bare + payment outside PayPal, no phone (r-009 shape) -> LIKELY', () => {
  assert.equal(verdictOf({ payment_outside_paypal: true }, noph, { unfamiliar_seller: true, substance: { words: 2, describes_goods: false } }), 'LIKELY_CALLBACK_SCAM');
});
test('unfamiliar: bare + urgency, no phone -> SUSPICIOUS', () => {
  assert.equal(verdictOf({ urgency_deadline: true }, noph, { unfamiliar_seller: true, substance: bareNote }), 'SUSPICIOUS');
});
test('unfamiliar seller\'s ORDINARY first invoice (Dana the plumber, phone, names the job) is NOT held', () => {
  for (const form of [{ callback_demanded: true }, { callback_demanded: true, urgency_deadline: true }, {}]) {
    assert.equal(verdictOf(form, ph, { unfamiliar_seller: true, substance: ordinary }), 'NO_CALLBACK_PATTERN');
  }
});
test('unfamiliar: a long note with a phone is not bare, even with no items', () => {
  assert.equal(verdictOf({ callback_demanded: true }, ph, { unfamiliar_seller: true, substance: { words: 11, describes_goods: false } }), 'NO_CALLBACK_PATTERN');
});
test('unfamiliar: terse text with NO phone and no pressure is left alone', () => {
  assert.equal(verdictOf({}, noph, { unfamiliar_seller: true, substance: bare }), 'NO_CALLBACK_PATTERN');
});
test('null / false / missing context or missing substance behave exactly like today', () => {
  const forms = [{ callback_demanded: true }, { ...L, callback_demanded: true }, { payment_outside_paypal: true }, { urgency_deadline: true }, {}];
  for (const f of forms) for (const norm of [ph, noph]) {
    const want = decide({ ...base, ...f }, norm).verdict;
    for (const ctx of [{ unfamiliar_seller: null, substance: bare }, { unfamiliar_seller: false, substance: bare }, { substance: bare }, { unfamiliar_seller: true }, { unfamiliar_seller: 'true', substance: bare }]) {
      assert.equal(decide({ ...base, ...f }, norm, ctx).verdict, want);
    }
  }
});
test('unfamiliar signal never lowers a verdict and never says safe', () => {
  const order = ['NO_CALLBACK_PATTERN', 'SUSPICIOUS', 'LIKELY_CALLBACK_SCAM'];
  for (const f of [{}, { callback_demanded: true }, { ...L, callback_demanded: true }, { injection_attempt: true }, { callback_demanded: true, disputes_unrecognised_charge: true, ...L }]) for (const norm of [ph, noph]) for (const sub of [bare, bareNote, ordinary]) {
    const a = decide({ ...base, ...f }, norm), b = decide({ ...base, ...f }, norm, { unfamiliar_seller: true, substance: sub });
    assert.ok(order.indexOf(b.verdict) >= order.indexOf(a.verdict));
    assert.ok(!/\bsafe\b/i.test(b.headline));
  }
});
test('substanceOf: strips phone numbers, counts item words, long invoicer names count as message', () => {
  assert.deepEqual(substanceOf({ invoicer: 'Bob', note: 'If you have any issues, do let us know +18335550118', terms: '', items: [{ name: '', description: '' }] }), { words: 9, describes_goods: false });
  assert.equal(substanceOf({ invoicer: 'Dana', note: 'x', items: [{ name: 'Water heater flush', description: '' }] }).describes_goods, true);
  assert.equal(substanceOf({ invoicer: 'Dana', note: 'x', items: [{ name: 'Service', description: '' }] }).describes_goods, false);
  assert.ok(substanceOf({ invoicer: 'Unrecognized transaction? Please contact customer care +18055550111 now', note: '', items: [] }).words >= 6);
});
test('checkInvoice: ctx null identical to no ctx; unfamiliar=true holds a bare number, not an ordinary first invoice', async () => {
  const judge = (over) => async () => ({ form: { ...base, callback_demanded: true, evidence_quotes: [], ...over }, model: 'stub', latency_ms: 1, usage: {} });
  const terse = { invoicer: 'Jennifer Davidson', amount: '100', note: 'If you have any issues, do let us know +1(833) 555-0118', items: [{ name: '', description: '' }] };
  const a = await checkInvoice(terse, { judge: judge({}) });
  const b = await checkInvoice(terse, { judge: judge({}), ctx: { unfamiliar_seller: null } });
  assert.equal(a.verdict, 'NO_CALLBACK_PATTERN');
  assert.deepEqual([b.verdict, b.reasons], [a.verdict, a.reasons]);
  const c = await checkInvoice(terse, { judge: judge({}), ctx: { unfamiliar_seller: true } });
  assert.equal(c.verdict, 'SUSPICIOUS');
  assert.equal(c.unfamiliar_seller, true);
  const dana = { invoicer: 'Dana', amount: '285', note: 'Thanks for choosing Dana. Questions about this job? Call Dana on (503) 555-0173.', items: [{ name: 'Water heater flush and valve replacement', description: 'Job at 14 Elm St' }] };
  const e = await checkInvoice(dana, { judge: judge({}), ctx: { unfamiliar_seller: true } });
  assert.equal(e.verdict, 'NO_CALLBACK_PATTERN');
});
