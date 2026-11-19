import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2 } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { AppShell } from "@/components/app/app-shell";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { fetchAccess } from "@/lib/access";
import { isAdminPath } from "@/lib/nav";
import { useApplyTheme } from "@/lib/theme";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Workspace · FiledUnder" },
      { name: "description", content: "Your Filed Under research workspace." },
      { property: "og:title", content: "Workspace · FiledUnder" },
      { property: "og:description", content: "Your Filed Under research workspace." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async ({ context, location }) => {
    const access = await fetchAccess(context.user.id);
    if (access.approved && !access.admin && isAdminPath(location.pathname))
      throw redirect({ to: "/app" });
    return { access };
  },
  component: AppLayout,
});

function AppLayout() {
  const { access } = Route.useRouteContext();
  useApplyTheme();
  if (!access.approved) return <Waitlisted declined={access.status === "declined"} />;
  if (access.needsTerms) return <AcceptTerms />;
  return (
    <AppShell isAdmin={access.admin}>
      <Outlet />
    </AppShell>
  );
}

function Waitlisted({ declined }: { declined: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <div className="paper-grain flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Logo />
      <Clock className="mt-10 size-8 text-muted-foreground" />
      <h1 className="mt-4 font-display text-4xl">
        {declined ? "Access not available yet" : "You're on the list"}
      </h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        {declined
          ? "We aren't able to open FiledUnder to your account right now. We'll be in touch if that changes."
          : "Thanks for signing up. FiledUnder is opening to new analysts in waves. We'll email you as soon as your account is approved."}
      </p>
      <div className="mt-8 flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Check again
        </Button>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

/** Approved people accept the terms before their 14-day trial starts. */
function AcceptTerms() {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("accept_trial_terms");
    if (error) {
      setError("Couldn't start your trial. Please try again.");
      setBusy(false);
      return;
    }
    window.location.reload();
  };
  return (
    <div className="paper-grain flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Logo />
      <h1 className="mt-10 font-display text-xl">Welcome to FiledUnder</h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Your access is approved. Your 14-day trial starts when you accept the terms below; nothing is charged and no card is needed.
      </p>
      <label className="mt-6 flex max-w-md items-start gap-3 text-left text-sm">
        <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5" aria-label="Accept the terms" />
        <span>I accept the FiledUnder terms of service and privacy policy, and understand FiledUnder is research software, not investment advice.</span>
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-negative">{error}</p>}
      <Button className="mt-6" disabled={!agree || busy} onClick={accept}>
        {busy && <Loader2 className="animate-spin" />}
        Accept and start my trial
      </Button>
    </div>
  );
}
