// Service worker: does the API call so the page's CSP/CORS cannot interfere.
const DEFAULT_BASE = 'https://payyourpal-hangup.onrender.com'; // localhost:3000 also works via Options

async function getBase() {
  try {
    const { apiBase } = await chrome.storage.sync.get('apiBase');
    return (apiBase || DEFAULT_BASE).replace(/\/+$/, '');
  } catch (e) { return DEFAULT_BASE; }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'hangup-check') return;
  (async () => {
    const base = await getBase();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 60000);
      const res = await fetch(base + '/api/check', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(msg.payload), signal: ctl.signal
      });
      clearTimeout(timer);
      let data = null;
      try { data = await res.json(); } catch (e) { /* non-JSON */ }
      sendResponse({ ok: res.ok, status: res.status, data, base });
    } catch (e) {
      sendResponse({ ok: false, status: 0, data: { error: 'NETWORK', message: 'Could not reach the HangUp server at ' + base }, base });
    }
  })();
  return true; // async response
});
