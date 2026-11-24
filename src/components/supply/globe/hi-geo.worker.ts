// Worker: fetches a world map (1:50m or 1:10m), packs it for the globe and hands a copy over, so the page's thread never
// parses megabytes of map or simplifies half a million points. It keeps its own copy and, where OffscreenCanvas exists,
// draws the map for a zoom (`paint`): the page shows the picture it gets back and never traces coasts during a gesture.
import type { Topology } from 'topojson-specification';
// each map is one emitted asset shared with the main-thread fallback (engine.ts): fetched, never bundled into code
import world10Url from 'world-atlas/countries-10m.json?url';
import world50Url from 'world-atlas/countries-50m.json?url';
import world110 from 'world-atlas/countries-110m.json';
import { packTopology, type MapRes, type PackedGeo } from './geometry';
import { paintMap, type MapFill, type MapPalette } from './paint';
import type { View } from './sphere';

export interface PaintRequest { paint: number; res: MapRes; view: View; dpr: number; pw: number; ph: number; palette: MapPalette; fills: MapFill[] }

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const maps: Partial<Record<MapRes, PackedGeo>> = {};
let canvas: OffscreenCanvas | null = null;

function paint(d: PaintRequest): void {
  if (typeof OffscreenCanvas === 'undefined') { post({ paint: d.paint, ok: false }); return; }
  try {
    const geo = maps[d.res] ?? (d.res === 10 ? maps[50] : undefined) ?? (maps[110] ??= packTopology(world110 as unknown as Topology, 110));
    if (!canvas) canvas = new OffscreenCanvas(d.pw, d.ph);
    if (canvas.width !== d.pw) canvas.width = d.pw;
    if (canvas.height !== d.ph) canvas.height = d.ph;
    const ctx = canvas.getContext('2d');
    if (!ctx) { post({ paint: d.paint, ok: false }); return; }
    paintMap(ctx, geo, d.view, d.dpr, d.palette, d.fills);
    const bitmap = canvas.transferToImageBitmap();
    post({ paint: d.paint, ok: true, bitmap }, [bitmap]);
  } catch {
    post({ paint: d.paint, ok: false });
  }
}

self.onmessage = async (e: MessageEvent<{ res: 50 | 10 } | PaintRequest>) => {
  if ('paint' in e.data) { paint(e.data); return; }
  const res = e.data?.res === 10 ? 10 : 50;
  try {
    const topo = (await (await fetch(res === 10 ? world10Url : world50Url)).json()) as Topology;
    const packed = packTopology(topo, res);
    maps[res] = packed;
    /* copied, not transferred: this worker draws from its own copy */
    post({ ok: true, res, packed });
  } catch (err) {
    post({ ok: false, res, error: (err as Error).message });
  }
};
