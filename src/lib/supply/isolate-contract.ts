// Isolation contract shared by the supply-chain views (Network, Globe, Chain) and the page that hosts them.
// The page owns the state (and its place in the address); a view only draws it and raises requests.
import type { Relation } from "./core";

/** A request to narrow the picture to one part of it, raised from inside a view. */
export type IsolateRequest =
  /** every counterparty of one kind: "suppliers only", "customers only" */
  | { kind: "relation"; relation: Relation }
  /** one counterparty: its links to the company and, at two hops, what hangs off it */
  | { kind: "node"; key: string }
  /** one pathway, upstream to downstream, as node keys (the company itself may be left out) */
  | { kind: "path"; keys: string[] }
  /** back to the whole picture */
  | { kind: "clear" };

/**
 * Props every supply view takes for isolation. All optional: a view given none of them shows everything.
 * `isolate` holds node keys as used by `GraphNode.key` / `HopNode.key`; the company in focus is always lit
 * and does not need to be in the set.
 */
export interface IsolateProps {
  /** Keys of the counterparties to keep lit. `null` or `undefined` shows everything. */
  isolate?: ReadonlySet<string> | null;
  /** What is isolated, in a few words, for the view's own caption ("Suppliers only", "TSMC to Microsoft"). */
  isolateLabel?: string | null;
  /** Raised when the reader isolates or clears from inside the view. */
  onIsolate?: (request: IsolateRequest) => void;
}
