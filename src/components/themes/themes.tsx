import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, Search } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { MultiLine } from "@/components/charts/multi-line";
import { Sparkline } from "@/components/charts/sparkline";
import { useSource } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import LoadingState from "@/components/ui/loading-state";
import { searchFilings } from "@/lib/sec.functions";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  fmtQuarter,
  readable,
  searchKey,
  SECTION_LABEL,
  yoyAt,
  yoyChange,
  type BasketRow,
  type ThemeChange,
  type ThemeDoc,
  type ThemeExcerpt,
  type ThemesIndex,
} from "@/lib/themes/data";

const th = "px-3 py-1.5 text-left text-[11px] font-medium whitespace-nowrap text-muted-foreground";
const td = "px-3 py-1.5 align-top";
const TABLE =
  "w-full min-w-[680px] text-[12px] [&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-[1] [&_tr>*:first-child]:bg-background";

const pct = (v: number | null | undefined, d = 0) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
const pp = (v: number | null | undefined) =>
  v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)} pp`;
const toneOf = (v: number | null | undefined) =>
  v == null || Math.abs(v) < 0.005 ? "text-muted-foreground" : v > 0 ? "text-chart-1" : "text-chart-4";

// ---------------------------------------------------------------- index
export function ThemeIndexTable({ idx, onPick }: { idx: ThemesIndex; onPick: (id: string) => void }) {
  return (
    <Panel
      title="Themes in filing language"
      subtitle={`${idx.companies_indexed.toLocaleString()} companies · ${idx.filings_indexed.toLocaleString()} 10-K and 10-Q filings indexed · share of filers whose risk factors, MD&A or business section carries the language, by filing quarter`}
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr className="border-b">
              <th className={th}>Theme</th>
              <th className={th}>Share of filers, by quarter</th>
              <th className={cn(th, "text-right")} title="Share of companies filing a 10-K or 10-Q in the quarter whose filing carries the language">
                Latest share
              </th>
              <th className={cn(th, "text-right")} title="Change from the same quarter a year earlier">
                vs a year ago
              </th>
              <th className={cn(th, "text-right")} title="Share of companies with a like-for-like prior filing that wrote new sentences on the theme">
                New language
              </th>
              <th className={cn(th, "text-right")}>Added / dropped</th>
              <th className={th}>Most exposed (disclosed)</th>
            </tr>
          </thead>
          <tbody>
            {idx.themes.map((t) => {
              const spark = t.spark.filter((s) => s.share != null).map((s) => s.share as number);
              const last = t.latest;
              const yoy = yoyAt(t.spark, last?.q);
              return (
                <tr key={t.id} className="border-b hover:bg-secondary/50">
                  <td className={td}>
                    <button type="button" onClick={() => onPick(t.id)} className="text-left font-medium hover:underline">
                      {t.name}
                    </button>
                    <p className="max-w-80 text-[11px] leading-snug text-muted-foreground">{t.description}</p>
                  </td>
                  <td className={td}>
                    <Sparkline values={spark} tone="ink" className="h-8 w-40" />
                  </td>
                  <td className={cn(td, "num text-right")}>
                    {pct(last?.share)}
                    {last && <div className="text-[10px] text-muted-foreground">{fmtQuarter(last.q)}</div>}
                  </td>
                  <td className={cn(td, "num text-right", toneOf(yoy))}>{pp(yoy)}</td>
                  <td className={cn(td, "num text-right")}>{pct(last?.new_share)}</td>
                  <td className={cn(td, "num text-right")}>
                    {last ? (
                      <>
                        <span className="text-chart-1">+{last.added}</span> / <span className="text-chart-4">−{last.dropped}</span>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className={cn(td, "text-[11px]")}>
                    <span className="flex flex-wrap gap-1">
                      {t.basket_top.slice(0, 6).map((tk) => (
                        <Link key={tk} to="/app/companies/$ticker" params={{ ticker: tk }} className="num rounded bg-secondary px-1 hover:underline">
                          {tk}
                        </Link>
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- one theme
export function ThemeHeadline({ doc }: { doc: ThemeDoc }) {
  const r = readable(doc.series);
  const last = r[r.length - 1];
  const yoy = yoyChange(doc.series);
  const yoyNew = yoyChange(doc.series, "new_share");
  const cells: [string, ReactNode, ReactNode?][] = last
    ? [
        ["Filers carrying the language", pct(last.share), `${last.mentioning.toLocaleString()} of ${last.filers.toLocaleString()} filing in ${fmtQuarter(last.q)}`],
        ["vs the same quarter a year ago", <span className={toneOf(yoy)}>{pp(yoy)}</span>, "percentage points"],
        ["Wrote new sentences", pct(last.new_share), `${last.new_language.toLocaleString()} of ${last.comparable.toLocaleString()} with a like-for-like prior filing · ${pp(yoyNew)} y/y`],
        ["Added / dropped the theme", <><span className="text-chart-1">+{last.added}</span> / <span className="text-chart-4">−{last.dropped}</span></>, "companies, vs their prior comparable filing"],
        ["Intensity", last.intensity == null ? "–" : last.intensity.toFixed(2), "counting sentences per 10,000 words indexed"],
        ["Negated or hedged", pct(last.negated_share), "of counting sentences ('did not have a material impact')"],
      ]
    : [];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 xl:grid-cols-6">
      {cells.map(([l, v, s]) => (
        <div key={l} className="bg-background px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">{l}</div>
          <div className="num text-lg font-semibold tracking-tight">{v}</div>
          {s && <div className="text-[11px] leading-snug text-muted-foreground">{s}</div>}
        </div>
      ))}
    </div>
  );
}

export function ThemeTrend({ doc, sector }: { doc: ThemeDoc; sector: string | null }) {
  const base = readable(doc.series);
  const sec = sector ? (doc.by_sector[sector] ?? []).filter((p) => p.filers >= 8) : [];
  const series = [
    { key: "share", label: "Carry the language", color: "var(--chart-1)", points: base.map((p) => ({ x: p.q, y: p.share })) },
    { key: "new", label: "Wrote new sentences", color: "var(--chart-2)", points: base.map((p) => ({ x: p.q, y: p.new_share })) },
    ...(sector
      ? [{ key: "sector", label: sector, color: "var(--chart-3)", points: sec.map((p) => ({ x: p.q, y: p.share })) }]
      : []),
  ];
  return (
    <Panel
      title={`${doc.name}: share of filers, by filing quarter`}
      subtitle="Companies whose 10-K or 10-Q filed in the quarter has at least one counting sentence (boilerplate shared across companies and safe-harbor lists excluded); new sentences are measured against the like-for-like prior filing. Quarters with fewer than 50 filers indexed are left out."
      collapse={false}
    >
      <MultiLine series={series} height={260} label={`${doc.name} share of filers`} format={(v) => `${Math.round(v * 100)}%`} xFormat={fmtQuarter} baseline={0} />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Source: SEC EDGAR 10-K and 10-Q text (Business, Risk factors, Cybersecurity, MD&A, Market risk), Filed Under filing-language index {doc.defs}.
      </p>
    </Panel>
  );
}

export function SectorGrid({ doc, sector, onSector }: { doc: ThemeDoc; sector: string | null; onSector: (s: string | null) => void }) {
  const rows = useMemo(() => {
    return Object.entries(doc.by_sector)
      .map(([s, pts]) => {
        const r = pts.filter((p) => p.filers >= 8 && p.share != null);
        const last = r[r.length - 1];
        const m = last && /^(\d{4})Q([1-4])$/.exec(last.q);
        const prior = m ? r.find((p) => p.q === `${Number(m[1]) - 1}Q${m[2]}`) : undefined;
        return { s, r, last, yoy: last && prior && last.share != null && prior.share != null ? last.share - prior.share : null };
      })
      .filter((x) => x.last)
      .sort((a, b) => (b.last!.share ?? 0) - (a.last!.share ?? 0));
  }, [doc]);
  return (
    <Panel title="By sector" subtitle="Latest quarter with at least 8 filers indexed · click a sector to add it to the chart and filter the lists" collapse={false}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {rows.map(({ s, r, last, yoy }) => (
          <button
            key={s}
            type="button"
            onClick={() => onSector(sector === s ? null : s)}
            className={cn(
              "rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-secondary/60",
              sector === s && "border-foreground/40 bg-secondary",
            )}
          >
            <div className="truncate text-[11px] text-muted-foreground">{s}</div>
            <div className="flex items-end justify-between gap-2">
              <span className="num text-base font-semibold">{pct(last!.share)}</span>
              <span className={cn("num text-[11px]", toneOf(yoy))}>{pp(yoy)}</span>
            </div>
            <Sparkline values={r.map((p) => p.share as number)} tone="neutral" className="mt-1 h-6 w-full" />
            <div className="text-[10px] text-muted-foreground">
              {last!.mentioning} of {last!.filers} · {fmtQuarter(last!.q)}
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function Excerpt({ e, onOpen }: { e: ThemeExcerpt; onOpen?: () => void }) {
  return (
    <blockquote className="border-l-2 border-border pl-2 text-[12px] leading-snug">
      <span className={cn(e.negated && "text-muted-foreground")}>“{e.text}”</span>{" "}
      <span className="text-[10px] text-muted-foreground">
        {SECTION_LABEL[e.section] ?? e.section}
        {e.negated ? " · negated or hedged" : ""}
      </span>
      {onOpen && (
        <button type="button" onClick={onOpen} className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-chart-1 hover:underline">
          open in filing <ArrowUpRight className="size-3" />
        </button>
      )}
    </blockquote>
  );
}

export function useOpenExcerpt() {
  const { open } = useSource();
  return (ticker: string, ref: { form: string; filed: string; accession: string; doc: string | null }, label: string, e?: ThemeExcerpt) => {
    if (!ref.doc) {
      window.open(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=${ref.form}`, "_blank", "noopener");
      return;
    }
    open({
      ticker,
      label,
      periodLabel: `${ref.form} filed ${ref.filed}`,
      unit: "USD",
      value: 0,
      doc: { accn: ref.accession, doc: ref.doc, form: ref.form, filed: ref.filed, title: `${ref.form} filed ${fmtDate(ref.filed)}`, search: e ? searchKey(e.text) : undefined },
    });
  };
}

export function ChangesTable({ doc, sector }: { doc: ThemeDoc; sector: string | null }) {
  const quarters = Object.keys(doc.changes).sort();
  const readableQ = new Set(readable(doc.series).map((p) => p.q));
  const def = [...quarters].reverse().find((q) => readableQ.has(q)) ?? quarters[quarters.length - 1];
  const [q, setQ] = useState(def);
  const [kind, setKind] = useState<"added" | "new_language" | "dropped">("added");
  const openEx = useOpenExcerpt();
  const block = doc.changes[q] ?? { added: [], dropped: [], new_language: [] };
  const rows = (block[kind] ?? []).filter((r) => !sector || r.sector === sector);
  const label = { added: "Added the theme", new_language: "New sentences", dropped: "Dropped the theme" }[kind];
  return (
    <Panel
      title="Who changed their language"
      subtitle="Each filing against its like-for-like prior (10-K vs prior 10-K, 10-Q vs the same quarter a year earlier). Click a quotation to open the filing at that sentence."
      collapse={false}
      bodyClassName="p-0"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Change"
            value={kind}
            onChange={setKind}
            options={[
              { v: "added", l: `Added (${block.added.length})` },
              { v: "new_language", l: `New sentences (${block.new_language.length})` },
              { v: "dropped", l: `Dropped (${block.dropped.length})` },
            ]}
          />
          <Segmented label="Quarter" value={q} onChange={setQ} options={quarters.slice(-4).map((x) => ({ v: x, l: fmtQuarter(x) }))} />
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr className="border-b">
              <th className={th}>Company</th>
              <th className={th}>Filing</th>
              <th className={cn(th, "text-right")}>{kind === "dropped" ? "Sentences before" : "Sentences"}</th>
              <th className={th}>{kind === "dropped" ? "What the prior filing said" : "What it says"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No companies in this list for {fmtQuarter(q)}{sector ? ` in ${sector}` : ""}.
                </td>
              </tr>
            )}
            {rows.map((r: ThemeChange) => {
              const ref = kind === "dropped" && r.prior ? r.prior : r;
              return (
                <tr key={`${r.ticker}-${r.accession}`} className="border-b">
                  <td className={cn(td, "w-48")}>
                    <Link to="/app/companies/$ticker" params={{ ticker: r.ticker }} className="font-medium hover:underline">
                      {r.ticker}
                    </Link>
                    <div className="max-w-44 truncate text-[11px] text-muted-foreground">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground">{r.sector}</div>
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-[11px]")}>
                    <a href={r.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                      {r.form} {fmtDate(r.filed)}
                    </a>
                    {r.prior && (
                      <div className="text-muted-foreground">
                        vs{" "}
                        <a href={r.prior.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                          {r.prior.form} {fmtDate(r.prior.filed)}
                        </a>
                      </div>
                    )}
                  </td>
                  <td className={cn(td, "num text-right")}>
                    {kind === "dropped" ? r.sentences_before : kind === "new_language" ? `${r.new_sentences} new of ${r.sentences}` : r.sentences}
                  </td>
                  <td className={cn(td, "grid gap-1.5")}>
                    {r.excerpts.map((e, i) => (
                      <Excerpt key={i} e={e} onOpen={() => openEx(r.ticker, ref, `${doc.name}: ${label.toLowerCase()}`, e)} />
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function BasketTable({ doc, sector }: { doc: ThemeDoc; sector: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = doc.basket.filter((r) => !sector || r.sector === sector);
  return (
    <Panel
      title="Basket: disclosed exposure"
      subtitle="Ranked by what companies report, not by how often they use the words: reported revenue share (geography table or a customer's share of revenue), then the number of independent exposure types (revenue lines, named counterparties), then counting sentences in the latest filing."
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr className="border-b">
              <th className={th}>Company</th>
              <th className={cn(th, "text-right")}>Disclosed share</th>
              <th className={th}>Evidence</th>
              <th className={cn(th, "text-right")}>Sentences, latest filing</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No disclosed exposure found{sector ? ` in ${sector}` : ""} for this theme.
                </td>
              </tr>
            )}
            {rows.map((r: BasketRow) => (
              <tr key={r.ticker} className="border-b align-top">
                <td className={cn(td, "w-48")}>
                  <Link to="/app/companies/$ticker" params={{ ticker: r.ticker }} className="font-medium hover:underline">
                    {r.ticker}
                  </Link>
                  <div className="max-w-44 truncate text-[11px] text-muted-foreground">{r.name}</div>
                  <div className="text-[10px] text-muted-foreground">{r.sector}</div>
                </td>
                <td className={cn(td, "num text-right")}>{r.disclosed_share == null ? "–" : pct(r.disclosed_share, 1)}</td>
                <td className={td}>
                  <button
                    type="button"
                    onClick={() => setOpen(open === r.ticker ? null : r.ticker)}
                    className="flex flex-wrap items-center gap-1 text-left"
                    aria-expanded={open === r.ticker}
                  >
                    {open === r.ticker ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    {r.evidence.map((e, i) => (
                      <span key={i} className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">
                        {e.type}
                      </span>
                    ))}
                  </button>
                  {open === r.ticker && (
                    <ul className="mt-1.5 grid gap-1 text-[11px]">
                      {r.evidence.map((e, i) => (
                        <li key={i}>
                          <span className="font-medium">{e.type}:</span> {e.text}
                          {e.quote && <div className="mt-0.5 border-l-2 pl-2 text-muted-foreground">“{e.quote}”</div>}
                          {e.excerpts?.map((x, j) => (
                            <div key={j} className="mt-0.5 border-l-2 pl-2 text-muted-foreground">
                              “{x.text}”
                            </div>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className={cn(td, "num text-right")}>{r.mentions_latest}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function ThemeMethod({ doc, idx }: { doc: ThemeDoc; idx?: ThemesIndex }) {
  return (
    <Panel title="How this is measured" collapse={false}>
      <div className="grid gap-3 text-[12px] leading-relaxed md:grid-cols-2">
        <div className="grid gap-2">
          {idx?.method && <p>{idx.method}</p>}
          <p className="text-muted-foreground">
            {doc.boilerplate_sentences.toLocaleString()} sentences were set aside as shared boilerplate (the same wording, digits masked, in many
            companies' filings). Shares count companies, not mentions, so a long risk-factor section does not outweigh a short one. Quarters are filing
            quarters; a company that files a 10-K and a 10-Q in the same quarter counts once.
          </p>
        </div>
        <div className="grid gap-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">Phrase set {doc.defs}</div>
          <code className="block max-h-40 overflow-auto rounded bg-secondary px-2 py-1.5 text-[10.5px] leading-snug whitespace-pre-wrap">
            {doc.include.map((p) => `+ ${p}`).join("\n")}
            {doc.exclude.length ? "\n" + doc.exclude.map((p) => `− ${p}`).join("\n") : ""}
          </code>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- custom phrase trend (EDGAR full-text search)
interface CustomPoint {
  q: string;
  total: number;
  capped: boolean;
}

function quarterRange(q: string): [string, string] {
  const [y, n] = [Number(q.slice(0, 4)), Number(q.slice(5))];
  const start = `${y}-${String((n - 1) * 3 + 1).padStart(2, "0")}-01`;
  const endMonth = n * 3;
  const endDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  return [start, `${y}-${String(endMonth).padStart(2, "0")}-${endDay}`];
}

export function lastQuarters(n: number, today = new Date()): string[] {
  const out: string[] = [];
  let y = today.getUTCFullYear();
  let q = Math.floor(today.getUTCMonth() / 3) + 1;
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}Q${q}`);
    q -= 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
  }
  return out;
}

/** Build an EDGAR full-text query from comma or line separated phrases: each phrase is quoted, phrases are ORed. */
export function edgarQuery(input: string): string | null {
  const parts = input
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/"/g, ""))
    .filter((s) => s.length >= 2)
    .slice(0, 6);
  if (!parts.length) return null;
  const q = parts.map((p) => `"${p}"`).join(" OR ");
  return q.length <= 200 ? q : null;
}

export function CustomPhrase() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState<CustomPoint[]>([]);
  const [hits, setHits] = useState<{ company: string; form: string; filed: string; url: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    const q = edgarQuery(input);
    if (!q) return setErr("Enter one to six phrases, separated by commas (200 characters at most).");
    setErr(null);
    setBusy(true);
    setPoints([]);
    setHits([]);
    const qs = lastQuarters(12).slice(0, -1);
    try {
      for (const quarter of qs) {
        const [startdt, enddt] = quarterRange(quarter);
        const r = await searchFilings({ data: { q, forms: ["10-K", "10-Q"], startdt, enddt } });
        setPoints((p) => [...p, { q: quarter, total: r.total, capped: r.total >= 10000 }]);
        if (quarter === qs[qs.length - 1]) setHits(r.hits.slice(0, 12));
        await new Promise((res) => setTimeout(res, 350));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Track your own phrase"
      subtitle="Counts 10-K and 10-Q filings by all SEC filers (not only covered companies) that contain any of your phrases, per filing quarter, using EDGAR full-text search. Exact phrases; no boilerplate filtering."
      collapse={false}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && run()}
            placeholder="e.g. de minimis exemption, port fees, humanoid robots"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button size="sm" className="h-8" onClick={run} disabled={busy || !input.trim()}>
          Run
        </Button>
        {busy && <LoadingState label="Searching EDGAR" variant="Orbit" />}
      </div>
      {err && <p className="mt-2 text-[12px] text-chart-4">{err}</p>}
      {points.length > 0 && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <MultiLine
              series={[{ key: "n", label: "Filings", color: "var(--chart-1)", points: points.map((p) => ({ x: p.q, y: p.total })) }]}
              height={200}
              label="Filings containing the phrases"
              format={(v) => Math.round(v).toLocaleString()}
              xFormat={fmtQuarter}
              baseline={0}
            />
            {points.some((p) => p.capped) && <p className="text-[11px] text-muted-foreground">EDGAR caps counts at 10,000 per query.</p>}
          </div>
          {hits.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">Most relevant filings in {fmtQuarter(points[points.length - 1].q)}</div>
              <ul className="grid gap-1 text-[12px]">
                {hits.map((h) => (
                  <li key={h.url} className="flex items-baseline gap-2">
                    <a href={h.url} target="_blank" rel="noreferrer noopener" className="truncate hover:underline">
                      {h.company}
                    </a>
                    <span className="num shrink-0 text-[11px] text-muted-foreground">
                      {h.form} · {fmtDate(h.filed)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
