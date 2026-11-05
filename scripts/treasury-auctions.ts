// Pulls every U.S. Treasury note, bond, TIPS and FRN auction result since 2010 from
// Treasury Fiscal Data into public/data/treasury-auctions.json. Values exactly as published.
// Usage: bun scripts/treasury-auctions.ts
import { writeFileSync } from "node:fs";

const BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query";
const FIELDS = "auction_date,security_type,security_term,cusip,high_yield,high_discnt_rate,high_discnt_margin,bid_to_cover_ratio,comp_accepted,indirect_bidder_accepted,direct_bidder_accepted,primary_dealer_accepted,offering_amt,inflation_index_security,floating_rate";
const num = (v: string | null | undefined) => (v == null || v === "null" || v === "" ? null : Number(v));

function tenor(t: string) {
  const y = Number(/(\d+)-Year/.exec(t)?.[1] ?? 0), m = Number(/(\d+)-Month/.exec(t)?.[1] ?? 0);
  return `${Math.round(y + m / 12 + 0.4)}-Year`;
}

const rows: any[] = [];
for (let page = 1; ; page++) {
  const url = `${BASE}?fields=${FIELDS}&filter=auction_date:gte:2010-01-01,security_type:in:(Note,Bond,TIPS Note,TIPS Bond,FRN Note)&sort=-auction_date&page%5Bsize%5D=1000&page%5Bnumber%5D=${page}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const j = await res.json();
  rows.push(...j.data);
  if (page >= j.meta["total-pages"]) break;
}

const auctions = rows
  .filter((r) => num(r.bid_to_cover_ratio) != null)
  .map((r) => {
    const comp = num(r.comp_accepted);
    const share = (v: string) => (comp && num(v) != null ? +((num(v)! / comp) * 100).toFixed(2) : null);
    const tips = r.inflation_index_security === "Yes", frn = r.floating_rate === "Yes";
    return {
      date: r.auction_date,
      type: tips ? "TIPS" : frn ? "FRN" : r.security_type.replace(/^TIPS |^FRN /, ""),
      // Reopenings print the remaining life ("9-Year 10-Month"); group them with the original tenor.
      term: tenor(r.security_term),
      printedTerm: r.security_term,
      cusip: r.cusip,
      rate: frn ? num(r.high_discnt_margin) : num(r.high_yield) ?? num(r.high_discnt_rate),
      btc: num(r.bid_to_cover_ratio),
      indirect: share(r.indirect_bidder_accepted),
      direct: share(r.direct_bidder_accepted),
      dealer: share(r.primary_dealer_accepted),
      amount: num(r.offering_amt) ?? 0,
    };
  });

writeFileSync(
  "public/data/treasury-auctions.json",
  JSON.stringify({ updated: new Date().toISOString(), source: "U.S. Treasury Fiscal Data — Treasury Securities Auctions Data", sourceUrl: "https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/", auctions }),
);
console.log(`${auctions.length} auctions, ${auctions.at(-1)?.date} → ${auctions[0]?.date}`);
