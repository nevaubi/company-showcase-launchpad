// Worker: parses the 1:10m world map and packs it for the globe, off the page's main thread.
import type { Topology } from 'topojson-specification';
import world10 from 'world-atlas/countries-10m.json';
import { packHi, transferables } from './hi-geo';

self.onmessage = () => {
  try {
    const packed = packHi(world10 as unknown as Topology);
    (self as unknown as Worker).postMessage({ ok: true, packed }, transferables(packed));
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: (e as Error).message });
  }
};
