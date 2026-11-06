import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyError, useFirm } from "@/components/firm/firm-context";
import { ROLE_HELP, ROLE_LABEL, type FirmRole } from "@/lib/firm/core";
import { useProfile } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/app/join/$token")({
  head: () => ({
    meta: [
      { title: "Join a firm — Filed Under" },
      { name: "description", content: "Accept an invitation to a Filed Under firm workspace." },
      { property: "og:title", content: "Join a firm — Filed Under" },
      { property: "og:description", content: "Accept an invitation to a Filed Under firm workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { token } = Route.useParams();
  const me = useProfile();
  const qc = useQueryClient();
  const { setActive } = useFirm();
  const navigate = useNavigate();
  const invite = useQuery({
    queryKey: ["firm-invite", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_firm_invite", { _token: token });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  const accept = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("accept_firm_invite", { _token: token });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (id) => {
      setActive(id);
      await qc.invalidateQueries({ queryKey: ["firms"] });
      toast.success(`Welcome to ${invite.data?.firm_name}`);
      navigate({ to: "/app/firm" });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const i = invite.data;
  const email = me.data?.user.email ?? "";
  const wrongEmail = i && email && i.email.toLowerCase() !== email.toLowerCase();

  return (
    <div className="mx-auto mt-10 max-w-md border bg-card p-6 shadow-paper">
      <Building2 className="size-6 text-muted-foreground" />
      {invite.isLoading ? (
        <div className="mt-4 space-y-2"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-full" /></div>
      ) : !i ? (
        <>
          <h1 className="mt-3 text-xl font-semibold">Invite not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">The link may be mistyped or the invite was revoked. Ask your firm admin for a new one.</p>
          <Button asChild variant="outline" className="mt-4"><Link to="/app/firm">Go to firm workspace</Link></Button>
        </>
      ) : (
        <>
          <p className="eyebrow mt-3">Firm invitation</p>
          <h1 className="mt-1 text-xl font-semibold">Join {i.firm_name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You're invited as <span className="font-medium text-foreground">{ROLE_LABEL[i.role as FirmRole]}</span> — {ROLE_HELP[i.role as FirmRole].toLowerCase()}.
          </p>
          {i.accepted ? (
            <p className="mt-4 text-sm text-negative">This invite has already been used.</p>
          ) : i.expired ? (
            <p className="mt-4 text-sm text-negative">This invite has expired. Ask your firm admin to send a new one.</p>
          ) : wrongEmail ? (
            <p className="mt-4 border-l-2 border-negative pl-3 text-sm">
              This invite was sent to <span className="font-medium">{i.email}</span>, but you're signed in as <span className="font-medium">{email}</span>. Sign in with the invited email to accept.
            </p>
          ) : (
            <Button variant="ink" className="mt-5 w-full" onClick={() => accept.mutate()} disabled={accept.isPending}>
              {accept.isPending ? "Joining…" : `Accept and join ${i.firm_name}`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
