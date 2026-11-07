import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Segmented } from "@/components/app/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { fmtDate } from "@/lib/format";
import {
  filedDocQuery,
  filedIndexQuery,
  fmtMillions,
  isTotalTemplateLine,
  periodsFor,
  startOf,
  stdFileQuery,
  stdMapQuery,
  stdSeries,
  stdValue,
  STMT_LABEL,
  STMT_ORDER,
  TEMPLATE_NAME,
  type Basis,
  type StdPoint,
  type TemplateLine,
} from "@/lib/statements/filed";
import { FiledGrid, type GridRow } from "./filed-grid";

const unitFor = (id: string) => (/eps|dps/.test(id) ? "usdPerShare" : /shares/.test(id) ? "shares" : "usd");
const conceptOf = (p: StdPoint) => (p.tag.includes(":") ? p.tag : `us-gaap:${p.tag}`);

/** Every filing mapped onto one of five industry templates, so companies line up line for line. */
export function IndustryTemplate({ ticker }: { ticker: string }) {
  const index = useQuery(filedIndexQuery(ticker));
  const std = useQuery(stdFileQuery(ticker));
  const map = useQuery(stdMapQuery);
  const [kind, setKind] = useState<"A" | "Q">("A");
  const [basis, setBasis] = useState<Basis>("latest");
  const { open, target } = useSource();
  const series = useMemo(() => (std.data ? stdSeries(std.data) : null), [std.data]);

  const err = index.error ?? std.error ?? map.error;
  if (err) return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Standardized statements for {ticker} are not available ({(err as Error).message}).</p>;
  if (!index.data || !series || !map.data) return <Skeleton className="h-[480px]" />;
  const latest = index.data.filings[0];
  if (!latest) return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No filings on file for {ticker}.</p>;
  const tpl = latest.template;
  const lines = map.data.templates[tpl] ?? [];
  const ends = periodsFor(series, kind).slice(-(kind === "A" ? 10 : 12));
  const activeKey = target ? `${target.label}|${target.periodLabel}` : "";
  const periodLabel = (e: string) => (kind === "A" ? `FY ending ${fmtDate(e)}` : `Quarter ending ${fmtDate(e)}`);

  const openValue = (line: TemplateLine, e: string, val: NonNullable<ReturnType<typeof stdValue>>) => {
    const base = { ticker, label: line.label, periodLabel: periodLabel(e), unit: unitFor(line.id), value: val.v };
    if (val.derived) {
      const { from, minus } = val.derived;
      open({
        ...base,
        derived: {
          formula: `${from.q * 3}M YTD − ${minus.q * 3}M YTD`,
          parts: [
            { accn: from.a, concept: conceptOf(from), start: startOf(from.d, from.q), end: from.d, value: from.v, label: `${from.q * 3} months to ${fmtDate(from.d)} (${from.form})`, sign: 1 },
            { accn: minus.a, concept: conceptOf(minus), start: startOf(minus.d, minus.q), end: minus.d, value: minus.v, label: `${minus.q * 3} months to ${fmtDate(minus.d)} (${minus.form})`, sign: -1 },
          ],
        },
      });
      return;
    }
    if (val.p.tag === "calc") {
      const parts = (line.calc ?? "").split(/\s[+-]\s/);
      const inputs = lines
        .filter((l) => parts.includes(l.label))
        .map((l) => ({ l, x: stdValue(series, l, e, kind, basis) }))
        .filter((z): z is { l: TemplateLine; x: NonNullable<ReturnType<typeof stdValue>> } => !!z.x && z.x.p.tag !== "calc");
      open({
        ...base,
        derived: {
          formula: val.p.plabel,
          parts: inputs.map(({ l, x }) => ({ accn: x.p.a, concept: conceptOf(x.p), start: startOf(x.p.d, x.p.q), end: x.p.d, value: x.v, label: l.label, sign: /\s-\s/.test(` ${line.calc ?? ""} `.split(l.label)[0].slice(-3)) ? -1 : 1 })),
        },
      });
      return;
    }
    open({ ...base, src: { accn: val.p.a, concept: conceptOf(val.p), start: startOf(val.p.d, val.p.q), end: val.p.d, value: val.p.v } });
  };

  const rows: GridRow[] = [];
  let lastStmt: string | null = null;
  for (const line of [...lines].sort((a, b) => STMT_ORDER[a.stmt] - STMT_ORDER[b.stmt])) {
    const cells = ends.map((e) => stdValue(series, line, e, kind, basis));
    if (!cells.some(Boolean)) continue;
    if (line.stmt !== lastStmt) {
      rows.push({ key: `g-${line.stmt}`, label: STMT_LABEL[line.stmt], kind: "group", cells: [] });
      lastStmt = line.stmt;
    }
    const per = /eps|dps/.test(line.id);
    const filed = [...new Set(cells.filter(Boolean).map((c) => c!.p.plabel))];
    rows.push({
      key: line.id,
      label: line.label,
      title: `${line.label}\nTags, in priority order: ${line.tags.length ? line.tags.join(", ") : line.calc}\nFiled as: ${filed.join(" | ")}`,
      kind: isTotalTemplateLine(line.id) ? "total" : undefined,
      cells: cells.map((c, i) =>
        !c
          ? null
          : {
              text: fmtMillions(c.v, per),
              negative: c.v < 0,
              mark: c.derived ? "derived" : c.p.tag === "calc" ? "calc" : c.restated ? "restated" : undefined,
              italic: !!c.derived || c.p.tag === "calc",
              title:
                c.p.tag === "calc"
                  ? `Calculated: ${c.p.plabel}`
                  : `Filed as "${c.p.plabel}" (${c.p.tag})\n${c.p.form} filed ${fmtDate(c.p.filed)}${c.restated ? "\nA different value was reported for this period in another filing" : ""}${c.derived ? "\nDerived: year-to-date minus prior year-to-date" : ""}`,
              onClick: () => openValue(line, ends[i], c),
              active: activeKey === `${line.label}|${periodLabel(ends[i])}`,
            },
      ),
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">
          <span className="font-medium">{TEMPLATE_NAME[tpl]} template</span>
          <span className="text-muted-foreground"> · from SIC {latest.sic ?? "–"}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Segmented label="Frequency" value={kind} onChange={setKind} options={[{ v: "A", l: "Annual" }, { v: "Q", l: "Quarterly" }]} />
          <Segmented
            label="Basis"
            value={basis}
            onChange={setBasis}
            options={[
              { v: "latest", l: "Latest filed", title: "The most recent filing that presented each period, restatements included" },
              { v: "first", l: "As first reported", title: "The original filing for each period" },
            ]}
          />
        </div>
      </div>
      <FiledGrid
        head="Template line"
        columns={ends.map((e) => ({ key: e, top: kind === "A" ? "Fiscal year" : "Quarter", bottom: fmtDate(e) }))}
        rows={rows}
        footer={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-chart-3" /> Derived quarter</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-chart-4" /> Calculated</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-chart-5" /> Restated in a later filing</span>
            <span>USD millions except per share. Each value comes from one filing in the SEC Financial Statement Data Sets; hover for the filed label, click for the filing.</span>
          </span>
        }
      />
      <MappingTable ticker={ticker} accession={latest.a} lines={lines} />
    </div>
  );
}

/** How the latest filing's own lines map onto the template. */
function MappingTable({ ticker, accession, lines }: { ticker: string; accession: string; lines: TemplateLine[] }) {
  const doc = useQuery(filedDocQuery(ticker, accession));
  const [openList, setOpenList] = useState(false);
  if (!doc.data) return null;
  const lab = Object.fromEntries(lines.map((l) => [l.id, l.label]));
  const mapped: Record<string, string> = {};
  for (const [lid, pts] of Object.entries(doc.data.std.lines)) {
    const p = pts[0] as unknown[];
    if (p?.[4] != null) mapped[`${p[4]}:${p[5]}`] = lid;
  }
  const rows: GridRow[] = [];
  for (const r of doc.data.reports.filter((x) => ["IS", "BS", "CF"].includes(x.stmt) && !x.inpth).sort((a, b) => STMT_ORDER[a.stmt] - STMT_ORDER[b.stmt])) {
    rows.push({ key: `g-${r.report}`, label: STMT_LABEL[r.stmt], kind: "group", cells: [] });
    for (const ln of r.lines) {
      const lid = mapped[`${r.report}:${ln[0]}`];
      const unmapped = doc.data.std.unmapped.some((u) => u[0] === r.report && u[1] === ln[0]);
      if (!lid && !unmapped) continue;
      rows.push({ key: `${r.report}-${ln[0]}`, label: ln[3], cells: [{ text: ln[1] + (ln[2] ? " (extension)" : "") }, { text: lid ? lab[lid] : "Not mapped" }] });
    }
  }
  return (
    <div className="grid gap-2">
      <button onClick={() => setOpenList((v) => !v)} className="w-fit text-xs text-link hover:underline">
        {openList ? "Hide" : "Show"} how the {doc.data.form} filed {fmtDate(doc.data.filed)} maps onto the template
      </button>
      {openList && (
        <FiledGrid
          head="Filed line"
          columns={[{ key: "tag", top: "XBRL tag" }, { key: "line", top: "Template line" }]}
          rows={rows}
          scrollTo="start"
          maxHeight="420px"
          footer="Template lines take the first matching tag in priority order (hover a template line above for the list). Lines marked not mapped stay in the as-reported view and are not added into any template line."
        />
      )}
    </div>
  );
}
