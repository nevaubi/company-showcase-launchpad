// Public feature pages (marketing). Copy describes only what the product actually does.
export interface Feature { slug: string; name: string; title: string; summary: string; points: string[]; example?: { ticker: string; label: string } }

export const FEATURES: Feature[] = [
  {
    slug: "click-to-source",
    name: "Click-to-source",
    title: "Every financial figure linked to its SEC filing",
    summary: "Click any number in a statement, chart or AI answer and the original 10-K, 10-Q or 8-K opens with that exact value highlighted.",
    points: [
      "Income statement, balance sheet and cash flow built directly from SEC XBRL data",
      "Each value carries its filing accession, XBRL concept and period",
      "Calculated figures show the formula and the sourced parts behind it",
      "The filing opens beside your work, scrolled to the highlighted fact",
    ],
    example: { ticker: "NVDA", label: "See NVIDIA's sourced financials" },
  },
  {
    slug: "ir-kpis",
    name: "IR KPIs and segments",
    title: "Segment and KPI data from earnings releases, decks and supplements",
    summary: "Investor-relations documents are stored and read table by table, so segment revenue and operating KPIs come with the exact cell they were printed in.",
    points: [
      "Earnings releases, supplements, presentations and SEC exhibits read in full",
      "Segment totals checked against the sum of their parts",
      "Figures read twice; conflicting readings are left out rather than guessed",
      "Each KPI opens the stored document at the cited cell or sentence",
    ],
  },
  {
    slug: "supply-chain",
    name: "Supply-chain map",
    title: "Customer and supplier links quoted from 10-K filings",
    summary: "See who a company depends on and who depends on it. A link is shown only when the sentence stating it is found word for word in the filing.",
    points: [
      "Customers, suppliers and partners named in annual reports",
      "Revenue concentration from XBRL-tagged customer shares",
      "Shock simulator to trace how a disruption spreads through the chain",
      "Every edge opens the filing sentence it came from",
    ],
    example: { ticker: "AAPL", label: "See Apple's sourced financials" },
  },
  {
    slug: "research-assistant",
    name: "Research assistant",
    title: "An AI research assistant that cites the filing",
    summary: "Ask questions across the covered universe. Answers cite the filing passage, statement line or web page they rely on, and figures without a source are not shown.",
    points: [
      "Reads filings, transcripts, IR documents and the web",
      "Builds tables, charts and notes you can open in Office Studio",
      "Cloud browsers for sites that need clicking through",
      "Every claim links back to its source",
    ],
  },
  {
    slug: "office-studio",
    name: "Office Studio",
    title: "AI-built documents, models and decks with sourced numbers",
    summary: "Writer, Sheets, Slides and PDF editors with an AI panel that drafts and edits for you, using figures pulled from SEC filings.",
    points: [
      "Word, Excel, PowerPoint and PDF import and export",
      "Spreadsheet formulas that pull SEC-sourced values",
      "The assistant writes, formats, charts and builds slides on request",
      "Notes and models keep their citations",
    ],
  },
];

export const featureBySlug = (slug: string) => FEATURES.find((f) => f.slug === slug);
