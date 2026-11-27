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
  { preview: "welcome", path: "/app", title: "Welcome to FiledUnder", body: "US equity research where every number links back to the filing it came from. This tour opens the real pages and clicks through them for you." },
  { preview: "search", path: "/app", area: "Basics", title: "Search everything", body: "Press ⌘K (or /) to jump to any of ~1,844 covered companies, pages or filings.", target: "[data-tour='search']" },
  { preview: "watchlist", path: "/app", area: "Basics", title: "Your watchlist", body: "We started you with NVIDIA, Microsoft and Costco. Add or remove companies any time.", target: "[data-tour='watchlist']" },
  { path: `/app/companies/${T}/financials`, area: "Financials", title: "Statements straight from XBRL", body: "This is NVIDIA's income statement, built from the XBRL tagged in its 10-K and 10-Q filings, annual or quarterly, normalized or as reported. The line above the table says how current it is: a 10-Q or 10-K not yet in the scheduled build is read from the filing when the page opens.", target: "[data-tour='company-body']" },
  { path: `/app/companies/${T}/financials`, area: "Financials", title: "Click any number", body: "Every cell is a button that opens its source. Press Next and we’ll click this one for you.", target: "[data-tour='fin-cell']" },
  { path: `/app/companies/${T}/financials`, area: "Click-to-source", title: "…and the filing opens", body: "The source panel shows the exact filing, XBRL concept and period, with the value highlighted inside the original document. Calculated figures list every part.", click: "[data-tour='fin-cell']", target: "[data-tour='source-panel'][aria-hidden='false']" },
  { path: `/app/companies/${T}/ir`, area: "IR KPIs", title: "Statements and KPIs from IR documents", body: "Earnings releases, decks and supplements are read table by table and shown as the company prints them, each table over its whole history. Where a second reader also reads a page, figures the two date differently are dropped.", target: "[data-tour='ir-breakdowns']" },
  { preview: "ir", path: `/app/companies/${T}/ir`, area: "IR KPIs", title: "Each KPI cites its cell", body: "Click a KPI and the stored release opens on the exact table cell or sentence it came from. Totals are checked against their parts, and figures the 10-Q or 10-K also reports are checked against it when the page opens; an amber mark shows a failed check." },
  { preview: "valuation", path: `/app/companies/${T}/valuation`, area: "Valuation", title: "Point-in-time valuation", body: "Multiples over time use only what had been filed by each date, with no look-ahead and peers alongside.", target: "[data-tour='company-body']" },
  { preview: "redline", path: `/app/companies/${T}/redline`, area: "Filing redlines", title: "What changed in the filing", body: "Consecutive 10-Ks or 10-Qs compared word by word. The verdict comes first: how much of the filing changed and which sections drive it, then each change ranked by materiality.", target: "[data-tour='company-body']" },
  { preview: "supply", path: `/app/supply-chain?t=${T}`, area: "Supply chain", title: "Supply-chain map", body: "Customers, suppliers, partners and competitors named in each company's filings, with stated revenue, purchase and contract figures, concentration and single-source flags. This strip counts the named counterparties, the stated exposure (or estimated, from a stated share × SEC revenue), shares of 10% or more, the company's own single-source inputs, hotspot regions and how recent the filings are. A figure or flag appears only when the quoted sentence states it, and every link opens that sentence.", target: "[data-tour='supply-stats']" },
  { path: `/app/supply-chain?t=${T}`, area: "Supply chain", title: "Three ways to read the links", body: "Network shows what flows in and out, sized by stated revenue, purchase or contract figures or shares; guarantees and investments are labelled, never drawn as flows. Globe shows where each name is based and which countries the sentences name. Chain follows the links further up and downstream, and a click on a link isolates that pathway. You can also isolate one side or one name; the rest dims. The address preserves the view and what is isolated. Below the map, Issuer disclosures lets you compare dated project inputs and follow the source for each delivery step.", target: "[data-tour='supply-views']" },
  { path: `/app/supply-chain?t=${T}`, area: "Supply chain", title: "Simulate a shock", body: "We've opened the Shock tab: pick a company and the size of the drop in its demand or output, and see who is exposed two steps out. Suppliers' losses are sized by the revenue share they disclose. A shock to one country is in the Regions section below.", click: "[data-tour='supply-shock']", done: "[data-tour='supply-shock'][data-state='active']", target: "#supply-analysis" },
  { preview: "thesis", path: "/app/theses", area: "Theses", title: "Write down your thesis", body: "State why you own or short something and what would prove you wrong. Prices, new filings and an AI reviewer keep checking it against the evidence.", target: "[data-tour='thesis-new']" },
  { preview: "assistant", area: "Assistant", title: "Your research assistant", body: "Press ⌘J to ask anything. It reads filings, cites them, opens pages and points at the numbers. Ask it “show me around” any time.", target: "[data-tour='assistant']" },
  { preview: "office", area: "Office Studio", title: "Office Studio", body: "Word, Excel, PowerPoint and PDF editors where OfficeAI builds cited memos, models and decks. Open Research in the sidebar, then the Office Studio tab. Your starter model is waiting there.", target: "[data-tour='hub-research']" },
  { preview: "finish", title: "You're set", body: "Press ? any time for shortcuts, or reopen this tour from the help menu." },
];
