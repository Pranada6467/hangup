// HangUp banner: shared by content.js (PayPal payer page) and gmail.js (open PayPal email). Loaded first (see manifest).
(function () {
  'use strict';
  var STYLE = [
    ':host{all:initial}',
    '.bar{position:fixed;top:0;left:0;right:0;z-index:2147483647;font:18px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;border-bottom:4px solid;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3)}',
    '.scam{background:#fdecea;border-color:#b3261e;color:#5c0b07}.sus{background:#fff4d6;border-color:#a65f00;color:#4a2b00}.none{background:#eceff1;border-color:#546270;color:#1f2a33}',
    '.in{max-width:900px;margin:0 auto;display:flex;gap:14px;align-items:flex-start}.ic{font-size:30px;line-height:1}',
    '.main{flex:1}.h{font-size:22px;font-weight:700;margin:0 0 4px}.p{margin:0 0 6px}',
    'button{font:inherit;cursor:pointer;border:2px solid currentColor;background:transparent;color:inherit;border-radius:8px;padding:4px 12px;margin-right:8px}',
    'button:focus-visible{outline:3px solid #0b57d0;outline-offset:2px}',
    '.x{font-size:22px;line-height:1;padding:2px 10px;margin:0}',
    '.why{margin-top:8px}.why[hidden]{display:none}.why ul{margin:6px 0 6px 20px;padding:0}mark{background:#ffe58a;color:#000;padding:0 2px}.note{white-space:pre-wrap;overflow-wrap:anywhere;background:rgba(255,255,255,.55);border-radius:6px;padding:8px}',
    '.small{font-size:15px;opacity:.9}'
  ].join('');
  // Inside a mail body: in the page flow, not fixed to the window.
  var INLINE_STYLE = '.bar{position:static;margin:0 0 12px;border:2px solid;border-left-width:8px;border-radius:8px;box-shadow:none;font-size:16px}.h{font-size:19px}';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // opts (all optional): mount = element the banner is inserted before (default: fixed bar on <html>), mode = 'open'|'closed' shadow root,
  // hostId, replace = an earlier host to remove, onDismiss. Returns the host element.
  function showBanner(cls, icon, head, body, whyHtml, role, opts) {
    opts = opts || {};
    var old = opts.replace || (!opts.mount && document.getElementById('hangup-banner-host')); if (old) old.remove();
    var host = document.createElement('div'); host.id = opts.hostId || 'hangup-banner-host';
    var sr = host.attachShadow({ mode: opts.mode || 'open' });
    sr.innerHTML = '<style>' + STYLE + (opts.mount ? INLINE_STYLE : '') + '</style><div class="bar ' + cls + '" role="' + (role || 'alert') + '"><div class="in"><div class="ic" aria-hidden="true">' + icon + '</div><div class="main">' +
      '<p class="h">' + esc(head) + '</p><p class="p">' + esc(body) + '</p>' +
      (whyHtml ? '<button type="button" class="whyb" aria-expanded="false">Why?</button>' : '') +
      '<div class="why" hidden>' + (whyHtml || '') + '</div>' +
      '<p class="small">HangUp is an independent tool, not made by PayPal. It cannot tell you an invoice is genuine.</p></div>' +
      '<button type="button" class="x" aria-label="Dismiss HangUp warning">\u00d7</button></div></div>';
    var wb = sr.querySelector('.whyb'), why = sr.querySelector('.why');
    if (wb) wb.onclick = function () { var open = why.hasAttribute('hidden'); if (open) why.removeAttribute('hidden'); else why.setAttribute('hidden', ''); wb.setAttribute('aria-expanded', String(open)); };
    sr.querySelector('.x').onclick = function () { host.remove(); if (opts.onDismiss) opts.onDismiss(); };
    if (opts.mount) opts.mount.parentNode.insertBefore(host, opts.mount); else document.documentElement.appendChild(host);
    return host;
  }

  // Plain-language reason labels (mirrors src/labels.js; a test keeps them in step).
  var REASONS = {
    en: {
      PHONE_IN_TEXT: 'It contains a phone number',
      CALLBACK_DEMANDED: 'It tells you to phone them',
      UNRECOGNISED_CHARGE: 'It talks about a charge you may not have made',
      BRAND_MISMATCH: "It names a company that isn't the sender",
      REMOTE_ACCESS_OR_REFUND: 'It mentions remote access or a refund',
      URGENCY: 'It pushes you to act fast',
      PAYMENT_OUTSIDE_PAYPAL: 'It asks for payment outside PayPal',
      INJECTION_ATTEMPT: 'It contains hidden instructions aimed at checkers',
      UNFAMILIAR_SELLER: 'You have not paid this seller before, and the invoice says almost nothing except a number',
    },
    es: {
      PHONE_IN_TEXT: 'Contiene un número de teléfono',
      CALLBACK_DEMANDED: 'Le dice que los llame por teléfono',
      UNRECOGNISED_CHARGE: 'Habla de un cargo que quizá usted no hizo',
      BRAND_MISMATCH: 'Nombra a una empresa que no es quien lo envía',
      REMOTE_ACCESS_OR_REFUND: 'Menciona acceso remoto o un reembolso',
      URGENCY: 'Le presiona para que actúe rápido',
      PAYMENT_OUTSIDE_PAYPAL: 'Le pide pagar fuera de PayPal',
      INJECTION_ATTEMPT: 'Contiene instrucciones ocultas dirigidas a los verificadores',
      UNFAMILIAR_SELLER: 'Usted no le ha pagado antes a este vendedor, y la factura casi no dice nada salvo un número',
    },
    fr: {
      PHONE_IN_TEXT: 'Il contient un numéro de téléphone',
      CALLBACK_DEMANDED: 'Il vous demande de les appeler',
      UNRECOGNISED_CHARGE: 'Il parle d\'un débit que vous n\'avez peut-être pas fait',
      BRAND_MISMATCH: 'Il cite une entreprise qui n\'est pas l\'expéditeur',
      REMOTE_ACCESS_OR_REFUND: 'Il mentionne un accès à distance ou un remboursement',
      URGENCY: 'Il vous pousse à agir vite',
      PAYMENT_OUTSIDE_PAYPAL: 'Il demande un paiement en dehors de PayPal',
      INJECTION_ATTEMPT: 'Il contient des instructions cachées visant les outils de vérification',
      UNFAMILIAR_SELLER: 'Vous n\'avez jamais payé ce vendeur, et la facture ne dit presque rien à part un numéro',
    },
  };
  var UI = {
    en: { noticed: 'What we noticed:', says: 'What the note says:', todo: 'What to do:' },
    es: { noticed: 'Lo que notamos:', says: 'Lo que dice la nota:', todo: 'Qué hacer:' },
    fr: { noticed: 'Ce que nous avons remarqué :', says: 'Ce que dit la note :', todo: 'Que faire :' }
  };
  var LANG = (function () { var l = String((typeof navigator !== 'undefined' && navigator.language) || 'en').slice(0, 2); return REASONS[l] ? l : 'en'; })();
  function reasonText(c) { return REASONS[LANG][c] || REASONS.en[c] || c; }

  function noteHtml(text, spans) {
    text = String(text || '');
    var rs = (spans || []).filter(function (x) { return x.field === 'note' && x.end > x.start && x.end <= text.length; }).map(function (x) { return [x.start, x.end]; }).sort(function (a, b) { return a[0] - b[0]; });
    var out = '', pos = 0;
    rs.forEach(function (r) { if (r[0] < pos) return; out += esc(text.slice(pos, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>'; pos = r[1]; });
    return out + esc(text.slice(pos));
  }

  function whyHtml(r, ex) {
    var h = '', u = UI[LANG], f = r.form || {};
    if (f.explanation_plain) h += '<p><strong>' + esc(f.explanation_plain) + '</strong></p>';
    if (r.reasons && r.reasons.length) h += '<p>' + esc(u.noticed) + '</p><ul>' + r.reasons.map(function (c) { return '<li>' + esc(reasonText(c)) + '</li>'; }).join('') + '</ul>';
    if (Array.isArray(r.evidence_spans) && ex && ex.note && !ex.raw) {
      if (r.evidence_spans.length) h += '<p>' + esc(u.says) + '</p><p class="note">' + noteHtml(ex.note, r.evidence_spans) + '</p>';
    } else if (r.evidence && r.evidence.length) h += '<p>' + esc(u.says) + '</p><ul>' + r.evidence.map(function (s) { return '<li><mark>' + esc(s) + '</mark></li>'; }).join('') + '</ul>';
    if (r.advice && r.advice.length) h += '<p>' + esc(u.todo) + '</p><ul>' + r.advice.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
    if (ex && ex.raw) h += '<p class="small">HangUp could not find the note field on this page, so it read all visible text. Results may be less precise.</p>';
    return h;
  }

  // opts.email = true: the text came from an email, not a PayPal page; opts.what = 'invoice' | 'money request'. Other opts go to showBanner.
  function render(resp, ex, opts) {
    opts = opts || {};
    var what = opts.what || 'invoice', src = opts.email ? 'email' : 'page';
    var d = resp && resp.data;
    if (!resp || !resp.ok || !d || d.error || !d.result) {
      var code = (d && d.error) || (resp && resp.status ? 'HTTP_' + resp.status : 'NETWORK');
      return showBanner('sus', '\u26a0\ufe0f', 'HangUp could not check this ' + (opts.email ? 'email' : 'invoice'), ((d && d.message) || 'The HangUp server did not answer.') + ' That does not mean the ' + what + ' is fine. Do not call any number in it until you have checked another way. (' + code + ')', '', 'status', opts);
    }
    var r = d.result;
    var by = opts.email ? 'The note in this email was written by the sender of the ' + what + ', not by PayPal.' : 'The note was written by the sender, not PayPal.';
    if (r.verdict === 'LIKELY_CALLBACK_SCAM') return showBanner('scam', '\ud83d\uded1', "Don't call the number in this " + what + ".", opts.email ? by : 'This is a real PayPal page, but the note was written by the sender, not PayPal.', whyHtml(r, ex), 'alert', opts);
    if (r.verdict === 'SUSPICIOUS') return showBanner('sus', '\u26a0\ufe0f', 'Be careful with this ' + what + '.', (opts.email ? by : 'The note was written by the sender, not PayPal.') + ' ' + (((r.form || {}).explanation_plain) || 'Parts of it look like a callback scam.'), whyHtml(r, ex), 'alert', opts);
    return showBanner('none', '\u2139\ufe0f', "No callback-scam pattern found in this " + what + "'s note.", 'This is only one check on the sender\'s text. It is not a guarantee about the ' + what + '.', whyHtml(r, ex), 'status', opts);
  }

  globalThis.__hangupBanner = { render: render, showBanner: showBanner, whyHtml: whyHtml, esc: esc };
})();
