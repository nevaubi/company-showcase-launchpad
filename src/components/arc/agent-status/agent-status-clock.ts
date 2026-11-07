import type { AgentRunStatus } from "./agent-status-types";

/**
 * A per-instance clock for the run timer. Paused and failed time is frozen out, so the timer and the active step stop while
 * nothing runs and continue from the same value afterwards instead of jumping. It only ticks while the run is live.
 */
export function createRunClock() {
  let now = Date.now();
  let startedAt: number | undefined;
  let endAt: number | undefined;
  let live = false;
  let timer = 0;
  const frozen: Array<[number, number | undefined]> = [];
  const listeners = new Set<() => void>();

  const open = () => { const last = frozen[frozen.length - 1]; return last && last[1] === undefined ? last : undefined; };
  const read = () => endAt ?? open()?.[0] ?? Date.now();
  const tick = () => {
    const next = read();
    if (next === now) return;
    now = next;
    listeners.forEach(listener => listener());
  };
  const schedule = () => {
    window.clearInterval(timer);
    if (live && listeners.size) timer = window.setInterval(tick, 250);
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      schedule();
      tick();
      return () => { listeners.delete(listener); schedule(); };
    },
    getSnapshot: () => now,
    /** Call from an effect whenever the run's start, status or end changes. */
    sync(run: { startedAt?: number; status: AgentRunStatus; endedAt?: number }) {
      const at = Date.now();
      if (run.startedAt !== startedAt) { startedAt = run.startedAt; frozen.length = 0; endAt = undefined; }
      const hold = run.status === "paused" || run.status === "failed";
      const current = open();
      if (hold && !current) frozen.push([at, undefined]);
      if (!hold && current) current[1] = at;
      const ended = run.status === "done" || run.status === "stopped";
      endAt = ended ? run.endedAt ?? endAt ?? at : undefined;
      live = run.status === "working" || run.status === "needs-input";
      schedule();
      tick();
    },
    /** Running time since `from`, without frozen time, at the clock's current reading. */
    since(from: number | undefined, at: number) {
      if (from === undefined) return 0;
      let held = 0;
      for (const [start, end] of frozen) held += Math.max(0, Math.min(end ?? at, at) - Math.max(start, from));
      return Math.max(0, at - from - held);
    },
  };
}

export type RunClock = ReturnType<typeof createRunClock>;

const pad = (value: number) => String(value).padStart(2, "0");

/** 0:42, 12:05, 1:02:03 */
export function formatClock(ms: number) {
  const total = Math.floor(ms / 1000), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), seconds = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** 14s, 1m 12s, 1h 4m */
export function formatSpan(ms: number) {
  const total = Math.floor(ms / 1000), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** 2.4s under ten seconds, then the span format. */
export function formatStep(ms: number) {
  return ms < 10000 ? `${(Math.floor(ms / 100) / 10).toFixed(1)}s` : formatSpan(ms);
}

/** Spoken form for the live region: "1 minute 12 seconds". */
export function speakSpan(ms: number) {
  const total = Math.floor(ms / 1000), minutes = Math.floor(total / 60), seconds = total % 60;
  const part = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"}`;
  return minutes ? `${part(minutes, "minute")} ${part(seconds, "second")}` : part(seconds, "second");
}
