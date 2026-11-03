import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/data";
import { InsiderTable } from "@/components/app/insider-table";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/insiders")({
  component: Insiders,
});

function Insiders() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const company = useCompany(ticker);
  if (!company.data) return <Skeleton className="h-[600px]" />;
  return <InsiderTable rows={company.data.insiders.map((t) => ({ ...t, ticker }))} />;
}
