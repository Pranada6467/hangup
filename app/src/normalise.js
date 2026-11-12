'use strict';
// Text normaliser: undoes cheap obfuscation of phone numbers, then extracts phones/URLs/emails.
// Pure code, no LLM. Input is untrusted.

const INVISIBLES = /[­​-‏‪-‮⁠-⁤﻿]/g;
const DASHES = /[‐-―−﹘﹣－]/g;

// ---- lookalike characters inside digit runs ----
const LOOK = { O: '0', o: '0', I: '1', l: '1', '|': '1' };
function mapLookalikes(text) {
  return text.replace(/[0-9OoIl|][0-9OoIl|\s.\-()+]*[0-9OoIl|]/g, (run) => {
    const real = (run.match(/[0-9]/g) || []).length;
    const like = (run.match(/[0-9OoIl|]/g) || []).length;
    if (real < 4 || like < 7) return run;
    const parts = run.split(/([\s.\-()+]+)/); // keep separators
    const hasDigit = (t) => /[0-9]/.test(t);
    const isTok = (t) => t && !/^[\s.\-()+]+$/.test(t);
    const toks = parts.map((p, i) => (isTok(p) ? i : -1)).filter((i) => i >= 0);
    return parts.map((p, i) => {
      if (!isTok(p)) return p;
      const k = toks.indexOf(i);
      let ok = hasDigit(p);
      if (!ok && p.length === 1) {
        const prev = parts[toks[k - 1]], next = parts[toks[k + 1]];
        ok = prev !== undefined && next !== undefined && hasDigit(prev) && hasDigit(next);
      }
      return ok ? p.replace(/[OoIl|]/g, (c) => LOOK[c]) : p;
    }).join('');
  });
}

// ---- spelled-out digits (EN / ES / FR) ----
const WORD_DIGITS = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  'zéro': 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9,
};
const WORD_ALT = Object.keys(WORD_DIGITS).sort((a, b) => b.length - a.length).join('|');
const ITEM = `(?:(?:double|doble|triple)\\s+)?(?:${WORD_ALT})|\\d`;
const SPELLED_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${ITEM})(?:[\\s,.\\-]+(?:${ITEM})){2,}(?![\\p{L}\\p{N}])`, 'giu');

function spelledToDigits(text) {
  return text.replace(SPELLED_RE, (run) => {
    const items = run.toLowerCase().split(/[\s,.\-]+/).filter(Boolean);
    let out = '', words = 0, count = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it === 'double' || it === 'doble' || it === 'triple') {
        const nxt = items[++i];
        const d = WORD_DIGITS[nxt];
        if (d === undefined) return run;
        out += String(d).repeat(it === 'triple' ? 3 : 2); words++; count += 2; continue;
      }
      if (/^\d$/.test(it)) { out += it; count++; continue; }
      out += String(WORD_DIGITS[it]); words++; count++;
    }
    if (words < 1 || count < 3) return run;
    return out;
  });
}

// ---- phone detection ----
const PHONE_CTX = /(call|phone|tel\b|telephone|ph\b|mobile|cell|contact|text us|whatsapp|hotline|helpline|toll[- ]?free|dial|reach|llam\w*|tel[eé]fono|n[uú]mero|appel\w*|t[eé]l[eé]phone|num[eé]ro|contactez|support|helpdesk)/i;
const CAND_RE = /\+?\(?\d[\d\s().\-]{6,}\d/g;

function classify(raw, before) {
  const digits = raw.replace(/\D/g, '');
  const plus = /^\+/.test(raw.trim());
  if (digits.length < 10 || digits.length > 15) return null;
  if (/\d{4}-\d{2}-\d{2}/.test(raw) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(raw)) return null;
  if (/\.\d{1,2}$/.test(raw.trim()) && !/\d{3}\.\d{3}\.\d{4}$/.test(raw.trim())) return null; // amount-like
  const hasSep = /[\s().\-]/.test(raw);
  const ctx = PHONE_CTX.test(before.slice(-40));
  let e164;
  if (digits.length === 10) {
    if (!/^[2-9]/.test(digits)) return null;
    e164 = '+1' + digits;
  } else if (digits.length === 11 && digits[0] === '1') {
    if (!/^[2-9]/.test(digits[1])) return null;
    e164 = '+' + digits;
  } else {
    if (!plus && !(hasSep && ctx) && !ctx) return null; // international: need '+' or phone context
    e164 = '+' + digits;
  }
  // bare digit strings with no formatting: need context unless NANP-shaped (10/11 digits already checked)
  if (!hasSep && !plus && digits.length > 11 && !ctx) return null;
  return e164;
}

function detectPhones(text) {
  const phones = [], replacements = [];
  let out = '', last = 0;
  let m;
  CAND_RE.lastIndex = 0;
  while ((m = CAND_RE.exec(text))) {
    const start = m.index;
    const prev = text[start - 1] || '';
    if (/[$€£¥\w]/.test(prev) && !/[\s]/.test(prev)) continue;
    if (/[A-Za-z]-$/.test(text.slice(Math.max(0, start - 2), start))) continue; // INV-2026-0042
    // try full span, then drop leading / trailing whitespace-separated tokens
    let span = m[0], s = start, found = null;
    const tryAt = (str, st) => {
      const e = classify(str, text.slice(0, st));
      return e ? { e, str, st } : null;
    };
    found = tryAt(span, s);
    if (!found) {
      const toks = span.split(/(\s+)/);
      for (let drop = 2; drop < toks.length && !found; drop += 2) {
        const str = toks.slice(drop).join('');
        found = tryAt(str.trim(), s + span.length - str.length + (str.length - str.trimStart().length));
      }
      for (let drop = 2; drop < toks.length && !found; drop += 2) {
        const str = toks.slice(0, toks.length - drop).join('');
        found = tryAt(str.trim(), s);
      }
    }
    if (found) {
      if (!phones.includes(found.e)) phones.push(found.e);
      out += text.slice(last, found.st);
      replacements.push({ canonical: found.e, original: text.slice(found.st, found.st + found.str.length), start: out.length, end: out.length + found.e.length });
      out += found.e;
      last = found.st + found.str.length;
      CAND_RE.lastIndex = last;
    }
  }
  return { phones, text: out + text.slice(last), replacements };
}

// ---- URLs / emails ----
const TLDS = 'com|net|org|io|co|us|uk|info|biz|support|help|xyz|top|online|site|club|app|me|ly|cc|tv|ru|cn|ws|link|click|live|care|services|tech|store|shop|ca|au|de|fr|es|mx';
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = new RegExp(
  `\\b(?:https?:\\/\\/|www\\.)[^\\s<>"')]+|\\b(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?:\\/[^\\s<>"')]*)?`, 'gi');

function extractUrls(text) {
  const emails = [...new Set(text.match(EMAIL_RE) || [])];
  const noMail = text.replace(EMAIL_RE, ' ');
  const urls = [...new Set((noMail.match(URL_RE) || []).map((u) => u.replace(/[.,;:!?]+$/, '')))];
  return { urls, emails };
}

function normalise(input) {
  let t = String(input == null ? '' : input).normalize('NFKC');
  t = t.replace(INVISIBLES, '').replace(DASHES, '-');
  t = t.replace(/\s*[\[(]?\bdot[\])]?\s*(?=(?:com|net|org|io|co|us|info|biz|support|help)\b)/gi, '.');
  t = mapLookalikes(t);
  t = spelledToDigits(t);
  const { phones, text, replacements } = detectPhones(t);
  const { urls, emails } = extractUrls(text);
  return { text, phones, urls, emails, replacements, hasPhone: phones.length > 0, hasUrl: urls.length > 0 };
}

module.exports = { normalise, mapLookalikes, spelledToDigits, detectPhones, extractUrls };
