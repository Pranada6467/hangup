'use strict';
// Config loader. Reads the repo-root .env with a tiny parser (never logs values).
const fs = require('node:fs');
const path = require('node:path');

function loadDotenv(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const envFile = path.resolve(__dirname, '../../.env');
const dot = loadDotenv(envFile);
const get = (...names) => {
  for (const n of names) {
    if (process.env[n]) return process.env[n];
    if (dot[n]) return dot[n];
  }
  return undefined;
};

const paypalEnv = get('PAYPAL_ENV') || 'sandbox';
module.exports = {
  paypal: {
    clientId: get('PAYPAL_CLIENT_ID', 'PAYPAL_SANDBOX_CLIENT_ID'),
    clientSecret: get('PAYPAL_CLIENT_SECRET', 'PAYPAL_SANDBOX_CLIENT_SECRET', 'PAYPAL_SECRET'),
    apiBase: get('PAYPAL_API_BASE') || (paypalEnv === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'),
    env: paypalEnv,
  },
  llm: {
    apiKey: get('OPENROUTER_API_KEY', 'LLM_API_KEY'),
    baseUrl: get('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1',
    // Verified in OpenRouter /models by the lead (haiku only, shared budget): anthropic/claude-haiku-5.5.
    model: get('HANGUP_MODEL') || 'anthropic/claude-haiku-5.5',
  },
};
