import { createFileRoute, redirect } from "@tanstack/react-router";

// Docs & sheets was replaced by Office Studio.
export const Route = createFileRoute("/_authenticated/app/docs/")({
  beforeLoad: () => { throw redirect({ to: "/app/office" }); },
});
