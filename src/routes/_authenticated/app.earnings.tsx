import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/page-header";
import { EarningsSeason } from "@/components/earnings/earnings-views";

export const Route = createFileRoute("/_authenticated/app/earnings")({
  head: () => ({
    meta: [
      { title: "Earnings season — Filed Under" },
      { name: "description", content: "Upcoming reports, results against consensus and the market's reaction, by sector." },
    ],
  }),
  component: () => (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader eyebrow="Earnings" title="Earnings season" description="Who reports next, who beat or missed, and how the stock reacted relative to the market." />
      <EarningsSeason />
    </div>
  ),
});
