// Runs the full demo story N times against the hosted service and records real IDs and statuses.
// Usage: node scripts/hosted_story_runs.js [baseUrl] [n]
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2] || 'https://payyourpal-hangup.onrender.com';
const N = Number(process.argv[3] || 5);
const j = async (method, p) => { const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined }); return r.json(); };
(async () => {
  const runs = [];
  for (let i = 1; i <= N; i++) {
    const run = { run: i, started: new Date().toISOString() };
    try {
      await j('POST', '/api/demo/reset');
      const seed = await j('POST', '/api/demo/seed');
      run.seed = (seed.decisions || []).map((d) => ({ seller: d.seller_name, action: d.action, verdict: d.verdict, invoice_id: d.paypal && d.paypal.invoice_id }));
      const camps = await j('GET', '/api/gate/campaigns');
      const c = camps.find((x) => x.flagged);
      run.campaign = c ? { phone: c.phone, sellers: c.seller_count } : null;
      const cancel = c ? await j('POST', `/api/gate/campaigns/${c.phone}/cancel`) : null;
      run.cancel = cancel && cancel.results;
      const story = await j('GET', '/api/demo/story?verify=1');
      const steps = story.beats || story.steps || story;
      run.step_states = Object.fromEntries(Object.entries(steps).filter(([, v]) => v && v.step).map(([k, v]) => [k, v.state]));
      run.live = ((steps.result && steps.result.invoices) || []).map((r) => r && { id: r.invoice_id, live: r.paypal_live && r.paypal_live.status });
      run.ok = !!(run.cancel && run.cancel.filter((r) => r.ok).length === 2 && run.live.length === 2 && run.live.every((r) => r.live === 'CANCELLED'));
    } catch (e) { run.error = e.message; run.ok = false; }
    runs.push(run); console.log(`run ${i}: ok=${run.ok}`, JSON.stringify(run.step_states || {}), run.error || '');
  }
  const out = path.join(__dirname, '..', 'eval', 'results', `hosted_runs_${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ base: BASE, runs, passed: runs.filter((r) => r.ok).length, of: N }, null, 1));
  console.log('wrote', out, `${runs.filter((r) => r.ok).length}/${N}`);
})();
