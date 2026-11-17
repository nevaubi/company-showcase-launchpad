// SEC fails-to-deliver data (twice-monthly files from NSCC's CNS system): parsed into one row per
// covered stock per half-month with the total and peak-day fails, valued at the file's prices.
// Pure apart from `unzipText` (Web Streams, available in Workers and Bun).
import type { Row } from "./collect.server";

export interface FtdAgg {
  ticker: string;
  /** e.g. "202610a" */
  period: string;
  first: string;
  last: string;
  days: number;
  shares: number;
  value: number;
  peakShares: number;
  peakValue: number;
  peakDate: string;
}

/** File name for a half-month: a = 1st–15th, b = 16th–end. */
export const ftdFile = (period: string) => `cnsfails${period}.zip`;
export const ftdUrl = (period: string) => `https://www.sec.gov/files/data/fails-deliver-data/${ftdFile(period)}`;

/** Numeric form for job_state cursors: "202610a" ↔ 2026101, "202610b" ↔ 2026102. */
export const periodCode = (period: string) => Number(period.slice(0, 6)) * 10 + (period[6] === "a" ? 1 : 2);
export const codePeriod = (code: number) => `${Math.floor(code / 10)}${code % 10 === 1 ? "a" : "b"}`;

/** The half-month after `period` ("202610a" → "202610b", "202612b" → "202701a"). */
export function nextPeriod(period: string): string {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(4, 6)), h = period[6];
  if (h === "a") return `${period.slice(0, 6)}b`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}${String(nm).padStart(2, "0")}a`;
}

/** The latest half-month that ended at least two weeks ago (the SEC publishes about then). */
export function latestLikelyPeriod(today: Date): string {
  const d = new Date(today.getTime() - 14 * 864e5);
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return d.getUTCDate() > 15 ? `${ym}a` : prevPeriod(`${ym}a`);
}

export function prevPeriod(period: string): string {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(4, 6)), h = period[6];
  if (h === "b") return `${period.slice(0, 6)}a`;
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return `${py}${String(pm).padStart(2, "0")}b`;
}

const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/** Aggregate a CNS fails file ("SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE"). */
export function parseFtd(text: string, period: string, covered: Set<string>): FtdAgg[] {
  const by = new Map<string, FtdAgg>();
  for (const line of text.split(/\r?\n/)) {
    const p = line.split("|");
    if (p.length < 6 || !/^\d{8}$/.test(p[0])) continue;
    const t = p[2].trim().toUpperCase().replace(/\./g, "-");
    if (!covered.has(t)) continue;
    const q = Number(p[3]);
    const px = Number(p[5]);
    if (!Number.isFinite(q) || q <= 0) continue;
    const v = Number.isFinite(px) && px > 0 ? q * px : 0;
    const d = iso(p[0]);
    const a = by.get(t) ?? { ticker: t, period, first: d, last: d, days: 0, shares: 0, value: 0, peakShares: 0, peakValue: 0, peakDate: d };
    a.days++;
    a.shares += q;
    a.value += v;
    if (q > a.peakShares) {
      a.peakShares = q;
      a.peakValue = v;
      a.peakDate = d;
    }
    if (d < a.first) a.first = d;
    if (d > a.last) a.last = d;
    by.set(t, a);
  }
  return [...by.values()];
}

/** Half-month end date for the row ("202610a" → 2026-10-15, "202610b" → 2026-10-31). */
export function periodEnd(period: string): string {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(4, 6));
  if (period[6] === "a") return `${period.slice(0, 4)}-${period.slice(4, 6)}-15`;
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function ftdRows(aggs: FtdAgg[]): Row[] {
  return aggs.map((a) => ({
    uid: `ftd:${a.ticker}:${a.period}`,
    ticker: a.ticker,
    dataset: "settlement",
    kind: "series",
    date: periodEnd(a.period),
    title: "Fails to deliver (value, half-month)",
    value: Math.round(a.value),
    unit: "USD",
    meta: { period: a.period, days: a.days, shares: a.shares, peak_shares: a.peakShares, peak_value: Math.round(a.peakValue), peak_date: a.peakDate, first: a.first, last: a.last },
    source: "SEC fails-to-deliver data",
    source_url: ftdUrl(a.period),
  }));
}

/** First file of a zip archive as text (reads the central directory, so data descriptors are fine). */
export async function unzipText(buf: Uint8Array): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const cd = dv.getUint32(eocd + 16, true);
  if (dv.getUint32(cd, true) !== 0x02014b50) throw new Error("bad zip directory");
  const method = dv.getUint16(cd + 10, true);
  const size = dv.getUint32(cd + 20, true);
  const local = dv.getUint32(cd + 42, true);
  const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
  const data = buf.subarray(start, start + size);
  if (method === 0) return new TextDecoder("latin1").decode(data);
  if (method !== 8) throw new Error(`zip method ${method}`);
  const stream = new Response(data.slice().buffer as ArrayBuffer).body!.pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  return new TextDecoder("latin1").decode(out);
}
