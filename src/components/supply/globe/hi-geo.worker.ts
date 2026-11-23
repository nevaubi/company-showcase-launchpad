// Worker: fetches a world map (1:50m or 1:10m), packs it for the globe and hands the typed arrays over without
// copying, so the page's thread never parses megabytes of map or simplifies half a million points.
import type { Topology } from 'topojson-specification';
// each map is one emitted asset shared with the main-thread fallback (engine.ts): fetched, never bundled into code
import world10Url from 'world-atlas/countries-10m.json?url';
import world50Url from 'world-atlas/countries-50m.json?url';
import { packTopology, transferables } from './geometry';

self.onmessage = async (e: MessageEvent<{ res: 50 | 10 }>) => {
  const res = e.data?.res === 10 ? 10 : 50;
  try {
    const topo = (await (await fetch(res === 10 ? world10Url : world50Url)).json()) as Topology;
    const packed = packTopology(topo, res);
    (self as unknown as Worker).postMessage({ ok: true, res, packed }, transferables(packed));
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, res, error: (err as Error).message });
  }
};
