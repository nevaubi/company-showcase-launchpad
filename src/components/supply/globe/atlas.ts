// Logo atlas for the supply-chain globe. Each company logo is drawn once, at the exact device-pixel size its badge
// needs, onto a shared sheet (plate, padding and all); every frame after that is a plain copy of those pixels, so
// logos stay crisp at any zoom and pixel ratio and cost almost nothing while the globe moves. Browser-only.

import { inkShare } from './labels';

export interface AtlasTile { sheet: HTMLCanvasElement; sx: number; sy: number; size: number }

interface Sheet { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; size: number; cols: number; rows: number; slots: Map<string, number> }

const sameOrigin = (url: string) => url.startsWith('/') || (typeof location !== 'undefined' && url.startsWith(location.origin));

export class LogoAtlas {
  private images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();
  private sheets = new Map<number, Sheet>();
  private plate = '#fff';
  constructor(private onReady: () => void) {}

  /** The plate colour behind every logo (the app's logo plate token). Changing it redraws the tiles. */
  setPlate(color: string): void {
    if (color === this.plate) return;
    this.plate = color;
    this.sheets.clear();
  }

  /** True once the image for this address has loaded. Starts the download the first time it is asked for. */
  private image(url: string): HTMLImageElement | null {
    const got = this.images.get(url);
    if (got) return typeof got === 'string' ? null : got;
    this.images.set(url, 'loading');
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { this.images.set(url, img); this.onReady(); };
    img.onerror = () => { this.images.set(url, 'failed'); };
    img.src = url;
    return null;
  }

  /** Whether a logo can be drawn now; false while it loads and after it failed (the caller draws the plain marker). */
  has(url: string): boolean { return this.image(url) != null; }

  private sheet(size: number): Sheet | null {
    const got = this.sheets.get(size);
    if (got) return got;
    const cols = Math.max(4, Math.floor(1024 / size)), canvas = document.createElement('canvas');
    canvas.width = cols * size; canvas.height = size * 4;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const s: Sheet = { canvas, ctx, size, cols, rows: 4, slots: new Map() };
    this.sheets.set(size, s);
    return s;
  }

  /** The tile of a logo at `size` device pixels (plate with slightly rounded corners, logo fitted inside with padding), or null until it has loaded. */
  tile(url: string, size: number): AtlasTile | null {
    const img = this.image(url);
    if (!img) return null;
    const s = this.sheet(size);
    if (!s) return null;
    let slot = s.slots.get(url);
    if (slot == null) {
      slot = s.slots.size;
      if (slot >= s.cols * s.rows) {
        /* grow the sheet by doubling its rows, keeping what is drawn */
        const next = document.createElement('canvas');
        next.width = s.canvas.width; next.height = s.canvas.height * 2;
        const nctx = next.getContext('2d');
        if (!nctx) return null;
        nctx.drawImage(s.canvas, 0, 0);
        s.canvas = next; s.ctx = nctx; s.rows *= 2;
      }
      s.slots.set(url, slot);
      const x = (slot % s.cols) * size, y = Math.floor(slot / s.cols) * size, ctx = s.ctx;
      const radius = Math.max(2, Math.round(size * 0.17)), pad = Math.max(2, Math.round(size * 0.13)), room = size - 2 * pad;
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x, y, size, size, radius); ctx.clip();
      ctx.fillStyle = this.plate; ctx.fillRect(x, y, size, size);
      const iw = img.naturalWidth || room, ih = img.naturalHeight || room, k = Math.min(room / iw, room / ih), w = iw * k, h = ih * k;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      let drawn = true;
      try { ctx.drawImage(img, x + pad + (room - w) / 2, y + pad + (room - h) / 2, w, h); } catch { drawn = false; }
      ctx.restore();
      /* a mark that loaded but drew nothing counts as missing, so its badge shows letters instead of a bare plate (only
         same-origin marks can be read back: a logo from another site taints the sheet's pixels for reading) */
      if (drawn && sameOrigin(url)) {
        try {
          const px = ctx.getImageData(x, y, size, size).data, at = (Math.floor(size / 2) * size + 1) * 4;
          drawn = inkShare(px, [px[at], px[at + 1], px[at + 2]]) >= 0.004;
        } catch { /* unreadable: keep it */ }
      }
      if (!drawn) { this.images.set(url, 'failed'); return null; }
    }
    return { sheet: s.canvas, sx: (slot % s.cols) * size, sy: Math.floor(slot / s.cols) * size, size };
  }
}
