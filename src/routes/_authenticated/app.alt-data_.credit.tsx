import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/page-header";
import { SecuritizedCredit } from "@/components/alt/abs/securitized-credit";
import { AltNav } from "@/components/alt/library/alt-nav";
import { absSearch, type AbsSearch } from "@/lib/abs/view/url-state";

export const Route = createFileRoute("/_authenticated/app/alt-data_/credit")({
  validateSearch: absSearch,
  head: () => ({
    meta: [
      { title: "Securitized credit · Alternative data · FiledUnder" },
      {
        name: "description",
        content:
          "SEC Form ABS-EE asset data of registered auto loan, auto lease and commercial mortgage deals: delinquency, charge-offs, payment status and loans, each figure traced to its filing.",
      },
      { property: "og:title", content: "Securitized credit · FiledUnder" },
      { property: "og:description", content: "Asset-level data of registered asset-backed securities, as filed with the SEC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SecuritizedCreditPage,
});

function SecuritizedCreditPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Opening or leaving a deal is a new page: it gets its own history entry and starts at the top.
  // Sort and filter only change the view: they replace the entry and never move the page.
  const onChange = (patch: Partial<AbsSearch>) => {
    const page = "deal" in patch;
    void navigate({ search: (p) => ({ ...p, ...patch }), replace: !page, resetScroll: page });
  };
  return (
    <div className="grid grid-cols-1 content-start gap-5">
      <div className="min-w-0">
        <PageHeader
          className="mb-3"
          eyebrow="Filings and data"
          title="Alternative data"
          description="Securitized credit: asset-level data that issuers of registered asset-backed securities file with the SEC on Form ABS-EE. Auto loan and auto lease pools as pool figures, commercial mortgage loans record by record. Every figure opens the filing it comes from."
        />
        <AltNav />
      </div>
      <SecuritizedCredit state={search} onChange={onChange} />
    </div>
  );
}
