import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pin, PinOff, Send, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError, memberName, useFirm, useFirmMembers } from "@/components/firm/firm-context";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Firm-shared notes on a company. Hidden when the user isn't in a firm. */
export function FirmNotes({ ticker }: { ticker: string }) {
  const { firm, can, userId } = useFirm();
  const members = useFirmMembers(firm?.id);
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const key = ["firm-notes", firm?.id, ticker];
  const notes = useQuery({
    queryKey: key,
    enabled: !!firm,
    queryFn: async () => {
      const { data, error } = await supabase.from("firm_notes").select("*").eq("firm_id", firm!.id).eq("ticker", ticker)
        .order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("firm_notes").insert({ firm_id: firm!.id, ticker, author_id: userId!, body: body.trim(), context: { page: window.location.pathname } });
      if (error) throw error;
    },
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["firm-activity", firm?.id] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const pin = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await supabase.from("firm_notes").update({ pinned }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(friendlyError(e)),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("firm_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(friendlyError(e)),
  });
  if (!firm) return null;
  const byId = new Map((members.data ?? []).map((m) => [m.user_id, m]));
  const list = notes.data ?? [];
  return (
    <Panel title={<span className="inline-flex items-center gap-1.5"><Users className="size-3.5" /> Team notes</span>} subtitle={`Shared with ${firm.name}`}>
      {can("analyst") && (
        <form className="mb-3 space-y-1.5" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={8000} placeholder={`Note on ${ticker} for the team — channel checks, call takeaways, model changes…`}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && body.trim()) add.mutate(); }} />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">⌘↵ to post</span>
            <Button size="xs" variant="ink" type="submit" disabled={!body.trim() || add.isPending}><Send /> Post</Button>
          </div>
        </form>
      )}
      {notes.isLoading ? <p className="text-sm text-muted-foreground">Loading notes…</p> : !list.length ? (
        <p className="text-sm text-muted-foreground">No team notes on {ticker} yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {list.map((n) => {
            const mine = n.author_id === userId;
            return (
              <li key={n.id} className={cn("group border-l-2 pl-2.5", n.pinned ? "border-highlight" : "border-border")}>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{memberName(byId.get(n.author_id))}</span>
                  <span className="num" title={new Date(n.created_at).toLocaleString()}>{fmtRelative(n.created_at)}</span>
                  {n.pinned && <span className="inline-flex items-center gap-0.5"><Pin className="size-3" /> pinned</span>}
                  <span className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {(mine || can("admin")) && (
                      <>
                        <Button variant="ghost" size="icon-sm" aria-label={n.pinned ? "Unpin" : "Pin"} onClick={() => pin.mutate({ id: n.id, pinned: !n.pinned })}>{n.pinned ? <PinOff /> : <Pin />}</Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Delete note" onClick={() => del.mutate(n.id)}><Trash2 /></Button>
                      </>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-snug">{n.body}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
