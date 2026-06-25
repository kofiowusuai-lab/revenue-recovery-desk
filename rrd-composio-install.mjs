#!/usr/bin/env node
/** Local-only Composio credential installer.
 * Serves a localhost form and writes credentials to /Users/AIAgenterminal/.openclaw/.env
 * without printing secrets. Intended for operator use on this Mac only.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HOST = '127.0.0.1';
const PORT = Number(process.env.RRD_COMPOSIO_INSTALL_PORT || 8803);
const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const ENV_PATH = path.join(OPERATOR_HOME, '.openclaw', '.env');
const TOKEN = crypto.randomBytes(24).toString('base64url');

function esc(s) {
  return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function html(message = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>RRD Composio Installer</title>
  <style>
    body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#111827;background:#f8fafc}
    main{background:white;border:1px solid #e2e8f0;border-radius:18px;padding:28px;box-shadow:0 12px 30px rgba(15,23,42,.08)}
    label{display:block;margin-top:16px;font-weight:850}
    input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:14px ui-monospace,SFMono-Regular,Menlo,monospace;background:#fff}
    .hint{color:#475569;line-height:1.5}.ok{background:#ecfdf5;border:1px solid #10b981;padding:12px;border-radius:10px}.warn{background:#fff7ed;border:1px solid #fb923c;padding:12px;border-radius:10px}
    code{background:#f1f5f9;padding:2px 5px;border-radius:5px}button{margin-top:22px;background:#111827;color:white;border:0;padding:13px 18px;border-radius:10px;font-weight:850;cursor:pointer}
  </style>
  </head><body><main><h1>Install Composio API key</h1>${message}
  <p class="warn"><b>Local-only:</b> this page is served from this Mac at <code>127.0.0.1</code> and writes directly to <code>${esc(ENV_PATH)}</code>. Do not paste this key into Telegram or chat.</p>
  <p class="hint">Paste your Composio API key below. This will be used by the Revenue Recovery Desk control plane to evaluate Composio-backed connectors such as Pipedrive.</p>
  <form method="post" action="/save?token=${TOKEN}">
    <label>Composio API Key</label>
    <input name="composio_api_key" type="password" autocomplete="off" spellcheck="false" autofocus placeholder="paste API key here">
    <button type="submit">Install Composio API key</button>
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
      const apiKey = String(params.get('composio_api_key') || '').trim();
      if (!apiKey) throw new Error('Missing Composio API key');
      const backup = upsertEnv({ COMPOSIO_API_KEY: apiKey });
      console.log(JSON.stringify({ ok: true, installed: ['COMPOSIO_API_KEY'], env: ENV_PATH, backupCreated: fs.existsSync(backup) }));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html(`<p class="ok"><b>Installed.</b> Composio API key was written locally. You can close this tab and reply &ldquo;done&rdquo;.</p>`));
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
  fs.writeFileSync('/tmp/rrd-composio-install-url.txt', url + '\n', { mode: 0o600 });
  console.log(`OPEN ${url}`);
});
