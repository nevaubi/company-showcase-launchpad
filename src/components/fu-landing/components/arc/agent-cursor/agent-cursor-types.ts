import type { ReactNode } from "react";

export type DocBlockType = "title" | "heading" | "paragraph";

/** One block of the document. Ids must be unique and stable. */
export interface DocBlock {
  id: string;
  type: DocBlockType;
  text: string;
}

/**
 * One change the agent makes. Edits play in order.
 * - rewrite: selects a block and streams in replacement text.
 * - insert: adds a new block after another one.
 * - fix: replaces the first match of `find` inside a block (flagged with a wavy underline until fixed).
 */
export type AgentEdit =
  | { type: "rewrite"; blockId: string; text: string; label?: string }
  | { type: "insert"; afterBlockId: string; block: DocBlock; label?: string }
  | { type: "fix"; blockId: string; find: string; text: string; label?: string };

export interface AgentIdentity {
  /** Shown in the cursor tag and status line. */
  name: string;
  /** A 24 × 24 mark drawn with currentColor. Defaults to the Claude mark. */
  mark?: ReactNode;
  /** Cursor, selection and change tint color. Defaults to Claude's brand clay. */
  color?: string;
}

export interface Collaborator {
  name: string;
  /** Portrait URL. Falls back to initials. */
  avatar?: string;
  /** Cursor color. Defaults to var(--series-2). */
  color?: string;
}

export type AgentCursorPhase = "idle" | "thinking" | "editing" | "review" | "accepted" | "reverted" | "stopped" | "empty" | "error";
