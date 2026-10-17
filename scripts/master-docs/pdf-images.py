#!/usr/bin/env python3
"""Optional: write JPEG copies of the WebP screenshots into <dest>, same relative paths,
so Chrome embeds them as JPEG (about 5x smaller than the lossless re-encoding it applies to WebP).
Usage: pdf-images.py <screenshots dir> <dest dir>. Needs Pillow; build-master-docs.mjs falls back to WebP without it."""
import sys, pathlib
from PIL import Image
src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
for f in src.rglob("*.webp"):
    o = dst / f.relative_to(src).with_suffix(".jpg")
    o.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(f).convert("RGB")
    im.save(o, "JPEG", quality=80, optimize=True, progressive=False)
