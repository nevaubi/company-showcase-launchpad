export type AgentPlanStatus = "draft" | "running" | "paused" | "done";

/** Where one step stands. Steps without a state are pending. */
export type AgentPlanStepState = "pending" | "active" | "done" | "failed" | "skipped";

export interface AgentPlanStep {
  /** Stable id, used for keys, reordering and callbacks. */
  id: string;
  /** What the agent will do, written as an instruction. */
  title: string;
  /** Defaults to "pending". */
  state?: AgentPlanStepState;
  /** Short activity lines shown under the active step, such as "Read 4 files" or "Ran 12 tests". The first word picks the icon. */
  substeps?: string[];
  /** A short attribution under the title, such as "Added by agent". */
  note?: string;
  /** Why a failed step failed. Shown with Retry and Skip. */
  error?: string;
  /** Seconds the step took, shown when it is done and summed for the total time. */
  duration?: number;
}

export interface AgentPlanStepAction {
  type: "retry" | "skip";
  step: AgentPlanStep;
}

export const sampleGoal = "Add rate limiting to the public API";

export const sampleSteps: AgentPlanStep[] = [
  { id: "map", title: "Map the public routes under api/v1" },
  { id: "limiter", title: "Add a sliding window limiter to the API middleware" },
  { id: "store", title: "Keep request counters in Redis with a 60 second TTL" },
  { id: "headers", title: "Return 429 with Retry-After and RateLimit headers" },
  { id: "tests", title: "Write tests for limits, bursts and window resets" },
  { id: "docs", title: "Document the limits in the API reference" },
];

/** What the simulated agent does on a step: the activity it reports, how long it took, and an optional failure or inserted step. */
export interface StepScript {
  substeps: string[];
  duration: number;
  /** Fails the first attempt after its substeps; a retry runs `retry` instead and passes. */
  fail?: { error: string; retry: string[] };
  /** Inserts a step right after this one once `after` substeps have shown. */
  insert?: { after: number; step: AgentPlanStep };
}

export const sampleScripts: Record<string, StepScript> = {
  map: { substeps: ["Read 4 files", "Searched for router.get and router.post", "Found 23 public routes"], duration: 21 },
  limiter: { substeps: ["Read middleware/index.ts", "Created middleware/rate-limit.ts", "Edited 2 files"], duration: 48 },
  store: {
    substeps: ["Read lib/redis.ts", "Edited middleware/rate-limit.ts", "Ran 6 tests"],
    duration: 37,
    insert: { after: 2, step: { id: "fallback", title: "Fall back to in-memory counters when Redis is down", note: "Added by agent" } },
  },
  fallback: { substeps: ["Edited lib/redis.ts", "Ran 8 tests"], duration: 29 },
  headers: { substeps: ["Edited middleware/rate-limit.ts", "Ran 4 tests"], duration: 24 },
  tests: {
    substeps: ["Created rate-limit.test.ts", "Ran 12 tests"],
    duration: 63,
    fail: { error: "2 of 12 tests failed: the window resets one second late", retry: ["Edited middleware/rate-limit.ts", "Ran 12 tests, all passed"] },
  },
  docs: { substeps: ["Read docs/api/overview.md", "Edited docs/api/rate-limits.md"], duration: 19 },
  overrides: { substeps: ["Read lib/plans.ts", "Edited middleware/rate-limit.ts", "Ran 5 tests"], duration: 34 },
  metrics: { substeps: ["Read lib/metrics.ts", "Edited middleware/rate-limit.ts"], duration: 22 },
  load: { substeps: ["Ran k6 against staging for 60 seconds", "Measured 41 ms p99 at 2,000 requests per second"], duration: 71 },
};

/** Activity for steps a person added, which have no script of their own. */
export const fallbackScript: StepScript = { substeps: ["Read 3 files", "Edited 2 files", "Ran 6 tests"], duration: 32 };

/** Steps "Keep planning" streams in, one per press. */
export const sampleSuggestions: AgentPlanStep[] = [
  { id: "overrides", title: "Allow higher limits for enterprise API keys" },
  { id: "metrics", title: "Emit a metric for every blocked request" },
  { id: "load", title: "Load test the limiter at 2,000 requests per second" },
];

export const sampleSummary = "Rate limiting is on for all 23 public routes, with an in-memory fallback and 12 passing tests.";
