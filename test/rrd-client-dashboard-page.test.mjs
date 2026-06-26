import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = () => fs.readFileSync(new URL('../revenue-recovery-web/client.html', import.meta.url), 'utf8');
const schema = () => fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

test('client dashboard page exists with all agreed nav pages and FlowAudit theme', () => {
  const h = html();
  assert.match(h, /FlowAudit Client Dashboard/);
  for (const page of ['Overview','Approvals','Activity','Recoveries','Postal Portal','Notifications','Readiness','Settings']) assert.match(h, new RegExp(page));
  assert.match(h, /theme\.css/);
  assert.match(h, /#F7F5F3/);
  assert.match(h, /#37322F/);
  assert.match(h, /grid-template-columns:260px minmax\(0,1fr\)/);
  assert.match(h, /box-sizing:border-box/);
  assert.match(h, /overflow-x:hidden/);
  assert.match(h, /repeat\(auto-fit,minmax\(180px,1fr\)\)/);
});

test('client dashboard has login, forced reset, realtime, approvals, settings, vault, and template upload plumbing', () => {
  const h = html();
  assert.match(h, /signInWithPassword/);
  assert.match(h, /app_metadata\.must_reset/);
  assert.match(h, /\/api\/client-auth/);
  assert.match(h, /postgres_changes/);
  assert.match(h, /recovery_events/);
  assert.match(h, /notifications/);
  assert.match(h, /client_accounts/);
  assert.match(h, /loadClientAccount/);
  assert.match(h, /missing its client account mapping/);
  assert.match(h, /Sign in with a different account/);
  assert.match(h, /forceLoginRequested/);
  assert.match(h, /login'\)==='1'/);
  assert.match(h, /Email\/SMS drafts needing human approval/);
  assert.match(h, /Letters always need a signer and can never be auto-sent/);
  assert.match(h, /\/api\/client-settings/);
  // Self-serve Google Workspace connect: the dashboard now calls client-vault-link.
  assert.match(h, /\/api\/client-vault-link/);
  assert.match(h, /const API_BASE=\(location\.hostname==='flowaudit\.co\.uk'\|\|location\.hostname==='www\.flowaudit\.co\.uk'\)\?'https:\/\/revenue-recovery-web-ivory\.vercel\.app':''/);
  assert.match(h, /Unexpected server response/);
  assert.match(h, /Outreach: Draft/);
  assert.match(h, /Outreach: Auto/);
  assert.match(h, /visiblePageNames/);
  assert.match(h, /navButtonHtml/);
  assert.match(h, /nav-pending-count/);
  assert.match(h, /nav-alert-dot/);
  assert.doesNotMatch(h, /'Notifications','Readiness'/);
  assert.match(h, /bellAlert/);
  assert.match(h, /bell-alert-dot/);
  assert.match(h, /has-unread/);
  assert.match(h, /topbar-readiness-complete/);
  assert.match(h, /pageNames\.filter\(p=>p!=='Readiness'\)/);
  assert.doesNotMatch(h, /Readiness: Complete/);
  assert.doesNotMatch(h, /Bad response/);
  assert.match(h, /settings-layout/);
  assert.match(h, /business-card/);
  assert.doesNotMatch(h, /<h2>Edit business details<\/h2>/);
  assert.match(h, /data-business-edit/);
  assert.match(h, /businessInfoForm/);
  assert.match(h, /businessInfo:\{company:f\.get/);
  assert.match(h, /Business \/ trading address/);
  assert.match(h, /secure-access-inline/);
  assert.match(h, /Secure setup/);
  assert.match(h, /support@flowaudit\.co\.uk/);
  assert.match(h, /schedule a meeting/);
  // Self-serve Google Workspace connect button + handler wired to client-vault-link.
  assert.match(h, /id="connectGoogle"/);
  assert.match(h, /Connect Google Workspace/);
  assert.match(h, /provider:'google',mode:'connect'/);
  assert.doesNotMatch(h, /Create secure vault link/);
  assert.doesNotMatch(h, /Reconnect GoHighLevel/);
  assert.doesNotMatch(h, /Reconnect monday\.com/);
  assert.match(h, /@media\(max-width:700px\)/);
  assert.match(h, /info-label/);
  assert.match(h, /info-value/);
  assert.match(h, /contact-line/);
  assert.match(h, /Draft: approvals required/);
  assert.match(h, /Auto: email\/SMS send automatically/);
  assert.doesNotMatch(h, /Draft — approvals required/);
  assert.doesNotMatch(h, /Auto — email\/SMS send automatically/);
  assert.doesNotMatch(h, /Yes — approval gated/);
  assert.doesNotMatch(h, /Draft mode — human approval required/);
  assert.match(h, /integration-actions/);
  assert.match(h, /account-tools/);
  assert.match(h, /letter-templates/);
  assert.match(h, /Preview \/ edit letter/);
  assert.match(h, /\/api\/automation-dashboard/);
  assert.match(h, /automationApprovals/);
  assert.match(h, /data-approval-id/);
  assert.match(h, /\/api\/client-approval-action/);
  assert.match(h, /Approve edited draft/);
  assert.match(h, /Reject \/ request changes/);
  assert.match(h, /draftText/);
});

test('client dashboard settings exposes business information and faux demo data', () => {
  const h = html();
  for (const needle of [
    'Business information',
    'Customer profile',
    'Recovery policy',
    'Faux demo data',
    'fauxEvents',
    'displaySubmission',
    'displayEvents',
    'Commercial facilities services',
    'Westridge Academy Trust',
    'Meridian Facilities Ltd',
    'GoHighLevel',
  ]) assert.match(h, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('client dashboard makes Postal Portal the direct dashboard page', () => {
  const h = html();
  for (const needle of [
    'Agent harness',
    'Live event feed connected',
    'Payment plan agreed',
    'Settlement agreed',
    'Payment plans',
    'Settlements',
    'Letter sign-offs',
    'Postal Portal',
    'Pending letters',
    'Signature',
    'Signer name',
    'Signer title or team',
    'Signature upload',
    'Preview letter',
    'data-portal-preview-key',
    '/api/client-letter-action',
    'processedLetterKeys',
    'data-portal-select-key',
    'select-letter-btn',
    'selected-letter-badge',
    'Approve signature and queue letter',
    'openPortalPreview',
    'portalSignatureUpload',
    'renderPortalLetterPreview',
  ]) assert.match(h, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(h, /'Postal Portal':letters\(\)/);
  assert.doesNotMatch(h, /Embedded Postal Portal/);
  assert.doesNotMatch(h, /The Postal Portal is embedded here/);
  assert.doesNotMatch(h, /Open in new tab/);
  assert.doesNotMatch(h, /iframe title="Revenue Recovery Postal Portal"/);
  assert.doesNotMatch(h, /Locked template preview/);
});

test('Postal Portal preview preserves signer details and signature instead of wiping them on every click', () => {
  const h = html();
  // 1. The old destructive pattern (null the signature + full re-render on every preview click) is gone.
  assert.doesNotMatch(
    h,
    /data-portal-preview-key[\s\S]{0,300}state\.portalSignature=null;render\(\);setTimeout\(openPortalPreview,0\)/
  );
  // 2. A per-letter signer draft store exists so typed signer details survive re-renders.
  assert.match(h, /rememberPortalSigner|portalDrafts|portalDraft/);
  assert.match(h, /portalDrafts:\{\}/);
  // 3. The preview falls back to the saved draft / saved signature rather than transient-only state.
  assert.match(h, /renderPortalLetterPreview[\s\S]*state\.portalSignature|draft\.signatureData/);
  // 4. The signature upload stores the signature data persistently (draft), not only a transient flag.
  assert.match(h, /portalSignatureUpload[\s\S]*FileReader/);
  assert.match(h, /signatureData|portalDrafts/);
  // 5. Selecting/previewing a letter only resets the signature when the letter actually changes.
  assert.match(h, /changed|state\.portalLetterKey !==/);
  // Signer inputs persist on keystroke instead of only being read live at preview time.
  assert.match(h, /id="portalSignerName"[\s\S]*oninput="rememberPortalSigner\(\)"/);
  assert.match(h, /id="portalSignerTitle"[\s\S]*oninput="rememberPortalSigner\(\)"/);
});

test('schema includes client-dashboard tables, RLS helper, storage bucket, and realtime tables', () => {
  const s = schema();
  for (const needle of ['public.client_accounts', 'public.recovery_events', 'public.notifications', 'public.provision_jobs', 'public.client_submission_id()', 'letter-templates', 'submissions_client_read']) assert.match(s, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(s, /alter publication supabase_realtime add table public\.recovery_events/);
  assert.match(s, /grant update \(read_at\) on public\.notifications/);
});
