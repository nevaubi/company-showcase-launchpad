import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/app/segmented";
import { useState } from "react";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/admin")({
  head: () => ({
    meta: [
      { title: "Admin · Waitlist — Filed Under" },
      { name: "description", content: "Approve or decline people waiting for Filed Under access." },
      { property: "og:title", content: "Admin · Waitlist — Filed Under" },
      { property: "og:description", content: "Approve or decline people waiting for Filed Under access." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Status = "pending" | "approved" | "declined";

function AdminPage() {
  const [tab, setTab] = useState<Status>("pending");
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "waitlist"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waitlist")
        .select("user_id,email,display_name,status,created_at,decided_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const { error } = await supabase.rpc("decide_waitlist", { _user: id, _status: status });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "waitlist"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update"),
  });
  const rows = (list.data ?? []).filter((r) => r.status === tab);
  const count = (s: Status) => (list.data ?? []).filter((r) => r.status === s).length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Waitlist" description="New sign-ups wait here until you approve them. Approved people get in the next time they load the app." />
      <Panel
        title="People"
        actions={
          <Segmented
            label="Status"
            value={tab}
            onChange={setTab}
            options={[
              { v: "pending", l: `Waiting (${count("pending")})` },
              { v: "approved", l: `Approved (${count("approved")})` },
              { v: "declined", l: `Declined (${count("declined")})` },
            ]}
          />
        }
        bodyClassName="p-0"
      >
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{list.isLoading ? "Loading…" : "Nobody here."}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.display_name ?? r.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.email} · signed up {fmtDate(r.created_at)}</p>
                </div>
                {r.status !== "approved" && (
                  <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.user_id, status: "approved" })}>
                    Approve
                  </Button>
                )}
                {r.status !== "declined" && (
                  <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.user_id, status: "declined" })}>
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
