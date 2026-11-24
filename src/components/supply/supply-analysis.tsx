// The panel beside the supply-chain map: the filing evidence for the selected name, and the lists that go with the
// map (stated exposure, the shock simulation, what changed since the last annual report, earnings sympathy moves).
// Every list follows what is isolated on the map. Nothing here scrolls the page: a click only changes what is shown.
import type { ReactNode } from "react";
import { logoKey } from "@/lib/supply/logo-key";
import { Link } from "@tanstack/react-router";
import { ArrowRight, FileText, Focus, Globe2, Link2, Lock, Zap } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requestResearch } from "@/lib/research/request";
import { confidence, mirrors, type GraphNode, type HopNode, type NodeRisk, type ProLink, type Relation, type RiskLink, type ShockImpact, type StatedAmount } from "@/lib/supply/core";
import { KIND_WORD, NATURE_WORD, nodeFacts, type ExposureRow } from "@/lib/supply/describe";
import { isolatedHas, type Isolated } from "@/lib/supply/isolate";
import { estimateWords } from "@/lib/supply/strip";
import type { IsolateRequest } from "@/lib/supply/isolate-contract";
import { SUPPLY_TABS, type SupplyTab } from "@/lib/supply/url-state";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { externalLogo, impactKey, RELATION_ONE } from "./supply-map-meta";
import { figure, RelationMark } from "./supply-marks";
import { DeepVerify, FreshnessBadge } from "./supply-plus";
import { ConfidenceBadge } from "./supply-pro";
import { quoteShown } from "@/lib/supply/quote-cut";

const TAB_LABEL: Record<SupplyTab, string> = { evidence: "Evidence", exposure: "Exposure", shock: "Shock", changes: "Changes", reactions: "Moves" };
/** Reading order of the tabs: what a selection opens first, then the figures, then the what-ifs and history. */
const TAB_ORDER: SupplyTab[] = ["evidence", "exposure", "shock", "changes", "reactions"];
export const isSupplyTab = (v: unknown): v is SupplyTab => typeof v === "string" && (SUPPLY_TABS as readonly string[]).includes(v);

const chip = "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-4";
const sourceButton = "inline-flex min-h-7 shrink-0 items-center gap-1 rounded bg-highlight-soft px-2 text-[11px] font-medium text-foreground transition-colors duration-150 hover:bg-highlight hover:text-highlight-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";
const quietButton = "inline-flex min-h-7 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";
const logoOf = (n: Pick<GraphNode, "ticker" | "name">) => logoKey(n);

type OpenLink = (l: RiskLink, label: string) => void;

/** What a name's sentences flag: the kind of tie when it is not trade, sole-source wording, a stated dependency, a 10%+ share, named regions. */
function RiskBadges({ r }: { r?: NodeRisk }) {
  if (!r) return null;
  const nature = NATURE_WORD[r.nature];
  if (!nature && !r.singleSource && !r.dependency && !r.concentrated && !r.regions.length) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Flags">
      {nature && <li className={cn(chip, "text-foreground")}>{nature}: not a flow</li>}
      {r.singleSource && <li className={cn(chip, "border-negative/40 text-negative")}><Lock className="size-3" aria-hidden="true" />Single source</li>}
      {r.dependency && <li className={cn(chip, "text-muted-foreground")}><Link2 className="size-3" aria-hidden="true" />Stated dependency</li>}
      {r.concentrated && <li className={cn(chip, "border-negative/40 text-negative")}>10% or more</li>}
      {r.regions.map((x) => (
        <li key={x} className={cn(chip, r.hotspots.includes(x) ? "border-negative/40 text-negative" : "text-muted-foreground")}>{r.hotspots.includes(x) && <Globe2 className="size-3" aria-hidden="true" />}{x}{r.hotspots.includes(x) && <span className="sr-only"> (hotspot)</span>}</li>
      ))}
    </ul>
  );
}

export interface NodeEvidenceProps {
  sel: GraphNode | HopNode;
  focusName: string;
  risk: NodeRisk | undefined;
  names: Record<string, string>;
  covered: Set<string>;
  all: RiskLink[];
  today: string;
  /** this name is what the map isolates */
  isolated: boolean;
  onIsolate: (request: IsolateRequest) => void;
  onOpen: OpenLink;
  onGo: (ticker: string) => void;
  onShock: (ticker: string) => void;
}

/** Everything the filings say about one name: who states it, the figures that sentence states, the sentence, and its source. */
export function NodeEvidence({ sel, focusName, risk, names, covered, all, today, isolated, onIsolate, onOpen, onGo, onShock }: NodeEvidenceProps) {
  const second = "hop" in sel;
  const links = sel.links as RiskLink[];
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <CompanyLogo ticker={logoOf(sel)} src={externalLogo(sel.domain, sel.ticker)} size="md" decorative />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-5">{sel.name}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {sel.ticker ? <span className="num text-foreground/80">{sel.ticker}</span> : "Not in coverage"} · {RELATION_ONE[sel.relation as Relation]}{second ? " of a direct link (second order)" : ` of ${focusName}`} · <span className="num">{links.length}</span> {links.length === 1 ? "statement" : "statements"}
          </p>
        </div>
        <button type="button" aria-pressed={isolated} onClick={() => onIsolate({ kind: "node", key: sel.key })} title={isolated ? "Show everything again" : "Keep this name lit on the map and dim the rest"}
          className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors duration-150 hover:border-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", isolated ? "border-foreground bg-secondary" : "bg-card shadow-paper")}>
          <Focus className="size-3.5" aria-hidden="true" />{isolated ? "Isolated" : "Isolate"}
        </button>
      </div>
      <RiskBadges r={risk && sel.relation === "competitor" ? { ...risk, nature: "trade" } : risk} />
      <div className="flex flex-wrap gap-2">
        {sel.ticker && covered.has(sel.ticker) && <Button size="xs" variant="outline" onClick={() => onGo(sel.ticker as string)} title={`Map ${sel.name}'s own supply chain`}>Map {sel.ticker}<ArrowRight /></Button>}
        {sel.ticker && <Button size="xs" variant="outline" onClick={() => onShock(sel.ticker as string)} title={`Simulate a shock at ${sel.name}`}><Zap />Shock {sel.ticker}</Button>}
        {sel.ticker && covered.has(sel.ticker) && <Button size="xs" variant="outline" asChild><Link to="/app/companies/$ticker" params={{ ticker: sel.ticker }}>Company page<ArrowRight /></Link></Button>}
        <Button size="xs" variant="outline" onClick={() => requestResearch(`Investigate ${focusName}'s ${sel.relation} relationship with ${sel.name}. Read the supply-chain evidence, dated agreements, regional risks and latest public developments. Cross-check sources, quantify only disclosed exposure and distinguish uncertainty.`)}>Investigate</Button>
      </div>
      <ol className="space-y-2">
        {links.map((l) => {
          /* figures this filing's own sentence states; a figure only an older copy states is listed with that copy below */
          const own = l.own ?? l;
          const nature = l.relation !== "competitor" ? NATURE_WORD[l.nature ?? "trade"] : null;
          const pro = l as ProLink;
          return (
            <li key={l.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[11px] leading-4 text-muted-foreground">
                  <span className="font-medium text-foreground">{names[l.ticker] ?? l.ticker} {l.form}</span> · filed {fmtDate(l.filed)}
                  {own.share_pct != null && <span className="num text-foreground"> · {own.share_pct}% share</span>}
                  {own.amount_usd != null && own.amount_usd > 0 && (
                    <span className="num text-foreground"> · {fmtCompactUsd(own.amount_usd)} {KIND_WORD[own.amount_kind ?? "other"]}{own.flow_usd != null ? "" : <span className="text-muted-foreground"> (not a flow)</span>}</span>
                  )}
                </p>
                <button type="button" onClick={() => onOpen(l, `${sel.name} · ${l.relation}`)} className={sourceButton} aria-label={`Open the sentence in ${names[l.ticker] ?? l.ticker}'s ${l.form}`}>
                  <FileText className="size-3" aria-hidden="true" />Open {l.form}
                </button>
              </div>
              {l.figure_from && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {[l.figure_from.share && "share", l.figure_from.amount && "amount", l.figure_from.single && "single-source wording", l.figure_from.regions && "regions"].filter(Boolean).join(", ")} stated only in the older filing below, and counted from it
                </p>
              )}
              <p className="mt-1.5 text-[13px] leading-5">{l.detail}</p>
              <blockquote className="mt-1.5 border-l-2 border-highlight pl-2 text-xs italic leading-relaxed text-muted-foreground">“{l.quote}”</blockquote>
              {l.risk && <p className="mt-1.5 text-xs text-negative">Risk: {l.risk}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {nature && <span className={cn(chip, "text-foreground")}>{nature}: not a flow</span>}
                {l.single_source && <span className={cn(chip, "border-negative/40 text-negative")}><Lock className="size-3" aria-hidden="true" />Single source</span>}
                {l.dependency && <span className={cn(chip, "text-muted-foreground")}><Link2 className="size-3" aria-hidden="true" />Stated dependency, no sole-source wording</span>}
                <ConfidenceBadge c={confidence(pro, all)} />
                <FreshnessBadge filed={l.filed} today={today} />
                {pro.link_type && pro.link_type !== "other" && <span className={cn(chip, "border-transparent bg-muted")}>{pro.link_type.replace(/_/g, " ")}</span>}
                {pro.product && <span className={cn(chip, "border-transparent bg-muted")}>{pro.product}</span>}
              </div>
              {mirrors(l, all).slice(0, 1).map((m) => (
                <button key={m.id} type="button" onClick={() => onOpen(m as RiskLink, `${names[m.ticker] ?? m.ticker} confirms`)} className="mt-2 block rounded text-left text-[11px] leading-4 text-positive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {names[m.ticker] ?? m.ticker}'s {m.form} confirms: “{quoteShown(m.quote, 110)}”
                </button>
              ))}
              {(l.corroboration ?? []).length > 0 && (
                <div className="mt-2 border-t pt-2">
                  <p className="text-[11px] text-muted-foreground">Also stated in {names[l.ticker] ?? l.ticker}'s other current {(l.corroboration ?? []).length === 1 ? "filing" : "filings"} (counted once):</p>
                  {(l.corroboration ?? []).map((c) => (
                    <button key={c.id} type="button" onClick={() => onOpen(c, `${sel.name} · ${c.relation} · ${c.form}`)} className="mt-1 block w-full rounded px-1 py-0.5 text-left text-[11px] leading-4 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="inline-flex items-center gap-1 font-medium text-foreground"><FileText className="size-3" aria-hidden="true" />{c.form}, filed {fmtDate(c.filed)}</span>
                      {c.share_pct != null && <span className="num"> · {c.share_pct}%</span>}
                      {c.amount_usd != null && c.amount_usd > 0 && <span className="num"> · {fmtCompactUsd(c.amount_usd)} {KIND_WORD[c.amount_kind ?? "other"]}</span>}
                      <span className="block italic">“{quoteShown(c.quote, 140)}”</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2"><DeepVerify key={l.id} linkId={l.id} /></div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One name as a row: its relation mark, its logo and name, its flags and its stated figure. Pressing it opens its evidence. */
function NameRow({ n, risk, onPick }: { n: GraphNode | HopNode; risk: NodeRisk | undefined; onPick: (key: string) => void }) {
  const fig = figure(nodeFacts(n, risk));
  return (
    <li>
      <button type="button" onClick={() => onPick(n.key)} className="flex h-8 w-full items-center gap-2 rounded px-1 text-left text-[13px] transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
        <RelationMark relation={n.relation as Relation} size={8} />
        <CompanyLogo ticker={logoOf(n)} src={externalLogo(n.domain, n.ticker)} size="xs" decorative />
        <span className="min-w-0 flex-1 truncate">{n.name}</span>
        {risk?.singleSource && <Lock className="size-3 shrink-0 text-negative" aria-label="single source" />}
        {(risk?.hotspots.length ?? 0) > 0 && <Globe2 className="size-3 shrink-0 text-warning" aria-label="hotspot region" />}
        {fig ? <span className="num shrink-0 text-xs"><span className={fig.flow ? "font-medium" : "text-muted-foreground"}>{fig.value}</span> <span className="text-[11px] text-muted-foreground">{fig.unit}</span></span>
          : <span className="shrink-0 text-[11px] text-muted-foreground">{RELATION_ONE[n.relation as Relation].toLowerCase()}</span>}
      </button>
    </li>
  );
}

/**
 * What the evidence tab shows before a name is picked: the names inside what is isolated, or else the names whose
 * sentences state a figure or carry a flag (the map itself lists every name).
 */
export function NameList({ nodes, risks, isolated, onPick, onClear }: { nodes: (GraphNode | HopNode)[]; risks: Record<string, NodeRisk>; isolated: Isolated | null; onPick: (key: string) => void; onClear: () => void }) {
  const lit = isolated ? nodes.filter((n) => isolated.lit.has(n.key)) : null;
  const notable = nodes.filter((n) => { const r = risks[n.key]; return r && (r.dollars != null || r.concentrated || r.singleSource || r.dependency || r.hotspots.length > 0 || figure(nodeFacts(n, r)) != null); });
  const list = lit ?? (notable.length ? notable : nodes.slice(0, 12));
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        {lit ? <><span className="num">{lit.length}</span> of <span className="num">{nodes.length}</span> names are inside what is isolated ({isolated?.label}). <button type="button" onClick={onClear} className="rounded underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Show all</button></>
          : notable.length ? <>Pick a name on the map to read its filing sentences. These <span className="num">{notable.length}</span> carry a stated figure or a flag:</>
          : <>Pick a name on the map to read its filing sentences. No name carries a stated figure or a flag.</>}
      </p>
      {list.length > 0 && <ul>{list.map((n) => <NameRow key={n.key} n={n} risk={risks[n.key]} onPick={onPick} />)}</ul>}
      {!lit && !notable.length && nodes.length > list.length && <p className="mt-1 text-[11px] text-muted-foreground"><span className="num">{nodes.length - list.length}</span> more on the map</p>}
    </div>
  );
}

/** Stated exposure: each name once at its largest stated flow or stated customer share × SEC revenue, then the figures that are never added. */
export function ExposureList({ focusName, exposure, others, names, isolated, onOpen }: {
  focusName: string;
  exposure: ExposureRow[];
  others: { n: GraphNode; a: StatedAmount }[];
  names: Record<string, string>;
  isolated: Isolated | null;
  onOpen: OpenLink;
}) {
  const rows = exposure.filter((x) => isolatedHas(isolated, x.n));
  const rest = others.filter((x) => isolatedHas(isolated, x.n));
  const total = rows.reduce((t, x) => t + x.d, 0);
  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{exposure.length ? `No name inside what is isolated (${isolated?.label}) carries a stated flow or share.` : `${focusName}'s filings put no revenue, purchase or contract figure, and no customer share, on a named counterparty.`}</p>
      ) : (
        <div>
          <p className="mb-1 flex items-baseline justify-between gap-2 text-xs text-muted-foreground"><span>Each name once, at its largest stated flow, or estimated as a stated share × SEC revenue</span><span className="num shrink-0 text-[13px] font-semibold text-foreground">{fmtCompactUsd(total)}</span></p>
          <ul className="divide-y border-y">
            {rows.map(({ n, l, d, from, period, basis }) => (
              <li key={n.key} className="flex items-center gap-2 py-1.5">
                <RelationMark relation={n.relation as Relation} size={8} />
                <CompanyLogo ticker={logoOf(n)} src={externalLogo(n.domain, n.ticker)} size="xs" decorative />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{n.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{from === "flow" ? `stated ${KIND_WORD[l.amount_kind ?? "other"]}` : l.share_pct != null ? estimateWords(l.share_pct, period, names[l.ticker] ?? l.ticker, basis) : n.relation}</span>
                </span>
                <span className="num shrink-0 text-[13px] font-medium">{fmtCompactUsd(d)}</span>
                <button type="button" onClick={() => onOpen(l, `${n.name} · exposure`)} aria-label={`Source for ${n.name}`} className={quietButton}><FileText className="size-3" aria-hidden="true" />Source</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rest.length > 0 && (
        <div data-section="Other stated figures">
          <p className="text-xs font-medium">Other stated figures, not added</p>
          <p className="mb-1 text-[11px] text-muted-foreground">Amounts the sentences state that are not money for goods or services between the two companies.</p>
          <ul className="divide-y border-y">
            {rest.map(({ n, a }) => (
              <li key={a.link.id} className="flex items-center gap-2 py-1.5 text-xs">
                <RelationMark relation={n.relation as Relation} size={8} />
                <CompanyLogo ticker={logoOf(n)} src={externalLogo(n.domain, n.ticker)} size="xs" decorative />
                <span className="min-w-0 flex-1 truncate">{n.name}</span>
                <span className="num shrink-0 text-muted-foreground">{fmtCompactUsd(a.value)} {KIND_WORD[a.kind]}</span>
                <button type="button" aria-label={`Source for ${n.name}, ${KIND_WORD[a.kind]}`} onClick={() => onOpen(a.link, `${n.name} · ${KIND_WORD[a.kind]}`)} className={quietButton}><FileText className="size-3" aria-hidden="true" />Source</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The shock simulation: who is hit when one company's demand or output drops, two steps out, from stated shares and flows only. */
export function ShockPanel({ src, sources, names, shock, onShock, onSrc, impacts, lit, isolatedLabel, onOpen }: {
  src: string;
  /** tickers that can be shocked: the company and its listed counterparties */
  sources: string[];
  names: Record<string, string>;
  /** size of the shock, percent */
  shock: number;
  onShock: (v: number) => void;
  onSrc: (ticker: string) => void;
  impacts: ShockImpact[];
  /** impact keys inside what is isolated, or null when nothing is */
  lit: ReadonlySet<string> | null;
  isolatedLabel: string | null;
  onOpen: OpenLink;
}) {
  const rows = lit ? impacts.filter((i) => lit.has(i.key)) : impacts;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        If <span className="font-medium text-foreground">{names[src] ?? src}</span>'s demand or output drops, its suppliers lose sales (sized by the revenue share they disclose) and its customers face supply disruption. Effects ripple two steps out.
      </p>
      <Select value={src} onValueChange={onSrc}>
        <SelectTrigger className="h-8 text-xs" aria-label="Company to shock"><SelectValue /></SelectTrigger>
        <SelectContent>
          {sources.map((tk) => <SelectItem key={tk} value={tk}>Shock {names[tk] ?? tk}</SelectItem>)}
        </SelectContent>
      </Select>
      <div>
        <div className="mb-2 flex justify-between text-xs"><span>Size of shock</span><span className="num font-semibold">−{shock}%</span></div>
        <Slider value={[shock]} min={5} max={80} step={5} onValueChange={([v]) => onShock(v)} aria-label="Size of shock, percent" />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{impacts.length ? `The shock reaches no name inside what is isolated (${isolatedLabel}).` : "No linked companies in the filings yet."}</p>
      ) : (
        <ul className="divide-y border-y">
          {rows.slice(0, 30).map((i) => (
            <li key={i.key} className={cn("flex items-start gap-2 py-1.5", i.severity === "high" && "bg-negative-soft/60")}>
              <CompanyLogo ticker={logoKey(i)} size="xs" decorative className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2"><span className="min-w-0 truncate text-[13px] font-medium">{i.name}</span><span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{i.hop === 1 ? "direct" : `${i.hop} steps`} · {i.severity}</span></span>
                <span className="block text-xs">
                  <span className={cn(i.channel === "lost sales" ? "text-negative" : "text-foreground")}>{i.channel}</span>
                  {i.revenuePct != null && <span className="num"> · {fmtPct(i.revenuePct, 2)} of revenue</span>}
                  {i.dollars != null && <span className="num"> · ≈{fmtCompactUsd(i.dollars)}</span>}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{i.path.join(" → ")}</span>
              </span>
              <button type="button" onClick={() => onOpen(i.link, `${i.name} · ${i.channel}`)} aria-label={`Source for ${i.name}`} className={quietButton}><FileText className="size-3" aria-hidden="true" />Source</button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 30 && <p className="text-[11px] text-muted-foreground">The 30 largest of <span className="num">{rows.length}</span> are listed.</p>}
      <p className="text-[11px] text-muted-foreground">Mechanical estimate from disclosed shares only; not a forecast.</p>
    </div>
  );
}

/** Impact keys of the names inside what is isolated, so the shock list can follow the map. */
export function litImpactKeys(isolated: Isolated | null, nodes: (GraphNode | HopNode)[]): ReadonlySet<string> | null {
  return isolated ? new Set(nodes.filter((n) => isolated.lit.has(n.key)).map(impactKey)) : null;
}

/** The panel's content: one heading, the five tabs as real tab buttons, and the tab bodies the page passes in. */
export function SupplyAnalysis({ tab, onTab, evidence, exposure, shock, changes, reactions }: {
  tab: SupplyTab;
  onTab: (t: SupplyTab) => void;
  evidence: ReactNode;
  exposure: ReactNode;
  shock: ReactNode;
  changes: ReactNode;
  reactions: ReactNode;
}) {
  const body: Record<SupplyTab, ReactNode> = { evidence, exposure, shock, changes, reactions };
  const section: Record<SupplyTab, string> = { evidence: "Link evidence", exposure: "Stated exposure", shock: "Shock simulation", changes: "Changes since the last annual report", reactions: "Earnings moves" };
  return (
    <Panel title="Evidence and analysis" collapse={false}>
      <Tabs value={tab} onValueChange={(t) => { if (isSupplyTab(t)) onTab(t); }}>
        <TabsList className="mb-3 grid h-8 w-full grid-cols-5 rounded-md p-0.5">
          {TAB_ORDER.map((t) => <TabsTrigger key={t} value={t} data-tour={t === "shock" ? "supply-shock" : undefined} className="h-7 rounded px-1 text-xs">{TAB_LABEL[t]}</TabsTrigger>)}
        </TabsList>
        {TAB_ORDER.map((t) => (
          <TabsContent key={t} value={t} data-section={section[t]} className="mt-0">
            {tab === t ? body[t] : null}
          </TabsContent>
        ))}
      </Tabs>
    </Panel>
  );
}
