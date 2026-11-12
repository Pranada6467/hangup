'use strict';
// Deterministic verdict from the LLM form + code-extracted features. The LLM never decides.
const { normalise } = require('./normalise');
const { llmJudge } = require('./judge');

const SCAM_ADVICE = [
  "Don't call the number in this invoice.",
  'An invoice is a request, not a charge. Nothing has been taken from you.',
  "If you're worried, log in at paypal.com yourself (type it in) and check Activity.",
  'Report it: forward the email to phishing@paypal.com.',
];
const SUSPICIOUS_ADVICE = [
  "Don't call any number printed in this invoice until you have checked it another way.",
  'An invoice is a request, not a charge. You do not have to pay or call.',
  'Log in at paypal.com yourself (type it in) and look at Activity, or ask the seller using contact details you already trust.',
];
const NONE_ADVICE = [
  'This check only looks for one trick (a phone number you are told to call). It does not prove an invoice is genuine.',
  'If you do not recognise the seller or the purchase, do not pay. Check Activity at paypal.com (type it in yourself).',
];

// ---- unfamiliar-seller signal (optional context; null/undefined/false = behave exactly as before) ----
// "Bare" text = the invoice says almost nothing beyond a number: at most BARE_MAX_WORDS words of note/terms/items once
// phone numbers are removed, and no item that names goods or a service (2+ words). An honest FIRST invoice from a new
// seller normally says what it is for, so it is never bare. The signal only ever ADDS suspicion; it cannot lower a verdict.
const BARE_MAX_WORDS = 10;
function substanceOf(nf) {
  const strip = (s) => String(s == null ? '' : s).replace(/\+?\(?\d[\d\s().\-]{5,}\d/g, ' ');
  const wc = (s) => (strip(s).match(/[\p{L}\p{N}']+/gu) || []).length;
  const itemWords = (nf.items || []).reduce((a, i) => a + wc(i.name) + wc(i.description), 0);
  const inv = wc(nf.invoicer); // a long "seller name" is a message hidden in the name field
  return { words: wc(nf.note) + wc(nf.terms) + wc(nf.declared_contact) + itemWords + (inv > 6 ? inv : 0), describes_goods: itemWords >= 2 };
}

function decide(form, norm, ctx = {}) {
  const f = form || {};
  const n = norm || { hasPhone: false, hasUrl: false, phones: [] };
  const reasons = [];
  const brandMismatch = !!f.brand_impersonated && f.brand_matches_invoicer === false;
  const contactish = !!(n.hasPhone || f.callback_demanded);
  // Scam needs the LLM's overall reading AND at least one concrete signal, so a single flipped field cannot convict.
  const concrete = !!f.disputes_unrecognised_charge || brandMismatch || !!f.remote_access_or_refund_hint;
  const scam = contactish && !!f.callback_demanded && !!f.looks_like_callback_scam && concrete;

  if (n.hasPhone) reasons.push('PHONE_IN_TEXT');
  if (f.callback_demanded) reasons.push('CALLBACK_DEMANDED');
  if (f.disputes_unrecognised_charge) reasons.push('UNRECOGNISED_CHARGE');
  if (brandMismatch) reasons.push('BRAND_MISMATCH');
  if (f.remote_access_or_refund_hint) reasons.push('REMOTE_ACCESS_OR_REFUND');
  if (f.urgency_deadline) reasons.push('URGENCY');
  if (f.payment_outside_paypal) reasons.push('PAYMENT_OUTSIDE_PAYPAL');
  if (f.injection_attempt) reasons.push('INJECTION_ATTEMPT');

  // A brand that differs from the invoicer plus a phone number is also what an honest reseller looks like
  // ("your Norton renewal, call me to cancel"). It only raises SUSPICIOUS when the LLM's own reading agrees:
  // it thinks the text is a callback scam, or it is written for a reader who did not order anything.
  // ctx.legacyBrandPhone reproduces the pre-8-Nov rule (any brand mismatch + phone). Eval ablation only.
  const brandPhoneConcern = brandMismatch && n.hasPhone && (ctx.legacyBrandPhone || !!(f.looks_like_callback_scam || f.disputes_unrecognised_charge));

  // Unfamiliar seller (ctx.unfamiliar_seller === true) + bare text. Needs a number, or a payment-outside-PayPal / urgency cue.
  // Escalates to LIKELY only with the LLM's own scam reading or a concrete signal alongside. Never fires on null/false.
  const sub = ctx.substance;
  const bare = ctx.unfamiliar_seller === true && !!sub && !sub.describes_goods && sub.words <= BARE_MAX_WORDS;
  const bareContact = bare && n.hasPhone;
  const bareLikely = (bareContact && (!!f.looks_like_callback_scam || concrete)) || (bare && !!f.payment_outside_paypal);
  const bareSuspicious = bareContact || (bare && !!f.urgency_deadline);
  if (bareLikely || bareSuspicious) reasons.push('UNFAMILIAR_SELLER');

  let verdict;
  if (scam || bareLikely) verdict = 'LIKELY_CALLBACK_SCAM';
  else if (bareSuspicious || f.injection_attempt || f.payment_outside_paypal || brandPhoneConcern ||
    (f.callback_demanded && f.remote_access_or_refund_hint) ||
    (contactish && f.callback_demanded && (f.looks_like_callback_scam || (concrete && f.urgency_deadline)))) verdict = 'SUSPICIOUS';
  else verdict = 'NO_CALLBACK_PATTERN';

  const headline = {
    LIKELY_CALLBACK_SCAM: 'Likely callback scam: this invoice is trying to get you to phone a number',
    SUSPICIOUS: 'Suspicious: parts of this invoice look like a callback scam',
    NO_CALLBACK_PATTERN: "No callback-scam pattern found in this invoice's text",
  }[verdict];
  const advice = { LIKELY_CALLBACK_SCAM: SCAM_ADVICE, SUSPICIOUS: SUSPICIOUS_ADVICE, NO_CALLBACK_PATTERN: NONE_ADVICE }[verdict].slice();
  return { verdict, reasons, headline, advice };
}

// ---- evidence spans: map quotes (verbatim from NORMALISED text) back onto the ORIGINAL fields ----
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DASH_CLASS = '[-\\u2010-\\u2015\\u2212\\ufe58\\ufe63\\uff0d]';
function fuzzy(str) { // whitespace- and dash-tolerant literal pattern
  return str.split(/(\s+|[-\u2010-\u2015\u2212\ufe58\ufe63\uff0d])/).map((p) => (/^\s+$/.test(p) ? '\\s+' : /^[-\u2010-\u2015\u2212\ufe58\ufe63\uff0d]$/.test(p) ? DASH_CLASS : reEsc(p))).join('');
}
function phonePattern(canon) { // +15035550173 -> digits with optional separators between them
  return '\\+?\\(?' + canon.replace(/\D/g, '').split('').join('[\\s().\\-\\u2010-\\u2015]{0,3}');
}
function quotePattern(quote, reps) {
  const canons = [...new Set(reps.map((r) => r.canonical))].sort((a, b) => b.length - a.length);
  if (!canons.length) return fuzzy(quote);
  const split = new RegExp('(' + canons.map(reEsc).join('|') + ')', 'g');
  return quote.split(split).map((piece) => {
    if (!canons.includes(piece)) return fuzzy(piece);
    const origs = [...new Set(reps.filter((r) => r.canonical === piece).map((r) => r.original))];
    return '(?:' + [...origs.map(fuzzy), phonePattern(piece)].join('|') + ')';
  }).join('');
}
function evidenceSpans(quotes, fieldList) { // fieldList: [{field, original, reps}]
  const spans = [], seen = new Set();
  const allReps = fieldList.flatMap((f) => f.reps);
  for (const q of quotes || []) {
    const quote = String(q || '').trim();
    if (quote.length < 3) continue;
    let re;
    try { re = new RegExp(quotePattern(quote, allReps), 'i'); } catch { continue; }
    for (const f of fieldList) {
      const m = f.original ? re.exec(f.original) : null;
      if (!m || !m[0]) continue;
      const key = f.field + ':' + m.index + ':' + m[0].length;
      if (!seen.has(key)) { seen.add(key); spans.push({ field: f.field, start: m.index, end: m.index + m[0].length, text: m[0] }); }
      break;
    }
  }
  return spans;
}

// fields = {invoicer, amount, currency, items:[{name,description}], note, terms, declared_contact}
async function checkInvoice(fields, opts = {}) {
  const f = fields || {};
  const n = (s) => normalise(s == null ? '' : s);
  const parts = {
    invoicer: n(f.invoicer), note: n(f.note), terms: n(f.terms), declared: n(f.declared_contact),
    items: (f.items || []).map((it) => ({ name: n(it.name), description: n(it.description) })),
  };
  const nf = {
    invoicer: parts.invoicer.text, amount: f.amount, currency: f.currency,
    items: parts.items.map((it) => ({ name: it.name.text, description: it.description.text })),
    note: parts.note.text, terms: parts.terms.text,
    declared_contact: f.declared_contact ? parts.declared.text : undefined,
  };
  const all = [parts.invoicer, parts.note, parts.terms, parts.declared, ...parts.items.flatMap((i) => [i.name, i.description])];
  const uniq = (k) => [...new Set(all.flatMap((p) => p[k]))];
  const phones = uniq('phones'), urls = uniq('urls'), emails = uniq('emails');
  const norm = { phones, urls, emails, hasPhone: phones.length > 0, hasUrl: urls.length > 0 };
  const sourceText = [nf.invoicer, ...nf.items.flatMap((i) => [i.name, i.description]), nf.note, nf.terms, nf.declared_contact]
    .filter(Boolean).join('\n');
  const judged = await (opts.judge || llmJudge)(nf, { ...opts, sourceText });
  const ctx = { ...(opts.ctx || {}), substance: substanceOf(nf) };
  const d = decide(judged.form, norm, ctx);
  const str = (v) => (v == null ? '' : String(v));
  const fieldList = [
    { field: 'note', original: str(f.note), reps: parts.note.replacements },
    { field: 'terms', original: str(f.terms), reps: parts.terms.replacements },
    ...(f.items || []).flatMap((it, i) => [
      { field: 'item_name', original: str(it.name), reps: parts.items[i].name.replacements },
      { field: 'item_description', original: str(it.description), reps: parts.items[i].description.replacements }]),
    { field: 'invoicer', original: str(f.invoicer), reps: parts.invoicer.replacements },
  ];
  const evidence_spans = evidenceSpans(judged.form.evidence_quotes, fieldList);
  return {
    verdict: d.verdict, headline: d.headline, advice: d.advice, reasons: d.reasons,
    evidence: judged.form.evidence_quotes, evidence_spans, form: judged.form,
    features: { phones, urls, emails }, legacy_verdict: decide(judged.form, norm, { legacyBrandPhone: true }).verdict, unfamiliar_seller: (opts.ctx && opts.ctx.unfamiliar_seller) === true ? true : (opts.ctx && opts.ctx.unfamiliar_seller) === false ? false : null, model: judged.model, latency_ms: judged.latency_ms, usage: judged.usage,
  };
}

module.exports = { decide, checkInvoice, evidenceSpans, substanceOf, BARE_MAX_WORDS };
