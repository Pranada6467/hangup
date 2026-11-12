const DEFAULT_BASE = 'https://payyourpal-hangup.onrender.com'; // localhost:3000 also works via Options
const $ = (id) => document.getElementById(id);
chrome.storage.sync.get('apiBase').then(({ apiBase }) => { $('base').value = apiBase || DEFAULT_BASE; });
$('save').addEventListener('click', async () => {
  let v = $('base').value.trim().replace(/\/+$/, '') || DEFAULT_BASE;
  let u;
  try { u = new URL(v); } catch (e) { $('st').textContent = 'That is not a valid address.'; return; }
  if (!/^https?:$/.test(u.protocol)) { $('st').textContent = 'Use http:// or https://'; return; }
  const origin = u.origin + '/*';
  let granted = true;
  try { granted = await chrome.permissions.request({ origins: [origin] }); } catch (e) { granted = false; }
  if (!granted) { $('st').textContent = 'Permission to contact ' + u.origin + ' was not granted, so it was not saved.'; return; }
  await chrome.storage.sync.set({ apiBase: u.origin });
  $('st').textContent = 'Saved: ' + u.origin;
});

chrome.storage.sync.get('treatUnfamiliar').then(({ treatUnfamiliar }) => { $('unf').checked = treatUnfamiliar === true; });
$('saveunf').addEventListener('click', async () => { await chrome.storage.sync.set({ treatUnfamiliar: $('unf').checked }); $('st').textContent = $('unf').checked ? 'Stricter mode on.' : 'Stricter mode off.'; });
