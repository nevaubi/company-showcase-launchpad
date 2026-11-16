// FINRA Reg SHO daily short-sale volume (consolidated NMS file, all trade reporting facilities).
// Pure parser shared by the backfill script and the scheduled setups job. Browser/Worker safe.

export const FINRA_SHORT_URL = (ymd: string) => `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ymd.replace(/-/g, "")}.txt`;

export interface ShortVolumeRow {
  symbol: string;
  date: string;
  short_vol: number;
  exempt_vol: number;
  total_vol: number;
}

/** FINRA writes share classes with a slash (BRK/B); the app uses a dash (BRK-B). */
export const finraToTicker = (s: string) => s.replace("/", "-");

/** Parse one daily file, keeping only `keep` tickers (app form). Rows with no volume are dropped. */
export function parseShortVolume(text: string, keep?: Set<string>): ShortVolumeRow[] {
  const out: ShortVolumeRow[] = [];
  for (const line of text.split("\n")) {
    const p = line.trim().split("|");
    if (p.length < 5 || !/^\d{8}$/.test(p[0])) continue;
    const symbol = finraToTicker(p[1]);
    if (keep && !keep.has(symbol)) continue;
    const short = Number(p[2]), exempt = Number(p[3]), total = Number(p[4]);
    if (!(total > 0) || !Number.isFinite(short)) continue;
    out.push({
      symbol,
      date: `${p[0].slice(0, 4)}-${p[0].slice(4, 6)}-${p[0].slice(6, 8)}`,
      short_vol: Math.round(short),
      exempt_vol: Math.round(exempt || 0),
      total_vol: Math.round(total),
    });
  }
  return out;
}
