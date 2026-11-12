(function (root) {
  'use strict';
  // Retry helper for the demo story. Only calls that are safe to repeat use it: the server replays an existing staged
  // invoice instead of creating a second one (see runDemo/singleFlight in src/server.js), and cancel/backfill are idempotent.
  const TRANSIENT_STATUS = [502, 503, 504];
  // 502/503/504 come from the Render proxy (cold start, timeout) or from our own fail-closed paths. A network failure
  // (fetch rejects with a TypeError and no status) is treated the same way.
  function isTransient(e) { return !!e && (TRANSIENT_STATUS.indexOf(e.status) >= 0 || (e.name === 'TypeError' && !e.status)); }
  function withRetry(fn, opts) {
    const o = opts || {}, delays = o.delays || [2000, 5000], sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let n = 0;
    const attempt = () => Promise.resolve().then(fn).catch((e) => {
      const transient = isTransient(e);
      if (!transient || n >= delays.length) { if (e && typeof e === 'object') e.retryable = transient; throw e; }
      const wait = delays[n]; n += 1;
      if (o.onRetry) o.onRetry(n, delays.length, e);
      return sleep(wait).then(attempt);
    });
    return attempt();
  }
  const api = { withRetry, isTransient, TRANSIENT_STATUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HangupRetry = api;
})(typeof window !== 'undefined' ? window : this);
