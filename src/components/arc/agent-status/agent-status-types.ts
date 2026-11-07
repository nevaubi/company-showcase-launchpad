import type { ComponentType, ReactNode, SVGProps } from "react";

/** The run as a whole. `stopped` is a run the person ended; it settles back to idle like `done`. */
export type AgentRunStatus = "idle" | "working" | "needs-input" | "paused" | "done" | "failed" | "stopped";

/** One step of a run. `waiting` is a step held for the person's approval; `skipped` was denied or stopped. */
export type AgentStepStatus = "pending" | "active" | "waiting" | "done" | "failed" | "skipped";

/** Any 24px stroke icon, such as a lucide-react icon. */
export type AgentIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

export interface AgentActivity {
  /** What the agent is doing, in the present tense: "Reading 12 files", "Needs your approval to run git push". */
  label: string;
  /** A matching icon, such as FileSearch for reading or FlaskConical for tests. */
  icon?: AgentIcon;
  /** A count that ticks in place without rolling the label, shown as "8 of 12". */
  progress?: { value: number; total: number };
}

export interface AgentStep {
  id: string;
  /** Present tense while active ("Running tests"), past tense once done ("Passed 12 tests"). */
  label: string;
  icon?: AgentIcon;
  status: AgentStepStatus;
  /** Epoch ms the step started. An active or waiting step counts up from here. */
  startedAt?: number;
  /** How long a finished step took, in ms. */
  durationMs?: number;
}

export interface AgentInfo {
  /** The model or agent name, such as "Claude Sonnet 5.5". */
  name: string;
  /** A small brand mark, drawn at 14px. Give mono marks their brand color. */
  mark?: ReactNode;
}
