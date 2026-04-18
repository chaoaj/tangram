#!/usr/bin/env python3
"""
level_maker.py

Scans for image files named `level1.png` .. `level10.png` in the current
directory, extracts the non-background bounding box for each image, and
builds a `levels.json` file with normalized target bounding boxes that can be
used by the game.

Usage: python3 level_maker.py

The script will attempt to install the Pillow package if it's not present.
"""
import os
import sys
import json
import glob
import subprocess

try:
    from PIL import Image
except Exception:
    print('Pillow not found. Installing pillow...')
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pillow'])
    from PIL import Image


def find_level_images(max_n=10):
    files = []
    for n in range(1, max_n + 1):
        name = f'level{n}.png'
        if os.path.isfile(name):
            files.append((n, name))
    return files


def bbox_from_image(path, white_threshold=250):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    # try alpha channel first
    alpha = im.split()[-1]
    bbox = alpha.getbbox()
    if bbox:
        return bbox, (w, h)
    # fallback: look for non-white pixels using grayscale threshold
    gray = im.convert('L')
    # build a binary mask: pixel is 1 if not nearly white
    mask = gray.point(lambda p: 255 if p < white_threshold else 0, mode='L')
    bbox = mask.getbbox()
    return bbox, (w, h)


def main():
    found = find_level_images(10)
    if not found:
        print('No level images (level1.png..level10.png) found in current directory.')
        return 1

    levels = []
    for n, path in found:
        print(f'Processing {path}...')
        bbox, (w, h) = bbox_from_image(path)
        if not bbox:
            print(f'  Warning: no non-background pixels found in {path}; skipping')
            continue
        x0, y0, x1, y1 = bbox
        nx = x0 / w
        ny = y0 / h
        nw = (x1 - x0) / w
        nh = (y1 - y0) / h
        level = {
            'name': f'Level {n}',
            'target': {
                'bbox': [round(nx, 6), round(ny, 6), round(nw, 6), round(nh, 6)]
            },
            'pieces': []
        }
        levels.append(level)
        print(f'  bbox px=({x0},{y0},{x1},{y1}) size=({w}x{h}) -> norm=({nx:.3f},{ny:.3f},{nw:.3f},{nh:.3f})')

    out = {'levels': levels}
    with open('levels.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2)

    print(f'Wrote levels.json with {len(levels)} levels.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
