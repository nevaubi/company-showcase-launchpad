"""Measure the drawn aspect ratio of every mark in a logo folder.
usage: python3 -I measure.py <logos dir> <out json>
SVG: rasterised with rsvg-convert at 256 px height; raster: decoded with Pillow.
Content box = pixels that are not transparent (alpha >= 24) and not near white (any channel < 236).
Records the file's own box (w, h) and the content box, both as ratios width/height, plus sha256."""
import hashlib, json, os, re, subprocess, sys, tempfile
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
        else:
            rec["ink"] = None
    except Exception as e:
        rec["error"] = str(e)[:120]
    res[f] = rec
json.dump(res, open(out, "w"), indent=0, sort_keys=True)
print(len(res), sum(1 for r in res.values() if "error" in r))
