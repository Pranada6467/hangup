#!/usr/bin/env node
'use strict';
// Runs the REAL extension code (banner.js + gmail.js) in headless Chromium against the Gmail-LIKE fixture and the mock-inbox demo page,
// with the REAL HangUp checker (real LLM) behind /api/check. It is NOT a test of live Gmail. Needs the repo-root .env:
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/verify_gmail_fixture.js
// Writes eval/results/gmail_fixture_live.json (verdicts and banner headlines only; no keys).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, open, banners, FIXTURE, DEMO } = require('../extension/test/helpers');

const CASES = [
  [FIXTURE + '#inbox/scam', null, 'fixture: real quoted scam invoice (anonymised)'],
  [FIXTURE + '#inbox/request', null, 'fixture: real quoted scam money request (anonymised)'],
  [FIXTURE + '#inbox/legit', null, "fixture: fictional legit plumber invoice (with the unfamiliar-seller line)"],
  [DEMO, "Invoice from hangup STAGED Maple Bay Digital", 'mock inbox: staged TotalDefend scam'],
  [DEMO, "Invoice from hangup STAGED Dana's Plumbing", "mock inbox: staged Dana's Plumbing"],
];
(async () => {
  const srv = await startServer(true), browser = await chromium.launch(), rows = [];
  try {
    for (const [url, click, label] of CASES) {
      const { page, sent } = await open(browser, srv, url);
      if (click) await page.getByText(click, { exact: false }).first().click();
      let b = [];
      for (let i = 0; i < 90 && !(b.length && !/checking/.test(b[0].head)); i++) { await page.waitForTimeout(1000); b = await banners(page); }
      rows.push({ case: label, requests: sent.length, banner: b[0] ? b[0].head : null, tone: b[0] ? b[0].cls.replace('bar ', '') : null, unfamiliar_seller: sent[0] ? sent[0].unfamiliar_seller : null });
      console.log(JSON.stringify(rows.at(-1)));
      await page.close();
    }
  } finally { await browser.close(); srv.close(); }
  const out = { ran_at: new Date().toISOString(), note: 'Real extension code, real HangUp checker and LLM, on Gmail-LIKE fixtures and the mock inbox. NOT live Gmail.', rows };
  fs.writeFileSync(path.join(__dirname, '..', 'eval', 'results', 'gmail_fixture_live.json'), JSON.stringify(out, null, 2) + '\n');
})().catch((e) => { console.error(e); process.exit(1); });
