# Letter/PostGrid billing and opt-out workflow

Session-derived operating notes for RRD physical-letter support, onboarding, secure vault/access email, terms, and contract pack.

## Durable product rule

If a client selects **Letter** as a permitted recovery channel, treat physical letters as a paid pass-through channel unless they either:

1. provide their own PostGrid API key through the secure vault, or
2. explicitly opt out of FlowAudit/Revenue Recovery Desk sending physical letters.

Do **not** silently absorb postage/print/processing/certified-mail costs into the retainer. If the client keeps letters enabled, does not provide a PostGrid key, does not opt out, and later approves/authorizes letter sends, state that letter costs are billed at month-end in addition to the maintenance/retainer fee. Current disclosed per-piece estimate: **$1.219 per letter + 20p per page**, plus any certified-mail or provider pass-through extras.

## Runtime key selection and billing tracking

The executor chooses the PostGrid key at send time:

1. If the per-client profile `.env` has `POSTGRID_API_KEY`, use the client's own PostGrid account. Ledger source: `client`; `billableToClient:false` because PostGrid bills the client directly.
2. If the profile has `POSTGRID_LETTERS_OPT_OUT=true`, fail closed and do not send a letter.
3. Otherwise use the operator/shared fallback from the real operator env, preferring `RRD_SHARED_POSTGRID_API_KEY`, then `FLOWAUDIT_POSTGRID_API_KEY`, then operator-home `POSTGRID_API_KEY`. Ledger source: `shared`; `billableToClient:true` so pass-through billing can be reconciled.

Every successful letter send through `rrd-recover send` writes a non-secret NDJSON row under:

```bash
/Users/AIAgenterminal/.openclaw/rrd-postgrid-usage/<profile>.ndjson
```

Rows include timestamp, profile, company, letter id/status, invoice/rung when present, certified/mailing class, declared `costUsd`, recipient company/country, and the PostGrid key source/env-name only — never the API key value. Use these ledgers for month-end pass-through reconciliation so shared PostGrid costs are attributed to the correct company.

## Required surfaces to keep aligned

When changing the letter/PostGrid policy, update and test all of these together:

- `revenue-recovery-web/onboarding.html` — the Letter channel copy should warn that a PostGrid key or opt-out choice will be requested later.
- `revenue-recovery-web/vault.html` — the `POSTGRID_API_KEY` request should explain client-owned PostGrid, physical-letter opt-out, month-end pass-through costs if letters are later approved without a client key, and offer optional upload of existing letter templates/letterhead/logos so RRD can mimic logo placement, font/text style, spacing, and layout for approved recovery letters.
- Vault form validation — prevent contradictory submissions where a client both provides `POSTGRID_API_KEY` and opts out of physical letters.
- `rrd-welcome-pack.mjs` access-email copy — secure integration-access email should include a dedicated Physical letters / PostGrid billing choice section whenever `POSTGRID_API_KEY` is requested, including the optional letter template/letterhead/logo upload request.
- `revenue-recovery-web/terms.html` — Fees/Payments terms should include the pass-through physical-letter cost clause.
- Contract pack markdown under `revenue-recovery-contracts/` — especially MSA and Order Form, then regenerate PDFs/zips.

## Letter style/template uploads

When `POSTGRID_API_KEY` is requested on the secure access/vault link, the letter section also offers optional uploads for:

- previous recovery letters,
- letterhead/template PDFs or DOCX files,
- logos and brand assets.

The goal is to replicate the client's existing letter style first time: logo placement, font/text style, spacing, and layout. Uploaded file metadata is sealed into `RRD_LETTER_STYLE_ASSETS_JSON` so approving the drop writes a manifest into the client profile `.env`; the files themselves are stored in Supabase Storage under `onboarding-docs/letter-style/<drop-id>/...`. This manifest contains storage paths and file metadata only, not API keys.

`rrd-letter-style.mjs` is the deterministic mimic engine. During approved PostGrid letter sends, `rrd-recover.mjs` wraps HTML letters through `styleLetterHtmlForProfile(profile, html)` before calling PostGrid. The engine reads `RRD_LETTER_STYLE_ASSETS_JSON`, embeds uploaded logo/brand images as data URIs, can use uploaded letterhead/template images as a page background, applies conservative business-letter margins/type defaults, and keeps PDF/DOCX/sample letters as references in the style analysis. `rrd-letter-design-extract.py` adds local OCR/design reconstruction using PyMuPDF/python-docx: it extracts first-page PDF text blocks, font/size, margins, image/logo positions/data, and DOCX normal style hints. The vault page shows a sample preview and requires `RRD_LETTER_STYLE_PREVIEW_APPROVED=true` before depositing style assets. It is intentionally fail-closed: if referenced assets cannot be fetched or reconstructed, the send blocks instead of silently sending an unstyled letter. Preview approval remains the final accuracy gate; never promise mathematical perfection without the client approving the preview.

If the client ticks `POSTGRID_LETTERS_OPT_OUT`, the page blocks letter-style uploads in the same submission because uploading style assets implies letters may be used. If they want letters later, send a fresh secure access link.

For live end-to-end verification of this upload path, use `references/live-vault-letter-upload-smoke.md`. Static HTML checks are not enough; prove the live vault page, `vault_get`, Supabase Storage upload, encrypted `vault_deposit`, and local manifest decrypt path all work with a throwaway drop.

## Verification checklist

Run syntax/tests before reporting completion:

```bash
node --check rrd-welcome-pack.mjs
node --test test/rrd-onboarding-form.test.mjs test/rrd-vault-page.test.mjs test/rrd-hermes-integrations.test.mjs
```

If contract text changed, regenerate and verify the contract PDFs/zips before attaching or sharing them. Report Vercel deployment separately from local implementation; if deployment is blocked by auth/token state, say the code is implemented/tested locally but not live.

## Copy constraints

- Use **retainer** / **maintenance fee**, not customer-facing “subscription”.
- Do not imply letters are sent without approval. Letters remain approval-gated by the RRD executor.
- Do not ask clients to email API keys; use the secure vault link.
- Do not print or inspect real PostGrid keys.