/**
 * rrd-readiness-rules.mjs — pure, dependency-free predicates describing what a
 * client still owes before go-live. Single source of truth shared by:
 *   - rrd-onboarding-email-watch.mjs (which emails the client the missing items)
 *   - rrd-readiness-checklist.mjs    (which renders the go-live readiness card)
 *
 * These functions operate only on a `client` record (see rowToRecord in
 * rrd-hermes.mjs). No I/O, no side effects.
 */

// Post-onboarding "special form" rows are follow-up submissions (SOP review,
// readiness details, mapping details, offboarding) keyed by their catalyst.
export function isSpecialFormRecord(client) {
  return /^(SOP_REVIEW_WEB|READINESS_DETAILS_WEB|MAPPING_DETAILS_WEB|OFFBOARDING_REQUEST_WEB)$/i.test(String(client.catalyst || ''));
}

// The client has no SOP on file but asked us to build the default one.
export function needsSopReview(client) {
  const rp = client.recoveryProcess || {};
  const hasSop = client.hasSop || /^yes$/i.test(String(rp.hasSop || ''));
  return !hasSop && !!(client.wantsSopBuilt || rp.wantSopBuilt);
}

// Human-readable list of go-live readiness details still missing from onboarding.
export function missingReadinessItems(client) {
  const out = client.outreach || {}, g = client.guardrails || {}, ar = client.approvalRouting || g.approvalRouting || {}, rp = client.recoveryProcess || {}, ps = client.paymentStack || {}, cd = client.crmData || {};
  const missing = [];
  if (!ar.approvers) missing.push('approvers');
  if (!ar.preferredChannel) missing.push('approval channel');
  if (!out.timezone) missing.push('timezone');
  if (!out.businessHours) missing.push('business hours');
  if (!out.fromName) missing.push('email From name');
  if (!out.sendingDomain && !out.emailProvider) missing.push('sending email/domain');
  const channels = (out.channels?.length ? out.channels : rp.channels || []);
  if (channels.some((c) => /sms/i.test(String(c))) && (!out.smsProvider || !out.smsNumber)) missing.push('SMS setup');
  if (channels.some((c) => /letter|mail|post/i.test(String(c)))) {
    const ra = out.letters?.returnAddress || out.returnAddress || {};
    if (!ra.line1 && !ra.name) missing.push('letter return address');
  }
  if (!g.doNotContact) missing.push('do-not-contact rules');
  if (!g.maxDiscount && !rp.settlementRules) missing.push('settlement/payment-plan rules');
  if (!rp.escalation && !g.escalationTriggers) missing.push('escalation triggers');
  if (/spreadsheet/i.test(String(ps.accounting || ''))) missing.push('spreadsheet mapping');
  if (/own|custom|internal|proprietary|bespoke/i.test(String(client.crm || cd.crm || ''))) missing.push('custom CRM mapping');
  return missing;
}

// Does this client's stack need a column/field mapping pass before recovery?
export function needsMapping(client, oauthNeeded = []) {
  const ps = client.paymentStack || {}, cd = client.crmData || {};
  const haystack = [client.crm, cd.crm, ps.accounting, ...(ps.platforms || []), ...(client.paymentPlatforms || []), ...(oauthNeeded || [])].filter(Boolean).join(' ').toLowerCase();
  return /spreadsheet|custom|internal|proprietary|bespoke|api|salesforce|hubspot|zoho|pipedrive|monday|gohighlevel|highlevel|xero|quickbooks|intuit|sage|freshbooks|netsuite|stripe|square|paypal|adyen|braintree|shopify/.test(haystack);
}
