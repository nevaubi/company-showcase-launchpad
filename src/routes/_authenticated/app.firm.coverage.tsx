import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Lock, MessageSquareText, Plus, Search, Trash2 } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { CompanyPicker } from "@/components/firm/company-picker";
import { memberName, useCoverage, useFirm, useFirmMembers, useRemoveCoverage, useSaveCoverage, type CoverageRow } from "@/components/firm/firm-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuotes, useUniverse } from "@/lib/data";
import { PRIORITY_LABEL, RATING_LABEL, RATING_TONE, RATINGS, upside, type Rating } from "@/lib/firm/core";
import { fmtPct, fmtPrice, fmtRelative } from "@/lib/format";
import { useSessionState } from "@/lib/use-session-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/firm/coverage")({
  head: () => ({
    meta: [
      { title: "Coverage — Firm workspace — Filed Under" },
      { name: "description", content: "Your firm's shared coverage list with analysts, ratings, targets and the restricted list." },
      { property: "og:title", content: "Coverage — Firm workspace — Filed Under" },
      { property: "og:description", content: "Your firm's shared coverage list with analysts, ratings, targets and the restricted list." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CoveragePage,
});

const UNASSIGNED = "__none";

function CoveragePage() {
  const { firm, can, userId } = useFirm();
  const coverage = useCoverage(firm?.id);
  const members = useFirmMembers(firm?.id);
  const universe = useUniverse();
  const save = useSaveCoverage(firm?.id);
  const remove = useRemoveCoverage(firm?.id);
  const rows = coverage.data ?? [];
  const quotes = useQuotes(rows.map((r) => r.ticker));
  const price = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q.price]));
  const company = new Map((universe.data?.companies ?? []).map((c) => [c.ticker, c]));
  const byId = new Map((members.data ?? []).map((m) => [m.user_id, m]));
  const [filters, setFilters] = useSessionState(`fu:firm-coverage:${firm?.id ?? ""}`, { q: "", analyst: "all", rating: "all", restricted: false });
  const editable = can("analyst");

  const shown = useMemo(() => rows.filter((r) => {
    const c = company.get(r.ticker);
    const q = filters.q.trim().toLowerCase();
    if (q && !r.ticker.toLowerCase().includes(q) && !(c?.name ?? "").toLowerCase().includes(q)) return false;
    if (filters.analyst === "me" && r.analyst_id !== userId) return false;
    if (filters.analyst === UNASSIGNED && r.analyst_id) return false;
    if (filters.analyst !== "all" && filters.analyst !== "me" && filters.analyst !== UNASSIGNED && r.analyst_id !== filters.analyst) return false;
    if (filters.rating !== "all" && r.rating !== filters.rating) return false;
    if (filters.restricted && !r.restricted) return false;
    return true;
  }).sort((a, b) => a.priority - b.priority || a.ticker.localeCompare(b.ticker)), [rows, filters, company, userId]);

  const counts = RATINGS.map((r) => [r, rows.filter((x) => x.rating === r).length] as const).filter(([, n]) => n);
  const add = (ticker: string) => save.mutate({ ticker, create: true, patch: { analyst_id: userId } });

  const exportCsv = () => {
    const head = ["Ticker", "Company", "Sector", "Analyst", "Rating", "Price", "Target", "Upside", "Priority", "Restricted", "Restricted reason", "Note", "Updated"];
    const lines = shown.map((r) => {
      const p = price.get(r.ticker) ?? null;
      const u = upside(p, r.target_price);
      return [r.ticker, company.get(r.ticker)?.name ?? "", company.get(r.ticker)?.sector ?? "", r.analyst_id ? memberName(byId.get(r.analyst_id)) : "",
        RATING_LABEL[r.rating], p ?? "", r.target_price ?? "", u == null ? "" : (u * 100).toFixed(1) + "%", PRIORITY_LABEL[r.priority],
        r.restricted ? "Yes" : "No", r.restricted_reason ?? "", r.note ?? "", r.updated_at.slice(0, 10)];
    });
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(firm?.name ?? "firm").replace(/\W+/g, "-").toLowerCase()}-coverage.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px border-y bg-border sm:grid-cols-4">
        <Tile label="Covered" value={rows.length} />
        <Tile label="Unassigned" value={rows.filter((r) => !r.analyst_id).length} />
        <Tile label="Restricted" value={rows.filter((r) => r.restricted).length} tone={rows.some((r) => r.restricted) ? "negative" : undefined} />
        <div className="bg-background px-3 py-2">
          <p className="text-[10.5px] text-muted-foreground">Ratings</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {counts.length ? counts.map(([r, n]) => <Badge key={r} variant={RATING_TONE[r] === "positive" ? "positive" : RATING_TONE[r] === "negative" ? "negative" : "outline"}>{RATING_LABEL[r]} {n}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}
          </div>
        </div>
      </div>

      <Panel
        title="Coverage list"
        subtitle="Shared with everyone in the firm. Ratings, targets and restricted-list changes are logged."
        collapse={false}
        actions={
          <>
            <Button size="xs" variant="ghost" onClick={exportCsv} disabled={!shown.length}><Download /> CSV</Button>
            {editable && (
              <CompanyPicker onPick={add} exclude={new Set(rows.map((r) => r.ticker))} align="end">
                <Button size="xs" variant="ink"><Plus /> Add company</Button>
              </CompanyPicker>
            )}
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-48">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 pl-7 text-sm" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Filter ticker or name" aria-label="Filter coverage" />
          </div>
          <Select value={filters.analyst} onValueChange={(v) => setFilters((f) => ({ ...f, analyst: v }))}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="Analyst"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All analysts</SelectItem>
              <SelectItem value="me" className="text-xs">My coverage</SelectItem>
              <SelectItem value={UNASSIGNED} className="text-xs">Unassigned</SelectItem>
              {(members.data ?? []).map((m) => <SelectItem key={m.user_id} value={m.user_id} className="text-xs">{memberName(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.rating} onValueChange={(v) => setFilters((f) => ({ ...f, rating: v }))}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label="Rating"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All ratings</SelectItem>
              {RATINGS.map((r) => <SelectItem key={r} value={r} className="text-xs">{RATING_LABEL[r]}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={filters.restricted} onCheckedChange={(v) => setFilters((f) => ({ ...f, restricted: v }))} aria-label="Restricted only" /> Restricted only
          </label>
        </div>

        {coverage.isLoading ? <Skeleton className="h-48" /> : coverage.isError ? (
          <p className="text-sm text-negative">Coverage couldn't load. <Button variant="link" size="xs" onClick={() => coverage.refetch()}>Retry</Button></p>
        ) : !rows.length ? (
          <div className="border border-dashed px-6 py-10 text-center">
            <p className="font-medium">No companies covered yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add the names your team follows. Each one gets an analyst, a rating, a target and an audit trail.</p>
            {editable && <CompanyPicker onPick={add} exclude={new Set()}><Button className="mt-3" size="sm" variant="outline"><Plus /> Add the first company</Button></CompanyPicker>}
          </div>
        ) : !shown.length ? <p className="py-6 text-center text-sm text-muted-foreground">No coverage matches these filters.</p> : (
          <div className="-mx-3.5 overflow-x-auto">
            <Table className="research-table min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Analyst</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Upside</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Restricted</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <CoverageTableRow
                    key={r.ticker}
                    row={r}
                    name={company.get(r.ticker)?.name}
                    logo={company.get(r.ticker)?.logo}
                    sector={company.get(r.ticker)?.sector}
                    price={price.get(r.ticker) ?? null}
                    members={members.data ?? []}
                    editable={editable}
                    admin={can("admin")}
                    updatedBy={r.updated_by ? memberName(byId.get(r.updated_by)) : null}
                    onSave={(patch) => save.mutate({ ticker: r.ticker, patch })}
                    onRemove={() => remove.mutate(r.ticker)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "negative" }) {
  return (
    <div className="bg-background px-3 py-2">
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p className={cn("num text-lg font-semibold", tone === "negative" && "text-negative")}>{value}</p>
    </div>
  );
}

function CoverageTableRow({ row: r, name, logo, sector, price, members, editable, admin, updatedBy, onSave, onRemove }: {
  row: CoverageRow; name?: string; logo?: string; sector?: string; price: number | null;
  members: { user_id: string; display_name: string | null; email: string | null }[];
  editable: boolean; admin: boolean; updatedBy: string | null;
  onSave: (patch: Partial<CoverageRow>) => void; onRemove: () => void;
}) {
  const [target, setTarget] = useState(r.target_price?.toString() ?? "");
  const u = upside(price, r.target_price);
  const commitTarget = () => {
    const v = target.trim() === "" ? null : Number(target);
    if (v != null && (!Number.isFinite(v) || v <= 0)) { setTarget(r.target_price?.toString() ?? ""); return; }
    if (v !== r.target_price) onSave({ target_price: v });
  };
  return (
    <TableRow className={cn(r.restricted && "bg-negative-soft/30")}>
      <TableCell>
        <Link to="/app/companies/$ticker" params={{ ticker: r.ticker }} className="flex items-center gap-2 hover:underline">
          <CompanyLogo ticker={r.ticker} src={logo} size="xs" />
          <span className="num font-semibold">{r.ticker}</span>
          <span className="max-w-40 truncate text-[12px] text-muted-foreground" title={sector}>{name}</span>
        </Link>
      </TableCell>
      <TableCell>
        {editable ? (
          <Select value={r.analyst_id ?? UNASSIGNED} onValueChange={(v) => onSave({ analyst_id: v === UNASSIGNED ? null : v })}>
            <SelectTrigger className="h-7 w-36 text-xs" aria-label={`Analyst for ${r.ticker}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED} className="text-xs">Unassigned</SelectItem>
              {members.map((m) => <SelectItem key={m.user_id} value={m.user_id} className="text-xs">{memberName(m)}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : <span className="text-[12px]">{r.analyst_id ? memberName(members.find((m) => m.user_id === r.analyst_id)) : "Unassigned"}</span>}
      </TableCell>
      <TableCell>
        {editable ? (
          <Select value={r.rating} onValueChange={(v) => onSave({ rating: v as Rating })}>
            <SelectTrigger className={cn("h-7 w-32 text-xs", RATING_TONE[r.rating] === "positive" && "text-positive", RATING_TONE[r.rating] === "negative" && "text-negative")} aria-label={`Rating for ${r.ticker}`}><SelectValue /></SelectTrigger>
            <SelectContent>{RATINGS.map((x) => <SelectItem key={x} value={x} className="text-xs">{RATING_LABEL[x]}</SelectItem>)}</SelectContent>
          </Select>
        ) : <Badge variant={RATING_TONE[r.rating] === "positive" ? "positive" : RATING_TONE[r.rating] === "negative" ? "negative" : "outline"}>{RATING_LABEL[r.rating]}</Badge>}
      </TableCell>
      <TableCell className="num text-right text-[12.5px]">{price == null ? "—" : fmtPrice(price)}</TableCell>
      <TableCell className="text-right">
        {editable ? (
          <Input
            className="num ml-auto h-7 w-20 text-right text-xs"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))}
            onBlur={commitTarget}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder="—"
            aria-label={`Target price for ${r.ticker}`}
          />
        ) : <span className="num text-[12.5px]">{r.target_price ? fmtPrice(r.target_price) : "—"}</span>}
      </TableCell>
      <TableCell className={cn("num text-right text-[12.5px]", u != null && (u >= 0 ? "text-positive" : "text-negative"))}>{u == null ? "—" : fmtPct(u * 100, 1, true)}</TableCell>
      <TableCell>
        {editable ? (
          <Select value={String(r.priority)} onValueChange={(v) => onSave({ priority: Number(v) })}>
            <SelectTrigger className="h-7 w-24 text-xs" aria-label={`Priority for ${r.ticker}`}><SelectValue /></SelectTrigger>
            <SelectContent>{[1, 2, 3].map((p) => <SelectItem key={p} value={String(p)} className="text-xs">{PRIORITY_LABEL[p]}</SelectItem>)}</SelectContent>
          </Select>
        ) : <span className="text-[12px]">{PRIORITY_LABEL[r.priority]}</span>}
      </TableCell>
      <TableCell>
        <RestrictedCell row={r} admin={admin} onSave={onSave} />
      </TableCell>
      <TableCell>
        <NoteCell row={r} editable={editable} onSave={onSave} />
      </TableCell>
      <TableCell className="num whitespace-nowrap text-right text-[11px] text-muted-foreground" title={updatedBy ? `By ${updatedBy}` : undefined}>{fmtRelative(r.updated_at)}</TableCell>
      <TableCell>
        {admin && <Button variant="ghost" size="icon-sm" aria-label={`Drop ${r.ticker} from coverage`} onClick={onRemove}><Trash2 /></Button>}
      </TableCell>
    </TableRow>
  );
}

function RestrictedCell({ row: r, admin, onSave }: { row: CoverageRow; admin: boolean; onSave: (p: Partial<CoverageRow>) => void }) {
  const [reason, setReason] = useState(r.restricted_reason ?? "");
  if (!admin) {
    return r.restricted ? <Badge variant="negative" title={r.restricted_reason ?? undefined}><Lock className="size-3" /> Restricted</Badge> : <span className="text-[12px] text-muted-foreground">—</span>;
  }
  return (
    <Popover onOpenChange={(o) => o && setReason(r.restricted_reason ?? "")}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className={cn(r.restricted ? "text-negative" : "text-muted-foreground")} aria-label={`Restricted list for ${r.ticker}`}>
          <Lock /> {r.restricted ? "Restricted" : "No"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2">
        <p className="text-sm font-medium">Restricted list</p>
        <p className="text-xs text-muted-foreground">Everyone in the firm sees a warning on this company's pages and reports.</p>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. MNPI, banking mandate" maxLength={200} />
        <div className="flex justify-end gap-2">
          {r.restricted && <Button size="sm" variant="ghost" onClick={() => onSave({ restricted: false, restricted_reason: null })}>Lift</Button>}
          <Button size="sm" variant="ink" onClick={() => onSave({ restricted: true, restricted_reason: reason.trim() || null })}>{r.restricted ? "Update" : "Restrict"}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NoteCell({ row: r, editable, onSave }: { row: CoverageRow; editable: boolean; onSave: (p: Partial<CoverageRow>) => void }) {
  const [note, setNote] = useState(r.note ?? "");
  return (
    <Popover onOpenChange={(o) => { if (o) setNote(r.note ?? ""); else if (editable && note.trim() !== (r.note ?? "")) onSave({ note: note.trim() || null }); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="max-w-44 justify-start text-muted-foreground" aria-label={`Note for ${r.ticker}`}>
          <MessageSquareText className="shrink-0" />
          <span className="truncate">{r.note || (editable ? "Add note" : "—")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        {editable ? (
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} maxLength={2000} placeholder="Coverage note — saved when you close this" />
        ) : <p className="whitespace-pre-wrap text-sm">{r.note || "No note."}</p>}
      </PopoverContent>
    </Popover>
  );
}
