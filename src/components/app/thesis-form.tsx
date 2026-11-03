import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COVERAGE } from "@/lib/coverage";
import { useQuotes } from "@/lib/data";
import { currentUserId } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export interface ThesisDraft {
  id?: string;
  ticker: string;
  title: string;
  stance: "long" | "short" | "neutral";
  conviction: number;
  entry_price: number | null;
  target_price: number | null;
  horizon: string;
  summary: string;
  catalysts: string[];
  risks: string[];
}

const empty = (ticker = "AAPL"): ThesisDraft => ({
  ticker,
  title: "",
  stance: "long",
  conviction: 3,
  entry_price: null,
  target_price: null,
  horizon: "12 months",
  summary: "",
  catalysts: [],
  risks: [],
});

export function ThesisForm({
  open,
  onOpenChange,
  initial,
  defaultTicker,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: ThesisDraft;
  defaultTicker?: string;
}) {
  const [d, setD] = useState<ThesisDraft>(initial ?? empty(defaultTicker));
  const [catalysts, setCatalysts] = useState("");
  const [risks, setRisks] = useState("");
  const quote = useQuotes(open ? [d.ticker] : []).data?.quotes[0];
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const base = initial ?? empty(defaultTicker);
    setD(base);
    setCatalysts(base.catalysts.join("\n"));
    setRisks(base.risks.join("\n"));
  }, [open, initial, defaultTicker]);

  const save = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId();
      const row = {
        ticker: d.ticker,
        title: d.title.trim(),
        stance: d.stance,
        conviction: d.conviction,
        entry_price: d.entry_price ?? quote?.price ?? null,
        target_price: d.target_price,
        horizon: d.horizon.trim() || null,
        summary: d.summary.trim(),
        catalysts: catalysts.split("\n").map((s) => s.trim()).filter(Boolean),
        risks: risks.split("\n").map((s) => s.trim()).filter(Boolean),
        updated_at: new Date().toISOString(),
      };
      if (d.id) {
        const { error } = await supabase.from("theses").update(row).eq("id", d.id);
        if (error) throw error;
        return d.id;
      }
      const { data, error } = await supabase.from("theses").insert({ ...row, user_id: userId }).select("id").single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["theses"] });
      qc.invalidateQueries({ queryKey: ["thesis", id] });
      toast.success(d.id ? "Thesis updated" : "Thesis saved — we'll track it against the price");
      onOpenChange(false);
      if (!d.id) navigate({ to: "/app/theses/$id", params: { id } });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const valid = d.title.trim().length >= 3 && d.summary.trim().length >= 10 && (d.target_price == null || d.target_price > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">{d.id ? "Edit thesis" : "Write down a thesis"}</DialogTitle>
          <DialogDescription>Be specific about what has to be true. We'll track it against the price and the filings.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr]">
            <div className="grid grid-cols-1 gap-1.5">
              <Label>Company</Label>
              <Select value={d.ticker} onValueChange={(v) => setD({ ...d, ticker: v, entry_price: d.id ? d.entry_price : null })} disabled={!!d.id}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COVERAGE.map((c) => (
                    <SelectItem key={c.ticker} value={c.ticker}>
                      {c.ticker} · {c.shortName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="t-title">Title</Label>
              <Input id="t-title" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Services mix keeps lifting margins" maxLength={140} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid grid-cols-1 gap-1.5">
              <Label>Stance</Label>
              <div className="flex rounded-md border bg-secondary/50 p-0.5">
                {(["long", "short", "neutral"] as const).map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => setD({ ...d, stance: s })}
                    className={cn("flex-1 rounded px-2 py-1.5 text-sm capitalize", d.stance === s ? "bg-card font-medium shadow-paper" : "text-muted-foreground")}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <Label>Conviction</Label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => setD({ ...d, conviction: n })}
                    aria-label={`Conviction ${n}`}
                    className={cn("num h-9 flex-1 rounded-md border text-sm", n <= d.conviction ? "border-foreground bg-ink text-ink-foreground" : "bg-card text-muted-foreground")}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="t-entry">Entry price</Label>
              <Input
                id="t-entry"
                type="number"
                step="0.01"
                min="0"
                value={d.entry_price ?? ""}
                placeholder={quote ? `${quote.price.toFixed(2)} (current)` : ""}
                onChange={(e) => setD({ ...d, entry_price: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="t-target">Target price</Label>
              <Input id="t-target" type="number" step="0.01" min="0" value={d.target_price ?? ""} onChange={(e) => setD({ ...d, target_price: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="t-h">Horizon</Label>
              <Input id="t-h" value={d.horizon} onChange={(e) => setD({ ...d, horizon: e.target.value })} placeholder="12 months" maxLength={40} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <Label htmlFor="t-sum">Thesis</Label>
            <Textarea id="t-sum" rows={5} value={d.summary} onChange={(e) => setD({ ...d, summary: e.target.value })} placeholder="What the market is missing, and the numbers that will prove it." maxLength={4000} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="t-cat">Catalysts (one per line)</Label>
              <Textarea id="t-cat" rows={4} value={catalysts} onChange={(e) => setCatalysts(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="t-risk">Risks (one per line)</Label>
              <Textarea id="t-risk" rows={4} value={risks} onChange={(e) => setRisks(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="ink" disabled={!valid || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {d.id ? "Save changes" : "Save thesis"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
