// HangUp Gmail content script. Runs on https://mail.google.com/mail/* (and on the labelled mock-inbox demo page).
//
// What it does: when the message you have open in Gmail is a PayPal invoice or money-request email, it reads ONLY that
// message's seller-written fields (seller name, amount, note, item lines, the "no payments with this seller" line), asks the
// HangUp server whether the note is a callback scam, and shows the answer in a banner above the message body.
//
// What it never does: read, store or send any other email. A message is looked at only if its visible sender address is
// service@paypal.com or service@intl.paypal.com. The text is read only after that check, and it is sent only if it also
// has the invoice / money-request markers. No recipient address, subject, sender address, message id or Gmail URL is sent.
//
// UNVERIFIED against live Gmail. The selectors below come from Gmail DOM notes in open-source extensions (div.adn message
// wrapper, div.a3s body, span.gD[email] sender chip, h2.hP subject) and from the structure of real PayPal invoice emails
// quoted on public pages. Gmail's DOM may differ; if it does, this script finds nothing and shows nothing.
(function () {
  'use strict';

  var SENDERS = ['service@paypal.com', 'service@intl.paypal.com'];
  var BODY_SEL = 'div.a3s.aiL, div.a3s';
  var WRAP_SEL = 'div.adn, [data-legacy-message-id], [data-message-id]';
  var SENDER_SEL = 'span.gD[email], h3.iw span[email], span[email][name]';
  // Lines that end the seller's note in PayPal's email.
  var STOP = /^(invoice number|invoice date|due date|request id|reference|view and pay|view (the )?request|respond to|pay now|don.t recogni[sz]e|before paying|report this)/i;

  function lines(text) {
    return String(text || '').replace(/[ ​]/g, ' ').split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean);
  }
  function isPayPalSender(addr) { return SENDERS.indexOf(String(addr || '').trim().toLowerCase()) !== -1; }

  function money(s) {
    var m = /([$€£])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+(?:\.\d{2})?)\s*([A-Z]{3})?/.exec(s || '');
    if (!m) return { amount: null, currency: '' };
    return { amount: parseFloat(m[2].replace(/,/g, '')), currency: m[3] || ({ '$': 'USD', '€': 'EUR', '£': 'GBP' }[m[1]] || '') };
  }

  // Parse the visible text of one email body. Returns null unless it carries the invoice / money-request markers.
  function parseEmail(text) {
    var L = lines(text), i, kind = '', seller = '', head = -1;
    for (i = 0; i < L.length; i++) {
      var m = /^(.{1,200}?) sent you (an invoice|a money request)\b/i.exec(L[i]);
      if (m) { seller = m[1]; kind = /invoice/i.test(m[2]) ? 'invoice' : 'money request'; head = i; break; }
    }
    if (head < 0) return null;
    var tail = L.slice(head + 1), hasSection = tail.some(function (l) { return /^(invoice details|payment request details|amount requested)$/i.test(l); });
    if (!hasSection) return null;
    var noteAt = -1;
    for (i = 0; i < tail.length; i++) if (/^note from [^:]{1,100}:?$/i.test(tail[i])) { noteAt = i; break; }
    var note = '';
    if (noteAt >= 0) {
      var out = [];
      for (i = noteAt + 1; i < tail.length && !STOP.test(tail[i]); i++) out.push(tail[i]);
      note = out.join('\n').slice(0, 5000);
    }
    var amtAt = -1;
    for (i = 0; i < tail.length; i++) if (/^amount requested$/i.test(tail[i])) { amtAt = i; break; }
    var amt = money(amtAt >= 0 ? tail[amtAt + 1] : L[head]);
    if (amt.amount == null) amt = money(L[head]);
    // Item lines (best effort): text between "Invoice details" and the first of Amount requested / Note / Invoice number.
    var items = [], dAt = -1;
    for (i = 0; i < tail.length; i++) if (/^invoice details$/i.test(tail[i])) { dAt = i; break; }
    if (dAt >= 0) {
      var itemLines = [];
      for (i = dAt + 1; i < tail.length && !/^(amount requested|note from|invoice number)/i.test(tail[i]); i++) {
        if (/^(items?|description|qty|quantity|price|amount|unit price|[$€£]\s?[\d.,]+( [A-Z]{3})?|\d+|\d+ ?x ?[$€£]\s?[\d.,]+)$/i.test(tail[i])) continue;
        itemLines.push(tail[i]);
      }
      if (itemLines.length) items.push({ name: itemLines[0].slice(0, 300), description: itemLines.slice(1).join(' ').slice(0, 1000) });
    }
    var numAt = -1;
    for (i = 0; i < tail.length; i++) if (/^invoice number$/i.test(tail[i])) { numAt = i; break; }
    return {
      kind: kind, invoicer: seller.slice(0, 200), amount: amt.amount, currency: amt.currency, items: items, note: note, terms: '',
      invoice_number: numAt >= 0 ? (tail[numAt + 1] || '') : '',
      // The EMAIL carries this line (the payer page does not). Absent = unknown, never false.
      unfamiliar_seller: /you don[’']?t have any payments? with this seller/i.test(L.join('\n')) ? true : null
    };
  }

  // What is sent to /api/check: seller-written fields only.
  function payloadFor(p) {
    var out = { source: 'extension_gmail', invoicer: p.invoicer, amount: p.amount, currency: p.currency, items: p.items, note: p.note, terms: '', unfamiliar_seller: p.unfamiliar_seller };
    if (p.unfamiliar_seller === true) out.unfamiliar_source = 'email_line';
    return out;
  }

  globalThis.__hangupGmail = { parseEmail: parseEmail, payloadFor: payloadFor, isPayPalSender: isPayPalSender };

  // ---- everything below needs the extension runtime; skipped in tests
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage || globalThis.__HANGUP_NO_AUTORUN) return;
  var B = globalThis.__hangupBanner;
  if (!B) return; // banner.js not loaded

  function visible(el) { return !!el && el.getClientRects().length > 0; }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
  function msgId(wrap) { return (wrap && (wrap.getAttribute('data-legacy-message-id') || wrap.getAttribute('data-message-id'))) || ''; }

  // Sender address from the header chip next to this body (never from inside the body, which the sender controls).
  function senderOf(body, wrap) {
    var scope = wrap || body.parentElement, els = scope ? scope.querySelectorAll(SENDER_SEL) : [];
    for (var i = 0; i < els.length; i++) if (!body.contains(els[i])) return els[i].getAttribute('email') || '';
    return '';
  }

  var state = new WeakMap(); // body element -> { key, status, host }
  var cache = {};            // key -> successful /api/check response (this page load only)
  var stricter = false;      // Options: treat the seller as unfamiliar (only ever stricter)
  try { chrome.storage.sync.get('treatUnfamiliar', function (o) { if (!chrome.runtime.lastError && o && o.treatUnfamiliar === true) { stricter = true; scan(); } }); } catch (e) { /* default off */ }

  function show(body, st, resp, parsed, payload) {
    if (st.host) st.host.remove();
    var ex = { note: payload.note, raw: false };
    st.host = B.render(resp, ex, { email: true, what: parsed.kind, mount: body, mode: 'closed', hostId: 'hangup-gmail-banner', onDismiss: function () { st.status = 'dismissed'; } });
    st.status = 'done';
  }

  function check(body, st, parsed, payload) {
    if (cache[st.key]) { show(body, st, cache[st.key], parsed, payload); return; }
    st.status = 'pending';
    st.host = B.showBanner('none', '⏳', 'HangUp is checking this ' + parsed.kind + '…', 'Please wait before you call any number in it.', '', 'status', { mount: body, mode: 'closed', hostId: 'hangup-gmail-banner' });
    chrome.runtime.sendMessage({ type: 'hangup-check', payload: payload }, function (resp) {
      if (chrome.runtime.lastError) resp = { ok: false, status: 0, data: { error: 'EXTENSION', message: chrome.runtime.lastError.message } };
      var cur = state.get(body);
      if (!cur || cur.key !== st.key || !body.isConnected) return; // the message changed or went away meanwhile: drop the answer
      if (resp && resp.ok && resp.data && resp.data.result) cache[st.key] = resp;
      show(body, st, resp, parsed, payload);
    });
  }

  function handle(body) {
    var wrap = body.closest(WRAP_SEL), st = state.get(body);
    var addr = senderOf(body, wrap);
    if (!isPayPalSender(addr)) { // not PayPal: touch nothing, read nothing
      if (st) { if (st.host) st.host.remove(); state.delete(body); }
      return;
    }
    var text = body.innerText || '', key = msgId(wrap) + '|' + text.length + ':' + hash(text);
    if (st && st.key === key) {
      if (st.status === 'done' && st.host && !st.host.isConnected && cache[key]) show(body, st, cache[key], st.parsed, st.payload); // Gmail dropped our node: put it back
      return;
    }
    if (st && st.host) st.host.remove();
    var parsed = parseEmail(text);
    st = { key: key, status: 'ignored', host: null, parsed: parsed };
    state.set(body, st);
    if (!parsed || (!parsed.note && !parsed.items.length)) return; // not an invoice / money request, or nothing seller-written to check
    var payload = payloadFor(parsed);
    if (stricter && payload.unfamiliar_seller !== true) { payload.unfamiliar_seller = true; payload.unfamiliar_source = 'user_setting'; }
    st.payload = payload;
    check(body, st, parsed, payload);
  }

  var pending = null;
  function scan() {
    pending = null;
    var bodies = document.querySelectorAll(BODY_SEL), n = 0;
    for (var i = 0; i < bodies.length && n < 20; i++) {
      var b = bodies[i];
      if (!visible(b)) continue; // Gmail keeps previously opened messages in the DOM, hidden
      n++;
      try { handle(b); } catch (e) { /* never break Gmail */ }
    }
  }
  function schedule() { if (pending == null) pending = setTimeout(scan, 350); }

  new MutationObserver(schedule).observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] });
  window.addEventListener('hashchange', schedule);
  scan();
})();
