'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withBudget, perIpDailyLimit } = require('../src/budget');

test('budget: identical fields are judged once (cache)', async () => {
  let calls = 0;
  const b = withBudget(async () => { calls++; return { verdict: 'NO_CALLBACK_PATTERN' }; }, { dailyCap: 5 });
  await b({ note: 'x' }); const r = await b({ note: 'x' });
  assert.strictEqual(calls, 1); assert.strictEqual(r.cached, true);
});

test('budget: daily cap fails closed with LLM_UNAVAILABLE and resets next day', async () => {
  let t = Date.parse('2026-11-05T10:00:00Z');
  const b = withBudget(async () => ({ verdict: 'X' }), { dailyCap: 2, now: () => t });
  await b({ note: 1 }); await b({ note: 2 });
  await assert.rejects(() => b({ note: 3 }), (e) => e.code === 'LLM_UNAVAILABLE' && e.reason === 'DAILY_BUDGET');
  t += 24 * 3600e3;
  await b({ note: 3 });
});

test('per-IP daily limit applies to POST only', () => {
  const mw = perIpDailyLimit({ max: 1 });
  const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
  let passed = 0; const next = () => passed++;
  mw({ method: 'POST', ip: 'a' }, res, next);
  mw({ method: 'GET', ip: 'a' }, res, next);
  mw({ method: 'POST', ip: 'a' }, res, next);
  assert.strictEqual(passed, 2); assert.strictEqual(res.code, 429);
});

test('cache key includes the unfamiliar-seller context (a verdict for one context is never served for another)', async () => {
  const { withBudget } = require('../src/budget');
  let calls = 0;
  const b = withBudget(async (f, o) => { calls++; return { verdict: o && o.ctx && o.ctx.unfamiliar_seller === true ? 'SUSPICIOUS' : 'NO_CALLBACK_PATTERN' }; });
  const f = { note: 'hi' };
  assert.equal((await b(f, { ctx: { unfamiliar_seller: true } })).verdict, 'SUSPICIOUS');
  assert.equal((await b(f, { ctx: { unfamiliar_seller: null } })).verdict, 'NO_CALLBACK_PATTERN');
  assert.equal((await b(f, { ctx: { unfamiliar_seller: false } })).verdict, 'NO_CALLBACK_PATTERN');
  assert.equal((await b(f)).cached, true); // same as null
  assert.equal(calls, 3);
});
