'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalise } = require('../src/normalise');

const P = '+18085550142';
test('detects common phone formats', () => {
  for (const s of ['call +1 (808) 555-0142', '1-808-555-0142', '8 0 8 5 5 5 0 1 4 2', '808.555.0142', '(808)555 0142', 'tel 8085550142']) {
    const n = normalise(s);
    assert.deepEqual(n.phones, [P], s);
    assert.equal(n.hasPhone, true);
  }
});
test('undoes obfuscation', () => {
  const cases = [
    '８０８ ５５５ ０１４２', '8O8-555-O142', '808​555​0142', '808–555–0142',
    'call eight zero eight five five five zero one four two',
    'llame ocho cero ocho cinco cinco cinco cero uno cuatro dos',
    'appelez huit zéro huit cinq cinq cinq zéro un quatre deux',
  ];
  for (const s of cases) assert.deepEqual(normalise(s).phones, [P], s);
});
test('does not treat amounts, invoice numbers, dates, zips as phones', () => {
  const s = 'Total $499.99 USD, INV-2026-0042, due 2026-03-15, 03/15/2026, zip 96815, qty 1,234,567.89, 12345-6789';
  const n = normalise(s);
  assert.equal(n.hasPhone, false);
  assert.deepEqual(n.phones, []);
});
test('short spelled-out numbers are left alone', () => {
  assert.equal(normalise('one or two days').text, 'one or two days');
  assert.equal(normalise('pay in two installments').hasPhone, false);
});
test('extracts urls and emails', () => {
  const n = normalise('visit www.refund-help.com or https://x.example.org/a?b=1 mail help@pay-support.net');
  assert.equal(n.hasUrl, true);
  assert.ok(n.urls.includes('www.refund-help.com'));
  assert.ok(n.urls.some((u) => u.startsWith('https://x.example.org')));
  assert.deepEqual(n.emails, ['help@pay-support.net']);
});
