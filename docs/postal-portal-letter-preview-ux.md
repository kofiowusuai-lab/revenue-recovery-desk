# Postal Portal letter preview UX correction

Session lesson: when updating the Revenue Recovery / Postal Portal letter approval UI, do not embed a cropped mock letter in the signing workspace.

## Required interaction
- The signing workspace should show a single **Preview letter** action for the selected letter.
- Clicking **Preview letter** opens a modal/dialog with the full-page preview.
- The inline workspace remains for signer name/team, signature upload, approval, and reject/request changes controls.

## Required preview style
- All letter previews should use the same reconstructed/approved template style seen in the secure access/vault preview, not a generic text mock.
- Preserve full-page 8.5x11 proportions.
- Show the full document/page composition: branded/image header, logo/contact block, letter body, signature area, footer/brand elements.
- Avoid the old `FlowAudit client letterhead` placeholder and avoid cropped/squashed cards.
- **Do not freestyle the template.** If the user supplies a reference/example letterhead, extract/use its real reusable assets (e.g. edge-to-edge header image, logo/contact block, footer mark) rather than recreating them with CSS gradients, fake icons, or approximate text.
- Header artwork should be edge-to-edge when the reference is edge-to-edge; do not add side margins unless the reference has them.
- Place the signature block in the body area above the footer/tagline. It must never overlap, obscure, or crowd the footer rule/tagline.

## Layout pitfall: do not trap the letter body in the logo/contact grid

Root cause from the live Postal Portal: the preview reused a two-column `target-letter-grid` for the whole letter, with the body in the left column and the logo/contact block in the right column. That made the subject, body, and signature default to a squashed-left look even though the surrounding page kept the 8.5x11 shape.

Rules for future edits:
- Keep the logo/contact/address block as a **top-row/header layout only**.
- Put the subject, salutation, body paragraphs, and signature in a separate full-width/wide main content section below the header row.
- Do not wrap the entire body in `target-letter-grid` or any narrow left-column grid used for header contact details.
- Preserve the secure-access/vault preview proportions: 8.5/11 page aspect ratio, centered page shell, and readable body width.
- Add/keep a regression that fails if the old grid class returns or if the body text is nested inside the narrow header/contact grid.

Known-good verification:
1. Open Postal Portal demo/live preview and click **Preview letter**.
2. Confirm `target-letter-grid` is absent from the rendered preview.
3. Confirm the body container spans the wider page area rather than only the left header column.
4. Confirm the preview remains visually aligned with the secure access/vault letter preview style.

## Signer form pitfall: do not rerender fields while typing

Root cause from the live Postal Portal: signer inputs originally had `oninput="syncPreview()"`, and `syncPreview()` called `renderDetail()`. That rebuilt the entire form after every keystroke, replacing the active `<input>` node and making the user lose focus after each letter.

Rules for future edits:
- Do **not** call `renderDetail()` from signer-name or signer-title `input`/`keyup` handlers.
- Do **not** put inline `oninput="syncPreview()"` handlers on the signer fields unless the handler only updates the already-open preview without replacing the form DOM.
- Prefer reading the latest signer values when the user clicks **Preview letter** / **Approve**, or update only the modal preview if it is already open.
- If signature upload requires a rerender, preserve signer values first and keep it outside the normal typing path.

Known-good browser check:
1. Type a multi-character string into **Signer name** and **Signer title or team**.
2. Confirm the active element stays on the field being typed and the complete string remains.
3. Open **Preview letter** and confirm the preview contains the typed signer name/title.

## Modal navigation rule
- Users must be able to leave the preview without knowing the Escape key.
- Keep an obvious text button such as **Close preview** in the modal header, alongside any `×` icon.
- Clicking the backdrop/outside the preview dialog should close the modal; clicking inside the dialog must not close it.
- Keep Escape as an additional shortcut only, not the primary discoverable exit.

## Verification checklist
- Browser snapshot shows `Preview letter` button in the workspace.
- No inline `.preview-card .secure-access-preview-shell` under the workspace detail panel.
- Clicking the button opens `#letterPreviewModal` / equivalent dialog.
- Modal contains full-page preview with the reconstructed template styling.
- Old mock text such as `FlowAudit client letterhead` is absent.
- Signer inputs have no per-keystroke form rerender (`oninput="syncPreview()"` with `syncPreview(){ renderDetail(); }` is a regression).
- Automated regression tests cover button/modal behavior, old mock removal, and signer typing without focus loss.
- Regression tests should also fail if the preview falls back to freestyled CSS art or fake logo marks when a reference asset exists; assert the real asset paths/classes are present and old fake selectors/text are absent.
- Browser/DOM verification should include: header image asset loaded, header margin is zero/edge-to-edge when expected, logo/contact asset loaded, no fake mountain/logo selector remains, 8.5/11 ratio is preserved, and signature bottom is above footer top.
