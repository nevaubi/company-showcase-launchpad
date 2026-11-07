import { useMemo, useState, type ReactNode } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { useSource } from "@/components/source/source-context";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  initials,
  partyShort,
  type CongressTrade,
  type GovFile,
  type OwnershipFlows,
  sectionOfFact,
} from "@/lib/influence/data";

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return a >= 1e12
    ? `$${(v / 1e12).toFixed(2)}T`
    : a >= 1e9
      ? `$${(v / 1e9).toFixed(1)}B`
      : a >= 1e6
        ? `$${(v / 1e6).toFixed(1)}M`
        : a >= 1e3
          ? `$${(v / 1e3).toFixed(0)}K`
          : `$${v.toFixed(0)}`;
};
const sh = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return a >= 1e9
    ? `${(v / 1e9).toFixed(2)}B`
    : a >= 1e6
      ? `${(v / 1e6).toFixed(1)}M`
      : a >= 1e3
        ? `${(v / 1e3).toFixed(0)}K`
        : v.toFixed(0);
};
const th = "px-3 py-1.5 text-[11px] font-medium text-muted-foreground";
const Note = ({ children }: { children: ReactNode }) => (
  <p className="border-t px-3.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
    {children}
  </p>
);
const PARTY_BG: Record<string, string> = {
  D: "bg-[oklch(0.55_0.13_255)]",
  R: "bg-[oklch(0.55_0.16_25)]",
};

/** A member of Congress shown by initials, party and state; no photographs. */
function Member({ name, party, state }: { name: string; party: string; state: string }) {
  const p = partyShort(party);
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white",
          PARTY_BG[p] ?? "bg-muted-foreground",
        )}
      >
        {initials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        <span className="block text-[11px] text-muted-foreground">
          {p}-{state}
        </span>
      </span>
    </span>
  );
}

/* ---------- feed ---------- */
interface FeedItem {
  date: string;
  kind: string;
  title: string;
  detail?: string;
  tone?: "pos" | "neg";
  /** Direction word for trades ("Bought", "Sold"), shown in its own column so colour carries direction, not type */
  action?: string;
  /** Size of a trade, right-aligned */
  amount?: string;
  onOpen: () => void;
}
export function InfluenceFeed({
  ticker,
  gov,
  flows,
  insiders,
}: {
  ticker: string;
  gov?: GovFile | null;
  flows?: OwnershipFlows | null;
  insiders: {
    date: string;
    name: string;
    title?: string;
    code: string;
    shares: number;
    value?: number | null;
    open: () => void;
  }[];
}) {
  const { open } = useSource();
  const [days, setDays] = useState<"90" | "365">("90");
  const items = useMemo(() => {
    const since = new Date(Date.now() - +days * 864e5).toISOString().slice(0, 10);
    const out: FeedItem[] = [];
    for (const t of gov?.congress_trades ?? []) {
      if (t.tx_date < since) continue;
      out.push({
        date: t.tx_date,
        kind: "Congress",
        title: `${t.member} (${partyShort(t.party)}-${t.state_dst})`,
        action: /purchase/i.test(t.type) ? "Bought" : /sale/i.test(t.type) ? "Sold" : t.type,
        amount: t.amount,
        detail: t.committee_flag
          ? `Sits on ${t.flag_committees.join(", ")}`
          : `${t.owner} · disclosed ${fmtDate(t.filed)}`,
        tone: /purchase/i.test(t.type) ? "pos" : /sale/i.test(t.type) ? "neg" : undefined,
        onOpen: () => openTrade(t),
      });
    }
    for (const h of flows?.holders13dg?.current ?? []) {
      if (h.filed < since) continue;
      out.push({
        date: h.filed,
        kind: h.form.replace("SCHEDULE ", ""),
        title: `${h.filer} · ${h.percent != null ? `${h.percent}%` : sh(h.shares)}${h.activist ? " · activist" : ""}`,
        detail: h.purpose ?? h.filer_type,
        onOpen: () => window.open(h.url, "_blank", "noopener"),
      });
    }
    for (const f of gov?.lobbying?.filings ?? []) {
      if (f.posted < since) continue;
      out.push({
        date: f.posted,
        kind: "Lobbying",
        title: `${f.registrant === f.client ? "In-house" : f.registrant} · ${usd(f.amount)} · Q${f.quarter} ${f.year}`,
        detail: f.activities
          .map((a) => a.issue)
          .slice(0, 3)
          .join(", "),
        onOpen: () => window.open(f.url, "_blank", "noopener"),
      });
    }
    for (const r of [...(gov?.regulation?.rules ?? []), ...(gov?.regulation?.proposed ?? [])]) {
      if (r.date < since) continue;
      out.push({
        date: r.date,
        kind: r.type === "Rule" ? "Final rule" : r.type,
        title: r.title,
        detail: r.agencies.join(", "),
        onOpen: () => window.open(r.url, "_blank", "noopener"),
      });
    }
    for (const h of gov?.hearings ?? []) {
      if (h.date < since) continue;
      out.push({
        date: h.date,
        kind: "Hearing",
        title: h.title.charAt(0) + h.title.slice(1).toLowerCase(),
        detail: `${h.committees.join(", ")} · named ${h.mentions} time${h.mentions === 1 ? "" : "s"}`,
        onOpen: () =>
          h.quotes[0] &&
          open({
            ticker,
            label: "Hearing transcript",
            periodLabel: fmtDate(h.date),
            unit: "count",
            value: h.mentions,
            external: {
              url: h.text_url,
              quote: h.quotes[0].text,
              date: h.date,
              confidence: `${h.title}. ${h.src.method}.`,
            },
          }),
      });
    }
    // one line per person, day and direction; the row opens the first of that day's filings
    const groups = new Map<
      string,
      { i: (typeof insiders)[number]; shares: number; value: number; n: number }
    >();
    for (const i of insiders) {
      if (i.date < since) continue;
      const k = `${i.date}|${i.name}|${i.code}`;
      const g = groups.get(k);
      if (g) {
        g.shares += i.shares;
        g.value += i.value ?? 0;
        g.n += 1;
      } else groups.set(k, { i, shares: i.shares, value: i.value ?? 0, n: 1 });
    }
    for (const { i, shares, value, n } of groups.values()) {
      out.push({
        date: i.date,
        kind: "Form 4",
        title: `${i.name}${i.title ? ` (${i.title})` : ""}`,
        detail: n > 1 ? `${n} transactions` : undefined,
        action: i.code === "P" ? "Bought" : i.code === "S" ? "Sold" : i.code,
        amount: `${sh(shares)} sh${value ? ` · ${usd(value)}` : ""}`,
        tone: i.code === "P" ? "pos" : i.code === "S" ? "neg" : undefined,
        onOpen: i.open,
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gov, flows, insiders, days]);

  const f4 = useMemo(() => {
    const since = new Date(Date.now() - +days * 864e5).toISOString().slice(0, 10);
    const w = insiders.filter((i) => i.date >= since);
    const sum = (code: string) =>
      w.filter((i) => i.code === code).reduce((a, i) => a + (i.value ?? 0), 0);
    return { bought: sum("P"), sold: sum("S"), n: w.length };
  }, [insiders, days]);

  function openTrade(t: CongressTrade) {
    open({
      ticker,
      label: `${t.member}: ${t.type}`,
      periodLabel: fmtDate(t.tx_date),
      unit: "usd",
      value: t.amax ?? 0,
      external: {
        url: t.pdf_url,
        quote: t.cited,
        date: t.filed,
        confidence: `${t.chamber} periodic transaction report, page ${t.page ?? 1}. ${t.src.method}. Amounts are disclosed as ranges.`,
      },
    });
  }
  return (
    <Panel
      title="What changed"
      subtitle="Every dated record across trading, ownership, lobbying, rules and hearings"
      actions={
        <Segmented
          size="xs"
          label="Window"
          value={days}
          onChange={setDays}
          options={[
            { v: "90", l: "90 days" },
            { v: "365", l: "1 year" },
          ]}
        />
      }
      collapse={false}
      bodyClassName="p-0"
    >
      {f4.n > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3.5 py-2 text-[12px]">
          <span className="text-muted-foreground">Form 4 open-market trades in window</span>
          <span className="num tabular-nums">
            <span className="text-positive">bought {usd(f4.bought)}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-negative">sold {usd(f4.sold)}</span>
          </span>
          {f4.bought + f4.sold > 0 && (
            <span className="flex h-1.5 w-40 overflow-hidden rounded-full bg-secondary" aria-hidden>
              <span
                className="bg-positive"
                style={{ width: `${(f4.bought / (f4.bought + f4.sold)) * 100}%` }}
              />
              <span className="flex-1 bg-negative/70" />
            </span>
          )}
        </div>
      )}
      {!items.length ? (
        <p className="p-4 text-sm text-muted-foreground">No records in this window.</p>
      ) : (
        <ol className="divide-y">
          {items.map((it, k) => (
            <li key={k}>
              <button
                type="button"
                onClick={it.onOpen}
                className="flex w-full items-start gap-3 px-3.5 py-2 text-left hover:bg-secondary"
              >
                <span className="num w-20 shrink-0 pt-0.5 text-[11.5px] text-muted-foreground">
                  {fmtDate(it.date, { month: "short", day: "numeric", year: "2-digit" })}
                </span>
                <span className="mt-0.5 w-20 shrink-0 rounded border border-border px-1.5 text-center text-[10.5px] text-muted-foreground">
                  {it.kind}
                </span>
                <span className="min-w-0 flex-1 text-[12.5px]">
                  <span className="block">
                    {it.action && (
                      <span
                        className={cn(
                          "mr-1.5 font-medium sm:hidden",
                          it.tone === "pos" && "text-positive",
                          it.tone === "neg" && "text-negative",
                        )}
                      >
                        {it.action}
                      </span>
                    )}
                    {it.title}
                  </span>
                  {(it.detail || it.amount) && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {it.amount && <span className="num sm:hidden">{it.amount}</span>}
                      {it.amount && it.detail && <span className="sm:hidden"> · </span>}
                      {it.detail}
                    </span>
                  )}
                </span>
                {it.action && (
                  <span
                    className={cn(
                      "hidden w-16 shrink-0 pt-0.5 text-[12px] font-medium sm:block",
                      it.tone === "pos" && "text-positive",
                      it.tone === "neg" && "text-negative",
                      !it.tone && "text-muted-foreground",
                    )}
                  >
                    {it.action}
                  </span>
                )}
                <span className="num hidden w-40 shrink-0 pt-0.5 text-right text-[12px] tabular-nums sm:block">
                  {it.amount ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <Note>
        Click a row for the source document. Congressional trades are disclosed with a delay of up
        to 45 days; dates shown are trade dates.
      </Note>
    </Panel>
  );
}

/* ---------- AI read ---------- */
export function InfluenceRead({
  gov,
  onSection,
}: {
  gov: GovFile;
  onSection: (s: ReturnType<typeof sectionOfFact>) => void;
}) {
  const r = gov.ai_read;
  if (!r?.sentences?.length) return null;
  const facts = new Map((r.facts ?? []).map((f) => [f.id, f.text]));
  return (
    <Panel
      title="Read"
      subtitle={`${r.label ?? "AI-generated from the records on this tab"} · ${r.generated_at ? fmtDate(r.generated_at.slice(0, 10)) : ""}`}
      collapse={false}
    >
      <ul className="grid gap-1.5 px-3.5 py-2.5 text-[13px]">
        {r.sentences.map((s, k) => (
          <li key={k} className="leading-relaxed">
            {s.text}{" "}
            {s.refs.map((id, j) => (
              <button
                key={id}
                type="button"
                title={facts.get(id)}
                onClick={() => onSection(sectionOfFact(id, gov))}
                className="num ml-0.5 rounded bg-secondary px-1 align-super text-[9.5px] text-muted-foreground hover:text-foreground"
              >
                {j + 1}
              </button>
            ))}
          </li>
        ))}
      </ul>
      <Note>
        Each sentence cites the records it uses (hover a number for the record, click to open its
        section). Numbers are checked against the records in code and a second model (
        {r.check_model ?? "n/a"}) rejected sentences the records do not support
        {r.dropped?.length ? ` (${r.dropped.length} dropped)` : ""}. Drafted by {r.model}.
      </Note>
    </Panel>
  );
}

/* ---------- Congress ---------- */
export function CongressTrades({ ticker, gov }: { ticker: string; gov: GovFile }) {
  const { open } = useSource();
  const [flag, setFlag] = useState<"all" | "committee">("all");
  const rows = gov.congress_trades
    .filter((t) => flag === "all" || t.committee_flag)
    .sort((a, b) => b.tx_date.localeCompare(a.tx_date));
  const buys = gov.congress_trades.filter((t) => t.type_code === "P");
  const sells = gov.congress_trades.filter((t) => t.type_code.startsWith("S"));
  const members = new Set(gov.congress_trades.map((t) => t.member));
  const range = (xs: CongressTrade[]) =>
    `${usd(xs.reduce((s, t) => s + (t.amin ?? 0), 0))} – ${usd(xs.reduce((s, t) => s + (t.amax ?? 0), 0))}`;
  const senate = gov.sources.congress_senate;
  return (
    <Panel
      title="Trades by members of Congress"
      subtitle={`${gov.congress_trades.length} disclosed trades by ${members.size} members · purchases ${range(buys)}, sales ${range(sells)}`}
      actions={
        <Segmented
          size="xs"
          label="Filter"
          value={flag}
          onChange={setFlag}
          options={[
            { v: "all", l: "All" },
            { v: "committee", l: "Overseeing committees" },
          ]}
        />
      }
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="max-h-[60vh] overflow-auto scrollbar-thin">
        <table className="w-full min-w-[820px] text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b text-left">
              <th className={th}>Member</th>
              <th className={th}>Trade</th>
              <th className={th}>Amount</th>
              <th className={th}>Traded</th>
              <th className={th}>Disclosed</th>
              <th className={th}>Owner</th>
              <th className={th}>Committees</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.id}
                className="cursor-pointer border-b hover:bg-secondary"
                onClick={() =>
                  open({
                    ticker,
                    label: `${t.member}: ${t.type}`,
                    periodLabel: fmtDate(t.tx_date),
                    unit: "usd",
                    value: t.amax ?? 0,
                    external: {
                      url: t.pdf_url,
                      quote: t.cited,
                      date: t.filed,
                      confidence: `${t.chamber} periodic transaction report, page ${t.page ?? 1}. ${t.src.method}.`,
                    },
                  })
                }
              >
                <td className="px-3 py-1.5">
                  <Member name={t.member} party={t.party} state={t.state_dst} />
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 font-medium",
                    t.type_code === "P"
                      ? "text-positive"
                      : t.type_code.startsWith("S")
                        ? "text-negative"
                        : "",
                  )}
                >
                  {t.type}
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {t.asset.replace(/\s*\[[A-Z]+\]$/, "")}
                  </span>
                </td>
                <td className="num px-3 py-1.5">{t.amount}</td>
                <td className="num whitespace-nowrap px-3 py-1.5">{fmtDate(t.tx_date)}</td>
                <td className="num whitespace-nowrap px-3 py-1.5">
                  {fmtDate(t.filed)}
                  <span className="block text-[11px] text-muted-foreground">
                    {t.lag_days != null ? `${t.lag_days} days later` : ""}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">{t.owner}</td>
                <td className="max-w-64 px-3 py-1.5 text-[11.5px]">
                  {t.committee_flag && (
                    <span className="mb-0.5 inline-block rounded border border-highlight px-1 text-[10.5px]">
                      oversees sector
                    </span>
                  )}
                  <span
                    className="block truncate text-muted-foreground"
                    title={t.committees.join("\n")}
                  >
                    {t.committees
                      .map((c) => c.replace(/^(House|Senate) Committee on /, ""))
                      .join(", ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>
        House periodic transaction reports, parsed from the Clerk's PDFs; click a row for the filing
        with the line it was read from. Flag: {gov.congress_meta.flag_basis} Committees overseeing
        this sector: {gov.congress_meta.committees_overseeing.join("; ")}.
        {senate?.status !== "ok" &&
          " Senate reports are not collected (the Senate system requires an attestation the pipeline does not make on your behalf)."}{" "}
        Members are shown by initials, party and state. {gov.congress_meta.legal_note}
      </Note>
    </Panel>
  );
}

/* ---------- holders ---------- */
export function Holders({ flows }: { flows: OwnershipFlows }) {
  const [view, setView] = useState<"top" | "buyers" | "sellers">("top");
  const I = flows.inst13f;
  const D = flows.holders13dg;
  const list = I
    ? (view === "top" ? I.holders : view === "buyers" ? I.buyers : I.sellers).slice(0, 25)
    : [];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {I && (
        <Panel
          title="Institutional holders (13F)"
          subtitle={`Quarter ended ${fmtDate(I.period)} vs ${fmtDate(I.prior_period)} · ${I.totals.managers.toLocaleString()} managers`}
          actions={
            <Segmented
              size="xs"
              label="View"
              value={view}
              onChange={setView}
              options={[
                { v: "top", l: "Largest" },
                { v: "buyers", l: "Added" },
                { v: "sellers", l: "Cut" },
              ]}
            />
          }
          collapse={false}
          bodyClassName="p-0"
        >
          <div className="grid grid-cols-3 border-b">
            {[
              [
                "Shares held by 13F filers",
                sh(I.totals.shares),
                `${(((I.totals.shares - I.totals.prior_shares) / (I.totals.prior_shares || 1)) * 100).toFixed(1)}% vs prior quarter`,
              ],
              ["New positions", String(I.totals.new_positions), "managers"],
              ["Exits", String(I.totals.exits), "managers"],
            ].map(([l, v, s]) => (
              <div key={l} className="border-r px-3.5 py-2 last:border-r-0">
                <p className="text-[11px] text-muted-foreground">{l}</p>
                <p className="num text-base font-medium tabular-nums">{v}</p>
                <p className="text-[10.5px] text-muted-foreground">{s}</p>
              </div>
            ))}
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Manager</th>
                <th className={cn(th, "text-right")}>Shares</th>
                <th className={cn(th, "text-right")}>Value</th>
                <th className={cn(th, "text-right")}>Change</th>
              </tr>
            </thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.cik} className="border-b last:border-0">
                  <td className="px-3 py-1.5">
                    <a
                      href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${h.cik}&type=13F-HR`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {h.manager}
                    </a>
                    {h.new && (
                      <span className="ml-1.5 rounded border border-positive/40 px-1 text-[10px] text-positive">
                        new
                      </span>
                    )}
                    {h.exited && (
                      <span className="ml-1.5 rounded border border-negative/40 px-1 text-[10px] text-negative">
                        exited
                      </span>
                    )}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{sh(h.shares)}</td>
                  <td className="num px-3 py-1.5 text-right">{usd(h.value)}</td>
                  <td
                    className={cn(
                      "num px-3 py-1.5 text-right",
                      h.change > 0 ? "text-positive" : h.change < 0 ? "text-negative" : "",
                    )}
                  >
                    {h.change > 0 ? "+" : ""}
                    {sh(h.change)}
                    {h.pct_change != null ? ` (${(h.pct_change * 100).toFixed(1)}%)` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Note>
            SEC Form 13F data sets, latest original or restated report per manager, matched by
            CUSIP. 13F covers long positions of managers over $100M, reported 45 days after quarter
            end.{" "}
            <a
              href={I.src.page ?? I.src.url}
              target="_blank"
              rel="noreferrer"
              className="text-link hover:underline"
            >
              Source ↗
            </a>
          </Note>
        </Panel>
      )}
      {D && (
        <Panel
          title="5%+ holders (13D / 13G)"
          subtitle="Beneficial ownership reports on the cover page"
          collapse={false}
          bodyClassName="p-0"
        >
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Filer</th>
                <th className={cn(th, "text-right")}>Stake</th>
                <th className={th}>Filed</th>
              </tr>
            </thead>
            <tbody>
              {D.current.map((h) => (
                <tr key={h.id} className="border-b last:border-0">
                  <td className="px-3 py-1.5">
                    <a href={h.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {h.filer}
                    </a>
                    <span className="block text-[11px] text-muted-foreground">
                      {h.form.replace("SCHEDULE ", "")} · {h.filer_type}
                      {h.activist ? " · activist (13D)" : ""}
                    </span>
                  </td>
                  <td className="num px-3 py-1.5 text-right">
                    {h.percent != null ? `${h.percent}%` : "–"}
                    <span className="block text-[11px] text-muted-foreground">{sh(h.shares)}</span>
                  </td>
                  <td className="num px-3 py-1.5">{fmtDate(h.filed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {D.history.length > D.current.length && (
            <Note>
              {D.history.length} filings on record; the table shows each filer's latest. 13D means
              the holder may seek to influence control; 13G is a passive stake.
            </Note>
          )}
        </Panel>
      )}
    </div>
  );
}

/* ---------- lobbying and PAC ---------- */
export function Lobbying({ ticker, gov }: { ticker: string; gov: GovFile }) {
  const L = gov.lobbying;
  const { open } = useSource();
  if (!L) return null;
  const max = Math.max(...L.quarters.map((q) => q.amount), 1);
  const P = gov.pac;
  const total = L.quarters.reduce((s, q) => s + q.amount, 0);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Lobbying spend by quarter"
          subtitle={`${usd(total)} reported across ${L.filing_count} LD-2 filings`}
          collapse={false}
        >
          <div className="flex h-36 items-end gap-1 px-3.5 pt-3">
            {L.quarters.map((q) => (
              <div
                key={`${q.year}${q.quarter}`}
                className="flex flex-1 flex-col items-center gap-1"
                title={`Q${q.quarter} ${q.year}: ${usd(q.amount)} (${q.basis}, ${q.n} filings)`}
              >
                <span className="num text-[9.5px] text-muted-foreground">{usd(q.amount)}</span>
                <span
                  className="w-full rounded-t-sm bg-chart-1/70"
                  style={{ height: `${(q.amount / max) * 90}px` }}
                />
                <span className="text-[9.5px] text-muted-foreground">
                  Q{q.quarter} {String(q.year).slice(2)}
                </span>
              </div>
            ))}
          </div>
          <Note>
            In-house reports state the company's total lobbying cost; outside firms report their fee
            per client. Amounts round to $10,000.
          </Note>
        </Panel>
        <Panel title="Issues and agencies lobbied" collapse={false} bodyClassName="p-0">
          <table className="w-full text-[12.5px]">
            <tbody>
              {L.issues.slice(0, 8).map((i) => (
                <tr key={i.code} className="border-b">
                  <td className="w-full max-w-0 px-3 py-1.5">
                    <span className="font-medium">{i.name}</span>
                    <span
                      className="block truncate text-[11px] text-muted-foreground"
                      title={i.latest_desc}
                    >
                      {i.latest_desc}
                    </span>
                  </td>
                  <td className="num px-3 py-1.5 text-right">
                    {i.filings}
                    <span className="block text-[10.5px] text-muted-foreground">filings</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Note>
            Agencies contacted most:{" "}
            {L.agencies
              .slice(0, 6)
              .map((a) => `${a.name} (${a.filings})`)
              .join(", ")}
            .
          </Note>
        </Panel>
      </div>
      {L.bills.length > 0 && (
        <Panel
          title="Bills named in lobbying reports"
          subtitle="Each opens the report with the sentence that names it"
          collapse={false}
          bodyClassName="p-0"
        >
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Bill</th>
                <th className={th}>Issue</th>
                <th className={cn(th, "text-right")}>Filings</th>
                <th className={th}>Period</th>
                <th className={th}>As written in the report</th>
              </tr>
            </thead>
            <tbody>
              {L.bills.slice(0, 15).map((b) => {
                const f = L.filings.find((x) => x.uuid === b.cites[0]?.filing);
                return (
                  <tr
                    key={b.bill}
                    className="cursor-pointer border-b last:border-0 hover:bg-secondary"
                    onClick={() =>
                      b.cites[0] &&
                      open({
                        ticker,
                        label: `Lobbying on ${b.bill}`,
                        periodLabel: `${b.first} to ${b.last}`,
                        unit: "count",
                        value: b.filings,
                        external: {
                          url:
                            f?.url ??
                            `https://lda.gov/filings/public/filing/${b.cites[0].filing}/print/`,
                          quote: b.cites[0].text,
                          date: f?.posted,
                          confidence: "Lobbying Disclosure Act report (LD-2), lda.gov",
                        },
                      })
                    }
                  >
                    <td className="num whitespace-nowrap px-3 py-1.5 font-medium">
                      {b.bill}
                      <span className="block text-[10.5px] font-normal text-muted-foreground">
                        {b.congress}th Congress
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{b.issues.join(", ")}</td>
                    <td className="num px-3 py-1.5 text-right">{b.filings}</td>
                    <td className="num whitespace-nowrap px-3 py-1.5">
                      {b.first} – {b.last}
                    </td>
                    <td className="max-w-md px-3 py-1.5 text-[11.5px] text-muted-foreground">
                      <span className="line-clamp-2">“{b.cites[0]?.text}”</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
      {P && P.committees.length > 0 && (
        <Panel
          title="Political action committee"
          subtitle={P.committees.map((c) => c.name).join("; ")}
          collapse={false}
          bodyClassName="p-0"
        >
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Cycle</th>
                <th className={cn(th, "text-right")}>Raised</th>
                <th className={cn(th, "text-right")}>Spent</th>
                <th className={cn(th, "text-right")}>To candidates</th>
                <th className={cn(th, "text-right")}>D / R</th>
                <th className={th}>Largest recipients</th>
              </tr>
            </thead>
            <tbody>
              {P.cycles.map((c) => (
                <tr key={c.cycle} className="border-b last:border-0">
                  <td className="num px-3 py-1.5">
                    <a
                      href={c.src.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {c.cycle}
                    </a>
                  </td>
                  <td className="num px-3 py-1.5 text-right">{usd(c.receipts)}</td>
                  <td className="num px-3 py-1.5 text-right">{usd(c.disbursements)}</td>
                  <td className="num px-3 py-1.5 text-right">{usd(c.to_candidates)}</td>
                  <td className="num px-3 py-1.5 text-right">
                    {c.to_candidates
                      ? `${Math.round((c.dem / c.to_candidates) * 100)}% / ${Math.round((c.rep / c.to_candidates) * 100)}%`
                      : "–"}
                  </td>
                  <td className="px-3 py-1.5 text-[11.5px] text-muted-foreground">
                    {c.recipients
                      .filter((r) => r.member)
                      .slice(0, 4)
                      .map(
                        (r) => `${r.member} (${partyShort(r.party)}-${r.state}) ${usd(r.amount)}`,
                      )
                      .join("; ") || "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Note>
            FEC bulk files, committees whose connected organization is this company.{" "}
            <a
              href={P.committees[0].url}
              target="_blank"
              rel="noreferrer"
              className="text-link hover:underline"
            >
              FEC committee page ↗
            </a>
          </Note>
        </Panel>
      )}
    </div>
  );
}

/* ---------- government: contracts, rules, laws, hearings ---------- */
export function Government({ ticker, gov }: { ticker: string; gov: GovFile }) {
  const { open } = useSource();
  const S = gov.spending;
  const fy = S?.fy ?? [];
  const max = Math.max(...fy.map((f) => f.total), 1);
  const rules = [...(gov.regulation?.rules ?? []), ...(gov.regulation?.proposed ?? [])].sort(
    (a, b) => b.date.localeCompare(a.date),
  );
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {fy.length > 0 && (
          <Panel
            title="Federal awards by fiscal year"
            subtitle="USAspending.gov, obligations to the company and its subsidiaries"
            collapse={false}
          >
            <div className="flex h-36 items-end gap-1 px-3.5 pt-3">
              {fy.map((f) => (
                <div
                  key={f.fy}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`FY${f.fy}: ${usd(f.total)} (contracts ${usd(f.contracts)}, grants ${usd(f.grants)}, other ${usd(f.other)})${f.partial ? ", year in progress" : ""}`}
                >
                  <span className="num text-[9.5px] text-muted-foreground">{usd(f.total)}</span>
                  <span
                    className={cn("w-full rounded-t-sm bg-chart-3/70", f.partial && "opacity-50")}
                    style={{ height: `${(f.total / max) * 90}px` }}
                  />
                  <span className="text-[9.5px] text-muted-foreground">
                    FY{String(f.fy).slice(2)}
                  </span>
                </div>
              ))}
            </div>
            {(S?.awards ?? []).length > 0 && (
              <table className="w-full border-t text-[12px]">
                <tbody>
                  {S!.awards.slice(0, 6).map((a, k) => (
                    <tr key={a.award_id ?? k} className="border-b last:border-0">
                      <td className="px-3 py-1">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          {a.award_id}
                        </a>
                        <span className="block text-[11px] text-muted-foreground">{a.agency}</span>
                      </td>
                      <td className="num px-3 py-1 text-right">{usd(a.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Note>
              {S?.entities.length ? (
                <>
                  Matched recipients:{" "}
                  {S.entities
                    .filter((e, k, a) => a.findIndex((x) => x.name === e.name) === k)
                    .slice(0, 3)
                    .map((e) => (
                      <a
                        key={e.url}
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mr-2 text-link hover:underline"
                      >
                        {e.name}
                      </a>
                    ))}
                </>
              ) : null}
            </Note>
          </Panel>
        )}
        {rules.length > 0 && (
          <Panel
            title="Federal Register documents naming the company"
            subtitle="Final and proposed rules, notices"
            collapse={false}
            bodyClassName="p-0"
          >
            <ul className="max-h-96 divide-y overflow-auto scrollbar-thin">
              {rules.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() =>
                      open({
                        ticker,
                        label: r.title,
                        periodLabel: fmtDate(r.date),
                        unit: "count",
                        value: 0,
                        external: {
                          url: r.url,
                          quote: r.excerpt ?? r.abstract ?? r.title,
                          date: r.date,
                          confidence: `${r.citation} · ${r.agencies.join(", ")}`,
                        },
                      })
                    }
                    className="block w-full px-3.5 py-2 text-left hover:bg-secondary"
                  >
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="num">{fmtDate(r.date)}</span>
                      <span className="rounded border px-1">{r.type}</span>
                      {r.comments_close_on &&
                        r.comments_close_on >= new Date().toISOString().slice(0, 10) && (
                          <span className="rounded border border-highlight px-1 text-foreground">
                            comments close {fmtDate(r.comments_close_on)}
                          </span>
                        )}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] font-medium">{r.title}</span>
                    <span className="line-clamp-2 text-[11.5px] text-muted-foreground">
                      {r.abstract}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      {(gov.hearings ?? []).length > 0 && (
        <Panel
          title="Congressional hearings that name the company"
          subtitle="Verbatim quotes from GovInfo transcripts"
          collapse={false}
          bodyClassName="p-0"
        >
          <ul className="divide-y">
            {gov.hearings!.slice(0, 12).map((h) => (
              <li key={h.id} className="px-3.5 py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="num">{fmtDate(h.date)}</span>
                  <span>
                    {h.chamber} · {h.committees.join(", ").replace(/Committee on /g, "")}
                  </span>
                  <span>named {h.mentions}×</span>
                </p>
                <a
                  href={h.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 block text-[12.5px] font-medium hover:underline"
                >
                  {h.title.charAt(0) + h.title.slice(1).toLowerCase()}
                </a>
                {h.quotes.slice(0, 2).map((q, k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      open({
                        ticker,
                        label: "Hearing transcript",
                        periodLabel: fmtDate(h.date),
                        unit: "count",
                        value: h.mentions,
                        external: {
                          url: h.text_url,
                          quote: q.text,
                          date: h.date,
                          confidence: `${h.title}. ${h.src.method}.`,
                        },
                      })
                    }
                    className="mt-1 block w-full rounded-sm text-left text-[12px] leading-relaxed text-muted-foreground hover:bg-highlight-soft hover:text-foreground"
                  >
                    “{q.text}”
                    {q.speaker && (
                      <span className="ml-1 text-[11px]">
                        — {q.speaker}
                        {q.speaker_party ? ` (${partyShort(q.speaker_party)})` : ""}
                      </span>
                    )}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {(gov.legislation ?? []).length > 0 && (
        <Panel
          title="Laws touching the company or its industry"
          subtitle="Public laws matched by company name or industry terms"
          collapse={false}
          bodyClassName="p-0"
        >
          <table className="w-full text-[12.5px]">
            <tbody>
              {gov.legislation!.slice(0, 10).map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="num whitespace-nowrap px-3 py-1.5">{fmtDate(l.date)}</td>
                  <td className="w-full max-w-0 px-3 py-1.5">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline"
                    >
                      {l.short_titles?.[0] ?? l.label}
                    </a>
                    <span
                      className="block truncate text-[11px] text-muted-foreground"
                      title={l.title}
                    >
                      {l.label} · {l.bills.join(", ")}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-[11px] text-muted-foreground">
                    {l.link === "company" ? "names the company" : `industry: “${l.match}”`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

export function SourceStatus({ gov }: { gov: GovFile }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Sources checked{" "}
      {Object.entries(gov.sources)
        .filter(([k]) => !k.startsWith("_"))
        .map(
          ([k, s]) =>
            `${k.replace(/_/g, " ")}: ${s.status}${s.count != null ? ` (${s.count})` : ""}`,
        )
        .join(" · ")}
      . Updated {fmtDate(gov.generated.slice(0, 10))}.
    </p>
  );
}
