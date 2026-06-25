# Vault letter whiteout reconstruction workflow

Use this for RRD vault/PostGrid letter previews when the operator uploads a full PDF/PNG/JPG letter and complains that the preview is grainy, duplicated, unclear, or that header/footer art is not edge-to-edge.

## Trigger signals
- Operator says the preview is "too grainy", "not clear", "Duplicate Mountains", duplicated header/art, or asks to "cover up" only the text that needs changing.
- Uploaded asset is a full-page letter with useful brand/header/footer quality, but old body/date/recipient/signoff text must be replaced.

## Preferred approach
Preserve the uploaded page as the visual source of truth and mask only editable text areas.

1. Render the PDF/page or image at high resolution, not the small preview size.
   - Good baseline for US Letter preview: output canvas `1700 x 2200` (2x 850x1100) or higher.
   - For PDF input, render page 1 via PDF.js/PyMuPDF at a matching scale and draw that into the output canvas.
2. Draw the full original page once onto the output canvas.
   - Do **not** crop and duplicate header/mountain/logo/footer regions unless the source page itself requires rebuilding.
   - This keeps edge-to-edge header art and avoids blurry repeated brand elements.
3. Whiteout only the regions that must change:
   - date
   - recipient/address block
   - subject line
   - main body text
   - old signoff/signature/title area, if the recovery copy needs a new signoff
4. Reproduce replacement text cleanly on top.
   - Match the source letter's font style, weight, size, line height, color, and left margin as closely as possible.
   - Keep line wrapping deterministic so the text does not collide with footer/signature areas.
5. Hide any DOM overlay copy when the reconstructed PNG already contains the recovery text.
   - The live preview should show only the generated high-res PNG, not a second HTML text layer.

## Body/date leak pitfalls
If old body text is still visible, the mask is too narrow — do not just draw heavier/newer text over it. Expand the whiteout rectangle to cover the full original body text area, including left-column remnants and far-right copy fragments, then redraw the replacement text within the same broad content column.

For full-page US Letter-style previews, a proven starting point is:
- mask subject/body from roughly `x=9.5%` through `x=93%` of page width;
- mask recipient/date blocks far enough left to cover old address columns, not only the new recipient text;
- set replacement text around `x=12.5%` with about `74%` page-width wrapping, so it reads edge-to-edge like the original rather than floating in the middle;
- keep the lower signoff/signature area intentionally blank/available unless the operator asks to replace it.

Date replacement is a separate precision check. The operator expects exactly one date: the template date must be completely covered first, then the recovery date redrawn in the template date's original font size and baseline. Do not place a larger/bolder date lower on the page. If using the `1700 x 2200` canvas pattern, a good starting correction is a date mask around `y=25.2%` to `33.7%` and a date baseline around `y=28.6%`, with a smaller Times/Georgia-style font (about `30px` at that canvas size), then visually compare against the source PDF.

Recipient/address blocks are part of the same typography match. Do not make `Accounts Payable Team / Customer Account / Billing Address` larger than the main body copy; the operator will read that as visually wrong even if it is legible. Match the recipient block to the body text size unless the source PDF clearly uses a different size. In the current `1700 x 2200` vault preview pattern, use `32px Georgia` for the recipient block when the body is `32px Georgia`; avoid reverting to the earlier oversized `38px` recipient block.

User-facing preference: when the operator says old text/date is leaking through or that text sizing is wrong, treat it as a hard visual failure. The correct fix is cover/remove old content first, then place clean text with matching typography; never describe it as acceptable overlaying.

## What not to do
- Do not overlay new recovery copy on top of old visible PDF text.
- Do not use a narrow middle-column mask that leaves old text fragments visible at the left or right edges.
- Do not rebuild the page by stitching low-resolution crops when the source page can be preserved directly.
- Do not duplicate decorative header imagery (for example repeated mountains) to fake edge-to-edge coverage.
- Do not claim quality is fixed from static markers alone; verify the rendered image dimensions and browser display.

## Regression checks
- Unit/static tests should assert the whiteout/masking path exists and that clean reconstruction hides the old overlay copy.
- Browser-console/live smoke should confirm:
  - preview `src` starts with `data:image/png`
  - rendered/natural size is high resolution, e.g. `1700 x 2200`
  - page class indicates clean reconstruction/whiteout mode
  - `.letter-preview-copy` is hidden
  - no old body text remains visible in the preview image
- Run the vault suite before deploy:

```bash
node --test /Users/AIAgenterminal/test/rrd-vault-*.test.mjs
```

## Deployment/verification
Deploy from the ivory app directory with the real operator home so Vercel auth is available:

```bash
cd /Users/AIAgenterminal/revenue-recovery-web
HOME=/Users/AIAgenterminal npx --yes vercel --prod --yes
```

Then verify the canonical ivory vault link in a browser simulation. The branded FlowAudit route is a vanity layer and should not be debugged for this issue.