import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, CornerDownLeft, Download, Loader2, Sparkles, X } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CompanyLogo } from "@/components/app/company-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { partnerScreen } from "@/lib/data";
import { useScreenRows } from "@/lib/screener/use-rows";
import { useSessionState } from "@/lib/use-session-state";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BASIC_FIELDS,
  BUCKET_ORDER,
  COLSETS,
  INDEX_LABELS,
  LIVE_FIELDS,
  PRESETS,
  emptySpec,
  filterText,
  fmtField,
  mcapBucket,
  run,
  validate,
  type Catalogue,
  type FieldDef,
  type Row,
  type Spec,
} from "@/lib/screener/engine";

export const Route = createFileRoute("/_authenticated/app/screener")({
  head: () => ({
    meta: [
      { title: "Screener — Filed Under" },
      {
        name: "description",
        content:
          "Screen tracked companies in plain English or with filters over SEC-sourced fundamentals, valuation, growth, technicals, correlations and insider activity.",
      },
      { property: "og:title", content: "Screener — Filed Under" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Screener,
});

const EXAMPLES = [
  "Profitable mid caps growing revenue over 15% with net cash",
  "Cheapest 20% of semis on EV/sales that are above the 200-day",
  "Companies like COST but cheaper",
  "Banks most hurt by falling rates",
  "Dividend growers with low debt, sorted by yield",
];

const isSpec = (v: unknown): v is Spec =>
  !!v && typeof v === "object" && Array.isArray((v as Spec).filters);

function Screener() {
  const navigate = useNavigate();
  const [spec, setSpec] = useSessionState<Spec>("fu:screener:spec", emptySpec(), isSpec);
  const [colset, setColset] = useSessionState("fu:screener:colset", "Overview");
  const [basic, setBasic] = useSessionState("fu:screener:basic", true);
  const [q, setQ] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<{
    error?: string;
    warnings?: string[];
    errors?: string[];
    model?: string;
    prompt?: string;
  } | null>(null);
  const [history, setHistory] = useState<{ prompt: string; spec: Spec }[]>([]);
  const [shown, setShown] = useState(100);
  const { file, F, rows } = useScreenRows(basic);

  const cat: Catalogue = useMemo(
    () => ({
      fields: file.data?.fields ?? [],
      sectors: [...new Set(rows.map((r) => r.sector))].sort(),
      industries: [...new Set(rows.map((r) => r.industry).filter(Boolean))].sort(),
      tickers: rows.map((r) => r.ticker),
    }),
    [file.data, rows],
  );
  const res = useMemo(() => (rows.length ? run(rows, spec, F, q) : null), [rows, spec, F, q]);
  const cols = (spec.columns.length ? spec.columns : (COLSETS[colset] ?? COLSETS.Overview)).filter(
    (id) => F.has(id),
  );

  async function ask(e?: FormEvent, text?: string) {
    e?.preventDefault();
    const p = (text ?? prompt).trim();
    if (!p || busy) return;
    setBusy(true);
    setAgent(null);
    try {
      const hasScreen = spec.filters.length > 0 || spec.sectors.length > 0 || !!spec.similar_to;
      const out = await partnerScreen({ prompt: p, history, current: hasScreen ? spec : null });
      const v = validate(out.spec, cat);
      setSpec(v.spec);
      setHistory((h) => [...h.slice(-5), { prompt: p, spec: v.spec }]);
      setAgent({
        warnings: [...(out.warnings ?? []), ...v.warnings],
        errors: [...(out.errors ?? []), ...v.errors],
        model: out.model,
        prompt: p,
      });
      setPrompt("");
      setShown(100);
    } catch (err) {
      setAgent({ error: (err as Error).message, prompt: p });
    } finally {
      setBusy(false);
    }
  }
  const applyPreset = (id: string) => {
    const pr = PRESETS.find((x) => x.id === id);
    if (!pr) return;
    setSpec({ ...emptySpec(), ...validate(pr.spec, cat).spec, explanation: pr.why });
    setAgent(null);
    setHistory([]);
    setShown(100);
  };
  const reset = () => {
    setSpec(emptySpec());
    setAgent(null);
    setHistory([]);
    setQ("");
  };
  const sortBy = (id: string) =>
    setSpec((s) => ({
      ...s,
      sort: { field: id, dir: s.sort?.field === id && s.sort.dir === "desc" ? "asc" : "desc" },
    }));
  const csv = () => {
    if (!res) return;
    const head = ["ticker", "name", "sector", "industry", ...cols];
    const lines = [
      head.join(","),
      ...res.rows.map((r) => head.map((h) => JSON.stringify(r[h] ?? "")).join(",")),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "screen.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const groups = useMemo(() => {
    if (!res || !spec.group_by) return null;
    const key = (r: Row) =>
      spec.group_by === "mcap_bucket"
        ? mcapBucket(r.mcap)
        : spec.group_by!.startsWith("quintile:")
          ? null
          : String(r[spec.group_by!] ?? "Unknown");
    if (spec.group_by.startsWith("quintile:")) {
      const id = spec.group_by.slice(9);
      const vals = res.rows
        .map((r) => r[id])
        .filter((v): v is number => typeof v === "number")
        .sort((a, b) => a - b);
      const cut = [0.2, 0.4, 0.6, 0.8].map((p) => vals[Math.floor(p * (vals.length - 1))]);
      const qk = (r: Row) =>
        typeof r[id] !== "number"
          ? "No value"
          : `Quintile ${1 + cut.filter((c) => (r[id] as number) > c).length}`;
      const m = new Map<string, Row[]>();
      for (const r of res.rows) m.set(qk(r), [...(m.get(qk(r)) ?? []), r]);
      return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }
    const m = new Map<string, Row[]>();
    for (const r of res.rows) m.set(key(r)!, [...(m.get(key(r)!) ?? []), r]);
    const ent = [...m.entries()];
    return spec.group_by === "mcap_bucket"
      ? ent.sort((a, b) => BUCKET_ORDER.indexOf(a[0]) - BUCKET_ORDER.indexOf(b[0]))
      : ent.sort((a, b) => b[1].length - a[1].length);
  }, [res, spec.group_by]);

  if (file.isError)
    return (
      <div>
        <PageHeader eyebrow="Markets" title="Screener" />
        <DataUnavailable
          title="The screener dataset is not available"
          error={file.error}
          onRetry={() => file.refetch()}
        />
      </div>
    );

  const nBasic = rows.filter((r) => r.basic).length;
  return (
    <div>
      <PageHeader
        eyebrow="Markets"
        title="Screener"
        description={
          file.data
            ? `${rows.length.toLocaleString()} companies · prices ${file.data.asof.prices ? fmtDate(file.data.asof.prices) : "–"}, live where quoted · latest quarter ${file.data.asof.facts ? fmtDate(file.data.asof.facts) : "–"}`
            : undefined
        }
      />

      <form
        onSubmit={ask}
        className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-paper focus-within:ring-2 focus-within:ring-ring"
      >
        <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            spec.filters.length
              ? "Refine: “only above the 200-day”, “drop banks”, “sort by FCF yield”"
              : "Describe a screen: “profitable small caps with accelerating revenue and insider buying”"
          }
          aria-label="Describe a screen"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="sm" disabled={busy || !prompt.trim() || !file.data}>
          {busy ? <Loader2 className="animate-spin" /> : <CornerDownLeft />}{" "}
          {busy ? "Building" : "Screen"}
        </Button>
      </form>
      {!spec.filters.length && !agent && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((x) => (
            <button
              key={x}
              type="button"
              disabled={!file.data || busy}
              onClick={() => {
                setPrompt(x);
                void ask(undefined, x);
              }}
              className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {x}
            </button>
          ))}
        </div>
      )}
      {agent?.error && (
        <p role="alert" className="mb-3 text-sm text-negative">
          {agent.error}
        </p>
      )}
      {(spec.explanation || agent?.model) && (
        <div className="mb-3 border-l-2 border-highlight bg-card/60 px-3 py-2 text-[13px]">
          {agent?.prompt && (
            <p className="text-[11px] text-muted-foreground">
              “{agent.prompt}”{agent.model ? ` · screen agent (${agent.model})` : ""}
            </p>
          )}
          {spec.explanation && <p className="mt-0.5">{spec.explanation}</p>}
          {spec.assumptions.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
              {spec.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {!!agent?.errors?.length && (
            <p className="mt-1 text-xs text-negative">Dropped: {agent.errors.join("; ")}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            The agent only chooses fields and thresholds; every value in the table comes from the
            dataset.
          </p>
        </div>
      )}

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.why}
            onClick={() => applyPreset(p.id)}
            className="shrink-0 rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-secondary"
          >
            {p.n}
          </button>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {spec.filters.map((f, i) => (
          <span
            key={`${f.field}-${i}`}
            className="inline-flex h-7 items-center gap-1 rounded-md border bg-secondary/60 pl-2 pr-1 text-xs"
            title={F.get(f.field)?.d}
          >
            {filterText(f, F)}
            <button
              type="button"
              aria-label="Remove filter"
              onClick={() =>
                setSpec((s) => ({ ...s, filters: s.filters.filter((_, k) => k !== i) }))
              }
              className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {[
          ...spec.sectors.map((x) => `Sector: ${x}`),
          ...spec.exclude_sectors.map((x) => `Not ${x}`),
          ...spec.industries.map((x) => `Industry: ${x}`),
          ...spec.exclude_industries.map((x) => `Not ${x}`),
        ].map((t) => (
          <span key={t} className="inline-flex h-7 items-center rounded-md border px-2 text-xs">
            {t}
          </span>
        ))}
        {spec.similar_to && (
          <span className="inline-flex h-7 items-center rounded-md border px-2 text-xs">
            Similar to {spec.similar_to.ticker} · {spec.similar_to.n}
          </span>
        )}
        {(spec.filters.length > 0 ||
          spec.sectors.length > 0 ||
          spec.similar_to ||
          spec.exclude_sectors.length > 0 ||
          spec.industries.length > 0) && (
          <Button size="xs" variant="ghost" onClick={reset}>
            Clear screen
          </Button>
        )}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Segmented
          size="xs"
          label="Universe"
          value={spec.index}
          onChange={(v) => setSpec((s) => ({ ...s, index: v }))}
          options={(Object.keys(INDEX_LABELS) as Spec["index"][]).map((k) => ({
            v: k,
            l: INDEX_LABELS[k],
          }))}
        />
        <Select
          value={spec.sectors[0] ?? "All"}
          onValueChange={(v) => setSpec((s) => ({ ...s, sectors: v === "All" ? [] : [v] }))}
        >
          <SelectTrigger aria-label="Sector" className="h-7 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All sectors</SelectItem>
            {cat.sectors.map((x) => (
              <SelectItem key={x} value={x}>
                {x}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find in results"
          aria-label="Find in results"
          className="h-7 w-44 text-xs"
        />
        <label
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          title="Companies without a full screener row: SEC fundamentals and live-price valuation only; technicals, correlations and insider fields are empty for them."
        >
          <Switch
            checked={basic}
            onCheckedChange={setBasic}
            aria-label="Include fundamentals-only companies"
          />{" "}
          Include {nBasic || ""} fundamentals-only
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={spec.group_by ?? "none"}
            onValueChange={(v) => setSpec((s) => ({ ...s, group_by: v === "none" ? null : v }))}
          >
            <SelectTrigger aria-label="Group by" className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No grouping</SelectItem>
              <SelectItem value="sector">By sector</SelectItem>
              <SelectItem value="industry">By industry</SelectItem>
              <SelectItem value="mcap_bucket">By size</SelectItem>
              {spec.sort && spec.sort.field !== "similarity" && (
                <SelectItem value={`quintile:${spec.sort.field}`}>Quintiles of sort</SelectItem>
              )}
            </SelectContent>
          </Select>
          <Segmented
            size="xs"
            label="Columns"
            value={spec.columns.length ? "Screen" : colset}
            onChange={(v) => {
              if (v !== "Screen") {
                setColset(v);
                setSpec((s) => ({ ...s, columns: [] }));
              }
            }}
            options={[
              ...(spec.columns.length ? [{ v: "Screen", l: "Screen" }] : []),
              ...Object.keys(COLSETS).map((k) => ({ v: k, l: k })),
            ]}
          />
          <Button size="xs" variant="outline" onClick={csv} disabled={!res?.rows.length}>
            <Download /> CSV
          </Button>
        </div>
      </div>

      {!res ? (
        <Skeleton className="h-[480px]" />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-paper">
          <div className="flex items-center gap-3 border-b px-3 py-1.5 text-xs text-muted-foreground">
            <span>
              <span className="num font-medium text-foreground">
                {res.rows.length.toLocaleString()}
              </span>{" "}
              of {res.uni.length.toLocaleString()} companies
            </span>
            {spec.sort && (
              <span>
                sorted by{" "}
                {spec.sort.field === "similarity" ? "similarity" : F.get(spec.sort.field)?.n}{" "}
                {spec.sort.dir === "asc" ? "↑" : "↓"}
              </span>
            )}
          </div>
          <div className="max-h-[70vh] overflow-auto scrollbar-thin">
            <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 min-w-56 border-b border-r bg-card px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Company
                  </th>
                  {spec.similar_to && (
                    <th
                      className="sticky top-0 z-20 border-b bg-card px-3 py-2 text-right text-[11px] font-medium text-muted-foreground"
                      title="Distance across standardized fundamentals and market traits; lower is closer"
                    >
                      Distance
                    </th>
                  )}
                  {cols.map((id) => {
                    const f = F.get(id)!;
                    const on = spec.sort?.field === id;
                    return (
                      <th
                        key={id}
                        aria-sort={
                          on ? (spec.sort!.dir === "asc" ? "ascending" : "descending") : "none"
                        }
                        className="sticky top-0 z-20 min-w-24 border-b bg-card px-3 py-2 text-right align-bottom"
                      >
                        <button
                          type="button"
                          onClick={() => sortBy(id)}
                          title={`${f.n}\n${f.d}${f.src ? `\nSource: ${f.src}` : ""}${LIVE_FIELDS.has(id) ? "\nUpdated to the live price where quoted." : ""}`}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          {f.n}
                          {on &&
                            (spec.sort!.dir === "asc" ? (
                              <ArrowUp className="size-3" />
                            ) : (
                              <ArrowDown className="size-3" />
                            ))}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groups
                  ? groups.map(([g, list]) => (
                      <GroupRows
                        key={g}
                        label={g}
                        rows={list}
                        cols={cols}
                        F={F}
                        sim={res.sim}
                        onOpen={(t) =>
                          navigate({ to: "/app/companies/$ticker", params: { ticker: t } })
                        }
                      />
                    ))
                  : res.rows
                      .slice(0, shown)
                      .map((r) => (
                        <ResultRow
                          key={r.ticker}
                          r={r}
                          cols={cols}
                          F={F}
                          sim={res.sim}
                          onOpen={(t) =>
                            navigate({ to: "/app/companies/$ticker", params: { ticker: t } })
                          }
                        />
                      ))}
              </tbody>
            </table>
            {!groups && res.rows.length > shown && (
              <div className="border-t px-3 py-2">
                <button
                  type="button"
                  onClick={() => setShown((s) => s + 200)}
                  className="text-xs text-link hover:underline"
                >
                  Show more ({res.rows.length - shown})
                </button>
              </div>
            )}
            {!res.rows.length && (
              <p className="p-6 text-sm text-muted-foreground">
                No companies pass every filter. Remove a filter or widen a threshold.
              </p>
            )}
          </div>
          <p className="border-t px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Fundamentals from SEC filings (trailing four quarters unless named); prices daily, with
            valuation moved to the live quote where one is available. Rows marked “basic” carry SEC
            fundamentals only. Hover a column for its definition and source; open a company for
            every underlying filing value.
          </p>
        </div>
      )}
    </div>
  );
}

function ResultRow({
  r,
  cols,
  F,
  sim,
  onOpen,
}: {
  r: Row;
  cols: string[];
  F: Map<string, FieldDef>;
  sim: Map<string, number> | null;
  onOpen: (t: string) => void;
}) {
  return (
    <tr
      tabIndex={0}
      onClick={() => onOpen(r.ticker)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(r.ticker)}
      className="group cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
    >
      <td className="sticky left-0 z-10 max-w-72 border-b border-r bg-card px-3 py-1.5 group-hover:bg-secondary">
        <span className="flex items-center gap-2">
          <CompanyLogo ticker={r.ticker} className="size-5" />
          <Link
            to="/app/companies/$ticker"
            params={{ ticker: r.ticker }}
            onClick={(e) => e.stopPropagation()}
            className="num font-medium hover:underline"
          >
            {r.ticker}
          </Link>
          <span
            className="truncate text-xs text-muted-foreground"
            title={`${r.name} · ${r.sector} · ${r.industry}`}
          >
            {r.name}
          </span>
          {r.basic && (
            <span
              className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground"
              title="SEC fundamentals only; no technicals, correlations or insider fields"
            >
              basic
            </span>
          )}
        </span>
      </td>
      {sim && (
        <td className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary">
          {sim.get(r.ticker)?.toFixed(2) ?? "–"}
        </td>
      )}
      {cols.map((id) => {
        const v = r[id];
        const f = F.get(id);
        const missing = v == null && r.basic && !BASIC_FIELDS.has(id);
        const filled = Array.isArray(r.filled) && (r.filled as string[]).includes(id);
        return (
          <td
            key={id}
            title={
              missing
                ? "Not computed for fundamentals-only rows"
                : filled
                  ? "Computed from the company's SEC fundamentals (trailing four quarters) at the current price"
                  : undefined
            }
            className={cn(
              "num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary",
              typeof v === "number" && v < 0 && f?.u === "pct" && "text-negative",
              v == null && "text-muted-foreground/50",
            )}
          >
            {fmtField(f, v)}
          </td>
        );
      })}
    </tr>
  );
}

function GroupRows({
  label,
  rows,
  cols,
  F,
  sim,
  onOpen,
}: {
  label: string;
  rows: Row[];
  cols: string[];
  F: Map<string, FieldDef>;
  sim: Map<string, number> | null;
  onOpen: (t: string) => void;
}) {
  const [open, setOpen] = useState(rows.length <= 25);
  const med = (id: string) => {
    const a = rows
      .map((r) => r[id])
      .filter((v): v is number => typeof v === "number")
      .sort((x, y) => x - y);
    return a.length
      ? a.length % 2
        ? a[a.length >> 1]
        : (a[(a.length >> 1) - 1] + a[a.length >> 1]) / 2
      : null;
  };
  return (
    <>
      <tr className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="sticky left-0 z-10 border-b border-r bg-secondary px-3 py-1.5 text-xs font-medium">
          {open ? "▾" : "▸"} {label}{" "}
          <span className="font-normal text-muted-foreground">· {rows.length} · median</span>
        </td>
        {sim && <td className="border-b bg-secondary" />}
        {cols.map((id) => (
          <td
            key={id}
            className="num border-b bg-secondary px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground"
          >
            {fmtField(F.get(id), med(id))}
          </td>
        ))}
      </tr>
      {open &&
        rows
          .slice(0, 200)
          .map((r) => (
            <ResultRow key={r.ticker} r={r} cols={cols} F={F} sim={sim} onOpen={onOpen} />
          ))}
    </>
  );
}
