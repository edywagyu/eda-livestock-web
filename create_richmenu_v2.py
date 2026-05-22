#!/usr/bin/env python3
"""
江田畜産 LINE リッチメニュー v2 画像生成
2分割: A 注文する | B 会員ページ
仕様: 2500 x 843px (LINE rich menu compact)
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 2500, 843
FOREST = (15, 61, 46)       # #0F3D2E
FOREST_DEEP = (10, 45, 33)  # #0A2D21
GOLD = (212, 169, 59)       # #D4A93B
GOLD_SOFT = (184, 147, 47)  # #B8932F
CREAM = (250, 247, 240)     # #FAF7F0
WHITE = (255, 255, 255)
DIVIDER = (20, 75, 55)      # subtle green divider

img = Image.new('RGB', (W, H), FOREST)
draw = ImageDraw.Draw(img)

# --- Background gradient effect (vertical) ---
for y in range(H):
    ratio = y / H
    r = int(FOREST[0] * (1 - ratio * 0.3) + FOREST_DEEP[0] * ratio * 0.3)
    g = int(FOREST[1] * (1 - ratio * 0.3) + FOREST_DEEP[1] * ratio * 0.3)
    b = int(FOREST[2] * (1 - ratio * 0.3) + FOREST_DEEP[2] * ratio * 0.3)
    draw.line([(0, y), (W, y)], fill=(r, g, b))

# --- Gold top border ---
draw.rectangle([(0, 0), (W, 4)], fill=GOLD)

# --- Center divider line ---
mid_x = W // 2
draw.line([(mid_x, 80), (mid_x, H - 80)], fill=DIVIDER, width=2)

# --- Gold accent dots on divider ---
for dot_y in [120, H // 2, H - 120]:
    draw.ellipse([(mid_x - 4, dot_y - 4), (mid_x + 4, dot_y + 4)], fill=GOLD)

# --- Try to load fonts ---
font_paths = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
]

jp_font_large = None
jp_font_small = None
en_font = None

# Japanese font
for fp in font_paths:
    if os.path.exists(fp):
        try:
            jp_font_large = ImageFont.truetype(fp, 56)
            jp_font_small = ImageFont.truetype(fp, 32)
            break
        except Exception:
            continue

# English / icon font
en_paths = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]
for fp in en_paths:
    if os.path.exists(fp):
        try:
            en_font = ImageFont.truetype(fp, 28)
            break
        except Exception:
            continue

if not jp_font_large:
    jp_font_large = ImageFont.load_default()
    jp_font_small = ImageFont.load_default()
if not en_font:
    en_font = jp_font_small or ImageFont.load_default()

# --- Section A: 注文する (Left half) ---
a_cx = W // 4  # center of left half

# Gold circle icon
icon_r = 44
draw.ellipse(
    [(a_cx - icon_r, 180 - icon_r), (a_cx + icon_r, 180 + icon_r)],
    fill=GOLD
)
# Cart icon letter
cart_font = ImageFont.truetype(en_paths[0], 40) if os.path.exists(en_paths[0]) else en_font
bbox = draw.textbbox((0, 0), "A", font=cart_font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
draw.text((a_cx - tw // 2, 180 - th // 2 - 4), "A", fill=WHITE, font=cart_font)

# Main text
text_a1 = "注文する"
bbox1 = draw.textbbox((0, 0), text_a1, font=jp_font_large)
tw1 = bbox1[2] - bbox1[0]
draw.text((a_cx - tw1 // 2, 280), text_a1, fill=WHITE, font=jp_font_large)

# Sub text
text_a2 = "ORDER"
bbox2 = draw.textbbox((0, 0), text_a2, font=en_font)
tw2 = bbox2[2] - bbox2[0]
draw.text((a_cx - tw2 // 2, 360), text_a2, fill=GOLD_SOFT, font=en_font)

# Gold underline
line_w = 60
draw.line([(a_cx - line_w, 410), (a_cx + line_w, 410)], fill=GOLD, width=2)

# Description
text_a3 = "単品・お取り寄せ"
bbox3 = draw.textbbox((0, 0), text_a3, font=jp_font_small)
tw3 = bbox3[2] - bbox3[0]
draw.text((a_cx - tw3 // 2, 450), text_a3, fill=(180, 180, 170), font=jp_font_small)

# --- Section B: 会員ページ (Right half) ---
b_cx = W * 3 // 4

# Gold circle icon
draw.ellipse(
    [(b_cx - icon_r, 180 - icon_r), (b_cx + icon_r, 180 + icon_r)],
    fill=GOLD
)
bbox_b = draw.textbbox((0, 0), "B", font=cart_font)
tw_b = bbox_b[2] - bbox_b[0]
th_b = bbox_b[3] - bbox_b[1]
draw.text((b_cx - tw_b // 2, 180 - th_b // 2 - 4), "B", fill=WHITE, font=cart_font)

# Main text
text_b1 = "会員ページ"
bbox4 = draw.textbbox((0, 0), text_b1, font=jp_font_large)
tw4 = bbox4[2] - bbox4[0]
draw.text((b_cx - tw4 // 2, 280), text_b1, fill=WHITE, font=jp_font_large)

# Sub text
text_b2 = "MY PAGE"
bbox5 = draw.textbbox((0, 0), text_b2, font=en_font)
tw5 = bbox5[2] - bbox5[0]
draw.text((b_cx - tw5 // 2, 360), text_b2, fill=GOLD_SOFT, font=en_font)

# Gold underline
draw.line([(b_cx - line_w, 410), (b_cx + line_w, 410)], fill=GOLD, width=2)

# Description
text_b3 = "注文履歴・特典・クーポン"
bbox6 = draw.textbbox((0, 0), text_b3, font=jp_font_small)
tw6 = bbox6[2] - bbox6[0]
draw.text((b_cx - tw6 // 2, 450), text_b3, fill=(180, 180, 170), font=jp_font_small)

# --- Bottom accent line ---
draw.rectangle([(0, H - 4), (W, H)], fill=GOLD)

# --- Save ---
out_path = os.path.join(os.path.dirname(__file__), "richmenu_v2.png")
img.save(out_path, "PNG", quality=95)
print(f"✅ Rich menu image saved: {out_path}")
print(f"   Size: {W}x{H}px")
