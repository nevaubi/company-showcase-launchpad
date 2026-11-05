import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/data";
import { InsiderTable } from "@/components/app/insider-table";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/insiders")({
  head: ({ params }) => ({ meta: [
    { title: `${params.ticker.toUpperCase()} Insider transactions — Filed Under` },
    { name: "description", content: `Reported insider purchases, sales and ownership changes with Form 4 evidence. Company: ${params.ticker.toUpperCase()}.` },
    { property: "og:title", content: `${params.ticker.toUpperCase()} Insider transactions — Filed Under` },
    { property: "og:description", content: "Reported insider purchases, sales and ownership changes with Form 4 evidence." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Insiders,
});

function Insiders() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const company = useCompany(ticker);
  if (!company.data) return <Skeleton className="h-[600px]" />;
  return <InsiderTable rows={company.data.insiders.map((t) => ({ ...t, ticker }))} />;
}
