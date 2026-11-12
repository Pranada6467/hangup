# real_v2: real-world text, frozen before the judge ran on it

`real_v2.jsonl` holds 79 rows of **real, human-written text**, collected 2026-11-08 and frozen (sha256 in `real_v2.sha256`) before HangUp was run on any of it. Nothing in it was used to write or tune the judge prompt or the decide rules.

| Part | Rows | What it is |
|---|---|---|
| Real scam notes, first batch | 10 (`r-001`…`r-010`) | Same rows as `real_quoted.jsonl` (5 Nov). Sources in `real_quoted_SOURCES.md`. |
| Real scam notes, second batch | 19 (`r-011`…`r-029`) | Scammer-written invoice, money-request or notice text quoted verbatim from public reports (Malwarebytes, Krebs, BBB, Online Threat Alerts, MalwareTips, 800notes user reports). 3 were transcribed from screenshots, the rest copied from page text. Each row has `source_url`, `source_date`, `platform` and `captured_from`. `family` names the template, since scammers reuse wording: 12 distinct templates among the 19. |
| Real legitimate billing text | 50 (`rl-001`…`rl-050`) | Verbatim billing, renewal, cancellation, late-fee and contact passages from 32 real businesses' **public pages**: hospitals, vets, dentists, plumbers, cleaners, lawn care, music schools, tutors, gyms, HVAC, IT resellers and remote-support shops, and Geek Squad's own protection-plan terms. 47 are hard negatives (phone number, cancel/renew/refund, late fee or interest, or a brand such as Microsoft 365 or CareCredit). |

## Honest caveats
- **The legitimate rows are not sent invoices.** Real invoice notes from honest businesses are rarely published. These are the same businesses' own billing words, put in the note field. `assembled_from_two_passages: true` marks rows where two passages from the same page fill the note and terms fields.
- **Scam rows are biased toward what gets reported**: mostly 2022–2025 PayPal invoice and money-request text from US victims. Templates repeat (for example, the "If you did not authorize this order…" note appears 4 times with different numbers and sender names).
- **Amounts and item fields are empty for most legitimate rows**, which differs from the scam rows. HangUp reads the text, not the amount, but a reader should know.
- **Phone numbers are anonymised in both classes the same way**: the area code is kept, the rest becomes `555-01xx`, and the original formatting (brackets, dots, Unicode bold digits) is preserved. One real number always maps to the same fake one. Vanity numbers (`1-800-GeekSquad`) and a UK freephone number were left as published.
- One scam email address in r-012 was replaced with `recipient@example.com`.
- Labels are by source: scam rows come from scam reports, legitimate rows from the businesses' own sites. Nobody has re-labelled them, so treat this as n=79 with that limit.
