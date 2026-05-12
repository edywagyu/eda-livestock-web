#!/usr/bin/env python3
"""Build both English and Japanese buyer's guide PDFs.

Pipeline per language:
  1. Generate base PDF from HTML via Chrome headless
  2. Append MAFF beef cuts guide pages
  3. Add hyperlinks on slide 4 (cut cards → MAFF pages)
  4. Rasterize MAFF appendix for compression (preserves buyer deck quality)
"""

import fitz
import io
import os
import subprocess
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
MAFF_PDF = "/Users/tomokieda/Downloads/full_english_1 (2).pdf"

# Cut → MAFF page mapping (1-indexed)
CUT_PAGES = {
    "striploin": 11, "ribeye": 11, "fillet": 10,
    "round": 15, "tomahawk": 12, "skinpack": 17,
}

# Cut card positions on slide 4 (1280x720 pixel space)
# Updated for new layout: thumbnail (96px) + num + info + badge
CUT_CARD_RECTS = {
    "striploin":  (60,  170, 632, 280),
    "ribeye":    (650, 170, 1222, 280),
    "fillet":     (60,  295, 632, 405),
    "round":     (650, 295, 1222, 405),
    "tomahawk":   (60,  420, 632, 525),
    "skinpack":  (650, 420, 1222, 525),
}


def generate_base(html_url, out_pdf):
    """Generate base PDF from URL via Chrome headless."""
    subprocess.run([
        CHROME, "--headless", "--disable-gpu",
        f"--print-to-pdf={out_pdf}", "--no-margins",
        "--print-background", "--no-pdf-header-footer",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=10000", html_url
    ], capture_output=True)
    return os.path.getsize(out_pdf)


def merge_append_link_compress(base_pdf, out_pdf, maff_pdf=MAFF_PDF, dpi=130, q=75):
    """Merge buyer + MAFF, add cut hyperlinks, rasterize MAFF appendix for compression."""
    buyer = fitz.open(base_pdf)
    maff = fitz.open(maff_pdf)

    # Merge
    pages_before = len(buyer)
    buyer.insert_pdf(maff)
    maff.close()

    # Add hyperlinks on slide 4
    page4 = buyer[3]
    sx = page4.rect.width / 1280
    sy = page4.rect.height / 720
    for cut, rect in CUT_CARD_RECTS.items():
        x0, y0, x1, y1 = rect
        pdf_rect = fitz.Rect(x0*sx, y0*sy, x1*sx, y1*sy)
        target = pages_before + CUT_PAGES[cut] - 1
        page4.insert_link({
            "kind": fitz.LINK_GOTO, "from": pdf_rect,
            "page": target, "to": fitz.Point(0, 0), "zoom": 0,
        })

    tmp_merged = base_pdf + ".merged.tmp"
    buyer.save(tmp_merged, garbage=4, deflate=True)
    buyer.close()

    # Now compress only by rasterizing MAFF appendix (buyer deck pages stay intact)
    src = fitz.open(tmp_merged)
    cut_links = src[3].get_links()

    new = fitz.open()
    # Copy buyer deck as-is (preserves all photos and hyperlinks)
    new.insert_pdf(src, from_page=0, to_page=pages_before-1)
    # Rasterize MAFF appendix only
    for i in range(pages_before, len(src)):
        page = src[i]
        pix = page.get_pixmap(dpi=dpi, alpha=False)
        pil = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        out_io = io.BytesIO()
        pil.save(out_io, format="JPEG", quality=q, optimize=True, progressive=True)
        new_page = new.new_page(width=page.rect.width, height=page.rect.height)
        new_page.insert_image(new_page.rect, stream=out_io.getvalue())

    # Re-apply GOTO links on slide 4 (URI links preserved by insert_pdf)
    page4 = new[3]
    for link in cut_links:
        if link["kind"] == fitz.LINK_GOTO:
            page4.insert_link({
                "kind": fitz.LINK_GOTO, "from": link["from"],
                "page": link["page"], "to": link.get("to", fitz.Point(0, 0)),
                "zoom": link.get("zoom", 0),
            })

    src.close()
    new.save(out_pdf, garbage=4, deflate=True, deflate_images=True,
             deflate_fonts=True, clean=True)
    new.close()
    os.remove(tmp_merged)


def build(html_url, out_pdf, label):
    print(f"\n=== {label} ===")
    base_tmp = os.path.join(BASE, f"_base_{label}.pdf")
    print(f"  Generating base from HTML...")
    base_size = generate_base(html_url, base_tmp)
    print(f"  Base: {base_size:,} bytes ({base_size/1024/1024:.2f} MB)")
    print(f"  Merging + linking + rasterizing MAFF appendix...")
    merge_append_link_compress(base_tmp, out_pdf)
    os.remove(base_tmp)
    final = os.path.getsize(out_pdf)
    print(f"  → {out_pdf}")
    print(f"  Final: {final:,} bytes ({final/1024/1024:.2f} MB)")


if __name__ == "__main__":
    build(
        "http://localhost:8080/buyer-deck.html",
        os.path.join(BASE, "EDA-WAGYU_Buyers_Guide_2026.pdf"),
        "EN"
    )
    build(
        "http://localhost:8080/buyer-deck-jp.html",
        os.path.join(BASE, "EDA-WAGYU_Buyers_Guide_2026_JP.pdf"),
        "JP"
    )
    build(
        "http://localhost:8080/buyer-deck-es.html",
        os.path.join(BASE, "EDA-WAGYU_Buyers_Guide_2026_ES.pdf"),
        "ES"
    )
    build(
        "http://localhost:8080/buyer-deck-it.html",
        os.path.join(BASE, "EDA-WAGYU_Buyers_Guide_2026_IT.pdf"),
        "IT"
    )
    import shutil
    shutil.copy(
        os.path.join(BASE, "EDA-WAGYU_Buyers_Guide_2026_JP.pdf"),
        os.path.join(BASE, "江田和牛_バイヤーズガイド_2026.pdf")
    )
    print("\n=== DONE ===")
    for n in ["EDA-WAGYU_Buyers_Guide_2026.pdf", "EDA-WAGYU_Buyers_Guide_2026_JP.pdf",
              "EDA-WAGYU_Buyers_Guide_2026_ES.pdf", "EDA-WAGYU_Buyers_Guide_2026_IT.pdf",
              "江田和牛_バイヤーズガイド_2026.pdf"]:
        p = os.path.join(BASE, n)
        if os.path.exists(p):
            sz = os.path.getsize(p)
            print(f"  {n}: {sz/1024/1024:.2f} MB")
