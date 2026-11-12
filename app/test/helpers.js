'use strict';
const { createStore } = require('../src/store');

function stubPayPal(opts = {}) {
  const calls = [];
  const made = {}; // id -> invoice as PayPal would return it
  const foreign = opts.foreign || []; // other teams' invoices on the shared sandbox
  let n = 0;
  const p = {
    calls,
    async createInvoice(body, o) { calls.push(['create', body, o]); n += 1; made[`INV2-${n}`] = { id: `INV2-${n}`, status: 'DRAFT', detail: { currency_code: body.detail.currency_code, note: body.detail.note, terms_and_conditions: body.detail.terms_and_conditions, metadata: { create_time: new Date().toISOString() } }, invoicer: body.invoicer, primary_recipients: body.primary_recipients, items: body.items }; return { id: `INV2-${n}`, payer_view_url: `https://www.sandbox.paypal.com/invoice/p/#${n}` }; },
    async sendInvoice(id, o) { calls.push(['send', id, o]); if (made[id]) made[id].status = 'SENT'; return { payer_view_url: `https://www.sandbox.paypal.com/invoice/p/#s${id}` }; },
    async cancelInvoice(id, o) { calls.push(['cancel', id, o]); if (made[id]) made[id].status = 'CANCELLED'; if (opts.failCancel === id) { const e = new Error('x'); e.code = 'PAYPAL_ERROR'; e.paypal = { debug_id: 'd' }; throw e; } return { ok: true }; },
    async deleteInvoice(id) { calls.push(['delete', id]); return { ok: true }; },
    async verifyWebhookSignature(a) { calls.push(['verify', a]); return !!opts.verify; },
    async listInvoices(o) { calls.push(['list', o]); const all = [...foreign.map((f) => ({ id: f.id, status: 'SENT', invoicer: { business_name: f.name }, detail: { currency_code: 'USD' } })), ...Object.values(made).map((m) => ({ id: m.id, status: m.status, invoicer: m.invoicer, detail: { currency_code: m.detail.currency_code, metadata: m.detail.metadata } }))]; const size = o.page_size || 20; const page = o.page || 1; return { total_items: all.length, total_pages: Math.ceil(all.length / size), items: all.slice((page - 1) * size, page * size) }; },
    async getInvoice(id) { calls.push(['get', id]); if (!made[id]) { const e = new Error('nf'); e.code = 'PAYPAL_ERROR'; throw e; } return JSON.parse(JSON.stringify(made[id])); },
    async getToken() { return 't'; },
  };
  return p;
}

// Deterministic stand-in for checkInvoice: verdict driven by text markers.
function stubCheck(extra = {}) {
  return async (fields) => {
    const text = [fields.invoicer, fields.note, fields.terms, ...(fields.items || []).map((i) => `${i.name} ${i.description || ''}`)].join(' ');
    if (extra.throwLLM) { const e = new Error('llm down'); e.code = 'LLM_UNAVAILABLE'; throw e; }
    const phones = [...text.matchAll(/\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}|1[-. ]?\d{3}[-. ]\d{3}[-. ]\d{4}/g)].map((m) => m[0]);
    let verdict = 'NO_CALLBACK_PATTERN';
    if (/SCAMMY/.test(text)) verdict = 'LIKELY_CALLBACK_SCAM';
    else if (/MAYBE/.test(text)) verdict = 'SUSPICIOUS';
    return { verdict, headline: verdict, advice: [], reasons: [], evidence: verdict === 'NO_CALLBACK_PATTERN' ? [] : ['quote'], form: { callback_demanded: verdict !== 'NO_CALLBACK_PATTERN' }, features: { phones, urls: [] }, model: 'stub', latency_ms: 1 };
  };
}

const inv = (seller, note, extra = {}) => ({ seller_id: seller, seller_name: seller, recipient_email: `${seller}@example.com`, currency: 'USD', items: [{ name: 'Thing', quantity: 1, unit_amount: '10.00' }], note, terms: '', ...extra });

function deps(o = {}) {
  return { paypal: o.paypal || stubPayPal(o), store: createStore(null), checkInvoice: o.checkInvoice || stubCheck(o), env: 'sandbox', now: o.now };
}

module.exports = { stubPayPal, stubCheck, inv, deps };
