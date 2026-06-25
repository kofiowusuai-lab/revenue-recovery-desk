import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOffboardingForm,
  calculateProrationCents,
  isAuthorizedOffboardingForm,
  formatMoney,
} from '../rrd-cancellation-core.mjs';

test('parseOffboardingForm extracts completed numbered offboarding fields', () => {
  const text = `OFFBOARDING REQUEST
1. Company name: Acron LTD
2. Primary contact name: Jane Smith
3. Billing email: billing@acron.example
4. Desired cancellation date: 2026-07-10
5. Reason for leaving: Moving in house
6. Anything that did not work as expected? Reporting cadence
7. Any outstanding customer/recovery activity we should pause or hand over? Pause all open outreach
8. Confirm authorization to offboard: Yes`;

  assert.deepEqual(parseOffboardingForm(text), {
    companyName: 'Acron LTD',
    primaryContactName: 'Jane Smith',
    billingEmail: 'billing@acron.example',
    desiredCancellationDate: '2026-07-10',
    reason: 'Moving in house',
    didNotWork: 'Reporting cadence',
    handoverNotes: 'Pause all open outreach',
    authorization: 'Yes',
  });
});

test('isAuthorizedOffboardingForm requires company, date, billing email, and yes authorization', () => {
  assert.equal(isAuthorizedOffboardingForm({ companyName: 'Acron LTD', billingEmail: 'a@b.com', desiredCancellationDate: '2026-07-10', authorization: 'Yes' }), true);
  assert.equal(isAuthorizedOffboardingForm({ companyName: 'Acron LTD', billingEmail: 'a@b.com', desiredCancellationDate: '2026-07-10', authorization: 'No' }), false);
  assert.equal(isAuthorizedOffboardingForm({ companyName: 'Acron LTD', desiredCancellationDate: '2026-07-10', authorization: 'Yes' }), false);
});

test('calculateProrationCents prorates by elapsed service period through cancellation date', () => {
  const start = Date.parse('2026-07-01T00:00:00Z') / 1000;
  const end = Date.parse('2026-07-29T00:00:00Z') / 1000;
  const cancel = Date.parse('2026-07-15T00:00:00Z') / 1000;

  assert.equal(calculateProrationCents({ amountCents: 300000, periodStart: start, periodEnd: end, cancelAt: cancel }), 150000);
});

test('calculateProrationCents clamps before/after service period', () => {
  const start = Date.parse('2026-07-01T00:00:00Z') / 1000;
  const end = Date.parse('2026-07-29T00:00:00Z') / 1000;

  assert.equal(calculateProrationCents({ amountCents: 300000, periodStart: start, periodEnd: end, cancelAt: Date.parse('2026-06-01T00:00:00Z') / 1000 }), 0);
  assert.equal(calculateProrationCents({ amountCents: 300000, periodStart: start, periodEnd: end, cancelAt: Date.parse('2026-08-01T00:00:00Z') / 1000 }), 300000);
});

test('formatMoney formats cents as currency', () => {
  assert.equal(formatMoney(150000, 'usd'), '$1,500.00');
  assert.equal(formatMoney(123456, 'gbp'), '£1,234.56');
});
