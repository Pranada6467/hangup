'use strict';
// Generates the fresh held-out pack (heldout2) with a NON-Claude model. Does not touch the judge.
// Usage: NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node eval/gen_heldout2.js
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../src/config');

const MODELS = ['openai/gpt-5-mini', 'google/gemini-2.5-flash'];
const DATA = path.join(__dirname, 'data');
const PER_BATCH = 10, BATCHES = 2; // ~20 per family

const SCAM = {
  bank_fraud_alert: 'A fake invoice/notice saying the recipient\'s bank flagged this payment as suspicious or fraudulent, and they should call a number to reverse or dispute it.',
  gift_card_order: 'A fake invoice saying an order of several high-value gift cards (e.g. 5x $200) was confirmed and charged, and the recipient should call to cancel it.',
  web_hosting_domain_renewal: 'A fake invoice for web hosting or a domain name renewal the recipient never ordered, pushing them to call a number to cancel or dispute.',
  extended_warranty_insurance: 'A fake invoice for an extended warranty or insurance plan (car, appliance, device) the recipient never bought, pushing them to call to cancel or get a refund.',
  paypal_account_limitation: 'A fake invoice/notice saying the recipient\'s PayPal account has been limited or restricted, and they must call a number to restore it.',
};
const LEGIT = {
  cleaning_service: 'A real house or office cleaning company billing a real customer for a completed or scheduled cleaning.',
  veterinary_clinic: 'A real veterinary clinic billing a pet owner for an exam, vaccines, surgery, boarding, etc.',
  hvac_service_plan: 'A real HVAC company billing for a maintenance service plan, including renewals and notes such as how to call to cancel or change the plan.',
  fitness_studio_membership: 'A real gym or fitness studio billing a member for a membership, classes or personal training, with normal cancellation/freeze policies.',
  saas_vendor_billing: 'A real software-as-a-service vendor billing a business customer for seats/usage, including their own billing support line or phone number.',
  domain_registrar_legit: 'A real domain registrar or hosting provider billing a customer for renewal of the customer\'s OWN domain(s) that they registered, including a support phone number and renewal/auto-renew wording.',
};

const SYSTEM = 'You generate realistic synthetic test data for a fraud-detection research dataset. Output only valid JSON, no commentary.';
function prompt(kind, desc, n, batch) {
  return `Write ${n} different invoice texts. Scenario: ${desc}
${kind === 'scam' ? 'These are scam invoices (batch ' + batch + '): sent to trick the recipient.' : 'These are genuine, legitimate invoices from real businesses (batch ' + batch + ').'}

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- ${kind === 'scam' ? 'Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.' : 'Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.'}
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of ${n} objects and nothing else.`;
}

async function call(model, user, usage) {
  const res = await fetch(config.llm.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.llm.apiKey },
    body: JSON.stringify({ model, temperature: 1, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const u = j.usage || {};
  usage.prompt += u.prompt_tokens || 0; usage.completion += u.completion_tokens || 0; usage.cost += Number(u.cost || 0);
  const txt = j.choices[0].message.content || '';
  const m = txt.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('no JSON array');
  return JSON.parse(m[0]);
}

const PHONE = /(\+44\s?20\s?7946\s?0\d{2}\s?\d{0,3})|(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})|(\b555[\s.-]?01\d\d\b)/;
const HN_WORD = /\b(cancel\w*|renew\w*|refund\w*|urgent\w*|late|overdue|immediately|penalt\w*)\b/i;
const text = (r) => [r.invoicer, r.note, r.terms, ...(r.items || []).flatMap((i) => [i.name, i.description])].filter(Boolean).join(' \n ');

async function main() {
  let model = MODELS[0];
  const usage = { prompt: 0, completion: 0, cost: 0 };
  const jobs = [];
  for (const [fam, d] of Object.entries(SCAM)) for (let b = 1; b <= BATCHES; b++) jobs.push({ label: 'scam', fam, d, b });
  for (const [fam, d] of Object.entries(LEGIT)) for (let b = 1; b <= BATCHES; b++) jobs.push({ label: 'legit', fam, d, b });
  const prompts = [{ system: SYSTEM }];
  const raw = [];
  for (const j of jobs) {
    const p = prompt(j.label, j.d, PER_BATCH, j.b);
    prompts.push({ family: j.fam, batch: j.b, user: p });
    let arr;
    for (let attempt = 0; attempt < 3 && !arr; attempt++) {
      try { arr = await call(model, p, usage); }
      catch (e) {
        console.error(`${j.fam}#${j.b} (${model}) attempt ${attempt + 1}: ${e.message}`);
        if (/HTTP (400|404)/.test(e.message) && model === MODELS[0]) { model = MODELS[1]; console.error('falling back to ' + model); }
      }
    }
    if (!arr) { console.error('giving up on ' + j.fam + '#' + j.b); continue; }
    for (const r of arr) raw.push({ ...j, model, r });
    console.error(`${j.fam}#${j.b}: ${arr.length} rows | tokens ${usage.prompt}/${usage.completion} cost $${usage.cost.toFixed(4)}`);
    if (usage.cost > 0.3) { console.error('spend cap hit'); break; }
  }

  const seen = new Set(), out = [], drops = { duplicate: 0, scam_no_phone_no_call: 0, malformed: 0 };
  const idx = {};
  for (const { label, fam, model: mdl, r } of raw) {
    if (!r || typeof r !== 'object' || typeof r.note !== 'string' || !Array.isArray(r.items)) { drops.malformed++; continue; }
    const row = {
      label, family: fam, split: 'heldout2',
      invoicer: String(r.invoicer || ''), amount: String(r.amount || '').replace(/[^0-9.]/g, ''), currency: 'USD',
      items: r.items.map((i) => ({ name: String((i && i.name) || ''), description: String((i && i.description) || '') })),
      note: r.note, terms: String(r.terms || ''),
    };
    const key = JSON.stringify([row.invoicer, row.amount, row.items, row.note, row.terms]);
    if (seen.has(key)) { drops.duplicate++; continue; }
    seen.add(key);
    const t = text(row);
    if (label === 'scam' && !PHONE.test(t) && !/\bcall/i.test(t)) { drops.scam_no_phone_no_call++; continue; }
    const hard = label === 'legit' ? (PHONE.test(t) || HN_WORD.test(t)) : false;
    idx[fam] = (idx[fam] || 0) + 1;
    out.push({ id: `h2-${fam}-${String(idx[fam]).padStart(3, '0')}`, label, family: fam, split: 'heldout2', hard_negative: hard, lang: 'en', adversarial_type: null,
      invoicer: row.invoicer, amount: row.amount, currency: 'USD', items: row.items, note: row.note, terms: row.terms, generator: mdl });
  }
  const file = path.join(DATA, 'heldout2.jsonl');
  fs.writeFileSync(file, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(path.join(DATA, 'heldout2.sha256'), `${sha}  heldout2.jsonl\n`);

  const counts = {};
  for (const r of out) { const c = counts[r.family] = counts[r.family] || { label: r.label, n: 0, hard_negative: 0 }; c.n++; if (r.hard_negative) c.hard_negative++; }
  const nLegit = out.filter((r) => r.label === 'legit'), nHn = nLegit.filter((r) => r.hard_negative).length;
  const readme = `# heldout2: fresh held-out pack

- Generator model: ${[...new Set(out.map((r) => r.generator))].join(', ')} (non-Claude; the judge is Claude Haiku)
- Date: ${new Date().toISOString()}
- Frozen before any judge run. The HangUp judge (checkInvoice/llmJudge) must be run on it exactly once, by the lead. No tuning afterwards.
- Generator was not shown the existing dataset or the judge prompt. Script: \`eval/gen_heldout2.js\`
- Token usage: prompt ${usage.prompt}, completion ${usage.completion}; reported cost $${usage.cost.toFixed(4)}
- Rows: ${out.length} (scam ${out.length - nLegit.length}, legit ${nLegit.length}, legit hard negatives ${nHn} = ${(100 * nHn / nLegit.length).toFixed(0)}%)
- Labels come from the requested family. Legit hard_negative is a code rule: phone number present, or a cancel/renew/refund/urgent/late/overdue/immediately/penalty word present.
- Sanity filter (code only): dropped ${drops.duplicate} exact duplicates, ${drops.scam_no_phone_no_call} scam rows with no phone and no "call" word, ${drops.malformed} malformed.
- sha256 of heldout2.jsonl: \`${sha}\`

## Per-family counts
${Object.entries(counts).map(([f, c]) => `- ${f} (${c.label}): ${c.n}${c.label === 'legit' ? `, hard negatives ${c.hard_negative}` : ''}`).join('\n')}

## Prompts (verbatim)

System prompt for every call:

\`\`\`
${SYSTEM}
\`\`\`

User prompts (${PER_BATCH} per call, ${BATCHES} calls per family):

${prompts.slice(1).map((p) => `### ${p.family} batch ${p.batch}\n\n\`\`\`\n${p.user}\n\`\`\``).join('\n\n')}
`;
  fs.writeFileSync(path.join(DATA, 'heldout2.README.md'), readme);
  console.log(JSON.stringify({ rows: out.length, counts, drops, usage, sha, hard_neg_legit: `${nHn}/${nLegit.length}` }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
