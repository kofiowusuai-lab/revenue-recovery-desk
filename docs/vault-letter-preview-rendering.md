# Vault letter-template preview rendering

Session-derived notes for the Revenue Recovery Desk vault page (`~/revenue-recovery-web/vault.html`) when a client uploads letterhead/template files for PostGrid/physical-letter setup.

## Operator expectation
- If the operator reports the preview is wrong, **fix the preview behavior immediately**; do not merely restate that the upload list shows a file or that a browser placeholder is visible.
- For upload-preview plumbing, the goal is a **recovery-letter preview in the client's style**. If the upload is plain letterhead/blank stationery, using it as a style layer with visible recovery copy is acceptable.
- Important correction: if the uploaded PDF is an old/sample letter and its old body text remains visible, this is **not** acceptable style replication. Do not keep overlaying new text on the old PDF.
- If the operator complains that the output is grainy, duplicated, or not edge-to-edge, prefer the high-resolution whiteout path in `references/vault-letter-whiteout-reconstruction.md`: render/preserve the full source page once, mask only editable text regions, and redraw clean replacement text. This avoids duplicating decorative header art (for example mountain imagery) and preserves the source asset quality.
- If the source page cannot be preserved cleanly or needs deeper production editing, use the full clean reconstruction workflow in `references/clean-letter-style-reconstruction.md`: extract reusable style assets, build clean HTML, and render HTML to PDF/PNG.

## Symptom
- Client uploads a full-page letterhead/sample as PNG/JPG/PDF.
- The file appears in the uploaded-doc list, but the preview pane still shows the generic `Recovery notice preview` placeholder, treats the full-page image as a tiny logo/broken logo image, or shows a broken PDF/plugin placeholder.

## Root cause pattern
- The preview is client-side only. It depends on each `LETTER_ASSETS` entry having a browser-renderable `previewUrl`.
- Initial implementation only made object URLs for image files and guessed all images as `logo_or_brand_asset`.
- Raw PDF iframe/embed previews can fail in browsers and show a grey/broken document icon even though the file uploaded successfully.

## Durable fix pattern
Use this section for **browser upload preview rendering**. It fixes broken PNG/JPG/PDF display in the vault, but the key distinction is whether the upload is blank stationery or an old/sample letter containing obsolete body text. If old body text remains visible, that is a failed preview.

1. Use one image-backed template path for preview rendering:
   - Full-page image template: `<img id="letter-preview-template">` with `.has-template-image`.
   - Blank/stationery PDF: render page 1 to a canvas via PDF.js, convert to PNG, and feed that same `<img id="letter-preview-template">` with `.has-template-pdf`.
   - Old/sample-letter PDF containing body text: do **not** use the rendered whole page. Render to a source canvas only, crop reusable style regions (banner/logo-contact/signature/footer), draw a fresh clean recovery-letter canvas, set `previewKind: "reconstructed_letter_image"`, and hide `.letter-preview-copy` because the recovery copy is already drawn into the clean canvas.
   - Logo only: `<img id="letter-preview-logo">`, shown only when no full-page template/PDF is present.
2. Import PDF.js in the vault module and configure the worker:
   - `import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@.../build/pdf.min.mjs";`
   - `pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@.../build/pdf.worker.min.mjs";`
3. Generate preview URLs:
   - images: `URL.createObjectURL(file)` when `file.type` starts with `image/`.
   - PDFs: do **not** put the raw PDF blob/object URL into `<img>`; that produces broken-image alt text or shows old content.
   - For PDFs, start with `previewUrl: ""` and `renderingPreview: true`, show a short rendering status, then render with PDF.js.
   - For blank/stationery PDFs, page-1 canvas → `canvas.toDataURL("image/png")` can be used as `previewKind: "pdf_page_image"`.
   - For old/sample-letter PDFs, use a reconstruction function such as `renderPdfCleanRecoveryPreviewUrl(file)`: render page 1 to a source canvas; crop only style regions; draw a fresh white output canvas; place cropped style assets; draw new recovery-letter text; return `out.toDataURL("image/png")`; store as `previewKind: "reconstructed_letter_image"`.
   - Prefer a PNG data URL over a blob URL; in live browser checks blob image URLs could still report `naturalWidth: 0` and show as broken.
4. Role guessing:
   - filenames containing `logo`, `brand`, or `mark` remain `logo_or_brand_asset`.
   - image/PDF files default to `letterhead_or_template` unless clearly a logo.
5. When a full-page blank template/PDF is active:
   - keep `.letter-preview-copy` **visible** over the style background so the operator sees a recovery-letter sample in the client's style, not just the uploaded stationery.
   - add preview-copy padding (e.g. `padding:96px 44px 44px`) to sit inside the letter page.
   - remove `src` from inactive logo/template elements (`removeAttribute("src")`) to avoid broken image icons.
   - prefer the PDF/page-image preview over other template candidates when both are present.
6. When a clean reconstruction is active:
   - add a class such as `.has-clean-reconstruction`.
   - hide `.letter-preview-copy`; do not overlay it, because the clean recovery copy should already be drawn into the reconstructed PNG/HTML.
   - verify old body text is absent visually and structurally. If it remains, the preview is still using the whole old PDF page and is wrong.

## Regression tests
Update `/Users/AIAgenterminal/test/rrd-vault-page.test.mjs` with assertions for:
- `letter-preview-template`, `has-template-image`, and `templateImg.src = imageTemplate.previewUrl` for PNG/JPG templates.
- `pdfjs-dist`, `renderPdfCleanRecoveryPreviewUrl`, `reconstructed_letter_image`, `has-clean-reconstruction`, `previewKindFor`, `return "pdf"`, `renderingPreview: previewKind === "pdf"`, and `return out.toDataURL("image/png")` for reconstructed PDFs.
- Verify PDFs are not assigned directly to `<img>` before render: initial PDF entries should use `previewUrl: previewKind === "image" ? URL.createObjectURL(file) : ""`.
- Verify the code comments/logic make old source body text impossible to draw in reconstruction (e.g. only cropped style regions are drawn, not the full source page).

Run the full vault suite before deploy:

```bash
node --test /Users/AIAgenterminal/test/rrd-vault-*.test.mjs
```

Expected after the PDF.js recovery-letter preview fix: 43/43 tests passing (count may rise as tests are added).

## Live verification pattern
After deploying `revenue-recovery-web`, verify the live vault page with a browser-console synthetic PDF upload rather than relying only on static HTML markers:

```js
(async () => {
  const input = document.getElementById('letter-style-input');
  // Use a valid one-page PDF fixture; an EOF-only stub is not enough for PDF.js.
  const bytes = Uint8Array.from(atob('<base64-one-page-pdf-fixture>'), c => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'letterhead_converted.pdf', { type: 'application/pdf' }));
  Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 250));
    const img = document.getElementById('letter-preview-template');
    if ((img.getAttribute('src') || '').startsWith('data:image/png') && img.naturalWidth > 0) break;
  }
  const page = document.getElementById('letter-preview-page');
  const img = document.getElementById('letter-preview-template');
  const copy = document.querySelector('.letter-preview-copy');
  return {
    hasPdfClass: page.classList.contains('has-template-pdf'),
    hasImageClass: page.classList.contains('has-template-image'),
    isRendering: page.classList.contains('is-rendering-pdf'),
    templateDisplay: getComputedStyle(img).display,
    templateSrcIsDataPng: (img.getAttribute('src') || '').startsWith('data:image/png'),
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    copyDisplay: getComputedStyle(copy).display,
    copyTextIncludesRecovery: copy.innerText.includes('Recovery notice preview') && copy.innerText.includes('Invoice: INV-12345')
  };
})()
```

Expected for clean reconstruction: `hasPdfClass: true`, `hasCleanReconstruction: true` (or equivalent class), `templateDisplay: "block"`, `templateSrcIsDataPng: true`, `naturalWidth > 0`, `naturalHeight > 0`, and the old overlay `.letter-preview-copy` hidden because the reconstructed PNG already contains the recovery-letter copy. If `copyDisplay: "block"` while the old PDF body text remains visible underneath, the fix is incomplete.

## Deploy note
Use the ivory app as source of truth and deploy from `~/revenue-recovery-web` with the real operator home so Vercel finds the macOS auth store:

```bash
HOME=/Users/AIAgenterminal npx --yes vercel --prod --yes
```

Do not try to fix branded `flowaudit.co.uk/revenue-recovery/*` rewrites for this class of issue; the vault app itself lives at `https://revenue-recovery-web-ivory.vercel.app`.