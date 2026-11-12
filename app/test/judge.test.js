'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { llmJudge, validateForm } = require('../src/judge');

const good = { callback_demanded: true, disputes_unrecognised_charge: true, brand_impersonated: 'Norton', brand_matches_invoicer: false,
  urgency_deadline: false, remote_access_or_refund_hint: false, payment_outside_paypal: false, injection_attempt: false, looks_like_callback_scam: true, language: 'en',
  evidence_quotes: ['call our billing line', 'NOT IN TEXT'], explanation_plain: 'It tells you to phone.', confidence: 0.9 };
// UNIT-TEST STUBS: fake fetch responses, not a real model.
const resp = (content, ok = true, status = 200) => ({ ok, status, json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) });
const fields = { invoicer: 'X', note: 'Please Call Our Billing Line now' };

test('validateForm filters quotes to substrings, case-insensitive', () => {
  const f = validateForm(good, 'Please Call Our Billing Line now');
  assert.deepEqual(f.evidence_quotes, ['call our billing line']);
});
test('validateForm coerces and rejects', () => {
  const f = validateForm({ ...good, callback_demanded: 'true', confidence: 7, brand_impersonated: 'null' }, '');
  assert.equal(f.callback_demanded, true);
  assert.equal(f.confidence, 1);
  assert.equal(f.brand_impersonated, null);
  assert.equal(f.brand_matches_invoicer, null);
  assert.throws(() => validateForm({ ...good, injection_attempt: 'maybe' }, ''));
  assert.throws(() => validateForm({ ...good, looks_like_callback_scam: undefined }, ''), /looks_like_callback_scam/);
  assert.throws(() => validateForm(null, ''));
});
test('llmJudge parses, sends expected request', async () => {
  let req;
  const fetchImpl = async (url, init) => { req = { url, init }; return resp('```json\n' + JSON.stringify(good) + '\n```'); };
  const r = await llmJudge(fields, { model: 'm/x', fetchImpl, baseUrl: 'http://stub/v1', apiKey: 'k' });
  assert.equal(req.url, 'http://stub/v1/chat/completions');
  const body = JSON.parse(req.init.body);
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[1].content, /<invoice_data>/);
  assert.equal(req.init.headers['X-Title'], 'HangUp');
  assert.equal(r.form.evidence_quotes.length, 1);
  assert.deepEqual(r.usage, { prompt_tokens: 10, completion_tokens: 5 });
});
test('llmJudge retries once on bad JSON', async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? resp('not json') : resp(JSON.stringify(good)));
  const r = await llmJudge(fields, { model: 'm', fetchImpl, apiKey: 'k' });
  assert.equal(n, 2);
  assert.equal(r.form.callback_demanded, true);
  assert.deepEqual(r.usage, { prompt_tokens: 20, completion_tokens: 10 });
});
test('llmJudge fails after two bad outputs', async () => {
  let n = 0;
  await assert.rejects(llmJudge(fields, { model: 'm', fetchImpl: async () => { n++; return resp('nope'); }, apiKey: 'k' }), { code: 'LLM_BAD_OUTPUT' });
  assert.equal(n, 2);
});
test('network failure and HTTP error give LLM_UNAVAILABLE', async () => {
  await assert.rejects(llmJudge(fields, { fetchImpl: async () => { throw new Error('boom'); } }), { code: 'LLM_UNAVAILABLE' });
  await assert.rejects(llmJudge(fields, { fetchImpl: async () => resp('', false, 403) }), { code: 'LLM_UNAVAILABLE' });
});
