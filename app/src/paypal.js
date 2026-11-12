'use strict';
// PayPal REST client (Invoicing v2, OAuth2, Webhooks v1). Built against documented contracts;
// live behaviour is UNVERIFIED from this build environment (see VERIFICATION notes in report).
const crypto = require('node:crypto');

function unreachable(cause) {
  const e = new Error('PayPal is unreachable: ' + (cause && cause.message ? cause.message : 'network failure'));
  e.code = 'PAYPAL_UNREACHABLE';
  e.cause = cause;
  return e;
}

function mapError(status, body, logger) {
  const info = {
    status,
    name: (body && body.name) || 'UNKNOWN_ERROR',
    message: body && body.message,
    debug_id: (body && body.debug_id) || null,
    details: (body && body.details) || [],
  };
  if (logger) logger(`PayPal error status=${status} name=${info.name} debug_id=${info.debug_id}`);
  const e = new Error(`PayPal ${status} ${info.name}${info.message ? ': ' + info.message : ''}`);
  e.code = 'PAYPAL_ERROR';
  e.paypal = info;
  e.status = status;
  return e;
}

function payerViewUrl(inv) {
  if (!inv) return null;
  const links = inv.links || [];
  const l = links.find((x) => x.rel === 'payer-view');
  if (l && l.href) return l.href;
  const m = inv.detail && inv.detail.metadata;
  return (m && m.recipient_view_url) || null;
}

function buildInvoiceBody({ seller_name, recipient_email, currency = 'USD', items = [], note, terms, invoice_number }) {
  const detail = { currency_code: currency };
  if (note) detail.note = note;
  if (terms) detail.terms_and_conditions = terms;
  if (invoice_number) detail.invoice_number = invoice_number;
  return {
    detail,
    invoicer: { business_name: seller_name },
    primary_recipients: [{ billing_info: { email_address: recipient_email } }],
    items: items.map((it) => ({
      name: it.name,
      description: it.description || undefined,
      quantity: String(it.quantity == null ? 1 : it.quantity),
      unit_amount: { currency_code: currency, value: String(it.unit_amount != null ? it.unit_amount : it.amount != null ? it.amount : '0.00') },
    })),
  };
}

function createPayPalClient({ clientId, clientSecret, apiBase = 'https://api-m.sandbox.paypal.com', fetchImpl, logger = console.error, now = Date.now } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const base = apiBase.replace(/\/$/, '');
  let token = null;
  let tokenExp = 0;
  let inflight = null;

  async function raw(url, opts) {
    try {
      return await f(url, opts);
    } catch (err) {
      throw unreachable(err);
    }
  }

  async function parse(res) {
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return { _raw: text }; }
  }

  async function getToken(force) {
    if (!clientId || !clientSecret) {
      const e = new Error('PayPal credentials not configured');
      e.code = 'PAYPAL_UNCONFIGURED';
      throw e;
    }
    if (!force && token && now() < tokenExp) return token;
    if (inflight) return inflight;
    inflight = (async () => {
      const res = await raw(`${base}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
      });
      const body = await parse(res);
      if (!res.ok) throw mapError(res.status, body && { name: body.error, message: body.error_description, ...body }, logger);
      token = body.access_token;
      // refresh 60s early
      tokenExp = now() + Math.max(0, (body.expires_in || 300) - 60) * 1000;
      return token;
    })();
    try { return await inflight; } finally { inflight = null; }
  }

  async function api(method, path, { body, headers = {}, okEmpty } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await getToken(attempt > 0);
      const res = await raw(base + path, {
        method,
        headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      if (res.status === 401 && attempt === 0) { token = null; continue; }
      const parsed = await parse(res);
      if (!res.ok) throw mapError(res.status, parsed, logger);
      return { status: res.status, body: parsed, headers: res.headers };
    }
  }

  return {
    getToken,
    buildInvoiceBody,
    payerViewUrl,

    async generateNextInvoiceNumber() {
      const r = await api('POST', '/v2/invoicing/generate-next-invoice-number', {});
      return r.body && r.body.invoice_number;
    },

    async createInvoice(body, { requestId } = {}) {
      const r = await api('POST', '/v2/invoicing/invoices', {
        body,
        headers: { 'PayPal-Request-Id': requestId || crypto.randomUUID(), Prefer: 'return=representation' },
      });
      // Documented: 201 with representation when Prefer: return=representation; otherwise {href, rel, method} link.
      const b = r.body || {};
      let id = b.id;
      if (!id && b.href) id = b.href.split('/').pop();
      return { id, invoice: b.id ? b : null, payer_view_url: payerViewUrl(b), raw: b };
    },

    async sendInvoice(id, { send_to_recipient = true, send_to_invoicer = false, subject, note } = {}) {
      const body = { send_to_recipient, send_to_invoicer };
      if (subject) body.subject = subject;
      if (note) body.note = note;
      const r = await api('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { body });
      const b = r.body || {};
      // send response: {rel:'self'|'payer-view', href, method} (documented) or {links:[...]}
      const href = b.rel === 'payer-view' ? b.href : (b.links || []).find((l) => l.rel === 'payer-view')?.href;
      return { status: r.status, payer_view_url: href || null, raw: b };
    },

    async getInvoice(id) {
      const r = await api('GET', `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
      return r.body;
    },

    // GET /v2/invoicing/invoices: page is 1-based, page_size 1..100 (default 20), total_required adds total_items/total_pages.
    // Returns { total_items, total_pages, items } where items are invoice objects (id, status, detail, invoicer, ...).
    async listInvoices({ page = 1, page_size = 20, total_required = true, fields } = {}) {
      const q = new URLSearchParams({ page: String(page), page_size: String(Math.min(100, Math.max(1, page_size))), total_required: String(!!total_required) });
      if (fields) q.set('fields', fields);
      const r = await api('GET', `/v2/invoicing/invoices?${q}`);
      const b = r.body || {};
      return { total_items: b.total_items == null ? null : Number(b.total_items), total_pages: b.total_pages == null ? null : Number(b.total_pages), items: Array.isArray(b.items) ? b.items : [] };
    },

    // POST /v2/invoicing/search-invoices (filter in body, paging in query). Same response shape as listInvoices.
    async searchInvoices(filter = {}, { page = 1, page_size = 20, total_required = true } = {}) {
      const q = new URLSearchParams({ page: String(page), page_size: String(Math.min(100, Math.max(1, page_size))), total_required: String(!!total_required) });
      const r = await api('POST', `/v2/invoicing/search-invoices?${q}`, { body: filter });
      const b = r.body || {};
      return { total_items: b.total_items == null ? null : Number(b.total_items), total_pages: b.total_pages == null ? null : Number(b.total_pages), items: Array.isArray(b.items) ? b.items : [] };
    },

    async cancelInvoice(id, { subject, note, send_to_recipient = false, send_to_invoicer = false } = {}) {
      await api('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
        body: { subject, note, send_to_recipient, send_to_invoicer },
      });
      return { ok: true }; // 204 No Content
    },

    // Drafts cannot be cancelled (cancel is for SENT/UNPAID); they are deleted instead (DELETE -> 204).
    async deleteInvoice(id) {
      await api('DELETE', `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
      return { ok: true };
    },

    async verifyWebhookSignature({ headers, body, webhookId }) {
      const h = {};
      for (const [k, v] of Object.entries(headers || {})) h[k.toLowerCase()] = v;
      const rawBody = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body);
      // Embed the original event bytes unchanged (re-serialising can break the CRC32 in the signature).
      const payload =
        '{' +
        [
          ['auth_algo', h['paypal-auth-algo']],
          ['cert_url', h['paypal-cert-url']],
          ['transmission_id', h['paypal-transmission-id']],
          ['transmission_sig', h['paypal-transmission-sig']],
          ['transmission_time', h['paypal-transmission-time']],
          ['webhook_id', webhookId],
        ].map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v == null ? null : v)}`).join(',') +
        `,"webhook_event":${rawBody}}`;
      const r = await api('POST', '/v1/notifications/verify-webhook-signature', { body: payload });
      return !!(r.body && r.body.verification_status === 'SUCCESS');
    },

    async createWebhook(url, eventTypes) {
      const r = await api('POST', '/v1/notifications/webhooks', {
        body: { url, event_types: eventTypes.map((name) => ({ name })) },
      });
      return r.body;
    },

    async listWebhooks() {
      const r = await api('GET', '/v1/notifications/webhooks');
      return (r.body && r.body.webhooks) || [];
    },
  };
}

module.exports = { createPayPalClient, buildInvoiceBody, payerViewUrl, mapError };
