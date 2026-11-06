import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, BookmarkPlus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/app/segmented";
import { AUDIENCE_LABEL, KINDS, LENGTH_LABEL, normalizeOptions, STANCE_LABEL } from "@/lib/reports/kinds";
import type { ReportKind, ReportOptions, ReportScope } from "@/lib/reports/types";
import { useDeleteTemplate, useSaveTemplate, useTemplates, optionsSummary } from "./use-reports";
import { useFirm } from "@/components/firm/firm-context";
import { cn } from "@/lib/utils";

/** Choose sections, length, audience, stance and emphasis; save to me or the firm; reuse templates. */
export function CustomizeDialog({ open, onOpenChange, kind, initial, onGenerate, pending }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: ReportKind;
  initial?: Partial<ReportOptions>;
  onGenerate: (o: ReportOptions, scope: ReportScope) => void;
  pending: boolean;
}) {
  const def = KINDS[kind];
  const { firm, can, userId } = useFirm();
  const templates = useTemplates(kind);
  const saveTpl = useSaveTemplate();
  const delTpl = useDeleteTemplate();
  const all = def.sections.map((s) => s.id);
  const [order, setOrder] = useState<string[]>(all);
  const [on, setOn] = useState<Set<string>>(new Set(all));
  const [o, setO] = useState<ReportOptions>(normalizeOptions(kind, initial));
  const [scope, setScope] = useState<ReportScope>(firm && can("analyst") ? "firm" : "user");
  const [tplName, setTplName] = useState("");

  const load = (opts: Partial<ReportOptions> | undefined) => {
    const n = normalizeOptions(kind, opts);
    setO(n);
    const chosen = n.sections.length ? n.sections : all;
    setOrder([...chosen, ...all.filter((s) => !chosen.includes(s))]);
    setOn(new Set(chosen));
  };
  useEffect(() => { if (open) { load(initial); setScope(firm && can("analyst") ? "firm" : "user"); } }, [open, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const final = (): ReportOptions => normalizeOptions(kind, { ...o, sections: order.filter((s) => on.has(s) && all.includes(s)) });
  const move = (i: number, d: -1 | 1) => setOrder((x) => { const y = [...x]; const j = i + d; if (j < 0 || j >= y.length) return x; [y[i], y[j]] = [y[j], y[i]]; return y; });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize {def.label.toLowerCase()}</DialogTitle>
          <DialogDescription>Your version is written from the same sourced data and saved {firm ? "for you or your firm" : "to your library"}; the standard version stays as it is.</DialogDescription>
        </DialogHeader>

        {!!templates.data?.length && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Templates</p>
            <div className="flex flex-wrap gap-1.5">
              {templates.data.map((t) => (
                <span key={t.id} className="inline-flex items-center rounded-md border bg-card text-xs">
                  <button type="button" className="px-2 py-1 hover:bg-secondary" onClick={() => load(t.options)} title={optionsSummary(t.options)}>
                    {t.name}<span className="ml-1 text-[10px] text-muted-foreground">{t.firm_id ? firm?.name ?? "Firm" : "Mine"}</span>
                  </button>
                  {(t.created_by === userId || (t.firm_id && can("analyst"))) && (
                    <button type="button" className="border-l px-1.5 py-1 text-muted-foreground hover:text-negative" aria-label={`Delete template ${t.name}`} onClick={() => delTpl.mutate(t.id)}><Trash2 className="size-3" /></button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Sections</p>
            <ul className="divide-y rounded-md border">
              {order.filter((id) => def.sections.some((x) => x.id === id)).map((id, i) => {
                const s = def.sections.find((x) => x.id === id)!;
                return (
                  <li key={id} className={cn("flex items-center gap-2 px-2 py-1.5", !on.has(id) && "opacity-55")}>
                    <Checkbox checked={on.has(id)} onCheckedChange={(v) => setOn((x) => { const y = new Set(x); if (v) y.add(id); else if (y.size > 1) y.delete(id); return y; })} aria-label={`Include ${s.title}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{s.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{s.brief}</span>
                    </span>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${s.title} up`}><ArrowUp /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${s.title} down`}><ArrowDown /></Button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-medium">Length</p>
              <Segmented label="Length" value={o.length} onChange={(v) => setO({ ...o, length: v })} options={(Object.keys(LENGTH_LABEL) as ReportOptions["length"][]).map((v) => ({ v, l: LENGTH_LABEL[v] }))} />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">Audience</p>
              <Segmented label="Audience" value={o.audience} onChange={(v) => setO({ ...o, audience: v })} options={(Object.keys(AUDIENCE_LABEL) as ReportOptions["audience"][]).map((v) => ({ v, l: AUDIENCE_LABEL[v] }))} />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">Stance</p>
              <Segmented label="Stance" value={o.stance} onChange={(v) => setO({ ...o, stance: v })} options={(Object.keys(STANCE_LABEL) as ReportOptions["stance"][]).map((v) => ({ v, l: STANCE_LABEL[v] }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor="report-focus">Emphasis</label>
              <Textarea id="report-focus" rows={3} maxLength={400} value={o.focus} onChange={(e) => setO({ ...o, focus: e.target.value })} placeholder="e.g. Focus on data-center demand durability and gross-margin risk" />
            </div>
            {firm && can("analyst") && (
              <div className="space-y-1">
                <p className="text-xs font-medium">Save to</p>
                <Segmented label="Save to" value={scope} onChange={(v) => setScope(v)} options={[{ v: "firm", l: firm.name }, { v: "user", l: "Just me" }]} />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Input className="h-8 min-w-0 flex-1 basis-40 text-sm" value={tplName} onChange={(e) => setTplName(e.target.value)} maxLength={60} placeholder="Template name, e.g. Weekly PM preview" aria-label="Template name" />
          <Button type="button" variant="outline" size="sm" disabled={!tplName.trim() || saveTpl.isPending || !userId}
            onClick={() => saveTpl.mutate({ name: tplName.trim(), kind, options: final(), firmId: scope === "firm" && firm ? firm.id : null, userId: userId! }, { onSuccess: () => setTplName("") })}>
            <BookmarkPlus /> Save template{scope === "firm" && firm ? ` for ${firm.name}` : ""}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="ink" disabled={pending} onClick={() => onGenerate(final(), scope)}>{pending ? "Writing…" : "Write my version"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
