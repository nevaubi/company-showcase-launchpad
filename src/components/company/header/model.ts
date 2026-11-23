// Pure rules behind the company page header and its tabs: what to print, where a tab lands, how tall
// the pinned bar is. No browser or Node APIs, so everything here is unit tested (model.test.ts).
import type { CompanyProfile, Filing } from "@/lib/financials/types";
import type { HqFile } from "@/lib/supply/geo";

/* ---------- tabs ---------- */

export interface CompanySub {
  /** route id, as the router types it */
  to: string;
  label: string;
  /** path segment after the ticker ("" for the Overview) */
  seg: string;
}
export interface CompanyTabGroup {
  label: string;
  subs: CompanySub[];
}

const sub = (seg: string, label: string): CompanySub => ({
  to: seg ? `/app/companies/$ticker/${seg}` : "/app/companies/$ticker",
  label,
  seg,
});

/** The seven groups across the company page and the pages inside each. Labels are part of the assistant's map. */
export const TAB_GROUPS: CompanyTabGroup[] = [
  { label: "Overview", subs: [sub("", "Overview")] },
  { label: "Financials", subs: [sub("financials", "Statements")] },
  { label: "Valuation", subs: [sub("valuation", "Valuation"), sub("estimates", "Estimates & analysts")] },
  { label: "IR data", subs: [sub("ir", "IR data")] },
  { label: "Earnings", subs: [sub("earnings", "Results & promises"), sub("calls", "Earnings calls")] },
  {
    label: "Filings",
    subs: [sub("filings", "Filings & IR"), sub("redline", "Filing changes"), sub("reports", "Reports")],
  },
  { label: "Ownership", subs: [sub("insiders", "Insiders & influence"), sub("alt-data", "Alt data")] },
];

/** Old addresses that now open another page of the same group. */
const SEG_ALIAS: Record<string, string> = { memo: "reports" };

/**
 * The group and page a company address belongs to. Matching is on the path segment after the ticker, so the
 * ticker's letter case in the address does not matter; an unknown segment reads as the Overview.
 */
export function activeTab(pathname: string): { group: CompanyTabGroup; sub: CompanySub } {
  const parts = pathname.replace(/[?#].*$/, "").split("/").filter(Boolean);
  const at = parts.indexOf("companies");
  const raw = at >= 0 ? (parts[at + 2] ?? "") : "";
  const seg = SEG_ALIAS[raw] ?? raw;
  for (const group of TAB_GROUPS) {
    const hit = group.subs.find((s) => s.seg === seg);
    if (hit) return { group, sub: hit };
  }
  return { group: TAB_GROUPS[0], sub: TAB_GROUPS[0].subs[0] };
}

/* ---------- pinned bar geometry (rem) ---------- */

/** Height of the app header the bar sits under (h-14). */
export const APP_HEADER_REM = 3.5;
/** The compact identity row that hangs above the tabs when the bar is too narrow to hold it beside them. */
export const IDENTITY_ROW_REM = 2;
/** The row of group tabs. */
export const TAB_ROW_REM = 2.25;
/** The row of pages inside the active group. */
export const SUB_ROW_REM = 2;

/** Where the tab block sticks: under the app header, leaving room for the identity row when that sits above it. */
export const barTopRem = (wide: boolean) => APP_HEADER_REM + (wide ? 0 : IDENTITY_ROW_REM);

/** `--sticky-top` for everything inside the company page: the bottom edge of the pinned bar. */
export const stickyTopRem = (wide: boolean, hasSubs: boolean) =>
  barTopRem(wide) + TAB_ROW_REM + (hasSubs ? SUB_ROW_REM : 0);

/**
 * Scroll position after a tab change. The tab strip must not move under the pointer: above the pin point
 * the page stays where it was; past it, the new page starts right under the pinned bar.
 */
export const landingScrollY = (before: number, pinY: number) =>
  Math.max(0, Math.min(Math.round(before), Math.round(pinY)));

/** The identity moves into the tab row when this much room is left beside the tabs (px). */
export const WIDE_ROOM_PX = 248;
export const isWide = (barWidth: number, tabsWidth: number) =>
  barWidth > 0 && tabsWidth > 0 && barWidth - tabsWidth >= WIDE_ROOM_PX;

/* ---------- names ---------- */

/** U.S. state and territory codes, as SEC writes them in addresses and name tags. */
const STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  ),
);

/**
 * SEC conformed names end in a state or "/NEW" tag when two registrants share a name ("Dave Inc./DE",
 * "Whirlpool Corp /De/", "Six Flags Entertainment Corporation/NEW"). The tag is filing bookkeeping, not
 * part of the name, so it is dropped for display.
 */
export function cleanCompanyName(name: string | null | undefined): string {
  const s = (name ?? "").replace(/\s+/g, " ").trim();
  const m = /^(.{2,}?)\s*[/\\]\s*([A-Za-z]{2,3})\s*[/\\]?$/.exec(s);
  if (!m) return s;
  const tag = m[2].toUpperCase();
  return tag === "NEW" || STATES.has(tag) ? m[1].trim() : s;
}

const nameKey = (s: string) => cleanCompanyName(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/**
 * True when the registrant's legal name tells the reader something the display name does not
 * ("International Business Machines Corp" for IBM). A legal name that only adds "Inc." or repeats the
 * name in capitals is not worth a place in the header; it stays in the tooltip.
 */
export function legalNameAdds(displayName: string, legalName: string | null | undefined): boolean {
  const a = nameKey(displayName);
  const b = nameKey(legalName ?? "");
  if (!a || !b) return false;
  return !(a.includes(b) || b.includes(a));
}

/** The legal name for inline display: SEC's capitals set in title case, mixed case left as filed. */
export function legalNameLabel(legalName: string): string {
  const s = cleanCompanyName(legalName);
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-.&/(])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

/** "Nasdaq" / "NYSE" as the header prints it, from the SEC profile first and the quote second. */
export function exchangeLabel(profileExchange?: string | null, quoteExchange?: string | null): string | null {
  const raw = (profileExchange || quoteExchange || "").trim();
  if (!raw) return null;
  const k = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (k.startsWith("nasdaq")) return "Nasdaq";
  if (k === "nyse" || k === "nyq" || k === "newyorkstockexchange") return "NYSE";
  if (k === "nysearca") return "NYSE Arca";
  if (k === "nyseamerican" || k === "nysemkt" || k === "amex") return "NYSE American";
  if (k.startsWith("cboe") || k === "bats") return "Cboe";
  if (k === "otc" || k.startsWith("otc")) return "OTC";
  return raw;
}

/* ---------- head office ---------- */

const cityCase = (raw: string) => {
  const s = raw.replace(/\s+/g, " ").trim();
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s\-.'])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c: string) => `Mc${c.toUpperCase()}`);
};

export interface HeadOffice {
  place: string;
  /** where the place comes from, in words, for the tooltip */
  basis: string;
}

const HQ_BASIS: Record<string, string> = {
  s: "SEC business address",
  v: "checked against the filing cover page",
  d: "company directory",
};

/**
 * Head office for the context line. The head-office file (hand-checked cover pages first, then the SEC
 * business address; registered-agent addresses excluded) wins. Until it has loaded, a plain U.S.
 * "City, ST" from the dataset's SEC address is used; a foreign or coded address is not guessed at.
 */
export function headOffice(
  ticker: string,
  hq: Pick<HqFile, "companies"> | null | undefined,
  address: CompanyProfile["address"] | null | undefined,
): HeadOffice | null {
  const row = hq?.companies?.[ticker.toUpperCase()];
  if (Array.isArray(row) && typeof row[2] === "string" && row[2] && row[4] === "c")
    return { place: row[2], basis: HQ_BASIS[row[5]] ?? "head-office file" };
  const city = (address?.city ?? "").trim();
  const state = (address?.state ?? "").trim().toUpperCase();
  if (!city || !STATES.has(state) || /\d/.test(city)) return null;
  return { place: `${cityCase(city)}, ${state}`, basis: "SEC business address" };
}

/* ---------- price ---------- */

export interface QuoteLike {
  price: number;
  previousClose?: number;
  change: number;
  changePct: number;
  high52?: number;
  low52?: number;
  /** ISO time of the last trade (live quote) or the date of the stored close (YYYY-MM-DD) */
  marketTime?: string;
  /** set when the live source failed and this is the last stored daily close */
  snapshot?: boolean;
}

export interface PriceStatus {
  /** intraday: a price from today's session; close: a closing price; stored: the last stored close; quote: no time known */
  kind: "intraday" | "close" | "stored" | "quote";
  label: string;
  /** one sentence on what the price is, for the tooltip */
  title: string;
  /** the price is more than a long weekend old */
  stale: boolean;
}

const ET = "America/New_York";
const etParts = (d: Date) => {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
};
const dayLabel = (ymd: string, nowYmd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(ymd.slice(0, 4) !== nowYmd.slice(0, 4) ? { year: "numeric" } : {}),
  });
const daysBetween = (fromYmd: string, toYmd: string) =>
  Math.round((Date.parse(`${toYmd}T12:00:00Z`) - Date.parse(`${fromYmd}T12:00:00Z`)) / 86_400_000);

/** Days after which a closing price is called out as old (a long weekend is four). */
const STALE_DAYS = 4;
const CLOSE_MINUTES = 16 * 60;

/**
 * What the printed price is. Only what the quote itself states is claimed: a price stamped during
 * today's New York session is "as of" that minute, a price stamped at or after 4 p.m. (or on an earlier
 * day) is a close, a fallback to the stored daily bars says so, and a quote without a time is just delayed.
 */
export function priceStatus(q: Pick<QuoteLike, "marketTime" | "snapshot">, now: Date): PriceStatus {
  const today = etParts(now).ymd;
  if (q.snapshot) {
    const ymd = /^\d{4}-\d{2}-\d{2}/.test(q.marketTime ?? "") ? q.marketTime!.slice(0, 10) : null;
    return {
      kind: "stored",
      label: ymd ? `Last stored close · ${dayLabel(ymd, today)}` : "Last stored close",
      title: "The live quote is unavailable. This is the last daily close in the stored price history.",
      stale: ymd ? daysBetween(ymd, today) > STALE_DAYS : true,
    };
  }
  const t = q.marketTime ? new Date(q.marketTime) : null;
  if (!t || Number.isNaN(t.getTime()))
    return {
      kind: "quote",
      label: "Delayed quote",
      title: "Delayed quote from the market data provider. It refreshes every two minutes.",
      stale: false,
    };
  const at = etParts(t);
  if (at.ymd === today && at.minutes < CLOSE_MINUTES) {
    const clock = t.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
    return {
      kind: "intraday",
      label: `As of ${clock} ET · delayed`,
      title: "Last trade reported by the market data provider, which can lag the exchange. It refreshes every two minutes.",
      stale: false,
    };
  }
  return {
    kind: "close",
    label: `At close · ${dayLabel(at.ymd, today)}`,
    title: "Closing price of the last regular session reported by the market data provider.",
    stale: daysBetween(at.ymd, today) > STALE_DAYS,
  };
}

export interface Range52 {
  low: number;
  high: number;
  /** 0 at the low, 1 at the high */
  position: number;
}

/**
 * The 52-week range with the last price placed in it. A last price outside the quoted range widens it
 * (the price is itself a new extreme), so the marker never sits beyond a printed bound.
 */
export function range52(price: number | null | undefined, low52?: number | null, high52?: number | null): Range52 | null {
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!ok(price) || !ok(low52) || !ok(high52) || high52 < low52) return null;
  const low = Math.min(low52, price);
  const high = Math.max(high52, price);
  if (high <= low) return null;
  return { low, high, position: (price - low) / (high - low) };
}

/** Last price times the share count on the latest cover page. */
export function marketCap(price: number | null | undefined, shares: number | null | undefined): number | null {
  if (price == null || shares == null || !Number.isFinite(price) || !Number.isFinite(shares) || price <= 0 || shares <= 0)
    return null;
  return price * shares;
}

/** Sign of a change for colouring: a change that rounds to zero at two decimals is flat. */
export function changeTone(change: number | null | undefined): "positive" | "negative" | "flat" {
  if (change == null || !Number.isFinite(change) || Math.abs(change) < 0.005) return "flat";
  return change > 0 ? "positive" : "negative";
}

/* ---------- filings ---------- */

const ANNUAL = new Set(["10-K", "20-F", "40-F"]);
const QUARTERLY = new Set(["10-Q"]);
const newest = (list: Filing[]) => list.reduce<Filing | null>((m, f) => (!m || f.filed > m.filed ? f : m), null);

/** The latest annual report (10-K, or 20-F/40-F for a foreign filer) and the latest 10-Q; amendments are skipped. */
export function latestReports(filings: Filing[] | null | undefined): { annual: Filing | null; quarterly: Filing | null } {
  const all = filings ?? [];
  return {
    annual: newest(all.filter((f) => ANNUAL.has(f.form))),
    quarterly: newest(all.filter((f) => QUARTERLY.has(f.form))),
  };
}

export const edgarUrl = (cik: string | number) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(cik).replace(/\D/g, "")}&type=&dateb=&owner=include&count=40`;

/** An investor-relations address worth linking: http(s) only. */
export function irUrl(profile: Pick<CompanyProfile, "investorRelations"> | null | undefined): string | null {
  const u = (profile?.investorRelations ?? "").trim();
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(u) ? u : null;
}
