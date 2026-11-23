import { createFileRoute } from "@tanstack/react-router";
import { AltCompanyTab } from "@/components/alt/alt-company";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/alt-data")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.ticker.toUpperCase()} alternative data · FiledUnder` },
      { name: "description", content: `What public registries say about ${params.ticker.toUpperCase()}: federal contracts against revenue, regulation, FDA and recalls, trials, Medicare drug spending, plants and releases, holders, fails to deliver, attention, bank call reports, deposits and complaints, with unusual changes flagged against the company's own history and every row linked to its record.` },
      { property: "og:title", content: `${params.ticker.toUpperCase()} alternative data · FiledUnder` },
      { property: "og:description", content: "Public alt data with a source link on every row." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AltCompany,
});

function AltCompany() {
  const ticker = Route.useParams().ticker.toUpperCase();
  return <AltCompanyTab ticker={ticker} />;
}
