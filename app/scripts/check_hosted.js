#!/usr/bin/env node
// Usage: node scripts/check_hosted.js https://payyourpal-hangup.onrender.com
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('usage: check_hosted.js <url>'); process.exit(2); }
const NOTE = 'Hi, this is Mike the plumber. Your invoice for the water heater repair is $480. If you have any questions about this invoice please call me back on 1-888-555-0199 immediately to avoid your account being suspended.';
async function go(method, p, body) {
  const t0 = Date.now();
  const r = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 200); }
  return { status: r.status, ms: Date.now() - t0, body: j };
}
(async () => {
  const out = {};
  out.health = await go('GET', '/api/health');
  const root = await go('GET', '/'); out.root = { status: root.status, ms: root.ms, html: typeof root.body === 'string' };
  const c = await go('POST', '/api/check', { invoicer: 'Mike Plumbing', amount: '480.00', currency: 'USD', note: NOTE });
  out.check = { status: c.status, ms: c.ms, verdict: c.body && (JSON.stringify(c.body.result && (c.body.result.verdict || c.body.result.risk || Object.keys(c.body.result)))), keys: c.body && typeof c.body === 'object' ? Object.keys(c.body) : null };
  const w = await go('GET', '/api/webhook-events');
  out.webhook_events = { status: w.status, count: Array.isArray(w.body) ? w.body.length : null };
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.health.status === 200 && root.status === 200 && c.status === 200 && w.status === 200 ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
