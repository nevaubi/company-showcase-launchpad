import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Globe2, Landmark } from "lucide-react";
import { Empty, PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { RegionExposures } from "@/components/exposures/region-exposures";
import { BankBooks } from "@/components/exposures/bank-books";
import { exposureIndexQuery } from "@/lib/xbrl/queries";
import { useSessionState } from "@/lib/use-session-state";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/exposures")({
  head: () => ({
    meta: [
      { title: "Exposures — Filed Under" },
      { name: "description", content: "Revenue by country and region, and every lender's loans, deposits and credit losses, compared across companies from the tables in their 10-Ks." },
      { property: "og:title", content: "Exposures — Filed Under" },
      { property: "og:description", content: "Who earns what where, and how each lender's book is holding up — from 10-K tables, every number linked to its tag." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Exposures,
});

function Exposures() {
  const q = useQuery(exposureIndexQuery);
  const [view, setView] = useSessionState<"regions" | "banks">("fu:exposures:view", "regions");
  const nBanks = q.data ? Object.values(q.data.companies).filter((c) => c.bank).length : 0;
  const nGeo = q.data ? Object.values(q.data.companies).filter((c) => c.exposure).length : 0;

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Companies"
        title="Exposures"
        description="Revenue by country and region, and each lender's loan book, compared across companies. Read from the tables in their latest 10-Ks; click any number to open the tag it came from."
        actions={
          <Segmented
            label="Exposure view"
            value={view}
            onChange={setView}
            options={[
              { v: "regions", l: "Revenue by region" },
              { v: "banks", l: "Banks & lenders" },
            ]}
          />
        }
      />
      {q.isLoading ? (
        <Skeleton className="mt-4 h-[520px]" />
      ) : !q.data || (!nGeo && !nBanks) ? (
        <Empty title="Exposures are being read" icon={<Globe2 className="size-6 text-muted-foreground" />}>
          The latest 10-Ks are still being read. Check back in a little while.
        </Empty>
      ) : view === "regions" ? (
        nGeo ? (
          <RegionExposures index={q.data} />
        ) : (
          <Empty title="No region tables yet" icon={<Globe2 className="size-6 text-muted-foreground" />} />
        )
      ) : nBanks ? (
        <BankBooks index={q.data} />
      ) : (
        <Empty title="No lender data yet" icon={<Landmark className="size-6 text-muted-foreground" />} />
      )}
      {q.data && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {nGeo} companies report revenue by region · {nBanks} lenders · updated {fmtDate(q.data.builtAt)}
        </p>
      )}
    </div>
  );
}
