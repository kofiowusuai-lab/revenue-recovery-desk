#!/usr/bin/env python3
"""Reconstruct a clean recovery-letter template from an uploaded style PDF.

The source PDF may be a scanned / image-only letterhead. This workflow extracts
reusable visual assets (banner, logo/contact block, signature, footer), writes a
clean positioned HTML letter, then renders that HTML to PDF with Playwright.
"""
from __future__ import annotations

import argparse
import html
import json
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

import fitz  # PyMuPDF
from PIL import Image


@dataclass
class Region:
    name: str
    # Fractions of page width/height: left, top, right, bottom
    box: tuple[float, float, float, float]
    kind: str = "image"


DEFAULT_REGIONS = [
    # Tuned to the uploaded Northern Peak / mountain sample. These are ratios so
    # the same workflow is stable if the source image is rendered at a different DPI.
    Region("top-banner", (0.13, 0.045, 0.885, 0.255)),
    Region("logo-contact", (0.54, 0.225, 0.965, 0.455)),
    Region("signature", (0.195, 0.795, 0.365, 0.855)),
    Region("footer", (0.16, 0.925, 0.855, 0.975)),
]

RECOVERY_BODY = [
    ("Dear Customer,", "normal"),
    ("", "normal"),
    ("We are writing about the overdue balance on your account. Our records show the invoice below remains unpaid.", "normal"),
    ("", "normal"),
    ("Invoice: INV-12345", "normal"),
    ("Amount due: £1,250.00", "normal"),
    ("Due date: 20 May 2024", "normal"),
    ("", "normal"),
    ("Please arrange payment or contact us within 7 days if this has already been resolved or if you need to discuss the balance.", "normal"),
    ("", "normal"),
    ("Thank you,", "normal"),
]


def render_pdf_page(pdf_path: Path, out_png: Path, zoom: float = 4.0) -> tuple[int, int]:
    doc = fitz.open(pdf_path)
    if not doc or doc.page_count < 1:
        raise ValueError(f"No pages found in {pdf_path}")
    page = doc[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    pix.save(out_png)
    return pix.width, pix.height


def crop_regions(page_png: Path, asset_dir: Path, regions: Iterable[Region]) -> dict[str, dict]:
    asset_dir.mkdir(parents=True, exist_ok=True)
    img = Image.open(page_png).convert("RGB")
    w, h = img.size
    assets = {}
    for r in regions:
        l, t, rr, b = r.box
        crop_box = (round(l * w), round(t * h), round(rr * w), round(b * h))
        cropped = img.crop(crop_box)
        out = asset_dir / f"{r.name}.png"
        cropped.save(out)
        assets[r.name] = {
            "path": out.name,
            "abs_path": str(out),
            "box": r.box,
            "pixels": crop_box,
            "width": cropped.size[0],
            "height": cropped.size[1],
            "kind": r.kind,
        }
    return assets


def write_html(out_html: Path, assets: dict[str, dict], company: str, amount: str, invoice: str) -> None:
    # Absolute CSS is in a letter-ratio canvas. The visual assets come from the source
    # style PDF, while the old body text is deliberately not reused.
    esc_company = html.escape(company)
    esc_amount = html.escape(amount)
    esc_invoice = html.escape(invoice)
    body_lines = [
        ("Dear Customer,", "normal"),
        ("", "normal"),
        ("We are writing about the overdue balance on your account. Our records show the invoice below remains unpaid.", "normal"),
        ("", "normal"),
        (f"Invoice: {esc_invoice}", "normal"),
        (f"Amount due: {esc_amount}", "normal"),
        ("Due date: 20 May 2024", "normal"),
        ("", "normal"),
        ("Please arrange payment or contact us within 7 days if this has already been resolved or if you need to discuss the balance.", "normal"),
        ("", "normal"),
        ("Thank you,", "normal"),
    ]
    body_html = "\n".join("<p>&nbsp;</p>" if not t else f"<p>{t}</p>" for t, _ in body_lines)
    content = f"""<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>Clean recovery letter preview — {esc_company}</title>
  <style>
    @page {{ size: Letter; margin: 0; }}
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; background: #e5e7eb; }}
    body {{ font-family: Arial, Helvetica, sans-serif; }}
    .page {{
      position: relative;
      width: 8.5in;
      height: 11in;
      margin: 0 auto;
      background: #fff;
      overflow: hidden;
    }}
    .asset {{ position: absolute; display: block; object-fit: contain; }}
    .top-banner {{ left: 13%; top: 4.5%; width: 75.5%; height: 21%; object-fit: cover; }}
    .logo-contact {{ left: 56%; top: 23.5%; width: 36%; height: 23%; }}
    .footer {{ left: 16%; top: 92.5%; width: 69.5%; height: 5%; }}
    .date {{ position:absolute; left: 21%; top: 30.4%; font-family: Georgia, 'Times New Roman', serif; font-size: 8.2pt; color: #262626; }}
    .recipient {{ position:absolute; left: 21%; top: 36.5%; font-family: Georgia, 'Times New Roman', serif; font-size: 9pt; line-height: 1.35; color:#111; }}
    .subject {{ position:absolute; left: 21%; top: 48.8%; font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 9.5pt; color:#111; }}
    .body {{
      position: absolute;
      left: 21%;
      top: 52.2%;
      width: 52%;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 8.7pt;
      line-height: 1.34;
      color: #111111;
    }}
    .body p {{ margin: 0 0 6px; }}
    .signature {{ left: 20.6%; top: 80.3%; width: 17%; height: 6%; }}
    .signoff {{ position:absolute; left:21%; top:77.5%; font-family: Georgia, 'Times New Roman', serif; font-size:8.9pt; color:#111; }}
    .sig-title {{ position:absolute; left:21%; top:86.4%; font-family: Georgia, 'Times New Roman', serif; font-size:8.4pt; line-height:1.25; color:#111; }}
  </style>
</head>
<body>
  <main class=\"page\">
    <img class=\"asset top-banner\" src=\"assets/{assets['top-banner']['path']}\" alt=\"letterhead banner\" />
    <img class=\"asset logo-contact\" src=\"assets/{assets['logo-contact']['path']}\" alt=\"company logo and contact block\" />
    <div class=\"date\">20 May 2024</div>
    <div class=\"recipient\">Accounts Payable Team<br>Customer Account<br>Billing Address</div>
    <div class=\"subject\">Subject: Overdue invoice reminder</div>
    <div class=\"body\">{body_html}</div>
    <div class=\"signoff\">Sincerely,</div>
    <img class=\"asset signature\" src=\"assets/{assets['signature']['path']}\" alt=\"signature\" />
    <div class=\"sig-title\"><strong>Accounts Receivable Team</strong><br>{esc_company}</div>
    <img class=\"asset footer\" src=\"assets/{assets['footer']['path']}\" alt=\"letter footer\" />
  </main>
</body>
</html>
"""
    out_html.write_text(content)


def render_html_to_pdf(html_path: Path, pdf_path: Path) -> None:
    # Playwright CLI gives us real HTML/CSS -> PDF rendering without storing secrets.
    url = html_path.resolve().as_uri()
    subprocess.run(
        ["npx", "--yes", "playwright", "pdf", "--browser", "chromium", url, str(pdf_path)],
        check=True,
        cwd=str(html_path.parent),
    )


def render_pdf_to_png(pdf_path: Path, png_path: Path) -> None:
    doc = fitz.open(pdf_path)
    pix = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    pix.save(png_path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source_pdf", type=Path)
    ap.add_argument("--outdir", type=Path, default=Path("/Users/AIAgenterminal/rrd-letter-previews/wuss-worldwide"))
    ap.add_argument("--company", default="Northern Peak Solutions")
    ap.add_argument("--invoice", default="INV-12345")
    ap.add_argument("--amount", default="£1,250.00")
    args = ap.parse_args()

    args.outdir.mkdir(parents=True, exist_ok=True)
    assets_dir = args.outdir / "assets"
    source_png = args.outdir / "source-render.png"
    w, h = render_pdf_page(args.source_pdf, source_png)
    assets = crop_regions(source_png, assets_dir, DEFAULT_REGIONS)
    layout = {
        "source_pdf": str(args.source_pdf),
        "source_render": str(source_png),
        "page_pixels": [w, h],
        "note": "Source PDF is image-only; reusable visual regions were cropped and old body text was not used in the clean letter.",
        "assets": assets,
        "text_style": {
            "body_font": "Georgia, Times New Roman, serif",
            "body_color": "#111111",
            "body_size_pt": 9.2,
            "positioning": "Absolute CSS percentages matching source visual layout",
        },
    }
    (args.outdir / "layout.json").write_text(json.dumps(layout, indent=2))
    html_path = args.outdir / "clean-recovery-letter.html"
    pdf_path = args.outdir / "clean-recovery-letter.pdf"
    png_path = args.outdir / "clean-recovery-letter.png"
    write_html(html_path, assets, args.company, args.amount, args.invoice)
    render_html_to_pdf(html_path, pdf_path)
    render_pdf_to_png(pdf_path, png_path)
    print(json.dumps({
        "html": str(html_path),
        "pdf": str(pdf_path),
        "png": str(png_path),
        "layout": str(args.outdir / "layout.json"),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
