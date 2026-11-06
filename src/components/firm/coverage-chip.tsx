import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BriefcaseBusiness, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { memberName, useCoverage, useFirm, useFirmMembers, useSaveCoverage } from "@/components/firm/firm-context";
import { RATING_LABEL, RATING_TONE, RATINGS, upside, type Rating } from "@/lib/firm/core";
import { fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Firm coverage status for a company header: rating, target, analyst; quick edit for analysts. */
export function CoverageChip({ ticker, price }: { ticker: string; price: number | null }) {
  const { firm, can, userId } = useFirm();
  const coverage = useCoverage(firm?.id);
  const members = useFirmMembers(firm?.id);
  const save = useSaveCoverage(firm?.id);
  const row = coverage.data?.find((r) => r.ticker === ticker);
  const [target, setTarget] = useState("");
  if (!firm || coverage.isLoading) return null;
  if (!row) {
    if (!can("analyst")) return null;
    return (
      <Button size="xs" variant="outline" onClick={() => save.mutate({ ticker, create: true, patch: { analyst_id: userId } })} disabled={save.isPending} title={`Add to ${firm.name} coverage`}>
        <Plus /> Cover
      </Button>
    );
  }
  const analyst = row.analyst_id ? memberName(members.data?.find((m) => m.user_id === row.analyst_id)) : "Unassigned";
  const u = upside(price, row.target_price);
  const tone = RATING_TONE[row.rating];
  return (
    <Popover onOpenChange={(o) => o && setTarget(row.target_price?.toString() ?? "")}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="outline" className={cn(tone === "positive" && "text-positive", tone === "negative" && "text-negative", row.restricted && "border-negative")} title={`${firm.name} coverage`}>
          {row.restricted ? <Lock /> : <BriefcaseBusiness />}
          {RATING_LABEL[row.rating]}
          {row.target_price ? <span className="num text-muted-foreground">PT {fmtPrice(row.target_price)}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div>
          <p className="text-sm font-medium">{firm.name} coverage</p>
          <p className="text-xs text-muted-foreground">Analyst: {analyst}{u != null && <> · <span className={u >= 0 ? "text-positive" : "text-negative"}>{fmtPct(u, 1, true)} to target</span></>}</p>
        </div>
        {can("analyst") ? (
          <div className="grid grid-cols-2 gap-2">
            <Select value={row.rating} onValueChange={(v) => save.mutate({ ticker, patch: { rating: v as Rating } })}>
              <SelectTrigger className="h-8 text-xs" aria-label="Rating"><SelectValue /></SelectTrigger>
              <SelectContent>{RATINGS.map((r) => <SelectItem key={r} value={r} className="text-xs">{RATING_LABEL[r]}</SelectItem>)}</SelectContent>
            </Select>
            <Input
              className="num h-8 text-xs" inputMode="decimal" placeholder="Target $" aria-label="Target price"
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))}
              onBlur={() => {
                const v = target.trim() === "" ? null : Number(target);
                if ((v == null || (Number.isFinite(v) && v > 0)) && v !== row.target_price) save.mutate({ ticker, patch: { target_price: v } });
              }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
          </div>
        ) : null}
        {row.note && <p className="whitespace-pre-wrap border-l-2 pl-2 text-xs text-muted-foreground">{row.note}</p>}
        <Button size="xs" variant="ghost" asChild className="w-full"><Link to="/app/firm/coverage">Open firm coverage</Link></Button>
      </PopoverContent>
    </Popover>
  );
}

/** Warning strip shown on every page of a restricted company. */
export function RestrictedBanner({ ticker }: { ticker: string }) {
  const { firm } = useFirm();
  const coverage = useCoverage(firm?.id);
  const row = coverage.data?.find((r) => r.ticker === ticker);
  if (!firm || !row?.restricted) return null;
  return (
    <div role="alert" className="mb-3 flex items-center gap-2 border-l-2 border-negative bg-negative-soft/50 px-3 py-2 text-[13px]">
      <Lock className="size-4 shrink-0 text-negative" />
      <p><span className="font-semibold text-negative">Restricted list.</span> {firm.name} has restricted {ticker}{row.restricted_reason ? ` — ${row.restricted_reason}` : ""}. Check with compliance before trading or publishing research.</p>
    </div>
  );
}
