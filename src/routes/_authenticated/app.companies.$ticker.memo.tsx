import { createFileRoute, redirect } from "@tanstack/react-router";

// The one-page memo became the "IC memo" report in the report library; keep old links working.
export const Route = createFileRoute("/_authenticated/app/companies/$ticker/memo")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/app/companies/$ticker/reports", params: { ticker: params.ticker }, search: { kind: "memo", v: undefined }, replace: true });
  },
});
