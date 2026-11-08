import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { Segmented } from "@/components/app/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { useCompany } from "@/lib/data";
import { InsiderTable } from "@/components/app/insider-table";
import {
  CongressTrades,
  Government,
  Holders,
  InfluenceFeed,
  InfluenceRead,
  Lobbying,
  SourceStatus,
} from "@/components/influence/influence";
import { ShortAndFlows } from "@/components/technicals/short-flows";
import { Form144Panel } from "@/components/insiders/form144-panel";
import { form144Query } from "@/lib/filings/review";
import { govQuery, type OwnershipFlows } from "@/lib/influence/data";
import { flowsQuery } from "@/lib/technicals/data";

const SECTIONS = [
  "overview",
  "form4",
  "form144",
  "congress",
  "holders",
  "lobbying",
  "government",
  "trading",
] as const;
const search = z.object({ section: z.enum(SECTIONS).optional() });

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/insiders")({
  validateSearch: (s) => search.parse(s),
  head: ({ params }) => ({
    meta: [
      { title: `${params.ticker.toUpperCase()} Insiders and influence — Filed Under` },
      {
        name: "description",
        content: `Insider and congressional trades, large holders, lobbying, PAC giving, federal contracts, rules and hearings for ${params.ticker.toUpperCase()}, each linked to its source document.`,
      },
      {
        property: "og:title",
        content: `${params.ticker.toUpperCase()} Insiders and influence — Filed Under`,
      },
      {
        property: "og:description",
        content:
          "Insider and congressional trades, holders, lobbying, contracts, rules and hearings with source links.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Insiders,
});

function Insiders() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const { section = "overview" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const company = useCompany(ticker);
  const gov = useQuery(govQuery(ticker));
  const flows = useQuery(flowsQuery(ticker));
  const f144 = useQuery(form144Query(ticker));
  const { open } = useSource();
  const F = flows.data as OwnershipFlows | undefined;

  const form4 = useMemo(
    () =>
      (company.data?.insiders ?? [])
        .filter((t) => t.code === "P" || t.code === "S")
        .map((t) => ({
          date: t.date,
          name: t.owner,
          title: t.role,
          code: t.code,
          shares: t.shares,
          value: t.price != null ? t.price * t.shares : null,
          open: () =>
            open({
              ticker,
              label: `${t.owner}: Form 4`,
              periodLabel: t.date,
              unit: "shares",
              value: t.shares,
              doc: { accn: t.accn, doc: t.doc, title: `Form 4 filed ${t.filed}` },
            }),
        })),
    [company.data, open, ticker],
  );

  const counts: Record<(typeof SECTIONS)[number], number | null> = {
    overview: null,
    form4: company.data?.insiders.length ?? null,
    form144: f144.data?.notices.length || null,
    congress: gov.data?.congress_trades.length ?? null,
    holders: (F?.holders13dg?.current.length ?? 0) + (F?.inst13f ? 1 : 0) || null,
    lobbying: gov.data?.lobbying?.filing_count ?? null,
    government:
      (gov.data?.hearings?.length ?? 0) +
        (gov.data?.regulation?.rules.length ?? 0) +
        (gov.data?.regulation?.proposed.length ?? 0) || null,
    trading: F?.short_interest.length ?? null,
  };
  const label: Record<(typeof SECTIONS)[number], string> = {
    overview: "What changed",
    form4: "Form 4",
    form144: "Proposed sales",
    congress: "Congress",
    holders: "Holders",
    lobbying: "Lobbying & PAC",
    government: "Contracts, rules, hearings",
    trading: "Short & off-exchange",
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Section"
          value={section}
          onChange={(v) =>
            navigate({ search: { section: v === "overview" ? undefined : v }, replace: true })
          }
          options={SECTIONS.map((s) => ({
            v: s,
            l: counts[s] ? `${label[s]} ${counts[s]}` : label[s],
          }))}
        />
      </div>
      {section === "overview" &&
        (gov.isLoading || flows.isLoading || !company.data ? (
          <Skeleton className="h-96" />
        ) : (
          <>
            {gov.data && (
              <InfluenceRead
                gov={gov.data}
                onSection={(v) =>
                  navigate({ search: { section: v === "overview" ? undefined : v }, replace: true })
                }
              />
            )}
            <InfluenceFeed ticker={ticker} gov={gov.data} flows={F} insiders={form4} />
          </>
        ))}
      {section === "form4" &&
        (company.data ? (
          <InsiderTable rows={company.data.insiders.map((t) => ({ ...t, ticker }))} />
        ) : (
          <Skeleton className="h-[600px]" />
        ))}
      {section === "form144" && <Form144Panel ticker={ticker} />}
      {section === "congress" &&
        (gov.data ? (
          <CongressTrades ticker={ticker} gov={gov.data} />
        ) : (
          <Empty loading={gov.isLoading} what="congressional trading records" />
        ))}
      {section === "holders" &&
        (F ? (
          <Holders flows={F} />
        ) : (
          <Empty loading={flows.isLoading} what="13F and 13D/13G holder records" />
        ))}
      {section === "lobbying" &&
        (gov.data?.lobbying ? (
          <Lobbying ticker={ticker} gov={gov.data} />
        ) : (
          <Empty loading={gov.isLoading} what="lobbying reports" />
        ))}
      {section === "government" &&
        (gov.data ? (
          <Government ticker={ticker} gov={gov.data} />
        ) : (
          <Empty loading={gov.isLoading} what="government records" />
        ))}
      {section === "trading" && <ShortAndFlows symbol={ticker} />}
      {gov.data && section !== "form4" && section !== "form144" && section !== "trading" && (
        <SourceStatus gov={gov.data} />
      )}
    </div>
  );
}

function Empty({ loading, what }: { loading: boolean; what: string }) {
  if (loading) return <Skeleton className="h-72" />;
  return (
    <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      No {what} on file for this company yet.
    </p>
  );
}
