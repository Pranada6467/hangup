'use strict';
const path = require('node:path');
const express = require('express');
const gate = require('./gate');
const { checkPayPalInvoiceUrl } = require('./payerview');

const GMAIL_MESSAGE = "Text the HangUp extension read from a PayPal invoice email open in the browser; HangUp did not receive the email itself and can't confirm PayPal sent it.";
const PASTE_MESSAGE = "You pasted this text; HangUp can't confirm PayPal sent it.";
const WEBHOOK_EVENTS = ['INVOICING.INVOICE.PAID', 'INVOICING.INVOICE.CANCELLED', 'INVOICING.INVOICE.UPDATED', 'INVOICING.INVOICE.CREATED'];

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t));
}

// true / false / null from a JSON boolean or the strings the paste form sends. Anything else is null (unknown).
const triState = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);
const str = (v, n = 4000) => (typeof v === 'string' ? v.slice(0, n) : '');
function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 50).map((it) => (typeof it === 'string' ? { name: str(it, 500) } : { name: str(it && it.name, 500), description: str(it && it.description, 2000), quantity: it && it.quantity, unit_amount: it && (it.unit_amount != null ? it.unit_amount : it.amount) }));
}

function createApp(deps = {}) {
  const config = deps.config || require('./config');
  const store = deps.store || require('./store').createStore();
  const paypal = deps.paypal || require('./paypal').createPayPalClient(config.paypal);
  const { withBudget, perIpDailyLimit } = require('./budget');
  const checkInvoice = deps.checkInvoice || withBudget(require('./decide').checkInvoice);
  const renderPayerView = deps.renderPayerView || require('./payerview').renderPayerView;
  const webhookId = deps.webhookId !== undefined ? deps.webhookId : process.env.PAYPAL_WEBHOOK_ID;
  const env = (config.paypal && config.paypal.env) || 'sandbox';
  const gdeps = { paypal, store, checkInvoice, env, now: deps.now, sendToRecipient: deps.sendToRecipient,
    unfamiliarSignal: deps.unfamiliarSignal !== undefined ? !!deps.unfamiliarSignal : process.env.HANGUP_UNFAMILIAR_SELLER === '1' }; // opt-in: see README "Unfamiliar-seller signal"
  const rateMax = deps.rateLimitMax || 30;

  const app = express();
  app.set('trust proxy', 1); // Render terminates TLS in front of us; use the client IP for limits
  if (!deps.checkInvoice) app.use('/api', perIpDailyLimit());
  app.disable('x-powered-by');

  // CORS: same-origin and chrome-extension origins only.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      const ext = /^chrome-extension:\/\/[a-p]{32}$/.test(origin) || /^chrome-extension:\/\/[\w-]+$/.test(origin);
      let same = false;
      try { same = new URL(origin).host === req.get('host'); } catch { /* ignore */ }
      if (!ext && !same) {
        if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
      } else {
        res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' });
      }
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // Webhook route first: needs the raw body bytes for signature verification.
  app.post('/webhooks/paypal', express.raw({ type: () => true, limit: '64kb' }), async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    let event = null;
    try { event = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'BAD_JSON' }); }
    let verified = false;
    let verifyError = null;
    if (!webhookId) verifyError = 'NO_WEBHOOK_ID';
    else {
      try { verified = await paypal.verifyWebhookSignature({ headers: req.headers, body: rawBody, webhookId }); }
      catch (e) { verifyError = e.code || 'VERIFY_FAILED'; }
    }
    store.addWebhookEvent({ id: event.id || null, event_type: event.event_type || null, received_at: new Date().toISOString(), verified, verify_error: verifyError, resource_id: (event.resource && ((event.resource.invoice && event.resource.invoice.id) || event.resource.id)) || null });
    if (!verified) return res.status(verifyError === 'PAYPAL_UNREACHABLE' ? 503 : 401).json({ verified: false, error: verifyError || 'SIGNATURE_INVALID' });
    // Verified only: update state.
    if (WEBHOOK_EVENTS.includes(event.event_type)) {
      const inv = (event.resource && event.resource.invoice) || event.resource || {};
      const known = inv.id && store.getInvoice(inv.id);
      if (known) {
        const byType = { 'INVOICING.INVOICE.PAID': 'PAID', 'INVOICING.INVOICE.CANCELLED': 'CANCELLED', 'INVOICING.INVOICE.CREATED': 'DRAFT' };
        const status = inv.status || byType[event.event_type] || known.status;
        // Webhooks can arrive late (CREATED after we already sent). Only move a status forward, never back.
        const rank = { DRAFT: 0, SCHEDULED: 1, SENT: 2, UNPAID: 2, PARTIALLY_PAID: 3, PAID: 4, MARKED_AS_PAID: 4, CANCELLED: 5, REFUNDED: 5, MARKED_AS_REFUNDED: 5 };
        const cur = known.status;
        if (!(cur in rank) || !(status in rank) || rank[status] >= rank[cur]) {
          store.setInvoice(inv.id, { status });
          if (known.decision_id) store.updateDecision(known.decision_id, { invoice_status: status });
        }
      }
    }
    res.json({ verified: true });
  });

  app.use(express.json({ limit: '64kb' }));

  // ---- health (cached 60s)
  let healthCache = null;
  app.get('/api/health', async (req, res) => {
    if (healthCache && Date.now() - healthCache.at < 60000) return res.json(healthCache.v);
    const probes = deps.probes || {};
    const ppProbe = probes.paypal || (async () => { await paypal.getToken(true); });
    const llmProbe = probes.llm || (async () => {
      const r = await fetch(`${config.llm.baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${config.llm.apiKey}` }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('http ' + r.status);
    });
    const run = async (configured, fn) => {
      if (!configured) return 'unconfigured';
      try { await withTimeout(fn(), 5000); return 'ok'; } catch { return 'unreachable'; }
    };
    const v = {
      paypal: await run(!!(config.paypal && config.paypal.clientId && config.paypal.clientSecret), ppProbe),
      llm: await run(!!(config.llm && config.llm.apiKey), llmProbe),
      model: config.llm && config.llm.model,
      env,
      llm_budget: checkInvoice.stats ? checkInvoice.stats() : undefined,
    };
    healthCache = { at: Date.now(), v };
    res.json(v);
  });

  // ---- rate limit for /api/check
  const hits = new Map();
  app.use('/api/check', (req, res, next) => {
    const now = Date.now();
    const arr = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
    if (arr.length >= rateMax) return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many checks; try again in a minute.' });
    arr.push(now);
    hits.set(req.ip, arr);
    next();
  });

  function checkErrorResponse(res, err) {
    if (err.code === 'LLM_UNAVAILABLE') return res.status(503).json({ error: 'LLM_UNAVAILABLE', message: 'The AI service is not available; no verdict was produced.' });
    console.error('check failed', err.code || err.message);
    return res.status(500).json({ error: 'CHECK_FAILED' });
  }

  app.post('/api/check', async (req, res) => {
    const b = req.body || {};
    let provenance;
    let fields;
    let unfamiliar = triState(b.unfamiliar_seller), ctxSource = unfamiliar === null ? null : (b.unfamiliar_source === 'payer_page_line' && b.source === 'extension_dom' ? 'payer_page_line' : b.unfamiliar_source === 'email_line' && b.source === 'extension_gmail' ? 'email_line' : 'user_input');
    if (typeof b.url === 'string' && b.url) {
      const r = await renderPayerView(b.url);
      if (!r.ok) {
        if (r.reason === 'NOT_PAYPAL_INVOICE_HOST') return res.status(400).json({ error: 'NOT_PAYPAL_INVOICE_HOST', message: r.explanation });
        return res.status(502).json({ error: 'PAYPAL_UNREACHABLE', reason: r.reason, message: r.explanation });
      }
      provenance = r.provenance;
      ctxSource = triState(b.unfamiliar_seller) !== null ? 'user_input' : r.unfamiliar_seller === true ? 'payer_page_line' : null;
      unfamiliar = triState(b.unfamiliar_seller) !== null ? triState(b.unfamiliar_seller) : r.unfamiliar_seller === true ? true : null;
      fields = { invoicer: r.invoicer || '', amount: r.amount, currency: r.currency, items: cleanItems(r.items), note: r.note || r.raw_text || '', terms: r.terms || '', status: r.status };
    } else if (b.source === 'extension_dom') {
      const chk = checkPayPalInvoiceUrl(b.page_url);
      if (!chk.ok) return res.status(400).json({ error: 'NOT_PAYPAL_INVOICE_HOST', message: chk.explanation });
      provenance = { source: 'extension_dom', url: chk.url, fetched_at: new Date().toISOString() };
    } else if (b.source === 'extension_gmail') {
      // Seller-written fields of one PayPal invoice email, read by the extension. No page URL: the server never sees the mailbox.
      provenance = { source: 'extension_gmail', message: GMAIL_MESSAGE, fetched_at: new Date().toISOString() };
    } else {
      provenance = { source: 'pasted_text', message: PASTE_MESSAGE };
    }
    if (!fields) {
      fields = { invoicer: str(b.invoicer, 300), amount: str(String(b.amount == null ? '' : b.amount), 40), currency: str(b.currency, 8), items: cleanItems(b.items), note: str(b.note), terms: str(b.terms) };
      if (!fields.note && !fields.terms && !fields.items.length) return res.status(400).json({ error: 'EMPTY_INPUT', message: 'Nothing to check.' });
    }
    try {
      const result = await checkInvoice({ invoicer: fields.invoicer, amount: fields.amount, currency: fields.currency, items: fields.items, note: fields.note, terms: fields.terms }, { ctx: { unfamiliar_seller: unfamiliar } });
      res.json({ provenance, extracted: fields, context: { unfamiliar_seller: unfamiliar, source: ctxSource }, result });
    } catch (err) { checkErrorResponse(res, err); }
  });

  // ---- gate
  function gateError(res, err) {
    const conflict = ['BAD_STATE', 'HOLD_EXPIRED', 'REWRITE_STILL_FLAGGED', 'NOT_FLAGGED'];
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND', message: err.message });
    if (conflict.includes(err.code)) return res.status(409).json({ error: err.code, message: err.message });
    if (err.code === 'LLM_UNAVAILABLE') return res.status(503).json({ error: 'LLM_UNAVAILABLE', message: 'The AI service is not available; invoice was not sent (fail closed).' });
    if (err.code === 'PAYPAL_UNREACHABLE' || err.code === 'PAYPAL_UNCONFIGURED') return res.status(502).json({ error: err.code === 'PAYPAL_UNREACHABLE' ? 'PAYPAL_UNREACHABLE' : 'PAYPAL_UNCONFIGURED', message: err.message, decision: err.decision ? gate.present(err.decision) : undefined });
    if (err.code === 'PAYPAL_ERROR') return res.status(502).json({ error: 'PAYPAL_ERROR', paypal: err.paypal, decision: err.decision ? gate.present(err.decision) : undefined });
    console.error('gate failed', err.code || err.message);
    return res.status(500).json({ error: 'GATE_FAILED' });
  }
  function validateGateInput(b) {
    if (!b || typeof b !== 'object') return 'body required';
    for (const k of ['seller_id', 'seller_name', 'recipient_email']) if (typeof b[k] !== 'string' || !b[k].trim()) return `${k} required`;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.recipient_email)) return 'recipient_email invalid';
    if (!Array.isArray(b.items) || !b.items.length) return 'items required';
    return null;
  }
  function gateInput(b) {
    return { seller_id: str(b.seller_id, 100), seller_name: str(b.seller_name, 300), declared_contact: str(b.declared_contact, 300) || undefined, recipient_email: str(b.recipient_email, 254), currency: str(b.currency, 3) || 'USD', items: cleanItems(b.items), note: str(b.note), terms: str(b.terms), staged: !!b.staged, unfamiliar_seller: typeof b.unfamiliar_seller === 'boolean' ? b.unfamiliar_seller : undefined };
  }

  app.post('/api/gate/invoices', async (req, res) => {
    const bad = validateGateInput(req.body);
    if (bad) return res.status(400).json({ error: 'BAD_REQUEST', message: bad });
    try { res.json(gate.present(await gate.gateInvoice(gateInput(req.body), gdeps))); } catch (e) { gateError(res, e); }
  });
  app.get('/api/gate/decisions', (req, res) => res.json(gate.listDecisions(gdeps)));
  app.post('/api/gate/decisions/:id/release', async (req, res) => {
    try { res.json(gate.present(await gate.release(req.params.id, gdeps, { reconfirm: !!(req.body && req.body.reconfirm) }))); } catch (e) { gateError(res, e); }
  });
  app.post('/api/gate/decisions/:id/rewrite', async (req, res) => {
    try { res.json(gate.present(await gate.rewrite(req.params.id, gdeps))); } catch (e) { gateError(res, e); }
  });
  app.post('/api/gate/decisions/:id/block', async (req, res) => {
    try { res.json(gate.present(await gate.confirmBlock(req.params.id, gdeps))); } catch (e) { gateError(res, e); }
  });
  // "HangUp switched on": scan invoices already sent in the last N days (ours only; foreign ones are counted, never read).
  app.post('/api/gate/backfill', async (req, res) => {
    const days = Math.min(365, Math.max(1, parseInt(req.body && req.body.days, 10) || 30));
    const demo = !!(req.body && req.body.demo);
    try { res.json(await singleFlight(`backfill:${demo}:${days}`, () => gate.backfillScan(gdeps, { days, since: demo ? sinceReset() : null }))); } catch (e) { gateError(res, e); }
  });
  app.get('/api/gate/campaigns', (req, res) => res.json(gate.campaigns(gdeps)));
  app.post('/api/gate/campaigns/:phone/cancel', async (req, res) => {
    const only = req.body && Array.isArray(req.body.decision_ids) ? req.body.decision_ids.slice(0, 200).map((x) => str(x, 100)) : null;
    try { res.json(await singleFlight(`cancel:${req.params.phone}:${only ? only.join(',') : '*'}`, () => gate.cancelCampaign(req.params.phone, gdeps, { only }))); } catch (e) { gateError(res, e); }
  });
  // Re-fetch the live PayPal status of our invoices for the given decision ids (console: after a bulk action).
  app.post('/api/gate/refresh', async (req, res) => {
    const ids = req.body && Array.isArray(req.body.decision_ids) ? req.body.decision_ids.map((x) => str(x, 100)) : [];
    try { res.json({ results: await gate.refreshStatuses(ids, gdeps), decisions: ids.map((i) => gate.present(gdeps.store.getDecision(i))).filter(Boolean) }); } catch (e) { gateError(res, e); }
  });

  // ---- staged demo ("one invoice, two endings")
  const PHONE = '1-888-555-0142';
  const stagedName = (n) => `hangup STAGED ${n}`;
  const scamNote = (n) => `TotalDefend Antivirus: your 3-year protection plan renewed today and $${n} was charged to your account. If you did not authorise this, call our billing helpline at ${PHONE} within 24 hours to cancel and get a refund.`;
  const scamInput = (id, name, amt) => ({
    seller_id: id, seller_name: stagedName(name), recipient_email: `victim-${id.slice(-1).toLowerCase()}@example.com`, currency: 'USD',
    items: [{ name: 'TotalDefend Antivirus 3-year renewal', description: `Auto-renewal. Call ${PHONE.replace(/-/g, ' ')} to cancel.`, quantity: 1, unit_amount: amt }], note: scamNote(amt), terms: 'No refunds unless cancelled by phone within 24 hours.', staged: true,
  });
  const DEMO_UNGATED = [scamInput('staged-seller-A', 'Maple Bay Digital', '499.00'), scamInput('staged-seller-B', 'Northgate Online Services', '479.99')];
  const DEMO_GATED = [
    scamInput('staged-seller-C', 'Pinecrest Web Supplies', '499.00'),
    { seller_id: 'staged-dana-plumbing', seller_name: stagedName("Dana's Plumbing"), recipient_email: 'customer-1@example.com', currency: 'USD', items: [{ name: 'Water heater flush and valve replacement', description: 'Job at 14 Elm St, 12 March', quantity: 1, unit_amount: '285.00' }], note: 'Thanks for choosing Dana\'s Plumbing. Questions about this job? Call Dana on (503) 555-0173, Mon-Fri 8-5.', terms: 'Due on receipt.', staged: true },
    // Gray zone on purpose: a STAGED fictional IT shop whose bill mentions remote-access software. HangUp holds it for a person (HOLD), who releases it.
    { seller_id: 'staged-brightline-it', seller_name: stagedName('Brightline IT Supply'), recipient_email: 'accounts@example.com', currency: 'USD', items: [{ name: 'Remote support, 2 hours (ticket #4471)', description: 'Done 12 March using remote-access software (TeamViewer)', quantity: 1, unit_amount: '240.00' }], note: 'Thanks for booking with Brightline. On 12 March our technician took remote control of your office PC with TeamViewer and finished the printer and email setup you asked for. Questions about this bill? Call our support desk on (503) 555-0188.', terms: 'Net 14.', staged: true },
  ];
  // Demo invoices are never emailed to anyone.
  const ddeps = { ...gdeps, sendToRecipient: false };

  const sinceReset = () => { const t = store.getMeta && store.getMeta('demo_reset_at'); return t ? t - 2000 : null; };
  async function demoReset() {
    const gone = store.removeDecisions((d) => d.staged);
    if (store.setMeta) { store.setMeta('last_backfill', null); store.setMeta('demo_reset_at', Date.now()); }
    const deleted = [];
    for (const d of gone) {
      if (d.invoice_id && d.invoice_status === 'DRAFT') {
        try { await paypal.deleteInvoice(d.invoice_id); deleted.push(d.invoice_id); } catch (e) { console.error('demo reset: draft delete failed', e.code || e.message); }
      }
    }
    return { cleared: gone.length, deleted_drafts: deleted };
  }
  // Retry safety: the console retries a demo step after a 502/503/504 (proxy timeout, cold start) while the first
  // attempt may still be running. So every staged seller is created at most once per reset: a repeat call replays the
  // stored decision, and a call that arrives while the first is in flight waits for it (single flight).
  const inflight = new Map();
  function singleFlight(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }
  const stagedPrior = (sellerId) => store.decisions().filter((d) => d.staged && d.seller_id === sellerId && d.status !== 'PAYPAL_FAILED').pop() || null;
  async function runDemo(res, inputs, fn) {
    const out = []; let replayed = 0;
    for (const inp of inputs) {
      try {
        const d = await singleFlight(`seller:${inp.seller_id}`, async () => {
          const prior = stagedPrior(inp.seller_id);
          if (prior) { replayed += 1; return prior; }
          return fn(inp, ddeps);
        });
        out.push(gate.present(d));
      }
      catch (e) {
        if (e.decision) out.push(gate.present(e.decision));
        if (['LLM_UNAVAILABLE', 'PAYPAL_UNREACHABLE', 'PAYPAL_UNCONFIGURED'].includes(e.code)) {
          return { fail: res.status(e.code === 'LLM_UNAVAILABLE' ? 503 : 502).json({ error: e.code, message: e.message, decisions: out }) };
        }
        return { fail: gateError(res, e) };
      }
    }
    return { out, replayed };
  }

  app.post('/api/demo/reset', async (req, res) => { res.json({ staged: true, ...(await demoReset()) }); });
  app.post('/api/demo/ungated', async (req, res) => {
    const r = await runDemo(res, DEMO_UNGATED, gate.sendWithoutGate);
    if (r.fail) return r.fail;
    res.json({ staged: true, replayed: r.replayed, decisions: r.out });
  });
  app.post('/api/demo/gated', async (req, res) => {
    const r = await runDemo(res, DEMO_GATED, gate.gateInvoice);
    if (r.fail) return r.fail;
    res.json({ staged: true, replayed: r.replayed, decisions: r.out });
  });
  app.post('/api/demo/seed', async (req, res) => {
    const reset = await demoReset();
    const u = await runDemo(res, DEMO_UNGATED, gate.sendWithoutGate);
    if (u.fail) return u.fail;
    let backfill;
    try { backfill = await gate.backfillScan(ddeps, { days: 30, since: sinceReset() }); } catch (e) { return gateError(res, e); }
    const g = await runDemo(res, DEMO_GATED, gate.gateInvoice);
    if (g.fail) return g.fail;
    res.json({ staged: true, reset, backfill, decisions: [...u.out, ...g.out] });
  });

  app.get('/api/webhook-events', (req, res) => res.json(store.webhookEvents().slice(-50).reverse().map((e) => ({ id: e.id, event_type: e.event_type, received_at: e.received_at, verified: !!e.verified, verify_error: e.verify_error || null, resource_id: e.resource_id }))));

  app.get('/api/demo/story', async (req, res) => {
    const verify = req.query.verify === '1' || req.query.verify === 'true';
    const latest = (sid) => store.decisions().filter((d) => d.staged && d.seller_id === sid).pop() || null;
    if (verify) { // refresh stored statuses from PayPal first, so every step below reflects PayPal, not our cache
      for (const sid of ['staged-seller-A', 'staged-seller-B', 'staged-dana-plumbing', 'staged-brightline-it']) {
        const d = latest(sid);
        if (!d || !d.invoice_id) continue;
        try { const r = await paypal.getInvoice(d.invoice_id); if (r && r.status) { store.updateDecision(d.id, { invoice_status: r.status }); store.setInvoice(d.invoice_id, { status: r.status }); } } catch { /* keep stored */ }
      }
    }
    const live = async (d) => {
      if (!verify || !d || !d.invoice_id) return undefined;
      try {
        const r = await paypal.getInvoice(d.invoice_id);
        if (r && r.status) { store.updateDecision(d.id, { invoice_status: r.status }); store.setInvoice(d.invoice_id, { status: r.status }); d.invoice_status = r.status; }
        return { status: r && r.status, fetched_at: new Date().toISOString() };
      }
      catch (e) { return { error: e.code || 'ERROR' }; }
    };
    const row = async (d) => d && ({
      decision_id: d.id, seller_id: d.seller_id, seller_name: d.seller_name, action: d.action, decision_status: d.status, verdict: d.verdict,
      would_have_action: d.would_have_action || undefined, gate_bypassed: !!d.gate_bypassed, staged: !!d.staged,
      invoice_id: d.invoice_id, invoice_status: d.invoice_status, payer_view_url: d.payer_view_url, phones: d.phones,
      paypal_live: await live(d),
    });
    const A = latest('staged-seller-A'), B = latest('staged-seller-B'), C = latest('staged-seller-C');
    const dana = latest('staged-dana-plumbing'), bright = latest('staged-brightline-it');
    const camp = gate.campaigns(ddeps).find((c) => (C && c.decisions.some((x) => x.id === C.id)) || (A && c.phone === (A.phones || [])[0]));
    const monday = [A, B].filter(Boolean);
    const cancelled = monday.filter((d) => d.invoice_status === 'CANCELLED');
    const allCancelled = monday.length === 2 && cancelled.length === 2;
    const lb = store.getMeta ? store.getMeta('last_backfill') : null;
    const backfilled = monday.filter((d) => d.source === 'backfill');
    const beats = {
      monday: { step: 1, title: 'Monday, sent with no screening', state: monday.length === 2 && monday.every((d) => d.invoice_id) ? 'done' : 'pending', invoices: await Promise.all(monday.map(row)) },
      tuesday: { step: 2, title: 'Tuesday, HangUp switched on: backfill scan finds A and B, C is blocked', state: lb && C ? 'done' : 'pending',
        backfill: lb ? { days: lb.days, listed: lb.listed, total_items_reported: lb.total_items_reported, pages: lb.pages, ours: lb.ours, foreign_skipped: lb.foreign_skipped, scanned: lb.scanned, flagged: lb.flagged, already_screened: lb.already_screened, finished_at: lb.finished_at } : null,
        found: await Promise.all(backfilled.map(row)),
        blocked: await row(C), control_dana: await row(dana), tricky_brightline: await row(bright) },
      campaign: { step: 3, title: 'Campaign found', state: allCancelled ? 'done' : camp && camp.flagged ? 'ready' : 'pending',
        phone: camp ? camp.phone : null, flagged: !!(camp && camp.flagged), seller_count: camp ? camp.seller_count : 0, sellers: camp ? camp.sellers : [],
        cancellable: camp ? camp.cancellable : [], cancelled: cancelled.map((d) => d.invoice_id) },
      result: { step: 4, title: 'Result: statuses re-fetched from PayPal', state: allCancelled && verify ? 'done' : 'pending', verified: verify, invoices: await Promise.all(monday.map(row)) },
    };
    res.json({ staged: true, beats });
  });

  // The mock inbox's "Preview without the extension" button uses the extension's own banner and Gmail parser, served from the one source file
  // (no copy to drift). gmail.js does nothing on its own outside the extension runtime.
  for (const f of ['banner.js', 'gmail.js']) app.get('/ext/' + f, (req, res) => res.type('application/javascript').sendFile(path.join(__dirname, '..', 'extension', f)));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use((err, req, res, next) => { // body-parser errors etc.
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'TOO_LARGE' });
    if (err && err.status === 400) return res.status(400).json({ error: 'BAD_REQUEST' });
    console.error('unhandled', err && err.message);
    res.status(500).json({ error: 'INTERNAL' });
  });
  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`HangUp listening on :${port}`));
}
