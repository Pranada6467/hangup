'use strict';
// Real-text eval: recall on real scam notes AND false flags on real legitimate billing text.
// Usage: NODE_USE_ENV_PROXY=1 node eval/run_real.js [--real eval/data/real_v2.jsonl] [--concurrency 4]
// Baselines B0/B0-intl/B1 need no training; B2 (TF-IDF+LR) is trained on the synthetic dev split only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const { b0, b0intl, b1, trainB2, mulberry32 } = require('../src/baselines');
const { checkInvoice } = require('../src/decide');
const { llmJudge, buildUserPrompt, SYSTEM_PROMPT } = require('../src/judge');
const config = require('../src/config');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = __dirname;
const realPath = path.resolve(opt('--real', path.join(ROOT, 'data/real_v2.jsonl')));
const conc = Number(opt('--concurrency', 4));
const model = config.llm.model;
const readRows = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
const fieldsOf = (r) => ({ invoicer: r.invoicer, amount: r.amount, currency: r.currency, items: r.items || [], note: r.note, terms: r.terms, declared_contact: r.declared_contact });
const PHONE = /\d{3}\D{0,3}\d{3}\D{0,3}\d{4}|[\u{1D7CE}-\u{1D7D7}]{3}|GeekSquad|0800 \d/u;
const hasPhone = (r) => PHONE.test([r.invoicer, r.note, r.terms, r.declared_contact, ...(r.items || []).flatMap((i) => [i.name, i.description])].join(' '));

function bootCI(arr, seed = 1234, B = 1000) {
  if (!arr.length) return null;
  const rnd = mulberry32(seed), n = arr.length, vals = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += arr[Math.floor(rnd() * n)] ? 1 : 0; vals.push(s / n); }
  vals.sort((a, c) => a - c);
  return [vals[Math.floor(0.025 * B)], vals[Math.floor(0.975 * B)]];
}
const rate = (a) => (a.length ? a.filter(Boolean).length / a.length : null);
function stats(rows, pred) {
  const scam = rows.filter((r) => r.label === 'scam'), legit = rows.filter((r) => r.label === 'legit');
  const lp = legit.filter(hasPhone);
  const v = (rs) => rs.map((r) => !!pred(r));
  return {
    recall: rate(v(scam)), recall_ci: bootCI(v(scam)), n_scam: scam.length, caught: v(scam).filter(Boolean).length,
    ff: rate(v(legit)), ff_ci: bootCI(v(legit)), n_legit: legit.length, flagged_legit: v(legit).filter(Boolean).length,
    ff_phone: rate(v(lp)), ff_phone_ci: bootCI(v(lp)), n_legit_phone: lp.length,
  };
}

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } })); }

async function main() {
  const rows = readRows(realPath);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(realPath)).digest('hex');
  const dev = readRows(path.join(ROOT, 'data/notes.jsonl')).filter((r) => r.split === 'dev');
  const b2 = trainB2(dev);
  const cacheDir = path.join(ROOT, 'cache');
  const llm = new Map(), llmT = new Map(), llmS = new Map();
  const dsName = path.basename(realPath).replace(/\.jsonl$/, '');
  let sidecar = [];
  try { sidecar = JSON.parse(fs.readFileSync(realPath.replace(/\.jsonl$/, '_unfamiliar_line.json'), 'utf8')).ids; } catch { /* none */ }
  const truthOf = (r) => (r.source_shows_unfamiliar_line === true || sidecar.includes(r.id) ? true : null);
  let calls = 0, hits = 0;
  const judge = async (nf, o) => {
    const key = crypto.createHash('sha256').update(model + '\n' + SYSTEM_PROMPT + '\n' + buildUserPrompt(nf)).digest('hex');
    const file = path.join(cacheDir, key + '.json');
    try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); hits++; return c; } catch { /* miss */ }
    const res = await llmJudge(nf, { ...o, model }); calls++;
    fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(res));
    return res;
  };
  await pool(rows, conc, async (r) => {
    try {
      const base = await checkInvoice(fieldsOf(r), { judge });
      // The judge answer is cached, so the other contexts cost no extra LLM call.
      llmT.set(r.id, await checkInvoice(fieldsOf(r), { judge, ctx: { unfamiliar_seller: true } }));
      llmS.set(r.id, await checkInvoice(fieldsOf(r), { judge, ctx: { unfamiliar_seller: truthOf(r) } }));
      llm.set(r.id, base);
    } catch (e) { console.error(`row ${r.id}: ${e.message}`); }
  });
  const ok = rows.filter((r) => llm.has(r.id));
  const M = {
    'B0 phone-or-URL (US format)': (r) => b0(fieldsOf(r)),
    'B0-intl any phone/URL': (r) => b0intl(fieldsOf(r)),
    'B1 keyword+regex': (r) => b1(fieldsOf(r)),
    'B2 TF-IDF+LR (trained on synthetic dev)': (r) => b2.flag(fieldsOf(r)),
    'HangUp: SUSPICIOUS or LIKELY (gate HOLD or BLOCK)': (r) => llm.get(r.id).verdict !== 'NO_CALLBACK_PATTERN',
    'HangUp: LIKELY only (gate BLOCK)': (r) => llm.get(r.id).verdict === 'LIKELY_CALLBACK_SCAM',
    'HangUp, 5 Nov decide rule: SUSPICIOUS or LIKELY': (r) => llm.get(r.id).legacy_verdict !== 'NO_CALLBACK_PATTERN',
    'HangUp + unfamiliar_seller=true on EVERY row (worst case): HOLD or BLOCK': (r) => llmT.get(r.id).verdict !== 'NO_CALLBACK_PATTERN',
    'HangUp + unfamiliar_seller=true on EVERY row: BLOCK only': (r) => llmT.get(r.id).verdict === 'LIKELY_CALLBACK_SCAM',
    'HangUp + unfamiliar_seller = source value (true where the source shows the line, else null): HOLD or BLOCK': (r) => llmS.get(r.id).verdict !== 'NO_CALLBACK_PATTERN',
  };
  const result = { data: path.relative(process.cwd(), realPath), sha256: sha, model, llm_calls: calls, llm_cache_hits: hits, excluded_errors: rows.length - ok.length, methods: {} };
  for (const [name, fn] of Object.entries(M)) result.methods[name] = stats(ok, fn);
  try { result.git_commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { /* none */ }
  result.generated_at = new Date().toISOString();

  const pct = (x) => (x == null ? 'n/a' : (x * 100).toFixed(1) + '%');
  const ci = (c) => (c ? ` [${pct(c[0])}–${pct(c[1])}]` : '');
  const L = ['# HangUp eval on real text (' + dsName + ')', '',
    `> **Real text, small n.** ${ok.filter((r) => r.label === 'scam').length} real scam notes from public reports and ${ok.filter((r) => r.label === 'legit').length} real legitimate billing passages from businesses' public pages (not sent invoices). See \`eval/data/${dsName}.README.md\`.`, '',
    `Data: \`${result.data}\` (sha256 \`${sha.slice(0, 12)}…\`, frozen before this run) | commit \`${result.git_commit}\` | model \`${model}\` | ${result.generated_at}`, '',
    '| Method | Real scams caught | Real legit text flagged | Real legit text with a phone number flagged |', '|---|---|---|---|'];
  for (const [name, s] of Object.entries(result.methods)) {
    L.push(`| ${name} | ${s.caught}/${s.n_scam} = ${pct(s.recall)}${ci(s.recall_ci)} | ${s.flagged_legit}/${s.n_legit} = ${pct(s.ff)}${ci(s.ff_ci)} | ${pct(s.ff_phone)}${ci(s.ff_phone_ci)} (n=${s.n_legit_phone}) |`);
  }
  L.push('', 'Bootstrap CIs: 1000 seeded resamples, 95% percentile interval.', '');
  L.push('## Every HangUp verdict', '', '| id | label | family | verdict (ctx null) | verdict (unfamiliar=true) | verdict (source value) | B0-intl | B2 | why (LLM, plain words) |', '|---|---|---|---|---|---|---|---|---|');
  const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  for (const r of ok) {
    const x = llm.get(r.id);
    L.push(`| ${r.id} | ${r.label} | ${r.family} | ${x.verdict} | ${llmT.get(r.id).verdict} | ${llmS.get(r.id).verdict} | ${b0intl(fieldsOf(r)) ? 'flag' : '-'} | ${b2.flag(fieldsOf(r)) ? 'flag' : '-'} | ${esc(x.form.explanation_plain)} |`);
  }
  const stamp = result.generated_at.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(ROOT, 'results', `${stamp}-${dsName}.json`), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(ROOT, 'results', `${stamp}-${dsName}.rows.jsonl`), ok.map((r) => JSON.stringify({ id: r.id, label: r.label, family: r.family, verdict: llm.get(r.id).verdict, verdict_unfamiliar_true: llmT.get(r.id).verdict, verdict_source_value: llmS.get(r.id).verdict, legacy_verdict: llm.get(r.id).legacy_verdict, reasons: llm.get(r.id).reasons, form: llm.get(r.id).form })).join('\n') + '\n');
  fs.writeFileSync(path.join(ROOT, 'results', dsName === 'real_v2' ? 'REAL.md' : `REAL_${dsName.replace(/^real_/, '')}.md`), L.join('\n') + '\n');
  console.log(L.slice(0, 20).join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });
