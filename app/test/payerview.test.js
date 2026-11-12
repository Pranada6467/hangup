'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { renderPayerView, checkPayPalInvoiceUrl, extractFromHtml } = require('../src/payerview');

const good = [
  'https://www.paypal.com/invoice/p/#ABC123',
  'https://www.sandbox.paypal.com/invoice/p/#ABC123',
  'https://paypal.com/invoice/p/#ABC',
  'https://sandbox.paypal.com/invoice/p/#ABC',
  'https://www.paypal.com/invoice/payerView/details/INV2-1',
  'https://www.sandbox.paypal.com/invoice/payerView/details/INV2-1?x=1',
];
const bad = [
  'http://www.paypal.com/invoice/p/#A',
  'https://www.paypal.com.evil.com/invoice/p/#A',
  'https://paypal.com@evil.com/invoice/p/#A',
  'https://www.paypal.com:pw@evil.com/invoice/p/#A',
  'https://evil.com/www.paypal.com/invoice/p/',
  'https://evil.com/?u=https://www.paypal.com/invoice/p/',
  'https://www.paypa1.com/invoice/p/#A',
  'https://www.paypal.co/invoice/p/#A',
  'https://xn--paypal-9d3b.com/invoice/p/#A',
  'https://www.pаypal.com/invoice/p/#A', // cyrillic a
  'https://www.paypal.com\\@evil.com/invoice/p/#A',
  'https://evilpaypal.com/invoice/p/#A',
  'https://www.paypal.com.evil.com/',
  'https://www.paypal.com/signin',
  'https://www.paypal.com/invoice/p/',
  'https://www.paypal.com:8443/invoice/p/#A',
  'https://sub.www.paypal.com/invoice/p/#A',
  'https://paypal.com./invoice/p/#A',
  'https://www.paypal.com/invoice/pwned',
  'javascript:alert(1)',
  'file:///etc/passwd',
  'ftp://www.paypal.com/invoice/p/#A',
  'https://127.0.0.1/invoice/p/',
  '//www.paypal.com/invoice/p/#A',
  'www.paypal.com/invoice/p/#A',
  ' https://www.paypal.com/invoice/p/#A',
  'https://www.paypal.com/invoice/p/#A\nhttps://evil.com',
  '',
  null,
  42,
];

test('allowlist accepts genuine PayPal invoice URLs', () => {
  for (const u of good) assert.equal(checkPayPalInvoiceUrl(u).ok, true, u);
});

test('allowlist rejects lookalikes, http, userinfo, punycode, other schemes', async () => {
  for (const u of bad) {
    assert.equal(checkPayPalInvoiceUrl(u).ok, false, String(u));
    const r = await renderPayerView(u);
    assert.deepEqual([r.ok, r.reason], [false, 'NOT_PAYPAL_INVOICE_HOST'], String(u));
    assert.ok(r.explanation.length > 20);
  }
});

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('extractor on FIXTURE (table layout; not real PayPal DOM)', async () => {
  const ex = await extractFromHtml(fixture('payerview_fixture.html'));
  assert.equal(ex.invoicer, 'Maple Bay Digital');
  assert.equal(ex.amount, '499.00');
  assert.equal(ex.currency, 'USD');
  assert.equal(ex.status, 'CANCELLED');
  assert.match(ex.note, /billing helpline at 1-888-555-0142/);
  assert.equal(ex.items[0].name, 'TotalDefend Antivirus renewal');
  assert.match(ex.raw_text, /Terms and conditions/);
});

test('extractor on FIXTURE (plain-text layout)', async () => {
  const ex = await extractFromHtml(fixture('payerview_fixture_plain.html'));
  assert.equal(ex.invoicer, "Dana's Plumbing");
  assert.equal(ex.status, 'PAID');
  assert.equal(ex.amount, '285.00');
  assert.equal(ex.currency, 'EUR');
  assert.match(ex.note, /Call Dana on 503 555 0173/);
});

test('renderPayerView end to end via routed fixture (allowlisted URL, no network)', async () => {
  const url = 'https://www.sandbox.paypal.com/invoice/p/#FIXTURE';
  const r = await renderPayerView(url, { routeHtml: fixture('payerview_fixture.html') });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.provenance.source, 'paypal_payer_view_render');
  assert.equal(r.provenance.url, url);
  assert.ok(r.provenance.fetched_at);
  assert.equal(r.invoicer, 'Maple Bay Digital');
  assert.ok(r.raw_text.length > 0);
});

test('extractor on FIXTURE modelled on the live sandbox layout', async () => {
  const ex = await extractFromHtml(fixture('payerview_fixture_live_layout.html'));
  assert.equal(ex.invoicer, 'hangup STAGED Maple Bay Digital');
  assert.equal(ex.amount, '499.00');
  assert.equal(ex.status, 'DUE');
  assert.match(ex.note, /^STAGED TEST\. Your plan renewed/);
  assert.doesNotMatch(ex.note, /Items/);
  assert.equal(ex.terms, 'STAGED hangup smoke test');
  assert.equal(ex.items[0].name, 'TotalDefend Antivirus renewal');
  assert.match(ex.items[0].description, /Call 1-888-555-0142/);
});

test('extractFromHtml: live item-card layout keeps each item\'s own description (empty item-details is skipped)', async () => {
  const ex = await extractFromHtml(fixture('payerview_fixture_item_card.html'));
  assert.equal(ex.items.length, 2);
  assert.deepEqual(ex.items.map((i) => [i.name, i.description]), [
    ['Water heater flush and valve replacement', 'Job at 14 Elm St, 12 March'],
    ['Call-out fee', 'Call 1-888-555-0142 to cancel'],
  ]);
});

test('payer view: extracts the "no payments with this seller" line when a page shows it; absence is unknown (null), never false', async () => {
  const withLine = '<body><h2>Some Seller</h2><p class="label">Note from seller</p><p>Call 555-0100</p><p>You don’t have any payments with this seller in the last year.</p><h4>Amount due</h4><h3>$5.00</h3></body>';
  const without = '<body><h2>Some Seller</h2><p class="label">Note from seller</p><p>Call 555-0100</p><h4>Amount due</h4><h3>$5.00</h3></body>';
  assert.equal((await extractFromHtml(withLine)).unfamiliar_seller, true);   // fixture HTML written for this test, not a live PayPal page
  assert.equal((await extractFromHtml(without)).unfamiliar_seller, null);
});
