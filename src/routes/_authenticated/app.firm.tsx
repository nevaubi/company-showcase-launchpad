import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronDown, Mail, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { friendlyError, useFirm } from "@/components/firm/firm-context";
import { ROLE_HELP, ROLE_LABEL, type FirmRole } from "@/lib/firm/core";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/firm")({
  head: () => ({
    meta: [
      { title: "Firm workspace — Filed Under" },
      { name: "description", content: "Shared coverage, roles, notes and branding for your research team." },
      { property: "og:title", content: "Firm workspace — Filed Under" },
      { property: "og:description", content: "Shared coverage, roles, notes and branding for your research team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FirmLayout,
});

const TABS = [
  { to: "/app/firm", label: "Team", exact: true },
  { to: "/app/firm/coverage", label: "Coverage" },
  { to: "/app/firm/branding", label: "Branding" },
] as const;

function FirmLayout() {
  const { firm, firms, loading, setActive } = useFirm();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [creating, setCreating] = useState(false);

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (!firm) return <FirmOnboarding />;

  return (
    <div>
      <PageHeader
        eyebrow="Firm workspace"
        title={
          <span className="inline-flex items-center gap-2">
            {firm.name}
            <Badge variant="mono" title={ROLE_HELP[firm.role]}>{ROLE_LABEL[firm.role]}</Badge>
          </span>
        }
        description="Shared coverage, team notes, roles and the branding used on every report your team exports."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><Building2 /> Switch firm <ChevronDown className="size-3" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {firms.map((f) => (
                <DropdownMenuItem key={f.id} onClick={() => setActive(f.id)}>
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-[11px] text-muted-foreground">{ROLE_LABEL[f.role]}</span>
                  {f.id === firm.id && <Check className="size-3.5" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreating(true)}><Plus className="size-3.5" /> New firm</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <nav aria-label="Firm sections" className="mb-4 flex flex-wrap gap-1 border-b pb-1">
        {TABS.map((t) => {
          const active = "exact" in t ? pathname.replace(/\/$/, "") === t.to : pathname.startsWith(t.to);
          return (
            <Button key={t.to} variant={active ? "secondary" : "ghost"} size="sm" asChild>
              <Link to={t.to} aria-current={active ? "page" : undefined}>{t.label}</Link>
            </Button>
          );
        })}
      </nav>
      <Outlet />
      <CreateFirmDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function FirmOnboarding() {
  const invites = useMyInvites();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Firm workspace"
        title="Research together"
        description="Create a firm to share a coverage list with ratings and target prices, assign analysts, keep a restricted list, write team notes and brand every exported report."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Create a firm" subtitle="You become its owner and can invite colleagues.">
          <CreateFirmForm />
        </Panel>
        <Panel title="Invitations" subtitle="Invites sent to your sign-in email.">
          {invites.isLoading ? <Skeleton className="h-16" /> : !invites.data?.length ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Mail className="size-4" /> No pending invites. Ask your firm admin to invite your email.</p>
          ) : (
            <ul className="divide-y">{invites.data.map((i) => <InviteRow key={i.token} invite={i} />)}</ul>
          )}
        </Panel>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-px border-y bg-border sm:grid-cols-4">
        {(["owner", "admin", "analyst", "viewer"] as FirmRole[]).map((r) => (
          <div key={r} className="bg-background p-3">
            <p className="text-[13px] font-semibold"><Users className="mr-1 inline size-3.5" />{ROLE_LABEL[r]}</p>
            <p className="mt-1 text-xs text-muted-foreground">{ROLE_HELP[r]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function useMyInvites() {
  return useQuery({
    queryKey: ["my-firm-invites"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_firm_invites");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function InviteRow({ invite }: { invite: { token: string; firm_name: string; role: FirmRole; expires_at: string } }) {
  const qc = useQueryClient();
  const { setActive } = useFirm();
  const accept = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("accept_firm_invite", { _token: invite.token });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      setActive(id);
      qc.invalidateQueries({ queryKey: ["firms"] });
      qc.invalidateQueries({ queryKey: ["my-firm-invites"] });
      toast.success(`You joined ${invite.firm_name}`);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{invite.firm_name}</p>
        <p className="text-[11px] text-muted-foreground">As {ROLE_LABEL[invite.role]} · expires {fmtDate(invite.expires_at)}</p>
      </div>
      <Button size="sm" variant="ink" onClick={() => accept.mutate()} disabled={accept.isPending}>Accept</Button>
    </li>
  );
}

function useCreateFirm(onDone?: () => void) {
  const qc = useQueryClient();
  const { setActive } = useFirm();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.rpc("create_firm", { _name: name });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (id) => {
      setActive(id);
      await qc.invalidateQueries({ queryKey: ["firms"] });
      toast.success("Firm created — invite your team next");
      onDone?.();
      navigate({ to: "/app/firm" });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
}

function CreateFirmForm({ onDone }: { onDone?: () => void }) {
  const [name, setName] = useState("");
  const create = useCreateFirm(onDone);
  const valid = name.trim().length >= 2 && name.trim().length <= 80;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(name.trim()); }}>
      <label className="text-xs font-medium" htmlFor="firm-name">Firm name</label>
      <Input id="firm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northwind Capital" maxLength={80} />
      <Button type="submit" variant="ink" className={cn("w-full")} disabled={!valid || create.isPending}>
        {create.isPending ? "Creating…" : "Create firm"}
      </Button>
    </form>
  );
}

function CreateFirmDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New firm</DialogTitle>
          <DialogDescription>A separate workspace with its own members, coverage and branding.</DialogDescription>
        </DialogHeader>
        <CreateFirmForm onDone={() => onOpenChange(false)} />
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
