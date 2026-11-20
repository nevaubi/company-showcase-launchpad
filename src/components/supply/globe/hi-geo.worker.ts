// Worker: parses the 1:10m world map and packs it for the globe, off the page's main thread.
import type { Topology } from 'topojson-specification';
// the map is one emitted asset shared with the main-thread fallback (engine.ts), fetched, never bundled into code
import world10Url from 'world-atlas/countries-10m.json?url';
import { packHi, transferables } from './hi-geo';

self.onmessage = async () => {
  try {
    const world10 = (await (await fetch(world10Url)).json()) as Topology;
    const packed = packHi(world10);
    (self as unknown as Worker).postMessage({ ok: true, packed }, transferables(packed));
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: (e as Error).message });
  }
};
