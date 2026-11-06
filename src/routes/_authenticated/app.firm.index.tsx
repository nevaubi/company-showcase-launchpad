import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LogOut, MailPlus, Pencil, Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { friendlyError, memberName, useFirm, useFirmMembers, type FirmMember } from "@/components/firm/firm-context";
import { activityText, assignableRoles, canRemove, isEmail, ROLE_HELP, ROLE_LABEL, type FirmRole } from "@/lib/firm/core";
import { fmtDate, fmtRelative } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/firm/")({
  head: () => ({
    meta: [
      { title: "Team — Firm workspace — Filed Under" },
      { name: "description", content: "Members, roles, invites and the activity log for your firm." },
      { property: "og:title", content: "Team — Firm workspace — Filed Under" },
      { property: "og:description", content: "Members, roles, invites and the activity log for your firm." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamPage,
});

function TeamPage() {
  const { firm } = useFirm();
  if (!firm) return null;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <MembersPanel />
        <InvitesPanel />
      </div>
      <div className="min-w-0 space-y-4">
        <ActivityPanel />
        <DangerPanel />
      </div>
    </div>
  );
}

function MembersPanel() {
  const { firm, userId, role } = useFirm();
  const members = useFirmMembers(firm?.id);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FirmMember | null>(null);
  const [removing, setRemoving] = useState<FirmMember | null>(null);
  const owners = (members.data ?? []).filter((m) => m.role === "owner").length;
  const navigate = useNavigate();

  const setRole = useMutation({
    mutationFn: async ({ user, to }: { user: string; to: FirmRole }) => {
      const { error } = await supabase.rpc("set_firm_member_role", { _firm: firm!.id, _user: user, _role: to });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["firm-members", firm?.id] });
      qc.invalidateQueries({ queryKey: ["firm-activity", firm?.id] });
      qc.invalidateQueries({ queryKey: ["firms"] });
      toast.success("Role updated");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const remove = useMutation({
    mutationFn: async (m: FirmMember) => {
      const { error } = await supabase.rpc("remove_firm_member", { _firm: firm!.id, _user: m.user_id });
      if (error) throw error;
      return m;
    },
    onSuccess: (m) => {
      setRemoving(null);
      if (m.user_id === userId) {
        localStorage.removeItem("fu:firm");
        qc.invalidateQueries({ queryKey: ["firms"] });
        toast.success(`You left ${firm?.name}`);
        navigate({ to: "/app/firm" });
        return;
      }
      qc.invalidateQueries({ queryKey: ["firm-members", firm?.id] });
      qc.invalidateQueries({ queryKey: ["firm-activity", firm?.id] });
      toast.success(`${memberName(m)} was removed`);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Panel title="Members" subtitle={members.data ? `${members.data.length} ${members.data.length === 1 ? "person" : "people"}` : undefined} collapse={false}>
      {members.isLoading ? <Skeleton className="h-32" /> : members.isError ? (
        <p className="text-sm text-negative">Members couldn't load. <Button variant="link" size="xs" onClick={() => members.refetch()}>Retry</Button></p>
      ) : (
        <div className="-mx-3.5 -my-3.5 overflow-x-auto">
          <Table className="research-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Joined</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(members.data ?? []).map((m) => {
                const self = m.user_id === userId;
                const options = assignableRoles(role, m.role);
                return (
                  <TableRow key={m.user_id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-ink-foreground">{memberName(m).slice(0, 1).toUpperCase()}</span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">{memberName(m)}{self && <span className="ml-1 text-[11px] font-normal text-muted-foreground">(you)</span>}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{m.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{m.title || "—"}</TableCell>
                    <TableCell>
                      {options.length && !(self && m.role === "owner" && owners <= 1) ? (
                        <Select value={m.role} onValueChange={(v) => setRole.mutate({ user: m.user_id, to: v as FirmRole })}>
                          <SelectTrigger className="h-7 w-28 text-xs" aria-label={`Role for ${memberName(m)}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {options.map((r) => <SelectItem key={r} value={r} className="text-xs"><span title={ROLE_HELP[r]}>{ROLE_LABEL[r]}</span></SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : <Badge variant="outline" title={ROLE_HELP[m.role]}>{ROLE_LABEL[m.role]}</Badge>}
                    </TableCell>
                    <TableCell className="num text-right text-[12px] text-muted-foreground">{fmtDate(m.joined_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        {self && <Button variant="ghost" size="icon-sm" aria-label="Edit your name and title" onClick={() => setEditing(m)}><Pencil /></Button>}
                        {canRemove(role, m.role, self, owners) && (
                          <Button variant="ghost" size="icon-sm" aria-label={self ? "Leave firm" : `Remove ${memberName(m)}`} onClick={() => setRemoving(m)}>
                            {self ? <LogOut /> : <UserMinus />}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <EditMeDialog member={editing} onClose={() => setEditing(null)} />
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removing?.user_id === userId ? `Leave ${firm?.name}?` : `Remove ${memberName(removing)}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.user_id === userId
                ? "You'll lose access to the firm's coverage, notes and reports. An admin can invite you again."
                : "They lose access immediately. Coverage assigned to them becomes unassigned; their notes stay."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && remove.mutate(removing)}>{removing?.user_id === userId ? "Leave" : "Remove"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

function EditMeDialog({ member, onClose }: { member: FirmMember | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("firm_members")
        .update({ display_name: name.trim() || null, title: title.trim() || null })
        .eq("firm_id", member!.firm_id).eq("user_id", member!.user_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["firm-members", member?.firm_id] });
      toast.success("Profile updated");
      onClose();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <Dialog open={!!member} onOpenChange={(o) => { if (!o) onClose(); else if (member) { setName(member.display_name ?? ""); setTitle(member.title ?? ""); } }}>
      <DialogContent className="max-w-sm" onOpenAutoFocus={() => { setName(member?.display_name ?? ""); setTitle(member?.title ?? ""); }}>
        <DialogHeader>
          <DialogTitle>Your firm profile</DialogTitle>
          <DialogDescription>Shown to teammates and on reports you prepare.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-medium" htmlFor="me-name">Name</label>
          <Input id="me-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Jane Doe" />
          <label className="text-xs font-medium" htmlFor="me-title">Title</label>
          <Input id="me-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Senior Analyst, Semiconductors" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="ink" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function inviteLink(token: string) {
  return `${window.location.origin}/app/join/${token}`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Invite link copied");
  } catch {
    toast.error("Couldn't copy — select the link and copy it manually");
  }
}

function InvitesPanel() {
  const { firm, can, userId } = useFirm();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<FirmRole>("analyst");
  const [last, setLast] = useState<string | null>(null);
  const invites = useQuery({
    queryKey: ["firm-invites", firm?.id],
    enabled: !!firm && can("admin"),
    queryFn: async () => {
      const { data, error } = await supabase.from("firm_invites").select("*").eq("firm_id", firm!.id).is("accepted_at", null).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("firm_invites")
        .insert({ firm_id: firm!.id, email: email.trim().toLowerCase(), role, invited_by: userId! })
        .select("token").single();
      if (error) throw error;
      return data.token as string;
    },
    onSuccess: (token) => {
      setLast(token);
      setEmail("");
      qc.invalidateQueries({ queryKey: ["firm-invites", firm?.id] });
      copy(inviteLink(token));
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("firm_invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["firm-invites", firm?.id] }),
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!can("admin")) {
    return <Panel title="Invites"><p className="text-sm text-muted-foreground">Ask a firm admin to invite colleagues.</p></Panel>;
  }
  const pending = invites.data ?? [];
  return (
    <Panel title="Invite colleagues" subtitle="They join when they sign in with the invited email. Links expire after 14 days." collapse={false}>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (isEmail(email)) create.mutate(); }}>
        <Input type="email" className="h-8 min-w-0 flex-1 basis-56" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@firm.com" aria-label="Email to invite" />
        <Select value={role} onValueChange={(v) => setRole(v as FirmRole)}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="Role"><SelectValue /></SelectTrigger>
          <SelectContent>{(["admin", "analyst", "viewer"] as FirmRole[]).map((r) => <SelectItem key={r} value={r} className="text-xs">{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="submit" size="sm" variant="ink" disabled={!isEmail(email) || create.isPending}><MailPlus /> Create invite</Button>
      </form>
      {last && (
        <div className="mt-2 flex items-center gap-2 border-l-2 border-highlight bg-highlight-soft/40 px-2 py-1.5">
          <p className="min-w-0 flex-1 truncate font-mono text-[11px]">{inviteLink(last)}</p>
          <Button size="xs" variant="outline" onClick={() => copy(inviteLink(last))}><Copy /> Copy</Button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Send the link by email or chat. Invited people also see the invite on this page after signing in.</p>
      {pending.length > 0 && (
        <ul className="mt-3 divide-y border-t">
          {pending.map((i) => (
            <li key={i.id} className="flex items-center gap-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{i.email}</p>
                <p className="text-[11px] text-muted-foreground">
                  {ROLE_LABEL[i.role as FirmRole]} · {new Date(i.expires_at) < new Date() ? <span className="text-negative">expired</span> : `expires ${fmtDate(i.expires_at)}`}
                </p>
              </div>
              <Button size="xs" variant="ghost" onClick={() => copy(inviteLink(i.token))}><Copy /> Link</Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Revoke invite for ${i.email}`} onClick={() => revoke.mutate(i.id)}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ActivityPanel() {
  const { firm } = useFirm();
  const members = useFirmMembers(firm?.id);
  const q = useQuery({
    queryKey: ["firm-activity", firm?.id],
    enabled: !!firm,
    queryFn: async () => {
      const { data, error } = await supabase.from("firm_activity").select("*").eq("firm_id", firm!.id).order("created_at", { ascending: false }).limit(60);
      if (error) throw error;
      return data;
    },
  });
  const byId = new Map((members.data ?? []).map((m) => [m.user_id, m]));
  const name = (id: string) => memberName(byId.get(id));
  return (
    <Panel title="Activity" subtitle="Audit trail of coverage, rating, restricted-list and membership changes.">
      {q.isLoading ? <Skeleton className="h-40" /> : !q.data?.length ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
        <ol className="space-y-2">
          {q.data.map((a) => (
            <li key={a.id} className="text-[12.5px] leading-snug">
              <span className="font-medium">{a.actor_id ? name(a.actor_id) : "System"}</span>{" "}
              <span className="text-muted-foreground">{activityText(a.action, (a.detail ?? {}) as Record<string, unknown>, name)}</span>
              {a.ticker && (
                <> {" · "}<Link to="/app/companies/$ticker" params={{ ticker: a.ticker }} className="num font-medium text-link hover:underline">{a.ticker}</Link></>
              )}
              <span className="num ml-1.5 text-[11px] text-muted-foreground" title={new Date(a.created_at).toLocaleString()}>{fmtRelative(a.created_at)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function DangerPanel() {
  const { firm, can } = useFirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState("");
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("firms").delete().eq("id", firm!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      localStorage.removeItem("fu:firm");
      qc.invalidateQueries({ queryKey: ["firms"] });
      toast.success("Firm deleted");
      navigate({ to: "/app/firm" });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  if (!firm || !can("owner")) return null;
  return (
    <Panel title="Delete firm" subtitle="Owners only">
      <p className="text-sm text-muted-foreground">Removes members, coverage, notes, invites and branding. Shared theses and docs go back to being private to their authors.</p>
      <Button className="mt-3" size="sm" variant="outline" onClick={() => { setConfirm(""); setOpen(true); }}><Trash2 /> Delete {firm.name}</Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {firm.name}?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone. Type the firm name to confirm.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={firm.name} aria-label="Firm name" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={confirm.trim() !== firm.name} onClick={() => del.mutate()}>Delete firm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
