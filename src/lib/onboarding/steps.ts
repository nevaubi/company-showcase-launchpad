export type TourStep = { title: string; body: string; target?: string; path?: string };

/** Targets are CSS selectors; a missing target falls back to a centered card. */
export const TOUR_STEPS: TourStep[] = [
  { title: "Search everything", body: "Press ⌘K (or /) to jump to any of ~1,844 covered companies, pages or filings.", target: "[data-tour='search']", path: "/app" },
  { title: "Your watchlist", body: "We started you with NVIDIA, Microsoft and Costco. Add or remove companies any time.", target: "[data-tour='watchlist']", path: "/app" },
  { title: "Every number has a source", body: "Click any figure in a statement to open the SEC filing with that exact value highlighted.", target: "table button.num", path: "/app/companies/NVDA/financials" },
  { title: "Investor-relations KPIs", body: "Segment and KPI data read from earnings releases, decks and supplements — each cell cites its document.", target: "[data-tour='tab-IR data']", path: "/app/companies/NVDA/financials" },
  { title: "Your research assistant", body: "Press ⌘J to ask anything. It cites filings, opens pages and points at the numbers for you. Ask it “show me around” any time.", target: "[data-tour='assistant']" },
  { title: "Office Studio", body: "Word, Excel, PowerPoint and PDF editors where OfficeAI builds cited memos, models and decks. Your starter model is waiting there.", target: "[data-tour='hub-library']" },
];
