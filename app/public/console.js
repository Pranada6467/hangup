(function () {
  'use strict';
  // HangUp screening console. The decisions table and the campaigns table are AG Grid Community (v32.3.3).
  // Everything the reviewer does goes through the server's existing /api/gate/* endpoints.
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let decisions = [], campaigns = [], campIdx = {}, byId = {}, sigs = {}, campSigs = {};
  let selectedId = null, api = null, capi = null, gridOK = false;
  let filterMode = 'all', phoneFilter = null;
  const lastResult = {}; // decision id -> { text, ok }

  function api_(method, path, body) {
    return fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      .then((r) => r.json().catch(() => ({})).then((j) => { if (!r.ok) { const e = new Error(j.message || j.error || ('HTTP ' + r.status)); e.code = j.error; e.status = r.status; throw e; } return j; }));
  }
  // Safe-to-repeat calls only (the demo story steps): retries 502/503/504 and network errors with backoff.
  // The server makes these idempotent, so a retry cannot create a second invoice.
  function apiRetry(method, path, body, onRetry) { return HangupRetry.withRetry(() => api_(method, path, body), { onRetry }); }
  function err(el, e) { el.innerHTML = '<div class="err-box" role="alert">' + esc(e.code ? e.code + ': ' : '') + esc(e.message || e) + '</div>'; }

  // ---- small helpers over a decision
  // Display order only (the judge is unchanged). The cell shows the first quote, so lead with the one that explains the verdict: the remote-access
  // mention when the judge's reasons include REMOTE_ACCESS_OR_REFUND, else the quote that carries a phone number; otherwise the judge's own order.
  const REMOTE_Q = /remote[- ]?(access|control|support|session)|teamviewer|anydesk|logmein|screen ?connect/i;
  const PHONE_Q = /\+?\d[\d\s().-]{5,}\d/;
  const ev = (d) => {
    const e = d.evidence; if (!e) return [];
    const q = typeof e === 'string' ? [e] : e.map((x) => (typeof x === 'string' ? x : (x && x.quote) || '')).filter(Boolean);
    let i = (d.reasons || []).indexOf('REMOTE_ACCESS_OR_REFUND') >= 0 ? q.findIndex((x) => REMOTE_Q.test(x)) : -1;
    if (i < 0) i = q.findIndex((x) => PHONE_Q.test(x) || REMOTE_Q.test(x));
    return i > 0 ? [q[i]].concat(q.slice(0, i), q.slice(i + 1)) : q;
  };
  const nm = (n) => String(n == null ? '' : n).replace(/^hangup STAGED /i, '');
  const fmtPhone = (p) => { const s = String(p || ''); return /^\d{10}$/.test(s) ? s.slice(0, 3) + '-' + s.slice(3, 6) + '-' + s.slice(6) : s; };
  const phone = (d) => fmtPhone((d.phones && d.phones[0]) || '');
  const fmt = (t) => { if (!t) return ''; const d = new Date(t); return isNaN(d) ? String(t) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const fmtTime = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleTimeString(); };
  const isHeld = (d) => d.status === 'HELD' || d.status === 'EXPIRED_NEEDS_REVIEW';
  const STATUS_LABEL = { HELD: 'Held for review', BLOCKED: 'Blocked', SENT: 'Sent', RELEASED: 'Released', REWRITTEN_SENT: 'Sent (template note)', BLOCK_CONFIRMED: 'Block confirmed', CAMPAIGN_CANCELLED: 'Campaign cancelled', SENT_WITHOUT_GATE: 'Sent, no gate', EXPIRED_NEEDS_REVIEW: 'Hold expired', PAYPAL_FAILED: 'PayPal failed', PENDING: 'Pending' };
  const VERDICT_LABEL = { LIKELY_CALLBACK_SCAM: 'LIKELY SCAM', SUSPICIOUS: 'SUSPICIOUS', NO_CALLBACK_PATTERN: 'NO PATTERN' };
  const VERDICT_BADGE = { LIKELY_CALLBACK_SCAM: 'BLOCK', SUSPICIOUS: 'HOLD', NO_CALLBACK_PATTERN: 'ALLOW' };
  const verdictText = (d) => VERDICT_LABEL[d.verdict] || 'not screened';
  const sourceOf = (d) => (d.source === 'backfill' ? 'backfill' : d.gate_bypassed ? 'ungated' : 'gate');
  const status = (d) => (d.paypal && d.paypal.status) || d.invoice_status || '';

  // ---- campaign / eligibility logic (mirrors the server's rules; the server enforces them again)
  function campaignOf(d) {
    let found = null;
    (d.phones || []).forEach((p) => { const c = campIdx[p]; if (c && (!found || (c.flagged && !found.flagged))) found = c; });
    return found;
  }
  function cancelInfo(d) {
    const st = status(d);
    if (st === 'CANCELLED' || st === 'DELETED') return { ok: false, reason: 'Already ' + st.toLowerCase() };
    if (!d.invoice_id) return { ok: false, reason: 'No invoice was created' };
    if (d.verdict === 'NO_CALLBACK_PATTERN') return { ok: false, reason: 'Benign invoice: HangUp never cancels it' };
    if (!d.verdict) return { ok: false, reason: 'Not screened yet' };
    const c = campaignOf(d);
    if (!c || !c.flagged) return { ok: false, reason: 'Not in a flagged campaign (needs 3+ sellers on one number)' };
    if (!(c.scam_members || []).includes(d.id)) return { ok: false, reason: 'Not a flagged member of the campaign' };
    if (!(c.cancellable || []).includes(d.invoice_id)) return { ok: false, reason: 'Invoice is ' + (st || 'unsent') + ', not cancellable' };
    return { ok: true, campaign: c };
  }
  function eligibility(d) {
    if (isHeld(d)) return { sel: true, kind: 'review', text: 'Can release or block' };
    const ci = cancelInfo(d);
    if (ci.ok) return { sel: true, kind: 'cancel', text: 'Can cancel with campaign ' + fmtPhone(ci.campaign.phone), campaign: ci.campaign };
    return { sel: false, text: ci.reason };
  }
  function campaignLabel(d) {
    const c = campaignOf(d); if (!c) return '';
    return (c.flagged ? 'FLAGGED, ' : 'watching, ') + c.seller_count + ' seller' + (c.seller_count === 1 ? '' : 's');
  }

  // ---- evidence: a snippet of the invoice text around the LLM's verbatim quote, with the matched span highlighted
  function texts(d) {
    const i = d.input || {}; const out = [];
    if (d.note || i.note) out.push({ label: 'Note', text: d.note || i.note });
    (i.items || []).forEach((it, n) => { if (it.name) out.push({ label: 'Item ' + (n + 1), text: it.name }); if (it.description) out.push({ label: 'Item ' + (n + 1) + ' description', text: it.description }); });
    if (d.terms || i.terms) out.push({ label: 'Terms', text: d.terms || i.terms });
    return out;
  }
  function highlight(text, quotes) {
    text = String(text || ''); const low = text.toLowerCase(), rs = [];
    quotes.forEach((q) => { q = q.trim(); if (q.length < 3) return; const i = low.indexOf(q.toLowerCase()); if (i >= 0) rs.push([i, i + q.length]); });
    rs.sort((a, b) => a[0] - b[0]);
    const m = []; rs.forEach((r) => { const l = m[m.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else m.push(r.slice()); });
    let o = '', p = 0; m.forEach((r) => { o += esc(text.slice(p, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>'; p = r[1]; });
    return o + esc(text.slice(p));
  }
  function snippetHtml(d) {
    const qs = ev(d); if (!qs.length) return '<span class="nosel">no evidence quote</span>';
    const q = qs[0], lq = q.toLowerCase();
    for (const t of texts(d)) {
      const i = t.text.toLowerCase().indexOf(lq);
      if (i >= 0) {
        const a = Math.max(0, i - 36), b = Math.min(t.text.length, i + q.length + 36);
        return (a > 0 ? '…' : '') + esc(t.text.slice(a, i)) + '<mark>' + esc(t.text.slice(i, i + q.length)) + '</mark>' + esc(t.text.slice(i + q.length, b)) + (b < t.text.length ? '…' : '');
      }
    }
    return '<mark>' + esc(q) + '</mark>';
  }

  // ---- dialogs
  function confirmDialog(title, bodyHtml, okLabel, danger) {
    const dlg = $('dlg');
    if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(title + '\n' + bodyHtml.replace(/<[^>]+>/g, ' ')));
    $('dlgT').textContent = title; $('dlgB').innerHTML = bodyHtml;
    const ok = $('dlgOk'); ok.textContent = okLabel; ok.className = 'btn small' + (danger ? ' danger' : '');
    return new Promise((resolve) => {
      const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok'); };
      dlg.returnValue = 'cancel'; dlg.addEventListener('close', done); dlg.showModal();
    });
  }
  const invList = (rows) => '<ul class="adv" data-testid="confirm-invoices">' + rows.map((d) => '<li><span class="mono" data-inv="' + esc(d.invoice_id || '') + '">' + esc(d.invoice_id || 'no invoice') + '</span> ' + esc(nm(d.seller_name)) + (d.staged ? ' <span class="tag">STAGED</span>' : '') + ' <span class="st st-' + esc(status(d)) + '">' + esc(status(d) || 'none') + '</span></li>').join('') + '</ul>';

  // ---- decisions grid
  const badge = (cls, text) => '<span class="badge b-' + esc(cls) + '">' + esc(text) + '</span>';
  const cols = [
    { colId: 'seller', headerName: 'Seller', width: 200, filter: 'agTextColumnFilter', tooltipValueGetter: (p) => p.data && nm(p.data.seller_name),
      valueGetter: (p) => nm(p.data.seller_name || p.data.seller_id), cellRenderer: (p) => '<span class="cell2"><span>' + esc(p.value) + '</span>' + (p.data.staged ? '<span><span class="tag">STAGED</span></span>' : '') + '</span>' },
    { colId: 'action', headerName: 'Action', width: 175, filter: 'agTextColumnFilter', // value includes the sub-line so an in-place update re-renders the cell
      valueGetter: (p) => p.data.action + ' · ' + (p.data.action === 'SENT_WITHOUT_GATE' ? (p.data.would_have_action ? 'HangUp would say ' + p.data.would_have_action : 'never screened') : (STATUS_LABEL[p.data.status] || p.data.status)),
      cellRenderer: (p) => { const d = p.data; return '<span class="cell2"><span>' + badge(d.action === 'SENT_WITHOUT_GATE' ? 'SENT_WITHOUT_GATE' : d.action, d.action) + '</span><small>' + (d.action === 'SENT_WITHOUT_GATE' ? (d.would_have_action ? 'HangUp would say ' + esc(d.would_have_action) : 'never screened') : esc(STATUS_LABEL[d.status] || d.status)) + '</small></span>'; } },
    { colId: 'verdict', headerName: 'Verdict', width: 145, filter: 'agTextColumnFilter', valueGetter: (p) => verdictText(p.data),
      cellRenderer: (p) => (p.data.verdict ? badge(VERDICT_BADGE[p.data.verdict] || 'REWRITE', p.value) : '<span class="nosel">not screened</span>') },
    { colId: 'invoice', headerName: 'PayPal invoice (live status)', width: 200, filter: 'agTextColumnFilter',
      valueGetter: (p) => (p.data.invoice_id ? p.data.invoice_id + ' ' + status(p.data) : 'none'),
      cellRenderer: (p) => { const d = p.data; return d.invoice_id ? '<span class="cell2"><span class="mono">' + esc(d.invoice_id) + '</span><span><span class="st st-' + esc(status(d)) + '">' + esc(status(d) || '?') + '</span></span></span>' : '<span class="nosel">none created</span>'; } },
    { colId: 'reviewer', headerName: 'Last action / why not selectable', width: 220, filter: 'agTextColumnFilter',
      valueGetter: (p) => (lastResult[p.data.id] ? lastResult[p.data.id].text : eligibility(p.data).text),
      tooltipValueGetter: (p) => p.value,
      cellRenderer: (p) => '<span class="snip ' + (lastResult[p.data.id] ? (lastResult[p.data.id].ok ? '' : 'err-text') : 'nosel') + '">' + esc(p.value) + '</span>' },
    { colId: 'evidence', headerName: 'Evidence (AI quote in the invoice text)', flex: 1, minWidth: 260, filter: 'agTextColumnFilter', valueGetter: (p) => ev(p.data).join(' | '),
      tooltipValueGetter: (p) => p.value, cellRenderer: (p) => '<span class="snip">' + snippetHtml(p.data) + '</span>' },
    { colId: 'reasons', headerName: 'Reasons', width: 210, filter: 'agTextColumnFilter', valueGetter: (p) => (p.data.reasons || []).join('; '),
      tooltipValueGetter: (p) => Object.keys(p.data.reason_labels || {}).map((k) => p.data.reason_labels[k]).join('\n'),
      cellRenderer: (p) => '<span class="cell2" style="flex-direction:row;flex-wrap:wrap">' + (p.data.reasons || []).map((r) => '<span class="rc" title="' + esc((p.data.reason_labels || {})[r] || r) + '">' + esc(r) + '</span>').join('') + '</span>' },
    { colId: 'phone', headerName: 'Callback number', width: 130, filter: 'agTextColumnFilter', valueGetter: (p) => phone(p.data), cellRenderer: (p) => '<span class="mono">' + esc(p.value) + '</span>' },
    { colId: 'campaign', headerName: 'Campaign', width: 150, filter: 'agTextColumnFilter', valueGetter: (p) => campaignLabel(p.data) },
    { colId: 'source', headerName: 'Source', width: 110, filter: 'agTextColumnFilter', valueGetter: (p) => sourceOf(p.data) + (p.data.staged ? ' (STAGED)' : '') },
    { colId: 'time', headerName: 'Time', width: 120, field: 'created_at', sort: 'desc', filter: 'agDateColumnFilter', valueFormatter: (p) => fmt(p.value),
      filterParams: { comparator: (filterDate, cell) => { const t = new Date(cell); t.setHours(0, 0, 0, 0); return t < filterDate ? -1 : t > filterDate ? 1 : 0; } } },
  ];
  const ccols = [
    { colId: 'phone', headerName: 'Callback number', width: 150, filter: 'agTextColumnFilter', valueGetter: (p) => (p.data.total ? 'TOTAL' : fmtPhone(p.data.phone)), cellRenderer: (p) => '<span class="mono">' + esc(p.value) + '</span>' },
    { colId: 'flag', headerName: 'Flagged', width: 190, filter: 'agTextColumnFilter', valueGetter: (p) => (p.data.total ? p.data.flaggedCount + ' flagged' : p.data.flagged ? 'FLAGGED' : 'watching'),
      cellRenderer: (p) => (p.data.total ? esc(p.value) : badge(p.data.flagged ? 'BLOCK' : 'REWRITE', p.value === 'FLAGGED' ? 'FLAGGED CAMPAIGN' : 'watching')) },
    { colId: 'sellers', headerName: 'Sellers', width: 90, type: 'numericColumn', filter: 'agNumberColumnFilter', valueGetter: (p) => p.data.seller_count, tooltipValueGetter: (p) => (p.data.sellerNames || []).join(', ') },
    { colId: 'decisions', headerName: 'Decisions', width: 100, type: 'numericColumn', filter: 'agNumberColumnFilter', valueGetter: (p) => p.data.decisionCount },
    { colId: 'cancellable', headerName: 'Cancellable', width: 115, type: 'numericColumn', filter: 'agNumberColumnFilter', valueGetter: (p) => p.data.cancellableCount },
    { colId: 'benign', headerName: 'Benign (never cancelled)', width: 160, type: 'numericColumn', filter: 'agNumberColumnFilter', valueGetter: (p) => p.data.benignCount },
    { colId: 'statuses', headerName: 'PayPal statuses', flex: 1, minWidth: 150, filter: 'agTextColumnFilter', valueGetter: (p) => p.data.statuses },
    { colId: 'act', headerName: '', width: 250, sortable: false, filter: false, floatingFilter: false, resizable: false,
      cellRenderer: (p) => {
        if (p.data.total) return '';
        const c = p.data;
        return '<button class="btn danger small xs" data-cancel-camp="' + esc(c.phone) + '"' + (c.flagged && c.cancellableCount ? '' : ' disabled') + '>Cancel ' + c.cancellableCount + ' sent</button> <button class="btn secondary small xs" data-show-camp="' + esc(c.phone) + '">Show rows</button>';
      } },
  ];

  function dark() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.getAttribute('data-theme') !== 'light'; }
  function externalPass(d) {
    if (phoneFilter && !(d.phones || []).includes(phoneFilter)) return false;
    if (filterMode === 'review') return isHeld(d);
    if (filterMode === 'blocked') return d.action === 'BLOCK' || d.status === 'BLOCKED' || d.status === 'BLOCK_CONFIRMED';
    if (filterMode === 'campaigns') { const c = campaignOf(d); return !!(c && c.flagged); }
    return true;
  }
  function initGrids() {
    if (!window.agGrid) return false;
    const theme = dark() ? 'ag-theme-quartz-dark' : 'ag-theme-quartz';
    $('grid').className = theme; $('cgrid').className = theme;
    api = agGrid.createGrid($('grid'), {
      columnDefs: cols, rowData: [], suppressNoRowsOverlay: true, getRowId: (p) => p.data.id,
      defaultColDef: { sortable: true, resizable: true, filter: true, floatingFilter: true, enableCellChangeFlash: true, suppressHeaderMenuButton: true },
      suppressColumnVirtualisation: true, cellFlashDuration: 1200, cellFadeDuration: 800, rowHeight: 54, headerHeight: 36, floatingFiltersHeight: 32, tooltipShowDelay: 400,
      rowSelection: { mode: 'multiRow', checkboxes: true, headerCheckbox: true, enableClickSelection: false, selectAll: 'filtered', isRowSelectable: (node) => !!(node.data && eligibility(node.data).sel) },
      selectionColumnDef: { width: 48, pinned: 'left' },
      isExternalFilterPresent: () => filterMode !== 'all' || !!phoneFilter,
      doesExternalFilterPass: (node) => externalPass(node.data),
      rowClassRules: { 'v-LIKELY_CALLBACK_SCAM': (p) => !!p.data && p.data.verdict === 'LIKELY_CALLBACK_SCAM', 'v-SUSPICIOUS': (p) => !!p.data && p.data.verdict === 'SUSPICIOUS', 'v-NO_CALLBACK_PATTERN': (p) => !!p.data && p.data.verdict === 'NO_CALLBACK_PATTERN', 'v-none': (p) => !!p.data && !p.data.verdict }, // rules re-run on every in-place update
      onRowClicked: (e) => { if (e.event && e.event.target && e.event.target.closest && e.event.target.closest('.ag-selection-checkbox,.ag-checkbox')) return; openDrawer(e.data.id); },
      onCellKeyDown: (e) => { if (e.event && e.event.key === 'Enter' && e.data) openDrawer(e.data.id); },
      onSelectionChanged: updateBulk, onFilterChanged: onFilterChanged, onModelUpdated: onFilterChanged,
    });
    capi = agGrid.createGrid($('cgrid'), {
      columnDefs: ccols, rowData: [], getRowId: (p) => p.data.phone || 'TOTAL',
      defaultColDef: { sortable: true, resizable: true, filter: true, floatingFilter: true, enableCellChangeFlash: true, suppressHeaderMenuButton: true },
      cellFlashDuration: 1200, cellFadeDuration: 800, rowHeight: 50, headerHeight: 36, floatingFiltersHeight: 32,
      pinnedTopRowData: [{ total: true, phone: 'TOTAL', seller_count: 0, decisionCount: 0, cancellableCount: 0, benignCount: 0, flaggedCount: 0, statuses: '' }],
      rowClassRules: { 'pinned-total': (p) => !!p.node.rowPinned, 'v-LIKELY_CALLBACK_SCAM': (p) => !p.node.rowPinned && !!p.data && !!p.data.flagged, 'v-none': (p) => !p.node.rowPinned && !!p.data && !p.data.flagged },
      onCellClicked: (e) => {
        const t = e.event && e.event.target && e.event.target.closest && e.event.target.closest('button'); if (!t || t.disabled) return;
        if (t.hasAttribute('data-cancel-camp')) cancelCampaignUI(t.getAttribute('data-cancel-camp'));
        if (t.hasAttribute('data-show-camp')) { phoneFilter = t.getAttribute('data-show-camp'); filterMode = 'all'; showTab('dec'); syncFilterUI(); api.onFilterChanged(); }
      },
    });
    return true;
  }

  // ---- applying data to the grids without rebuilding them
  const sig = (d) => JSON.stringify(d);
  function applyDecisions(list, full) {
    const add = [], upd = [], seen = {};
    list.forEach((d) => {
      seen[d.id] = true; const s = sig(d), old = sigs[d.id];
      if (old === undefined) add.push(d); else if (old !== s) upd.push(d);
      sigs[d.id] = s; byId[d.id] = d;
    });
    const rem = [];
    if (full) Object.keys(sigs).forEach((id) => { if (!seen[id]) { rem.push(byId[id]); delete sigs[id]; delete byId[id]; delete lastResult[id]; } });
    decisions = Object.keys(byId).map((id) => byId[id]);
    const emptyEl = $('empty'); emptyEl.classList.toggle('hidden', decisions.length > 0);
    emptyEl.innerHTML = 'Nothing staged yet. <strong>Press Reset demo, then step 1</strong> (Send A and B ungated). Or submit an invoice with the form.';
    $('seedBanner').classList.toggle('hidden', !decisions.some((d) => d.staged));
    if (api) { if (add.length || upd.length || rem.length) api.applyTransaction({ add, update: upd, remove: rem }); }
    else renderFallback();
    afterData(add.length || upd.length || rem.length);
  }
  function applyCampaigns(list) {
    campIdx = {}; list.forEach((c) => { campIdx[c.phone] = c; });
    const rows = list.map((c) => {
      const cnt = {}; (c.invoices || []).forEach((x) => { cnt[x.status || '?'] = (cnt[x.status || '?'] || 0) + 1; });
      return { phone: c.phone, flagged: c.flagged, seller_count: c.seller_count, sellerNames: (c.decisions || []).map((x) => nm(x.seller_name)), decisionCount: (c.decisions || []).length,
        cancellableCount: c.flagged ? (c.cancellable || []).length : 0 /* only a flagged campaign can be cancelled */, benignCount: (c.benign_members || []).length, cancellable: c.cancellable || [],
        statuses: Object.keys(cnt).map((k) => cnt[k] + ' ' + k).join(', ') || 'no invoices' };
    });
    $('nCamp').textContent = list.filter((c) => c.flagged).length + '/' + list.length;
    if (capi) {
      const add = [], upd = [], seen = {};
      rows.forEach((r) => { seen[r.phone] = true; const s = sig(r); if (campSigs[r.phone] === undefined) add.push(r); else if (campSigs[r.phone] !== s) upd.push(r); campSigs[r.phone] = s; });
      const rem = Object.keys(campSigs).filter((p) => !seen[p]).map((p) => { delete campSigs[p]; return { phone: p }; });
      capi.applyTransaction({ add, update: upd, remove: rem });
      const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
      const distinct = new Set(); list.forEach((c) => (c.sellers || []).forEach((x) => distinct.add(x)));
      capi.setGridOption('pinnedTopRowData', [{ total: true, phone: 'TOTAL', seller_count: distinct.size, decisionCount: sum('decisionCount'), cancellableCount: sum('cancellableCount'), benignCount: sum('benignCount'),
        flaggedCount: rows.filter((r) => r.flagged).length, statuses: rows.length + ' number' + (rows.length === 1 ? '' : 's') + ' tracked' }]);
    } else renderCamps();
  }
  function afterData(changed) {
    if (api) {
      api.forEachNode((n) => { if (n.data) n.setRowSelectable(eligibility(n.data).sel); });
      api.refreshCells({ columns: ['campaign', 'reviewer'], force: true });
      api.getSelectedNodes().forEach((n) => { if (n.data && !eligibility(n.data).sel) n.setSelected(false); });
    }
    updateCounts(); updateBulk(); onFilterChanged();
    if (selectedId && byId[selectedId] && !$('drawer').classList.contains('hidden') && changed) renderDrawer(true);
  }
  function updateCounts() {
    const n = { all: decisions.length, review: 0, blocked: 0, campaigns: 0 };
    decisions.forEach((d) => { if (isHeld(d)) n.review++; if (d.action === 'BLOCK' || d.status === 'BLOCKED' || d.status === 'BLOCK_CONFIRMED') n.blocked++; const c = campaignOf(d); if (c && c.flagged) n.campaigns++; });
    document.querySelectorAll('[data-count]').forEach((el) => { el.textContent = n[el.getAttribute('data-count')]; });
  }
  function onFilterChanged() {
    if (!api) return;
    $('exportCsv').textContent = 'Export CSV (' + api.getDisplayedRowCount() + ' row' + (api.getDisplayedRowCount() === 1 ? '' : 's') + ')';
  }
  function syncFilterUI() {
    document.querySelectorAll('[data-filter]').forEach((b) => { const on = b.getAttribute('data-filter') === filterMode && !phoneFilter; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const pf = $('phoneFilter'); pf.classList.toggle('hidden', !phoneFilter);
    pf.innerHTML = phoneFilter ? 'Number ' + esc(fmtPhone(phoneFilter)) + ' <button class="linkbtn" id="pfx" type="button" aria-label="Remove number filter">×</button>' : '';
    if (phoneFilter) $('pfx').onclick = () => { phoneFilter = null; syncFilterUI(); api && api.onFilterChanged(); };
  }
  document.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { filterMode = b.getAttribute('data-filter'); phoneFilter = null; syncFilterUI(); if (api) api.onFilterChanged(); }; });
  $('quick').oninput = () => { if (api) api.setGridOption('quickFilterText', $('quick').value); };
  $('clearFilters').onclick = () => { filterMode = 'all'; phoneFilter = null; $('quick').value = ''; syncFilterUI(); if (api) { api.setFilterModel(null); api.setGridOption('quickFilterText', ''); api.onFilterChanged(); } };
  $('exportCsv').onclick = () => {
    if (!api) return;
    api.exportDataAsCsv({ fileName: 'hangup-incident-' + new Date().toISOString().slice(0, 10) + '.csv', columnKeys: cols.map((c) => c.colId) });
  };

  // ---- tabs
  function showTab(which) {
    const camps = which === 'camp';
    $('tabDec').setAttribute('aria-selected', camps ? 'false' : 'true'); $('tabCamp').setAttribute('aria-selected', camps ? 'true' : 'false');
    $('pDec').classList.toggle('hidden', camps); $('pCamp').classList.toggle('hidden', !camps);
  }
  $('tabDec').onclick = () => showTab('dec'); $('tabCamp').onclick = () => showTab('camp');

  // ---- bulk actions
  function selectedRows() { return api ? api.getSelectedRows().filter((d) => eligibility(d).sel) : []; }
  function plan() {
    const rows = selectedRows();
    if (!rows.length) return { rows, kind: null, why: 'Tick rows to act on them. A row is only tickable when HangUp can act on it.' };
    const kinds = new Set(rows.map((d) => eligibility(d).kind));
    if (kinds.size > 1) return { rows, kind: null, why: rows.length + ' selected, mixing held and sent rows. Pick one kind.' };
    if (kinds.has('review')) return { rows, kind: 'review', why: rows.length + ' held invoice' + (rows.length === 1 ? '' : 's') + ' selected.' };
    const phones = new Set(rows.map((d) => eligibility(d).campaign.phone));
    if (phones.size > 1) return { rows, kind: null, why: rows.length + ' selected, but they carry different callback numbers. Pick rows from one campaign.' };
    return { rows, kind: 'cancel', phone: [...phones][0], why: rows.length + ' sent invoice' + (rows.length === 1 ? '' : 's') + ' in the campaign for ' + fmtPhone([...phones][0]) + '.' };
  }
  function updateBulk() {
    const p = plan();
    $('selInfo').textContent = p.why;
    $('bulkRelease').disabled = $('bulkBlock').disabled = p.kind !== 'review';
    $('bulkCancel').disabled = p.kind !== 'cancel';
    $('bulkRelease').textContent = 'Release selected' + (p.kind === 'review' ? ' (' + p.rows.length + ')' : '');
    $('bulkBlock').textContent = 'Block selected' + (p.kind === 'review' ? ' (' + p.rows.length + ')' : '');
    $('bulkCancel').textContent = 'Cancel selected sent invoices' + (p.kind === 'cancel' ? ' (' + p.rows.length + ')' : '');
  }
  // Re-fetch the invoices' status from PayPal (server reads PayPal, not our cache) and fold it into the grid.
  function refetch(ids) {
    return api_('POST', '/api/gate/refresh', { decision_ids: ids }).then((r) => { applyDecisions(r.decisions || [], false); return r.results || []; });
  }
  const liveNote = (r) => (r && r.status ? ' → PayPal says ' + r.status + (r.fetched_at ? ' (re-fetched ' + fmtTime(r.fetched_at) + ')' : '') : '');
  function bulkDecision(rows, act, doing) {
    const done = [];
    return rows.reduce((chain, d) => chain.then(() => api_('POST', '/api/gate/decisions/' + encodeURIComponent(d.id) + '/' + act, act === 'release' && d.status === 'EXPIRED_NEEDS_REVIEW' ? { reconfirm: true } : undefined)
      .then((nd) => { applyDecisions([nd], false); lastResult[d.id] = { ok: true, text: doing }; done.push(d.id); })
      .catch((e) => { lastResult[d.id] = { ok: false, text: 'Failed: ' + (e.code || '') + ' ' + e.message }; done.push(d.id); })), Promise.resolve())
      .then(() => refetch(done)).then((res) => { res.forEach((r) => { if (lastResult[r.decision_id] && lastResult[r.decision_id].ok) lastResult[r.decision_id].text += liveNote(r); }); });
  }
  function afterBulk(msg) { api.refreshCells({ columns: ['reviewer'], force: true }); api.deselectAll(); return refresh().then(() => { $('bulkMsg').innerHTML = '<div class="banner" role="status">' + esc(msg) + '</div>'; }); }
  $('bulkRelease').onclick = () => {
    const p = plan(); if (p.kind !== 'review') return;
    confirmDialog('Release ' + p.rows.length + ' held invoice' + (p.rows.length === 1 ? '' : 's') + '?', '<p>PayPal will send these draft invoices to their recipients (sandbox: nothing is emailed). Invoice IDs:</p>' + invList(p.rows) + '<p class="prov">Each release is logged in the invoice\'s action history.</p>', 'Release ' + p.rows.length, false).then((ok) => {
      if (!ok) return; $('bulkMsg').innerHTML = '';
      bulkDecision(p.rows, 'release', 'Released').then(() => afterBulk('Release finished for ' + p.rows.length + ' row(s). Status below was re-fetched from PayPal.')).catch((e) => err($('bulkMsg'), e));
    });
  };
  $('bulkBlock').onclick = () => {
    const p = plan(); if (p.kind !== 'review') return;
    confirmDialog('Block ' + p.rows.length + ' held invoice' + (p.rows.length === 1 ? '' : 's') + '?', '<p>The draft invoices below are deleted at PayPal and never sent. Invoice IDs:</p>' + invList(p.rows), 'Block ' + p.rows.length, true).then((ok) => {
      if (!ok) return; $('bulkMsg').innerHTML = '';
      bulkDecision(p.rows, 'block', 'Block confirmed, draft deleted').then(() => afterBulk('Block finished for ' + p.rows.length + ' row(s).')).catch((e) => err($('bulkMsg'), e));
    });
  };
  function runCancel(phoneDigits, rows, onlyIds) {
    const ids = rows.map((d) => d.invoice_id);
    const c = campIdx[phoneDigits];
    const benign = c ? (c.benign_members || []).length : 0;
    return confirmDialog('Cancel ' + rows.length + ' sent invoice' + (rows.length === 1 ? '' : 's') + ' for ' + fmtPhone(phoneDigits) + '?',
      '<p>PayPal will cancel these invoices. Only invoices whose own text was flagged are ever cancelled; the server checks this again.</p>' + invList(rows) +
      (benign ? '<p class="prov">' + benign + ' benign invoice' + (benign === 1 ? '' : 's') + ' share this number and will NOT be touched.</p>' : ''), 'Cancel ' + ids.length + ' at PayPal', true).then((ok) => {
      if (!ok) return null; $('bulkMsg').innerHTML = '';
      return api_('POST', '/api/gate/campaigns/' + encodeURIComponent(phoneDigits) + '/cancel', onlyIds ? { decision_ids: onlyIds } : undefined).then((r) => {
        const mine = []; (r.results || []).forEach((x) => { mine.push(x.decision_id); lastResult[x.decision_id] = { ok: !!x.ok, text: x.ok ? 'Cancelled via campaign' : (x.skipped ? 'Skipped: ' + x.skipped : 'Cancel failed: ' + (x.error || '')) }; });
        (r.refused || []).forEach((x) => { lastResult[x.decision_id] = { ok: false, text: 'Refused: ' + x.reason }; });
        return refetch(mine).then((res) => { res.forEach((x) => { if (lastResult[x.decision_id] && lastResult[x.decision_id].ok) lastResult[x.decision_id].text += liveNote(x); }); return r; });
      }).then((r) => { api && api.refreshCells({ columns: ['reviewer'], force: true }); if (api) api.deselectAll(); return refresh().then(() => { $('bulkMsg').innerHTML = '<div class="banner" role="status">Cancel finished: ' + (r.results || []).filter((x) => x.ok).length + ' cancelled' + ((r.refused || []).length ? ', ' + r.refused.length + ' refused' : '') + '. Statuses re-fetched from PayPal.</div>'; }); })
        .catch((e) => err($('bulkMsg'), e));
    });
  }
  $('bulkCancel').onclick = () => { const p = plan(); if (p.kind === 'cancel') runCancel(p.phone, p.rows, p.rows.map((d) => d.id)); };
  function cancelCampaignUI(phoneDigits) {
    const c = campIdx[phoneDigits]; if (!c) return;
    const rows = decisions.filter((d) => (c.scam_members || []).includes(d.id) && (c.cancellable || []).includes(d.invoice_id));
    if (!rows.length) return;
    runCancel(phoneDigits, rows, null);
  }

  // ---- fallback (AG Grid did not load): plain table + campaign cards
  function renderFallback() {
    const h = '<table style="width:100%;border-collapse:collapse;font-size:.9rem"><caption class="prov" style="text-align:left;padding:4px">AG Grid could not load; showing a plain table (bulk actions need the grid; the detail drawer still works).</caption><thead><tr>' +
      ['Time', 'Seller', 'Action', 'Verdict', 'Callback number', 'Evidence', 'PayPal invoice', 'Staged', 'Expires'].map((c) => '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--line)">' + c + '</th>').join('') + '</tr></thead><tbody>' +
      decisions.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((d) => {
        const x = d.paypal;
        return '<tr tabindex="0" data-id="' + esc(d.id) + '" style="cursor:pointer;border-bottom:1px solid var(--line)"><td>' + esc(fmt(d.created_at)) + '</td><td>' + esc(nm(d.seller_name || d.seller_id)) + '</td><td>' + badge(d.action, d.action) + '</td><td>' + esc(d.verdict || 'not screened yet') + '</td><td>' + esc(phone(d)) + '</td><td>' + esc(ev(d).join(' | ')) + '</td><td>' + (x ? '<span class="mono">' + esc(x.invoice_id) + '</span> ' + esc(x.status || '') : 'none') + '</td><td>' + (d.staged ? '<span class="tag">STAGED</span>' : '') + '</td><td>' + esc(fmt(d.expires_at)) + '</td></tr>';
      }).join('') + '</tbody></table>';
    $('fallback').innerHTML = h;
    $('fallback').querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.onclick = () => openDrawer(tr.getAttribute('data-id'));
      tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(tr.getAttribute('data-id')); } };
    });
  }
  function renderCamps() {
    const el = $('camps'); $('cgrid').classList.add('hidden');
    const list = Object.keys(campIdx).map((k) => campIdx[k]);
    if (!list.length) { el.innerHTML = '<div class="empty">No callback numbers found in any decision yet.</div>'; return; }
    el.innerHTML = list.map((c) => '<div class="camp ' + (c.flagged ? 'flag' : '') + '"><div class="row"><strong class="mono">' + esc(fmtPhone(c.phone)) + '</strong>' + (c.flagged ? badge('BLOCK', 'FLAGGED CAMPAIGN') : badge('REWRITE', 'watching')) + '<span>' + c.seller_count + ' seller(s)</span></div>' +
      '<div style="margin-top:6px">PayPal invoices with this number: ' + ((c.invoices || []).map((x) => '<span class="mono">' + esc(x.invoice_id) + '</span> (' + esc(x.status || '?') + (x.flagged === false ? ', not flagged, never cancelled' : '') + ')').join(', ') || 'none') + '</div>' +
      '<div style="margin-top:8px"><button class="btn danger small" data-fb-cancel="' + esc(c.phone) + '"' + (c.flagged && (c.cancellable || []).length ? '' : ' disabled') + '>Cancel ' + (c.cancellable || []).length + ' sent invoice(s)</button></div></div>').join('');
    el.querySelectorAll('[data-fb-cancel]').forEach((b) => { b.onclick = () => { const c = campIdx[b.getAttribute('data-fb-cancel')]; confirmDialog('Cancel ' + (c.cancellable || []).length + ' invoice(s)?', '<ul class="adv">' + (c.cancellable || []).map((i) => '<li class="mono">' + esc(i) + '</li>').join('') + '</ul>', 'Cancel at PayPal', true).then((ok) => { if (ok) api_('POST', '/api/gate/campaigns/' + encodeURIComponent(c.phone) + '/cancel').then(refresh).catch((e) => err($('bulkMsg'), e)); }); }; });
  }

  // ---- detail drawer
  function openDrawer(id) { selectedId = id; $('drawer').classList.remove('hidden'); renderDrawer(false); if (!arguments[1]) $('drawerClose').focus(); }
  function closeDrawer() { selectedId = null; $('drawer').classList.add('hidden'); }
  $('drawerClose').onclick = closeDrawer;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('drawer').classList.contains('hidden') && !($('dlg') && $('dlg').open)) closeDrawer(); });
  function renderDrawer(keepScroll) {
    const d = byId[selectedId], el = $('detail'); if (!d) { el.innerHTML = '<div class="empty">That decision is no longer in the list.</div>'; return; }
    const top = $('drawer').scrollTop, q = ev(d), x = d.paypal, el_ = eligibility(d);
    let h = '<p>' + badge(d.action === 'SENT_WITHOUT_GATE' ? 'SENT_WITHOUT_GATE' : d.action, d.action) + ' ' + (d.verdict ? badge(VERDICT_BADGE[d.verdict], verdictText(d)) : '<span class="nosel">not screened</span>') + (d.staged ? ' <span class="tag">STAGED</span>' : '') + (d.source === 'backfill' ? ' <span class="tag">backfill scan</span>' : '') + '</p>' +
      '<dl class="meta"><dt>Seller</dt><dd>' + esc(nm(d.seller_name || '')) + ' <span class="mono">' + esc(d.seller_id || '') + '</span></dd>' +
      '<dt>Status</dt><dd>' + esc(STATUS_LABEL[d.status] || d.status) + (d.would_have_action ? ' · HangUp would have said ' + esc(d.would_have_action) : '') + '</dd>' +
      '<dt>Callback</dt><dd class="mono">' + esc((d.phones || []).map(fmtPhone).join(', ') || 'none found') + '</dd>' +
      '<dt>Campaign</dt><dd>' + esc(campaignLabel(d) || 'none') + '</dd></dl>';
    if (d.error) h += '<div class="err-box">' + esc(typeof d.error === 'string' ? d.error : JSON.stringify(d.error)) + '</div>';
    h += '<h3>Why HangUp says this</h3><p style="margin:0 0 4px">' + esc(d.headline || (d.verdict ? '' : 'This invoice was sent without screening; no verdict until a scan reads it back from PayPal.')) + '</p>';
    if (d.reasons && d.reasons.length) h += '<ul class="adv" style="margin:0">' + d.reasons.map((r) => '<li><span class="rc">' + esc(r) + '</span> ' + esc((d.reason_labels || {})[r] || r) + '</li>').join('') + '</ul>';
    h += '<h3>Invoice text as the recipient sees it (AI evidence highlighted)</h3>';
    const ts = texts(d);
    h += ts.length ? ts.map((t) => '<div class="prov" style="margin-top:6px">' + esc(t.label) + '</div><div class="note">' + highlight(t.text, q) + '</div>').join('') : '<div class="note"><em>no text</em></div>';
    if (q.length) h += '<h3>Evidence quotes (verbatim from the invoice)</h3><ul class="adv">' + q.map((s) => '<li><mark>' + esc(s) + '</mark></li>').join('') + '</ul>';
    if (d.form) h += '<h3>Form the AI filled</h3><dl class="meta">' + Object.keys(d.form).filter((k) => k !== 'evidence_quotes').map((k) => { const v = d.form[k]; return '<dt>' + esc(k) + '</dt><dd>' + esc(Array.isArray(v) ? v.join('; ') : v) + '</dd>'; }).join('') + '</dl>';
    h += '<h3>PayPal</h3><dl class="meta"><dt>Invoice</dt><dd>' + (x ? '<span class="mono">' + esc(x.invoice_id) + '</span> <span class="st st-' + esc(x.status) + '">' + esc(x.status || '?') + '</span>' : 'no invoice created') + '</dd>' +
      (x && x.payer_view_url ? '<dt>Payer view</dt><dd><a href="' + esc(x.payer_view_url) + '" target="_blank" rel="noopener">open what the recipient sees</a> (sandbox)</dd>' : '') + '</dl>' +
      (x ? '<button class="btn secondary small" id="dRefetch" type="button">Re-fetch status from PayPal</button>' : '');
    const hist = [{ at: d.created_at, t: d.gate_bypassed ? 'Sent through the platform with no screening' : 'Gate decision: ' + d.action + (d.verdict ? ' (' + verdictText(d) + ')' : '') }];
    if (d.backfilled_at) hist.push({ at: d.backfilled_at, t: 'Backfill scan read the invoice back from PayPal and screened it: ' + verdictText(d) });
    if (d.expires_at && d.action === 'HOLD') hist.push({ at: d.expires_at, t: 'Hold expires (72 h)', future: true });
    (d.review || []).forEach((r) => hist.push({ at: r.at, t: 'Reviewer: ' + r.action }));
    h += '<h3>Action history</h3><ol class="hist">' + hist.map((r) => '<li><span class="prov">' + esc(fmt(r.at)) + '</span> ' + esc(r.t) + '</li>').join('') + '</ol>';
    h += '<h3>Actions</h3><div class="row"><button class="btn small" data-act="release"' + (isHeld(d) ? '' : ' disabled') + '>Release</button><button class="btn secondary small" data-act="rewrite"' + (isHeld(d) || d.status === 'BLOCKED' ? '' : ' disabled') + '>Send with template note</button><button class="btn secondary small" data-act="block"' + (isHeld(d) || d.status === 'BLOCKED' ? '' : ' disabled') + '>Confirm block</button>' +
      '<button class="btn danger small" data-act="cancel"' + (el_.kind === 'cancel' ? '' : ' disabled') + '>Cancel this sent invoice</button></div>' +
      (el_.sel ? '' : '<p class="prov">Not selectable for bulk actions: ' + esc(el_.text) + '</p>') + '<div id="actmsg" aria-live="polite"></div>';
    el.innerHTML = h;
    if (keepScroll) $('drawer').scrollTop = top;
    const rf = $('dRefetch'); if (rf) rf.onclick = () => { rf.disabled = true; refetch([d.id]).catch((e) => err($('actmsg'), e)); };
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        const act = b.getAttribute('data-act');
        if (act === 'cancel') { const ci = cancelInfo(d); if (ci.ok) runCancel(ci.campaign.phone, [d], [d.id]).then(() => renderDrawer(true)); return; }
        b.disabled = true;
        api_('POST', '/api/gate/decisions/' + encodeURIComponent(d.id) + '/' + act).then((nd) => { applyDecisions([nd], false); lastResult[d.id] = { ok: true, text: act === 'release' ? 'Released' : act === 'block' ? 'Block confirmed' : 'Sent with template note' }; return refetch([d.id]); }).then(() => refresh()).catch((e) => { b.disabled = false; err($('actmsg'), e); });
      };
    });
  }

  // ---- webhooks
  let hooks = [];
  function renderHooks() {
    const el = $('hooks'); if (!el) return;
    el.innerHTML = (hooks.length ? '<ul class="adv">' + hooks.slice(0, 8).map((h) => '<li><span class="mono">' + esc(h.event_type || 'unknown') + '</span> ' + esc(h.resource_id || '') + ' <span class="badge ' + (h.verified ? 'b-ALLOW' : 'b-BLOCK') + '">verified: ' + (h.verified ? 'true' : 'false') + '</span> <span class="prov">' + esc(fmt(h.received_at)) + (h.verify_error ? ' · ' + esc(h.verify_error) : '') + '</span></li>').join('') + '</ul>' : '<div class="empty">No webhook events stored.</div>') +
      '<p class="prov" style="margin-bottom:0">Events from PayPal’s webhook service. Each is checked with PayPal’s verify-webhook-signature before it can change a status. Running locally without a public URL, this list stays empty.</p>';
  }

  // ---- refresh loop
  function refresh() {
    return Promise.all([api_('GET', '/api/gate/decisions'), api_('GET', '/api/gate/campaigns'), api_('GET', '/api/webhook-events').catch(() => [])]).then((r) => {
      hooks = Array.isArray(r[2]) ? r[2] : []; $('msg').innerHTML = '';
      applyCampaigns(Array.isArray(r[1]) ? r[1] : []); // campaigns first: the decision columns read them
      applyDecisions(Array.isArray(r[0]) ? r[0] : [], true);
      $('live').textContent = 'live, updated ' + new Date().toLocaleTimeString(); renderHooks();
    }).catch((e) => { $('live').textContent = 'refresh failing'; err($('msg'), new Error('Could not load decisions: ' + e.message)); });
  }

  $('seed').onclick = () => {
    const b = $('seed'); b.disabled = true; b.textContent = 'Staging…';
    api_('POST', '/api/demo/seed').then(() => refresh()).then(() => loadStory())
      .catch((e) => err($('msg'), e)).then(() => { b.disabled = false; b.textContent = 'Stage demo'; });
  };
  $('sf').onsubmit = (e) => {
    e.preventDefault();
    const body = { seller_id: $('s_id').value.trim(), seller_name: $('s_name').value.trim(), declared_contact: $('s_contact').value.trim(), recipient_email: $('s_mail').value.trim(), currency: $('s_cur').value.trim() || 'USD',
      items: [{ name: $('i_name').value, description: $('i_desc').value, quantity: +$('i_qty').value || 1, unit_amount: $('i_amt').value }], note: $('s_note').value, terms: $('s_terms').value };
    api_('POST', '/api/gate/invoices', body).then((d) => {
      refresh().then(() => openDrawer(d.id, true));
      $('submsg').innerHTML = '<div class="banner">Decision: ' + badge(d.action, d.action) + ' ' + esc(d.verdict || '') + (d.paypal ? ' · PayPal ' + esc(d.paypal.invoice_id) : '') + '</div>';
    }).catch((x) => err($('submsg'), x));
  };

  function health() {
    const el = $('health');
    api_('GET', '/api/health').then((h) => {
      const bad = h.paypal !== 'ok' || h.llm !== 'ok';
      el.className = 'pill ' + (bad ? 'warn' : 'ok');
      el.lastChild.textContent = 'PayPal ' + h.paypal + ' · AI ' + h.llm + (h.model ? ' (' + h.model + ')' : '') + (h.env ? ' · ' + h.env : '');
    }).catch(() => { el.className = 'pill bad'; el.lastChild.textContent = 'server unreachable'; });
  }

  // ---- demo story stepper (staged). It drives the grid: every step ends with a refresh().
  let story = null, storyBusy = false;
  const pv = (u) => (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">payer view</a>' : '');
  function invRow(r, extra) {
    if (!r) return '';
    const live = r.paypal_live ? ' · PayPal now: <strong>' + esc(r.paypal_live.status || r.paypal_live.error) + '</strong>' : '';
    const v = r.verdict ? ' · verdict <span class="mono">' + esc(r.verdict) + '</span>' : (r.gate_bypassed ? ' · not screened' : '');
    return '<li><span class="tag">STAGED</span> ' + esc(nm(r.seller_name)) + ' <span class="mono">' + esc(r.invoice_id || 'no invoice') + '</span> ' + esc(r.invoice_status || r.decision_status || '') + live + v +
      (r.gate_bypassed && r.verdict && r.would_have_action ? ' · HangUp says ' + badge(r.would_have_action, r.would_have_action) : '') + ' ' + pv(r.payer_view_url) + (extra || '') + '</li>';
  }
  const DOT = { done: '●', ready: '◐', pending: '○' };
  // What each step does at PayPal, shown while it runs. Steps 1 and 2 take about 40 s each on the hosted app.
  const STEP_WORK = {
    1: { text: 'Creating and sending 2 sandbox invoices in PayPal…', usual: 'up to about 45 s on a cold start' },
    2: { text: 'Scanning PayPal for A and B, then screening 3 new invoices with the AI judge and creating the allowed ones in PayPal…', usual: 'up to about 60 s on a cold start' },
    3: { text: 'Cancelling the flagged sent invoices at PayPal…', usual: 'usually under 15 s' },
    4: { text: 'Re-fetching every staged invoice from PayPal…', usual: 'usually under 15 s' },
  };
  let busy = null, busyTimer = null; // { n, start, retry }
  function elapsedText() { return busy ? Math.round((Date.now() - busy.start) / 1000) + ' s' : ''; }
  function tickBusy() { const a = document.getElementById('stpElapsed'), b = document.getElementById('stpElapsed2'); if (a) a.textContent = elapsedText(); if (b) b.textContent = elapsedText(); }
  function storyBtn(n, label, state, btnId, disabled) {
    const working = storyBusy && busy && busy.n === n;
    const st = working ? 'working' : state;
    return '<span class="stp"><span class="dot s-' + esc(st) + '" title="' + esc(st) + '" aria-label="' + esc(st) + '">' + (working ? '◔' : (DOT[state] || '○')) + '</span><button class="btn small' + (state === 'done' && !working ? ' secondary' : '') + (working ? ' working' : '') + '" id="' + btnId + '" type="button"' + (disabled || storyBusy ? ' disabled' : '') + (working ? ' aria-busy="true"' : '') + '>' +
      (working ? '<span class="spin" aria-hidden="true"></span>Working… <span id="stpElapsed">' + elapsedText() + '</span>' : n + '. ' + esc(label)) + '</button></span>';
  }
  function showProgress() {
    const w = STEP_WORK[busy.n];
    $('storyMsg').innerHTML = '<div class="banner progress" data-testid="story-progress"><span class="spin" aria-hidden="true"></span><span><strong>Step ' + busy.n + ':</strong> ' + esc(w.text) + ' <span class="prov">' + esc(w.usual) + ' · <span id="stpElapsed2">' + elapsedText() + '</span> elapsed' + (busy.retry ? ' · server was busy, retrying automatically (' + busy.retry + ')' : '') + '</span></span></div>';
  }
  function logStep(n, title, state, body) {
    return '<div class="camp ' + (state === 'done' ? '' : 'flag') + '" style="margin:6px 0;padding:8px 10px"><strong>' + n + '. ' + esc(title) + '</strong> <span class="badge b-' + (state === 'done' ? 'ALLOW' : 'REWRITE') + '">' + esc(state) + '</span>' + (body ? '<ul class="adv" style="margin:4px 0 0">' + body + '</ul>' : '') + '</div>';
  }
  function renderStory() {
    const b = story && story.beats, el = $('storySteps'); if (!b) { el.innerHTML = ''; return; }
    const m = b.monday, t = b.tuesday, c = b.campaign, r = b.result;
    const br = t.tricky_brightline;
    const rel = br && br.decision_status === 'HELD' ? ' <button class="btn secondary small" data-release="' + esc(br.decision_id) + '" type="button">Human release</button>' : '';
    const bf = t.backfill;
    const tb = (bf ? '<li><strong>Backfill scan</strong> (last ' + bf.days + ' days): PayPal list API returned ' + bf.listed + ' invoice' + (bf.listed === 1 ? '' : 's') + ' over ' + bf.pages + ' page' + (bf.pages === 1 ? '' : 's') + '; ' + bf.ours + ' ours, ' +
      bf.foreign_skipped + ' belong to other teams and were skipped unread; ' + bf.scanned + ' read back by invoice ID and screened, ' + bf.flagged + ' flagged.</li>' : '') +
      (t.found || []).map((x) => invRow(x)).join('') + '<li><strong>Then a new attempt through the gate</strong></li>' + invRow(t.blocked) + invRow(t.control_dana) + invRow(br, rel);
    const cb = c.phone ? '<li>Callback number <span class="mono">' + esc(c.phone) + '</span> shared by ' + c.seller_count + ' distinct sellers. Cancellable (already sent): ' +
      (c.cancellable.length ? c.cancellable.map((i) => '<span class="mono">' + esc(i) + '</span>').join(', ') : 'none') + (c.cancelled.length ? '. Cancelled: ' + c.cancelled.map(esc).join(', ') : '') + '</li>' : '';
    el.innerHTML =
      storyBtn(1, 'Send A and B ungated', m.state, 'stp1', false) +
      storyBtn(2, 'Switch on HangUp', t.state, 'stp2', m.state !== 'done') +
      storyBtn(3, 'Cancel ' + c.cancellable.length + ' sent invoice' + (c.cancellable.length === 1 ? '' : 's'), c.state, 'stp3', !(c.flagged && c.cancellable.length > 0)) +
      storyBtn(4, 'Re-fetch from PayPal', r.state, 'stp4', m.state !== 'done');
    $('storyLog').innerHTML =
      logStep(1, 'Monday: A and B sent with no screening', m.state, m.invoices.map((x) => invRow(x)).join('')) +
      logStep(2, 'Tuesday: HangUp on. Backfill finds A and B; C is blocked', t.state, tb) +
      logStep(3, 'Campaign: 3 sellers, 1 number. Cancel the sent ones', c.state, cb) +
      logStep(4, 'PayPal re-fetch shows CANCELLED', r.state, r.invoices.map((x) => invRow(x)).join(''));
    const onRetry = (k, max) => { busy.retry = k + ' of ' + max; showProgress(); };
    const post = (path, body) => apiRetry('POST', path, body, onRetry);
    const run = (n, id, fn) => { const x = $(id); if (x) x.onclick = () => startStep(n, fn, post); };
    run(1, 'stp1', () => post('/api/demo/ungated'));
    run(2, 'stp2', () => post('/api/gate/backfill', { days: 30, demo: true }).then(() => post('/api/demo/gated')));
    run(3, 'stp3', () => post('/api/gate/campaigns/' + encodeURIComponent(c.phone) + '/cancel').then(afterCancel));
    const s4 = $('stp4'); if (s4) s4.onclick = () => startStep(4, () => Promise.resolve(), post, true);
    $('storyLog').querySelectorAll('[data-release]').forEach((x) => { x.onclick = () => { x.disabled = true; api_('POST', '/api/gate/decisions/' + encodeURIComponent(x.getAttribute('data-release')) + '/release').then(() => loadStory()).then(refresh).catch((e) => err($('storyMsg'), e)); }; });
  }
  // Run one story step with a visible progress state; on failure keep the grid as is and offer a retry button.
  function startStep(n, fn, post, verify) {
    storyBusy = true; busy = { n, start: Date.now(), retry: '' };
    clearInterval(busyTimer); busyTimer = setInterval(tickBusy, 1000);
    renderStory(); showProgress();
    return fn().then(() => { $('storyMsg').innerHTML = ''; }, (e) => {
      const retryable = e && (e.retryable || HangupRetry.isTransient(e));
      $('storyMsg').innerHTML = '<div class="err-box" role="alert" data-testid="story-error">Step ' + n + ' did not finish: ' + esc(e.code ? e.code + ': ' : '') + esc(e.message || e) +
        (retryable ? '. The server may have been waking up. Retrying is safe: the demo never creates the same staged invoice twice. <button class="btn small" id="storyRetry" type="button">Retry step ' + n + '</button>' : '') + '</div>';
      const rb = $('storyRetry'); if (rb) rb.onclick = () => startStep(n, fn, post, verify);
    }).then(() => loadStory(verify)).then(() => { clearInterval(busyTimer); busy = null; storyBusy = false; renderStory(); return refresh(); });
  }
  // Step 3: show the cancel straight away from what the server reported, then confirm with PayPal.
  function afterCancel(r) {
    const done = (r.results || []).filter((x) => x.ok).map((x) => x.decision_id);
    const upd = done.map((id) => byId[id]).filter(Boolean).map((d) => Object.assign({}, d, { invoice_status: 'CANCELLED', status: 'CAMPAIGN_CANCELLED', paypal: d.paypal ? Object.assign({}, d.paypal, { status: 'CANCELLED' }) : d.paypal }));
    (r.results || []).forEach((x) => { lastResult[x.decision_id] = { ok: !!x.ok, text: x.ok ? 'Cancelled via campaign' : (x.skipped ? 'Skipped: ' + x.skipped : 'Cancel failed: ' + (x.error || '')) }; });
    if (upd.length) applyDecisions(upd, false);
    return refetch(done).catch(() => []);
  }
  function loadStory(verify) {
    return api_('GET', '/api/demo/story' + (verify ? '?verify=1' : '')).then((j) => { story = j; renderStory(); }).catch((e) => err($('storyMsg'), e));
  }
  $('storyReset').onclick = () => { const b = $('storyReset'); b.disabled = true; b.textContent = 'Resetting…'; $('storyMsg').innerHTML = '';
    apiRetry('POST', '/api/demo/reset').then(() => loadStory()).then(refresh).catch((e) => err($('storyMsg'), e)).then(() => { b.disabled = false; b.textContent = 'Reset demo'; }); };

  // ---- boot: local vendored AG Grid first, then the same pinned version from the CDN, then the plain table
  function loadScript(src, cb) { const s = document.createElement('script'); s.src = src; s.onload = () => cb(!!window.agGrid); s.onerror = () => cb(false); document.head.appendChild(s); }
  function loadCss(href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
  function boot() {
    gridOK = initGrids();
    if (!gridOK) {
      $('grid').classList.add('hidden'); $('fallback').classList.remove('hidden'); $('bulk').classList.add('hidden'); $('exportCsv').classList.add('hidden'); $('cgrid').classList.add('hidden');
      document.documentElement.setAttribute('data-grid', 'fallback');
    } else document.documentElement.setAttribute('data-grid', 'ag-grid');
    syncFilterUI(); loadStory(); refresh(); health();
    setInterval(refresh, 5000); setInterval(health, 30000);
  }
  if (window.agGrid) boot();
  else {
    loadCss('https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/styles/ag-grid.css'); loadCss('https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/styles/ag-theme-quartz.css');
    loadScript('https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/dist/ag-grid-community.min.js', boot);
  }
})();
