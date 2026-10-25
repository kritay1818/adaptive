#!/usr/bin/env python3
"""Blur (or cover) a rectangle of a screenshot, e.g. the generated application password in step3.png.

Usage:  python3 scripts/blur-region.py src/ui/help/step3.png X Y WIDTH HEIGHT [--cover]
Pixel coordinates from the top-left corner. The file is overwritten; a backup goes to artifacts/ (git-ignored,
never shipped inside src/).
"""
import os
import shutil
import sys

from PIL import Image, ImageDraw, ImageFilter

args = [a for a in sys.argv[1:] if not a.startswith("--")]
if len(args) != 5:
    sys.exit(__doc__)
path, x, y, w, h = args[0], *map(int, args[1:])
os.makedirs("artifacts", exist_ok=True)
shutil.copyfile(path, os.path.join("artifacts", os.path.basename(path).replace(".png", ".original.png")))
image = Image.open(path).convert("RGB")
box = (x, y, x + w, y + h)
if "--cover" in sys.argv:
    ImageDraw.Draw(image).rectangle(box, fill=(60, 67, 80))
else:
    region = image.crop(box).filter(ImageFilter.GaussianBlur(14))
    image.paste(region, box)
image.save(path)
print("saved", path)
