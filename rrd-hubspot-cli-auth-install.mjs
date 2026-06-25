#!/usr/bin/env node
/** Local-only HubSpot CLI PAK installer.
 * Operator pastes a HubSpot Personal Access Key into localhost; this script
 * validates it with HubSpot, writes hubspot.config.yml through HubSpot's own
 * local-dev-lib config writer, and never prints the key/token values.
 */
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { getAccessToken, updateConfigWithAccessToken } from './.npm-global/lib/node_modules/@hubspot/cli/node_modules/@hubspot/local-dev-lib/lib/personalAccessKey.js';
import { ENVIRONMENTS } from './.npm-global/lib/node_modules/@hubspot/cli/node_modules/@hubspot/local-dev-lib/constants/environments.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.RRD_HUBSPOT_AUTH_INSTALL_PORT || 8788);
const ACCOUNT_ID = process.env.RRD_HUBSPOT_ACCOUNT_ID || '246558937';
const TOKEN = crypto.randomBytes(24).toString('base64url');

function esc(s) { return String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
function html(message = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>RRD HubSpot CLI Auth Installer</title>
  <style>body{font-family:Inter,system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#111827}label{display:block;margin-top:16px;font-weight:700}input{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font:14px ui-monospace,monospace}.hint{color:#475569}.ok{background:#ecfdf5;border:1px solid #10b981;padding:12px;border-radius:8px}.warn{background:#fff7ed;border:1px solid #fb923c;padding:12px;border-radius:8px}button{margin-top:18px;background:#111827;color:white;border:0;padding:12px 18px;border-radius:8px;font-weight:700}</style>
  </head><body><h1>Install HubSpot CLI access</h1>${message}
  <p class="warn"><b>Local-only:</b> this page is served from this Mac at 127.0.0.1. It configures the HubSpot CLI without sending the key through Telegram.</p>
  <p class="hint">HubSpot account ID: <code>${esc(ACCOUNT_ID)}</code></p>
  <form method="post" action="/save?token=${TOKEN}">
    <label>HubSpot Personal Access Key</label>
    <input name="pak" type="password" autocomplete="off" spellcheck="false" autofocus>
    <button type="submit">Install HubSpot CLI auth</button>
  </form></body></html>`;
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', chunk => { b += chunk; if (b.length > 200000) reject(new Error('Body too large')); });
    req.on('end', () => resolve(new URLSearchParams(b)));
    req.on('error', reject);
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/') {
      if (url.searchParams.get('token') !== TOKEN) { res.writeHead(403); return res.end('Forbidden'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html());
    }
    if (req.method === 'POST' && url.pathname === '/save') {
      if (url.searchParams.get('token') !== TOKEN) { res.writeHead(403); return res.end('Forbidden'); }
      const params = await parseBody(req);
      const pak = String(params.get('pak') || '').trim();
      if (!pak) throw new Error('Missing personal access key');
      const token = await getAccessToken(pak, ENVIRONMENTS.PROD, ACCOUNT_ID);
      const acct = await updateConfigWithAccessToken(token, pak, ENVIRONMENTS.PROD, 'rrd-hubspot', true);
      fs.chmodSync('/Users/AIAgenterminal/hubspot.config.yml', 0o600);
      console.log(JSON.stringify({ ok: true, accountId: acct.accountId, accountType: acct.accountType || null, config: '/Users/AIAgenterminal/hubspot.config.yml' }));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html(`<p class="ok"><b>Installed.</b> HubSpot CLI auth is configured for account <code>${esc(acct.accountId)}</code>. You can close this tab and reply “done”.</p>`));
      setTimeout(() => server.close(() => process.exit(0)), 800);
      return;
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html(`<p class="warn"><b>Error:</b> ${esc(e.message || e)}</p>`));
  }
});
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/?token=${TOKEN}`;
  fs.writeFileSync('/tmp/rrd-hubspot-cli-auth-install-url.txt', url + '\n', { mode: 0o600 });
  console.log(`OPEN ${url}`);
});
