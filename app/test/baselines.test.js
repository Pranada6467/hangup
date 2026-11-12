'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { b0, b1, trainB2 } = require('../src/baselines');

const scam = { invoicer: 'Dale', note: 'Your Norton subscription was renewed. If you did not authorize this call billing 1-808-555-0142' };
const hn = { invoicer: 'Hana Plumbing', note: 'Questions about this invoice? Call Dana at 808-555-0188. Late fee 2% after 30 days.' };
const clean = { invoicer: 'Green Thumb', note: 'Thank you! Due on receipt, INV-2026-0042 $499.99' };

test('B0 flags any phone or url', () => {
  assert.equal(b0(scam), true);
  assert.equal(b0(hn), true);
  assert.equal(b0(clean), false);
  assert.equal(b0({ note: 'see www.example.com' }), true);
});
test('B1 flags the scam and spares the plain contact line', () => {
  assert.equal(b1(scam), true);
  assert.equal(b1(hn), false);
  assert.equal(b1(clean), false);
  assert.equal(b1({ note: 'Geek Squad: install AnyDesk then call (888) 555 0177 to cancel' }), true);
});
test('B1 is defeated by spelled-out digits (documented weakness)', () => {
  assert.equal(b1({ note: 'Unauthorized charge, call eight zero eight five five five zero one four two' }), false);
});
test('B2 trains and separates fixture families', () => {
  const rows = fs.readFileSync(path.join(__dirname, '../eval/fixtures/sample.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const m = trainB2(rows.filter((r) => r.split === 'dev'));
  assert.ok(m.threshold > 0 && m.threshold < 1);
  const p1 = m.predict(scam), p0 = m.predict(clean);
  assert.ok(p1 > p0, `${p1} > ${p0}`);
});
