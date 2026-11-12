# HangUp eval results

> **SYNTHETIC DATA.** Every invoice note here is generated for evaluation. Numbers do not describe real-world performance.

Commit: `1d47643` | data: `eval/data/notes.jsonl` | rows dev/test/adv/real: 310/180/51/10 | generated: 2026-11-08T06:13:02.379Z
B2 trained on dev only: {"threshold":0.62,"vocab":12610,"trained_on":310}. LLM model: anthropic/claude-haiku-5.5; cache hits 914, live calls 0.

## Held-out test (unseen families/trades) - SUSPICIOUS or LIKELY counts as flagged

| Method | n | Recall | Precision | F1 | False flag (all legit) | False flag (hard negatives) | Adv. pass | Mean latency | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|
| B0 phone-or-URL (US format) | 180 | 100.0% [100.0%-100.0%] | 90.1% | 94.8% | 13.8% [6.3%-22.5%] | 24.4% [11.1%-37.8%] | n/a | - | 0/0 |
| B0-intl any phone/URL (added post hoc) | 180 | 100.0% [100.0%-100.0%] | 80.0% | 88.9% | 31.3% [21.3%-41.3%] | 55.6% [42.2%-68.9%] | n/a | - | 0/0 |
| B1 keyword+regex | 180 | 66.0% [56.0%-75.0%] | 89.2% | 75.9% | 10.0% [3.8%-17.5%] | 17.8% [6.7%-28.9%] | n/a | - | 0/0 |
| B2 TF-IDF+LR | 180 | 90.0% [84.0%-96.0%] | 85.7% | 87.8% | 18.8% [11.3%-27.5%] | 28.9% [15.6%-42.2%] | n/a | - | 0/0 |
| LLM judge + decide | 180 | 91.0% [85.0%-96.0%] | 98.9% | 94.8% | 1.3% [0.0%-3.8%] | 2.2% [0.0%-6.7%] | n/a | 2257 ms | 271733/79660 |
| LLM form alone (callback && disputes) | 180 | 83.0% [75.0%-90.0%] | 100.0% | 90.7% | 0.0% [0.0%-0.0%] | 0.0% [0.0%-0.0%] | n/a | 2257 ms | 271733/79660 |
| LLM judge + 5 Nov decide rule (ablation, same LLM answers) | 180 | 93.0% [88.0%-98.0%] | 96.9% | 94.9% | 3.8% [0.0%-8.8%] | 6.7% [0.0%-15.6%] | n/a | 2257 ms | 271733/79660 |
| LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) | 180 | 91.0% [85.0%-96.0%] | 98.9% | 94.8% | 1.3% [0.0%-3.8%] | 2.2% [0.0%-6.7%] | n/a | 2257 ms | 271733/79660 |

Per-family recall (scam rows):

| Family | B0 phone-or-URL (US format) | B0-intl any phone/URL (added post hoc) | B1 keyword+regex | B2 TF-IDF+LR | LLM judge + decide | LLM form alone (callback && disputes) | LLM judge + 5 Nov decide rule (ablation, same LLM answers) | LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) |
|---|---|---|---|---|---|---|---|---|
| crypto_purchase | 100.0% (n=25) | 100.0% (n=25) | 72.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) |
| geek_squad_service | 100.0% (n=25) | 100.0% (n=25) | 84.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) |
| ads_subscription | 100.0% (n=25) | 100.0% (n=25) | 48.0% (n=25) | 88.0% (n=25) | 64.0% (n=25) | 60.0% (n=25) | 72.0% (n=25) | 64.0% (n=25) |
| refund_overpayment | 100.0% (n=25) | 100.0% (n=25) | 60.0% (n=25) | 72.0% (n=25) | 100.0% (n=25) | 72.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) |

## Held-out test (unseen families/trades) - only LIKELY_CALLBACK_SCAM counts as flagged

| Method | n | Recall | Precision | F1 | False flag (all legit) | False flag (hard negatives) | Adv. pass | Mean latency | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|
| B0 phone-or-URL (US format) | 180 | 100.0% [100.0%-100.0%] | 90.1% | 94.8% | 13.8% [6.3%-22.5%] | 24.4% [11.1%-37.8%] | n/a | - | 0/0 |
| B0-intl any phone/URL (added post hoc) | 180 | 100.0% [100.0%-100.0%] | 80.0% | 88.9% | 31.3% [21.3%-41.3%] | 55.6% [42.2%-68.9%] | n/a | - | 0/0 |
| B1 keyword+regex | 180 | 66.0% [56.0%-75.0%] | 89.2% | 75.9% | 10.0% [3.8%-17.5%] | 17.8% [6.7%-28.9%] | n/a | - | 0/0 |
| B2 TF-IDF+LR | 180 | 90.0% [84.0%-96.0%] | 85.7% | 87.8% | 18.8% [11.3%-27.5%] | 28.9% [15.6%-42.2%] | n/a | - | 0/0 |
| LLM judge + decide | 180 | 89.0% [83.0%-95.0%] | 98.9% | 93.7% | 1.3% [0.0%-3.8%] | 2.2% [0.0%-6.7%] | n/a | 2257 ms | 271733/79660 |
| LLM form alone (callback && disputes) | 180 | 83.0% [75.0%-90.0%] | 100.0% | 90.7% | 0.0% [0.0%-0.0%] | 0.0% [0.0%-0.0%] | n/a | 2257 ms | 271733/79660 |
| LLM judge + 5 Nov decide rule (ablation, same LLM answers) | 180 | 89.0% [83.0%-95.0%] | 98.9% | 93.7% | 1.3% [0.0%-3.8%] | 2.2% [0.0%-6.7%] | n/a | 2257 ms | 271733/79660 |
| LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) | 180 | 89.0% [83.0%-95.0%] | 98.9% | 93.7% | 1.3% [0.0%-3.8%] | 2.2% [0.0%-6.7%] | n/a | 2257 ms | 271733/79660 |

Per-family recall (scam rows):

| Family | B0 phone-or-URL (US format) | B0-intl any phone/URL (added post hoc) | B1 keyword+regex | B2 TF-IDF+LR | LLM judge + decide | LLM form alone (callback && disputes) | LLM judge + 5 Nov decide rule (ablation, same LLM answers) | LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) |
|---|---|---|---|---|---|---|---|---|
| crypto_purchase | 100.0% (n=25) | 100.0% (n=25) | 72.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) |
| geek_squad_service | 100.0% (n=25) | 100.0% (n=25) | 84.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) | 100.0% (n=25) |
| ads_subscription | 100.0% (n=25) | 100.0% (n=25) | 48.0% (n=25) | 88.0% (n=25) | 60.0% (n=25) | 60.0% (n=25) | 60.0% (n=25) | 60.0% (n=25) |
| refund_overpayment | 100.0% (n=25) | 100.0% (n=25) | 60.0% (n=25) | 72.0% (n=25) | 96.0% (n=25) | 72.0% (n=25) | 96.0% (n=25) | 96.0% (n=25) |

## Adversarial pack - SUSPICIOUS or LIKELY counts as flagged

| Method | n | Recall | Precision | F1 | False flag (all legit) | False flag (hard negatives) | Adv. pass | Mean latency | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|
| B0 phone-or-URL (US format) | 51 | 36.6% [22.0%-51.2%] | 88.2% | 51.7% | 20.0% [0.0%-50.0%] | 20.0% [0.0%-50.0%] | 45.1% | - | 0/0 |
| B0-intl any phone/URL (added post hoc) | 51 | 80.5% [68.3%-92.7%] | 82.5% | 81.5% | 70.0% [40.0%-90.0%] | 70.0% [40.0%-90.0%] | 70.6% | - | 0/0 |
| B1 keyword+regex | 51 | 61.0% [46.3%-75.6%] | 96.2% | 74.6% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 66.7% | - | 0/0 |
| B2 TF-IDF+LR | 51 | 87.8% [78.0%-95.1%] | 97.3% | 92.3% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 88.2% | - | 0/0 |
| LLM judge + decide | 51 | 100.0% [100.0%-100.0%] | 97.6% | 98.8% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 98.0% | 2145 ms | 77311/21750 |
| LLM form alone (callback && disputes) | 51 | 97.6% [92.7%-100.0%] | 97.6% | 97.6% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 96.1% | 2145 ms | 77311/21750 |
| LLM judge + 5 Nov decide rule (ablation, same LLM answers) | 51 | 100.0% [100.0%-100.0%] | 97.6% | 98.8% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 98.0% | 2145 ms | 77311/21750 |
| LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) | 51 | 100.0% [100.0%-100.0%] | 97.6% | 98.8% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 98.0% | 2145 ms | 77311/21750 |

Per-family recall (scam rows):

| Family | B0 phone-or-URL (US format) | B0-intl any phone/URL (added post hoc) | B1 keyword+regex | B2 TF-IDF+LR | LLM judge + decide | LLM form alone (callback && disputes) | LLM judge + 5 Nov decide rule (ablation, same LLM answers) | LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) |
|---|---|---|---|---|---|---|---|---|
| adv_scam | 36.6% (n=41) | 80.5% (n=41) | 61.0% (n=41) | 87.8% (n=41) | 100.0% (n=41) | 97.6% (n=41) | 100.0% (n=41) | 100.0% (n=41) |

## Adversarial pack - only LIKELY_CALLBACK_SCAM counts as flagged

| Method | n | Recall | Precision | F1 | False flag (all legit) | False flag (hard negatives) | Adv. pass | Mean latency | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|
| B0 phone-or-URL (US format) | 51 | 36.6% [22.0%-51.2%] | 88.2% | 51.7% | 20.0% [0.0%-50.0%] | 20.0% [0.0%-50.0%] | 45.1% | - | 0/0 |
| B0-intl any phone/URL (added post hoc) | 51 | 80.5% [68.3%-92.7%] | 82.5% | 81.5% | 70.0% [40.0%-90.0%] | 70.0% [40.0%-90.0%] | 70.6% | - | 0/0 |
| B1 keyword+regex | 51 | 61.0% [46.3%-75.6%] | 96.2% | 74.6% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 66.7% | - | 0/0 |
| B2 TF-IDF+LR | 51 | 87.8% [78.0%-95.1%] | 97.3% | 92.3% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 88.2% | - | 0/0 |
| LLM judge + decide | 51 | 100.0% [100.0%-100.0%] | 97.6% | 98.8% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 98.0% | 2145 ms | 77311/21750 |
| LLM form alone (callback && disputes) | 51 | 97.6% [92.7%-100.0%] | 97.6% | 97.6% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 96.1% | 2145 ms | 77311/21750 |
| LLM judge + 5 Nov decide rule (ablation, same LLM answers) | 51 | 100.0% [100.0%-100.0%] | 97.6% | 98.8% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 98.0% | 2145 ms | 77311/21750 |
| LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) | 51 | 100.0% [100.0%-100.0%] | 97.6% | 98.8% | 10.0% [0.0%-30.0%] | 10.0% [0.0%-30.0%] | 98.0% | 2145 ms | 77311/21750 |

Per-family recall (scam rows):

| Family | B0 phone-or-URL (US format) | B0-intl any phone/URL (added post hoc) | B1 keyword+regex | B2 TF-IDF+LR | LLM judge + decide | LLM form alone (callback && disputes) | LLM judge + 5 Nov decide rule (ablation, same LLM answers) | LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) |
|---|---|---|---|---|---|---|---|---|
| adv_scam | 36.6% (n=41) | 80.5% (n=41) | 61.0% (n=41) | 87.8% (n=41) | 100.0% (n=41) | 97.6% (n=41) | 100.0% (n=41) | 100.0% (n=41) |

## Real quoted notes (public write-ups; scam-only, so recall only)

Source: `eval/data/real_quoted.jsonl` (10 notes quoted from public reports, see real_quoted_SOURCES.md). No legit rows, so no precision or false-flag figures exist for this split.

| Method | n | Recall (SUSPICIOUS or LIKELY) | Recall (LIKELY only) |
|---|---|---|---|
| B0 phone-or-URL (US format) | 10 | 80.0% [50.0%-100.0%] | 80.0% [50.0%-100.0%] |
| B0-intl any phone/URL (added post hoc) | 10 | 80.0% [50.0%-100.0%] | 80.0% [50.0%-100.0%] |
| B1 keyword+regex | 10 | 60.0% [30.0%-90.0%] | 60.0% [30.0%-90.0%] |
| B2 TF-IDF+LR | 10 | 70.0% [40.0%-100.0%] | 70.0% [40.0%-100.0%] |
| LLM judge + decide | 10 | 90.0% [70.0%-100.0%] | 80.0% [50.0%-100.0%] |
| LLM form alone (callback && disputes) | 10 | 70.0% [40.0%-100.0%] | 70.0% [40.0%-100.0%] |
| LLM judge + 5 Nov decide rule (ablation, same LLM answers) | 10 | 90.0% [70.0%-100.0%] | 80.0% [50.0%-100.0%] |
| LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) | 10 | 90.0% [70.0%-100.0%] | 90.0% [70.0%-100.0%] |

## Fresh held-out pack (written by openai/gpt-5-mini, never seen during tuning) - SUSPICIOUS or LIKELY counts as flagged

Source: `eval/data/heldout2.jsonl`, 216 rows, new scam families and new legit trades.

| Method | n | Recall | Precision | F1 | False flag (all legit) | False flag (hard negatives) | Mean latency | Tokens in/out |
|---|---|---|---|---|---|---|---|---|
| B0 phone-or-URL (US format) | 216 | 64.6% [55.2%-74.0%] | 45.3% | 53.2% | 62.5% [54.2%-70.8%] | 67.6% [58.6%-76.6%] | - | 0/0 |
| B0-intl any phone/URL (added post hoc) | 216 | 99.0% [96.9%-100.0%] | 48.2% | 64.8% | 85.0% [78.3%-91.7%] | 91.9% [86.5%-96.4%] | - | 0/0 |
| B1 keyword+regex | 216 | 75.0% [66.7%-83.3%] | 50.3% | 60.3% | 59.2% [50.0%-67.5%] | 64.0% [55.0%-73.0%] | - | 0/0 |
| B2 TF-IDF+LR | 216 | 87.5% [80.2%-92.7%] | 83.2% | 85.3% | 14.2% [8.3%-20.8%] | 15.3% [8.1%-22.5%] | - | 0/0 |
| LLM judge + decide | 216 | 95.8% [91.7%-99.0%] | 93.9% | 94.8% | 5.0% [1.7%-9.2%] | 5.4% [1.8%-9.9%] | 2508 ms | 344224/109084 |
| LLM form alone (callback && disputes) | 216 | 95.8% [91.7%-99.0%] | 96.8% | 96.3% | 2.5% [0.0%-5.8%] | 2.7% [0.0%-6.3%] | 2508 ms | 344224/109084 |
| LLM judge + 5 Nov decide rule (ablation, same LLM answers) | 216 | 95.8% [91.7%-99.0%] | 89.3% | 92.5% | 9.2% [4.2%-14.2%] | 9.9% [4.5%-16.2%] | 2508 ms | 344224/109084 |
| LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) | 216 | 95.8% [91.7%-99.0%] | 93.9% | 94.8% | 5.0% [1.7%-9.2%] | 5.4% [1.8%-9.9%] | 2508 ms | 344224/109084 |

Per-family recall (scam rows):

| Family | B0 phone-or-URL (US format) | B0-intl any phone/URL (added post hoc) | B1 keyword+regex | B2 TF-IDF+LR | LLM judge + decide | LLM form alone (callback && disputes) | LLM judge + 5 Nov decide rule (ablation, same LLM answers) | LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) |
|---|---|---|---|---|---|---|---|---|
| bank_fraud_alert | 50.0% (n=20) | 100.0% (n=20) | 70.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) |
| gift_card_order | 70.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 95.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) |
| web_hosting_domain_renewal | 94.1% (n=17) | 100.0% (n=17) | 94.1% (n=17) | 70.6% (n=17) | 76.5% (n=17) | 76.5% (n=17) | 76.5% (n=17) | 76.5% (n=17) |
| extended_warranty_insurance | 36.8% (n=19) | 94.7% (n=19) | 47.4% (n=19) | 68.4% (n=19) | 100.0% (n=19) | 100.0% (n=19) | 100.0% (n=19) | 100.0% (n=19) |
| paypal_account_limitation | 75.0% (n=20) | 100.0% (n=20) | 65.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) |

## Fresh held-out pack (written by openai/gpt-5-mini, never seen during tuning) - only LIKELY_CALLBACK_SCAM counts as flagged

Source: `eval/data/heldout2.jsonl`, 216 rows, new scam families and new legit trades.

| Method | n | Recall | Precision | F1 | False flag (all legit) | False flag (hard negatives) | Mean latency | Tokens in/out |
|---|---|---|---|---|---|---|---|---|
| B0 phone-or-URL (US format) | 216 | 64.6% [55.2%-74.0%] | 45.3% | 53.2% | 62.5% [54.2%-70.8%] | 67.6% [58.6%-76.6%] | - | 0/0 |
| B0-intl any phone/URL (added post hoc) | 216 | 99.0% [96.9%-100.0%] | 48.2% | 64.8% | 85.0% [78.3%-91.7%] | 91.9% [86.5%-96.4%] | - | 0/0 |
| B1 keyword+regex | 216 | 75.0% [66.7%-83.3%] | 50.3% | 60.3% | 59.2% [50.0%-67.5%] | 64.0% [55.0%-73.0%] | - | 0/0 |
| B2 TF-IDF+LR | 216 | 87.5% [80.2%-92.7%] | 83.2% | 85.3% | 14.2% [8.3%-20.8%] | 15.3% [8.1%-22.5%] | - | 0/0 |
| LLM judge + decide | 216 | 95.8% [91.7%-99.0%] | 96.8% | 96.3% | 2.5% [0.0%-5.8%] | 2.7% [0.0%-6.3%] | 2508 ms | 344224/109084 |
| LLM form alone (callback && disputes) | 216 | 95.8% [91.7%-99.0%] | 96.8% | 96.3% | 2.5% [0.0%-5.8%] | 2.7% [0.0%-6.3%] | 2508 ms | 344224/109084 |
| LLM judge + 5 Nov decide rule (ablation, same LLM answers) | 216 | 95.8% [91.7%-99.0%] | 96.8% | 96.3% | 2.5% [0.0%-5.8%] | 2.7% [0.0%-6.3%] | 2508 ms | 344224/109084 |
| LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) | 216 | 95.8% [91.7%-99.0%] | 96.8% | 96.3% | 2.5% [0.0%-5.8%] | 2.7% [0.0%-6.3%] | 2508 ms | 344224/109084 |

Per-family recall (scam rows):

| Family | B0 phone-or-URL (US format) | B0-intl any phone/URL (added post hoc) | B1 keyword+regex | B2 TF-IDF+LR | LLM judge + decide | LLM form alone (callback && disputes) | LLM judge + 5 Nov decide rule (ablation, same LLM answers) | LLM judge + decide, unfamiliar_seller=true on EVERY row (worst case, same LLM answers) |
|---|---|---|---|---|---|---|---|---|
| bank_fraud_alert | 50.0% (n=20) | 100.0% (n=20) | 70.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) |
| gift_card_order | 70.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 95.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) |
| web_hosting_domain_renewal | 94.1% (n=17) | 100.0% (n=17) | 94.1% (n=17) | 70.6% (n=17) | 76.5% (n=17) | 76.5% (n=17) | 76.5% (n=17) | 76.5% (n=17) |
| extended_warranty_insurance | 36.8% (n=19) | 94.7% (n=19) | 47.4% (n=19) | 68.4% (n=19) | 100.0% (n=19) | 100.0% (n=19) | 100.0% (n=19) | 100.0% (n=19) |
| paypal_account_limitation | 75.0% (n=20) | 100.0% (n=20) | 65.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) | 100.0% (n=20) |

Bootstrap CIs: 1000 seeded resamples, 95% percentile interval. Small n gives wide intervals.