#!/usr/bin/env python3
"""Regenerates the Android status-bar badge: a white "FF" monogram on a fully
transparent background. Android uses only the alpha channel of this image and
tints it, so it must contain no opaque background, gradients or colour.

    python3 scripts/generate-notification-badge.py
"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "operations"
SS = 8  # supersample for clean anti-aliased edges

def draw_ff(size):
    s = size * SS
    u = s / 96  # design on a 96-unit grid
    im = Image.new("RGBA", (s, s), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    def rect(x0, y0, x1, y1, r=1.2):
        d.rounded_rectangle([x0 * u, y0 * u, x1 * u, y1 * u], radius=r * u, fill=(255, 255, 255, 255))
    top, bottom, stem, bar = 14, 82, 12.5, 12
    for left in (8.5, 49.5):          # two F glyphs, 41 units wide each, 8 apart
        rect(left, top, left + stem, bottom)                        # stem
        rect(left, top, left + 38, top + bar)                       # top bar
        rect(left, top + 28, left + 29, top + 28 + bar)             # middle bar
    return im.resize((size, size), Image.LANCZOS)

for size, name in ((96, "notification-badge-ff.png"), (192, "notification-badge-ff-192.png")):
    img = draw_ff(size)
    # pure white RGB wherever there is any alpha; alpha carries the shape
    px = img.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = (255, 255, 255, px[x, y][3])
    img.save(OUT / name, optimize=True)
    print("wrote", OUT / name)
