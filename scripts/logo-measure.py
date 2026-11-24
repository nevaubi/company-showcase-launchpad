"""Measure the drawn aspect ratio of every mark in a logo folder.
usage: python3 -I measure.py <logos dir> <out json>
SVG: rasterised with rsvg-convert at 256 px height; raster: decoded with Pillow.
Content box = pixels that are not transparent (alpha >= 24) and not near white (any channel < 236).
Records the file's own box (w, h) and the content box, both as ratios width/height, plus sha256,
and the dominant ink colour (`ink_rgb`, for the monogram plate of a wide mark without a square icon):
the most common saturated hue of the ink (`ink_mode` "hue", `ink_mix` = the share of the saturated ink
in that hue and its two neighbours, low for a multi-colour mark), or the darkest quarter of the ink when
under a fifth of it is saturated (`ink_mode` "dark", a grey or black mark)."""
import colorsys, hashlib, json, os, re, subprocess, sys, tempfile
from PIL import Image, ImageChops
Image.MAX_IMAGE_PIXELS = 60_000_000
src, out = sys.argv[1], sys.argv[2]
res = {}
def content_box(im):
    im = im.convert("RGBA")
    a = im.getchannel("A").point(lambda v: 255 if v >= 24 else 0)
    rgb = im.convert("RGB")
    # near-white: min channel >= 236 -> background
    r, g, b = rgb.split()
    mn = ImageChops.darker(ImageChops.darker(r, g), b)
    ink = mn.point(lambda v: 255 if v < 236 else 0)
    mask = ImageChops.multiply(a, ink)
    return mask.getbbox(), im.size
def ink_colour(im):
    im = im.convert("RGBA"); im.thumbnail((160, 160))
    px = [(r, g, b) for r, g, b, a in im.getdata() if a >= 128 and min(r, g, b) < 236]
    if not px: return None
    sat = []
    for r, g, b in px:
        mx, mn = max(r, g, b), min(r, g, b)
        if mx >= 50 and (mx - mn) / mx >= 0.3: sat.append((r, g, b))
    med = lambda xs: tuple(sorted(c[i] for c in xs)[len(xs) // 2] for i in range(3))
    if len(sat) >= 0.2 * len(px):
        bins = {}
        for c in sat:
            h = colorsys.rgb_to_hsv(*(v / 255 for v in c))[0]
            bins.setdefault(int(h * 12) % 12, []).append(c)
        top = max(bins, key=lambda k: len(bins[k]))
        near = sum(len(bins.get((top + d) % 12, [])) for d in (-1, 0, 1))
        rgb, mode, mix = med(bins[top]), "hue", round(near / len(sat), 3)
    else:
        dark = sorted(px, key=lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])[: max(1, len(px) // 4)]
        rgb, mode, mix = med(dark), "dark", 1.0
    return {"ink_rgb": "%02x%02x%02x" % rgb, "ink_mode": mode, "ink_mix": mix}
tmp = tempfile.mkdtemp()
for f in sorted(os.listdir(src)):
    ext = f.rsplit(".", 1)[-1].lower()
    if ext not in ("svg", "png", "jpg", "jpeg", "webp"): continue
    p = os.path.join(src, f)
    data = open(p, "rb").read()
    sha = hashlib.sha256(data).hexdigest()
    rec = {"sha256": sha}
    try:
        if ext == "svg":
            png = os.path.join(tmp, "x.png")
            r = subprocess.run(["rsvg-convert", "-h", "256", "-o", png, p], capture_output=True, timeout=30)
            if r.returncode != 0: raise RuntimeError(r.stderr.decode()[:120])
            im = Image.open(png)
        else:
            im = Image.open(p); im.load()
        box, (w, h) = content_box(im)
        rec["box"] = round(w / h, 3)
        if box:
            cw, ch = box[2] - box[0], box[3] - box[1]
            rec["ink"] = round(cw / max(ch, 1), 3)
            rec["fill"] = round((cw * ch) / (w * h), 3)
            # content box as fractions of the file's own box: left, top, right, bottom
            rec["crop"] = [round(box[0] / w, 4), round(box[1] / h, 4), round(box[2] / w, 4), round(box[3] / h, 4)]
            rec.update(ink_colour(im) or {})
        else:
            rec["ink"] = None
    except Exception as e:
        rec["error"] = str(e)[:120]
    res[f] = rec
json.dump(res, open(out, "w"), indent=0, sort_keys=True)
print(len(res), sum(1 for r in res.values() if "error" in r))
