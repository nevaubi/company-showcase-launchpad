export type TourPreview =
  | "welcome" | "search" | "watchlist" | "source" | "ir" | "assistant" | "office" | "finish"
  | "supply" | "thesis" | "redline" | "valuation";

/**
 * One tour step. `path` is the page the tour opens first; `click` is clicked (once it renders)
 * before `target` is spotlighted, so the tour can demonstrate an interaction.
 * Steps without a target show a centered card.
 */
export type TourStep = {
  title: string;
  body: string;
  preview?: TourPreview;
  path?: string;
  target?: string;
  click?: string;
  /** Selector present once the demo click has taken effect (defaults to `target`), so Back doesn't re-click. */
  done?: string;
  /** Short label shown above the title, e.g. the feature area. */
  area?: string;
};

const T = "NVDA";

export const TOUR_STEPS: TourStep[] = [
  { preview: "welcome", path: "/app", title: "Welcome to Filed Under", body: "US equity research where every number links back to the filing it came from. This tour opens the real pages and clicks through them for you." },
  { preview: "search", path: "/app", area: "Basics", title: "Search everything", body: "Press ⌘K (or /) to jump to any of ~1,844 covered companies, pages or filings.", target: "[data-tour='search']" },
  { preview: "watchlist", path: "/app", area: "Basics", title: "Your watchlist", body: "We started you with NVIDIA, Microsoft and Costco. Add or remove companies any time.", target: "[data-tour='watchlist']" },
  { path: `/app/companies/${T}/financials`, area: "Financials", title: "Statements straight from XBRL", body: "This is NVIDIA's income statement, built from the XBRL tagged in its 10-K and 10-Q filings. Annual and quarterly, as reported or standardised.", target: "[data-tour='company-body']" },
  { path: `/app/companies/${T}/financials`, area: "Financials", title: "Click any number", body: "Every cell is a button that opens its source. Press Next and we’ll click this one for you.", target: "[data-tour='fin-cell']" },
  { path: `/app/companies/${T}/financials`, area: "Click-to-source", title: "…and the filing opens", body: "The source panel shows the exact filing, XBRL concept and period, with the value highlighted inside the original document. Calculated figures list every part.", click: "[data-tour='fin-cell']", target: "[data-tour='source-panel'][aria-hidden='false']" },
  { path: `/app/companies/${T}/ir`, area: "IR KPIs", title: "Segment & KPI data from IR documents", body: "Earnings releases, decks and supplements are read table by table — segments, units, regions, operating KPIs. Two independent readers must agree on each figure's period.", target: "[data-tour='ir-breakdowns']" },
  { preview: "ir", path: `/app/companies/${T}/ir`, area: "IR KPIs", title: "Each KPI cites its cell", body: "Click a KPI and the stored release opens on the exact table cell or sentence it came from. Totals are checked against their parts and against SEC revenue." },
  { preview: "valuation", path: `/app/companies/${T}/valuation`, area: "Valuation", title: "Point-in-time valuation", body: "Multiples over time use only what had been filed by each date — no look-ahead — with peers alongside.", target: "[data-tour='company-body']" },
  { preview: "redline", path: `/app/companies/${T}/redline`, area: "Filing redlines", title: "What changed in the filing", body: "Word-level redlines between consecutive 10-Ks and 10-Qs, section by section, scored so new risks and dropped language surface first.", target: "[data-tour='company-body']" },
  { preview: "supply", path: `/app/supply-chain?t=${T}`, area: "Supply chain", title: "Supply-chain map", body: "Customers, suppliers, partners and competitors named in each company's filings — with disclosed dollar exposure, concentration and single-source flags. Every link opens the sentence it comes from.", target: "[data-tour='supply-stats']" },
  { path: `/app/supply-chain?t=${T}`, area: "Supply chain", title: "Simulate a shock", body: "We've opened the shock simulator: knock out a supplier or region and see who is exposed, first and second order, sized from stated revenue shares.", click: "[data-tour='supply-shock']", done: "[data-tour='supply-shock'][data-state='active']", target: "#supply-analysis" },
  { preview: "thesis", path: "/app/theses", area: "Theses", title: "Write down your thesis", body: "State why you own or short something and what would prove you wrong. Prices, new filings and an AI reviewer keep checking it against the evidence.", target: "[data-tour='thesis-new']" },
  { preview: "assistant", area: "Assistant", title: "Your research assistant", body: "Press ⌘J to ask anything. It reads filings, cites them, opens pages and points at the numbers. Ask it “show me around” any time.", target: "[data-tour='assistant']" },
  { preview: "office", area: "Office Studio", title: "Office Studio", body: "Word, Excel, PowerPoint and PDF editors where OfficeAI builds cited memos, models and decks. Your starter model is waiting.", target: "[data-tour='hub-library']" },
  { preview: "finish", title: "You're set", body: "Press ? any time for shortcuts, or reopen this tour from the help menu." },
];
