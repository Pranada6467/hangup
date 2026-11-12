'use strict';
// Baselines B0 (phone-or-URL), B1 (keyword + regex), B2 (TF-IDF + logistic regression, plain JS).
// None of them use the normaliser: that is the point of comparison (obfuscation, other languages).

function textOf(f) {
  f = f || {};
  return [f.invoicer, ...(f.items || []).flatMap((i) => [i.name, i.description]), f.note, f.terms, f.declared_contact]
    .filter(Boolean).join('\n');
}

// ---- B0 ----
const B0_PHONE = /(?:\+?\d{1,2}[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/;
const B0_URL = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|info|biz|support|help|xyz)\b/i;
function b0(fields) {
  const t = textOf(fields);
  return B0_PHONE.test(t) || B0_URL.test(t);
}

// ---- B1 ----
// Lenient phone shape: 10+ digits with optional separators between each digit.
const B1_PHONE = /(?:\+?\d[\s.\-()]*){10,15}/;
const ACTION = /\b(call|calling|phone|dial|ring|contact|reach|text|whatsapp|llame|llamar|llama|comun[ií]quese|contacte|appelez|appeler|contactez|t[eé]l[eé]phonez)\b/i;
const TOPIC = new RegExp([
  'support', 'billing', 'help ?(?:line|desk)', 'customer (?:care|service)', 'fraud (?:dept|department|team)', 'refund',
  'cancel', 'dispute', 'unauthori[sz]ed', 'did not (?:authori[sz]e|make|order|purchase)', "didn't (?:authori[sz]e|order|make)",
  'renewal', 'auto[- ]?renew', 'subscription', 'was charged', 'has been charged', 'will be charged', 'charged',
  'overpa(?:id|yment)', 'wrongly', 'not you', 'if you did not', 'if this was not',
  'soporte', 'facturaci[oó]n', 'reembolso', 'cancelar', 'cargo no autorizado', 'no autoriz', 'no reconoce', 'renovaci[oó]n', 'suscripci[oó]n',
  'assistance', 'service client', 'remboursement', 'annuler', 'non autoris', 'renouvellement', 'abonnement', 'pr[eé]l[eè]vement',
].join('|'), 'i');
const BRAND = /\b(geek ?squad|norton|mcafee|lifelock|avast|kaspersky|malwarebytes|best ?buy|amazon|microsoft|windows|apple|icloud|paypal|coinbase|binance|crypto\.com|metamask|ledger|trezor|geico|walmart|costco|visa|mastercard|dell|hp support|webroot|totalav|bitdefender)\b/i;
const RISKY = /\b(bitcoin|btc|crypto|gift ?cards?|anydesk|teamviewer|ultraviewer|logmein|remote (?:access|desktop|session|support)|screen ?shar\w*|wire transfer|zelle|tarjeta de regalo|acceso remoto|carte cadeau|acc[eè]s [aà] distance)\b/i;

function b1(fields) {
  const t = String(textOf(fields)).normalize('NFKC');
  const phone = B1_PHONE.test(t);
  const action = ACTION.test(t);
  const topic = TOPIC.test(t);
  const brand = BRAND.test(t);
  const risky = RISKY.test(t);
  if (phone && action && (topic || risky)) return true;
  if (phone && brand && (topic || risky)) return true;
  if (action && risky && (topic || brand)) return true;
  return false;
}

// ---- B2: TF-IDF + logistic regression ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function featureNames(text) {
  const t = String(text).normalize('NFKC').toLowerCase();
  const out = [];
  const words = t.match(/[\p{L}\p{N}]+/gu) || [];
  for (let i = 0; i < words.length; i++) {
    out.push('w:' + words[i]);
    if (i + 1 < words.length) out.push('b:' + words[i] + ' ' + words[i + 1]);
  }
  const s = ' ' + t.replace(/\s+/g, ' ') + ' ';
  for (let n = 3; n <= 5; n++) for (let i = 0; i + n <= s.length; i++) out.push('c:' + s.slice(i, i + n));
  return out;
}

function counts(text) {
  const m = new Map();
  for (const f of featureNames(text)) m.set(f, (m.get(f) || 0) + 1);
  return m;
}

function fitLR(docs, labels, opts = {}) {
  const minDf = opts.minDf || 2, epochs = opts.epochs || 30, lambda = opts.lambda || 2e-6;
  const df = new Map();
  const cs = docs.map(counts);
  for (const c of cs) for (const k of c.keys()) df.set(k, (df.get(k) || 0) + 1);
  const vocab = new Map(); const idf = [];
  const N = docs.length;
  for (const [k, d] of df) if (d >= minDf) { vocab.set(k, vocab.size); idf.push(Math.log((1 + N) / (1 + d)) + 1); }
  const vec = (c) => {
    const idx = [], val = [];
    let norm = 0;
    for (const [k, v] of c) {
      const j = vocab.get(k);
      if (j === undefined) continue;
      const x = (1 + Math.log(v)) * idf[j];
      idx.push(j); val.push(x); norm += x * x;
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < val.length; i++) val[i] /= norm;
    return { idx, val };
  };
  const X = cs.map(vec);
  const w = new Float64Array(vocab.size);
  let b = 0;
  const pos = labels.filter(Boolean).length, neg = N - pos;
  const cw = [N / (2 * Math.max(1, neg)), N / (2 * Math.max(1, pos))];
  const rnd = mulberry32(opts.seed || 42);
  const order = [...Array(N).keys()];
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const lr = 2.0 / (1 + 0.15 * ep);
    for (const i of order) {
      const { idx, val } = X[i];
      let z = b;
      for (let k = 0; k < idx.length; k++) z += w[idx[k]] * val[k];
      const p = 1 / (1 + Math.exp(-z));
      const y = labels[i] ? 1 : 0;
      const g = (p - y) * cw[y];
      for (let k = 0; k < idx.length; k++) w[idx[k]] -= lr * (g * val[k] + lambda * w[idx[k]]);
      b -= lr * g;
    }
  }
  return { vocab, idf, w, b, vec };
}

function probOf(core, text) {
  const { idx, val } = core.vec(counts(text));
  let z = core.b;
  for (let k = 0; k < idx.length; k++) z += core.w[idx[k]] * val[k];
  return 1 / (1 + Math.exp(-z));
}

function pickThreshold(probs, rows, maxHnFpr) {
  const isHn = (r) => r.label === 'legit' && r.hard_negative;
  const hn = rows.map((r, i) => (isHn(r) ? i : -1)).filter((i) => i >= 0);
  let best = { t: 0.5, f1: -1 };
  for (let t = 0.05; t <= 0.951; t += 0.01) {
    let tp = 0, fp = 0, fn = 0, hnFlag = 0;
    rows.forEach((r, i) => {
      const flag = probs[i] >= t;
      if (r.label === 'scam') flag ? tp++ : fn++; else if (flag) fp++;
    });
    for (const i of hn) if (probs[i] >= t) hnFlag++;
    const fpr = hn.length ? hnFlag / hn.length : 0;
    if (fpr > maxHnFpr) continue;
    const f1 = tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
    if (f1 > best.f1 + 1e-9) best = { t: Math.round(t * 100) / 100, f1 };
  }
  if (best.f1 < 0) best = { t: 0.95, f1: 0 };
  return best.t;
}

// rows: eval rows ({label:'scam'|'legit', hard_negative, family, ...fields}). Threshold is picked on
// out-of-family cross-validated predictions over dev so it is not tuned on its own training fit.
function trainB2(rows, opts = {}) {
  const maxHnFpr = opts.maxHnFpr === undefined ? 0.05 : opts.maxHnFpr;
  const docs = rows.map(textOf), labels = rows.map((r) => r.label === 'scam');
  const core = fitLR(docs, labels, opts);
  let probs;
  const fams = [...new Set(rows.map((r) => r.family || r.id))];
  if (rows.length >= 12 && fams.length >= 3) {
    const K = Math.min(4, fams.length);
    const rnd = mulberry32(7);
    const famFold = new Map();
    fams.map((f) => [f, rnd()]).sort((a, b) => a[1] - b[1]).forEach(([f], i) => famFold.set(f, i % K));
    probs = new Array(rows.length);
    for (let k = 0; k < K; k++) {
      const tr = [], te = [];
      rows.forEach((r, i) => (famFold.get(r.family || r.id) === k ? te : tr).push(i));
      if (!tr.length || !te.length || new Set(tr.map((i) => labels[i])).size < 2) { te.forEach((i) => { probs[i] = probOf(core, docs[i]); }); continue; }
      const c = fitLR(tr.map((i) => docs[i]), tr.map((i) => labels[i]), opts);
      te.forEach((i) => { probs[i] = probOf(c, docs[i]); });
    }
  } else probs = docs.map((d) => probOf(core, d));
  const threshold = opts.threshold !== undefined ? opts.threshold : pickThreshold(probs, rows, maxHnFpr);
  return {
    threshold,
    predict: (fields) => probOf(core, textOf(fields)),
    flag: (fields) => probOf(core, textOf(fields)) >= threshold,
    vocabSize: core.vocab.size,
  };
}

// ---- B0-intl (added post hoc, Round 3, after a reviewer noted B0 is US-format only) ----
// Any phone-like number in any format: HangUp's own normaliser (international, spaced, lookalike and spelled-out digits)
// plus 7-digit local numbers like 555-0164, or any URL. It is the strongest version of "phone number present = flag".
function b0intl(fields) {
  const { normalise } = require('./normalise');
  const t = textOf(fields);
  const n = normalise(t);
  return n.hasPhone || n.hasUrl || B0_URL.test(t) || /(^|[^\d])\d{3}[-. ]\d{4}(?!\d)/.test(t) || /\+\d[\d\s().-]{7,}\d/.test(t);
}

module.exports = { b0, b0intl, b1, trainB2, textOf, mulberry32 };
