import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuotes } from "@/lib/data";
import { fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ThesisRow = { id: string; ticker: string; title: string; stance: string; entry_price: number | null; target_price: number | null; status: string; updated_at: string; user_id?: string; firm_id?: string | null };

export function ThesisList({ theses, loading, userId }: { theses: ThesisRow[]; loading?: boolean; userId?: string | null }) {
  const quotes = useQuotes([...new Set(theses.map((t) => t.ticker))]);
  const qmap = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q]));
  if (loading)
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  if (!theses.length) return <p className="px-4 py-10 text-center text-sm text-muted-foreground">No theses yet. Write one down and we'll track it.</p>;
  return (
    <ul className="divide-y">
      {theses.map((t) => {
        const q = qmap.get(t.ticker);
        const entry = Number(t.entry_price);
        const target = Number(t.target_price);
        const dir = t.stance === "short" ? -1 : 1;
        const pnl = q && entry ? ((q.price - entry) / entry) * dir : null;
        const progress = q && entry && target && target !== entry ? Math.max(0, Math.min(1, (q.price - entry) / (target - entry))) : null;
        return (
          <li key={t.id}>
            <Link to="/app/theses/$id" params={{ id: t.id }} className="block px-4 py-3 hover:bg-secondary/60">
              <div className="flex items-center gap-2">
                <span className="num text-xs font-semibold">{t.ticker}</span>
                <Badge variant={t.stance === "long" ? "positive" : t.stance === "short" ? "negative" : "outline"} className="capitalize">
                  {t.stance}
                </Badge>
                {t.status === "closed" && <Badge variant="outline">Closed</Badge>}
                {userId && t.user_id && (t.user_id !== userId ? <Badge variant="outline">Firm</Badge> : t.firm_id ? <Badge variant="outline">Shared</Badge> : null)}
                <span className={cn("num ml-auto text-xs", pnl == null ? "text-muted-foreground" : pnl >= 0 ? "text-positive" : "text-negative")}>{fmtPct(pnl, 1, true)}</span>
              </div>
              <p className="mt-1 truncate text-[13px] font-medium">{t.title}</p>
              {progress != null && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="num text-[10px] text-muted-foreground">{fmtPrice(entry)}</span>
                  <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <span className={cn("absolute inset-y-0 left-0 rounded-full", pnl != null && pnl >= 0 ? "bg-positive" : "bg-negative")} style={{ width: `${progress * 100}%` }} />
                  </div>
                  <span className="num text-[10px] text-muted-foreground">{fmtPrice(target)}</span>
                </div>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
