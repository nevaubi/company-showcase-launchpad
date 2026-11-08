import type { AgentEdit, DocBlock } from "./agent-cursor-types";

/** Sample launch brief. Names, dates and numbers are sample content. */
export const sampleBlocks: DocBlock[] = [
  { id: "title", type: "title", text: "Usage-based billing launch" },
  { id: "summary", type: "paragraph", text: "On November 18 every Team workspace moves to usage-based billing: seats plus metered agent runs, invoiced monthly through Stripe." },
  { id: "goals-heading", type: "heading", text: "Goals" },
  {
    id: "goals",
    type: "paragraph",
    text: "So basically the main thing we are trying to do here is make it so customers can actually see what they are going to pay before the invoice shows up, because a lot of people were surprised by their bills last quarter and that turned into a lot of support tickets.",
  },
  { id: "rollout", type: "paragraph", text: "Week one goes to 5% of workpsaces behind the usage_billing flag. We widen to 50% once refund requests stay under 0.4% for seven days, then ship to everyone on December 2." },
];

export const sampleMeta = "Emma Collins · Target Nov 18, 2026";

/** The edits Claude makes in the built in run: a rewrite, a new heading and a typo fix. */
export const sampleEdits: AgentEdit[] = [
  {
    type: "rewrite",
    blockId: "goals",
    label: "Tightening the goals",
    text: "Customers should see what they will pay before the invoice arrives. Surprise bills drove 31% of billing tickets in Q3, so a live usage meter and spend alerts ship on day one.",
  },
  { type: "insert", afterBlockId: "goals", label: "Adding a heading", block: { id: "rollout-heading", type: "heading", text: "Rollout" } },
  { type: "fix", blockId: "rollout", find: "workpsaces", text: "workspaces", label: "Fixing a typo" },
];
