// Cross-company KPI matrix: industry groups, canonical KPI families, series matching and
// calendar-quarter normalisation. Pure — shared by scripts/kpi-matrix.ts, the KPI page, the
// assistant tool and tests. Every stored cell keeps its source (partner IR document + printed
// token, or the SEC cell/derivation), so the matrix stays click-to-source.
import type { DerivedPart, SourceRef } from "@/lib/financials/types";
import type { PayloadCell, PayloadDoc } from "@/lib/ir/payload";

// ---------- industry groups ----------
export interface KpiGroup { id: string; label: string; re: RegExp }
/** First match wins, so narrower patterns come first. */
export const KPI_GROUPS: KpiGroup[] = [
  { id: "banks", label: "Banks", re: /^(diversified |regional )?banks$/i },
  { id: "brokers", label: "Capital markets & asset managers", re: /capital markets|investment banking|brokerage|asset management|financial exchanges/i },
  { id: "managed-care", label: "Managed care & providers", re: /managed health care|health care providers/i },
  { id: "insurance", label: "Insurance", re: /insurance/i },
  { id: "payments", label: "Payments & consumer finance", re: /transaction & payment|financial services|consumer finance/i },
  { id: "reits", label: "REITs & real estate", re: /reit|real estate/i },
  { id: "software", label: "Software & IT services", re: /software|it services|it consulting/i },
  { id: "semis", label: "Semiconductors", re: /semiconductor/i },
  { id: "hardware", label: "Hardware & electronics", re: /technology hardware|communications equipment|electronic equipment/i },
  { id: "internet-media", label: "Internet, media & entertainment", re: /interactive media|media|entertainment|movies/i },
  { id: "telecom", label: "Telecom & cable", re: /telecom|cable/i },
  { id: "restaurants-leisure", label: "Restaurants, hotels & leisure", re: /restaurants|hotels|leisure|cruise/i },
  { id: "retail", label: "Retail", re: /retail/i },
  { id: "consumer-products", label: "Consumer products", re: /food|beverage|soft drinks|household|personal products|tobacco|textiles|apparel|footwear/i },
  { id: "autos", label: "Autos", re: /automobile/i },
  { id: "aerospace", label: "Aerospace & defense", re: /aerospace/i },
  { id: "transportation", label: "Transportation", re: /transportation|rail|air freight|airlines|logistics/i },
  { id: "industrials", label: "Industrials", re: /machinery|electrical equipment|building products|construction & engineering|conglomerates|trading companies|commercial & professional|construction machinery|agricultural/i },
  { id: "energy", label: "Oil & gas producers", re: /exploration|integrated oil/i },
  { id: "energy-midstream", label: "Midstream & energy services", re: /midstream|energy equipment|oil & gas equipment|refining/i },
  { id: "utilities", label: "Utilities", re: /utilities/i },
  { id: "pharma", label: "Pharma & biotech", re: /pharmaceutical|biotech/i },
  { id: "medtech", label: "Medtech & life sciences", re: /health care equipment|life sciences|health care technology|health care supplies/i },
  { id: "materials", label: "Materials", re: /chemical|industrial gases|metals|mining|copper|construction materials|containers|packaging|paper/i },
];
export const OTHER_GROUP: KpiGroup = { id: "other", label: "Other", re: /.^/ };

export function groupOf(industry: string | null | undefined, sector?: string | null): KpiGroup {
  const i = industry ?? "";
  return KPI_GROUPS.find((g) => g.re.test(i)) ?? KPI_GROUPS.find((g) => g.re.test(sector ?? "")) ?? OTHER_GROUP;
}

// ---------- units ----------
/** pct = fraction (SEC ratios); pct100 = percent points as printed (0–100); the rest are levels. */
export type KpiUnit = "pct" | "pct100" | "usd" | "usdPerShare" | "count" | "bpd" | "boepd" | "cfpd" | "gwh" | "ratio" | "days";
export const isPct = (u: KpiUnit) => u === "pct" || u === "pct100";

/** Partner units that a family accepts, mapped to our unit. */
const PARTNER_UNIT: Record<string, KpiUnit> = {
  "%": "pct100", USD: "usd", USD_per_share: "usdPerShare", USD_per_unit: "usdPerShare", count: "count", units: "count", shares: "count",
  "bbl/d": "bpd", "boe/d": "boepd", "cf/d": "cfpd", "Mcf/d": "cfpd", GWh: "gwh",
};
export const partnerUnit = (u: string | null): KpiUnit | null => (u ? PARTNER_UNIT[u] ?? null : null);

// ---------- KPI families ----------
export interface KpiFamily {
  id: string;
  label: string;
  /** groups the family is offered in; "all" = every group */
  groups: string[] | "all";
  unit: KpiUnit;
  /** matched against the cleaned series name */
  re: RegExp;
  not?: RegExp;
  /** bonus when the name also matches (the consolidated / binding version) */
  prefer?: RegExp;
  /** plausible value range in the family's unit; values outside are dropped */
  range?: [number, number];
  better?: "high" | "low";
  /** how companies' definitions differ — shown with the matrix */
  note: string;
}

const SEG = /:|\bsegment\b/i;
export const KPI_FAMILIES: KpiFamily[] = [
  // universal, company-defined
  { id: "organic-growth", label: "Organic growth", groups: "all", unit: "pct100", re: /^(total )?(company |total company: )?organic (revenue |net sales |sales |net revenue )?(growth|change)$/i, not: /orders|month|contribution|tenant|billings/i, range: [-60, 80], better: "high", note: "Company-defined organic growth (excludes acquisitions, divestitures and usually currency); definitions differ by company." },
  { id: "adj-ebitda-margin", label: "Adjusted EBITDA margin", groups: "all", unit: "pct100", re: /^(total |consolidated )?adjusted ebitda margin$/i, range: [-50, 95], better: "high", note: "Company-defined adjusted EBITDA as a share of revenue; add-backs differ by company." },
  { id: "nongaap-eps", label: "Adjusted diluted EPS", groups: "all", unit: "usdPerShare", re: /^(non-gaap|adjusted|core|operating)( diluted)? (eps|earnings per (diluted )?share)( - diluted| \(diluted\))?$|^(non-gaap|adjusted) diluted (eps|earnings per share)$/i, not: /growth|guidance|outlook|before|excluding/i, range: [-100, 400], better: "high", note: "Company-defined non-GAAP diluted EPS; exclusions (amortisation, stock pay, one-offs) differ by company." },
  { id: "nongaap-gross-margin", label: "Non-GAAP gross margin", groups: ["semis", "software", "hardware", "medtech", "pharma", "internet-media"], unit: "pct100", re: /^(non-gaap|adjusted) gross margin( percentage)?$/i, range: [0, 100], better: "high", note: "Company-defined non-GAAP gross margin." },
  { id: "nongaap-op-margin", label: "Non-GAAP operating margin", groups: ["semis", "software", "hardware", "medtech", "pharma", "internet-media", "industrials", "aerospace", "consumer-products"], unit: "pct100", re: /^(non-gaap|adjusted|segment) operating (income )?margin( percentage)?$/i, range: [-80, 90], better: "high", note: "Company-defined non-GAAP operating margin." },
  // banks
  { id: "nim", label: "Net interest margin", groups: ["banks", "payments"], unit: "pct100", re: /^(reported |firmwide )?net interest (margin|yield)( - fte| on a fte basis| fully taxable-equivalent basis|, fully taxable-equivalent basis)?$/i, not: SEG, prefer: /fte|taxable/i, range: [0.3, 15], better: "high", note: "Net interest income ÷ average earning assets; some banks quote it on a fully taxable-equivalent basis." },
  { id: "cet1", label: "CET1 ratio", groups: ["banks", "brokers"], unit: "pct100", re: /^(common equity tier 1|cet1)( capital)? ratio( \((standardized|advanced)( approach)?\))?$/i, not: /fully phased|pro forma|minimum|requirement|basel i\b/i, prefer: /standardized/i, range: [4, 40], better: "high", note: "Common equity tier 1 capital ÷ risk-weighted assets; the standardized-approach ratio is used where both are shown." },
  { id: "efficiency", label: "Efficiency ratio", groups: ["banks", "brokers"], unit: "pct100", re: /^(reported |firm |firmwide )?(efficiency|overhead) ratio$/i, not: SEG, range: [20, 120], better: "low", note: "Non-interest expense ÷ revenue (JPMorgan calls it the overhead ratio); lower is better." },
  { id: "nco-rate", label: "Net charge-off ratio", groups: ["banks", "payments"], unit: "pct100", re: /^(total )?net charge-?offs? (\(recoveries\) )?(\/\s*average loans( and leases)?|ratio|rate)$|^net charge-?off (ratio|rate)$/i, not: SEG, range: [-1, 15], better: "low", note: "Net charge-offs ÷ average loans, annualised." },
  { id: "rotce", label: "Return on tangible common equity", groups: ["banks", "brokers", "payments"], unit: "pct100", re: /^(rotce|return on (average )?tangible common (shareholders'? |stockholders'? )?equity)$/i, range: [-30, 80], better: "high", note: "Net income to common ÷ average tangible common equity, annualised." },
  { id: "avg-loans", label: "Average loans", groups: ["banks"], unit: "usd", re: /^(total )?average (total )?loans( and leases)?( \(firmwide\))?$/i, not: SEG, range: [1e8, 5e13], better: "high", note: "Average loans outstanding in the quarter." },
  { id: "avg-deposits", label: "Average deposits", groups: ["banks"], unit: "usd", re: /^(total )?average (total )?deposits( - total corporation)?$/i, not: SEG, range: [1e8, 5e13], better: "high", note: "Average deposits in the quarter." },
  { id: "tbvps", label: "Tangible book value per share", groups: ["banks", "brokers"], unit: "usdPerShare", re: /^tangible book value per (common )?share$/i, range: [0, 2000], better: "high", note: "Tangible common equity ÷ common shares outstanding at quarter end." },
  // capital markets / asset managers
  { id: "aum", label: "Assets under management", groups: ["brokers", "banks"], unit: "usd", re: /^(total )?(assets under management|aum)( \(aum\))?$/i, not: /flows|fee|yield|change/i, range: [1e9, 5e14], better: "high", note: "Client assets the firm manages at quarter end." },
  { id: "client-assets", label: "Total client assets", groups: ["brokers", "banks"], unit: "usd", re: /^total client (assets|balances)$/i, range: [1e9, 5e14], better: "high", note: "All client assets held, including assets not under management." },
  { id: "net-new-assets", label: "Net new assets", groups: ["brokers"], unit: "usd", re: /^(total )?net new (assets|money)$|^(total )?(long-term )?net (asset )?(in)?flows$/i, not: SEG, range: [-1e13, 1e13], better: "high", note: "Net client asset flows in the quarter; firms define flows differently." },
  { id: "ib-fees", label: "Investment banking fees", groups: ["brokers", "banks"], unit: "usd", re: /^(total )?investment banking (fees|revenues?)$/i, not: SEG, range: [1e6, 5e11], better: "high", note: "Advisory and underwriting fees." },
  // insurance & managed care
  { id: "combined-ratio", label: "Combined ratio", groups: ["insurance"], unit: "pct100", re: /^(total |consolidated |reported |gaap )?combined ratio$/i, not: /underlying|accident year|excluding|ex-|core/i, range: [40, 160], better: "low", note: "Losses plus expenses ÷ earned premiums (property & casualty); below 100% is an underwriting profit." },
  { id: "underlying-combined", label: "Underlying combined ratio", groups: ["insurance"], unit: "pct100", re: /^(underlying|core|accident year,? excluding catastrophes|current accident year) combined ratio/i, range: [40, 160], better: "low", note: "Combined ratio excluding catastrophes and prior-year reserve development; exclusions differ by company." },
  { id: "npw", label: "Net premiums written", groups: ["insurance"], unit: "usd", re: /^(total )?net (premiums|premium) written$/i, not: SEG, range: [1e7, 5e11], better: "high", note: "Premiums written in the quarter, net of reinsurance." },
  { id: "bvps", label: "Book value per share", groups: ["insurance", "brokers", "banks"], unit: "usdPerShare", re: /^book value per (common )?share( of common stock)?$/i, not: /tangible|excluding|ex-/i, range: [0, 5000], better: "high", note: "Common equity ÷ shares outstanding at quarter end." },
  { id: "mcr", label: "Medical care ratio", groups: ["managed-care", "insurance"], unit: "pct100", re: /^(total |consolidated )?(medical (care|cost|loss|benefits?)|benefit expense|health care benefits) ratio( \(mcr\)| \(mlr\)| \(mbr\))?$|^(mcr|mlr|mbr)$/i, not: SEG, range: [50, 110], better: "low", note: "Medical costs ÷ premiums; companies name it medical care, loss or benefit ratio." },
  { id: "members", label: "Medical members", groups: ["managed-care"], unit: "count", re: /^(total )?(medical )?(members|membership|people served)( \(in thousands\))?$/i, not: SEG, range: [1e3, 5e8], better: "high", note: "People covered at quarter end; some companies report in thousands." },
  // payments
  { id: "payments-volume", label: "Payments volume", groups: ["payments"], unit: "usd", re: /^(total |gross )?(payments|payment|purchase|processed|card) volume$|^(total payment volume|tpv|gross dollar volume|gdv)$|^billed business$/i, not: SEG, range: [1e9, 5e14], better: "high", note: "Dollar value of payments on the network or platform; networks and processors define volume differently." },
  { id: "transactions", label: "Processed transactions", groups: ["payments"], unit: "count", re: /^(total )?(processed|switched|payment) transactions$/i, not: SEG, range: [1e6, 1e13], better: "high", note: "Transactions processed in the quarter." },
  { id: "cross-border", label: "Cross-border volume growth", groups: ["payments"], unit: "pct100", re: /^cross-border (volume )?(growth|volume)( \(constant dollars?\))?$/i, range: [-80, 200], better: "high", note: "Year-over-year growth in cross-border volume, usually in constant currency." },
  // software / internet
  { id: "rpo", label: "Remaining performance obligations", groups: ["software", "semis", "hardware", "internet-media"], unit: "usd", re: /^(total )?(remaining performance obligations?|rpo)( \(rpo\))?$/i, not: /current|crpo|growth|within/i, range: [1e7, 2e12], better: "high", note: "Contracted revenue not yet recognised." },
  { id: "crpo", label: "Current RPO", groups: ["software"], unit: "usd", re: /^(current remaining performance obligations?|crpo|current rpo)( \(crpo\))?$/i, not: /growth/i, range: [1e7, 1e12], better: "high", note: "Contracted revenue expected in the next twelve months." },
  { id: "arr", label: "Annual recurring revenue", groups: ["software"], unit: "usd", re: /^(total )?(annual(ized)? recurring revenue|arr)( \(arr\))?$/i, not: /growth|net new/i, range: [1e6, 1e12], better: "high", note: "Company-defined ARR; definitions differ (subscription only, contracted, or run-rate)." },
  { id: "nrr", label: "Net revenue retention", groups: ["software"], unit: "pct100", re: /^(dollar-based )?net (revenue|dollar|expansion) retention( rate)?$/i, range: [60, 200], better: "high", note: "Revenue from last year's customers this year ÷ their revenue last year." },
  { id: "dau", label: "Daily active users", groups: ["internet-media"], unit: "count", re: /^(daily active (users|people)|daus?|daps?|family daily active people)( \(daus?\)| \(dap\))?$/i, range: [1e5, 1e10], better: "high", note: "Average daily active users or people; companies count differently." },
  { id: "paid-members", label: "Paid memberships / subscribers", groups: ["internet-media", "telecom"], unit: "count", re: /^(total |global )?(paid (memberships|members|subscribers|subscriptions)|subscribers)( at end of period)?$/i, not: /net (additions|adds)|growth/i, range: [1e4, 5e9], better: "high", note: "Paying members or subscribers at quarter end." },
  { id: "arpu", label: "ARPU", groups: ["internet-media", "telecom"], unit: "usdPerShare", re: /^(average revenue per (user|member|paying (membership|member))|arpu|arpm|postpaid phone arpu)( \(arpu\))?$/i, not: /metropcs|prepaid|original/i, prefer: /postpaid phone/i, range: [0.1, 500], better: "high", note: "Average monthly (or quarterly) revenue per user or member; periods and user bases differ." },
  // telecom
  { id: "postpaid-phone-adds", label: "Postpaid phone net adds", groups: ["telecom"], unit: "count", re: /^(total )?postpaid phone net (additions|adds)$/i, not: /original|before/i, range: [-1e7, 1e7], better: "high", note: "Net new postpaid phone subscribers in the quarter." },
  { id: "postpaid-phone-churn", label: "Postpaid phone churn", groups: ["telecom"], unit: "pct100", re: /^postpaid phone churn$/i, range: [0, 5], better: "low", note: "Average monthly share of postpaid phone subscribers who leave." },
  { id: "broadband-adds", label: "Broadband net adds", groups: ["telecom"], unit: "count", re: /^(total )?(broadband|internet|fios internet|fiber) net (additions|adds)$/i, not: /5g|fixed wireless|metropcs/i, range: [-1e7, 1e7], better: "high", note: "Net new broadband subscribers in the quarter." },
  // retail / restaurants / leisure
  { id: "comp-sales", label: "Comparable sales", groups: ["retail", "restaurants-leisure", "consumer-products"], unit: "pct100", re: /^(total company |total |global |system-?wide |u\.s\. |consolidated )?(comparable|comp|same[- ]store|same[- ]restaurant) (store |restaurant )?sales( growth| change| % change| increase)?( - total company)?$/i, not: /excl|ex-|adjusted|fuel|digital|e-?commerce|international|domestic|canada|other international|ticket|transaction|traffic/i, prefer: /total|global|system/i, range: [-60, 80], better: "high", note: "Sales growth in stores (or restaurants) open at least a year; whether fuel, currency and e-commerce are included differs." },
  { id: "digital-growth", label: "E-commerce / digital growth", groups: ["retail"], unit: "pct100", re: /^(total |global )?(digital(ly-enabled)?|e-?commerce|online) (comparable )?sales( growth| change)?( \(reported\))?$/i, range: [-60, 300], better: "high", note: "Growth in digitally originated sales; definitions differ." },
  { id: "comp-traffic", label: "Comparable traffic", groups: ["retail", "restaurants-leisure"], unit: "pct100", re: /^comparable (transactions?|traffic|customer transactions)( - total company| change)?$/i, range: [-60, 60], better: "high", note: "Change in comparable-store customer transactions." },
  { id: "comp-ticket", label: "Comparable average ticket", groups: ["retail", "restaurants-leisure"], unit: "pct100", re: /^comparable (average )?ticket( \(reported\))?( - total company| change)?$/i, range: [-60, 60], better: "high", note: "Change in comparable-store average transaction size." },
  { id: "stores", label: "Store / unit count", groups: ["retail", "restaurants-leisure"], unit: "count", re: /^(total )?(number of )?(stores|warehouses|clubs|restaurants|system-?wide restaurants|units|locations)( at (fiscal year|quarter|period) end)?( - total)?$|^warehouses at fiscal year end - total$/i, not: /open(ed|ings)|clos|remodel|net (new|additions)|square/i, range: [1, 1e6], better: "high", note: "Stores, warehouses or restaurants open at quarter end." },
  { id: "revpar", label: "RevPAR", groups: ["restaurants-leisure"], unit: "usdPerShare", re: /^(systemwide |system-wide |comparable systemwide |worldwide )?revpar$/i, range: [1, 2000], better: "high", note: "Revenue per available room." },
  { id: "revpar-growth", label: "RevPAR growth", groups: ["restaurants-leisure"], unit: "pct100", re: /^(systemwide |system-wide |comparable systemwide |worldwide )?revpar (growth|change)$/i, range: [-90, 300], better: "high", note: "Year-over-year RevPAR change, usually comparable hotels in constant currency." },
  { id: "room-nights", label: "Room nights", groups: ["restaurants-leisure"], unit: "count", re: /^(total )?room nights( booked)?$/i, range: [1e5, 1e10], better: "high", note: "Room nights booked in the quarter." },
  { id: "gross-bookings", label: "Gross bookings", groups: ["restaurants-leisure", "internet-media"], unit: "usd", re: /^(total )?gross bookings$/i, not: SEG, range: [1e7, 1e12], better: "high", note: "Total value of bookings made through the platform." },
  // consumer products
  { id: "volume-growth", label: "Volume growth", groups: ["consumer-products", "materials", "industrials"], unit: "pct100", re: /^(total |organic |unit case )?volume( growth| change)?$|^(organic )?volume\/mix$/i, not: SEG, range: [-60, 60], better: "high", note: "Change in units shipped; some companies combine volume and mix." },
  { id: "price-mix", label: "Price / mix", groups: ["consumer-products", "materials"], unit: "pct100", re: /^(price\/mix|price and mix|price|pricing|price realization)( impact| change| contribution)?$/i, not: SEG, range: [-40, 60], note: "Revenue change from price and mix." },
  // autos / aerospace / industrials
  { id: "deliveries", label: "Deliveries", groups: ["autos", "aerospace"], unit: "count", re: /^(total )?(vehicle |aircraft |commercial airplane |airplane )?deliveries$/i, not: SEG, range: [1, 1e8], better: "high", note: "Vehicles or aircraft delivered in the quarter." },
  { id: "backlog", label: "Backlog", groups: ["industrials", "aerospace", "energy-midstream", "hardware", "semis"], unit: "usd", re: /^(total |total consolidated |consolidated )?backlog( backlog)?$/i, not: /funded|unfunded|elimin|month|amortization/i, range: [1e6, 2e12], better: "high", note: "Orders received but not yet delivered; what counts (funded only, options) differs." },
  { id: "orders", label: "Orders", groups: ["industrials", "aerospace"], unit: "usd", re: /^(total )?(orders|bookings|orders received|new orders)$/i, not: SEG, range: [1e6, 1e12], better: "high", note: "New orders booked in the quarter." },
  { id: "book-to-bill", label: "Book-to-bill", groups: ["industrials", "aerospace", "semis", "hardware"], unit: "count", re: /^(total )?book[- ]to[- ]bill( ratio)?$/i, not: SEG, range: [0.2, 5], better: "high", note: "Orders ÷ revenue; above 1 means backlog is growing." },
  // transportation
  { id: "operating-ratio", label: "Operating ratio", groups: ["transportation"], unit: "pct100", re: /^(adjusted )?operating ratio$/i, not: SEG, range: [30, 130], better: "low", note: "Operating expenses ÷ revenue (railroads and truckers); lower is better." },
  { id: "carloads", label: "Carloads / volume", groups: ["transportation"], unit: "count", re: /^(total )?(carloads|revenue units|units|carloadings|average daily (packages|volume)|total average daily packages)$/i, not: SEG, range: [1e3, 1e10], better: "high", note: "Shipments carried in the quarter." },
  // energy
  { id: "production-boe", label: "Total production", groups: ["energy"], unit: "boepd", re: /^(total )?(net )?(production|oil-equivalent production|hydrocarbon production)( available for sale)?( \(mboe\/d\)| \(boe\/d\))?$|^(total )?production \(boe\/d\)$/i, not: SEG, range: [1e3, 2e7], better: "high", note: "Oil-equivalent production per day." },
  { id: "production-liquids", label: "Liquids production", groups: ["energy"], unit: "bpd", re: /^(total |worldwide )?(net )?(liquids|crude oil|oil|crude oil and ngl|crude oil, ngl and bitumen) production(, worldwide)?$/i, not: SEG, range: [1e3, 1e7], better: "high", note: "Oil and natural-gas-liquids production per day." },
  { id: "production-gas", label: "Natural gas production", groups: ["energy"], unit: "cfpd", re: /^(total |worldwide )?(net )?natural gas production( available for sale)?(, worldwide)?$/i, not: SEG, range: [1e6, 1e11], better: "high", note: "Natural gas production per day." },
  { id: "realized-oil", label: "Realized oil price", groups: ["energy"], unit: "usdPerShare", re: /^(average )?(realized )?(crude )?oil (price|realizations?)( realized)?(\s*\(\$\/bbl\))?$|^(average )?realized (crude oil|oil|liquids) price$/i, not: SEG, range: [5, 250], note: "Average realised price per barrel." },
  { id: "refining-throughput", label: "Refinery throughput", groups: ["energy", "energy-midstream"], unit: "bpd", re: /^(total )?refinery (throughput|runs|crude (oil )?(throughput|capacity utilization))$/i, not: SEG, range: [1e3, 1e7], better: "high", note: "Barrels processed per day." },
  // utilities
  { id: "electric-sales", label: "Electric sales (GWh)", groups: ["utilities"], unit: "gwh", re: /^(total )?(retail )?electric(ity)? (sales|deliveries|volumes)( \(gwh\))?$|^total (retail )?(sales|deliveries)$/i, not: SEG, range: [10, 1e7], note: "Electricity delivered to customers." },
  { id: "operating-eps", label: "Operating / adjusted EPS", groups: ["utilities"], unit: "usdPerShare", re: /^(operating|adjusted|ongoing|core) (earnings|eps)( per (diluted )?share)?$/i, range: [-20, 50], better: "high", note: "Utility-defined operating earnings per share." },
  // REITs
  { id: "ffo-ps", label: "FFO per share", groups: ["reits"], unit: "usdPerShare", re: /^(core |normalized |nareit |adjusted )?ffo( as adjusted)?(,)? (per (diluted )?share|diluted - per share|per diluted share( and unit)?)$/i, not: /affo|guidance|payout/i, range: [-5, 100], better: "high", note: "Funds from operations per diluted share; NAREIT, core and normalized definitions differ." },
  { id: "affo-ps", label: "AFFO per share", groups: ["reits"], unit: "usdPerShare", re: /^(affo|adjusted funds from operations)(,)? (per (diluted )?share|diluted - per share|per diluted share)$/i, not: /guidance|payout/i, range: [-5, 100], better: "high", note: "Adjusted FFO per diluted share; adjustments differ by company." },
  { id: "occupancy", label: "Occupancy", groups: ["reits"], unit: "pct100", re: /^(total |portfolio |ending |average |consolidated |same property )?(occupancy|leased (percentage|rate)|percent leased)( %| percentage| rate)?( as of period end)?$/i, not: SEG, range: [30, 100], better: "high", note: "Share of space or units leased or occupied; ending vs average and portfolio scope differ." },
  { id: "ss-noi", label: "Same-store NOI growth", groups: ["reits"], unit: "pct100", re: /^(same[- ](store|property|center|community)|comparable) (cash )?noi (growth|change)$/i, range: [-50, 60], better: "high", note: "Growth in net operating income from properties owned in both periods." },
];

export const familiesFor = (group: string) => KPI_FAMILIES.filter((f) => f.groups === "all" || f.groups.includes(group));

// ---------- series matching ----------
/** Removes table-parsing noise from partner series names (footnote digits, basis suffixes, stray brackets). */
export function cleanName(name: string): string {
  return name
    .replace(/\s*\((?:\d{4}q\d_\d{4}q\d|q\d fy\d{2}-q\d fy\d{2}|fy\d{2}(?:-fy\d{2})?|pre-\d{4}[^)]*|before [^)]*|original[^)]*)\)/gi, "")
    .replace(/\s+-\s+(s|unaudited|s unaudited)$/i, "")
    .replace(/[)\]:/]+\s*$/g, "")
    .replace(/(?<=[a-z%])\d{1,2}$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PartnerDef { ticker: string; kpi_id: string; name: string; category: string | null; unit: string | null; parent_id: string | null }

/** True when the name looks like a dated/basis-split column rather than the live series. */
const BASIS = /\(\d{4}q\d_\d{4}q\d\)|\((q\d )?fy\d{2}\s*-\s*(q\d )?fy\d{2}\)|pre-20\d\d|before q\d|original definition|- (12|3|6|9)\/\d+\/|- (first|second|third|fourth)$|- ly trend|- month/i;

/** Name-only score of a definition for a family (null = not a candidate). Higher is better. */
export function nameScore(fam: KpiFamily, d: PartnerDef): number | null {
  const u = partnerUnit(d.unit);
  if (!u) return null;
  const unitOk = u === fam.unit || (fam.unit === "usdPerShare" && d.unit === "USD_per_unit") || (fam.unit === "count" && (u === "count")) || (fam.unit === "cfpd" && u === "cfpd") || (fam.unit === "bpd" && u === "bpd") || (fam.unit === "boepd" && u === "boepd");
  if (!unitOk) return null;
  const name = cleanName(d.name);
  if (!fam.re.test(name)) return null;
  if (fam.not?.test(name) || fam.not?.test(d.name)) return null;
  let s = 100;
  if (BASIS.test(d.name)) s -= 40;
  if (d.parent_id) s -= 15;
  if (fam.prefer?.test(d.name)) s += 8;
  if (/\b(total|consolidated|firmwide|total company|worldwide|systemwide|global)\b/i.test(d.name)) s += 4;
  s -= Math.min(20, Math.max(0, d.name.length - name.length)); // noise stripped from the name
  return s;
}

/** Calendar quarter a fiscal quarter mostly falls in: the quarter containing its midpoint (end − 45 days). */
export function calendarQuarter(end: string, months = 3): string {
  const d = new Date(`${end}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Math.round((months * 30.4) / 2));
  return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}
export const prevQuarter = (cq: string, n = 1) => {
  let y = Number(cq.slice(0, 4)), q = Number(cq.slice(5));
  for (let i = 0; i < n; i++) { q--; if (q < 1) { q = 4; y--; } }
  return `${y}Q${q}`;
};
export const cqLabel = (cq: string) => `Q${cq.slice(5)} '${cq.slice(2, 4)}`;
export function lastQuarters(latest: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(prevQuarter(latest, i));
  return out;
}

// ---------- stored file ----------
export interface KpiCell {
  v: number;
  /** fiscal period end */
  e: string;
  /** fiscal label, e.g. "Q2 FY27" */
  fl?: string;
  /** partner IR document index into file.docs + printed text */
  d?: number;
  x?: string;
  /** partner-derived value (e.g. Q4 = FY − 9M) */
  f?: PayloadCell["f"];
  /** SEC value */
  src?: SourceRef;
  derived?: { formula: string; parts: DerivedPart[] };
}
export interface KpiSeries { label: string; cells: Record<string, KpiCell> }
export interface KpiMetricMeta {
  id: string;
  label: string;
  unit: KpiUnit;
  source: "ir" | "sec";
  better?: "high" | "low";
  note: string;
  /** companies with at least one value */
  n: number;
}
export interface KpiGroupFile {
  v: 1;
  group: string;
  label: string;
  builtAt: string;
  quarters: string[];
  companies: { ticker: string; name: string; industry: string }[];
  docs: PayloadDoc[];
  metrics: KpiMetricMeta[];
  series: Record<string, Record<string, KpiSeries>>;
  /** audit: values dropped as implausible for the family, per metric */
  dropped?: Record<string, number>;
}
export interface KpiIndex {
  v: 1;
  builtAt: string;
  groups: { id: string; label: string; companies: number; metrics: { id: string; label: string; n: number; source: "ir" | "sec" }[] }[];
  tickers: Record<string, string>;
}

// ---------- analytics ----------
export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export interface ColumnStat { cq: string; n: number; median: number | null; p25: number | null; p75: number | null }
export function columnStats(file: KpiGroupFile, metric: string, tickers?: string[]): ColumnStat[] {
  const s = file.series[metric] ?? {};
  const list = tickers ?? Object.keys(s);
  return file.quarters.map((cq) => {
    const vals = list.map((t) => s[t]?.cells[cq]?.v).filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    return { cq, n: vals.length, median: quantile(vals, 0.5), p25: quantile(vals, 0.25), p75: quantile(vals, 0.75) };
  });
}

/** Latest quarter that at least half of the companies with recent data have reported. */
export function latestReported(stats: ColumnStat[]): string | null {
  const max = Math.max(0, ...stats.slice(-6).map((s) => s.n));
  for (let i = stats.length - 1; i >= 0; i--) if (stats[i].n > 0 && stats[i].n >= Math.max(1, Math.ceil(max / 2))) return stats[i].cq;
  return null;
}

/** Year-over-year change: percentage points for percent units, relative change otherwise. */
export function yoy(unit: KpiUnit, now: number | undefined, then: number | undefined): number | null {
  if (now == null || then == null) return null;
  if (isPct(unit)) return now - then;
  if (unit === "count" && then === 0) return null;
  if (then <= 0) return null;
  return now / then - 1;
}

export interface Mover { ticker: string; now: number; then: number; change: number }
/** Companies whose metric moved most between a quarter and the same quarter a year earlier. */
export function movers(file: KpiGroupFile, metric: string, cq: string, unit: KpiUnit): Mover[] {
  const s = file.series[metric] ?? {};
  const out: Mover[] = [];
  for (const [t, ser] of Object.entries(s)) {
    const now = ser.cells[cq]?.v, then = ser.cells[prevQuarter(cq, 4)]?.v;
    const c = yoy(unit, now, then);
    if (c != null && now != null && then != null) out.push({ ticker: t, now, then, change: c });
  }
  return out.sort((a, b) => b.change - a.change);
}

/** Percentile rank (0–1) of each company's value in a quarter; better = high → 1 is best. */
export function ranksIn(file: KpiGroupFile, metric: string, cq: string, better?: "high" | "low"): Map<string, number> {
  const s = file.series[metric] ?? {};
  const vals = Object.entries(s).map(([t, x]) => [t, x.cells[cq]?.v] as const).filter((x): x is readonly [string, number] => x[1] != null);
  const sorted = [...vals].sort((a, b) => a[1] - b[1]);
  const out = new Map<string, number>();
  sorted.forEach(([t], i) => {
    const p = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
    out.set(t, better === "low" ? 1 - p : p);
  });
  return out;
}

export function fmtKpi(v: number | null | undefined, unit: KpiUnit, opts: { change?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = opts.change && v > 0 ? "+" : "";
  const abs = Math.abs(v), neg = v < 0 ? "-" : "";
  const big = (x: number) => (x >= 1e12 ? `${(x / 1e12).toFixed(2)}T` : x >= 1e9 ? `${(x / 1e9).toFixed(x >= 1e11 ? 0 : 1)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(x >= 1e8 ? 0 : 1)}M` : x >= 1e4 ? `${(x / 1e3).toFixed(0)}K` : x.toLocaleString("en-US", { maximumFractionDigits: x < 10 ? 2 : 0 }));
  switch (unit) {
    case "pct": return `${sign}${(v * 100).toFixed(1)}%`;
    case "pct100": return `${sign}${v.toFixed(abs < 10 ? 2 : 1)}%`;
    case "usd": return `${sign}${neg}$${big(abs)}`;
    case "usdPerShare": return `${sign}${neg}$${abs.toFixed(2)}`;
    case "bpd": return `${sign}${neg}${big(abs)} bbl/d`;
    case "boepd": return `${sign}${neg}${big(abs)} boe/d`;
    case "cfpd": return `${sign}${neg}${big(abs)} cf/d`;
    case "gwh": return `${sign}${neg}${big(abs)} GWh`;
    case "ratio": return `${sign}${v.toFixed(2)}x`;
    case "days": return `${sign}${v.toFixed(0)} days`;
    default: return `${sign}${neg}${big(abs)}`;
  }
}
/** Change formatting: pp for percent units, % otherwise. */
export function fmtChange(c: number | null, unit: KpiUnit): string {
  if (c == null) return "—";
  const sign = c > 0 ? "+" : "";
  if (unit === "pct") return `${sign}${(c * 100).toFixed(1)} pp`;
  if (unit === "pct100") return `${sign}${c.toFixed(Math.abs(c) < 10 ? 2 : 1)} pp`;
  return `${sign}${(c * 100).toFixed(1)}%`;
}
