# HangUp: check before you call (Chrome extension, MV3)

Two places, one check. It shows a banner (red "Don't call the number in this invoice", amber "Be careful", or grey "No callback-scam pattern found") and never says an invoice is safe. Independent tool, not affiliated with PayPal.

1. **PayPal payer page** (`content.js`): reads the invoice page you have open.
2. **Gmail** (`gmail.js`, new): reads the PayPal invoice or money-request email you have open and shows the same banner above the message, before you click or call.

`banner.js` is the banner shared by both.

## Load it
1. By default the extension talks to the hosted server `https://payyourpal-hangup.onrender.com` (free tier: the first request after idle may take ~1 min). To use a local server instead, start HangUp (`http://localhost:3000`) and set it in Options.
2. Chrome > `chrome://extensions` > turn on Developer mode > **Load unpacked** > choose this `extension/` folder (or unzip `hangup-extension.zip` from the hosted site).
3. Open **Options** to change the server address (Chrome will ask permission for that origin), or to turn on stricter mode (treat the seller as unfamiliar).

## What the Gmail script reads and sends (exactly)

**Where it runs:** only `https://mail.google.com/mail/*`, plus the labelled mock inbox page `/demo-email.html` on the hosted server and on `localhost:3000`. No other Google or mail site. No new host permissions beyond what the extension already asks for; the Gmail match is a content-script match only.

**What it looks at:**
- Only the message bodies visible in the open conversation. For each, it first reads **only the sender address** from Gmail's header chip. If that is not exactly `service@paypal.com` or `service@intl.paypal.com`, it stops: the message text is never read, stored or sent. Other emails, the inbox list, drafts, attachments and your account details are never touched.
- For a PayPal sender it reads that one message's text on your screen, and carries on only if it contains the invoice or money-request markers ("sent you an invoice" or "sent you a money request", plus "Invoice details", "Payment request details" or "Amount requested"). A PayPal receipt or security notice does not match and is dropped.

**What it sends** (through the background worker, to the HangUp server you configured, `POST /api/check`): the seller name, the amount and currency, item lines if present, the seller's note, and `unfamiliar_seller: true` if the email contains "You don't have any payments with this seller in the last year" (otherwise `null`). With `source: "extension_gmail"`. Nothing else: not your address, the greeting, the subject, the sender address, message IDs, the Gmail URL, links or other emails. An invoice with no note and no items is not sent.

**What it shows:** a banner in a closed shadow root at the top of the message body, with the same wording, languages (en/es/fr) and "Why?" evidence as the payer-page banner. It can be dismissed. Verdicts are kept in memory for the page's life only; nothing is stored.

**Honest status: tested on a Gmail-like fixture; not verified on live Gmail; Gmail's DOM may differ.** The selectors (`div.adn` message, `div.a3s` body, `span.gD[email]` sender chip) come from open-source Gmail extensions, not from a live mailbox. If they stop matching, the script finds nothing and shows nothing. English PayPal emails only.

## 2-minute manual test in your own Gmail (owner only)
Do not use a real scam email, and do not forward anyone else's mail.
1. Load the extension (above) in the Chrome profile that is signed in to the Gmail you want to test.
2. In Gmail compose a message to yourself, subject `HANGUP TEST (not a real invoice)`. It will come from you, not PayPal, so HangUp must **ignore** it: open it and confirm no banner. (This checks the "other emails are left alone" claim; DevTools > Network on the service worker shows no `/api/check`.)
3. For the PayPal case, you need a message whose sender is `service@paypal.com`. Safest: from a PayPal **sandbox** or live business account you own, send an invoice or money request to your Gmail address with the note `HANGUP TEST. Fraud alert: didn't make this order? Call 1-888-555-0142`. (Sandbox invoices are not delivered to real inboxes, so this needs a live PayPal account you control, or a genuine PayPal invoice email you received and are allowed to test with.) Open the email in Gmail. Expected: a red "Don't call the number in this invoice" banner above the message; **Why?** highlights the number.
4. Open the HangUp service-worker console (chrome://extensions > HangUp > service worker) and check the request body has only the fields listed above.
5. Switch to another email and back: the banner follows the message. Report anything that differs (a blank result means Gmail's DOM differs from the fixture).

## Tests (no PayPal or Gmail needed)
- `node --test extension/test/*.test.js` (from `app/`) runs extraction against `public/fixtures/payer-view-sample.html` (a labelled fixture, not a PayPal page) and the Gmail script against `extension/test/fixtures/gmail-like.html` (a labelled Gmail-LIKE fixture). The tests use the real HangUp server with a stub checker, so they prove detection, extraction, banner and message switching, not the model.
- `node scripts/verify_gmail_fixture.js` runs the same fixtures with the real LLM behind `/api/check` and records the verdicts in `eval/results/gmail_fixture_live.json`. Still not live Gmail.
- Fixture sources: `extension/test/fixtures/SOURCES.md`.

## Caveats (payer page)
- The payer-view selectors were checked against a live sandbox page (Nov 2026); the production page is assumed to have the same layout. If the note is not found it sends the visible page text with `raw: true`.
- The page text is sent to the configured server; use a server you trust.
