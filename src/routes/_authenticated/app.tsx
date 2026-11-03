import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { title: "Workspace — Filed Under" },
      { name: "description", content: "Your Filed Under research workspace." },
      { property: "og:title", content: "Workspace — Filed Under" },
      { property: "og:description", content: "Your Filed Under research workspace." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AppLayout,
});

function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
