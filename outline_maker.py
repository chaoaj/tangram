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


def bbox_and_outline_from_image(path, white_threshold=250, max_points=200, color_threshold=30):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    # try alpha channel first, but only if there is any transparency
    alpha = im.split()[-1]
    mask = None
    aext = alpha.getextrema()
    if aext and aext[0] < 255:
        # some transparent pixels exist
        mask = alpha.point(lambda p: 255 if p > 0 else 0, mode='L')
    else:
        # fallback: build mask by comparing to background color (sample top-left)
        bg = im.getpixel((0, 0))  # (r,g,b,a)
        pixels = im.load()
        mask = Image.new('L', (w, h), 0)
        mpx = mask.load()
        for yy in range(h):
            for xx in range(w):
                pr, pg, pb, pa = pixels[xx, yy]
                # color distance to background
                dr = pr - bg[0]
                dg = pg - bg[1]
                db = pb - bg[2]
                dist2 = dr*dr + dg*dg + db*db
                if dist2 > color_threshold*color_threshold and pa > 16:
                    mpx[xx, yy] = 255

    bbox = mask.getbbox()
    if not bbox:
        return None, None, (w, h)

    x0, y0, x1, y1 = bbox
    bw = x1 - x0
    bh = y1 - y0
    cropped = mask.crop(bbox)

    px = cropped.load()
    foreground_pixels = []
    for yy in range(bh):
        for xx in range(bw):
            if px[xx, yy] != 0:
                foreground_pixels.append((xx, yy))

    if not foreground_pixels:
        return bbox, None, (w, h)

    from collections import deque
    visited = [[False] * bw for _ in range(bh)]
    components = []

    for sx, sy in foreground_pixels:
        if visited[sy][sx]:
            continue
        queue = deque([(sx, sy)])
        visited[sy][sx] = True
        component = []
        while queue:
            x, y = queue.popleft()
            component.append((x, y))
            for ny in range(max(0, y - 1), min(bh, y + 2)):
                for nx in range(max(0, x - 1), min(bw, x + 2)):
                    if visited[ny][nx] or px[nx, ny] == 0:
                        continue
                    visited[ny][nx] = True
                    queue.append((nx, ny))
        components.append(component)

    def simplify_pts(points, area_tol=1.0):
        if len(points) < 4:
            return points[:]
        simplified = points[:]
        changed = True
        while changed and len(simplified) > 3:
            changed = False
            for i in range(len(simplified)):
                prev_pt = simplified[(i - 1) % len(simplified)]
                cur_pt = simplified[i]
                next_pt = simplified[(i + 1) % len(simplified)]
                area2 = abs(
                    prev_pt[0] * (cur_pt[1] - next_pt[1])
                    + cur_pt[0] * (next_pt[1] - prev_pt[1])
                    + next_pt[0] * (prev_pt[1] - cur_pt[1])
                )
                if area2 <= area_tol:
                    del simplified[i]
                    changed = True
                    break
        return simplified

    dirs = [
        (-1, 0),
        (-1, -1),
        (0, -1),
        (1, -1),
        (1, 0),
        (1, 1),
        (0, 1),
        (-1, 1),
    ]

    def is_boundary_pixel(x, y, comp_set):
        for ny in range(y - 1, y + 2):
            for nx in range(x - 1, x + 2):
                if nx == x and ny == y:
                    continue
                if nx < 0 or ny < 0 or nx >= bw or ny >= bh or (nx, ny) not in comp_set:
                    return True
        return False

    def order_component(component):
        comp_set = set(component)
        boundary_points = [pt for pt in component if is_boundary_pixel(pt[0], pt[1], comp_set)]
        if not boundary_points:
            return []

        start = min(boundary_points, key=lambda pt: (pt[1], pt[0]))
        contour = [start]
        cur = start
        backtrack = (start[0] - 1, start[1])
        start_state = (cur, backtrack)
        loop_guard = 0

        while loop_guard < len(boundary_points) * 8:
            dx = backtrack[0] - cur[0]
            dy = backtrack[1] - cur[1]
            try:
                dir_idx = dirs.index((dx, dy))
            except ValueError:
                dir_idx = 0

            start_idx = (dir_idx + 1) % 8
            next_pt = None
            next_backtrack = None
            for offset in range(8):
                cand_dir = dirs[(start_idx + offset) % 8]
                cand = (cur[0] + cand_dir[0], cur[1] + cand_dir[1])
                if cand in comp_set:
                    next_pt = cand
                    prev_dir = dirs[(start_idx + offset - 1) % 8]
                    next_backtrack = (cur[0] + prev_dir[0], cur[1] + prev_dir[1])
                    break

            if next_pt is None:
                break

            cur, backtrack = next_pt, next_backtrack
            state = (cur, backtrack)
            if state == start_state:
                break
            contour.append(cur)
            loop_guard += 1

        return contour

    rings = []
    for component in components:
        if len(component) < 3:
            continue
        ordered = order_component(component)
        ordered = simplify_pts(ordered, area_tol=1.0)
        ring = [(pt[0] / bw, pt[1] / bh) for pt in ordered]
        if len(ring) > max_points:
            step = max(1, len(ring) // max_points)
            ring = [ring[i] for i in range(0, len(ring), step)]
        if ring and ring[0] != ring[-1]:
            ring.append(ring[0])
        rings.append(ring)

    if not rings:
        return bbox, None, (w, h)
    if len(rings) == 1:
        return bbox, rings[0], (w, h)
    return bbox, rings, (w, h)


def main():
    found = find_level_images(10)
    if not found:
        print('No level images (level1.png..level10.png) found in current directory.')
        return 1

    levels = []
    for n, path in found:
        print(f'Processing {path}...')
        bbox, outline, (w, h) = bbox_and_outline_from_image(path)
        if not bbox:
            print(f'  Warning: no non-background pixels found in {path}; skipping')
            continue
        x0, y0, x1, y1 = bbox
        nx = x0 / w
        ny = y0 / h
        nw = (x1 - x0) / w
        nh = (y1 - y0) / h
        target = {
            'type': 'rect',
            'bbox': [round(nx, 6), round(ny, 6), round(nw, 6), round(nh, 6)]
        }
        if outline:
            target['outline'] = []
            # outline may be single ring or list of rings
            if outline and len(outline) and isinstance(outline[0][0], (list, tuple)):
                # list of rings
                for ring in outline:
                    target['outline'].append([[round(float(px), 6), round(float(py), 6)] for (px, py) in ring])
            else:
                target['outline'] = [[round(float(px), 6), round(float(py), 6)] for (px, py) in outline]

        level = {
            'id': n,
            'name': f'Level {n}',
            'target': target,
            'pieces': []
        }
        levels.append(level)
        print(f'  bbox px=({x0},{y0},{x1},{y1}) size=({w}x{h}) -> norm=({nx:.3f},{ny:.3f},{nw:.3f},{nh:.3f}) outlinePts={(sum(len(r) for r in outline) if outline and isinstance(outline[0][0], (list, tuple)) else (len(outline) if outline else 0))}')

    out = {
        'meta': {
            'coordSpace': 'normalized',
            'description': 'Levels use normalized coordinates (0..1) inside the target bbox'
        },
        'levels': levels
    }
    out_path = 'levels-new.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2)

    print(f'Wrote {out_path} with {len(levels)} levels.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
