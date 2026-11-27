// Analyst questions only. These guides contain no issuer facts; measured evidence comes
// from the saved sector aggregates, company filings and source-linked operating KPIs.
type Method = { bridge: string; check: string };

const industries: Record<string, Method> = {
  Banks: {
    bridge:
      "Trace asset repricing and deposit costs through net interest margin and net interest income. Separate average balances from period-end balances, then reconcile provision, net charge-offs and the change in reserves.",
    check:
      "Compare deposit mix, nonperforming loans, tangible book and CET1 with the same business mix. Match the holding company or bank subsidiary and distinguish reported and tax-equivalent yields.",
  },
  Insurance: {
    bridge:
      "For property and casualty, bridge earned premium to underwriting profit through loss and expense ratios. Split catastrophe losses and prior-year reserve development. For life carriers, examine spread income, lapses and capital.",
    check:
      "Compare the same line of business and the same gross, net or statutory basis. Check whether cash claims and reserve development confirm the reported underwriting trend.",
  },
  "Capital Markets": {
    bridge:
      "Separate recurring asset-based fees from performance fees, trading and underwriting. Reconcile opening assets under management with net flows, market movement and acquisitions.",
    check:
      "Compare fee rate and organic flows by product; test whether recovery depends on higher market levels or deal volumes.",
  },
  Software: {
    bridge:
      "Separate new customers, expansion, renewals, currency and acquisitions. Compare contracted backlog or ARR with recognized revenue and cash collection, then reconcile stock compensation and capitalized development.",
    check:
      "Use the issuer's retention and ARR definitions. Look for shortening contract duration, falling renewal rates or longer collection times before extrapolating growth.",
  },
  "Semiconductors & Equipment": {
    bridge:
      "Bridge revenue through shipments, selling price, end-market mix and capacity utilization. Trace inventory at the issuer and customer and distinguish orders, shipments and revenue.",
    check:
      "Test lead times and customer capex against inventory days and realized margins. Name each disclosed supplier or customer before attributing downstream demand.",
  },
  REITs: {
    bridge:
      "Bridge same-property NOI through occupancy, leasing spreads and expenses, then reconcile acquisitions, asset sales, interest expense and share issuance to FFO per share.",
    check:
      "Compare the same property type, lease structure and reporting basis. Check tenant concentrations and debt maturities against operating cash flow and refinancing costs.",
  },
  "Oil & Gas Exploration & Production": {
    bridge:
      "Separate production volume, realized commodity price, differentials and hedges; bridge unit operating costs, sustaining capex and production decline into free cash flow.",
    check:
      "Align oil-equivalent conversions and geography. Stress the realized price or decline rate at which investment stops covering replacement production.",
  },
  "Oil & Gas Midstream": {
    bridge:
      "Split fee-based throughput from commodity exposure. Trace volume commitments, tariff resets and contract expiries to distributable cash flow and expansion spending.",
    check:
      "Reconcile management's distributable cash flow to cash from operations, maintenance spending and financing obligations.",
  },
  Pharmaceuticals: {
    bridge:
      "Separate product volume, net pricing and mix; model concentration and exclusivity expiry one product and geography at a time.",
    check:
      "Distinguish a trial readout, an approval and a commercial launch. Compare the reported patent or exclusivity date with the specific indication and jurisdiction.",
  },
  Biotechnology: {
    bridge:
      "Match the candidate, indication, trial phase, endpoint and expected readout; compare cash and recurring burn to the next funded milestone.",
    check:
      "Separate company guidance from registry dates and measured endpoints. Distinguish trial completion from regulatory approval.",
  },
  "Aerospace & Defense": {
    bridge:
      "Separate funded awards, options and backlog from deliveries and recognized sales. Bridge program mix, contract terms, cost overruns and working capital.",
    check:
      "Check the period and contracting entity. An award ceiling measures potential obligations; use actual obligations to test the demand thesis.",
  },
  "Health Care Providers & Services": {
    bridge:
      "For payers, bridge membership, premium yield, utilization and medical costs. For providers, separate admissions or visits, payer mix, reimbursement rates and labor per case.",
    check:
      "Keep payer and provider economics separate. Check enrollment, rate resets, reserve development and cash conversion against management's explanation.",
  },
};

const sectors: Record<string, Method> = {
  Financials: {
    bridge:
      "Identify the balance-sheet or fee-based activity that earns the spread or fee. Reconcile volume, rates, credit losses, expenses and capital by segment.",
    check:
      "Match the legal entity and regulatory basis. Use peers with the same funding model and risk exposure.",
  },
  Energy: {
    bridge:
      "Separate commodity price exposure, volumes, contract terms, unit cost and sustaining capital by segment.",
    check:
      "Compare realized prices and hedges with relevant regional benchmarks and test whether cash generation survives a lower price.",
  },
  Utilities: {
    bridge:
      "Connect approved rate base, allowed return, recovery lag and load growth to operating earnings, then reconcile capex and funding.",
    check:
      "Check which projects or rates have regulatory approval. Separate weather, fuel pass-through and recurring volume effects.",
  },
  Industrials: {
    bridge:
      "Bridge orders to backlog, shipments and realized revenue. Separate volume, price, mix, input costs and operating leverage.",
    check:
      "Test backlog conversion and free cash flow against inventories, receivables, cancellations and supplier constraints.",
  },
  Materials: {
    bridge:
      "Separate shipments, realized selling prices and feedstock or energy costs by geography and product. Examine capacity utilization and sustaining capex.",
    check:
      "Match benchmarks to the actual product and contractual pricing lag. Check whether inventories and customer orders support the margin change.",
  },
  "Consumer Staples": {
    bridge:
      "Separate organic volume, net price and mix from FX and acquisitions. Trace input costs, promotional spend and distribution to gross margin.",
    check:
      "Check whether cash conversion and volumes support pricing gains, accounting for retailer destocking.",
  },
  "Consumer Discretionary": {
    bridge:
      "Identify the operating unit. Separate traffic or units, price or ticket, mix and capacity additions before explaining revenue and margin.",
    check:
      "Test demand against inventories, promotions and financing conditions. Align comparable-store or unit definitions.",
  },
  "Communication Services": {
    bridge:
      "Split subscribers or audience, monetization per user, advertising yield and content or network costs by segment.",
    check:
      "Match geography and definition of paid users, churn, impressions or pricing. Check recurring cash costs and capex.",
  },
  "Information Technology": {
    bridge:
      "Separate volume, price, product mix and recurring service revenue; reconcile margin and cash flow to investment and customer concentration.",
    check:
      "Match product and revenue recognition before comparing peers. Verify capacity and demand separately.",
  },
  "Real Estate": {
    bridge:
      "Distinguish rent and property operations from fee-based management, brokerage and transactions. Separate price, volume and occupancy.",
    check:
      "Check contract duration, property type and debt maturities. Compare like geography and recurring income.",
  },
  "Health Care": {
    bridge:
      "Separate procedure or product volumes, pricing and reimbursement. Connect product, payer and geography mix to margin and cash realization.",
    check:
      "Match clinical and reimbursement milestones to their dates, indications and source documents.",
  },
};

const general: Method = {
  bridge:
    "Reconcile revenue through volume, price, mix, acquisitions and currency where disclosed. Trace the change through margin, working capital and cash flow.",
  check:
    "Choose peers with comparable economics, periods and definitions. Identify the next reported measure that would challenge the explanation.",
};

export function industryMethod(sector: string, group?: string, industry?: string): string {
  const method =
    industries[group ?? ""] ?? industries[industry ?? ""] ?? sectors[sector] ?? general;
  return [method.bridge, method.check].join(" ");
}
