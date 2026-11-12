# heldout2: fresh held-out pack

- Generator model: openai/gpt-5-mini (non-Claude; the judge is Claude Haiku)
- Date: 2026-11-05T07:45:42.542Z
- Frozen before any judge run. The HangUp judge (checkInvoice/llmJudge) must be run on it exactly once, by the lead. No tuning afterwards.
- Generator was not shown the existing dataset or the judge prompt. Script: `eval/gen_heldout2.js`
- Token usage: prompt 5526, completion 69028; reported cost $0.1394
- Rows: 216 (scam 96, legit 120, legit hard negatives 111 = 93%)
- Labels come from the requested family. Legit hard_negative is a code rule: phone number present, or a cancel/renew/refund/urgent/late/overdue/immediately/penalty word present.
- Sanity filter (code only): dropped 0 exact duplicates, 4 scam rows with no phone and no "call" word, 0 malformed.
- sha256 of heldout2.jsonl: `6a4524a6421956eec04306c2f5d8e5a7b8d2ef97a6d32056ddfadbe85d0dd276`

## Per-family counts
- bank_fraud_alert (scam): 20
- gift_card_order (scam): 20
- web_hosting_domain_renewal (scam): 17
- extended_warranty_insurance (scam): 19
- paypal_account_limitation (scam): 20
- cleaning_service (legit): 20, hard negatives 16
- veterinary_clinic (legit): 20, hard negatives 16
- hvac_service_plan (legit): 20, hard negatives 20
- fitness_studio_membership (legit): 20, hard negatives 19
- saas_vendor_billing (legit): 20, hard negatives 20
- domain_registrar_legit (legit): 20, hard negatives 20

## Prompts (verbatim)

System prompt for every call:

```
You generate realistic synthetic test data for a fraud-detection research dataset. Output only valid JSON, no commentary.
```

User prompts (10 per call, 2 calls per family):

### bank_fraud_alert batch 1

```
Write 10 different invoice texts. Scenario: A fake invoice/notice saying the recipient's bank flagged this payment as suspicious or fraudulent, and they should call a number to reverse or dispute it.
These are scam invoices (batch 1): sent to trick the recipient.

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### bank_fraud_alert batch 2

```
Write 10 different invoice texts. Scenario: A fake invoice/notice saying the recipient's bank flagged this payment as suspicious or fraudulent, and they should call a number to reverse or dispute it.
These are scam invoices (batch 2): sent to trick the recipient.

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### gift_card_order batch 1

```
Write 10 different invoice texts. Scenario: A fake invoice saying an order of several high-value gift cards (e.g. 5x $200) was confirmed and charged, and the recipient should call to cancel it.
These are scam invoices (batch 1): sent to trick the recipient.

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### gift_card_order batch 2

```
Write 10 different invoice texts. Scenario: A fake invoice saying an order of several high-value gift cards (e.g. 5x $200) was confirmed and charged, and the recipient should call to cancel it.
These are scam invoices (batch 2): sent to trick the recipient.

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### web_hosting_domain_renewal batch 1

```
Write 10 different invoice texts. Scenario: A fake invoice for web hosting or a domain name renewal the recipient never ordered, pushing them to call a number to cancel or dispute.
These are scam invoices (batch 1): sent to trick the recipient.

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### web_hosting_domain_renewal batch 2

```
Write 10 different invoice texts. Scenario: A fake invoice for web hosting or a domain name renewal the recipient never ordered, pushing them to call a number to cancel or dispute.
These are scam invoices (batch 2): sent to trick the recipient.

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### extended_warranty_insurance batch 1

```
Write 10 different invoice texts. Scenario: A fake invoice for an extended warranty or insurance plan (car, appliance, device) the recipient never bought, pushing them to call to cancel or get a refund.
These are scam invoices (batch 1): sent to trick the recipient.

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### extended_warranty_insurance batch 2

```
Write 10 different invoice texts. Scenario: A fake invoice for an extended warranty or insurance plan (car, appliance, device) the recipient never bought, pushing them to call to cancel or get a refund.
These are scam invoices (batch 2): sent to trick the recipient.

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### paypal_account_limitation batch 1

```
Write 10 different invoice texts. Scenario: A fake invoice/notice saying the recipient's PayPal account has been limited or restricted, and they must call a number to restore it.
These are scam invoices (batch 1): sent to trick the recipient.

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### paypal_account_limitation batch 2

```
Write 10 different invoice texts. Scenario: A fake invoice/notice saying the recipient's PayPal account has been limited or restricted, and they must call a number to restore it.
These are scam invoices (batch 2): sent to trick the recipient.

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some scams should be subtle and polite, not all shouting; some put the phone number only in an item name or item description rather than the note.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### cleaning_service batch 1

```
Write 10 different invoice texts. Scenario: A real house or office cleaning company billing a real customer for a completed or scheduled cleaning.
These are genuine, legitimate invoices from real businesses (batch 1).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### cleaning_service batch 2

```
Write 10 different invoice texts. Scenario: A real house or office cleaning company billing a real customer for a completed or scheduled cleaning.
These are genuine, legitimate invoices from real businesses (batch 2).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### veterinary_clinic batch 1

```
Write 10 different invoice texts. Scenario: A real veterinary clinic billing a pet owner for an exam, vaccines, surgery, boarding, etc.
These are genuine, legitimate invoices from real businesses (batch 1).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### veterinary_clinic batch 2

```
Write 10 different invoice texts. Scenario: A real veterinary clinic billing a pet owner for an exam, vaccines, surgery, boarding, etc.
These are genuine, legitimate invoices from real businesses (batch 2).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### hvac_service_plan batch 1

```
Write 10 different invoice texts. Scenario: A real HVAC company billing for a maintenance service plan, including renewals and notes such as how to call to cancel or change the plan.
These are genuine, legitimate invoices from real businesses (batch 1).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### hvac_service_plan batch 2

```
Write 10 different invoice texts. Scenario: A real HVAC company billing for a maintenance service plan, including renewals and notes such as how to call to cancel or change the plan.
These are genuine, legitimate invoices from real businesses (batch 2).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### fitness_studio_membership batch 1

```
Write 10 different invoice texts. Scenario: A real gym or fitness studio billing a member for a membership, classes or personal training, with normal cancellation/freeze policies.
These are genuine, legitimate invoices from real businesses (batch 1).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### fitness_studio_membership batch 2

```
Write 10 different invoice texts. Scenario: A real gym or fitness studio billing a member for a membership, classes or personal training, with normal cancellation/freeze policies.
These are genuine, legitimate invoices from real businesses (batch 2).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### saas_vendor_billing batch 1

```
Write 10 different invoice texts. Scenario: A real software-as-a-service vendor billing a business customer for seats/usage, including their own billing support line or phone number.
These are genuine, legitimate invoices from real businesses (batch 1).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### saas_vendor_billing batch 2

```
Write 10 different invoice texts. Scenario: A real software-as-a-service vendor billing a business customer for seats/usage, including their own billing support line or phone number.
These are genuine, legitimate invoices from real businesses (batch 2).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### domain_registrar_legit batch 1

```
Write 10 different invoice texts. Scenario: A real domain registrar or hosting provider billing a customer for renewal of the customer's OWN domain(s) that they registered, including a support phone number and renewal/auto-renew wording.
These are genuine, legitimate invoices from real businesses (batch 1).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```

### domain_registrar_legit batch 2

```
Write 10 different invoice texts. Scenario: A real domain registrar or hosting provider billing a customer for renewal of the customer's OWN domain(s) that they registered, including a support phone number and renewal/auto-renew wording.
These are genuine, legitimate invoices from real businesses (batch 2).

Rules:
- Realistic variety: each note is 1-5 sentences; vary tone, length, vendor names, amounts and structure.
- Some legitimate invoices should be pushy or formal: mention late fees, due dates, renewal, cancellation or refund policies, a support phone number, or sell a well-known brand legitimately.
- Use only fictional phone numbers in the format 555-01xx (e.g. (415) 555-0123) or +44 20 7946 0xxx.
- Amounts in US dollars, as a string like "149.99".
- Each object has exactly the fields: invoicer (string), amount (string), items (array of {name, description}), note (string), terms (string, may be empty).
Return a JSON array of 10 objects and nothing else.
```
