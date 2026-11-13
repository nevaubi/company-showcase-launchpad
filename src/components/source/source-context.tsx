import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { DerivedPart, SourceRef, Unit } from "@/lib/financials/types";

export interface SourceTarget {
  /** Ticker whose filing list resolves accession numbers to documents */
  ticker: string;
  label: string;
  periodLabel?: string;
  unit: Unit | string;
  value: number;
  /** Public evidence is previewed as metadata/quote, never embedded as untrusted remote HTML. */
  external?: { url: string; quote?: string; date?: string; confidence?: string };
  src?: SourceRef;
  alts?: string[];
  derived?: { formula: string; parts: DerivedPart[] };
  approx?: boolean;
  /** Exact iXBRL element id when known (segment facts) */
  elementId?: string;
  /** A whole document with no specific fact to highlight */
  doc?: { accn: string; doc: string; form?: string; filed?: string; title?: string; search?: string; /** the printed line to find, and the page (1-based) or worksheet of a stored document it is on */ quote?: string; page?: number; sheet?: string; /** stored IR document id */ irDoc?: string; /** filer CIK when the filer is not a covered company (IPO registrants) */ cik?: string };
}

interface SourceCtx {
  target: SourceTarget | null;
  open: (t: SourceTarget) => void;
  close: () => void;
}

const Ctx = createContext<SourceCtx | null>(null);

export function SourceProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<SourceTarget | null>(null);
  const open = useCallback((t: SourceTarget) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);
  const value = useMemo(() => ({ target, open, close }), [target, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSource() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSource must be used inside <SourceProvider>");
  return c;
}

/** Stable key used to mark the active cell in tables */
export const targetKey = (t: Pick<SourceTarget, "src" | "derived" | "label" | "periodLabel"> | null) =>
  t ? `${t.label}|${t.periodLabel ?? ""}` : "";
