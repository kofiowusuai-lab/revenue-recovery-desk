// Behavioral (real-DOM) test for the dashboard self-serve Google Workspace connect.
// Renders client.html in jsdom, drives the Settings page, clicks "Connect Google
// Workspace", and asserts it POSTs to /api/client-vault-link with provider google.
// Skips gracefully if jsdom is not installed (the default suite is dependency-free).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); } catch { /* optional dep */ }

const SUPABASE_STUB = `<script>window.supabase={createClient:function(){return {auth:{getSession:async()=>({data:{session:{access_token:'tok_test'}}}),signInWithPassword:async()=>({error:null}),signOut:async()=>({}),refreshSession:async()=>({}),updateUser:async()=>({error:null})},channel:function(){return {on:function(){return this},subscribe:function(){return this}}},from:function(){return {select:function(){return this},eq:function(){return this},order:function(){return this},limit:function(){return this},maybeSingle:async()=>({data:null,error:null}),single:async()=>({data:null,error:null})}},storage:{from:function(){return {upload:async()=>({error:null})}}}};}};</script>`;

const tick = () => new Promise(r => setTimeout(r, 0));

test('dashboard self-serve connect posts provider=google to client-vault-link', { skip: JSDOM ? false : 'jsdom not installed' }, async () => {
  const raw = fs.readFileSync(new URL('../revenue-recovery-web/client.html', import.meta.url), 'utf8');
  const html = raw.replace(
    /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/,
    SUPABASE_STUB
  );
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://flowaudit.co.uk/revenue-recovery/client?demo=1',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;
  const ev = (code) => window.eval(code);

  // Capture the API call the connect button makes (the page uses global fetch).
  let captured = null;
  window.fetch = async (url, opts = {}) => {
    captured = { url: String(url), opts };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, url: 'https://revenue-recovery-web-ivory.vercel.app/oauth-start?token=test', provider: 'google' }) };
  };

  await tick(); await tick();

  window.show('app');
  ev("state.page='Settings'");
  window.render();

  const btn = document.getElementById('connectGoogle');
  assert.ok(btn, 'Connect Google Workspace button renders on the Settings page');

  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 50 && !captured; i++) await tick();

  assert.ok(captured, 'clicking the button triggers an API call');
  assert.match(captured.url, /\/api\/client-vault-link$/, 'posts to the client-vault-link endpoint');
  assert.equal((captured.opts.method || 'GET').toUpperCase(), 'POST');
  const body = JSON.parse(captured.opts.body || '{}');
  assert.equal(body.provider, 'google', 'requests the google provider');
  assert.equal(body.mode, 'connect', 'in connect mode');
  const auth = (captured.opts.headers && (captured.opts.headers.authorization || captured.opts.headers.Authorization)) || '';
  assert.match(auth, /^Bearer\s+tok_test$/, 'sends the client session bearer token');
});
