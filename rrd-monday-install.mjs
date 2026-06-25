#!/usr/bin/env node
/** Local-only monday.com credential installer.
 * Serves a localhost form and writes credentials to /Users/AIAgenterminal/.openclaw/.env
 * without printing secrets. Intended for operator use on this Mac only.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HOST = '127.0.0.1';
const PORT = Number(process.env.RRD_MONDAY_INSTALL_PORT || 8797);
const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const ENV_PATH = path.join(OPERATOR_HOME, '.openclaw', '.env');
const TOKEN = crypto.randomBytes(24).toString('base64url');

function esc(s) {
  return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
function html(message = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>RRD monday.com Installer</title>
  <style>
    body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:780px;margin:48px auto;padding:0 20px;color:#111827;background:#f8fafc}
    main{background:white;border:1px solid #e2e8f0;border-radius:18px;padding:28px;box-shadow:0 12px 30px rgba(15,23,42,.08)}
    label{display:block;margin-top:16px;font-weight:800}
    input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:14px ui-monospace,SFMono-Regular,Menlo,monospace;background:#fff}
    .hint{color:#475569;line-height:1.45}.ok{background:#ecfdf5;border:1px solid #10b981;padding:12px;border-radius:10px}.warn{background:#fff7ed;border:1px solid #fb923c;padding:12px;border-radius:10px}.muted{font-size:13px;color:#64748b}
    code{background:#f1f5f9;padding:2px 5px;border-radius:5px}button{margin-top:20px;background:#111827;color:white;border:0;padding:13px 18px;border-radius:10px;font-weight:800;cursor:pointer}
  </style>
  </head><body><main><h1>Install monday.com credentials for Revenue Recovery Desk</h1>${message}
  <p class="warn"><b>Local-only:</b> this page is served from this Mac at <code>127.0.0.1</code> and writes directly to <code>/Users/AIAgenterminal/.openclaw/.env</code>. Do not paste monday tokens or client secrets into Telegram.</p>
  <p class="hint">Paste a monday.com API token if you want the official monday Apps MCP to create/manage the app. If you already created the monday app, you can also paste its OAuth Client ID and Client Secret now.</p>
  <form method="post" action="/save?token=${TOKEN}">
    <label>monday.com API token <span class="muted">(for MCP app management)</span></label>
    <input name="api_token" type="password" autocomplete="off" spellcheck="false" autofocus placeholder="optional, but needed for MCP">
    <label>monday.com OAuth Client ID <span class="muted">(from Developer Center app)</span></label>
    <input name="client_id" autocomplete="off" spellcheck="false" placeholder="optional">
    <label>monday.com OAuth Client Secret <span class="muted">(from Developer Center app)</span></label>
    <input name="client_secret" type="password" autocomplete="off" spellcheck="false" placeholder="optional">
    <button type="submit">Install monday.com credentials locally</button>
  </form></main></body></html>`;
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', chunk => { b += chunk; if (b.length > 100000) reject(new Error('Body too large')); });
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
    if (!v) continue;
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
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html());
    }
    if (req.method === 'POST' && url.pathname === '/save') {
      if (url.searchParams.get('token') !== TOKEN) { res.writeHead(403); return res.end('Forbidden'); }
      const params = await parseBody(req);
      const apiToken = String(params.get('api_token') || '').trim();
      const clientId = String(params.get('client_id') || '').trim();
      const clientSecret = String(params.get('client_secret') || '').trim();
      if (!apiToken && !(clientId && clientSecret)) throw new Error('Paste a monday API token, or both OAuth Client ID and Client Secret.');
      const vars = {};
      if (apiToken) {
        vars.MONDAY_API_TOKEN = apiToken;
        vars.monday_token = apiToken;
      }
      if (clientId && clientSecret) {
        vars.MONDAY_OAUTH_CLIENT_ID = clientId;
        vars.MONDAY_OAUTH_CLIENT_SECRET = clientSecret;
        vars.MONDAY_CLIENT_ID = clientId;
        vars.MONDAY_CLIENT_SECRET = clientSecret;
      }
      const backup = upsertEnv(vars);
      console.log(JSON.stringify({ ok: true, installed: Object.keys(vars), env: ENV_PATH, backupCreated: fs.existsSync(backup) }));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html(`<p class="ok"><b>Installed.</b> monday.com credential key names were written locally. You can close this tab and reply “done”.</p>`));
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
  fs.writeFileSync('/tmp/rrd-monday-install-url.txt', url + '\n', { mode: 0o600 });
  console.log(`OPEN ${url}`);
});
