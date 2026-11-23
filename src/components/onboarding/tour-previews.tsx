import type { TourPreview } from "@/lib/onboarding/steps";
import { CompanyLogo } from "@/components/app/company-logo";

/** Small looping illustrations (CSS keyframes, tokens only) shown at the top of each tour card. */
export function Preview({ kind }: { kind: TourPreview }) {
  return <div className="tour-preview" aria-hidden>{BODY[kind]}</div>;
}

const Bar = ({ w, d = 0, cls = "" }: { w: string; d?: number; cls?: string }) => (
  <span className={`tour-bar ${cls}`} style={{ width: w, animationDelay: `${d}ms` }} />
);

const BODY: Record<TourPreview, React.ReactNode> = {
  welcome: (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <div className="tour-folder" />
      <p className="font-display text-lg tracking-tight">FiledUnder</p>
      <p className="text-xs text-muted-foreground">Every number, sourced</p>
    </div>
  ),
  search: (
    <div className="flex h-full flex-col justify-center gap-2 px-5">
      <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs">
        <span className="text-muted-foreground">⌕</span><span className="tour-type font-mono">NVDA</span><span className="tour-caret" />
        <kbd className="ml-auto rounded border px-1 text-[9px] text-muted-foreground">⌘K</kbd>
      </div>
      <div className="tour-drop rounded-md border bg-background p-1.5 text-[11px]">
        <div className="rounded bg-accent px-2 py-1"><CompanyLogo ticker="NVDA" size="2xs" decorative className="mr-1.5 align-middle" /><b>NVDA</b> · NVIDIA Corp</div>
        <div className="px-2 py-1 text-muted-foreground">NVDA 10-K · FY2026</div>
      </div>
    </div>
  ),
  watchlist: (
    <div className="flex h-full flex-col justify-center gap-1.5 px-5 text-[11px]">
      {[["NVDA", "+2.4%"], ["MSFT", "+0.8%"], ["COST", "−0.3%"]].map(([t, c], k) => (
        <div key={t} className="tour-rise flex items-center rounded-md border bg-background px-2.5 py-1.5" style={{ animationDelay: `${k * 220}ms` }}>
          <CompanyLogo ticker={t} size="2xs" decorative className="mr-1.5" /><b>{t}</b><Bar w="40%" cls="mx-3" /><span className="ml-auto font-mono tabular-nums">{c}</span>
        </div>
      ))}
    </div>
  ),
  source: (
    <div className="grid h-full grid-cols-2 gap-2 p-3 text-[10px]">
      <div className="rounded-md border bg-background p-2">
        <p className="text-muted-foreground">Revenue</p>
        <p className="tour-click mt-1 inline-block rounded px-1 font-mono text-xs tabular-nums">130,497</p>
        <Bar w="70%" cls="mt-2" /><Bar w="55%" cls="mt-1" />
      </div>
      <div className="tour-doc rounded-md border bg-background p-2">
        <p className="text-muted-foreground">10-K · p.52</p>
        <Bar w="90%" cls="mt-1" /><Bar w="80%" cls="mt-1" />
        <p className="tour-mark mt-1 inline-block rounded px-1 font-mono">$130,497</p>
        <Bar w="60%" cls="mt-1" />
      </div>
    </div>
  ),
  ir: (
    <div className="flex h-full flex-col justify-center px-4 text-[10px]">
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-md border bg-border">
        {["Segment", "Q1", "Q2", "Q3", "Data Center", "39.1", "41.1", "51.2", "Gaming", "2.5", "4.3", "4.3", "Auto", "0.6", "0.6", "0.6"].map((c, k) => (
          <span key={k} className={`tour-cell bg-background px-1.5 py-1 ${k < 4 ? "font-medium" : k % 4 ? "text-right font-mono tabular-nums" : ""}`} style={{ animationDelay: `${k * 90}ms` }}>{c}</span>
        ))}
      </div>
      <p className="mt-1.5 text-muted-foreground">Source: Q3 earnings release, table 2</p>
    </div>
  ),
  assistant: (
    <div className="flex h-full flex-col justify-center gap-1.5 px-5 text-[11px]">
      <div className="tour-rise ml-auto rounded-lg bg-foreground px-2.5 py-1.5 text-background">How fast is NVDA's data center growing?</div>
      <div className="tour-rise rounded-lg border bg-background px-2.5 py-1.5" style={{ animationDelay: "500ms" }}>
        Up 66% year over year <span className="rounded bg-accent px-1 text-[9px]">10-Q ↗</span>
        <span className="tour-dots" />
      </div>
    </div>
  ),
  office: (
    <div className="grid h-full grid-cols-[1fr_1.2fr] gap-2 p-3 text-[10px]">
      <div className="grid grid-cols-3 gap-px self-center overflow-hidden rounded border bg-border">
        {Array.from({ length: 12 }, (_, k) => <span key={k} className="tour-cell h-4 bg-background" style={{ animationDelay: `${k * 110}ms` }} />)}
      </div>
      <div className="flex items-end gap-1.5 self-center rounded border bg-background p-2" style={{ height: 70 }}>
        {[35, 50, 72, 95].map((h, k) => <span key={k} className="tour-grow w-full rounded-sm bg-foreground" style={{ height: `${h}%`, animationDelay: `${600 + k * 150}ms` }} />)}
      </div>
    </div>
  ),
  supply: (
    <div className="relative h-full text-[10px]">
      <span className="tour-rise absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-foreground px-2 py-1 font-mono text-background">NVDA</span>
      {[["TSM", "12%", "18%"], ["MSFT", "19%", "70%"], ["SK hynix", "68%", "14%"], ["Foxconn", "70%", "72%"]].map(([n, l, t], k) => (
        <span key={n} className="tour-rise absolute rounded border bg-background px-1.5 py-0.5" style={{ left: l, top: t, animationDelay: `${300 + k * 200}ms` }}>{n}</span>
      ))}
      <p className="absolute bottom-1.5 left-3 text-muted-foreground">“…a single foundry partner” · 10-K</p>
    </div>
  ),
  thesis: (
    <div className="flex h-full flex-col justify-center gap-1.5 px-5 text-[11px]">
      <div className="tour-rise rounded-md border bg-background px-2.5 py-1.5"><b>Long COST</b> · membership renewals stay above 90%</div>
      <div className="tour-rise flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5" style={{ animationDelay: "500ms" }}>
        <span className="size-1.5 rounded-full bg-positive" /> Renewal rate 92.9% · 10-Q ↗
      </div>
      <div className="tour-rise flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5" style={{ animationDelay: "900ms" }}>
        <span className="size-1.5 rounded-full bg-negative" /> Kill criterion not hit
      </div>
    </div>
  ),
  redline: (
    <div className="flex h-full flex-col justify-center gap-1 px-5 font-mono text-[10px]">
      <p className="text-muted-foreground">Risk factors · 10-K FY25 → FY26</p>
      <p className="tour-rise">demand <span className="rounded bg-negative/20 line-through">may fluctuate</span> <span className="rounded bg-positive/20">depends on a limited number of customers</span></p>
      <Bar w="85%" cls="mt-1" /><Bar w="60%" cls="mt-1" />
    </div>
  ),
  valuation: (
    <div className="flex h-full items-end gap-1 px-5 pb-5 pt-6">
      {[40, 55, 48, 70, 62, 85, 74, 66, 90, 78].map((h, k) => <span key={k} className="tour-grow w-full rounded-sm bg-foreground/80" style={{ height: `${h}%`, animationDelay: `${k * 90}ms` }} />)}
    </div>
  ),
  finish: (
    <div className="flex h-full items-center justify-center gap-3">
      {["?", "⌘K", "⌘J"].map((k, n) => <kbd key={k} className="tour-rise rounded-md border bg-background px-3 py-2 font-mono text-sm shadow-sm" style={{ animationDelay: `${n * 180}ms` }}>{k}</kbd>)}
    </div>
  ),
};
