import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useState } from "react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/components/app/segmented";
import { fmtDate } from "@/lib/format";
import { decideWaitlist, listAdminWaitlist, resendWaitlistEmail, type AdminEntry, type EmailState } from "@/lib/waitlist.functions";

export const Route = createFileRoute("/_authenticated/app/admin")({
  head: () => ({
    meta: [
      { title: "Admin · Waitlist · FiledUnder" },
      { name: "description", content: "Approve or decline people waiting for FiledUnder access." },
      { property: "og:title", content: "Admin · Waitlist · FiledUnder" },
      { property: "og:description", content: "Approve or decline people waiting for FiledUnder access." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Status = "pending" | "approved" | "declined";
const key = (r: AdminEntry) => `${r.kind}:${r.id}`;
const STATUS_LABEL: Record<string, string> = { queued: "Queued", waiting_sender: "Waiting for sender", sent: "Sent", suppressed: "Suppressed", failed: "Failed" };
const TONE: Record<string, string> = { sent: "text-positive", failed: "text-negative", suppressed: "text-negative" };
const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

function AdminPage() {
  const [tab, setTab] = useState<Status>("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const listFn = useServerFn(listAdminWaitlist);
  const decideFn = useServerFn(decideWaitlist);
  const resendFn = useServerFn(resendWaitlistEmail);
  const list = useQuery({ queryKey: ["admin", "waitlist"], queryFn: () => listFn() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "waitlist"] });

  const decide = useMutation({
    mutationFn: (v: { items: AdminEntry[]; status: Status }) =>
      decideFn({ data: { items: v.items.map((r) => ({ kind: r.kind, id: r.id })), status: v.status } }),
    onSuccess: (r, v) => {
      setSelected(new Set());
      refresh();
      if (v.status === "approved") {
        const sent = r.emails.sent ?? 0;
        toast.success(`${v.items.length} approved. ${sent} approval email${sent === 1 ? "" : "s"} sent.`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update"),
  });
  const resend = useMutation({
    mutationFn: (logId: string) => resendFn({ data: { logId } }),
    onSuccess: (r) => {
      refresh();
      toast.success(`Resend ${STATUS_LABEL[r.status]?.toLowerCase() ?? r.status}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't resend"),
  });

  const all = list.data ?? [];
  const rows = all.filter((r) => r.status === tab);
  const count = (s: Status) => all.filter((r) => r.status === s).length;
  const chosen = rows.filter((r) => selected.has(key(r)));
  const toggle = (k: string) => setSelected((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allOn = rows.length > 0 && chosen.length === rows.length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Waitlist" description="People who joined from the waitlist page or created an account wait here until you approve them. Approving sends the approval email." />
      <Panel
        title="People"
        actions={
          <Segmented
            label="Status"
            value={tab}
            onChange={(v) => { setTab(v); setSelected(new Set()); }}
            options={[
              { v: "pending", l: `Waiting (${count("pending")})` },
              { v: "approved", l: `Approved (${count("approved")})` },
              { v: "declined", l: `Declined (${count("declined")})` },
            ]}
          />
        }
        bodyClassName="p-0"
      >
        {rows.length > 0 && tab !== "approved" && (
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
            <Checkbox checked={allOn} onCheckedChange={(v) => setSelected(v === true ? new Set(rows.map(key)) : new Set())} aria-label="Select all" />
            <span className="text-[13px] text-muted-foreground">{chosen.length ? `${chosen.length} selected` : "Select people to approve together"}</span>
            <Button size="sm" className="ml-auto" disabled={!chosen.length || decide.isPending} onClick={() => decide.mutate({ items: chosen, status: "approved" })}>
              Approve selected
            </Button>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{list.isLoading ? "Loading…" : list.isError ? "Couldn't load the waitlist." : "Nobody here."}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={key(r)} className="flex flex-wrap items-start gap-3 px-4 py-3">
                {tab !== "approved" && <Checkbox className="mt-1" checked={selected.has(key(r))} onCheckedChange={() => toggle(key(r))} aria-label={`Select ${r.email ?? r.name}`} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name ?? r.email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.email} · {r.kind === "request" ? "joined the waitlist" : "signed up"} {fmtDate(r.createdAt)}
                    {r.firm ? ` · ${r.firm}` : ""}{r.role ? ` · ${r.role}` : ""}
                  </p>
                  {r.useCase && <p className="mt-1 text-[13px] text-muted-foreground">{r.useCase}</p>}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    <EmailCell label="Receipt" s={r.emails.receipt} onResend={(id) => resend.mutate(id)} busy={resend.isPending} />
                    <EmailCell label="Approval" s={r.emails.approval} onResend={(id) => resend.mutate(id)} busy={resend.isPending} />
                    <EmailCell label="Reminder" s={r.emails.reminder} onResend={(id) => resend.mutate(id)} busy={resend.isPending} />
                  </div>
                </div>
                {r.status !== "approved" && (
                  <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ items: [r], status: "approved" })}>
                    Approve
                  </Button>
                )}
                {r.status !== "declined" && (
                  <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ items: [r], status: "declined" })}>
                    Decline
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function EmailCell({ label, s, onResend, busy }: { label: string; s: EmailState; onResend: (id: string) => void; busy: boolean }) {
  return (
    <span className="text-xs text-muted-foreground">
      {label}:{" "}
      {s ? (
        <>
          <span className={TONE[s.status] ?? "text-foreground"}>{STATUS_LABEL[s.status] ?? s.status}</span> {when(s.at)}{" "}
          {s.status !== "suppressed" && (
            <button type="button" className="text-foreground underline-offset-4 hover:underline disabled:opacity-50" disabled={busy} onClick={() => onResend(s.id)}>
              Resend
            </button>
          )}
        </>
      ) : (
        "not sent"
      )}
    </span>
  );
}
