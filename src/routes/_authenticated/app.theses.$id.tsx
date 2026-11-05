import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CheckCircle2, Loader2, Pencil, ShieldAlert, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Panel, Stat } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { PriceChart } from "@/components/charts/price-chart";
import { ThesisForm, type ThesisDraft } from "@/components/app/thesis-form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useCompany, usePrices, useQuotes } from "@/lib/data";
import { fundamentalsDigest } from "@/lib/financials/summary";
import { fmtDate, fmtPct, fmtPrice, fmtRelative } from "@/lib/format";
import { reviewThesis, type ThesisReview } from "@/lib/thesis.functions";
import { currentUserId } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/theses/$id")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Thesis — Filed Under" },
      { name: "description", content: "Thesis detail, price tracking and AI review." },
      { property: "og:title", content: "Thesis — Filed Under" },
      { property: "og:description", content: "Thesis detail, price tracking and AI review." },
    ],
  }),
  component: ThesisDetail,
});

const KINDS = [
  { v: "note", l: "Note" },
  { v: "catalyst", l: "Catalyst" },
  { v: "risk", l: "Risk" },
  { v: "earnings", l: "Earnings" },
  { v: "price", l: "Price" },
] as const;

function ThesisDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["v"]>("note");
  const [review, setReview] = useState<(ThesisReview & { reviewedAt: string }) | null>(null);

  const t = useQuery({
    queryKey: ["thesis", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("theses").select("*, thesis_updates(*)").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const ticker = t.data?.ticker ?? "";
  const company = useCompany(ticker || "AAPL");
  const quote = useQuotes(ticker ? [ticker] : []).data?.quotes[0];
  const prices = usePrices(ticker || "AAPL", "2y", "1d", !!ticker);

  const updates = useMemo(() => [...(t.data?.thesis_updates ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)), [t.data]);

  const addUpdate = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId();
      const { error } = await supabase.from("thesis_updates").insert({ thesis_id: id, user_id: userId, kind, body: note.trim() });
      if (error) throw error;
      await supabase.from("theses").update({ updated_at: new Date().toISOString() }).eq("id", id);
    },
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["thesis", id] });
      qc.invalidateQueries({ queryKey: ["theses"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const delUpdate = useMutation({
    mutationFn: async (uid: string) => {
      const { error } = await supabase.from("thesis_updates").delete().eq("id", uid);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["thesis", id] }),
  });
  const setStatus = useMutation({
    mutationFn: async (status: "active" | "closed") => {
      const { error } = await supabase.from("theses").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      if (status === "closed" && quote) {
        const userId = await currentUserId();
        await supabase.from("thesis_updates").insert({ thesis_id: id, user_id: userId, kind: "price", body: `Closed at ${fmtPrice(quote.price)}.` });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["thesis", id] });
      qc.invalidateQueries({ queryKey: ["theses"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("theses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["theses"] });
      toast.success("Thesis deleted");
      navigate({ to: "/app/theses" });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const runReview = useMutation({
    mutationFn: () => reviewThesis({ data: { thesisId: id, price: quote?.price ?? null, fundamentals: fundamentalsDigest(company.data!).slice(0, 6000) } }),
    onSuccess: setReview,
    onError: (e) => toast.error((e as Error).message),
  });

  if (t.isLoading) return <Skeleton className="h-[600px]" />;
  if (!t.data)
    return (
      <div className="py-20 text-center">
        <p className="font-display text-3xl">Thesis not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/app/theses">Back to theses</Link>
        </Button>
      </div>
    );

  const th = t.data;
  const entry = th.entry_price != null ? Number(th.entry_price) : null;
  const target = th.target_price != null ? Number(th.target_price) : null;
  const dir = th.stance === "short" ? -1 : 1;
  const price = quote?.price ?? null;
  const pnl = price && entry ? ((price - entry) / entry) * dir : null;
  const upside = price && target ? ((target - price) / price) * dir : null;
  const daysOpen = Math.round((Date.now() - new Date(th.created_at).getTime()) / 86400000);
  const opened = th.created_at.slice(0, 10);
  const bars = (prices.data?.bars ?? []).filter((b) => b[0] >= new Date(new Date(opened).getTime() - 120 * 86400000).toISOString().slice(0, 10));
  const markers = [
    { time: opened, label: "Opened", color: "var(--foreground)" },
    ...(company.data?.earningsReleases ?? []).filter((r) => r.filed >= opened).map((r) => ({ time: r.filed, label: "E", color: "var(--chart-2)" })),
  ];

  const draft: ThesisDraft = {
    id: th.id,
    ticker: th.ticker,
    title: th.title,
    stance: th.stance as ThesisDraft["stance"],
    conviction: th.conviction,
    entry_price: entry,
    target_price: target,
    horizon: th.horizon ?? "",
    summary: th.summary,
    catalysts: th.catalysts,
    risks: th.risks,
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      <Link to="/app/theses" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All theses
      </Link>
      <div className="flex flex-wrap items-start gap-4">
        <CompanyLogo ticker={th.ticker} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/app/companies/$ticker" params={{ ticker: th.ticker }} className="num text-sm font-semibold hover:underline">
              {th.ticker}
            </Link>
            <Badge variant={th.stance === "long" ? "positive" : th.stance === "short" ? "negative" : "outline"} className="capitalize">
              {th.stance}
            </Badge>
            <Badge variant="outline">Conviction {th.conviction}/5</Badge>
            {th.status === "closed" && <Badge variant="secondary">Closed</Badge>}
          </div>
          <h1 className="mt-1 font-display text-[2.2rem] leading-tight">{th.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Opened {fmtDate(opened)} · {daysOpen} days · horizon {th.horizon ?? "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStatus.mutate(th.status === "active" ? "closed" : "active")} disabled={setStatus.isPending}>
            <CheckCircle2 /> {th.status === "active" ? "Close thesis" : "Reopen"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Delete thesis">
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this thesis?</AlertDialogTitle>
                <AlertDialogDescription>The thesis and its {updates.length} log entries will be permanently removed.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => remove.mutate()}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Entry" value={fmtPrice(entry)} sub={fmtDate(opened)} />
        <Stat label="Current" value={fmtPrice(price)} sub={quote ? fmtPct(quote.changePct, 2, true) + " today" : undefined} tone={quote && quote.changePct >= 0 ? "positive" : "negative"} />
        <Stat label={`Return (${th.stance})`} value={fmtPct(pnl, 1, true)} tone={pnl != null && pnl >= 0 ? "positive" : "negative"} sub={pnl != null ? (pnl >= 0 ? "working" : "against you") : undefined} />
        <Stat label="Target" value={fmtPrice(target)} sub={upside != null ? `${fmtPct(upside, 1, true)} remaining` : undefined} tone={upside != null && upside >= 0 ? "positive" : "negative"} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-1 content-start gap-5">
          <Panel title="Price since opened" subtitle="Dashed lines: entry and target · E = earnings release" bodyClassName="p-2">
            {bars.length ? (
              <PriceChart bars={bars} mode="area" height={300} showVolume={false} markers={markers} levels={[...(entry ? [{ price: entry, label: "Entry" }] : []), ...(target ? [{ price: target, label: "Target" }] : [])]} />
            ) : (
              <Skeleton className="h-[300px]" />
            )}
          </Panel>
          <Panel title="The thesis">
            <p className="whitespace-pre-line text-[14.5px] leading-relaxed">{th.summary}</p>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <p className="eyebrow flex items-center gap-1.5">
                  <CalendarClock className="size-3" /> Catalysts
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {th.catalysts.map((c) => (
                    <li key={c} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-positive" />
                      {c}
                    </li>
                  ))}
                  {!th.catalysts.length && <li className="text-muted-foreground">None listed</li>}
                </ul>
              </div>
              <div>
                <p className="eyebrow flex items-center gap-1.5">
                  <ShieldAlert className="size-3" /> Risks
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {th.risks.map((c) => (
                    <li key={c} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-negative" />
                      {c}
                    </li>
                  ))}
                  {!th.risks.length && <li className="text-muted-foreground">None listed</li>}
                </ul>
              </div>
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 content-start gap-5">
          <Panel
            title={
              <span className="flex items-center gap-1.5">
                <Sparkles className="size-3.5" /> AI review
              </span>
            }
            subtitle="Checks the thesis against the latest six quarters in the filings"
            actions={
              <Button size="xs" variant={review ? "outline" : "ink"} onClick={() => runReview.mutate()} disabled={runReview.isPending || !company.data}>
                {runReview.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {review ? "Re-run" : "Review now"}
              </Button>
            }
          >
            {runReview.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-16" />
                <Skeleton className="h-24" />
              </div>
            ) : review ? (
              <div className="grid grid-cols-1 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={review.verdict === "broken" ? "negative" : review.verdict === "weakening" ? "highlight" : "positive"}
                    className="capitalize"
                  >
                    {review.verdict === "broken" && <TriangleAlert />} {review.verdict}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{fmtRelative(review.reviewedAt)}</span>
                </div>
                <p className="leading-relaxed">{review.summary}</p>
                <ReviewList title="Supports" items={review.evidenceFor} tone="positive" />
                <ReviewList title="Contradicts" items={review.evidenceAgainst} tone="negative" />
                <ReviewList title="Watch next" items={review.watch} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Ask a skeptical reviewer whether the reported numbers still support this thesis.</p>
            )}
          </Panel>

          <Panel title="Log" subtitle="Earnings, catalysts, and second thoughts" bodyClassName="p-0">
            <form
              className="grid grid-cols-1 gap-2 border-b p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) addUpdate.mutate();
              }}
            >
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Q3 results: services +12%, margin guide raised…" maxLength={2000} />
              <div className="flex items-center gap-2">
                <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                  <SelectTrigger className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k.v} value={k.v}>
                        {k.l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="submit" size="sm" className="ml-auto" disabled={!note.trim() || addUpdate.isPending}>
                  {addUpdate.isPending && <Loader2 className="animate-spin" />} Add entry
                </Button>
              </div>
            </form>
            <ol className="divide-y">
              {updates.map((u) => (
                <li key={u.id} className="group px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="capitalize">
                      {u.kind}
                    </Badge>
                    {fmtDate(u.created_at)}
                    <button onClick={() => delUpdate.mutate(u.id)} className="ml-auto opacity-0 transition-opacity hover:text-negative group-hover:opacity-100" aria-label="Delete entry">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed">{u.body}</p>
                </li>
              ))}
              {!updates.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No entries yet.</li>}
            </ol>
          </Panel>
        </div>
      </div>
      <ThesisForm open={editing} onOpenChange={setEditing} initial={draft} />
    </div>
  );
}

function ReviewList({ title, items, tone }: { title: string; items: string[]; tone?: "positive" | "negative" }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="eyebrow">{title}</p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((x) => (
          <li key={x} className="flex gap-2 text-[13px] leading-relaxed">
            <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", tone === "positive" ? "bg-positive" : tone === "negative" ? "bg-negative" : "bg-chart-2")} />
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}
