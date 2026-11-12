# Gmail-like fixture: sources

`gmail-like.html` is a TEST FIXTURE. It is not Gmail and it has not been compared with a live Gmail page.

## Gmail DOM structure (what the fixture imitates)
Taken from public open-source Gmail extensions (found with GitHub code search, read on 2026-11-08):
- milasterb/tells `extension/content/gmail-adapter.js`: `div.adn.ads` message wrapper, `div.a3s.aiL` body, `span.gD[email][name]` sender chip, `h2.hP` subject.
- baongocdz/phishguard `extension/src/gmail.ts`: Gmail keeps previously opened messages in the DOM and only hides them; read the visible `div.a3s`; wrapper `div.adn, div.gs`.
- MohisnNasim89/InboxGuardian `extension/content/gmail.js`: `div[role="main"]`, `data-message-id`, `data-legacy-message-id`.

## Email bodies
| fixture id | what | source |
|---|---|---|
| scam | PayPal invoice email, "Fraud Alert: Didn't make this order? Call at ..." incl. the "You don't have any payments with this seller in the last year." line | quoted on https://800notes.com/Phone.aspx/1-844-679-4024/2 (real_v2 row r-024). Phone anonymised to 1-844-555-0124 |
| request | PayPal money request, "Payment request details" / "Note from <Name>:" | the note is real_v2 r-025 (https://800notes.com/Phone.aspx/1-844-679-4024, phone anonymised to 1-844-555-0123). The surrounding money-request layout is reconstructed from that page's quote and is less certain than the invoice layout |
| legit | PayPal invoice email from a plumber, fictional | same layout as `scam`; text is the staged "Dana's Plumbing" job from `src/server.js` |
| receipt | PayPal payment receipt (no invoice markers), fictional | |
| lookalike | the `scam` text from a sender that is NOT service@paypal.com (service@paypal.com.mail-notice.example) | fictional; checks exact sender matching |
| plain | an ordinary email with a phone number in it, fictional | |
| thread | `plain` followed by `scam` in one conversation | |

Other real emails with the same layout (quoted, used only to test the parser): 800notes pages for 1-864-278-1865 (real_v2 r-021) and 1-833-815-2600 (r-022).
