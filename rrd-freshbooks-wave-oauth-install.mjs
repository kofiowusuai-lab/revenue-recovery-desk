#!/usr/bin/env node
/** Local-only FreshBooks + Wave OAuth credential installer.
 * Serves a localhost form and writes credentials to /Users/AIAgenterminal/.openclaw/.env
 * without printing secrets. Intended for operator use on this Mac only.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HOST = '127.0.0.1';
const PORT = Number(process.env.RRD_FRESHBOOKS_WAVE_OAUTH_INSTALL_PORT || 8798);
const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const ENV_PATH = path.join(OPERATOR_HOME, '.openclaw', '.env');
const TOKEN = crypto.randomBytes(24).toString('base64url');

function esc(s) {
  return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function html(message = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>RRD FreshBooks + Wave OAuth Installer</title>
  <style>
    body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:880px;margin:40px auto;padding:0 20px;color:#111827;background:#f8fafc}
    main{background:white;border:1px solid #e2e8f0;border-radius:18px;padding:28px;box-shadow:0 12px 30px rgba(15,23,42,.08)}
    fieldset{border:1px solid #e2e8f0;border-radius:14px;padding:18px;margin:18px 0;background:#fff}
    legend{font-weight:900;padding:0 8px} label{display:block;margin-top:14px;font-weight:800}
    input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:14px ui-monospace,SFMono-Regular,Menlo,monospace;background:#fff}
    .hint{color:#475569;line-height:1.45}.ok{background:#ecfdf5;border:1px solid #10b981;padding:12px;border-radius:10px}.warn{background:#fff7ed;border:1px solid #fb923c;padding:12px;border-radius:10px}
    code{background:#f1f5f9;padding:2px 5px;border-radius:5px}button{margin-top:20px;background:#111827;color:white;border:0;padding:13px 18px;border-radius:10px;font-weight:800;cursor:pointer}
    ul{line-height:1.55}
  </style>
  </head><body><main><h1>Install FreshBooks + Wave OAuth credentials</h1>${message}
  <p class="warn"><b>Local-only:</b> this page is served from this Mac at <code>127.0.0.1</code> and writes directly to <code>/Users/AIAgenterminal/.openclaw/.env</code>. Do not paste these credentials into Telegram or chat.</p>
  <p class="hint">Create the platform OAuth apps first, then paste their Client ID and Client Secret below. For both apps, register this redirect URL: <code>https://revenue-recovery-web-ivory.vercel.app/oauth-callback</code>. If the platform allows multiple callbacks, also add <code>https://flowaudit.co.uk/revenue-recovery/oauth-callback</code>.</p>
  <form method="post" action="/save?token=${TOKEN}">
    <fieldset>
      <legend>FreshBooks</legend>
      <p class="hint">Use FreshBooks developer/app management. Request read scopes: <code>user:profile:read</code>, <code>user:clients:read</code>, <code>user:invoices:read</code>.</p>
      <label>FreshBooks Client ID</label>
      <input name="freshbooks_client_id" autocomplete="off" spellcheck="false" autofocus>
      <label>FreshBooks Client Secret</label>
      <input name="freshbooks_client_secret" type="password" autocomplete="off" spellcheck="false" placeholder="paste secret here">
    </fieldset>
    <fieldset>
      <legend>Wave / Wave Invoicing</legend>
      <p class="hint">Use the Wave developer app portal. Request read scopes: <code>business:read</code>, <code>customer:read</code>, <code>invoice:read</code>.</p>
      <label>Wave Client ID</label>
      <input name="wave_client_id" autocomplete="off" spellcheck="false">
      <label>Wave Client Secret</label>
      <input name="wave_client_secret" type="password" autocomplete="off" spellcheck="false" placeholder="paste secret here">
    </fieldset>
    <button type="submit">Install OAuth credentials</button>
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
      const fbId = String(params.get('freshbooks_client_id') || '').trim();
      const fbSecret = String(params.get('freshbooks_client_secret') || '').trim();
      const waveId = String(params.get('wave_client_id') || '').trim();
      const waveSecret = String(params.get('wave_client_secret') || '').trim();
      if (!fbId || !fbSecret || !waveId || !waveSecret) throw new Error('Missing one or more FreshBooks/Wave client IDs or secrets');
      const backup = upsertEnv({
        FRESHBOOKS_OAUTH_CLIENT_ID: fbId,
        FRESHBOOKS_OAUTH_CLIENT_SECRET: fbSecret,
        WAVE_OAUTH_CLIENT_ID: waveId,
        WAVE_OAUTH_CLIENT_SECRET: waveSecret,
      });
      console.log(JSON.stringify({ ok: true, installed: ['FRESHBOOKS_OAUTH_CLIENT_ID','FRESHBOOKS_OAUTH_CLIENT_SECRET','WAVE_OAUTH_CLIENT_ID','WAVE_OAUTH_CLIENT_SECRET'], env: ENV_PATH, backupCreated: fs.existsSync(backup) }));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html(`<p class="ok"><b>Installed.</b> FreshBooks and Wave OAuth credentials were written locally. You can close this tab and reply &ldquo;done&rdquo;.</p>`));
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
  fs.writeFileSync('/tmp/rrd-freshbooks-wave-oauth-install-url.txt', url + '\n', { mode: 0o600 });
  console.log(`OPEN ${url}`);
});
