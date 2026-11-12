# HangUp synthetic invoice-note evaluation set

`notes.jsonl`: 541 labelled, fully synthetic PayPal invoice texts for a callback-scam classifier. `stats.json` has counts per split, label, family, hard-negative status and adversarial type.

## Provenance and caveats (read first)
- Written by a Claude Sonnet agent from public descriptions of the scam (Hackread Jan 2026, New Hampshire Banking Dept alert, PayPal advisory, BleepingComputer Dec 2025). No real invoices, victims, or real support numbers are used. All phone numbers are fictional (555-01xx, +1 808 555 01xx, +44 20 7946 0xxx, +33 1 99 00 01xx).
- **Contamination risk:** the judge is also a Claude-family model, so the author and the judge share priors. The scam notes probably read like what a Claude model thinks a scam looks like, so scores here are likely optimistic. Real scam text is messier, shorter and weirder. Treat results as a regression/sanity benchmark, not a measure of real-world accuracy.
- The author's scam notes lean on cancel/refund/dispute-by-phone phrasing, so a model can learn that shortcut. Some scams are subtle, but the set under-represents scams with no cancel/dispute language.
- Each row was authored individually, but families share a template of intent, so rows are less diverse than real traffic. Most are single-item invoices and USD.
- The adv split has no near-duplicate-family structure and is small (51 rows). Do not use it for tuning.

## Splits
- `dev` (310): tuning allowed. Scam families: tech_support_renewal, paypal_unauthorized, ecommerce_order, streaming_sub, antivirus_renewal_mcafee, remote_access_tech. Legit trades: plumber/contractor, landscaper, tutor/music teacher/translator, wedding photographer, web agency, bakery/catering, accountant, dog groomer.
- `test` (180, held out by family): scam families crypto_purchase, geek_squad_service, ads_subscription, refund_overpayment. Legit trades it_consultant_av_reseller, auto_repair, event_venue, software_reseller.
- `adv` (51, never for tuning): 41 scam and 10 legit. Types: spaced_digits 5, lookalike_unicode 4, spelled_out 4, number_in_item_name 4, fullwidth_digits 4, prompt_injection 6, spanish 10 (6 scam, 4 legit), french 6 (4 scam, 2 legit), plus one each of zero_width, dotted_digits, mixed_obfuscation, leet_spacing, do_not_call_after_9pm (legit), and three further hard legit rows (reseller with phone, urgent plumber, refund already applied).

## Counts
Scam 291 (dev 150, test 100, adv 41). Legit 250 (dev 160, test 80, adv 10). Scam families have 25 rows each; legit trades 20 each.
Hard negatives (`hard_negative:true`) among legit: 132 of 250 (dev 77/160, test 45/80, adv 10/10). A hard negative has a phone number, URL, urgency or late fee, a cancellation/refund/renewal mention, or a legitimate brand mention. The flag was set by hand, so it is a judgement.

## Row format
`id, label (scam|legit), family, split, hard_negative, lang, adversarial_type, invoicer, amount, currency, items[{name,description}], note, terms`. Unicode tricks (full-width digits, Cyrillic lookalikes, zero-width spaces) are stored as real code points in the JSON.

Note: the `amount` field has no thousands separators.
