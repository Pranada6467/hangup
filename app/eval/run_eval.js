'use strict';
// Usage: node eval/run_eval.js [--data path] [--real path] [--heldout2 path] [--llm] [--ablation] [--model id] [--concurrency 3]
// Splits: B2 is trained on split=dev; reports cover split=test and split=adv. SYNTHETIC DATA ONLY.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const { b0, b0intl, b1, trainB2, mulberry32 } = require('../src/baselines');
const { checkInvoice } = require('../src/decide');
const { llmJudge, buildUserPrompt, SYSTEM_PROMPT } = require('../src/judge');
const config = require('../src/config');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(__dirname);
const dataPath = path.resolve(opt('--data', path.join(ROOT, 'data/notes.jsonl')));
const realDefault = path.join(ROOT, 'data/real_quoted.jsonl');
const realPath = opt('--real', fs.existsSync(realDefault) ? realDefault : null);
const model = opt('--model', config.llm.model);
const conc = Number(opt('--concurrency', 3));
const h2Path = opt('--heldout2', null);

function readRows(p) {
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}
const fieldsOf = (r) => ({ invoicer: r.invoicer, amount: r.amount, currency: r.currency, items: r.items || [], note: r.note, terms: r.terms, declared_contact: r.declared_contact });

// ---- LLM with on-disk cache ----
const cacheDir = path.join(ROOT, 'cache');
function cachedJudge(stats) {
  return async (nf, o) => {
    const key = crypto.createHash('sha256').update(model + '\n' + SYSTEM_PROMPT + '\n' + buildUserPrompt(nf)).digest('hex');
    const file = path.join(cacheDir, key + '.json');
    try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); stats.hits++; return c; } catch { /* miss */ }
    const res = await llmJudge(nf, { ...o, model });
    stats.calls++;
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(res));
    return res;
  };
}

// ---- metrics ----
function rate(arr) { return arr.length ? arr.filter(Boolean).length / arr.length : null; }
function bootCI(arr, seed = 1234, B = 1000) {
  if (!arr.length) return null;
  const rnd = mulberry32(seed), n = arr.length, vals = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += arr[Math.floor(rnd() * n)] ? 1 : 0; vals.push(s / n); }
  vals.sort((a, c) => a - c);
  return [vals[Math.floor(0.025 * B)], vals[Math.floor(0.975 * B)]];
}
const rr = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);

function metrics(rows, preds, key) {
  // preds: Map id -> {flagged, scamOnly, latency_ms, usage}; rows lacking a pred are excluded (errors)
  const rs = rows.filter((r) => preds.has(r.id));
  const f = (r) => preds.get(r.id)[key];
  const scam = rs.filter((r) => r.label === 'scam'), legit = rs.filter((r) => r.label === 'legit');
  const hn = legit.filter((r) => r.hard_negative);
  const tp = scam.filter(f).length, fn = scam.length - tp, fp = legit.filter(f).length;
  const prec = tp + fp ? tp / (tp + fp) : null, rec = scam.length ? tp / scam.length : null;
  const fams = {};
  for (const fam of new Set(scam.map((r) => r.family))) {
    const rows2 = scam.filter((r) => r.family === fam);
    fams[fam] = { n: rows2.length, recall: rr(rate(rows2.map(f))) };
  }
  const ci = (arr) => { const c = bootCI(arr); return c && [rr(c[0]), rr(c[1])]; };
  const lat = rs.map((r) => preds.get(r.id).latency_ms).filter((x) => typeof x === 'number');
  const tok = rs.reduce((a, r) => { const u = preds.get(r.id).usage || {}; return [a[0] + (u.prompt_tokens || 0), a[1] + (u.completion_tokens || 0)]; }, [0, 0]);
  return {
    n: rs.length, n_scam: scam.length, n_legit: legit.length, n_hard_neg: hn.length, excluded_errors: rows.length - rs.length,
    recall: rr(rec), recall_ci95: ci(scam.map(f)), precision: rr(prec),
    f1: prec !== null && rec !== null && prec + rec > 0 ? rr((2 * prec * rec) / (prec + rec)) : null,
    false_flag_legit: rr(rate(legit.map(f))), false_flag_legit_ci95: ci(legit.map(f)),
    false_flag_hard_neg: rr(rate(hn.map(f))), false_flag_hard_neg_ci95: ci(hn.map(f)),
    per_family_recall: fams,
    mean_latency_ms: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    tokens: { prompt: tok[0], completion: tok[1] },
    adversarial_pass_rate: null,
  };
}
function advPass(rows, preds, key) {
  const rs = rows.filter((r) => preds.has(r.id));
  if (!rs.length) return null;
  return rr(rs.filter((r) => preds.get(r.id)[key] === (r.label === 'scam')).length / rs.length);
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

async function main() {
  if (!fs.existsSync(dataPath)) { console.error(`data not found: ${dataPath} (use --data eval/fixtures/sample.jsonl to try)`); process.exit(1); }
  const rows = readRows(dataPath);
  const dev = rows.filter((r) => r.split === 'dev'), test = rows.filter((r) => r.split === 'test'), adv = rows.filter((r) => r.split === 'adv');
  const real = realPath && fs.existsSync(path.resolve(realPath)) ? readRows(path.resolve(realPath)).filter((r) => r.split === 'real') : [];
  const h2 = h2Path ? readRows(path.resolve(h2Path)).filter((r) => r.split === 'heldout2') : [];
  const evalRows = [...rows.filter((r) => r.split === 'test' || r.split === 'adv'), ...real, ...h2];
  const preds = {}; // method -> Map
  const methods = ['B0', 'B0I', 'B1', 'B2'];
  const mk = (fn) => { const m = new Map(); for (const r of evalRows) { const v = !!fn(fieldsOf(r)); m.set(r.id, { flagged: v, scamOnly: v }); } return m; };
  preds.B0 = mk(b0); preds.B0I = mk(b0intl); preds.B1 = mk(b1);
  let b2info = { note: 'not run: no dev rows' };
  if (dev.length) {
    const m = trainB2(dev);
    preds.B2 = mk((f) => m.flag(f));
    b2info = { threshold: m.threshold, vocab: m.vocabSize, trained_on: dev.length };
  }
  const notRun = {};
  const llmStats = { calls: 0, hits: 0 };
  const forms = new Map();
  if (flag('--llm')) {
    const judge = cachedJudge(llmStats);
    const m = new Map(), formAlone = new Map(), legacy = new Map(), unfam = new Map();
    let aborted = null;
    await pool(evalRows, conc, async (r) => {
      if (aborted) return;
      try {
        const res = await checkInvoice(fieldsOf(r), { judge });
        const flagged = res.verdict !== 'NO_CALLBACK_PATTERN';
        // Worst case for the unfamiliar-seller signal: every row, including every honest one, is from a seller the recipient never paid.
        const ru = await checkInvoice(fieldsOf(r), { judge, ctx: { unfamiliar_seller: true } });
        unfam.set(r.id, { flagged: ru.verdict !== 'NO_CALLBACK_PATTERN', scamOnly: ru.verdict === 'LIKELY_CALLBACK_SCAM', latency_ms: ru.latency_ms, usage: ru.usage, verdict: ru.verdict });
        m.set(r.id, { flagged, scamOnly: res.verdict === 'LIKELY_CALLBACK_SCAM', latency_ms: res.latency_ms, usage: res.usage, verdict: res.verdict });
        legacy.set(r.id, { flagged: res.legacy_verdict !== 'NO_CALLBACK_PATTERN', scamOnly: res.legacy_verdict === 'LIKELY_CALLBACK_SCAM', latency_ms: res.latency_ms, usage: res.usage, verdict: res.legacy_verdict });
        const fa = !!(res.form.callback_demanded && res.form.disputes_unrecognised_charge);
        formAlone.set(r.id, { flagged: fa, scamOnly: fa, latency_ms: res.latency_ms, usage: res.usage });
        forms.set(r.id, res.form);
      } catch (e) {
        if (e.code === 'LLM_UNAVAILABLE') aborted = e.message;
        else console.error(`row ${r.id}: ${e.message}`);
      }
    });
    if (aborted && !m.size) notRun.LLM = 'not run: LLM unreachable';
    else {
      preds.LLM = m; methods.push('LLM+decide');
      if (flag('--ablation')) { preds.LLM_FORM_ONLY = formAlone; preds.LLM_LEGACY = legacy; preds.LLM_UNFAM = unfam; }
    }
  } else notRun.LLM = 'not run: --llm flag not given';

  const names = { B0: 'B0 phone-or-URL (US format)', B0I: 'B0-intl any phone/URL (added post hoc)', B1: 'B1 keyword+regex', B2: 'B2 TF-IDF+LR', LLM: 'LLM judge + decide', LLM_FORM_ONLY: 'LLM form alone (callback && disputes)', LLM_LEGACY: 'LLM judge + 5 Nov decide rule (ablation, same LLM answers)', LLM_UNFAM: 'LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers)' };
  const result = { synthetic_data: true, data: path.relative(process.cwd(), dataPath), counts: { dev: dev.length, test: test.length, adv: adv.length, real: real.length, heldout2: h2.length }, real_data: real.length ? path.relative(process.cwd(), path.resolve(realPath)) : null, model: preds.LLM ? model : null, b2: b2info, not_run: notRun, llm_cache: llmStats, methods: {} };
  for (const k of Object.keys(preds)) {
    result.methods[k] = { name: names[k] };
    for (const [sp, rs] of [['test', test], ['adv', adv]]) {
      if (!rs.length) continue;
      for (const key of ['flagged', 'scamOnly']) {
        const mm = metrics(rs, preds[k], key);
        mm.adversarial_pass_rate = sp === 'adv' ? advPass(rs, preds[k], key) : null;
        (result.methods[k][sp] = result.methods[k][sp] || {})[key === 'flagged' ? 'flag_susp_or_scam' : 'scam_only'] = mm;
      }
    }
    if (h2.length) {
      for (const key of ['flagged', 'scamOnly']) {
        (result.methods[k].heldout2 = result.methods[k].heldout2 || {})[key === 'flagged' ? 'flag_susp_or_scam' : 'scam_only'] = metrics(h2, preds[k], key);
      }
    }
    if (real.length) {
      // Real quoted notes are scam-only: report recall (and the per-family breakdown), never precision/false-flag.
      const rm = {};
      for (const key of ['flagged', 'scamOnly']) {
        const mm = metrics(real, preds[k], key);
        rm[key === 'flagged' ? 'flag_susp_or_scam' : 'scam_only'] = { n: mm.n, recall: mm.recall, recall_ci95: mm.recall_ci95, excluded_errors: mm.excluded_errors };
      }
      result.methods[k].real = rm;
    }
  }
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { /* none */ }
  result.heldout2_data = h2.length ? path.relative(process.cwd(), path.resolve(h2Path)) : null;
  result.heldout2_generator = h2.length ? [...new Set(h2.map((r) => r.generator))].join(', ') : null;
  result.git_commit = commit; result.generated_at = new Date().toISOString();

  const stamp = result.generated_at.replace(/[:.]/g, '-');
  fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
  const file = path.join(ROOT, 'results', `${stamp}-${Object.keys(preds).join('+')}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  if (preds.LLM) { // per-row predictions, so every verdict can be inspected against its row
    const rowsOut = evalRows.map((r) => {
      const o = { id: r.id, split: r.split, label: r.label, family: r.family, hard_negative: !!r.hard_negative };
      for (const k of Object.keys(preds)) { const p = preds[k].get(r.id); o[k] = p ? (p.verdict || (p.flagged ? 'FLAGGED' : 'NOT_FLAGGED')) : null; }
      o.form = forms.get(r.id) || null;
      return JSON.stringify(o);
    });
    fs.writeFileSync(file.replace(/\.json$/, '.rows.jsonl'), rowsOut.join('\n') + '\n');
  }
  // Baselines-only runs must never clobber a LATEST.md that holds LLM rows.
  const latest = path.join(ROOT, 'results', 'LATEST.md');
  const hasLlm = Boolean(preds.LLM);
  let latestHasLlm = false;
  try { latestHasLlm = /LLM judge/.test(fs.readFileSync(latest, 'utf8')); } catch { /* none */ }
  const latestFile = !hasLlm && latestHasLlm ? 'LATEST-baselines.md' : 'LATEST.md';
  fs.writeFileSync(path.join(ROOT, 'results', latestFile), markdown(result));
  console.log(`summary written to results/${latestFile}`);
  console.log(markdown(result));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

function pct(x) { return x === null || x === undefined ? 'n/a' : (x * 100).toFixed(1) + '%'; }
function ci(x, c) { return x === null ? 'n/a' : `${pct(x)} [${pct(c[0])}-${pct(c[1])}]`; }
function markdown(res) {
  const L = [];
  L.push('# HangUp eval results', '', '> **SYNTHETIC DATA.** Every invoice note here is generated for evaluation. Numbers do not describe real-world performance.', '');
  L.push(`Commit: \`${res.git_commit}\` | data: \`${res.data}\` | rows dev/test/adv/real: ${res.counts.dev}/${res.counts.test}/${res.counts.adv}/${res.counts.real || 0} | generated: ${res.generated_at}`);
  L.push(`B2 trained on dev only: ${JSON.stringify(res.b2)}. LLM model: ${res.model || 'n/a'}; cache hits ${res.llm_cache.hits}, live calls ${res.llm_cache.calls}.`);
  for (const [k, v] of Object.entries(res.not_run)) L.push(`- ${k}: ${v}`);
  L.push('');
  for (const sp of ['test', 'adv']) {
    for (const [key, label] of [['flag_susp_or_scam', 'SUSPICIOUS or LIKELY counts as flagged'], ['scam_only', 'only LIKELY_CALLBACK_SCAM counts as flagged']]) {
      if (!Object.values(res.methods).some((m) => m[sp])) continue;
      L.push(`## ${sp === 'test' ? 'Held-out test (unseen families/trades)' : 'Adversarial pack'} - ${label}`, '');
      L.push('| Method | n | Recall | Precision | F1 | False flag (all legit) | False flag (hard negatives) | Adv. pass | Mean latency | Tokens in/out |');
      L.push('|---|---|---|---|---|---|---|---|---|---|');
      for (const m of Object.values(res.methods)) {
        const x = m[sp] && m[sp][key]; if (!x) continue;
        L.push(`| ${m.name} | ${x.n} | ${ci(x.recall, x.recall_ci95 || [0, 0])} | ${pct(x.precision)} | ${pct(x.f1)} | ${ci(x.false_flag_legit, x.false_flag_legit_ci95 || [0, 0])} | ${ci(x.false_flag_hard_neg, x.false_flag_hard_neg_ci95 || [0, 0])} | ${pct(x.adversarial_pass_rate)} | ${x.mean_latency_ms === null ? '-' : x.mean_latency_ms + ' ms'} | ${x.tokens.prompt}/${x.tokens.completion} |`);
      }
      L.push('');
      const fams = new Set(); for (const m of Object.values(res.methods)) Object.keys((m[sp] && m[sp][key] || {}).per_family_recall || {}).forEach((f) => fams.add(f));
      if (fams.size) {
        L.push('Per-family recall (scam rows):', '', '| Family | ' + Object.values(res.methods).map((m) => m.name).join(' | ') + ' |', '|---|' + Object.keys(res.methods).map(() => '---|').join(''));
        for (const f of fams) L.push(`| ${f} | ` + Object.values(res.methods).map((m) => { const e = m[sp] && m[sp][key].per_family_recall[f]; return e ? `${pct(e.recall)} (n=${e.n})` : '-'; }).join(' | ') + ' |');
        L.push('');
      }
    }
  }
  if (res.counts.real) {
    L.push('## Real quoted notes (public write-ups; scam-only, so recall only)', '', `Source: \`${res.real_data}\` (${res.counts.real} notes quoted from public reports, see real_quoted_SOURCES.md). No legit rows, so no precision or false-flag figures exist for this split.`, '');
    L.push('| Method | n | Recall (SUSPICIOUS or LIKELY) | Recall (LIKELY only) |', '|---|---|---|---|');
    for (const m of Object.values(res.methods)) {
      const x = m.real; if (!x) continue;
      const a = x.flag_susp_or_scam, b = x.scam_only;
      L.push(`| ${m.name} | ${a.n} | ${ci(a.recall, a.recall_ci95 || [0, 0])} | ${ci(b.recall, b.recall_ci95 || [0, 0])} |`);
    }
    L.push('');
  }
  if (res.counts.heldout2) {
    for (const [key, label] of [['flag_susp_or_scam', 'SUSPICIOUS or LIKELY counts as flagged'], ['scam_only', 'only LIKELY_CALLBACK_SCAM counts as flagged']]) {
      L.push(`## Fresh held-out pack (written by ${res.heldout2_generator}, never seen during tuning) - ${label}`, '', `Source: \`${res.heldout2_data}\`, ${res.counts.heldout2} rows, new scam families and new legit trades.`, '');
      L.push('| Method | n | Recall | Precision | F1 | False flag (all legit) | False flag (hard negatives) | Mean latency | Tokens in/out |', '|---|---|---|---|---|---|---|---|---|');
      for (const m of Object.values(res.methods)) {
        const x = m.heldout2 && m.heldout2[key]; if (!x) continue;
        L.push(`| ${m.name} | ${x.n} | ${ci(x.recall, x.recall_ci95 || [0, 0])} | ${pct(x.precision)} | ${pct(x.f1)} | ${ci(x.false_flag_legit, x.false_flag_legit_ci95 || [0, 0])} | ${ci(x.false_flag_hard_neg, x.false_flag_hard_neg_ci95 || [0, 0])} | ${x.mean_latency_ms === null ? '-' : x.mean_latency_ms + ' ms'} | ${x.tokens.prompt}/${x.tokens.completion} |`);
      }
      L.push('');
      const fams = new Set(); for (const m of Object.values(res.methods)) Object.keys((m.heldout2 && m.heldout2[key] || {}).per_family_recall || {}).forEach((f) => fams.add(f));
      L.push('Per-family recall (scam rows):', '', '| Family | ' + Object.values(res.methods).map((m) => m.name).join(' | ') + ' |', '|---|' + Object.keys(res.methods).map(() => '---|').join(''));
      for (const f of fams) L.push(`| ${f} | ` + Object.values(res.methods).map((m) => { const e = m.heldout2 && m.heldout2[key].per_family_recall[f]; return e ? `${pct(e.recall)} (n=${e.n})` : '-'; }).join(' | ') + ' |');
      L.push('');
    }
  }
  L.push('Bootstrap CIs: 1000 seeded resamples, 95% percentile interval. Small n gives wide intervals.');
  return L.join('\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
