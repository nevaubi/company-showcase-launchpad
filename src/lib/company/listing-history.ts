import { coverageOf } from "@/lib/coverage";

interface ListingClosure {
  cik: string;
  effective: string;
  description: string;
  source: string;
}

// First session in which the old security or exchange symbol no longer traded.
// Match the original registrant so future reuse of a ticker does not inherit its predecessor's history.
const closures: Record<string, ListingClosure> = {
  BKH: { cik: "1130464", effective: "2026-11-16", description: "Bright Horizon Energy began trading as HZN after the NorthWestern merger.", source: "https://www.sec.gov/Archives/edgar/data/1130464/000110465926127601/tm2629827d1_8k.htm" },
  NWE: { cik: "1993004", effective: "2026-11-16", description: "NorthWestern shares ceased trading after the Bright Horizon Energy merger.", source: "https://www.sec.gov/Archives/edgar/data/1993004/000199300426000072/nwe-20261113.htm" },
  ITGR: { cik: "1114483", effective: "2026-11-17", description: "Integer Holdings went private following its acquisition by a KKR affiliate.", source: "https://www.sec.gov/Archives/edgar/data/1114483/000095010326017597/dp256691_ex9902.htm" },
  KVUE: { cik: "1944048", effective: "2026-11-02", description: "Kenvue shares ceased trading after the Kimberly-Clark acquisition.", source: "https://www.sec.gov/Archives/edgar/data/876661/000087666126000879/ruleprovisionnotice.htm" },
  ROKU: { cik: "1428439", effective: "2026-11-09", description: "Roku shares ceased trading after the acquisition by Fox Corporation.", source: "https://www.sec.gov/Archives/edgar/data/1428439/000119312526451874/d181620d8k.htm" },
};

export function listingClosure(symbol: string, on = new Date().toISOString().slice(0, 10)) {
  const ticker = symbol.toUpperCase();
  const entry = closures[ticker];
  return entry && on >= entry.effective && coverageOf(ticker)?.cik === entry.cik ? entry : undefined;
}
