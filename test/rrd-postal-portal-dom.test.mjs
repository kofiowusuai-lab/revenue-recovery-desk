// Behavioral (real-DOM) regression test for the dashboard Postal Portal.
// Drives client.html through the actual user flow in jsdom: type signer details,
// upload a signature, click "Preview letter", and assert the preview renders them
// and that re-rendering does NOT wipe the signer/signature.
//
// Static string-match tests missed the original bug because they never executed the
// page. This one does. It skips gracefully if jsdom is not installed (the default
// suite is dependency-free): `npm install --no-save jsdom` to enable it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); } catch { /* optional dep */ }

const SUPABASE_STUB = `<script>window.supabase={createClient:function(){return {auth:{getSession:async()=>({data:{session:null}}),signInWithPassword:async()=>({error:null}),signOut:async()=>({}),refreshSession:async()=>({}),updateUser:async()=>({error:null})},channel:function(){return {on:function(){return this},subscribe:function(){return this}}},from:function(){return {select:function(){return this},eq:function(){return this},order:function(){return this},limit:function(){return this},maybeSingle:async()=>({data:null,error:null}),single:async()=>({data:null,error:null})}},storage:{from:function(){return {upload:async()=>({error:null})}}}};}};</script>`;

function bootPortal() {
  const raw = fs.readFileSync(new URL('../revenue-recovery-web/client.html', import.meta.url), 'utf8');
  const html = raw.replace(
    /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/,
    SUPABASE_STUB
  );
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://flowaudit.co.uk/client?demo=1',
    pretendToBeVisual: true,
  });
  return dom;
}

const tick = () => new Promise(r => setTimeout(r, 0));

test('dashboard Postal Portal preserves signer + signature through preview and re-render', { skip: JSDOM ? false : 'jsdom not installed' }, async () => {
  const dom = bootPortal();
  const { window } = dom;
  const { document } = window;
  const ev = (code) => window.eval(code);
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

  await tick(); await tick(); // let boot() settle to the login screen

  // Force into the app on the Postal Portal page with faux demo data.
  window.show('app');
  ev("state.page='Postal Portal'");
  window.render();

  const nameInput = document.getElementById('portalSignerName');
  const titleInput = document.getElementById('portalSignerTitle');
  const upload = document.getElementById('portalSignatureUpload');
  assert.ok(nameInput && titleInput && upload, 'signer inputs + upload should render');

  // 1. Type signer name + title (fires oninput -> rememberPortalSigner).
  nameInput.value = 'Kofi Owusu';        fire(nameInput, 'input');
  titleInput.value = 'Finance Director'; fire(titleInput, 'input');
  assert.match(ev('JSON.stringify(state.portalDrafts)'), /Kofi Owusu/, 'typed signer name persists into the draft store');

  // 2. Upload a signature image (fires change -> FileReader).
  const file = new window.File([Buffer.from('89504e470d0a1a0a', 'hex')], 'sig.png', { type: 'image/png' });
  Object.defineProperty(upload, 'files', { value: [file], configurable: true });
  fire(upload, 'change');
  for (let i = 0; i < 50 && ev('!state.portalSignature'); i++) await tick();
  assert.equal(ev('!!state.portalSignature'), true, 'uploaded signature is stored');
  assert.equal(ev('Object.values(state.portalDrafts).some(d=>d.signatureData)'), true, 'signature persists into the per-letter draft');

  // 3. Click "Preview letter" — the exact action that used to wipe everything.
  const previewBtn = document.querySelector('[data-portal-preview-key]');
  assert.ok(previewBtn, 'a preview button should exist');
  click(previewBtn);
  await tick(); await tick();

  const modal = document.getElementById('approvalEditor');
  assert.ok(modal, 'preview modal opens');
  const txt = modal.textContent;
  assert.match(txt, /Kofi Owusu/, 'preview shows the typed signer name');
  assert.match(txt, /Finance Director/, 'preview shows the typed signer title');
  assert.ok(modal.querySelector('img.signature-img'), 'preview shows the uploaded signature image');

  // 4. Closing + re-rendering must NOT wipe the signer details or signature.
  window.closeEditor();
  window.render();
  assert.equal(document.getElementById('portalSignerName').value, 'Kofi Owusu', 'signer name survives re-render');
  assert.equal(document.getElementById('portalSignerTitle').value, 'Finance Director', 'signer title survives re-render');
  assert.equal(ev('!!state.portalSignature'), true, 'signature survives re-render');
});
