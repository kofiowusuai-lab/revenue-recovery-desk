#!/usr/bin/env python3
"""Extract letter design hints from uploaded PDF/DOCX/image assets.
Outputs JSON only. Never reads secrets.
"""
import base64, json, mimetypes, os, statistics, sys
from pathlib import Path


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))


def extract_pdf(p):
    import fitz  # PyMuPDF
    doc = fitz.open(str(p))
    if len(doc) == 0:
        return {"type":"pdf", "pages":0}
    page = doc[0]
    w, h = float(page.rect.width), float(page.rect.height)
    text = page.get_text("dict")
    spans, images = [], []
    for block in text.get("blocks", []):
        bbox = [float(x) for x in block.get("bbox", [0,0,0,0])]
        if block.get("type") == 0:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    txt = (span.get("text") or "").strip()
                    if not txt: continue
                    spans.append({
                        "text": txt[:160], "bbox": [float(x) for x in span.get("bbox", bbox)],
                        "font": span.get("font"), "size": float(span.get("size") or 0),
                        "color": span.get("color"),
                    })
        elif block.get("type") == 1:
            item = {"bbox": bbox, "width": block.get("width"), "height": block.get("height"), "ext": block.get("ext") or "png"}
            raw = block.get("image")
            if raw and len(raw) <= 500_000:
                ext = item["ext"]
                mime = "image/jpeg" if ext in ("jpg","jpeg") else ("image/svg+xml" if ext == "svg" else "image/png")
                item["dataUri"] = "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii"))
            images.append(item)
    sizes = [s["size"] for s in spans if s["size"]]
    body_spans = [s for s in spans if s["bbox"][1] > h*0.18 and s["bbox"][1] < h*0.85]
    font = None
    if spans:
        fonts = [s["font"] for s in spans if s.get("font")]
        if fonts: font = max(set(fonts), key=fonts.count)
    left = min([s["bbox"][0] for s in body_spans] or [72])
    top = min([s["bbox"][1] for s in body_spans] or [120])
    right = w - max([s["bbox"][2] for s in body_spans] or [w-72])
    bottom = h - max([s["bbox"][3] for s in body_spans] or [h-72])
    top_images = sorted([i for i in images if i["bbox"][1] < h*0.25], key=lambda i: (i["bbox"][1], i["bbox"][0]))
    logo = top_images[0] if top_images else None
    return {
        "type":"pdf", "pages":len(doc), "page":{"widthPt":w,"heightPt":h},
        "typography":{"fontFamily":font, "fontSizePt": round(statistics.median(sizes),2) if sizes else None},
        "layout":{"marginLeftPt":round(left,2),"marginTopPt":round(top,2),"marginRightPt":round(right,2),"marginBottomPt":round(bottom,2)},
        "logo": logo,
        "spans": spans[:80],
        "images": [{k:v for k,v in i.items() if k != "dataUri"} for i in images[:20]],
    }


def extract_docx(p):
    from docx import Document
    doc = Document(str(p))
    normal = doc.styles.get('Normal') if doc.styles else None
    font = normal.font if normal else None
    paras = [x.text.strip() for x in doc.paragraphs if x.text.strip()]
    return {
        "type":"docx", "paragraphs": paras[:30],
        "typography": {
            "fontFamily": font.name if font and font.name else None,
            "fontSizePt": (font.size.pt if font and font.size else None),
        },
        "layout": {},
    }


def extract_image(p):
    from PIL import Image
    im = Image.open(str(p))
    mime = mimetypes.guess_type(str(p))[0] or "image/png"
    return {"type":"image", "width": im.width, "height": im.height, "mime": mime}


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: rrd-letter-design-extract.py <asset>")
    p = Path(sys.argv[1])
    ext = p.suffix.lower()
    if ext == ".pdf": out = extract_pdf(p)
    elif ext == ".docx": out = extract_docx(p)
    elif ext in [".png", ".jpg", ".jpeg", ".webp"]: out = extract_image(p)
    else: out = {"type":"unsupported", "ext":ext}
    out["asset"] = p.name
    emit(out)

if __name__ == "__main__":
    main()
