'use strict';
const fs = require('node:fs');
const path = require('node:path');

const EMPTY = () => ({ sellers: {}, decisions: [], invoices: {}, webhook_events: [], seq: 0 });

function createStore(file = path.join(__dirname, '..', 'data', 'store.json')) {
  let data = EMPTY();
  if (file) {
    try { data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* fresh */ }
  }
  function save() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
  return {
    data,
    save,
    nextId(prefix) { data.seq += 1; save(); return `${prefix}_${data.seq}`; },
    upsertSeller(s) { data.sellers[s.id] = { ...(data.sellers[s.id] || {}), ...s }; save(); return data.sellers[s.id]; },
    addDecision(d) { data.decisions.push(d); save(); return d; },
    getDecision(id) { return data.decisions.find((d) => d.id === id) || null; },
    updateDecision(id, patch) { const d = this.getDecision(id); if (d) { Object.assign(d, patch); save(); } return d; },
    removeDecisions(pred) { const gone = []; for (let i = data.decisions.length - 1; i >= 0; i--) if (pred(data.decisions[i])) gone.push(...data.decisions.splice(i, 1)); save(); return gone; },
    decisions() { return data.decisions; },
    setInvoice(id, inv) { data.invoices[id] = { ...(data.invoices[id] || {}), ...inv }; save(); return data.invoices[id]; },
    getInvoice(id) { return data.invoices[id] || null; },
    addWebhookEvent(e) { data.webhook_events.push(e); if (data.webhook_events.length > 500) data.webhook_events.shift(); save(); return e; },
    webhookEvents() { return data.webhook_events; },
    setMeta(k, v) { data.meta = { ...(data.meta || {}), [k]: v }; save(); return v; },
    getMeta(k) { return (data.meta || {})[k] || null; },
    reset() { data = EMPTY(); this.data = data; save(); },
  };
}

module.exports = { createStore };
