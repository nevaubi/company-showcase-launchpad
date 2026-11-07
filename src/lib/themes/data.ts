// Filing language themes from the Filed Under pipeline (etl/themes.py): how companies' 10-K and 10-Q language on a
// theme changes quarter by quarter. themes/index.json lists the themes with their trend; themes/{id}.json holds the
// quarterly series (universe and by sector), the companies that added or dropped the language with the exact
// sentences, and a basket ranked by disclosed exposure; themes/co/{T}.json is one company's latest status per theme.
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

export interface ThemePoint {
  q: string;
  filers: number;
  mentioning: number;
  share: number | null;
  comparable: number;
  new_language: number;
  new_share: number | null;
  added: number;
  dropped: number;
  sentences: number;
  negated_share: number | null;
  intensity: number | null;
}
export interface ThemeSectorPoint {
  q: string;
  filers: number;
  mentioning: number;
  share: number | null;
  new_share: number | null;
}
export interface ThemeExcerpt {
  text: string;
  section: string;
  negated: boolean;
}
export interface ThemeFilingRef {
  form: string;
  filed: string;
  accession: string;
  doc: string | null;
  url: string;
}
export interface ThemeChange extends ThemeFilingRef {
  ticker: string;
  name: string | null;
  sector: string;
  prior: ThemeFilingRef | null;
  excerpts: ThemeExcerpt[];
  sentences?: number;
  sentences_before?: number;
  new_sentences?: number;
}
export interface BasketEvidence {
  type: "revenue share" | "segment" | "customer share" | "counterparties" | "language";
  text: string;
  value?: number;
  quote?: string;
  filed?: string;
  excerpts?: ThemeExcerpt[];
}
export interface BasketRow {
  ticker: string;
  name: string | null;
  sector: string | null;
  disclosed_share: number | null;
  evidence_types: number;
  mentions_latest: number;
  evidence: BasketEvidence[];
}
export interface ThemeDoc {
  id: string;
  name: string;
  description: string;
  generated: string;
  defs: string;
  include: string[];
  exclude: string[];
  boilerplate_sentences: number;
  series: ThemePoint[];
  by_sector: Record<string, ThemeSectorPoint[]>;
  changes: Record<string, { added: ThemeChange[]; dropped: ThemeChange[]; new_language: ThemeChange[] }>;
  basket: BasketRow[];
}
export interface ThemeIndexRow {
  id: string;
  name: string;
  description: string;
  spark: { q: string; share: number | null; new_share: number | null }[];
  latest: ThemePoint | null;
  basket_top: string[];
}
export interface ThemesIndex {
  generated: string;
  engine: number;
  defs: string;
  quarters: string[];
  companies_indexed: number;
  filings_indexed: number;
  method: string;
  notes: string | null;
  themes: ThemeIndexRow[];
}
export interface CompanyThemeEntry extends ThemeFilingRef {
  name: string;
  n: number;
  new: number | null;
  added: boolean;
  dropped: boolean;
  excerpts: ThemeExcerpt[];
}
export interface CompanyThemes {
  ticker: string;
  generated: string;
  themes: Record<string, CompanyThemeEntry>;
}

export const themesIndexQuery = queryOptions({
  queryKey: ["themes-index"],
  queryFn: () => partnerFile<ThemesIndex>("themes/index.json"),
  staleTime: 30 * 60_000,
  retry: 1,
});

export const themeQuery = (id: string) =>
  queryOptions({
    queryKey: ["theme", id],
    queryFn: () => partnerFile<ThemeDoc>(`themes/${id}.json`),
    staleTime: 30 * 60_000,
    retry: 1,
    enabled: /^[a-z0-9_-]{1,40}$/.test(id),
  });

export const companyThemesQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["company-themes", ticker],
    queryFn: () => partnerFile<CompanyThemes>(`themes/co/${ticker}.json`),
    staleTime: 30 * 60_000,
    retry: 0,
  });

/** Section codes from the filing index, as readers know them. */
export const SECTION_LABEL: Record<string, string> = {
  "1": "Business",
  "1A": "Risk factors",
  "1C": "Cybersecurity",
  "7": "MD&A",
  "7A": "Market risk",
  "I-2": "MD&A",
  "I-3": "Market risk",
  "II-1A": "Risk factors",
  full: "Full text",
};

/** "2026Q3" -> "Q3 2026". */
export const fmtQuarter = (q: string) => {
  const m = /^(\d{4})Q([1-4])$/.exec(q);
  return m ? `Q${m[2]} ${m[1]}` : q;
};

/** Points with enough filers to read as a share (thin quarters at the edge of the index are left out). */
export function readable(series: ThemePoint[], minFilers = 50): ThemePoint[] {
  return series.filter((p) => p.filers >= minFilers && p.share != null);
}

/** Change in share (percentage points) between the latest readable quarter and the same quarter a year earlier. */
export function yoyChange(series: ThemePoint[], key: "share" | "new_share" = "share", minFilers = 50): number | null {
  const r = readable(series, minFilers);
  if (!r.length) return null;
  const last = r[r.length - 1];
  const m = /^(\d{4})Q([1-4])$/.exec(last.q);
  if (!m) return null;
  const prior = r.find((p) => p.q === `${Number(m[1]) - 1}Q${m[2]}`);
  const a = last[key];
  const b = prior?.[key];
  return a != null && b != null ? a - b : null;
}

/** Change in `key` between quarter `q` and the same quarter a year earlier, from any list of {q, share, new_share}. */
export function yoyAt<T extends { q: string; share: number | null; new_share: number | null }>(
  points: T[],
  q: string | undefined,
  key: "share" | "new_share" = "share",
): number | null {
  const m = q ? /^(\d{4})Q([1-4])$/.exec(q) : null;
  if (!m) return null;
  const a = points.find((p) => p.q === q)?.[key];
  const b = points.find((p) => p.q === `${Number(m[1]) - 1}Q${m[2]}`)?.[key];
  return a != null && b != null ? a - b : null;
}

/** First words of a sentence, used to find it in the source viewer. */
export const searchKey = (text: string, words = 12) => text.split(/\s+/).slice(0, words).join(" ");

/** Evaluate a user phrase set on a list of sentences (client side, over excerpts already loaded). */
export function compilePhrases(input: string): RegExp[] {
  return input
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((p) => {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, "\\w*");
      return new RegExp(`\\b${esc}\\b`, "i");
    });
}
