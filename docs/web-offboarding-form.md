# Web offboarding form + secure cancellation flow

Use this when modifying or operating the Revenue Recovery Desk offboarding web form and cancellation automation.

## Live pages

- Locked offboarding form: `https://revenue-recovery-web-ivory.vercel.app/offboard?sid=<submission-id>&company=<company>&email=<company-email>`
- Bare `/offboard` page intentionally disables submission; it is not a usable generic form.
- Payment completion redirect: `https://revenue-recovery-web-ivory.vercel.app/offboarded`

## Client-specific locked link requirement

Never send a generic offboarding form link. The support/cancellation watcher must generate a client-specific link from the active book:

1. Match cancellation intent email to an active client.
2. Put the active submission id in `sid`.
3. Put the active client company in `company`.
4. Put the active company/business/billing email in `email`.
5. The browser pre-fills company/email and marks both read-only.
6. The submit button stays disabled unless company/email exactly match the locked values.

The backend must also enforce this. Browser-side read-only fields are usability/security friction, not the source of truth.

## Email intent matching

A cancellation/offboarding email should receive a locked offboarding link only when it can be verified against the active client book:

- Exact sender address match against the client main email or contact emails is accepted.
- Otherwise, compare the sender domain after `@` against active client email/contact domains.
- Domain match is accepted only when exactly one active client has that domain.
- Generic/public domains (`gmail.com`, `outlook.com`, `yahoo.com`, `icloud.com`, `protonmail.com`, etc.) are never accepted by domain alone; they require exact address match.
- If no match or multiple domain matches, do not send a working form link.

Unverified sender response: ask them to resend from their company/business email address. Track attempts by sender address; on the third unverified cancellation email from the same sender, suppress further replies and label `rrd_unverified_sender_blocked` to avoid spam loops.

## Backend processing guardrails

For web offboarding rows, require all of the following before confirmation email, final payment link, or offboarding:

- `business_profile.sourceSubmissionId` exists.
- It points to an active non-offboarding client row.
- Submitted company equals the active client company.
- Submitted business/billing email equals the active client email on file.
- Locked company/email payload fields also equal the active client values.
- Explicit authorization checkbox is true.

If any check fails, stop as an error/review case. Do not email “form submitted” and do not create Stripe payment links.

## Final payment and credential destruction

After web form processing:

1. Send confirmation that the form was submitted only after active-client match succeeds.
2. Calculate prorated final amount where billing/subscription context exists.
3. If amount due is positive, email Stripe final-payment link and track it.
4. Once paid, run `rrd-harness offboard`.
5. If amount due is zero, offboard immediately.
6. Offboarding must archive the account, tear down Orgo, and destroy per-client credentials:
   - profile `.env` / `.env.bak`
   - profile vault private key
   - Supabase `vault_drops` ciphertext for that profile

Do not print secret values; report only status/key names/counts.
