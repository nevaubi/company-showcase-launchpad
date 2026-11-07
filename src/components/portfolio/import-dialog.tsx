import { useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { COVERAGE_TICKERS } from "@/lib/coverage";
import { holdingsToCsv, parseHoldings, type Holding } from "@/lib/portfolio/parse";

const EXAMPLE = "ticker,shares,cost\nAAPL,120,182.40\nMSFT,60,410\nNVDA,200\n\nor one per line: NVDA 12%";

export function ImportDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: { title: string; holdings: Holding[] } | null;
  onSave: (title: string, holdings: Holding[]) => void;
  saving?: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "My portfolio");
  const [text, setText] = useState(initial ? holdingsToCsv(initial.holdings) : "");
  const file = useRef<HTMLInputElement>(null);
  const universe = useMemo(() => new Set(COVERAGE_TICKERS), []);
  const parsed = useMemo(() => parseHoldings(text, universe), [text, universe]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit holdings" : "Import holdings"}</DialogTitle>
          <DialogDescription>
            Paste a CSV export from your broker or one holding per line. Columns are matched by name: ticker or symbol, shares or quantity, weight
            or %, cost. Weights are used when share counts are missing.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Name</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Holdings</span>
            <Button size="xs" variant="outline" type="button" onClick={() => file.current?.click()}>
              <Upload /> Upload CSV
            </Button>
            <input
              ref={file}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setText(await f.text());
                e.target.value = "";
              }}
            />
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} className="num min-h-48 text-xs" spellCheck={false} />
          <div className="grid gap-1 text-xs">
            <p>
              <span className="font-medium">{parsed.holdings.length}</span> holdings read
              {parsed.holdings.some((h) => h.shares == null && h.weight == null) && (
                <span className="text-muted-foreground"> · some have neither shares nor a weight; they are weighted equally with the rest</span>
              )}
            </p>
            {parsed.unknown.length > 0 && (
              <p className="text-chart-4">
                Not covered, left out: {parsed.unknown.slice(0, 20).join(", ")}
                {parsed.unknown.length > 20 ? ` and ${parsed.unknown.length - 20} more` : ""}
              </p>
            )}
            {parsed.errors.slice(0, 5).map((e) => (
              <p key={e} className="text-negative">
                {e}
              </p>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!parsed.holdings.length || saving || !title.trim()} onClick={() => onSave(title.trim(), parsed.holdings)}>
            {saving ? "Saving…" : "Save portfolio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
