# HangUp

**Stop the callback scam hidden in a real PayPal invoice.**

Hosted demo: **https://payyourpal-hangup.onrender.com** (PayPal sandbox, Render free plan, so the first load can take about a minute). Built for the PayPal AI Hackathon.

> The email really comes from PayPal. It passes SPF, DKIM and DMARC, shows the blue tick and links to a genuine paypal.com page. The scam is one sentence in the seller's note: *"If you did not authorise this, call our billing helpline at 1-888-…"*

HangUp reads the text of a PayPal invoice and says whether it is trying to get someone to **phone a number about a charge they never made** (a callback scam, also called TOAD). It runs in two places:

1. **HangUp Gate, before the invoice is sent.** This is the check PayPal Invoicing should run at send time. It sits in front of Invoicing v2 and allows, holds or blocks each invoice. It links one callback number across sellers into a campaign, and one click cancels that campaign's invoices that were already sent.
2. **HangUp extension, for the person who received the invoice.** A Chrome extension runs on the genuine `paypal.com/invoice/p/…` page and in Gmail. It shows a plain-language banner: *"Don't call the number in this invoice. This is a real PayPal page, but the note was written by the sender, not PayPal."* A caregiver can install it once for a parent. A paste-a-link check page is included too.

## The problem

Scammers open real PayPal business accounts and send real invoices for "Norton renewal $499" or "unauthorised PayPal charge". There is no malicious link, so link scanners and email filters pass the email. Nothing is paid through the invoice, so payment-fraud checks miss it too. The harm happens on the phone call: remote-access software, fake "refunds", gift cards.

- [Hackread, Jan 2026](https://hackread.com/paypal-scam-verified-invoices-fake-support-numbers): a verified PayPal invoice passed SPF, DKIM, DMARC and Google Workspace filters, with the scam in "Note to Customer".
- [BBB, Mar 2025](https://www.bbb.org/article/scams/31573-fake-invoice-scam-with-paypal-twist-hits-business-and-consumers-nationwide): 200 Scam Tracker reports of one PayPal-invoice variant in two weeks.
- FBI IC3 2025 ([secondary coverage](https://securitypointbreak.com/2026/04/10/fraud-not-hacking-drove-2025-cyber-losses-fbi-crime-report)): tech-support fraud losses of $2.13B.
- In our own sandbox test, a staged scam invoice came back with `spam_info: {}`, the same as a benign control. The public payer page shows the note and number without login. This shows only that the sandbox draws no distinction. It tells us nothing about what production PayPal screens.

## How it works

```
invoice text ─► normaliser (code) ─► LLM fills a strict form ─► decide (plain code) ─► verdict
                 lookalike digits,     no tools, no fetching;      hard rules; the LLM
                 spaced/spelled numbers  note treated as hostile     never decides alone
```

- **Normaliser.** Turns `8 0 8 · 5 5 5 · O l 4 2`, full-width digits and "eight zero eight…" into one canonical number, and extracts phones, URLs and emails.
- **LLM judge** (`anthropic/claude-haiku-5.5` via OpenRouter, temperature 0, JSON only). It fills a form: callback demanded, written for a reader who never ordered this, brand impersonated, urgency, remote-access or refund story, payment outside PayPal, prompt-injection attempt, and verbatim evidence quotes. A quote is kept only if it appears in the text, and it is mapped back to the exact span the person sees.
- **Decide (code).** `LIKELY_CALLBACK_SCAM` needs a callback demand, the LLM's overall reading and at least one concrete signal. Weaker patterns give `SUSPICIOUS`. HangUp **never says "safe"**: the lowest verdict is "No callback-scam pattern found in this invoice's text".
- **Gate policy.** No pattern → **ALLOW** (create and send). Suspicious → **HOLD** as a draft for a person to release or block. Likely scam → **BLOCK** (nothing is created). If the LLM is unreachable, it fails closed.
- **Campaigns.** Decisions are grouped by normalised callback number across sellers. Cancel touches only invoices whose own text was flagged. If an attacker puts a real plumber's number into scam notes, the plumber's invoices are never held or cancelled, and a test covers this.

### PayPal APIs used (sandbox, live)

| API | Used for |
|---|---|
| `POST /v1/oauth2/token` | OAuth2 client credentials |
| `POST /v2/invoicing/invoices` | Create the screened invoice as a draft, with a `PayPal-Request-Id` idempotency key |
| `POST /v2/invoicing/invoices/{id}/send` | Send allowed or released invoices |
| `GET /v2/invoicing/invoices/{id}` | Status, `recipient_view_url`, `spam_info` |
| `GET /v2/invoicing/invoices` | Backfill: judge invoices already sent when HangUp is switched on |
| `POST /v2/invoicing/invoices/{id}/cancel` | Cancel a scam campaign's sent invoices |
| `DELETE /v2/invoicing/invoices/{id}` | Discard a held draft confirmed as a block |
| `POST /v1/notifications/verify-webhook-signature` | Verify `INVOICING.INVOICE.*` webhooks before they change state |
| Public payer page `sandbox.paypal.com/invoice/p/#…` | What the extension and the check page read |

### Screening console (AG Grid)

`/console.html` is the screen a trust-and-safety reviewer works in, built on [AG Grid Community](https://www.ag-grid.com/) 32.3.3. Each row is one gate decision, with verdict and action badges, live PayPal status and the AI's evidence quote highlighted in the invoice text. It has filter chips, quick and floating filters, in-place updates with `applyTransaction` and cell flashing, and bulk release, block and campaign cancel with poisoning-safe selection. A row drawer shows the full reasoning, a campaigns tab has pinned totals, and the filtered view exports to CSV.

## Does the AI help? (eval)

**On real text** ([`app/eval/data/real_v2.jsonl`](app/eval/data/real_v2.jsonl), frozen with its hash before the run): 29 real scam notes quoted from public reports, and 50 real billing passages from 32 businesses (hospitals, vets, plumbers, IT resellers, Geek Squad's own renewal terms). 47 of the 50 mention a phone number, cancelling, renewal or a brand.

| Method | Real scams caught | Honest text flagged |
|---|---|---|
| Phone-number rule | 27/29 (93%) | 16/50 (32%) |
| TF-IDF + logistic regression | 25/29 (86%) | 12/50 (24%) |
| **HangUp (HOLD or BLOCK)** | **27/29 (93%)** | **1/50 (2%)** |
| **HangUp, BLOCK only** | **25/29 (86%)** | **0/50** |

HangUp catches as many scams as a phone-number rule while flagging almost none of the honest bills that rule flags. On a second, held-out real set (`real_v3`: 16 new scams, 25 honest passages from 17 more businesses), HangUp caught 16/16 and flagged 0/25, while the phone rule flagged 13/25. Details: [`REAL.md`](app/eval/results/REAL.md), [`REAL_v3.md`](app/eval/results/REAL_v3.md).

**On synthetic held-out data** (216 invoices written by a different model family, frozen before the judge saw them, 111 of the 120 legit rows hard negatives): HangUp caught 95.8% of scams with 5.4% false holds, against 87.5% and 15.3% for TF-IDF and 99.0% and 91.9% for a phone rule. Full tables with confidence intervals: [`LATEST.md`](app/eval/results/LATEST.md).

## Run it

Requirements: Node 22, and Chromium for Playwright (`npx playwright install chromium`).

```bash
cp .env.example .env      # fill in your own PayPal sandbox and OpenRouter keys
cd app
npm install
npm start                 # http://localhost:3000
npm test                  # unit tests use stubs; no keys needed
```

`.env` needs a PayPal **sandbox business** app client id and secret (developer.paypal.com → Apps & Credentials) and an OpenRouter API key. Without keys the server still starts, and `/api/health` reports what is unconfigured. All demo recipients are `@example.com`, and no email is sent.

- `/console.html`: the gate console. Press **Reset demo**, then run the **Demo story**: Monday without HangUp, Tuesday with HangUp on, then the campaign cancel, all with real sandbox IDs.
- `/`: the recipient and caregiver check. Paste a payer-page link or the invoice text.
- `/demo-email.html`: a labelled mock inbox that shows the Gmail banner.
- **Extension:** `chrome://extensions` → Load unpacked → `app/extension/`. See [`app/extension/README.md`](app/extension/README.md) for exactly what it reads and sends.
- **Eval:** `npm run eval`, or `node eval/run_real.js` for the real-text sets.

## Limits

- A scammer with their own PayPal business account bypasses any third party's gate. Only PayPal can screen that path, so the gate is a reference for the check PayPal should run. The extension protects people who have it installed.
- Gray zone: an honest domain-renewal notice with a "call to cancel" line can be flagged. Text alone cannot tell it apart from the scam version.
- The Gmail script is tested on a Gmail-like fixture and a mock inbox, not on live Gmail. It reads English PayPal emails only.
- Demo sellers are staged rows sending through one sandbox merchant, and they are labelled STAGED in the UI. Cancelling an invoice cannot recall an email that was already delivered.
- Eval counts are small, and the honest real rows are public billing text rather than sent invoices.
- HangUp says "looks like", never "you are being scammed" and never "safe". It is not legal or financial advice.

## License

MIT, see [`LICENSE`](LICENSE).
