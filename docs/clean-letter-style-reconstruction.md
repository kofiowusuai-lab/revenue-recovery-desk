# Clean letter style reconstruction workflow

Session-derived notes for RRD/PostGrid letter-template handling when the operator wants a recovery letter that *replicates the client's style* without retaining old sample-letter content.

## User expectation
- Do **not** overlay recovery copy on top of a full old PDF/sample letter when the old PDF body text remains visible.
- The desired output is a **clean, regenerated recovery letter**: style/branding/layout/signature retained, old body text removed, new recovery copy placed cleanly.
- If the operator complains that old PDF text is still present, stop treating it as a preview-rendering issue and move to style reconstruction.

## Correct workflow

### A. First choice when the uploaded page quality is good: high-res whiteout
If the uploaded PDF/PNG/JPG already has the correct edge-to-edge header/footer/branding and only the old variable text needs replacing, preserve the page instead of rebuilding it from crops. See `references/vault-letter-whiteout-reconstruction.md`.

1. Render/draw the full source page once at high resolution (for preview, `1700 x 2200` is a good Letter-size baseline).
2. Whiteout only the old editable regions: date, recipient block, subject, body, and signoff/signature/title area.
3. Redraw clean replacement copy using matched font styling and line spacing.
4. Hide any separate preview overlay copy, because the generated image already contains the clean recovery-letter text.

This prevents grainy output, duplicated decorative header imagery, and non-edge-to-edge header reconstruction.

### B. Use asset extraction + HTML reconstruction when the page cannot simply be masked
1. **Inspect the uploaded PDF**
   - Use PyMuPDF (`fitz`) to check whether the PDF contains real text blocks or is image-only/scanned.
   - `page.get_text('dict')` returning only an image block means there are no fonts/text boxes to extract directly.
2. **Extract reusable visual style**
   - Render page 1 at high resolution (`page.get_pixmap(matrix=fitz.Matrix(4,4), alpha=False)`).
   - Crop reusable regions into assets, e.g. top banner, logo/contact block, signature, footer/tagline.
   - Do **not** reuse the old body-text region.
3. **Generate clean HTML**
   - Create a letter-size HTML canvas (`@page { size: Letter; margin: 0; }`, `.page { width: 8.5in; height: 11in; position: relative; }`).
   - Place extracted assets with absolute CSS positions/percentages.
   - Place new recovery-letter copy as real HTML text using a matched font family/size/colour.
   - Keep signature and footer as assets if they are visual/handwritten.
4. **Render HTML to PDF and QA image**
   - Use Playwright CLI: `HOME=/Users/AIAgenterminal npx --yes playwright pdf --browser chromium file:///.../clean-recovery-letter.html clean-recovery-letter.pdf`.
   - Render the PDF back to PNG via PyMuPDF for visual QA.
5. **Verify old content is gone**
   - Check the generated HTML/PDF source does not contain old sample body terms (for the session sample: `Employment Verification`, `James Anderson`, `Greenfield University`, `Senior Software Engineer`).
   - Check required recovery copy exists (`Subject: Overdue invoice reminder`, invoice, amount, AR team/signoff).

### C. Do not freestyle reference templates
When the user provides a visual reference and complains the preview “freestyled” the theme, treat that as a template-replication failure, not a styling tweak.

1. Crop real reusable assets from the reference/source: full-width header/banner, logo/contact block, footer/tagline, signature artwork if applicable.
2. Use those assets directly in the reconstructed HTML/PDF, with CSS only for placement, scaling, white space, and editable text.
3. Do not rebuild branded imagery with CSS gradients, fake icons, emoji/symbol mountain marks, approximate logos, or rewritten contact blocks unless no usable asset exists and the user explicitly accepts approximation.
4. If the source header is edge-to-edge, set the asset container margin to `0` and use `background-size: cover` or an `<img>` width of `100%`.
5. Keep the signature zone above the footer rule/tagline and add a DOM/visual check that `signature.bottom < footer.top`.
6. Add regressions that assert asset-backed rendering (expected asset paths/classes present) and absence of the old fake/freestyled selectors/text.

- Image-only PDFs cannot yield exact embedded fonts/colours/positions from PDF text spans because the PDF has no text. Treat this as visual reconstruction + CSS matching unless OCR/layout tooling is added.
- For text PDFs, future workflow can preserve more exactness by extracting spans: `font`, `size`, `color`, `bbox`, and mapping those into absolutely positioned HTML.
- For image-only PDFs, exact font matching requires OCR/layout analysis; without OCR, use a visually similar font (e.g. Georgia/Times for formal letters) and match placement by ratios.
- Keep extraction regions ratio-based (`left, top, right, bottom` fractions) so the same workflow survives different render DPIs.
- QA visually after each crop pass. Common issues: logo/contact crop too tight, signature crop includes old title text, body copy runs too low.

## Artifact pattern
A successful reconstruction run should produce:
- `clean-recovery-letter.html` — source of truth for editable clean letter.
- `clean-recovery-letter.pdf` — generated client/letter-provider artifact.
- `clean-recovery-letter.png` — QA preview image.
- `layout.json` — extracted regions/assets and layout metadata.

## Related vault preview note
`references/vault-letter-preview-rendering.md` covers the browser upload-preview bug class (broken image/PDF placeholders). That preview can prove upload/render plumbing, but it is **not sufficient** for final style replication when the source PDF still contains old body text. Use this clean reconstruction workflow for production-quality recovery letters.