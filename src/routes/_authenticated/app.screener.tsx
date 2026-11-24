import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { memo, useEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Columns3, CornerDownLeft, Download, Link2, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFits } from "@/components/ir/panel";
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
  type Filter,
  type Op,
  type Row,
  type Spec,
} from "@/lib/screener/engine";
import {
  buildFilter,
  encodeSpec,
  applicable,
  readShared,
  searchAlone,
  screenSearch,
  SHARE_MAX,
  fieldGroups,
  filterImpact,
  formatInput,
  inputUnit,
  isActive,
  matchField,
  opsFor,
  toCsv,
  type FieldGroup,
} from "@/lib/screener/present";
import { SERIES_FIELD_IDS, SERIES_FIELDS } from "@/lib/screener/series";
import { ROW_H, useRowFocus, useWindowRange } from "@/lib/screener/window";

/** Field names for chips of filters whose field is not loaded (the liquidity fields come from a separate query). */
const NAMES = new Map(SERIES_FIELDS.map((f) => [f.id, f]));

export const Route = createFileRoute("/_authenticated/app/screener")({
  validateSearch: (s: Record<string, unknown>) => screenSearch(s),
  head: () => ({
    meta: [
      { title: "Screener · FiledUnder" },
      {
        name: "description",
        content:
          "Screen tracked companies in plain English or with filters over SEC-sourced fundamentals, valuation, growth, technicals, liquidity, correlations and insider activity.",
      },
      { property: "og:title", content: "Screener · FiledUnder" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Screener,
});

const EXAMPLES = [
  "Profitable mid caps growing revenue over 15% with net cash",
  "Cheapest 20% of semis on EV/sales above the 200-day",
  "Companies like COST but cheaper",
];

// A stored screen must carry every list the page reads (an old or hand-written one without `sectors` crashed it).
const isSpec = (v: unknown): v is Spec =>
  !!v &&
  typeof v === "object" &&
  Object.entries(emptySpec()).every(([k, d]) => !Array.isArray(d) || Array.isArray((v as Record<string, unknown>)[k]));
const STICKY = "top-[var(--sticky-top,3.5rem)]";
const COLSET_NAMES = Object.keys(COLSETS);
const GROUP_LABEL: Record<string, string> = { sector: "Sector", industry: "Industry", mcap_bucket: "Size" };

function Screener() {
  const navigate = useNavigate();
  const { screen: shared } = Route.useSearch();
  const [spec, setSpec] = useSessionState<Spec>("fu:screener:spec", emptySpec(), isSpec);
  const [colset, setColset] = useSessionState("fu:screener:colset", "Overview");
  const [basic, setBasic] = useSessionState("fu:screener:basic", true);
  const [q, setQ] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<{ error?: string; warnings?: string[]; errors?: string[]; model?: string; prompt?: string } | null>(null);
  const [history, setHistory] = useState<{ prompt: string; spec: Spec }[]>([]);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { file, F, rows, seriesSpan, seriesSettled } = useScreenRows(basic);

  const fields = useMemo(() => [...F.values()], [F]);
  const groups = useMemo(() => fieldGroups(fields, file.data?.groups ?? []), [fields, file.data]);
  const cat: Catalogue = useMemo(
    () => ({
      fields,
      sectors: [...new Set(rows.map((r) => r.sector))].sort(),
      industries: [...new Set(rows.map((r) => r.industry).filter(Boolean))].sort(),
      tickers: rows.map((r) => r.ticker),
    }),
    [fields, rows],
  );

  // A shared link (?screen=) replaces the current screen once the catalogue is known, then leaves the address.
  // The code last adopted, so a second shared link opened while the screener is mounted is adopted too.
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    // Wait for the series query too, so a link that names dv20 or short_vol5 is not stripped of them.
    if (shared === undefined) {
      adopted.current = null;
      return;
    }
    if (adopted.current === shared || !fields.length || !rows.length || !seriesSettled) return;
    adopted.current = shared;
    const got = readShared(shared);
    if (got.ok) {
      const v = validate(got.raw, cat);
      setSpec({ ...v.spec, explanation: "Opened from a shared screen link." });
      setAgent(v.errors.length ? { errors: v.errors, prompt: "Shared screen" } : null);
      setNotice(null);
    } else {
      setSpec(emptySpec());
      setAgent(null);
      setNotice(got.notice);
    }
    void navigate({ to: "/app/screener", search: {}, replace: true, resetScroll: false });
  }, [shared, fields.length, rows.length, seriesSettled, cat, setSpec, navigate]);

  // Filters on fields that are not in the catalogue right now are shown but not applied.
  const live = useMemo(() => applicable(spec, F), [spec, F]);
  const res = useMemo(() => (rows.length ? run(rows, live.spec, F, q) : null), [rows, live.spec, F, q]);
  const cols = (spec.columns.length ? spec.columns : (COLSETS[colset] ?? COLSETS.Overview)).filter((id) => F.has(id));
  const impact = useMemo(
    () => {
      if (!res || res.rows.length || !live.spec.filters.length) return null;
      // Impact indexes refer to the applied filters; map them back to the screen's own filter list.
      const orig = spec.filters.flatMap((_, i) => (live.missing.includes(i) ? [] : [i]));
      return filterImpact(rows, live.spec, F, q).map((x) => ({ ...x, i: orig[x.i] }));
    },
    [res, rows, spec.filters, live, F, q],
  );

  async function ask(e?: FormEvent, text?: string) {
    e?.preventDefault();
    const p = (text ?? prompt).trim();
    if (!p || busy) return;
    setBusy(true);
    setAgent(null);
    try {
      const out = await partnerScreen({ prompt: p, history, current: isActive(spec) ? spec : null });
      const v = validate(out.spec, cat);
      setSpec(v.spec);
      setHistory((h) => [...h.slice(-5), { prompt: p, spec: v.spec }]);
      setAgent({ warnings: [...(out.warnings ?? []), ...v.warnings], errors: [...(out.errors ?? []), ...v.errors], model: out.model, prompt: p });
      setPrompt("");
    } catch (err) {
      setAgent({ error: (err as Error).message, prompt: p });
    } finally {
      setBusy(false);
    }
  }
  const applyPreset = (id: string) => {
    const pr = PRESETS.find((x) => x.id === id);
    if (!pr) return;
    setSpec({ ...emptySpec(), ...validate(pr.spec, cat).spec, explanation: `${pr.n}: ${pr.why}` });
    setAgent(null);
    setHistory([]);
  };
  const reset = () => {
    setSpec(emptySpec());
    setAgent(null);
    setHistory([]);
    setQ("");
  };
  const setFilter = (i: number | null, f: Filter) =>
    setSpec((s) => ({ ...s, filters: i == null ? [...s.filters, f] : s.filters.map((x, k) => (k === i ? f : x)) }));
  const removeFilter = (i: number) => setSpec((s) => ({ ...s, filters: s.filters.filter((_, k) => k !== i) }));
  const sortBy = (id: string) =>
    setSpec((s) => ({ ...s, sort: { field: id, dir: s.sort?.field === id && s.sort.dir === "desc" ? "asc" : "desc" } }));
  const countFor = (f: Filter) => (rows.length ? run(rows, { ...spec, filters: [...spec.filters, f] }, F, q).rows.length : 0);

  const grouped = useMemo(() => {
    if (!res || !spec.group_by) return null;
    const gb = spec.group_by;
    if (gb.startsWith("quintile:")) {
      const id = gb.slice(9);
      const vals = res.rows.map((r) => r[id]).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
      const cut = [0.2, 0.4, 0.6, 0.8].map((p) => vals[Math.floor(p * (vals.length - 1))]);
      const key = (r: Row) => (typeof r[id] !== "number" ? "No value" : `Quintile ${1 + cut.filter((c) => (r[id] as number) > c).length}`);
      return { key, groups: groupRows(res.rows, key).sort((a, b) => a[0].localeCompare(b[0])) };
    }
    const key = (r: Row) => (gb === "mcap_bucket" ? mcapBucket(r.mcap) : String(r[gb] ?? "Unknown"));
    const g = groupRows(res.rows, key);
    return {
      key,
      groups: gb === "mcap_bucket" ? g.sort((a, b) => BUCKET_ORDER.indexOf(a[0]) - BUCKET_ORDER.indexOf(b[0])) : g.sort((a, b) => b[1].length - a[1].length),
    };
  }, [res, spec.group_by]);
  const shownRows = grouped ? grouped.groups.flatMap(([, list]) => list) : (res?.rows ?? []);

  const csv = () => {
    if (!res) return;
    const text = toCsv(shownRows, cols, F, {
      sim: res.sim,
      ...(grouped ? { groupOf: grouped.key, groupLabel: spec.group_by?.startsWith("quintile:") ? "Quintile" : GROUP_LABEL[spec.group_by!] } : {}),
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
    a.download = `screen-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    const href = a.href;
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };
  const copyLink = async () => {
    const code = encodeSpec(spec);
    if (code.length > SHARE_MAX) {
      setNotice(`This screen is too long to share as a link (${code.length.toLocaleString()} characters, limit ${SHARE_MAX.toLocaleString()}); shorten its ticker list first.`);
      return;
    }
    const url = `${location.origin}/app/screener?screen=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", url);
    }
  };
  const openCompany = (t: string) => navigate({ to: "/app/companies/$ticker", params: { ticker: t } });

  if (file.isError)
    return (
      <div>
        <PageHeader eyebrow="Companies" title="Screener" />
        <DataUnavailable title="The screener dataset is not available" error={file.error} onRetry={() => file.refetch()} />
      </div>
    );

  const nBasic = rows.filter((r) => r.basic).length;
  const sortName = spec.sort ? (spec.sort.field === "similarity" ? "similarity" : F.get(spec.sort.field)?.n) : null;
  return (
    <div>
      <PageHeader
        eyebrow="Companies"
        title="Screener"
        description={
          file.data
            ? `${rows.length.toLocaleString()} companies · prices ${file.data.asof.prices ? fmtDate(file.data.asof.prices) : "–"}, live where quoted · latest quarter ${file.data.asof.facts ? fmtDate(file.data.asof.facts) : "–"}${seriesSpan ? ` · liquidity ${seriesSpan.from === seriesSpan.to ? fmtDate(seriesSpan.to) : `${fmtDate(seriesSpan.from)} to ${fmtDate(seriesSpan.to)}`}` : ""}`
            : undefined
        }
      />

      <section data-section="Screen builder" className="mb-4 space-y-2">
        <form onSubmit={ask} className="flex h-10 items-center gap-2 rounded-md border bg-card px-3 shadow-paper focus-within:ring-2 focus-within:ring-ring">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={spec.filters.length ? "Refine in words: “only above the 200-day”, “drop banks”, “sort by FCF yield”" : "Describe a screen in words, or build one with the filters below"}
            aria-label="Describe a screen"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="xs" disabled={busy || !prompt.trim() || !file.data}>
            {busy ? <Loader2 className="animate-spin" /> : <CornerDownLeft />} {busy ? "Building" : "Screen"}
          </Button>
        </form>
        {!isActive(spec) && !agent && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Try</span>
            {EXAMPLES.map((x) => (
              <button
                key={x}
                type="button"
                disabled={!file.data || busy}
                onClick={() => {
                  setPrompt(x);
                  void ask(undefined, x);
                }}
                className="h-7 rounded-md border px-2 text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {x}
              </button>
            ))}
          </div>
        )}

        <div data-agent-controls className="flex flex-wrap items-center gap-2">
          <Segmented
            size="xs"
            label="Universe"
            value={spec.index}
            onChange={(v) => setSpec((s) => ({ ...s, index: v }))}
            options={(Object.keys(INDEX_LABELS) as Spec["index"][]).map((k) => ({ v: k, l: INDEX_LABELS[k] }))}
          />
          <Select value={spec.sectors[0] ?? "All"} onValueChange={(v) => setSpec((s) => ({ ...s, sectors: v === "All" ? [] : [v] }))}>
            <SelectTrigger aria-label="Sector" className="h-8 w-48 text-xs">
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
          <FilterPopover groups={groups} count={countFor} onSave={(f) => setFilter(null, f)}>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!file.data}>
              <Plus /> Add filter
            </Button>
          </FilterPopover>
          <PresetPopover onPick={applyPreset} />
          <div className="relative ml-auto w-full sm:w-52">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in results" aria-label="Find in results" className="h-8 pl-7 text-xs" />
          </div>
        </div>

        {isActive(spec) && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Active criteria">
            {spec.filters.map((f, i) =>
              live.missing.includes(i) ? (
                <span key={`${f.field}-${i}`} title="This field is not available right now, so the filter is not applied. It applies again once the field loads." className="inline-flex h-7 items-center rounded-md border border-dashed text-xs text-muted-foreground">
                  <span className="pl-2 pr-1">
                    {filterText(f, NAMES)} · unavailable, not applied
                  </span>
                  <button type="button" aria-label={`Remove ${filterText(f, NAMES)}`} onClick={() => removeFilter(i)} className="grid h-full w-6 place-items-center rounded-r-md hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <X className="size-3" />
                  </button>
                </span>
              ) : (
              <span key={`${f.field}-${i}`} className="inline-flex h-7 items-center rounded-md border bg-secondary/60 text-xs">
                <FilterPopover groups={groups} count={countFor} initial={f} onSave={(nf) => setFilter(i, nf)}>
                  <button type="button" title={`${F.get(f.field)?.d ?? ""}\nClick to edit`} className="h-full rounded-l-md pl-2 pr-1 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {filterText(f, F)}
                  </button>
                </FilterPopover>
                <button type="button" aria-label={`Remove ${filterText(f, F)}`} onClick={() => removeFilter(i)} className="grid h-full w-6 place-items-center rounded-r-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="size-3" />
                </button>
              </span>
              ),
            )}
            {[
              ...spec.sectors.map((x) => ({ t: `Sector: ${x}`, rm: (s: Spec) => ({ ...s, sectors: s.sectors.filter((y) => y !== x) }) })),
              ...spec.exclude_sectors.map((x) => ({ t: `Not ${x}`, rm: (s: Spec) => ({ ...s, exclude_sectors: s.exclude_sectors.filter((y) => y !== x) }) })),
              ...spec.industries.map((x) => ({ t: `Industry: ${x}`, rm: (s: Spec) => ({ ...s, industries: s.industries.filter((y) => y !== x) }) })),
              ...spec.exclude_industries.map((x) => ({ t: `Not ${x}`, rm: (s: Spec) => ({ ...s, exclude_industries: s.exclude_industries.filter((y) => y !== x) }) })),
              ...(spec.tickers.length ? [{ t: `Only ${spec.tickers.join(", ")}`, rm: (s: Spec) => ({ ...s, tickers: [] }) }] : []),
              ...(spec.exclude_tickers.length ? [{ t: `Not ${spec.exclude_tickers.join(", ")}`, rm: (s: Spec) => ({ ...s, exclude_tickers: [] }) }] : []),
              ...(spec.similar_to ? [{ t: `Closest ${spec.similar_to.n} to ${spec.similar_to.ticker}`, rm: (s: Spec) => ({ ...s, similar_to: null, sort: s.sort?.field === "similarity" ? null : s.sort }) }] : []),
            ].map((c) => (
              <span key={c.t} className="inline-flex h-7 items-center rounded-md border text-xs">
                <span className="pl-2 pr-1">{c.t}</span>
                <button type="button" aria-label={`Remove ${c.t}`} onClick={() => setSpec(c.rm)} className="grid h-full w-6 place-items-center rounded-r-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <Button size="xs" variant="ghost" onClick={reset}>
              Clear screen
            </Button>
            <Button size="xs" variant="ghost" onClick={() => void copyLink()} title="Copy a link that opens this screen">
              {copied ? <Check /> : <Link2 />} {copied ? "Link copied" : "Copy link"}
            </Button>
          </div>
        )}

        {notice && (
          <p role="status" className="mt-2 text-[11px] text-muted-foreground">
            {notice}
          </p>
        )}
        {agent?.error && (
          <p role="alert" className="text-[13px] text-negative">
            {agent.error}
          </p>
        )}
        {(spec.explanation || agent?.model || !!agent?.errors?.length) && (
          <div className="border-l-2 border-highlight bg-card/60 px-3 py-2 text-[13px]">
            {agent?.prompt && (
              <p className="text-[11px] text-muted-foreground">
                “{agent.prompt}”{agent.model ? ` · screen agent (${agent.model})` : ""}
              </p>
            )}
            {spec.explanation && <p className="mt-0.5">{spec.explanation}</p>}
            {spec.assumptions.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground">
                {spec.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
            {!!agent?.errors?.length && <p className="mt-1 text-[11px] text-negative">Dropped: {agent.errors.join("; ")}</p>}
            {agent?.model && <p className="mt-1 text-[11px] text-muted-foreground">The agent only chooses fields and thresholds; every value in the table comes from the dataset.</p>}
          </div>
        )}
      </section>

      <section data-section="Screen results" className="min-w-0">
        {!res ? (
          <Skeleton className="h-[480px]" />
        ) : (
          <div className="rounded-md border bg-card shadow-paper">
            <div data-agent-controls className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
              <p className="text-[13px]" aria-live="polite">
                <span className="num font-semibold">{res.rows.length.toLocaleString()}</span>
                <span className="text-muted-foreground"> of {res.uni.length.toLocaleString()} companies</span>
                {sortName && (
                  <span className="text-[11px] text-muted-foreground">
                    {" "}
                    · sorted by {sortName} {spec.sort!.dir === "asc" ? "ascending" : "descending"}
                  </span>
                )}
              </p>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Companies without a full screener row: SEC fundamentals and live-price valuation only; technicals, correlations and insider fields are empty for them.">
                  <Switch checked={basic} onCheckedChange={setBasic} aria-label="Include fundamentals-only companies" />
                  Fundamentals-only {nBasic ? `(${nBasic})` : ""}
                </label>
                <Select value={spec.group_by ?? "none"} onValueChange={(v) => setSpec((s) => ({ ...s, group_by: v === "none" ? null : v }))}>
                  <SelectTrigger aria-label="Group by" className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No grouping</SelectItem>
                    <SelectItem value="sector">By sector</SelectItem>
                    <SelectItem value="industry">By industry</SelectItem>
                    <SelectItem value="mcap_bucket">By size</SelectItem>
                    {spec.sort && spec.sort.field !== "similarity" && <SelectItem value={`quintile:${spec.sort.field}`}>Quintiles of sort</SelectItem>}
                  </SelectContent>
                </Select>
                <ColumnsPopover
                  groups={groups}
                  cols={cols}
                  setName={spec.columns.length ? null : colset}
                  onSet={(name) => {
                    setColset(name);
                    setSpec((s) => ({ ...s, columns: [] }));
                  }}
                  onCols={(next) => setSpec((s) => ({ ...s, columns: next }))}
                />
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={csv} disabled={!shownRows.length} title="Download the rows and columns shown, in this order">
                  <Download /> CSV
                </Button>
              </div>
            </div>
            {res.rows.length ? (
              <ResultsTable rows={res.rows} grouped={grouped?.groups ?? null} cols={cols} F={F} spec={spec} sim={res.sim} sortBy={sortBy} onOpen={openCompany} />
            ) : (
              <NoResults impact={impact} q={q} qAlone={res && q ? searchAlone(rows, live.spec, F, q) : null} onRemove={removeFilter} onClearQuery={() => setQ("")} onReset={reset} />
            )}
            <p className="border-t px-3 py-2 text-[11px] leading-4 text-muted-foreground">
              Fundamentals from SEC filings (trailing four quarters unless named); prices daily, with valuation moved to the live quote where one is available; dollar volume and short volume from the daily setup feed. Rows marked “basic” carry SEC fundamentals only. Hover a column head for its definition and source; open a company for every underlying filing value.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function groupRows(rows: Row[], key: (r: Row) => string): [string, Row[]][] {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return [...m.entries()];
}

/* ---------- results table ---------- */

type Item = { kind: "group"; label: string; rows: Row[] } | { kind: "row"; r: Row };

function ResultsTable({
  rows,
  grouped,
  cols,
  F,
  spec,
  sim,
  sortBy,
  onOpen,
}: {
  rows: Row[];
  grouped: [string, Row[]][] | null;
  cols: string[];
  F: Map<string, FieldDef>;
  spec: Spec;
  sim: Map<string, number> | null;
  sortBy: (id: string) => void;
  onOpen: (t: string) => void;
}) {
  const [wrap, fits] = useFits<HTMLDivElement>();
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  const items: Item[] = useMemo(
    () => (grouped ? grouped.flatMap(([label, list]) => [{ kind: "group" as const, label, rows: list }, ...list.map((r) => ({ kind: "row" as const, r }))]) : rows.map((r) => ({ kind: "row" as const, r }))),
    [grouped, rows],
  );
  const [start, end] = useWindowRange(body, items.length);
  const nav = useMemo(() => {
    const keys: string[] = [];
    const at = new Map<string, number>();
    items.forEach((it, i) => {
      if (it.kind === "row") {
        keys.push(it.r.ticker);
        at.set(it.r.ticker, i);
      }
    });
    return { keys, pos: (k: string) => at.get(k) ?? 0 };
  }, [items]);
  const focus = useRowFocus(body, nav.keys, nav.pos, "fu:screener:focus");
  const firstRendered = items.slice(start, end).find((it) => it.kind === "row");
  const firstKey = firstRendered?.kind === "row" ? firstRendered.r.ticker : undefined;
  const span = cols.length + 1 + (sim ? 1 : 0);
  const head = cn("border-b bg-card", fits && `sticky ${STICKY} z-20`);
  return (
    // overflow-anchor: none: rows are keyed by ticker, so after a sort the browser's scroll anchoring would
    // follow a row that moved and shift the page (review H2: 6 of 60 sort clicks).
    <div ref={wrap} className={cn("relative", !fits && "overflow-x-auto scrollbar-thin")} style={{ overflowAnchor: "none" }}>
      <table className={cn("border-separate border-spacing-0 text-[13px] leading-5", fits ? "w-full" : "w-max min-w-full")}>
        <thead>
          <tr>
            <th scope="col" className={cn(head, "left-0 z-30 min-w-60 border-r px-3 py-1.5 text-left align-bottom", !fits && "sticky")}>
              <span className="eyebrow">Company</span>
            </th>
            {sim && (
              <th scope="col" className={cn(head, "px-3 py-1.5 text-right align-bottom text-[11px] font-medium text-muted-foreground")} title="Distance across standardized fundamentals and market traits; lower is closer">
                Distance
              </th>
            )}
            {cols.map((id) => {
              const f = F.get(id)!;
              const on = spec.sort?.field === id;
              return (
                <th key={id} scope="col" aria-sort={on ? (spec.sort!.dir === "asc" ? "ascending" : "descending") : "none"} className={cn(head, "min-w-[5.5rem] px-3 py-1.5 text-right align-bottom")}>
                  <button
                    type="button"
                    onClick={() => sortBy(id)}
                    title={`${f.n}\n${f.d}${f.src ? `\nSource: ${f.src}` : ""}${LIVE_FIELDS.has(id) ? "\nUpdated to the live price where quoted." : ""}\nClick to sort`}
                    className={cn(
                      "ml-auto inline-flex max-w-32 items-end justify-end gap-1 rounded-sm text-right text-[11px] font-medium leading-4 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span className="whitespace-normal">{f.n}</span>
                    {on ? spec.sort!.dir === "asc" ? <ArrowUp className="mb-0.5 size-3 shrink-0" /> : <ArrowDown className="mb-0.5 size-3 shrink-0" /> : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={setBody}>
          {start > 0 && (
            <tr aria-hidden style={{ height: start * ROW_H }}>
              <td colSpan={span} />
            </tr>
          )}
          {items.slice(start, end).map((it) =>
            it.kind === "group" ? (
              <GroupHead key={`g:${it.label}`} label={it.label} rows={it.rows} cols={cols} F={F} sim={sim} sticky={!fits} />
            ) : (
              <ResultRow key={it.r.ticker} r={it.r} cols={cols} F={F} sim={sim} sticky={!fits} sortField={spec.sort?.field} onOpen={onOpen} tab={focus.tabIndex(it.r.ticker, firstKey)} onRowFocus={focus.onFocus} onRowBlur={focus.onBlur} onRowKey={focus.onKey} />
            ),
          )}
          {end < items.length && (
            <tr aria-hidden style={{ height: (items.length - end) * ROW_H }}>
              <td colSpan={span} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const ResultRow = memo(function ResultRow({
  r,
  cols,
  F,
  sim,
  sticky,
  sortField,
  onOpen,
  tab,
  onRowFocus,
  onRowBlur,
  onRowKey,
}: {
  r: Row;
  cols: string[];
  F: Map<string, FieldDef>;
  sim: Map<string, number> | null;
  sticky: boolean;
  sortField?: string;
  onOpen: (t: string) => void;
  tab: number;
  onRowFocus: (key: string) => void;
  onRowBlur: (e: FocusEvent<HTMLElement>) => void;
  onRowKey: (e: KeyboardEvent<HTMLElement>, key: string, open: () => void) => void;
}) {
  return (
    <tr
      data-row
      data-key={r.ticker}
      tabIndex={tab}
      onClick={() => onOpen(r.ticker)}
      onFocus={() => onRowFocus(r.ticker)}
      onBlur={onRowBlur}
      onKeyDown={(e) => onRowKey(e, r.ticker, () => onOpen(r.ticker))}
      aria-label={`${r.ticker} ${r.name}`}
      className="group h-[29px] cursor-pointer focus-visible:outline-none [&>td]:transition-colors [&>td]:duration-150 focus-visible:[&>td]:bg-highlight-soft"
    >
      <td className={cn("left-0 z-10 w-64 max-w-64 border-b border-r bg-card px-3 py-1 group-hover:bg-secondary", sticky && "sticky")}>
        <span className="flex min-w-0 items-center gap-2" title={`${r.name} · ${r.sector} · ${r.industry}`}>
          {/* A real link (open in a new tab, the assistant can follow it) outside the tab order: the row is the tab stop. */}
          <Link to="/app/companies/$ticker" params={{ ticker: r.ticker }} tabIndex={-1} onClick={(e) => e.stopPropagation()} className="min-w-0 rounded-sm hover:underline">
            <TickerMark ticker={r.ticker} name={r.name} link={false} className="min-w-0" />
          </Link>
          {r.basic && (
            <span className="shrink-0 rounded border px-1 text-[10px] leading-4 text-muted-foreground" title="SEC fundamentals only; no technicals, correlations or insider fields">
              basic
            </span>
          )}
        </span>
      </td>
      {sim && <td className="num border-b px-3 py-1 text-right group-hover:bg-secondary">{sim.get(r.ticker)?.toFixed(2) ?? "–"}</td>}
      {cols.map((id) => {
        const v = r[id];
        const f = F.get(id);
        const missing = v == null && r.basic && !BASIC_FIELDS.has(id) && !SERIES_FIELD_IDS.has(id);
        const filled = Array.isArray(r.filled) && (r.filled as string[]).includes(id);
        return (
          <td
            key={id}
            title={missing ? "Not computed for fundamentals-only rows" : filled ? "Computed from the company's SEC fundamentals (trailing four quarters) at the current price" : SERIES_FIELD_IDS.has(id) && v != null && typeof r.series_asof === "string" ? `As of ${fmtDate(r.series_asof)}` : undefined}
            className={cn(
              "num whitespace-nowrap border-b px-3 py-1 text-right group-hover:bg-secondary",
              id === sortField && "font-medium",
              v == null && "text-muted-foreground/60",
            )}
          >
            {fmtField(f, v)}
          </td>
        );
      })}
    </tr>
  );
});

function median(rows: Row[], id: string) {
  const a = rows.map((r) => r[id]).filter((v): v is number => typeof v === "number").sort((x, y) => x - y);
  if (!a.length) return null;
  return a.length % 2 ? a[a.length >> 1] : (a[(a.length >> 1) - 1] + a[a.length >> 1]) / 2;
}

function GroupHead({ label, rows, cols, F, sim, sticky }: { label: string; rows: Row[]; cols: string[]; F: Map<string, FieldDef>; sim: Map<string, number> | null; sticky: boolean }) {
  return (
    <tr className="h-[29px]">
      <th scope="rowgroup" className={cn("left-0 z-10 whitespace-nowrap border-b border-r bg-secondary px-3 py-1 text-left text-[13px] font-semibold", sticky && "sticky")}>
        {label} <span className="text-[11px] font-normal text-muted-foreground">· {rows.length} · median</span>
      </th>
      {sim && <td className="border-b bg-secondary" />}
      {cols.map((id) => (
        <td key={id} className="num whitespace-nowrap border-b bg-secondary px-3 py-1 text-right text-[13px] font-semibold">
          {fmtField(F.get(id), median(rows, id))}
        </td>
      ))}
    </tr>
  );
}

function NoResults({
  impact,
  q,
  onRemove,
  onClearQuery,
  onReset,
  qAlone,
}: {
  impact: ReturnType<typeof filterImpact> | null;
  q: string;
  qAlone: number | null;
  onRemove: (i: number) => void;
  onClearQuery: () => void;
  onReset: () => void;
}) {
  const best = impact?.length ? [...impact].sort((a, b) => b.without - a.without)[0] : null;
  return (
    <div className="space-y-2 px-3 py-4 text-[13px]">
      <p className="font-semibold">No companies pass every criterion.</p>
      {q && (
        <p className="text-muted-foreground">
          {qAlone === 0 ? `The search “${q}” matches no company on its own.` : `The search “${q}” also narrows the list.`}{" "}
          <button type="button" onClick={onClearQuery} className="text-link hover:underline">
            Clear the search
          </button>
        </p>
      )}
      {impact?.length && qAlone !== 0 ? (
        <>
          <p className="text-muted-foreground">
            {best && best.without > 0
              ? `Removing “${best.text}” brings back ${best.without.toLocaleString()} ${best.without === 1 ? "company" : "companies"}.`
              : "No single filter is the cause; widen several thresholds or clear the screen."}
          </p>
          <table className="text-[13px] leading-5">
            <thead>
              <tr className="text-[11px] text-muted-foreground">
                <th className="py-1 pr-4 text-left font-medium">Filter</th>
                <th className="px-3 py-1 text-right font-medium">Pass it alone</th>
                <th className="px-3 py-1 text-right font-medium">Results without it</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {impact.map((x) => (
                <tr key={x.i} className="border-t">
                  <td className="py-1 pr-4">{x.text}</td>
                  <td className="num px-3 py-1 text-right">{x.alone.toLocaleString()}</td>
                  <td className="num px-3 py-1 text-right">{x.without.toLocaleString()}</td>
                  <td className="py-1 pl-2">
                    <Button size="xs" variant="ghost" onClick={() => onRemove(x.i)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        !q && (
          <p className="text-muted-foreground">
            The universe or sector choice leaves no companies.{" "}
            <button type="button" onClick={onReset} className="text-link hover:underline">
              Clear the screen
            </button>
          </p>
        )
      )}
    </div>
  );
}

/* ---------- builder popovers ---------- */

function FieldPicker({ groups, onPick, selected, multi }: { groups: FieldGroup[]; onPick: (f: FieldDef) => void; selected?: Set<string>; multi?: boolean }) {
  const [q, setQ] = useState("");
  const shown = groups.map((g) => ({ ...g, fields: g.fields.filter((f) => matchField(f, q)) })).filter((g) => g.fields.length);
  return (
    <div>
      <div className="relative border-b p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields" aria-label="Search fields" className="h-8 pl-7 text-xs" />
      </div>
      <div className="max-h-80 overflow-y-auto overscroll-contain p-1 scrollbar-thin">
        {shown.map((g) => (
          <div key={g.id} className="py-1">
            <p className="eyebrow px-2 py-1">{g.n}</p>
            {g.fields.map((f) => {
              const on = selected?.has(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  role={multi ? "menuitemcheckbox" : undefined}
                  aria-checked={multi ? !!on : undefined}
                  onClick={() => onPick(f)}
                  title={f.d}
                  className="flex min-h-7 w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {multi && <span className={cn("grid size-3.5 shrink-0 place-items-center rounded-sm border", on && "border-foreground bg-foreground text-background")}>{on && <Check className="size-3" />}</span>}
                  <span className="min-w-0 flex-1 truncate">{f.n}</span>
                </button>
              );
            })}
          </div>
        ))}
        {!shown.length && <p className="px-2 py-3 text-xs text-muted-foreground">No field matches “{q}”.</p>}
      </div>
    </div>
  );
}

function FilterPopover({ groups, count, onSave, initial, children }: { groups: FieldGroup[]; count: (f: Filter) => number; onSave: (f: Filter) => void; initial?: Filter; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const field = useMemo(() => (initial ? groups.flatMap((g) => g.fields).find((f) => f.id === initial.field) ?? null : null), [groups, initial]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-80 p-0">
        {open && (
          <FilterEditor
            groups={groups}
            initialField={field}
            initial={initial}
            count={count}
            onSave={(f) => {
              onSave(f);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterEditor({ groups, initialField, initial, count, onSave }: { groups: FieldGroup[]; initialField: FieldDef | null; initial?: Filter; count: (f: Filter) => number; onSave: (f: Filter) => void }) {
  const [field, setField] = useState<FieldDef | null>(initialField);
  const [op, setOp] = useState<Op>(initial?.op ?? ">");
  const [a, setA] = useState(() => {
    if (!initial || !initialField) return "";
    if (initial.op === "top" || initial.op === "bottom") return String(initial.pct ?? "");
    return Array.isArray(initial.value) ? formatInput(initialField, initial.value[0]) : formatInput(initialField, initial.value as number | undefined);
  });
  const [b, setB] = useState(() => (initial && initialField && Array.isArray(initial.value) ? formatInput(initialField, initial.value[1]) : ""));
  const [scope, setScope] = useState<Filter["scope"]>(initial?.scope ?? "all");
  if (!field)
    return (
      <FieldPicker
        groups={groups}
        onPick={(f) => {
          setField(f);
          setOp(f.u === "bool" ? "true" : ">");
          setA(f.q ? formatInput(f, f.q[1]) : "");
        }}
      />
    );
  const built = buildFilter(field, op, a, b, scope);
  const n = "filter" in built ? count(built.filter) : null;
  const unit = inputUnit(field);
  const ops = opsFor(field);
  const box = "h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <form
      className="space-y-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if ("filter" in built) onSave(built.filter);
      }}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold leading-5">{field.n}</p>
          {!initial && (
            <button type="button" onClick={() => setField(null)} className="text-[11px] text-link hover:underline">
              Change
            </button>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{field.d}</p>
        {field.q && field.u !== "bool" && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Typical range: {fmtField(field, field.q[0], true)} to {fmtField(field, field.q[2], true)}, median {fmtField(field, field.q[1], true)}
          </p>
        )}
      </div>
      <div role="radiogroup" aria-label="Comparison" className="flex flex-wrap gap-1">
        {ops.map((o) => (
          <button
            key={o.op}
            type="button"
            role="radio"
            aria-checked={op === o.op}
            onClick={() => setOp(o.op)}
            className={cn("h-7 rounded-md border px-2 text-[11px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", op === o.op ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
          >
            {o.l}
          </button>
        ))}
      </div>
      {op !== "true" && op !== "false" && op !== "exists" && (
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="sr-only">{op === "between" ? "Low" : "Value"}</span>
            <input autoFocus value={a} onChange={(e) => setA(e.target.value)} inputMode="decimal" placeholder={op === "between" ? "low" : op === "top" || op === "bottom" ? "share" : "value"} className={box} aria-label={op === "between" ? "Low value" : "Value"} />
            <span className="shrink-0">{op === "top" || op === "bottom" ? "%" : unit}</span>
          </label>
          {op === "between" && (
            <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
              <input value={b} onChange={(e) => setB(e.target.value)} inputMode="decimal" placeholder="high" className={box} aria-label="High value" />
              <span className="shrink-0">{unit}</span>
            </label>
          )}
        </div>
      )}
      {(op === "top" || op === "bottom") && (
        <Segmented size="xs" label="Ranked within" value={scope ?? "all"} onChange={(v) => setScope(v)} options={[{ v: "all", l: "All companies" }, { v: "sector", l: "Each sector" }, { v: "industry", l: "Each industry" }]} />
      )}
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {"error" in built ? built.error : n != null ? `${n.toLocaleString()} ${n === 1 ? "company" : "companies"} with this added` : ""}
        </p>
        <Button type="submit" size="xs" disabled={"error" in built}>
          {initial ? "Update" : "Add filter"}
        </Button>
      </div>
    </form>
  );
}

function PresetPopover({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 text-xs">
          Presets
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-96 p-1">
        <div className="max-h-96 overflow-y-auto overscroll-contain scrollbar-thin">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onPick(p.id);
                setOpen(false);
              }}
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block text-[13px] font-medium leading-5">{p.n}</span>
              <span className="block text-[11px] leading-4 text-muted-foreground">{p.why}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColumnsPopover({ groups, cols, setName, onSet, onCols }: { groups: FieldGroup[]; cols: string[]; setName: string | null; onSet: (n: string) => void; onCols: (c: string[]) => void }) {
  const selected = new Set(cols);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 text-xs" aria-label="Choose columns">
          <Columns3 /> {setName ?? "Custom"} · {cols.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="w-80 p-0">
        <div className="border-b p-2">
          <p className="eyebrow mb-1.5">Column sets</p>
          <div role="radiogroup" aria-label="Column set" className="flex flex-wrap gap-1">
            {COLSET_NAMES.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={setName === n}
                onClick={() => onSet(n)}
                className={cn("h-7 rounded-md border px-2 text-[11px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", setName === n ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <FieldPicker
          multi
          groups={groups}
          selected={selected}
          onPick={(f) => onCols(selected.has(f.id) ? cols.filter((c) => c !== f.id) : [...cols, f.id])}
        />
      </PopoverContent>
    </Popover>
  );
}
