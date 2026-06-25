#!/usr/bin/env node
/** Local-only Xero OAuth credential installer.
 * Serves a localhost form and writes credentials to ~/.openclaw/.env without
 * printing secrets. Intended for operator use on this Mac only.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HOST = '127.0.0.1';
const PORT = Number(process.env.RRD_XERO_OAUTH_INSTALL_PORT || 8789);
const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const ENV_PATH = path.join(OPERATOR_HOME, '.openclaw', '.env');
const TOKEN = crypto.randomBytes(24).toString('base64url');

function esc(s) { return String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
function html(message = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>RRD Xero OAuth Installer</title>
  <style>body{font-family:Inter,system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#111827}label{display:block;margin-top:16px;font-weight:700}input{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font:14px ui-monospace,monospace}.hint{color:#475569}.ok{background:#ecfdf5;border:1px solid #10b981;padding:12px;border-radius:8px}.warn{background:#fff7ed;border:1px solid #fb923c;padding:12px;border-radius:8px}code{background:#f1f5f9;padding:2px 5px;border-radius:5px}button{margin-top:18px;background:#111827;color:white;border:0;padding:12px 18px;border-radius:8px;font-weight:700}</style>
  </head><body><h1>Install Xero OAuth credentials</h1>${message}
  <p class="warn"><b>Local-only:</b> this page is served from this Mac at 127.0.0.1 and writes directly to <code>~/.openclaw/.env</code>. Do not paste these credentials into Telegram.</p>
  <p class="hint">Create a Xero OAuth app first, with callback URL <code>https://flowaudit.co.uk/revenue-recovery/oauth-callback</code>. Use the app's Client ID and Client Secret below.</p>
  <form method="post" action="/save?token=${TOKEN}">
    <label>Client ID</label><input name="client_id" autocomplete="off" spellcheck="false" required>
    <label>Client secret</label><input name="client_secret" type="password" autocomplete="off" spellcheck="false" required>
    <button type="submit">Install credentials</button>
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
function quote(v) { return JSON.stringify(String(v)); }
function upsertEnv(vars) {
  fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true, mode: 0o700 });
  let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const backup = `${ENV_PATH}.bak-${new Date().toISOString().replace(/[:.]/g,'-')}`;
  if (fs.existsSync(ENV_PATH)) fs.copyFileSync(ENV_PATH, backup);
  for (const [k, v] of Object.entries(vars)) {
    const line = `${k}=${quote(v)}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : (text.replace(/\s*$/, '\n') + line + '\n');
  }
  fs.writeFileSync(ENV_PATH, text, { mode: 0o600 });
  fs.chmodSync(ENV_PATH, 0o600);
  return backup;
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
      const clientId = String(params.get('client_id') || '').trim();
      const clientSecret = String(params.get('client_secret') || '').trim();
      if (!clientId || !clientSecret) throw new Error('Missing client_id or client_secret');
      const backup = upsertEnv({
        XERO_OAUTH_CLIENT_ID: clientId,
        XERO_OAUTH_CLIENT_SECRET: clientSecret,
        XERO_CLIENT_ID: clientId,
        XERO_CLIENT_SECRET: clientSecret,
      });
      console.log(JSON.stringify({ ok: true, installed: ['XERO_OAUTH_CLIENT_ID','XERO_OAUTH_CLIENT_SECRET','XERO_CLIENT_ID','XERO_CLIENT_SECRET'], env: ENV_PATH, backupCreated: fs.existsSync(backup) }));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html(`<p class="ok"><b>Installed.</b> Xero OAuth credentials were written locally. You can close this tab and reply “done”.</p>`));
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
  fs.writeFileSync('/tmp/rrd-xero-oauth-install-url.txt', url + '\n', { mode: 0o600 });
  console.log(`OPEN ${url}`);
});
