'use strict';
// Live smoke test against the PayPal sandbox. Run once, deliberately:
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/smoke_live.js [outDir]
// Creates two hangup-* invoices (staged scam + benign control), sends with send_to_recipient:false,
// reads them back, renders one payer-view with headless Chromium, cancels ONLY the scam one it created, re-reads.
// Writes IDs and statuses only (never tokens) to eval/results/live_smoke_<ts>.json.
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { createPayPalClient, buildInvoiceBody } = require('../src/paypal');
const { renderPayerView, proxyOpts } = require('../src/payerview');

const ts = Date.now();
const art = process.argv[2] || path.join(__dirname, '..', 'eval', 'results');
const out = { ts: new Date(ts).toISOString(), env: config.paypal.env, steps: [] };
const step = (name, data) => { out.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };

(async () => {
  const pp = createPayPalClient(config.paypal);
  try {
    await pp.getToken();
    step('token', { ok: true });
    const mk = (n, name, note, items) => buildInvoiceBody({
      seller_name: name, recipient_email: 'hangup-smoke@example.com', currency: 'USD', note, terms: 'STAGED hangup smoke test',
      invoice_number: `hangup-${ts}-${n}`, items,
    });
    const scam = await pp.createInvoice(mk(1, 'hangup STAGED Maple Bay Digital', 'STAGED TEST. Your TotalDefend Antivirus plan renewed and $499.00 was charged. If you did not authorise this, call our billing helpline at 1-888-555-0142 to cancel and get a refund.', [{ name: 'TotalDefend Antivirus renewal', description: 'STAGED. Call 1-888-555-0142 to cancel', quantity: 1, unit_amount: '499.00' }]));
    const benign = await pp.createInvoice(mk(2, 'hangup STAGED Dana Plumbing', 'STAGED TEST. Thanks for your business. Questions? Call Dana on (503) 555-0173.', [{ name: 'Valve replacement', quantity: 1, unit_amount: '285.00' }]));
    step('create', { scam_id: scam.id, benign_id: benign.id });
    const mine = [scam.id, benign.id];
    const sent = {};
    for (const id of mine) sent[id] = await pp.sendInvoice(id, { send_to_recipient: false, send_to_invoicer: false });
    step('send', { urls: Object.fromEntries(mine.map((id) => [id, sent[id].payer_view_url])) });
    const got = {};
    for (const id of mine) got[id] = await pp.getInvoice(id);
    step('get', Object.fromEntries(mine.map((id) => [id, { status: got[id].status, spam_info: (got[id].detail && got[id].detail.metadata && got[id].detail.metadata.spam_info) || null, metadata_keys: Object.keys((got[id].detail && got[id].detail.metadata) || {}), payer_view_url: pp.payerViewUrl(got[id]), link_rels: (got[id].links || []).map((l) => l.rel) }])));
    const url = sent[scam.id].payer_view_url || pp.payerViewUrl(got[scam.id]);
    if (url) {
      fs.mkdirSync(art, { recursive: true });
      const r = await renderPayerView(url);
      step('render', { ok: r.ok, reason: r.reason, invoicer: r.invoicer, amount: r.amount, currency: r.currency, status: r.status, note: r.note && r.note.slice(0, 300), items: r.items && r.items.length, note_in_raw: !!(r.raw_text && /billing helpline/.test(r.raw_text)), invoicer_in_raw: !!(r.raw_text && /Maple Bay/.test(r.raw_text)), amount_in_raw: !!(r.raw_text && /499\.00/.test(r.raw_text)) });
      // artifacts: DOM text + screenshot (+ labelled element outline) for extension selector fixing
      const { chromium } = require('playwright');
      const b = await chromium.launch(proxyOpts());
      try {
        const page = await (await b.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 900 } })).newPage();
        await page.goto(url, { timeout: 30000, waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        fs.writeFileSync(path.join(art, 'payerview_innertext.txt'), await page.evaluate(() => document.body.innerText));
        fs.writeFileSync(path.join(art, 'payerview_outline.json'), JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && (e.textContent || '').trim()).slice(0, 250).map((e) => ({ tag: e.tagName.toLowerCase(), id: e.id || undefined, cls: (e.className && e.className.toString()) || undefined, testid: e.getAttribute('data-testid') || e.getAttribute('data-test-id') || e.getAttribute('data-qa') || undefined, text: e.textContent.trim().slice(0, 120) }))), null, 1));
        await page.screenshot({ path: path.join(art, 'payerview.png'), fullPage: true });
        step('artifacts', { dir: art, final_url_host: new URL(page.url()).host });
      } finally { await b.close(); }
    }
    await pp.cancelInvoice(scam.id, { subject: 'hangup smoke cancel', note: 'STAGED test invoice cancelled', send_to_recipient: false, send_to_invoicer: false });
    const after = await pp.getInvoice(scam.id);
    step('cancel', { scam_id: scam.id, status_after: after.status, benign_untouched_id: benign.id });
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = { code: e.code || 'ERROR', message: e.message, paypal: e.paypal || undefined };
    console.error('smoke failed:', out.error.code, out.error.message);
  }
  const dir = path.join(__dirname, '..', 'eval', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `live_smoke_${ts}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log('wrote', f);
  process.exit(out.ok ? 0 : 1);
})();
