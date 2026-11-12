'use strict';
// Render a genuine PayPal payer-view page with headless Chromium and extract invoice fields.
// DOM selectors are UNVERIFIED against live paypal.com; the extractor is label/text based and always
// returns raw_text so the judge can still read the page if structured extraction misses.

const ALLOWED_HOSTS = new Set(['www.paypal.com', 'paypal.com', 'www.sandbox.paypal.com', 'sandbox.paypal.com']);
const ALLOWED_PREFIXES = ['/invoice/p/', '/invoice/payerView/details/'];

const EXPLAIN = 'HangUp only opens real PayPal invoice pages (https://www.paypal.com/invoice/p/... or the sandbox equivalent). This link points somewhere else, so it was not opened. Links that merely look like PayPal are a common scam trick.';

function checkPayPalInvoiceUrl(input) {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000- \u007f-￿\\]/.test(input)) return { ok: false, reason: 'NOT_PAYPAL_INVOICE_HOST', explanation: EXPLAIN };
  let u;
  try { u = new URL(input); } catch { return { ok: false, reason: 'NOT_PAYPAL_INVOICE_HOST', explanation: EXPLAIN }; }
  const good =
    u.protocol === 'https:' && !u.username && !u.password && !u.port &&
    ALLOWED_HOSTS.has(u.hostname) && ALLOWED_PREFIXES.some((p) => u.pathname.startsWith(p) && (u.pathname.length > p.length || u.hash.length > 1));
  return good ? { ok: true, url: u.toString() } : { ok: false, reason: 'NOT_PAYPAL_INVOICE_HOST', explanation: EXPLAIN };
}

// Runs inside the page. Must be self-contained.
function extractInPage() {
  const clean = (s) => (s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
  const raw = (document.body && document.body.innerText) || '';
  const lines = raw.split(/\n+/).map(clean).filter(Boolean);
  const NOTE_LABELS = ['note from seller', 'note to customer', 'seller note', 'notes', 'note'];
  const STOP = /^(subtotal|bill to|issued|amount due|total|subtotal|items?|description|terms|terms and conditions|invoice (number|date)|due date|pay|view and pay|payment|quantity|qty|price|ship|billed to|bill to|from|invoice from|memo|contact|shipping|tax|discount|reference)\b/i;

  function afterLabel(labels, maxLines) {
    // 1) DOM: element whose own text is exactly the label, take its sibling / parent remainder.
    const els = Array.from(document.querySelectorAll('dt,th,label,h2,h3,h4,h5,span,div,p,strong,b'));
    for (const lab of labels) {
      const re = new RegExp('^' + lab + '\\s*:?$', 'i');
      for (const el of els) {
        if (el.children.length > 0 && el.querySelector('div,p,table')) continue;
        if (!re.test(clean(el.textContent))) continue;
        const sib = el.nextElementSibling;
        if (sib && clean(sib.innerText)) return clean(sib.innerText);
        const par = el.parentElement;
        if (par) {
          const rest = clean(par.innerText).replace(new RegExp('^' + lab + '\\s*:?\\s*', 'i'), '');
          if (rest && rest !== clean(par.innerText)) return rest;
        }
      }
    }
    // 2) Text lines.
    for (const lab of labels) {
      const re = new RegExp('^' + lab + '\\s*:?\\s*(.*)$', 'i');
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(re);
        if (!m) continue;
        const out = [];
        if (m[1]) out.push(m[1]);
        for (let j = i + 1; j < lines.length && out.length < maxLines; j++) {
          if (STOP.test(lines[j]) && !(out.length === 0 && false)) break;
          out.push(lines[j]);
        }
        if (out.length) return out.join('\n');
      }
    }
    return null;
  }

  let invoicer = null;
  // Observed on live sandbox payer-view (2026-11-05): p.merchant-info-line-item holds the business name; h2 above it too.
  const mi = document.querySelector('.merchant-info-line-item');
  if (mi && clean(mi.innerText)) invoicer = clean(mi.innerText);
  if (!invoicer) {
    const dba = raw.match(/Invoice issued by .*?\(doing business as (.+?)\)/i);
    if (dba) invoicer = clean(dba[1]);
  }
  for (const l of lines) {
    if (invoicer) break;
    const m = l.match(/^invoice from\s*:?\s*(.+)$/i);
    if (m) { invoicer = clean(m[1]); break; }
  }
  if (!invoicer) {
    const i = lines.findIndex((l) => /^(invoice from|from|seller|merchant)\s*:?$/i.test(l));
    if (i >= 0 && lines[i + 1]) invoicer = lines[i + 1];
  }
  if (!invoicer) {
    const el = document.querySelector('[data-testid*="invoicer" i],[class*="invoicer" i],[id*="invoicer" i]');
    if (el) invoicer = clean(el.innerText).split('\n')[0];
  }

  let amount = null, currency = null;
  const SYM = { '$': 'USD', '€': 'EUR', '£': 'GBP' };
  const am = raw.match(/amount due\s*:?\s*\n?\s*([A-Z]{3}|[$€£])?\s*([\d.,]+\d)\s*([A-Z]{3})?/i);
  if (am) {
    amount = am[2];
    const c = am[1] || am[3];
    currency = c ? (SYM[c] || c.toUpperCase()) : null;
  }

  if (!amount) {
    const hm = lines.map((l) => l.match(/^(?:([A-Z]{3})\s*)?([$€£])?\s?(\d[\d,]*\.\d{2})\s*([A-Z]{3})?$/)).find(Boolean);
    if (hm) { amount = hm[3]; const c = hm[1] || hm[4]; currency = c || (hm[2] ? SYM[hm[2]] : null); }
  }
  const items = [];
  // Observed live: items are not a table; each has [data-testid=item-name], [data-testid=item-quantity-price-tax], .item-details.
  // Observed live 2026-11-08: each item sits in div.item-card, which holds TWO p.item-details: an empty one above the
  // name and the real description below the quantity line. Read every non-empty one, not just the first.
  document.querySelectorAll('[data-testid="item-name"]').forEach((nameEl) => {
    let box = nameEl.closest('.item-card');
    if (!box) {
      box = nameEl.parentElement;
      for (let i = 0; i < 4 && box && box.parentElement && box.parentElement.querySelectorAll('[data-testid="item-name"]').length === 1; i++) box = box.parentElement;
    }
    const q = box && box.querySelector('[data-testid="item-quantity-price-tax"]');
    const ds = box ? Array.from(box.querySelectorAll('.item-details')).map((d) => clean(d.innerText)).filter(Boolean) : [];
    items.push({ name: clean(nameEl.innerText), description: ds.length ? ds.join(' ') : null, qty_price: q ? clean(q.innerText) : null });
  });
  if (!items.length) document.querySelectorAll('tr').forEach((tr) => {
    const cells = Array.from(tr.children).map((c) => clean(c.innerText));
    if (tr.querySelector('th') || cells.length < 2 || !cells[0]) return;
    if (/^(description|item|items)$/i.test(cells[0])) return;
    const parts = cells[0].split('\n');
    items.push({ name: parts[0], description: parts.slice(1).join(' ') || null, cells });
  });

  let status = null;
  const SW = /^(?:invoice\s+|status\s*:?\s*)?(cancell?ed|due|paid|refunded|unpaid|draft|overdue|scheduled|marked as paid|partially paid|partially refunded)\.?$/i;
  for (const l of lines) {
    if (l.length <= 40 && SW.test(l)) { status = l.match(SW)[1].toUpperCase().replace('CANCELED', 'CANCELLED'); break; }
  }

  // PayPal's invoice EMAIL prints "You don't have any payments with this seller in the last year." Checked live 2026-11-08 on three
  // sandbox payer-view pages (logged out): the page itself does NOT show it. If a page does (e.g. for a logged-in payer), it is
  // used; its absence means "unknown" (null), never "familiar".
  const unfamiliarLine = /you don[’']?t have any payments? with this seller/i.test(raw);

  return {
    invoicer,
    amount,
    currency,
    items,
    note: afterLabel(NOTE_LABELS, 12),
    terms: afterLabel(['terms and conditions'], 8),
    status,
    unfamiliar_seller: unfamiliarLine ? true : null,
    raw_text: raw.slice(0, 20000),
  };
}

async function extractFromHtml(html, { chromium } = {}) {
  const { chromium: pw } = chromium ? { chromium } : require('playwright');
  const browser = await pw.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    return await page.evaluate(extractInPage);
  } finally { await browser.close(); }
}

function proxyOpts() {
  const px = process.env.HTTPS_PROXY || process.env.https_proxy;
  return px ? { proxy: { server: px } } : {};
}

// opts.routeHtml: serve this HTML for the (allowlisted) URL instead of the network (tests/fixtures only).
async function renderPayerView(url, opts = {}) {
  const chk = checkPayPalInvoiceUrl(url);
  if (!chk.ok) return chk;
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { return { ok: false, reason: 'RENDERER_UNAVAILABLE', explanation: 'Headless browser is not installed.' }; }
  let browser;
  try {
    browser = await chromium.launch(proxyOpts());
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const hostOk = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && !x.username && ALLOWED_HOSTS.has(x.hostname); } catch { return false; } };
    await page.route('**/*', (route) => {
      const req = route.request();
      if (req.isNavigationRequest() && !hostOk(req.url())) return route.abort();
      if (opts.routeHtml && req.isNavigationRequest() && req.url() === chk.url.split('#')[0]) return route.fulfill({ status: 200, contentType: 'text/html', body: opts.routeHtml });
      return route.continue();
    });
    await page.goto(chk.url, { timeout: 20000, waitUntil: 'load' });
    // Live page never reaches true network idle (analytics, payment buttons): best-effort idle, then wait for content.
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await page.waitForFunction(() => /Amount due|Note from seller|Invoice from|Cancelled|Paid/i.test(document.body.innerText), null, { timeout: 12000 }).catch(() => {});
    if (!hostOk(page.url())) return { ok: false, reason: 'NOT_PAYPAL_INVOICE_HOST', explanation: EXPLAIN };
    const ex = await page.evaluate(extractInPage);
    return { ok: true, provenance: { source: 'paypal_payer_view_render', url: chk.url, fetched_at: new Date().toISOString() }, ...ex };
  } catch (err) {
    const timeout = /Timeout/i.test(err.message);
    return { ok: false, reason: timeout ? 'RENDER_TIMEOUT' : 'RENDER_FAILED', explanation: timeout ? 'PayPal did not finish loading within 20 seconds.' : 'Could not load the page: ' + err.message.split('\n')[0] };
  } finally { if (browser) await browser.close().catch(() => {}); }
}

module.exports = { proxyOpts, renderPayerView, checkPayPalInvoiceUrl, extractFromHtml, extractInPage };
