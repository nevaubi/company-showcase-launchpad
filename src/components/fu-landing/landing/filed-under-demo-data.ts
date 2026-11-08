/**
 * Demo content for the FiledUnder landing sections. Every figure comes from Bank of America's Supplemental Information
 * (Form 8-K, Exhibit 99.3) for Q3 2026, Q3 2025 and Q3 2024. The agent's timings and token counts in the run timeline
 * are illustrative: they show the shape of a run, not a measured one.
 */
import type { AgentEdit, DocBlock } from "../components/arc/agent-cursor/agent-cursor-types";

export const FILINGS = {
  q3_2026: "https://www.sec.gov/Archives/edgar/data/0000070858/000007085826000481/bac-09302026ex993.htm",
  q3_2025: "https://www.sec.gov/Archives/edgar/data/70858/000007085825000390/bac-09302025ex993.htm",
  q3_2024: "https://www.sec.gov/Archives/edgar/data/70858/000007085824000266/bac-09302024ex993.htm",
};

/* ---------- Agent cursor: the agent drafts an earnings recap with a teammate reading along ---------- */

export const memoBlocks: DocBlock[] = [
  { id: "title", type: "title", text: "Bank of America: 3Q26 earnings recap" },
  { id: "revenue", type: "paragraph", text: "Revenue rose 3.2% from a year ago to $29.96B, led by net interest income of $16.45B, up 8.0%." },
  { id: "expense", type: "paragraph", text: "Expenses were higher this quarter, which hurt earnings." },
  { id: "credit", type: "paragraph", text: "Credit held steady. The net charge-off ratio was 0.44%, and the card charge-off rate improved to 3.22% from 3.46%. Wealth managment client balances reached $5.06T." },
];

export const memoEdits: AgentEdit[] = [
  {
    type: "rewrite", blockId: "expense", label: "Adding the numbers behind the expense line",
    text: "Noninterest expense jumped 13.8% to $19.72B, mostly other general operating costs of $2.33B, up from $912M. The efficiency ratio rose to 65.8% from 59.7%, and net income fell 16.8% to $6.93B.",
  },
  { type: "fix", blockId: "credit", find: "managment", text: "management", label: "Fixing a typo" },
  /* Inserts can only follow blocks that exist before the run, so the paragraph goes in first and the heading lands above it. */
  {
    type: "insert", afterBlockId: "credit", label: "Writing what to watch",
    block: { id: "watch", type: "paragraph", text: "Whether the expense spike repeats in 4Q26, and how a CET1 ratio of 10.9%, down from 11.6% a year ago, shapes buybacks." },
  },
  { type: "insert", afterBlockId: "credit", block: { id: "watch-heading", type: "heading", text: "What to watch" }, label: "Adding a heading" },
];
