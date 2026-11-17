import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { Empty } from "@/components/app/page-header";
import { EvidenceButton } from "@/components/source/evidence-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UsTileMap } from "@/components/alt/us-tile-map";
import { depositsByStateQuery, fmtAlt, type AltRow } from "@/lib/alt/query";
import { STATES, TOTAL_TITLE } from "@/lib/alt/sod";
import { useUniverse } from "@/lib/data";
import { useSessionState } from "@/lib/use-session-state";
import { cn } from "@/lib/utils";
import { Stat } from "./region-exposures";

type Col = "value" | "market" | "branches" | "share" | "change" | "t";
const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);

/** Which covered banks hold the deposits of one state, from the FDIC's June 30 branch survey. */
export function StateDeposits() {
  const q = useQuery(depositsByStateQuery());
  const uni = useUniverse();
  const [st, setSt] = useSessionState("fu:exposures:state", "TX");
  const [sort, setSort] = useState<{ c: Col; d: 1 | -1 }>({ c: "value", d: -1 });
  const byTk = useMemo(() => new Map((uni.data?.companies ?? []).map((c) => [c.ticker, c])), [uni.data]);

  const v = useMemo(() => {
    const rows = q.data?.rows ?? [];
    const latest = q.data?.latest;
    const now = rows.filter((r) => r.date === latest && r.title !== TOTAL_TITLE);
    const prev = new Map(rows.filter((r) => r.date !== latest && r.title !== TOTAL_TITLE).map((r) => [`${r.ticker}|${r.meta.state}`, r]));
    const perState = new Map<string, { n: number; sum: number; total: number }>();
    for (const r of now) {
      const s = perState.get(r.meta.state) ?? { n: 0, sum: 0, total: r.meta.state_total ?? 0 };
      s.n++;
      s.sum += r.value ?? 0;
      perState.set(r.meta.state, s);
    }
    return { latest, now, prev, perState };
  }, [q.data]);

  const rows = useMemo(() => {
    const list = v.now
      .filter((r) => r.meta.state === st)
      .map((r) => {
        const p = v.prev.get(`${r.ticker}|${st}`);
        return { r, change: p?.value ? (r.value ?? 0) / p.value - 1 : null };
      });
    const val = (x: { r: AltRow; change: number | null }): number | string | null => (sort.c === "t" ? x.r.ticker : sort.c === "value" ? x.r.value : sort.c === "market" ? (x.r.meta.market_share ?? null) : sort.c === "branches" ? x.r.meta.branches : sort.c === "share" ? x.r.meta.share : x.change);
    return list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.d;
    });
  }, [v, st, sort]);

  if (q.isLoading) return <Skeleton className="mt-4 h-[520px]" />;
  if (!v.latest || !v.now.length) return <Empty title="Deposit data is loading">The FDIC branch survey is still being imported.</Empty>;
  const s = v.perState.get(st);
  const year = v.latest.slice(0, 4);
  const states = [...v.perState.keys()].sort((a, b) => (STATES[a] ?? a).localeCompare(STATES[b] ?? b));

  const Th = ({ c, children, title }: { c: Col; children: React.ReactNode; title?: string }) => (
    <th aria-sort={sort.c === c ? (sort.d === 1 ? "ascending" : "descending") : "none"} className="sticky top-0 z-20 border-b bg-card px-3 py-2 text-right align-bottom">
      <button type="button" title={title} onClick={() => setSort((x) => ({ c, d: x.c === c ? (-x.d as 1 | -1) : -1 }))} className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-muted-foreground hover:text-foreground">
        {children}
        {sort.c === c && (sort.d === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]" data-section="Deposits by state">
      <div className="min-w-0">
        <Select value={st} onValueChange={setSt}>
          <SelectTrigger aria-label="State" className="mb-2 h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {states.map((x) => (
              <SelectItem key={x} value={x}>
                {STATES[x] ?? x} · {v.perState.get(x)!.n} banks
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <UsTileMap
          values={Object.fromEntries([...v.perState].map(([k, x]) => [k, x.total ? x.sum / x.total : 0]))}
          title={(x) => {
            const p = v.perState.get(x);
            return p ? `${STATES[x] ?? x}: ${p.n} covered banks hold ${pct(p.total ? p.sum / p.total : null)} of its deposits` : (STATES[x] ?? x);
          }}
          selected={st}
          onSelect={setSt}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">Shaded by the share of each state's deposits held by covered banks. Pick a state.</p>
      </div>
      <div className="min-w-0">
        <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
          <Stat label={`${STATES[st] ?? st} deposits, Jun ${year}`} value={fmtAlt(s?.total || null, "USD")} hint="all FDIC-insured branches" />
          <Stat label="Covered banks there" value={String(s?.n ?? 0)} />
          <Stat label="Their combined share" value={pct(s && s.total ? s.sum / s.total : null)} />
          <Stat label="Largest" value={rows[0] && sort.c === "value" && sort.d === -1 ? rows[0].r.ticker : (rows.slice().sort((a, b) => (b.r.value ?? 0) - (a.r.value ?? 0))[0]?.r.ticker ?? "—")} hint={rows.length ? pct(rows.slice().sort((a, b) => (b.r.value ?? 0) - (a.r.value ?? 0))[0].r.meta.market_share) + " of the state" : undefined} />
        </div>
        <div className="overflow-hidden rounded-lg border bg-card shadow-paper">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 border-b border-r bg-card px-3 py-2 text-left">
                    <button type="button" onClick={() => setSort((x) => ({ c: "t", d: x.c === "t" ? (-x.d as 1 | -1) : 1 }))} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
                      Bank
                    </button>
                  </th>
                  <Th c="value">Deposits there</Th>
                  <Th c="market" title="Share of all FDIC-insured deposits in the state">Share of state</Th>
                  <Th c="branches">Branches</Th>
                  <Th c="share" title="The state's share of the bank's own branch deposits">Of bank</Th>
                  <Th c="change" title={`Vs June ${Number(year) - 1}`}>1-yr change</Th>
                  <th className="sticky top-0 z-20 border-b bg-card px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, change }) => (
                  <tr key={r.uid} className="group">
                    <td className="sticky left-0 z-10 max-w-52 border-b border-r bg-card px-3 py-1.5 group-hover:bg-secondary">
                      <span className="flex items-center gap-2">
                        <CompanyLogo ticker={r.ticker} className="size-5" />
                        <Link to="/app/companies/$ticker/alt-data" params={{ ticker: r.ticker }} className="num font-medium hover:underline">
                          {r.ticker}
                        </Link>
                        <span className="hidden truncate text-xs text-muted-foreground sm:inline" title={byTk.get(r.ticker)?.name}>
                          {byTk.get(r.ticker)?.name}
                        </span>
                      </span>
                    </td>
                    <td className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary">{fmtAlt(r.value, "USD")}</td>
                    <td className="border-b px-3 py-1.5 group-hover:bg-secondary">
                      <span className="flex items-center justify-end gap-2">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                          <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(100, (r.meta.market_share ?? 0) * 100)}%` }} />
                        </span>
                        <span className="num w-12 text-right tabular-nums">{pct(r.meta.market_share)}</span>
                      </span>
                    </td>
                    <td className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary">{r.meta.branches?.toLocaleString()}</td>
                    <td className="num border-b px-3 py-1.5 text-right tabular-nums text-muted-foreground group-hover:bg-secondary">{pct(r.meta.share)}</td>
                    <td className={cn("num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary", change != null && change < 0 && "text-negative")}>{change == null ? "—" : `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`}</td>
                    <td className="border-b px-1 text-right group-hover:bg-secondary">{r.source_url && <EvidenceButton ticker={r.ticker} title={`${r.ticker} deposits in ${STATES[st] ?? st}, June ${year}`} url={r.source_url} date={r.date ?? undefined} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">FDIC Summary of Deposits: every insured branch's deposits each June 30, added up across all banks a company owns. Branch deposits are booked where the account is kept, so online and card banks concentrate in their home state.</p>
      </div>
    </div>
  );
}
