// Pure helpers for Revenue Recovery Desk cancellation/offboarding automation.

const FIELD_MAP = [
  ['companyName', /(?:^|\n)\s*(?:1\.)?\s*Company name\s*:\s*(.+)/i],
  ['primaryContactName', /(?:^|\n)\s*(?:2\.)?\s*Primary contact name\s*:\s*(.+)/i],
  ['billingEmail', /(?:^|\n)\s*(?:3\.)?\s*Billing email\s*:\s*(.+)/i],
  ['desiredCancellationDate', /(?:^|\n)\s*(?:4\.)?\s*Desired cancellation date\s*:\s*(.+)/i],
  ['reason', /(?:^|\n)\s*(?:5\.)?\s*Reason for leaving\s*:\s*(.+)/i],
  ['didNotWork', /(?:^|\n)\s*(?:6\.)?\s*Anything that did not work as expected\?\s*(.+)/i],
  ['handoverNotes', /(?:^|\n)\s*(?:7\.)?\s*Any outstanding customer\/recovery activity we should pause or hand over\?\s*(.+)/i],
  ['authorization', /(?:^|\n)\s*(?:8\.)?\s*Confirm authorization to offboard\s*:\s*(.+)/i],
];

function cleanValue(value) {
  return String(value || '')
    .split(/\n\s*\d+\.\s+/)[0]
    .trim()
    .replace(/^[-–—]\s*/, '')
    .trim();
}

export function parseOffboardingForm(text) {
  const out = {};
  const src = String(text || '');
  for (const [key, regex] of FIELD_MAP) {
    const m = src.match(regex);
    if (m) out[key] = cleanValue(m[1]);
  }
  return out;
}

export function isAuthorizedOffboardingForm(form) {
  if (!form || !form.companyName || !form.billingEmail || !form.desiredCancellationDate) return false;
  return /^(yes|y|confirmed|confirm|i confirm|authorized|authorised)\b/i.test(String(form.authorization || '').trim());
}

export function parseDateToUnix(dateish) {
  if (typeof dateish === 'number') return dateish;
  const s = String(dateish || '').trim();
  if (!s) return null;
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59Z` : s);
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

export function calculateProrationCents({ amountCents, periodStart, periodEnd, cancelAt }) {
  const amount = Number(amountCents || 0);
  const start = Number(periodStart);
  const end = Number(periodEnd);
  const cancel = Number(cancelAt);
  if (!amount || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(cancel)) return 0;
  if (cancel <= start) return 0;
  if (cancel >= end) return amount;
  return Math.round(amount * ((cancel - start) / (end - start)));
}

export function formatMoney(cents, currency = 'usd') {
  return new Intl.NumberFormat(currency.toLowerCase() === 'gbp' ? 'en-GB' : 'en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(Number(cents || 0) / 100);
}

export function normalizeCompany(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function buildFinalAmountEmail({ company, amountCents, currency, cancellationDate, paymentUrl }) {
  const amount = formatMoney(amountCents, currency);
  if (amountCents <= 0) {
    return `Thanks — we have received the offboarding authorization for ${company}.\n\nThere is no final prorated amount due up to ${cancellationDate}. We will now proceed with offboarding and send confirmation once the system has been taken down.`;
  }
  return `Thanks — we have received the offboarding authorization for ${company}.\n\nFinal prorated amount due up to ${cancellationDate}: ${amount}\n\nPlease pay the final invoice here:\n${paymentUrl}\n\nOnce payment is confirmed, we will automatically offboard the Revenue Recovery Desk system, remove active integrations/desktops, and send confirmation.\n\nPlease do not send card details by email.`;
}

export function buildOffboardConfirmationEmail({ company }) {
  return `Confirmed — ${company} has been offboarded from Revenue Recovery Desk.\n\nThe active recovery system has been taken down, live agent access has been removed, and the client record has been moved into the retention archive.\n\nThank you.`;
}
