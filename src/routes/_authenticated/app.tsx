import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { AppShell } from "@/components/app/app-shell";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { fetchAccess } from "@/lib/access";
import { isAdminPath } from "@/lib/nav";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Workspace — Filed Under" },
      { name: "description", content: "Your Filed Under research workspace." },
      { property: "og:title", content: "Workspace — Filed Under" },
      { property: "og:description", content: "Your Filed Under research workspace." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async ({ context, location }) => {
    const access = await fetchAccess(context.user.id);
    if (access.approved && !access.admin && isAdminPath(location.pathname)) throw redirect({ to: "/app" });
    return { access };
  },
  component: AppLayout,
});

function AppLayout() {
  const { access } = Route.useRouteContext();
  if (!access.approved) return <Waitlisted declined={access.status === "declined"} />;
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
      <h1 className="mt-4 font-display text-4xl">{declined ? "Access not available yet" : "You're on the list"}</h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        {declined
          ? "We aren't able to open Filed Under to your account right now. We'll be in touch if that changes."
          : "Thanks for signing up. Filed Under is opening to new analysts in waves — we'll email you as soon as your account is approved."}
      </p>
      <div className="mt-8 flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>Check again</Button>
        <Button variant="ghost" onClick={signOut}>Sign out</Button>
      </div>
    </div>
  );
}
