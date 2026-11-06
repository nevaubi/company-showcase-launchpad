import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Lock, Users } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { memberName, useFirm, useFirmMembers } from "@/components/firm/firm-context";

/**
 * Owner: choose Private or one of their firms. Teammate: a "Shared by …" chip (read-only).
 * Row-level rules already let firm members read shared rows and only owners change them.
 */
export function ShareWithFirm({ table, id, ownerId, firmId, invalidate }: {
  table: "theses" | "documents";
  id: string;
  ownerId: string;
  firmId: string | null;
  invalidate: unknown[][];
}) {
  const { userId, firms } = useFirm();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const members = useFirmMembers(firmId);
  const mine = !!userId && userId === ownerId;

  if (!mine) {
    if (!firmId) return null;
    const owner = members.data?.find((m) => m.user_id === ownerId);
    const firm = firms.find((f) => f.id === firmId);
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border bg-secondary/60 px-2 py-1 text-[11px] text-muted-foreground" title="Only the author can edit">
        <Users className="size-3" /> Shared by {memberName(owner)}{firm ? ` · ${firm.name}` : ""} · view only
      </span>
    );
  }
  if (!firms.length && !firmId) return null;

  const change = async (v: string) => {
    const next = v === "private" ? null : v;
    if (next === firmId) return;
    setBusy(true);
    const { error } = await supabase.from(table).update({ firm_id: next }).eq("id", id);
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success(next ? `Shared with ${firms.find((f) => f.id === next)?.name ?? "your firm"}` : "Now private");
    for (const k of invalidate) qc.invalidateQueries({ queryKey: k });
  };

  return (
    <Select value={firmId ?? "private"} onValueChange={change} disabled={busy}>
      <SelectTrigger className="h-8 w-auto min-w-36 gap-1.5 text-xs" aria-label="Sharing">
        {firmId ? <Building2 className="size-3.5" /> : <Lock className="size-3.5" />}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="private" className="text-xs">Private — only you</SelectItem>
        {firms.map((f) => (
          <SelectItem key={f.id} value={f.id} className="text-xs">Shared with {f.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Mine" vs "Shared with me" split for list pages. */
export function ownership<T extends { user_id: string; firm_id: string | null }>(rows: T[], userId: string | null) {
  return {
    mine: rows.filter((r) => r.user_id === userId),
    shared: rows.filter((r) => r.user_id !== userId && r.firm_id),
  };
}
