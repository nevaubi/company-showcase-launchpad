// Pure rules for cloud browser runs (shared by the server fn and tests).
export const DAILY_RUN_CAP = 40;
export const MAX_PARALLEL = 4;
export type BrowserMode = "fast" | "thorough";

/** How many of `asked` runs may start given today's count. */
export function allowedRuns(asked: number, usedToday: number) {
  return Math.max(0, Math.min(asked, MAX_PARALLEL, DAILY_RUN_CAP - usedToday));
}

/** Browser Use run options: US proxy and no recording by default; bu-4.0 for thorough work. */
export function runOptions(mode: BrowserMode = "fast", maxSteps?: number) {
  return {
    model: mode === "thorough" ? "bu-4.0" : "bu-fast",
    maxCostUsd: mode === "thorough" ? 2 : 0.5,
    maxSteps: Math.min(Math.max(maxSteps ?? (mode === "thorough" ? 60 : 25), 5), 100),
    browserSettings: { proxyCountryCode: "us", record: false },
  };
}
