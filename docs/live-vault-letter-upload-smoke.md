# Live vault letter-template upload smoke test

Use this when verifying that the deployed secure access/vault link actually accepts letter template/logo uploads, not just that the static page contains the UI.

## What to verify

For a throwaway one-time vault drop requesting `POSTGRID_API_KEY`:

1. Load the live vault page from the canonical ivory base: `https://revenue-recovery-web-ivory.vercel.app/vault`.
2. Confirm the live HTML includes the letter upload UI/copy and the `RRD_LETTER_STYLE_ASSETS_JSON` manifest key path.
3. Create a throwaway vault drop with `POSTGRID_API_KEY` in `env_keys`.
4. Call the same live `vault_get` RPC the browser uses, using the public anon key embedded in the live page.
5. Upload a harmless smoke asset to Supabase Storage under `onboarding-docs/letter-style/<drop-id>/...`.
6. Seal and submit both:
   - a dummy `POSTGRID_API_KEY` value, and
   - `RRD_LETTER_STYLE_ASSETS_JSON` containing `{ bucket, purpose, assets:[{ name, path, type, size, role }] }`
   through the live `vault_deposit` RPC.
7. Read the deposited drop back with service-role/operator access and decrypt `RRD_LETTER_STYLE_ASSETS_JSON` locally with the drop profile private key.
8. Confirm the decrypted manifest contains the expected uploaded storage path.
9. Clean up: burn/consume the throwaway drop and remove any temporary smoke file/script.

## Operator preview links (“what would this look like?”)

When the operator asks for a preview link for a specific client/company, generate a live, one-time preview from the actual RRD tooling rather than describing the UI.

1. Query the book first with `/Users/AIAgenterminal/rrd-harness search '"<company-or-domain>"'` or a targeted `query` so the preview is tied to a real submission id.
2. If the goal is only to show the letter/PostGrid UI, create or coerce a throwaway vault drop that requests `POSTGRID_API_KEY`; otherwise clients with no API-key needs may show an empty/no-key vault page because OAuth connections are handled separately.
3. Use the canonical ivory app base for preview links: `https://revenue-recovery-web-ivory.vercel.app/vault?...`. The branded FlowAudit path is a vanity layer and may depend on a separate rewrite.
4. Open the generated link in the browser and verify the actual rendered UI before handing it over. For a letter preview, check the company/display name, PostGrid field, physical-letter opt-out, pricing copy, template/logo upload area, recovery-letter preview, and approval checkbox.
5. In the reply, give the link first and keep caveats precise: if the underlying book row/profile name differs from the display override used for preview, say that plainly. Never imply real secret deposit or delivery happened.

## Full-page PNG/JPG preview regression

Clients may upload a screenshot/scan of an entire previous letter as a PNG/JPG, not just a logo. The vault page must treat those image files as `letterhead_or_template` by default and render them as the full preview page. Only filenames that clearly contain `logo`, `brand`, or `mark` should be treated as small logo assets.

When fixing or verifying this class of issue:

1. Inspect `revenue-recovery-web/vault.html` around `guessLetterAssetRole()` and `updateLetterPreview()`.
2. Ensure full-page image uploads create/use `letter-preview-template` with `templateImg.src = template.previewUrl`, add/toggle `has-template-image`, and hide the generic `.letter-preview-copy` while the template image is present.
3. Ensure the small `letter-preview-logo` element is not left with an empty/bad `src`; remove the `src` attribute when there is no logo, or when a full-page template is being rendered.
4. Add/keep a regression test in `test/rrd-vault-page.test.mjs` for full-page image-letter preview behavior.
5. Run the vault suite before deploy: `node --test /Users/AIAgenterminal/test/rrd-vault-*.test.mjs`.
6. Deploy the ivory app from `/Users/AIAgenterminal/revenue-recovery-web` with `HOME=/Users/AIAgenterminal npx --yes vercel --prod --yes`, then verify the live deployed HTML contains the new preview markers. Use `curl -fsSL https://revenue-recovery-web-ivory.vercel.app/vault.html`; the bare `urllib.request.urlopen()` path may see Vercel's 308 redirect.
7. For a browser-level smoke, load a live vault link and programmatically dispatch a `File` with `type: "image/png"` to `#letter-style-input`; confirm `#letter-preview-page` has `has-template-image`, `#letter-preview-template` has a `blob:` `src` and `display:block`, `.letter-preview-copy` is hidden, and `#letter-preview-logo` is hidden.

## Important details

- Do not use real client files or real PostGrid keys in the smoke test.
- Use a harmless text/blob fixture for storage/deposit path tests, but use a harmless PNG/JPG `File` fixture for UI preview classification tests.
- The durable claim is only valid after the live RPC + Storage upload + encrypted deposit + local decrypt path all pass.
- Report the live base and the concrete checks, not just “deployed”.
- Preview links are still one-time/expiring vault drops; do not reuse them as production client access links unless they were generated for the exact intended submission/profile and verified immediately before sharing.

## Why this matters

The static page can deploy correctly while Supabase Storage policy/RPC behavior still blocks real client uploads. This smoke test proves the actual client path works end-to-end.