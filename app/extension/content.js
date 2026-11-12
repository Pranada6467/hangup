// HangUp content script. Runs on PayPal payer-view invoice pages.
// Extraction anchors on stable parts of the real payer-view DOM (verified against the sandbox page, 2026-11-05):
// h2 / p.merchant-info-line-item (invoicer), p.invoice-title, p.label "Note from seller" + next p, [data-testid=item-name],
// p.item-details, "Terms and conditions" + next p, "Amount due" h4 + h3. Hashed class names (_1bqdmvk3) are NOT used.
// If the note is not found it falls back to the page's visible text.
(function () {
  'use strict';

  var LABELS = {
    note: /^(note|notes|message|note to (recipient|customer)|memo|seller note|message from (the )?(seller|merchant))$/i,
    terms: /^(terms( and conditions| & conditions)?|terms of service)$/i,
    invoicer: /^(from|invoice from|billed by|merchant|seller|sent by|business name)$/i,
    amount: /^(amount due|total|balance due|total due|amount|invoice total)$/i
  };

  function clean(s) { return String(s == null ? '' : s).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }
  function txt(el) { return clean(el && (el.innerText != null ? el.innerText : el.textContent)); }

  // Find the value that sits next to an element whose entire text is a label.
  function valueAfterLabel(root, re) {
    var els = root.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.closest && el.closest('#hangup-banner-host')) continue;
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      var own = txt(el).replace(/\s*:\s*$/, '');
      if (own.length > 40 || !re.test(own)) continue;
      // label element; value = next sibling, or next sibling of an ancestor (up to 3 levels)
      var cur = el;
      for (var up = 0; up < 3 && cur && cur !== root; up++) {
        var sib = cur.nextElementSibling;
        while (sib && !txt(sib)) sib = sib.nextElementSibling;
        if (sib) return txt(sib);
        cur = cur.parentElement;
      }
      // "Label: value" inside a single parent
      var par = el.parentElement;
      if (par) { var pt = txt(par), lt = txt(el); if (pt.length > lt.length) return clean(pt.slice(pt.indexOf(lt) + lt.length).replace(/^\s*:\s*/, '')); }
    }
    return '';
  }

  function parseAmount(text) {
    var m = /(?:amount due|balance due|total due|invoice total|total)[^\d$€£]{0,40}([$€£])?\s?(\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{2})|\d+(?:\.\d{2})?)\s*([A-Z]{3})?/i.exec(text);
    if (!m) { m = /([$€£])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})\s*([A-Z]{3})?/.exec(text); if (!m) return { amount: null, currency: '' }; m = [m[0], m[1], m[2], m[3]]; }
    var num = parseFloat(String(m[2]).replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
    var cur = m[3] || ({ '$': 'USD', '€': 'EUR', '£': 'GBP' }[m[1]] || '');
    return { amount: isNaN(num) ? null : num, currency: cur };
  }

  function extractItems(root) {
    var items = [];
    root.querySelectorAll('tr').forEach(function (tr) {
      if (tr.closest('#hangup-banner-host')) return;
      var cells = tr.querySelectorAll('td');
      if (cells.length < 2) return;
      var first = cells[0];
      var name = txt(first.querySelector('strong,b,.item-name,[data-item-name]') || first.firstElementChild || first);
      var full = txt(first);
      var desc = clean(full.replace(name, ''));
      if (name) items.push({ name: name.slice(0, 300), description: desc.slice(0, 1000) });
    });
    root.querySelectorAll('[data-hangup-item], .invoice-item, [class*="line-item"], [class*="lineItem"]').forEach(function (el) {
      var t = txt(el); if (t && !items.some(function (i) { return t.indexOf(i.name) === 0; })) items.push({ name: t.split('\n')[0].slice(0, 300), description: t.split('\n').slice(1).join(' ').slice(0, 1000) });
    });
    return items;
  }


  function ownTextIs(el, re) { return re.test(txt(el)) && el.children.length === 0; }
  // Real DOM: a leaf element whose whole text is the label; the value is the next non-empty sibling (or the next one after a parent hop).
  function nextAfterLeafLabel(root, re, tags) {
    var els = root.querySelectorAll(tags || 'p,h4,h3,span,div');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.closest('#hangup-banner-host') || !ownTextIs(el, re)) continue;
      var cur = el;
      for (var up = 0; up < 2 && cur && cur !== root; up++) {
        var sib = cur.nextElementSibling;
        while (sib && !txt(sib)) sib = sib.nextElementSibling;
        if (sib) return txt(sib);
        cur = cur.parentElement;
      }
    }
    return '';
  }
  function firstText(root, sel) {
    var el = root.querySelector(sel);
    return el && !el.closest('#hangup-banner-host') ? txt(el) : '';
  }
  function extractItemsReal(root) {
    var out = [];
    var names = root.querySelectorAll('[data-testid="item-name"]');
    names.forEach(function (n, idx) {
      // Live layout (2026-11-08): div.item-card with an EMPTY p.item-details above the name and the real one below.
      var box = n.closest('.item-card');
      if (!box) {
        box = n.parentElement;
        for (var i = 0; i < 4 && box && box.parentElement && box.parentElement.querySelectorAll('[data-testid="item-name"]').length === 1; i++) box = box.parentElement;
      }
      var ds = box ? Array.prototype.map.call(box.querySelectorAll('.item-details'), txt).filter(Boolean) : [];
      var q = box && box.querySelector('[data-testid="item-quantity-price-tax"]');
      out.push({ name: txt(n).slice(0, 300), description: ds.join(' ').slice(0, 1000), qty_price: q ? txt(q) : '' });
    });
    return out;
  }
  function extractStatus(root) {
    var SW = /^(cancell?ed|due|paid|refunded|unpaid|draft|overdue|scheduled|marked as paid|partially paid|partially refunded)$/i;
    var els = root.querySelectorAll('.status-container,p,span,div'); // live page: badge sits in div.status-container
    for (var i = 0; i < els.length; i++) { if ((els[i].children.length === 0 || els[i].classList.contains('status-container')) && SW.test(txt(els[i]))) return txt(els[i]).toUpperCase().replace('CANCELED', 'CANCELLED'); }
    return '';
  }
  function dismissCookies(doc) { var b = doc.getElementById('acceptAllButton'); if (b) b.click(); }

  function extract(doc) {
    doc = doc || document;
    var root = doc.body || doc.documentElement;
    var bodyText = txt(root);
    // Real payer-view anchors first, generic label heuristics second.
    var note = nextAfterLeafLabel(root, /^note from (the )?seller$/i, 'p') || valueAfterLabel(root, LABELS.note);
    var terms = nextAfterLeafLabel(root, /^terms and conditions$/i, 'p') || valueAfterLabel(root, LABELS.terms);
    var invoicer = firstText(root, '.merchant-info-line-item') || firstText(root, 'h2');
    if (!invoicer) invoicer = valueAfterLabel(root, LABELS.invoicer);
    if (!invoicer) { var h = root.querySelector('h1'); invoicer = h ? txt(h) : ''; }
    var invoiceNumber = (firstText(root, 'p.invoice-title').match(/#\s*(\S+)/) || [])[1] || '';
    var amtText = nextAfterLeafLabel(root, /^amount due$/i, 'h4') || firstText(root, 'h2.text-elem') || valueAfterLabel(root, LABELS.amount);
    var a = parseAmount(amtText ? 'Total ' + amtText : bodyText);
    var items = extractItemsReal(root);
    if (!items.length) items = extractItems(root);
    var out = {
      source: 'extension_dom', page_url: (doc.location && doc.location.href) || '',
      invoicer: invoicer.slice(0, 200), amount: a.amount, currency: a.currency, items: items.slice(0, 50),
      note: (note || '').slice(0, 5000), terms: (terms || '').slice(0, 5000),
      invoice_number: invoiceNumber, status: extractStatus(root),
      // Only true when the page itself says so (PayPal's email does; the logged-out payer page was checked and does not). Absence = unknown.
      unfamiliar_seller: /you don[\u2019']?t have any payments? with this seller/i.test(bodyText) ? true : null
    };
    if (out.unfamiliar_seller === true) out.unfamiliar_source = 'payer_page_line';
    if (!out.note) { out.note = bodyText.slice(0, 6000); out.raw = true; } // structure not found: send everything visible
    return out;
  }
  globalThis.__hangupExtract = extract;

  // ---- everything below needs the extension runtime; skipped in tests
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage || globalThis.__HANGUP_NO_AUTORUN) return;

  var render = globalThis.__hangupBanner && globalThis.__hangupBanner.render;
  if (!render) return; // banner.js not loaded

  function run() {
    dismissCookies(document); // consent banner only; nothing else on the page is touched
    var ex = extract(document);
    var send = function () { chrome.runtime.sendMessage({ type: 'hangup-check', payload: ex }, function (resp) {
      if (chrome.runtime.lastError) { render({ ok: false, status: 0, data: { error: 'EXTENSION', message: chrome.runtime.lastError.message } }, ex); return; }
      render(resp, ex);
    }); };
    // Optional, off by default (Options): treat a seller as unfamiliar when the page does not say. Only ever makes HangUp stricter.
    try {
      chrome.storage.sync.get('treatUnfamiliar', function (o) {
        if (!chrome.runtime.lastError && o && o.treatUnfamiliar === true && ex.unfamiliar_seller !== true) ex.unfamiliar_seller = true;
        send();
      });
    } catch (e) { send(); }
  }

  // Wait for the (probably client-rendered) page: up to 15s, then settle 800ms after the last mutation.
  var done = false, settle = null, started = Date.now();
  function ready() { var t = txt(document.body); return t.length > 200 && (/note|invoice/i.test(t)); }
  function go() { if (done) return; done = true; mo.disconnect(); clearTimeout(settle); run(); }
  var mo = new MutationObserver(function () {
    clearTimeout(settle);
    if (ready()) settle = setTimeout(go, 800);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (ready()) settle = setTimeout(go, 800);
  setTimeout(go, Math.max(0, 15000 - (Date.now() - started)));
})();
