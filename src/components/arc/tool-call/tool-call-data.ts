import type { ToolCallData } from "./tool-call-types";

/** Sample calls for an agent checking what blocks a web release in October 2026. Repos, people and numbers are sample content. */
export const toolCallSamples = {
  issues: {
    id: "github-issues",
    tool: "github",
    title: "Searched issues in arc-ui/web",
    titles: { running: "Searching issues in arc-ui/web", error: "Could not search issues in arc-ui/web" },
    status: "success",
    input: { repo: "arc-ui/web", query: "is:open label:release-blocker milestone:2.8", sort: "updated" },
    output: {
      type: "list",
      items: [
        { lead: "#1284", title: "Checkout button stays disabled after a coupon is removed", tag: "checkout" },
        { lead: "#1291", title: "Webhook retry posts a second charge after a 504", tag: "billing" },
        { lead: "#1302", title: "Session is lost after SSO sign in on iPad", tag: "auth" },
        { lead: "#1306", title: "Release notes page returns 404 on docs preview", tag: "docs" },
      ],
    },
    durationMs: 1180,
  },
  project: {
    id: "linear-project",
    tool: "linear",
    title: "Read the Web 2.8 release project",
    titles: { running: "Reading the Web 2.8 release project", error: "Could not read the Web 2.8 release project" },
    status: "success",
    input: { project: "Web 2.8 release", team: "WEB", include: ["issues", "milestones"] },
    output: {
      type: "json",
      value: {
        project: "Web 2.8 release",
        lead: "Maya Chen",
        target: "2026-10-23",
        progress: 0.86,
        health: "at risk",
        milestones: [
          { name: "Code freeze", date: "2026-10-20", done: true },
          { name: "Release candidate", date: "2026-10-22", done: false },
        ],
        blocked: [
          { id: "WEB-412", title: "Ship the coupon fix to checkout", assignee: "Daniel Okafor", blockedBy: "arc-ui/web#1284" },
          { id: "WEB-418", title: "Run migration 0047 on production", assignee: "Priya Raman", blockedBy: null },
        ],
        openIssues: 7,
        doneIssues: 43,
      },
    },
    summary: "2 blocked",
    durationMs: 760,
  },
  migrations: {
    id: "postgres-migrations",
    tool: "postgres",
    title: "Queried pending migrations",
    titles: { running: "Querying pending migrations", error: "Could not query pending migrations" },
    status: "success",
    input: { database: "app_production", sql: "select version, name, applied_at from schema_migrations where applied_at is null order by version" },
    output: {
      type: "table",
      columns: ["version", "name", "applied_at"],
      rows: [
        ["0047", "add_coupon_redemptions_index", null],
        ["0048", "backfill_invoice_currency", null],
      ],
    },
    message: "Connection to app_production timed out after 5s",
    durationMs: 420,
  },
  post: {
    id: "slack-post",
    tool: "slack",
    title: "Posted to #release",
    titles: { approval: "Post a summary to #release", denied: "Post a summary to #release", running: "Posting to #release", error: "Could not post to #release" },
    status: "success",
    input: { channel: "#release", text: "2.8 is blocked by #1284 (coupon checkout) and migration 0047, still pending on production. The Oct 23 target holds if both land by Wednesday." },
    output: { type: "text", text: "Sent to #release at 10:42 as Arc agent." },
    summary: "1 message",
    message: "Sends as Arc agent to 48 people in #release",
    durationMs: 610,
  },
} satisfies Record<string, ToolCallData>;

export const toolCallSampleList: ToolCallData[] = [toolCallSamples.issues, toolCallSamples.project, toolCallSamples.migrations, toolCallSamples.post];
