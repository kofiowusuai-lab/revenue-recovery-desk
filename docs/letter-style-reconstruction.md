# Letter-style reconstruction for RRD vault previews

Use this when a client uploads a previous letter, letterhead PDF, scanned PNG/JPG, or template and expects the vault preview to look like a *new recovery letter in the same style*.

## Key lesson
Do **not** preview by placing new recovery copy over the full uploaded PDF/image page. That leaves the old body text visible and looks unprofessional. The correct workflow is:

1. Render the uploaded source to a page image.
2. Extract only reusable style regions: banner/header, logo/contact block, signature, footer/tagline, and other decorative marks.
3. Deliberately exclude the old letter body text region.
4. Build a clean HTML/canvas/PDF letter with new recovery content placed in matching positions, font family, sizing, colour, and spacing.
5. Render that clean HTML/canvas to PDF/PNG for preview and approval.

## If the source PDF is image-only
PyMuPDF may report only one full-page image and no text spans. In that case:
- Treat it as a scanned/flattened asset.
- Use ratio-based crops for reusable visual regions.
- Use CSS/canvas absolute positioning for the new text.
- If exact per-text font/colour/position extraction is required, add OCR/layout extraction to identify text boxes; without OCR, reconstruct visually from regions and CSS.

## Client-visible vault preview requirements
- Show a clean recovery letter, not the old uploaded letter with text overlaid.
- Old body copy must not be visible.
- Logos must not be clipped by crop boxes; expand source crop upward/left and give the destination box enough height.
- Signature and signoff must not overlap; shorten placeholder copy before shrinking the signature region.
- Prefer a short, clean sample recovery body in previews so the layout does not collide with signatures/footers.

## Browser implementation pattern
For PDFs in the vault:
- Use PDF.js to render page 1 to an offscreen canvas.
- Draw only selected source regions onto a fresh white output canvas.
- Draw the new recovery-letter text onto the output canvas.
- Set the preview image to `out.toDataURL("image/png")`; avoid assigning raw PDF blobs to `<img>`.
- Use a `has-clean-reconstruction` state/class so old overlay placeholder copy is hidden.

## Local artifact workflow used successfully
A reusable prototype script was created at `/Users/AIAgenterminal/rrd-letter-style-replicator.py`:
- Input: uploaded source PDF.
- Output: clean positioned HTML, clean PDF, PNG QA render, layout JSON.
- It uses PyMuPDF + PIL for source rendering/cropping and Playwright CLI for HTML-to-PDF.

This script is environment-specific, but the approach is durable: extract style assets -> generate clean HTML -> render clean PDF/PNG.

## QA checklist
- Old source body terms are absent from generated HTML/canvas text.
- Preview shows new recovery copy and invoice details.
- Header/banner, logo/contact, signature, and footer are visible and not clipped.
- Body copy does not overlap the signature or footer.
- Run the vault tests after code changes and perform a live browser upload simulation when possible.
