'use strict';
// Protects the shared LLM budget on the public hosted demo:
// - identical invoice text is judged once (the scripted demo inputs are cached),
// - a global daily cap on live LLM judgements (fail closed: no verdict, nothing sent),
// - a per-IP daily cap on POST requests to /api (applied in server.js).
const crypto = require('crypto');

function withBudget(checkInvoice, opts = {}) {
  const dailyCap = Number(opts.dailyCap || process.env.HANGUP_DAILY_LLM_CAP || 400);
  const maxEntries = opts.maxEntries || 1000;
  const now = opts.now || (() => Date.now());
  const cache = new Map();
  let day = null, used = 0;
  const stats = () => ({ day, used, cap: dailyCap, cached: cache.size });

  async function budgeted(fields, o = {}) {
    // The context changes the verdict, so it is part of the key (a verdict computed for one context is never served for another).
    const u = o && o.ctx ? o.ctx.unfamiliar_seller : null;
    const key = crypto.createHash('sha256').update(JSON.stringify(fields || {}) + '\u0000' + (u === true ? 'unf' : u === false ? 'fam' : 'unk')).digest('hex');
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key); cache.set(key, hit); // LRU refresh
      return { ...hit, cached: true };
    }
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) { day = today; used = 0; }
    if (used >= dailyCap) {
      const e = new Error('Daily AI budget for this public demo is used up; no verdict was produced. Try again tomorrow or run it locally.');
      e.code = 'LLM_UNAVAILABLE'; e.reason = 'DAILY_BUDGET';
      throw e;
    }
    used++;
    const res = await checkInvoice(fields, o);
    cache.set(key, res);
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return res;
  }
  budgeted.stats = stats;
  return budgeted;
}

function perIpDailyLimit({ max = Number(process.env.HANGUP_IP_DAILY_CAP || 60), now = () => Date.now() } = {}) {
  const hits = new Map();
  let day = null;
  return (req, res, next) => {
    if (req.method !== 'POST') return next();
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) { day = today; hits.clear(); }
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: 'RATE_LIMITED', message: 'Daily limit for this public demo reached from your address. Run HangUp locally for more.' });
    next();
  };
}

module.exports = { withBudget, perIpDailyLimit };
