import { useFeatureGate } from "@/hooks/use-plan";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Check, ChevronDown, Download, FileText, Link2, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ReportDocument, type ReportBrand } from "@/components/reports/report-document";
import { CustomizeDialog } from "@/components/reports/customize-dialog";
import { optionsSummary, useDeleteReport, useReportContent, useReportList, useRequestReport, type ReportMeta } from "@/components/reports/use-reports";
import { memberName, useCoverage, useFirm, useFirmLogo, useFirmMembers } from "@/components/firm/firm-context";
import { useCompany } from "@/lib/data";
import { RATING_LABEL, type Rating } from "@/lib/firm/core";
import { coverageOf } from "@/lib/coverage";
import { useProfile } from "@/lib/workspace";
import { dataVersionOf } from "@/lib/reports/facts";
import { KIND_ORDER, KINDS } from "@/lib/reports/kinds";
import type { ReportContent, ReportKind } from "@/lib/reports/types";
import { downloadBlob } from "@/lib/export/xlsx-theme";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/reports")({
  validateSearch: z.object({ kind: z.enum(["primer", "preview", "recap", "memo"]).optional(), v: z.string().max(40).optional() }),
  head: ({ params }) => {
    const name = coverageOf(params.ticker)?.shortName ?? params.ticker;
    return {
      meta: [
        { title: `${params.ticker.toUpperCase()} reports — primer, earnings preview & recap, IC memo — Filed Under` },
        { name: "description", content: `Always-ready ${name} research reports where every figure links to its SEC filing or market source; customize, brand and download as PDF or Word.` },
        { property: "og:title", content: `${name} research reports — Filed Under` },
        { property: "og:description", content: "Sourced company primer, earnings preview, earnings recap and IC memo." },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: ReportsTab,
});

const today = () => new Date().toISOString().slice(0, 10);

function scopeLabel(r: ReportMeta, firmName: string | undefined) {
  if (r.scope === "shared") return "Standard";
  return `${r.scope === "firm" ? firmName ?? "Firm" : "Mine"} · ${optionsSummary(r.options)}`;
}

function ReportsTab() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const search = Route.useSearch();
  const kind: ReportKind = search.kind ?? "primer";
  const navigate = Route.useNavigate();
  const list = useReportList(ticker);
  const company = useCompany(ticker);
  const req = useRequestReport();
  const del = useDeleteReport();
  const { firm, can, userId } = useFirm();
  const logo = useFirmLogo(firm?.id);
  const members = useFirmMembers(firm?.id);
  const coverage = useCoverage(firm?.id);
  const me = useProfile();
  const [customizing, setCustomizing] = useState(false);

  const rows = useMemo(() => (list.data ?? []).filter((r) => r.kind === kind), [list.data, kind]);
  const base = rows.find((r) => r.scope === "shared" && r.variant === "base");
  const selected = (search.v && rows.find((r) => r.id === search.v)) || base;
  const content = useReportContent(selected?.id, selected?.updated_at);
  const current = company.data ? dataVersionOf(company.data, today()) : null;
  const stale = !!(selected?.status === "ready" && current && selected.data_version && selected.data_version !== current);
  const generating = selected?.status === "generating" || (req.isPending && req.variables?.kind === kind && req.variables.scope === (selected?.scope ?? "shared"));

  // Always ready: write the standard version on first visit, and refresh it when new filings land.
  const started = useRef(new Set<string>());
  useEffect(() => {
    if (list.isLoading || list.isError || !company.data) return;
    const key = `${kind}:${current}`;
    if (started.current.has(key)) return;
    const lockFresh = base?.status === "generating" && base.started_at && Date.now() - Date.parse(base.started_at) < 4 * 60_000;
    if (lockFresh || base?.status === "failed") return;
    // Missing, out of date, or abandoned mid-write (the server reclaims a stale lock).
    if (!base || (base.status === "ready" && base.data_version !== current) || base.status === "generating") {
      started.current.add(key);
      req.mutate({ ticker, kind, scope: "shared" });
    }
  }, [list.isLoading, list.isError, company.data, kind, base, current, ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  const myMember = members.data?.find((m) => m.user_id === userId);
  const brand: ReportBrand = {
    branding: firm?.branding ?? null,
    logo: firm ? logo.data ?? null : null,
    firmName: firm?.name ?? null,
    preparedBy: myMember ? memberName(myMember) : me.data?.profile?.display_name ?? null,
  };
  const cov = coverage.data?.find((c) => c.ticker === ticker);
  const setKind = (k: ReportKind) => navigate({ search: { kind: k, v: undefined }, replace: true });
  const variants = rows.filter((r) => r.scope !== "shared");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden border bg-border md:grid-cols-4" role="tablist" aria-label="Report type">
        {KIND_ORDER.map((k) => {
          const b = (list.data ?? []).find((r) => r.kind === k && r.scope === "shared" && r.variant === "base");
          const active = k === kind;
          return (
            <button key={k} role="tab" aria-selected={active} onClick={() => setKind(k)}
              className={cn("bg-background px-3 py-2 text-left transition-colors hover:bg-secondary/60", active && "bg-card shadow-[inset_0_-2px_0_var(--color-foreground)]")}>
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <FileText className="size-3.5 opacity-70" /> {KINDS[k].label}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {!b ? "Not written yet" : b.status === "generating" ? <span className="text-shimmer">Writing…</span> : b.status === "failed" ? <span className="text-negative">Couldn't write</span> : `Ready · ${fmtRelative(b.updated_at)}`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="max-w-full"><span className="truncate">{selected ? scopeLabel(selected, firm?.name) : "Standard"}</span><ChevronDown className="size-3" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Versions of this {KINDS[kind].short.toLowerCase()}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => navigate({ search: { kind, v: undefined }, replace: true })}>
              <Check className={cn("size-4", selected?.id === base?.id ? "opacity-100" : "opacity-0")} /> Standard <span className="ml-auto text-[11px] text-muted-foreground">{base ? fmtDate(base.updated_at) : "—"}</span>
            </DropdownMenuItem>
            {variants.map((r) => (
              <DropdownMenuItem key={r.id} onClick={() => navigate({ search: { kind, v: r.id }, replace: true })}>
                <Check className={cn("size-4", selected?.id === r.id ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">{scopeLabel(r, firm?.name)}</span>
                <span className="text-[11px] text-muted-foreground">{r.status === "generating" ? "writing" : fmtDate(r.updated_at)}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCustomizing(true)}><SlidersHorizontal className="size-4" /> New custom version…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" onClick={() => setCustomizing(true)}><SlidersHorizontal /> Customize</Button>
        {selected && selected.scope !== "shared" && (
          <Button variant="ghost" size="sm" disabled={generating} onClick={() => req.mutate({ ticker, kind, scope: selected.scope, firmId: selected.firm_id, options: selected.options, force: true })}>
            <RefreshCw className={cn(generating && "animate-spin")} /> Rewrite
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {selected && (selected.scope === "user" || (selected.scope === "firm" && can("analyst"))) && (
            <Button variant="ghost" size="icon-sm" aria-label="Delete this version" onClick={() => { del.mutate(selected.id); navigate({ search: { kind, v: undefined }, replace: true }); }}><Trash2 /></Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Copy link to this report" onClick={() => { navigator.clipboard?.writeText(window.location.href); toast.success("Link copied"); }}><Link2 /></Button>
          <DownloadMenu content={content.data ?? null} brand={brand} />
        </div>
      </div>

      {kind === "memo" && firm && cov && selected?.scope === "shared" && can("analyst") && (
        <p className="border-l-2 border-highlight bg-highlight-soft/40 px-3 py-1.5 text-xs">
          {firm.name} rates {ticker} <span className="font-medium">{RATING_LABEL[cov.rating as Rating] ?? cov.rating}</span>{cov.target_price ? ` with a $${cov.target_price} target` : ""}. <button className="font-medium underline" onClick={() => req.mutate({ ticker, kind, scope: "firm", firmId: firm.id, options: { stance: "balanced" } }, { onSuccess: (r) => navigate({ search: { kind, v: r.id }, replace: true }) })}>Write the firm memo</button> to frame it around your rating.
        </p>
      )}
      {stale && selected?.scope === "shared" && (
        <p className="text-xs text-muted-foreground"><RefreshCw className={cn("mr-1 inline size-3", generating && "animate-spin")} />New filings or data since this was written{generating ? " — updating now; you're reading the previous version." : "."}</p>
      )}

      <div className="mx-auto w-full max-w-[880px]">
        {list.isLoading || (selected?.status === "ready" && content.isLoading) ? (
          <div className="space-y-3 border bg-card p-7"><Skeleton className="h-32" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-48" /></div>
        ) : content.data ? (
          <ReportDocument content={content.data} brand={brand} />
        ) : selected?.status === "failed" ? (
          <div className="border bg-card px-6 py-10 text-center">
            <p className="font-medium">This report couldn't be written</p>
            <p className="mt-1 text-sm text-muted-foreground">{selected.error ?? "Something went wrong."}</p>
            <Button className="mt-4" variant="outline" size="sm" onClick={() => req.mutate({ ticker, kind, scope: selected.scope, firmId: selected.firm_id, options: selected.options, force: true })}>Try again</Button>
          </div>
        ) : (
          <Writing kind={kind} name={coverageOf(ticker)?.shortName ?? ticker} startedAt={selected?.status === "generating" ? selected.started_at : null} />
        )}
      </div>

      <CustomizeDialog
        open={customizing}
        onOpenChange={setCustomizing}
        kind={kind}
        initial={selected?.scope !== "shared" ? selected?.options : undefined}
        pending={req.isPending && req.variables?.scope !== "shared"}
        onGenerate={(options, scope) => {
          setCustomizing(false);
          toast.message("Writing your version — about a minute");
          req.mutate({ ticker, kind, scope, firmId: scope === "firm" ? firm?.id : null, options }, {
            onSuccess: (r) => { if (r.status !== "failed") navigate({ search: { kind, v: r.id }, replace: true }); },
          });
        }}
      />
    </div>
  );
}

const STEPS = [
  "Loading reported statements, segments and filings",
  "Pulling consensus, price and management commitments",
  "Drafting each section from cited facts",
  "Checking every figure against its source",
];

function Writing({ kind, name, startedAt }: { kind: ReportKind; name: string; startedAt: string | null | undefined }) {
  const [mounted] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const t = Math.max(0, Math.round((now - (startedAt ? Date.parse(startedAt) : mounted)) / 1000));
  const step = Math.min(STEPS.length - 1, t < 6 ? 0 : t < 14 ? 1 : t < 60 ? 2 : 3);
  return (
    <div className="border bg-card px-7 py-10" aria-live="polite">
      <p className="eyebrow">{KINDS[kind].label}</p>
      <p className="text-shimmer mt-1 text-lg font-semibold">Writing the {KINDS[kind].label.toLowerCase()} for {name}…</p>
      <p className="mt-1 text-sm text-muted-foreground">{KINDS[kind].description} Usually about a minute; it's saved for everyone once written.</p>
      {t > 150 && <p className="mt-2 text-xs text-muted-foreground">Taking longer than usual — it will appear here, or show an error you can retry, in a moment.</p>}
      <ol className="mt-5 space-y-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2", i > step && "text-muted-foreground/60")}>
            <span className={cn("flex size-4 items-center justify-center rounded-full border text-[9px]", i < step && "border-positive bg-positive text-background", i === step && "border-foreground")}>{i < step ? <Check className="size-3" /> : ""}</span>
            <span className={cn(i === step && "text-shimmer")}>{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 space-y-2"><Skeleton className="h-3 w-11/12" /><Skeleton className="h-3 w-10/12" /><Skeleton className="h-3 w-8/12" /></div>
    </div>
  );
}

function DownloadMenu({ content, brand }: { content: ReportContent | null; brand: ReportBrand }) {
  const [docx, setDocx] = useState<Blob | null>(null);
  const [building, setBuilding] = useState(false);
  useEffect(() => setDocx(null), [content]);
  const file = content ? `${content.ticker}-${content.kind}-${content.asOf}` : "report";
  const prepare = async () => {
    if (!content || docx || building) return;
    setBuilding(true);
    try {
      const [{ reportToDocx }, { captureCharts }] = await Promise.all([import("@/lib/export/report-docx"), import("@/lib/export/chart-capture")]);
      const root = document.querySelector(".report-doc");
      setDocx(await reportToDocx(content, brand, root ? await captureCharts(root) : new Map()));
    } catch (e) {
      toast.error(`Word export failed: ${(e as Error).message}`);
    } finally {
      setBuilding(false);
    }
  };
  const gate = useFeatureGate();
  const print = () => {
    if (!gate("exports")) return;
    const root = document.documentElement;
    const done = () => { root.classList.remove("printing-report"); window.removeEventListener("afterprint", done); };
    root.classList.add("printing-report");
    window.addEventListener("afterprint", done);
    const title = document.title;
    document.title = file;
    window.print();
    document.title = title;
    setTimeout(done, 1000);
  };
  return (
    <DropdownMenu onOpenChange={(o) => { if (o) prepare(); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ink" size="sm" disabled={!content}><Download /> Download</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={print}>PDF<span className="ml-auto text-[11px] text-muted-foreground">Print → Save as PDF</span></DropdownMenuItem>
        <DropdownMenuItem disabled={!docx} onClick={() => docx && gate("exports") && downloadBlob(docx, `${file}.docx`)}>
          Word (.docx)<span className="ml-auto text-[11px] text-muted-foreground">{docx ? <Badge variant="outline">Ready</Badge> : building ? "Preparing…" : ""}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
