export type TourPreview = "welcome" | "search" | "watchlist" | "source" | "ir" | "assistant" | "office" | "finish";
export type TourStep = { title: string; body: string; preview: TourPreview; target?: string };

/** Targets are CSS selectors on the dashboard; steps without one show a centered card. The tour never changes page. */
export const TOUR_STEPS: TourStep[] = [
  { preview: "welcome", title: "Welcome to Filed Under", body: "US equity research where every number links back to the SEC filing it came from. A one-minute tour." },
  { preview: "search", title: "Search everything", body: "Press ⌘K (or /) to jump to any of ~1,844 covered companies, pages or filings.", target: "[data-tour='search']" },
  { preview: "watchlist", title: "Your watchlist", body: "We started you with NVIDIA, Microsoft and Costco. Add or remove companies any time.", target: "[data-tour='watchlist']" },
  { preview: "source", title: "Every number has a source", body: "Click any figure in a statement and the SEC filing opens with that exact value highlighted." },
  { preview: "ir", title: "Investor-relations KPIs", body: "Segment and KPI data read from earnings releases, decks and supplements — each cell cites its document." },
  { preview: "assistant", title: "Your research assistant", body: "Press ⌘J to ask anything. It cites filings, opens pages and points at the numbers. Ask it “show me around” any time.", target: "[data-tour='assistant']" },
  { preview: "office", title: "Office Studio", body: "Word, Excel, PowerPoint and PDF editors where OfficeAI builds cited memos, models and decks. Your starter model is waiting.", target: "[data-tour='hub-library']" },
  { preview: "finish", title: "You're set", body: "Press ? any time for shortcuts, or reopen this tour from the help menu." },
];
