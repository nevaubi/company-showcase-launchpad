import type { ReactNode } from "react";

/** Built in tools with a real brand mark. `web` draws a globe for web search. */
export type ToolCallToolId = "github" | "linear" | "postgres" | "slack" | "gmail" | "web";
/** Any other tool: a name for screen readers and the group header, and a mark drawn at 16px. */
export type ToolCallCustomTool = { name: string; mark: ReactNode };
export type ToolCallTool = ToolCallToolId | ToolCallCustomTool;

/**
 * - `running`: the call is in flight; the title shimmers and a spinner shows.
 * - `success`: finished; shows a check with the result summary and duration.
 * - `error`: failed; shows the reason under the title and a Retry button.
 * - `approval`: waiting for the person to allow or deny it.
 * - `denied`: the person denied it, so it never ran.
 */
export type ToolCallStatus = "running" | "success" | "error" | "approval" | "denied";

export type ToolCallValue = string | number | boolean | null | ToolCallValue[] | { [key: string]: ToolCallValue };
/** Arguments the model passed, shown as a key and value list. */
export type ToolCallInput = Record<string, ToolCallValue>;

export type ToolCallListItem = {
  /** A short identifier in mono, such as an issue number. */
  lead?: string;
  title: string;
  /** A quiet trailing label, such as a tag or a state. */
  tag?: string;
};

/** What came back. Lists and tables fold after five rows and JSON after ten lines. */
export type ToolCallOutput =
  | { type: "list"; items: ToolCallListItem[] }
  | { type: "table"; columns: string[]; rows: (string | number | boolean | null)[][] }
  | { type: "json"; value: unknown }
  | { type: "text"; text: string };

export interface ToolCallData {
  /** Stable id, used as the React key in a group. */
  id: string;
  tool: ToolCallTool;
  /** The settled verb phrase, such as "Searched issues in arc-ui/web". */
  title: string;
  /** Per status phrasing, such as { running: "Searching issues in arc-ui/web" }. Falls back to `title`. */
  titles?: Partial<Record<ToolCallStatus, string>>;
  status: ToolCallStatus;
  input?: ToolCallInput;
  output?: ToolCallOutput;
  /** Quiet meta before the duration, such as "4 results". Derived from the output when left out. */
  summary?: string;
  /** One line under the title: the error reason, or what allowing the call will do. */
  message?: string;
  durationMs?: number;
}

export type ToolCallRenderOutput = (call: ToolCallData) => ReactNode | undefined;
