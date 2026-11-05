import type { Auction, Point } from "./core";
import { composite, ratioSeries, seriesStats, sumSeries } from "./core";

export type HfSeries = { m: string; name: string; notes: string; unit: string; freq: string; updated: string | null; release: string; url: string; data: Point[] };
export type HfPayload = { updated: string; datasets: Record<string, { name: string; series: HfSeries[] }> };
export type AuctionPayload = { updated: string; source: string; sourceUrl: string; auctions: (Auction & { printedTerm: string })[] };

export const hedgeFundsQuery = { queryKey: ["hedge-funds"], queryFn: async () => (await fetch("/data/hedge-funds.json")).json() as Promise<HfPayload>, staleTime: Infinity };
export const auctionsQuery = { queryKey: ["treasury-auctions"], queryFn: async () => (await fetch("/data/treasury-auctions.json")).json() as Promise<AuctionPayload>, staleTime: Infinity };

export const allSeries = (p: HfPayload) => Object.values(p.datasets).flatMap((d) => d.series);

export interface Gauge { id: string; label: string; why: string; unit: string; data: Point[]; formula?: string; sources: string[]; sign: 1 | -1 }

/** Curated leverage / crowding gauges. sign: +1 when a higher value means more crowding or fragility. */
export function gauges(p: HfPayload): Gauge[] {
  const by = new Map(allSeries(p).map((s) => [s.m, s]));
  const d = (m: string) => by.get(m)?.data ?? [];
  const out: Gauge[] = [
    { id: "gross", label: "Hedge fund gross leverage", why: "Gross assets ÷ net assets across all qualifying hedge funds", unit: "ratio", data: ratioSeries(d("FPF-ALLQHF_GAV_SUM"), d("FPF-ALLQHF_NAV_SUM")), formula: "FPF-ALLQHF_GAV_SUM ÷ FPF-ALLQHF_NAV_SUM", sources: ["FPF-ALLQHF_GAV_SUM", "FPF-ALLQHF_NAV_SUM"], sign: 1 },
    { id: "top10", label: "Top-10 funds leverage", why: "Average leverage of the ten largest hedge funds", unit: "ratio", data: d("FPF-ALLQHF_GAVN10_LEVERAGERATIO_AVERAGE"), sources: ["FPF-ALLQHF_GAVN10_LEVERAGERATIO_AVERAGE"], sign: 1 },
    { id: "borrow", label: "Hedge fund borrowing", why: "Repo + prime brokerage + other secured borrowing", unit: "U.S. dollars", data: sumSeries([d("FPF-BORROW_REPO_SUM"), d("FPF-BORROW_PRIMEBROKER_SUM"), d("FPF-BORROW_OTHERSECURED_SUM")]), formula: "repo + prime brokerage + other secured", sources: ["FPF-BORROW_REPO_SUM", "FPF-BORROW_PRIMEBROKER_SUM", "FPF-BORROW_OTHERSECURED_SUM"], sign: 1 },
    { id: "basis", label: "Treasury basis trade (leveraged funds net short)", why: "Leveraged funds' net Treasury futures position; more negative = bigger cash-futures basis trade", unit: "U.S. dollars", data: d("TFF-LF_TREAS_NET_POSITION"), sources: ["TFF-LF_TREAS_NET_POSITION"], sign: -1 },
    { id: "am", label: "Asset managers long Treasury futures", why: "The other side of the basis trade", unit: "U.S. dollars", data: d("TFF-AI_TREAS_LONG_POSITION"), sources: ["TFF-AI_TREAS_LONG_POSITION"], sign: 1 },
    { id: "repo", label: "Sponsored repo volume", why: "Cleared repo funding, much of it to hedge funds", unit: "U.S. dollars", data: d("FICC-SPONSORED_REPO_VOL"), sources: ["FICC-SPONSORED_REPO_VOL"], sign: 1 },
    { id: "vix", label: "Leveraged funds net VIX futures", why: "Positive = net long volatility (hedged); negative = short vol", unit: "U.S. dollars", data: d("TFF-LF_VIX_NET_POSITION"), sources: ["TFF-LF_VIX_NET_POSITION"], sign: -1 },
    { id: "scoos", label: "Dealers: hedge fund use of leverage", why: "Fed survey, net % of dealers reporting more leverage use", unit: "percent", data: d("SCOOS-NET_HF_LEVERAGEUSE"), sources: ["SCOOS-NET_HF_LEVERAGEUSE"], sign: 1 },
  ];
  return out.filter((g) => g.data.length);
}

export function crowding(gs: Gauge[]) {
  const parts = gs.filter((g) => g.id !== "vix" && g.id !== "scoos").map((g) => ({ id: g.id, z: seriesStats(g.data, g.unit)?.z ?? null, sign: g.sign }));
  return { score: composite(parts), parts };
}
