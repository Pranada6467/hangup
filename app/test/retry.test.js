'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withRetry, isTransient } = require('../public/retry');

const httpErr = (status) => Object.assign(new Error('HTTP ' + status), { status });
const noSleep = () => Promise.resolve();

test('isTransient: 502/503/504 and network TypeError only', () => {
  assert.ok(isTransient(httpErr(502)) && isTransient(httpErr(503)) && isTransient(httpErr(504)));
  assert.ok(isTransient(new TypeError('Failed to fetch')));
  assert.ok(!isTransient(httpErr(400)) && !isTransient(httpErr(409)) && !isTransient(httpErr(500)) && !isTransient(null));
});

test('withRetry: retries a 502 and succeeds, with backoff delays and onRetry callbacks', async () => {
  let n = 0; const waits = [], seen = [];
  const r = await withRetry(() => { n += 1; if (n < 3) throw httpErr(502); return Promise.resolve('ok'); }, { delays: [2000, 5000], sleep: (ms) => { waits.push(ms); return Promise.resolve(); }, onRetry: (k, max) => seen.push([k, max]) });
  assert.equal(r, 'ok'); assert.equal(n, 3); assert.deepEqual(waits, [2000, 5000]); assert.deepEqual(seen, [[1, 2], [2, 2]]);
});

test('withRetry: gives up after the last delay and marks the error retryable (UI shows a Retry button)', async () => {
  let n = 0;
  await assert.rejects(withRetry(() => { n += 1; throw httpErr(503); }, { delays: [1, 1], sleep: noSleep }), (e) => e.status === 503 && e.retryable === true);
  assert.equal(n, 3, 'one try plus two retries');
});

test('withRetry: never retries a non-transient error (400, 409, 500)', async () => {
  for (const st of [400, 409, 500]) {
    let n = 0;
    await assert.rejects(withRetry(() => { n += 1; throw httpErr(st); }, { sleep: noSleep }), (e) => e.retryable === false);
    assert.equal(n, 1);
  }
});
