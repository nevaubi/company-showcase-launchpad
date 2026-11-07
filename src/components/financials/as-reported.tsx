import { useQuery } from "@tanstack/react-query";
import { friendlyError } from "@/lib/errors";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Segmented } from "@/components/app/segmented";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { fmtDate } from "@/lib/format";
import {
  filedDocQuery,
  filedIndexQuery,
  filingName,
  fmtFiled,
  isTotalLine,
  memberText,
  SCALE_WORD,
  scaleFor,
  startOf,
  STMT_LABEL,
  STMT_ORDER,
  unitOf,
  type FiledDoc,
  type FiledFact,
  type FiledReport,
  type FiledScale,
} from "@/lib/statements/filed";
import { FiledGrid, type GridColumn, type GridRow } from "./filed-grid";

/** Statements exactly as the company filed them: labels, order, signs and rounding of the filing. */
export function AsReported({ ticker }: { ticker: string }) {
  const index = useQuery(filedIndexQuery(ticker));
  const [accession, setAccession] = useState<string | null>(null);
  const filings = index.data?.filings ?? [];
  const meta = filings.find((f) => f.a === accession) ?? filings[0];
  const doc = useQuery({ ...filedDocQuery(ticker, meta?.a ?? ""), enabled: !!meta });
  const [report, setReport] = useState<number | null>(null);
  const [detail, setDetail] = useState(false);

  if (index.isError)
    return (
      <Empty
        text={`As-filed statements for ${ticker} are not loaded yet. ${friendlyError(index.error)}`}
      />
    );
  if (!index.data) return <Skeleton className="h-[480px]" />;
  if (!filings.length)
    return <Empty text={`No 10-K or 10-Q statements are on file for ${ticker} yet.`} />;

  const reps = doc.data
    ? [...doc.data.reports].sort(
        (a, b) =>
          STMT_ORDER[a.stmt] - STMT_ORDER[b.stmt] || a.inpth - b.inpth || a.report - b.report,
      )
    : [];
  const current =
    reps.find((r) => r.report === report) ??
    reps.find((r) => r.stmt === "IS" && !r.inpth) ??
    reps[0];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filing"
          value={meta.a}
          onChange={(e) => {
            setAccession(e.target.value);
            setReport(null);
          }}
          className="h-8 max-w-full truncate rounded-md border bg-card px-2 text-xs"
        >
          {filings.map((f, i) => (
            <option key={f.a} value={f.a}>
              {i === 0 ? "Latest: " : ""}
              {filingName(f, (d) => fmtDate(d))}
              {f.prevrpt ? " (amended later)" : ""}
            </option>
          ))}
        </select>
        {reps.length > 0 && current && (
          <Segmented
            label="Statement"
            value={String(current.report)}
            onChange={(v) => setReport(Number(v))}
            options={reps.map((r) => ({
              v: String(r.report),
              l: STMT_LABEL[r.stmt] + (r.inpth ? " (parenthetical)" : ""),
            }))}
          />
        )}
        <label
          className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground"
          title="Segment, product and geography breakdowns the filing tags against each line (from its notes)"
        >
          <Switch checked={detail} onCheckedChange={setDetail} aria-label="Show breakdowns" />{" "}
          Breakdowns
        </label>
        <a
          href={meta.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-link hover:underline"
        >
          Filing index on EDGAR <ExternalLink className="size-3" />
        </a>
      </div>
      {doc.isError && <Empty text={`Could not load this filing. ${friendlyError(doc.error)}`} />}
      {!doc.data && !doc.isError && <Skeleton className="h-[420px]" />}
      {doc.data &&
        current &&
        (current.stmt === "EQ" ? (
          <EquityStatement ticker={ticker} doc={doc.data} r={current} />
        ) : (
          <Statement ticker={ticker} doc={doc.data} r={current} detail={detail} />
        ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{text}</p>;
}

function useOpenFact(ticker: string, doc: FiledDoc) {
  const { open, target } = useSource();
  const openFact = (label: string, tag: string, custom: boolean, f: FiledFact, shown: number) => {
    const unit = unitOf(f[3], tag, custom);
    open({
      ticker,
      label,
      periodLabel: f[2] ? `${f[2] * 3} months ended ${fmtDate(f[1])}` : `As of ${fmtDate(f[1])}`,
      unit:
        unit === "USD"
          ? "usd"
          : /\/shares$/.test(unit)
            ? "usdPerShare"
            : unit === "shares"
              ? "shares"
              : unit,
      value: shown,
      src: {
        accn: doc.accession,
        concept: custom ? `${ticker.toLowerCase()}:${tag}` : `us-gaap:${tag}`,
        start: startOf(f[1], f[2]),
        end: f[1],
        value: f[6]!,
      },
    });
  };
  const activeKey = target ? `${target.label}|${target.periodLabel}` : "";
  return { openFact, activeKey };
}

function caption(doc: FiledDoc, sc: FiledScale) {
  return `${doc.form} · ${doc.registrant} · accession ${doc.accession} · USD in ${SCALE_WORD[sc.money]}${sc.shares !== 1 ? `, shares in ${SCALE_WORD[sc.shares]}` : ""}, except per-share amounts`;
}

function Statement({
  ticker,
  doc,
  r,
  detail,
}: {
  ticker: string;
  doc: FiledDoc;
  r: FiledReport;
  detail: boolean;
}) {
  const { openFact, activeKey } = useOpenFact(ticker, doc);
  const sc = useMemo(() => scaleFor(r.facts, r.lines), [r]);
  const columns: [string, number][] = useMemo(() => {
    const plain = r.facts.filter((f) => !f[4] && !f[5]);
    const keys = [...new Set((plain.length ? plain : r.facts).map((f) => `${f[1]}|${f[2]}`))]
      .map((k) => k.split("|"))
      .map(([d, q]) => [d, Number(q)] as [string, number]);
    return keys.sort((a, b) => b[0].localeCompare(a[0]) || a[1] - b[1]);
  }, [r]);
  const cols: GridColumn[] = columns.map(([d, q]) => ({
    key: `${d}|${q}`,
    top: q ? `${q * 3} months ended` : "As of",
    bottom: fmtDate(d),
  }));
  const byTag = useMemo(() => {
    const m: Record<string, FiledFact[]> = {};
    for (const f of r.facts) (m[f[0]] ??= []).push(f);
    return m;
  }, [r]);

  const rows: GridRow[] = [];
  let prev: number | null = null;
  for (const ln of r.lines) {
    const [line, tag, customN, plabel, negN] = ln;
    const custom = !!customN;
    const negating = !!negN;
    if (prev != null && line > prev + 1)
      rows.push({ key: `sp-${line}`, label: "", kind: "spacer", cells: [] });
    prev = line;
    const facts = byTag[tag] ?? [];
    const groups: Record<string, FiledFact[]> = {};
    for (const f of facts) (groups[`${f[4] ?? ""}|${f[5] ?? ""}`] ??= []).push(f);
    const keys = Object.keys(groups)
      .filter((k) => detail || k === "|")
      .sort((a, b) => (a === "|" ? -1 : b === "|" ? 1 : a.localeCompare(b)));
    if (!keys.length) keys.push("|");
    for (const k of keys) {
      const sub = k !== "|";
      const [seg, coreg] = k.split("|");
      const name = sub ? memberText(seg, coreg) : plabel;
      const label = `${plabel}${sub ? ` · ${name}` : ""}`;
      rows.push({
        key: `${line}-${tag}-${k}`,
        label: name,
        title: `${plabel}\n${custom ? "Company extension tag" : "us-gaap"}: ${tag}${negating ? "\nNegated label: the filing shows this value with its sign reversed" : ""}${sub ? `\n${k.replace("|", " ")}` : ""}`,
        kind: sub ? "sub" : isTotalLine(ln) ? "total" : undefined,
        cells: columns.map(([d, q]) => {
          const f = (groups[k] ?? []).find((x) => x[1] === d && x[2] === q);
          if (!f || f[6] == null) return null;
          const shown = negating ? -f[6] : f[6];
          const unit = unitOf(f[3], tag, custom);
          const periodLabel = q ? `${q * 3} months ended ${fmtDate(d)}` : `As of ${fmtDate(d)}`;
          return {
            text: fmtFiled(shown, unit, sc),
            negative: shown < 0,
            title: `${f[6].toLocaleString("en-US")} ${unit} · ${tag}${f[7] ? `\nFootnote: ${f[7]}` : ""}`,
            onClick: () => openFact(label, tag, custom, f, shown),
            active: activeKey === `${label}|${periodLabel}`,
          };
        }),
      });
    }
  }
  return (
    <FiledGrid
      head={STMT_LABEL[r.stmt] + (r.inpth ? " (parenthetical)" : "")}
      columns={cols}
      rows={rows}
      scrollTo="start"
      footer={
        <>
          {caption(doc, sc)}. Labels, order and signs as filed; click a value to open the filing.
          Source: SEC Financial Statement Data Sets (
          {doc.source?.split("/").pop() ?? "quarterly set"}), statement {r.report} as rendered by
          EDGAR. Period ends are SEC's month-end rounding.
        </>
      }
    />
  );
}

/** Statement of equity: equity components as columns, each period's lines as a block. */
function EquityStatement({ ticker, doc, r }: { ticker: string; doc: FiledDoc; r: FiledReport }) {
  const { openFact, activeKey } = useOpenFact(ticker, doc);
  const sc = useMemo(() => scaleFor(r.facts, r.lines), [r]);
  const comps = [...new Set(r.facts.map((f) => f[4] ?? ""))].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : 0,
  );
  const durs = [...new Set(r.facts.filter((f) => f[2] > 0).map((f) => `${f[1]}|${f[2]}`))]
    .map((k) => k.split("|"))
    .map(([d, q]) => [d, Number(q)] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  const byTag: Record<string, FiledFact[]> = {};
  for (const f of r.facts) (byTag[f[0]] ??= []).push(f);
  const firstDur = r.lines.findIndex((ln) => (byTag[ln[1]] ?? []).some((f) => f[2] > 0));
  const rows: GridRow[] = [];
  const blocks: [string | null, number][] = durs.length ? [...durs].reverse() : [[null, 0]];
  for (const [d, q] of blocks) {
    if (d)
      rows.push({
        key: `g-${d}-${q}`,
        label: `${q * 3} months ended ${fmtDate(d)}`,
        kind: "group",
        cells: [],
      });
    const begin = d ? startOfPrior(d, q) : null;
    r.lines.forEach((ln, li) => {
      const [, tag, customN, plabel, negN] = ln;
      const fs = byTag[tag] ?? [];
      const instant = fs.length > 0 && fs.every((f) => f[2] === 0);
      const want = (f: FiledFact) =>
        !d
          ? true
          : instant
            ? f[2] === 0 && f[1] === (li < firstDur ? begin : d)
            : f[1] === d && f[2] === q;
      const row = comps.map((c) => fs.find((f) => (f[4] ?? "") === c && !f[5] && want(f)));
      if (!row.some(Boolean)) return;
      rows.push({
        key: `${d}-${q}-${li}`,
        label: plabel,
        title: `${plabel}\n${customN ? "Company extension tag" : "us-gaap"}: ${tag}`,
        kind: instant || isTotalLine(ln) ? "total" : undefined,
        cells: row.map((f) => {
          if (!f || f[6] == null) return null;
          const shown = negN ? -f[6] : f[6];
          const unit = unitOf(f[3], tag, !!customN);
          const label = `${plabel}${f[4] ? ` · ${memberText(f[4])}` : ""}`;
          const periodLabel = f[2]
            ? `${f[2] * 3} months ended ${fmtDate(f[1])}`
            : `As of ${fmtDate(f[1])}`;
          return {
            text: fmtFiled(shown, unit, sc),
            negative: shown < 0,
            onClick: () => openFact(label, tag, !!customN, f, shown),
            active: activeKey === `${label}|${periodLabel}`,
          };
        }),
      });
    });
  }
  return (
    <FiledGrid
      head={STMT_LABEL.EQ}
      columns={comps.map((c) => ({
        key: c || "total",
        top: "Component",
        bottom: c ? memberText(c) : "Total",
      }))}
      rows={rows}
      scrollTo="start"
      footer={
        <>{caption(doc, sc)}. Equity components are the filing's EquityComponentsAxis members.</>
      }
    />
  );
}

/** Month end that opens a `q`-quarter period ending at `d` (the prior balance date). */
function startOfPrior(d: string, q: number) {
  const s = startOf(d, q);
  if (!s) return d;
  const t = new Date(Date.parse(`${s}T00:00:00Z`) - 86400000);
  return t.toISOString().slice(0, 10);
}
