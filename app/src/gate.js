'use strict';
// Send-time gate: screen every recipient-visible text field BEFORE PayPal create+send.
const { buildInvoiceBody, payerViewUrl } = require('./paypal');
const { reasonLabel } = require('./labels');

const HOLD_TTL_MS = 72 * 3600 * 1000;
const SAFE_NOTE = "Thank you for your business. Questions about this invoice? Reply through PayPal's Contact seller link on the invoice page.";

function normPhone(p) {
  const v = p && typeof p === 'object' ? (p.digits || p.normalised || p.normalized || p.number || p.raw || '') : p;
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length >= 7 ? d : null;
}

function judgeFields(input) {
  return {
    invoicer: input.seller_name,
    amount: input.amount,
    currency: input.currency,
    items: input.items || [],
    note: input.note || '',
    terms: input.terms || '',
    declared_contact: input.declared_contact || null,
  };
}

// ---- unfamiliar-seller context ----
// "Familiar" = the gate's own store holds an earlier decision from this seller to this recipient that was actually sent
// (SENT / RELEASED / REWRITTEN_SENT) or whose invoice is paid. Held, blocked or cancelled invoices do not make a seller familiar.
// At PayPal's scale the same question is answered by PayPal's own payment history ("You don't have any payments with this
// seller in the last year"), which a third-party gate cannot see. Off unless deps.unfamiliarSignal or the caller sets it.
const FAMILIAR_STATUS = ['SENT', 'RELEASED', 'REWRITTEN_SENT'];
const FAMILIAR_INVOICE = ['PAID', 'MARKED_AS_PAID', 'PARTIALLY_PAID'];
function sellerIsFamiliar(input, deps) {
  const rcpt = String(input.recipient_email || '').trim().toLowerCase();
  return deps.store.decisions().some((d) => d.seller_id === input.seller_id && String(d.recipient_email || '').trim().toLowerCase() === rcpt &&
    (FAMILIAR_STATUS.includes(d.status) || FAMILIAR_INVOICE.includes(d.invoice_status)));
}
function unfamiliarContext(input, deps) {
  if (typeof input.unfamiliar_seller === 'boolean') return { unfamiliar_seller: input.unfamiliar_seller, source: 'caller' };
  if (!deps.unfamiliarSignal) return { unfamiliar_seller: null, source: null };
  return { unfamiliar_seller: !sellerIsFamiliar(input, deps), source: 'gate_history' };
}

function actionFor(verdict) {
  if (verdict === 'NO_CALLBACK_PATTERN') return 'ALLOW';
  if (verdict === 'SUSPICIOUS') return 'HOLD';
  return 'BLOCK'; // LIKELY_CALLBACK_SCAM
}

function shouldSendToRecipient(input, deps) {
  if (deps.sendToRecipient !== undefined) return !!deps.sendToRecipient;
  if (deps.env === 'sandbox' || !deps.env) return false;
  return !/@example\.com$/i.test(input.recipient_email || '');
}

function nowIso(deps) { return new Date((deps.now || Date.now)()).toISOString(); }

function wrapPaypalFailure(deps, decision, err) {
  if (err.code === 'PAYPAL_UNREACHABLE' || err.code === 'PAYPAL_ERROR' || err.code === 'PAYPAL_UNCONFIGURED') {
    deps.store.updateDecision(decision.id, { status: 'PAYPAL_FAILED', error: { code: err.code, paypal: err.paypal || null, message: err.message } });
    err.decision = deps.store.getDecision(decision.id);
  }
  return err;
}

async function createAndMaybeSend(input, deps, decision, { send }) {
  const body = buildInvoiceBody({ ...input, invoice_number: undefined });
  const created = await deps.paypal.createInvoice(body, { requestId: `hangup-${decision.id}-${send ? 'send' : 'draft'}` });
  let payer = created.payer_view_url;
  deps.store.setInvoice(created.id, { id: created.id, decision_id: decision.id, status: 'DRAFT', seller_id: input.seller_id });
  let status = 'DRAFT';
  if (send) {
    const s = await deps.paypal.sendInvoice(created.id, { send_to_recipient: shouldSendToRecipient(input, deps), send_to_invoicer: false });
    payer = s.payer_view_url || payer;
    status = 'SENT';
    deps.store.setInvoice(created.id, { status });
  }
  return { invoice_id: created.id, payer_view_url: payer, invoice_status: status };
}

async function gateInvoice(input, deps) {
  const { checkInvoice, store } = deps;
  const uctx = unfamiliarContext(input, deps); // computed before this decision is stored, so it never counts itself
  const result = await checkInvoice(judgeFields(input), { ...(deps.judgeOpts || {}), ctx: { unfamiliar_seller: uctx.unfamiliar_seller } }); // throws LLM_UNAVAILABLE: fail closed
  const phones = [...new Set(((result.features && result.features.phones) || []).map(normPhone).filter(Boolean))];
  const action = actionFor(result.verdict);
  store.upsertSeller({ id: input.seller_id, name: input.seller_name });
  const decision = store.addDecision({
    id: store.nextId('gate'),
    created_at: nowIso(deps),
    staged: !!input.staged,
    seller_id: input.seller_id,
    seller_name: input.seller_name,
    recipient_email: input.recipient_email,
    input: { currency: input.currency, items: input.items, note: input.note, terms: input.terms, declared_contact: input.declared_contact || null },
    unfamiliar_seller: uctx.unfamiliar_seller,
    unfamiliar_source: uctx.source,
    verdict: result.verdict,
    headline: result.headline,
    reasons: result.reasons || [],
    evidence: result.evidence || [],
    form: result.form || null,
    phones,
    model: result.model || null,
    action,
    status: action === 'ALLOW' ? 'PENDING' : action === 'HOLD' ? 'HELD' : 'BLOCKED',
    invoice_id: null,
    payer_view_url: null,
    invoice_status: null,
    expires_at: action === 'HOLD' ? new Date((deps.now || Date.now)() + HOLD_TTL_MS).toISOString() : null,
    review: [],
  });
  try {
    if (action === 'ALLOW') {
      const r = await createAndMaybeSend(input, deps, decision, { send: true });
      store.updateDecision(decision.id, { ...r, status: 'SENT' });
    } else if (action === 'HOLD') {
      const r = await createAndMaybeSend(input, deps, decision, { send: false });
      store.updateDecision(decision.id, { ...r, status: 'HELD' });
    }
  } catch (err) {
    throw wrapPaypalFailure(deps, decision, err);
  }
  return store.getDecision(decision.id);
}

// Demo only: what a platform WITHOUT HangUp does. No screening at all: the invoice is created and sent and we
// record only what PayPal returned. Verdicts exist only once backfillScan() has read the invoice back from PayPal.
async function sendWithoutGate(input, deps) {
  const { store } = deps;
  store.upsertSeller({ id: input.seller_id, name: input.seller_name });
  const decision = store.addDecision({
    id: store.nextId('gate'), created_at: nowIso(deps), staged: true, gate_bypassed: true,
    seller_id: input.seller_id, seller_name: input.seller_name, recipient_email: input.recipient_email,
    input: { currency: input.currency, items: input.items, note: input.note, terms: input.terms, declared_contact: input.declared_contact || null },
    verdict: null, headline: null, reasons: [], evidence: [], form: null, phones: [], model: null,
    action: 'SENT_WITHOUT_GATE', status: 'SENT_WITHOUT_GATE', source: null,
    invoice_id: null, payer_view_url: null, invoice_status: null, expires_at: null, review: [],
  });
  try {
    const r = await createAndMaybeSend(input, { ...deps, sendToRecipient: false }, decision, { send: true });
    store.updateDecision(decision.id, r);
  } catch (err) { throw wrapPaypalFailure(deps, decision, err); }
  return store.getDecision(decision.id);
}

const STAGED_PREFIX = 'hangup STAGED';
const SCANNABLE = ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'MARKED_AS_PAID', 'PAYMENT_PENDING'];
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// What the recipient sees, taken from the PayPal API response (not from our store).
function fieldsFromPayPal(inv) {
  const detail = inv.detail || {};
  const cur = detail.currency_code || (inv.amount && inv.amount.currency_code) || 'USD';
  return {
    seller_name: (inv.invoicer && inv.invoicer.business_name) || '',
    amount: inv.amount && inv.amount.value,
    currency: cur,
    note: detail.note || '',
    terms: detail.terms_and_conditions || '',
    items: (inv.items || []).map((it) => ({ name: it.name || '', description: it.description || '', quantity: it.quantity, unit_amount: it.unit_amount && it.unit_amount.value })),
    recipient_email: (((inv.primary_recipients || [])[0] || {}).billing_info || {}).email_address || null,
  };
}

// "HangUp switched on": scan invoices already sent in the last N days. Lists via the PayPal API, keeps only OUR
// invoices (business_name starts with "hangup STAGED" or id known to our store), reads each one back, judges the
// recipient-visible fields from the API response and records the decision with source 'backfill'.
// Foreign invoices (other teams on the shared sandbox) are only counted: never fetched, judged, logged or touched.
async function backfillScan(deps, { days = 30, pageSize = 100, maxPages = 20, since = null } = {}) {
  const { store, paypal, checkInvoice } = deps;
  const cutoff = Math.max((deps.now || Date.now)() - days * 86400000, since || 0); // `since`: demo only, ignores our leftovers from earlier demo runs
  const out = { days, listed: 0, total_items_reported: null, pages: 0, ours: 0, foreign_skipped: 0, too_old: 0, not_sent_skipped: 0, already_screened: 0, scanned: 0, flagged: 0, results: [], errors: [] };
  const ours = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await paypal.listInvoices({ page, page_size: pageSize, total_required: true });
    out.pages = page;
    if (r.total_items != null) out.total_items_reported = r.total_items;
    for (const it of r.items || []) {
      out.listed += 1;
      const name = (it.invoicer && it.invoicer.business_name) || '';
      const known = it.id && store.getInvoice(it.id);
      if (!(name.startsWith(STAGED_PREFIX) || known)) { out.foreign_skipped += 1; continue; }
      out.ours += 1;
      const created = Date.parse((it.detail && it.detail.metadata && it.detail.metadata.create_time) || (it.detail && it.detail.invoice_date) || '');
      if (Number.isFinite(created) && created < cutoff) { out.too_old += 1; continue; }
      if (it.status && !SCANNABLE.includes(it.status)) { out.not_sent_skipped += 1; continue; }
      ours.push(it.id);
    }
    if (!r.items || !r.items.length || r.items.length < pageSize || (r.total_pages != null && page >= r.total_pages)) break;
  }
  for (const id of ours) {
    const existing = store.decisions().find((d) => d.invoice_id === id);
    if (existing && existing.verdict) { out.already_screened += 1; continue; }
    let inv;
    try { inv = await paypal.getInvoice(id); } catch (e) { out.errors.push({ invoice_id: id, error: e.code || 'ERROR' }); continue; }
    const f = fieldsFromPayPal(inv);
    let result;
    try { result = await checkInvoice(judgeFields(f), deps.judgeOpts || {}); }
    catch (e) { out.errors.push({ invoice_id: id, error: e.code || 'ERROR' }); continue; }
    const phones = [...new Set(((result.features && result.features.phones) || []).map(normPhone).filter(Boolean))];
    const judged = {
      input: { currency: f.currency, items: f.items, note: f.note, terms: f.terms, declared_contact: null },
      verdict: result.verdict, headline: result.headline, reasons: result.reasons || [], evidence: result.evidence || [], form: result.form || null,
      phones, model: result.model || null, would_have_action: actionFor(result.verdict),
      source: 'backfill', backfilled_at: nowIso(deps), screened_from: 'paypal_api',
      invoice_status: inv.status || (existing && existing.invoice_status) || null,
      payer_view_url: payerViewUrl(inv) || (existing && existing.payer_view_url) || null,
    };
    let d;
    if (existing) d = store.updateDecision(existing.id, judged);
    else {
      const sellerId = `backfill-${slug(f.seller_name)}`;
      store.upsertSeller({ id: sellerId, name: f.seller_name });
      d = store.addDecision({
        id: store.nextId('gate'), created_at: nowIso(deps), staged: f.seller_name.startsWith(STAGED_PREFIX), gate_bypassed: true,
        seller_id: sellerId, seller_name: f.seller_name, recipient_email: f.recipient_email,
        action: 'SENT_WITHOUT_GATE', status: 'SENT_WITHOUT_GATE', invoice_id: id, expires_at: null, review: [], ...judged,
      });
      store.setInvoice(id, { id, decision_id: d.id, status: inv.status, seller_id: sellerId });
    }
    store.setInvoice(id, { status: judged.invoice_status });
    out.scanned += 1;
    if (result.verdict !== 'NO_CALLBACK_PATTERN') out.flagged += 1;
    out.results.push({ decision_id: d.id, invoice_id: id, seller_name: f.seller_name, verdict: result.verdict, would_have_action: judged.would_have_action, phones, invoice_status: judged.invoice_status });
  }
  out.finished_at = nowIso(deps);
  if (store.setMeta) store.setMeta('last_backfill', { ...out, results: out.results.map((r) => r.invoice_id) });
  return out;
}

function expireIfNeeded(d, deps) {
  if (d.status === 'HELD' && d.expires_at && new Date(d.expires_at).getTime() <= (deps.now || Date.now)()) {
    deps.store.updateDecision(d.id, { status: 'EXPIRED_NEEDS_REVIEW' });
  }
  return d;
}

// UI-facing shape (adds the nested paypal block and flat note the console reads).
function present(d) {
  if (!d) return d;
  return {
    ...d,
    note: d.input && d.input.note,
    terms: d.input && d.input.terms,
    paypal: d.invoice_id ? { invoice_id: d.invoice_id, status: d.invoice_status, payer_view_url: d.payer_view_url } : null,
    reason_labels: Object.fromEntries((d.reasons || []).map((c) => [c, reasonLabel(c)])),
    error: d.error ? (d.error.code + (d.error.message ? ': ' + d.error.message : '')) : undefined,
  };
}

function listDecisions(deps) {
  return deps.store.decisions().map((d) => present(expireIfNeeded(d, deps))).reverse();
}

function need(deps, id) {
  const d = deps.store.getDecision(id);
  if (!d) { const e = new Error('Decision not found'); e.code = 'NOT_FOUND'; throw e; }
  return expireIfNeeded(d, deps);
}

function stateError(msg, code = 'BAD_STATE') { const e = new Error(msg); e.code = code; return e; }

function inputOf(d, noteOverride) {
  return { seller_id: d.seller_id, seller_name: d.seller_name, recipient_email: d.recipient_email, currency: d.input.currency, items: d.input.items, note: noteOverride !== undefined ? noteOverride : d.input.note, terms: d.input.terms };
}

async function release(gateId, deps, { reconfirm = false } = {}) {
  const d = need(deps, gateId);
  if (d.status === 'EXPIRED_NEEDS_REVIEW' && !reconfirm) throw stateError('Hold expired; re-review required (pass reconfirm).', 'HOLD_EXPIRED');
  if (!['HELD', 'EXPIRED_NEEDS_REVIEW'].includes(d.status)) throw stateError(`Cannot release a decision in status ${d.status}`);
  if (!d.invoice_id) throw stateError('No draft invoice to release');
  try {
    const s = await deps.paypal.sendInvoice(d.invoice_id, { send_to_recipient: shouldSendToRecipient(d, deps), send_to_invoicer: false });
    deps.store.setInvoice(d.invoice_id, { status: 'SENT' });
    deps.store.updateDecision(d.id, { status: 'RELEASED', invoice_status: 'SENT', payer_view_url: s.payer_view_url || d.payer_view_url, review: [...d.review, { at: nowIso(deps), action: 'release' }] });
  } catch (err) { throw wrapPaypalFailure(deps, d, err); }
  return deps.store.getDecision(d.id);
}

async function dropDraft(d, deps) {
  if (d.invoice_id && d.invoice_status === 'DRAFT') {
    await deps.paypal.deleteInvoice(d.invoice_id);
    deps.store.setInvoice(d.invoice_id, { status: 'DELETED' });
  }
}

async function rewrite(gateId, deps) {
  const d = need(deps, gateId);
  if (!['HELD', 'BLOCKED', 'EXPIRED_NEEDS_REVIEW'].includes(d.status)) throw stateError(`Cannot rewrite a decision in status ${d.status}`);
  const inp = inputOf(d, SAFE_NOTE);
  // The rest of the invoice must also pass once the note is replaced.
  const again = await deps.checkInvoice(judgeFields(inp), { ...(deps.judgeOpts || {}), ctx: { unfamiliar_seller: d.unfamiliar_seller === true ? true : d.unfamiliar_seller === false ? false : null } });
  if (again.verdict !== 'NO_CALLBACK_PATTERN') {
    throw stateError('Other fields still look like a callback scam after replacing the note; rewrite refused.', 'REWRITE_STILL_FLAGGED');
  }
  try {
    await dropDraft(d, deps);
    const r = await createAndMaybeSend(inp, deps, d, { send: true });
    deps.store.updateDecision(d.id, { ...r, status: 'REWRITTEN_SENT', rewritten_note: SAFE_NOTE, review: [...d.review, { at: nowIso(deps), action: 'rewrite' }] });
  } catch (err) { throw wrapPaypalFailure(deps, d, err); }
  return deps.store.getDecision(d.id);
}

async function confirmBlock(gateId, deps) {
  const d = need(deps, gateId);
  if (!['HELD', 'BLOCKED', 'EXPIRED_NEEDS_REVIEW'].includes(d.status)) throw stateError(`Cannot block a decision in status ${d.status}`);
  try {
    await dropDraft(d, deps);
  } catch (err) { throw wrapPaypalFailure(deps, d, err); }
  deps.store.updateDecision(d.id, { status: 'BLOCK_CONFIRMED', invoice_status: d.invoice_id ? 'DELETED' : d.invoice_status, review: [...d.review, { at: nowIso(deps), action: 'block' }] });
  return deps.store.getDecision(d.id);
}

// Cluster by normalised phone across distinct sellers. Flag only when >=3 distinct sellers share the number
// AND at least one of those decisions has its OWN scam signal (verdict != NO_CALLBACK_PATTERN).
function campaigns(deps) {
  const byPhone = new Map();
  for (const d of deps.store.decisions()) {
    for (const p of d.phones || []) {
      if (!byPhone.has(p)) byPhone.set(p, []);
      byPhone.get(p).push(d);
    }
  }
  const out = [];
  for (const [phone, ds] of byPhone) {
    const sellers = new Set(ds.map((d) => d.seller_id));
    const flaggedMembers = ds.filter((d) => d.verdict !== 'NO_CALLBACK_PATTERN');
    out.push({
      phone,
      sellers: [...sellers],
      // Every invoice that carries this number. Only flagged ones are ever cancellable (see cancelCampaign).
      invoices: ds.filter((d) => d.invoice_id).map((d) => ({ invoice_id: d.invoice_id, status: d.invoice_status, flagged: d.verdict !== 'NO_CALLBACK_PATTERN' })),
      seller_count: sellers.size,
      flagged: sellers.size >= 3 && flaggedMembers.length > 0,
      decisions: ds.map((d) => ({ id: d.id, seller_id: d.seller_id, seller_name: d.seller_name, verdict: d.verdict, status: d.status, invoice_id: d.invoice_id, invoice_status: d.invoice_status, staged: d.staged })),
      scam_members: flaggedMembers.map((d) => d.id),
      benign_members: ds.filter((d) => d.verdict === 'NO_CALLBACK_PATTERN').map((d) => d.id),
      cancellable: flaggedMembers.filter((d) => d.invoice_id && ['SENT', 'UNPAID'].includes(d.invoice_status)).map((d) => d.invoice_id),
    });
  }
  return out.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.seller_count - a.seller_count);
}

// Cancels SENT/UNPAID invoices whose OWN text was flagged. Benign invoices that merely share the number are
// never cancelled (poisoning resistance: an attacker can't get a legit merchant's invoices cancelled).
// `only` (optional array of decision ids) narrows the cancel to a reviewer's selection. It can only narrow:
// an id that is not a flagged member of this campaign is refused and reported, never cancelled.
async function cancelCampaign(phoneArg, deps, { only = null } = {}) {
  const phone = normPhone(phoneArg);
  const c = campaigns(deps).find((x) => x.phone === phone);
  if (!c) throw stateError('Campaign not found', 'NOT_FOUND');
  if (!c.flagged) throw stateError('Cluster is not flagged; refusing bulk cancel', 'NOT_FLAGGED');
  const results = [];
  const refused = [];
  let targets = c.scam_members;
  if (Array.isArray(only)) {
    const want = new Set(only.map(String));
    targets = c.scam_members.filter((id) => want.has(id));
    for (const id of want) if (!c.scam_members.includes(id)) refused.push({ decision_id: id, reason: c.benign_members.includes(id) ? 'benign invoice: never cancelled' : 'not a flagged member of this campaign' });
  }
  for (const id of targets) {
    let d = deps.store.getDecision(id);
    // The stored status can lag PayPal (a GET right after send may still say DRAFT), so ask PayPal now.
    if (d.invoice_id && deps.paypal.getInvoice) {
      try {
        const live = await deps.paypal.getInvoice(d.invoice_id);
        if (live && live.status) {
          deps.store.updateDecision(id, { invoice_status: live.status });
          deps.store.setInvoice(d.invoice_id, { status: live.status });
          d = deps.store.getDecision(id);
        }
      } catch { /* fall back to the stored status */ }
    }
    if (!d.invoice_id || !['SENT', 'UNPAID'].includes(d.invoice_status)) { results.push({ decision_id: id, invoice_id: d.invoice_id, status: 'SKIPPED', skipped: `not cancellable (${d.invoice_status || 'no invoice'})` }); continue; }
    try {
      await deps.paypal.cancelInvoice(d.invoice_id, { subject: 'Invoice cancelled', note: 'This invoice was cancelled after a security review.', send_to_recipient: shouldSendToRecipient(d, deps), send_to_invoicer: false });
      deps.store.setInvoice(d.invoice_id, { status: 'CANCELLED' });
      deps.store.updateDecision(id, { invoice_status: 'CANCELLED', status: 'CAMPAIGN_CANCELLED', review: [...(d.review || []), { at: nowIso(deps), action: 'cancel' }] });
      results.push({ decision_id: id, invoice_id: d.invoice_id, ok: true, status: 'CANCELLED' });
    } catch (err) {
      results.push({ decision_id: id, invoice_id: d.invoice_id, ok: false, error: err.code || 'ERROR', debug_id: err.paypal && err.paypal.debug_id });
    }
  }
  return { phone, results, refused, skipped_benign: c.benign_members };
}

// Re-read the status of OUR invoices from PayPal (by decision id). Used by the console after a bulk action.
// Only invoices recorded in the store are ever fetched; deleted drafts are not asked for.
async function refreshStatuses(ids, deps) {
  const out = [];
  for (const id of (Array.isArray(ids) ? ids : []).slice(0, 100)) {
    const d = deps.store.getDecision(String(id));
    if (!d) { out.push({ decision_id: String(id), error: 'NOT_FOUND' }); continue; }
    if (!d.invoice_id) { out.push({ decision_id: d.id, invoice_id: null, status: null }); continue; }
    if (d.invoice_status === 'DELETED') { out.push({ decision_id: d.id, invoice_id: d.invoice_id, status: 'DELETED', fetched: false }); continue; }
    try {
      const live = await deps.paypal.getInvoice(d.invoice_id);
      if (live && live.status) { deps.store.updateDecision(d.id, { invoice_status: live.status }); deps.store.setInvoice(d.invoice_id, { status: live.status }); }
      out.push({ decision_id: d.id, invoice_id: d.invoice_id, status: live && live.status, fetched: true, fetched_at: nowIso(deps) });
    } catch (e) { out.push({ decision_id: d.id, invoice_id: d.invoice_id, error: e.code || 'ERROR' }); }
  }
  return out;
}

module.exports = { sellerIsFamiliar, unfamiliarContext, sendWithoutGate, backfillScan, fieldsFromPayPal, present, gateInvoice, release, rewrite, confirmBlock, campaigns, cancelCampaign, refreshStatuses, listDecisions, normPhone, SAFE_NOTE, HOLD_TTL_MS, actionFor };
