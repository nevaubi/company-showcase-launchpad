import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Input } from "@/components/ui/input";
import { PlantHazardsPanel } from "@/components/alt/plant-hazards";
import { useHoldPage } from "@/components/alt/hold-page";
import {
  Catalogue,
  DatasetFeed,
  Leaders,
  MaterialFilings,
  UnusualNow,
  type ThemeFilter,
} from "@/components/alt/alt-hub";
import { DATASETS, THEMES } from "@/lib/alt/catalog";
import { SourceExplorer } from "@/components/alt/source-explorer";
import { altPageSearch } from "@/lib/sources/url-state";

export const Route = createFileRoute("/_authenticated/app/alt-data")({
  validateSearch: altPageSearch,
  head: () => ({
    meta: [
      { title: "Alternative data · FiledUnder" },
      {
        name: "description",
        content:
          "What is unusual now across every covered US company in public registries: 8-K items, 13D/G holders, federal contracts, the Federal Register, FDA, recalls, fails to deliver, attention and bank call reports, each judged against the company's own history and linked to its record.",
      },
      { property: "og:title", content: "Alternative data · FiledUnder" },
      { property: "og:description", content: "Public alt datasets with every row source-linked." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AltHub,
});

const THEME_OPTIONS: { v: ThemeFilter; l: string }[] = [
  { v: "all", l: "All" },
  ...THEMES.map((t) => ({
    v: t.id as ThemeFilter,
    l: t.label.split(",")[0].replace(" and regulation", "").replace(" and safety", ""),
  })),
];

function AltHub() {
  const search = Route.useSearch();
  const { d } = search;
  const sources = search.view === "sources";
  const navigate = useNavigate({ from: "/app/alt-data" });
  const [theme, setTheme] = useState<ThemeFilter>("all");
  const [find, setFind] = useState("");
  const dataset = d && DATASETS[d] ? d : null;
  // a theme or a dataset that removes content keeps the page's height under the reader until they scroll up
  const { ref, hold } = useHoldPage<HTMLDivElement>();
  return (
    <div ref={ref} className="grid grid-cols-1 content-start gap-5">
      <PageHeader
        eyebrow="Filings and data"
        title="Alternative data"
        description={
          sources
            ? "Explore official datasets at the institution, county and source-record level. Inspect every native field, reporting period and source, with collection status shown as it stands."
            : "Public registries scored against each company's own history: what is unusual now, who leads each measure, and every dataset with its coverage. Every row links to its record."
        }
      />
      <div data-section="Alt data view">
        <Segmented
          label="Alternative data view"
          value={sources ? "sources" : "signals"}
          options={[
            { v: "signals", l: "Company signals" },
            { v: "sources", l: "Source explorer" },
          ]}
          onChange={(value) => {
            hold();
            void navigate({
              search: (previous) => ({
                ...previous,
                view: value === "sources" ? "sources" : undefined,
              }),
              replace: true,
              resetScroll: false,
            });
          }}
        />
      </div>
      {sources ? (
        <SourceExplorer
          state={search}
          onChange={(patch) => {
            hold();
            void navigate({
              search: (previous) => ({ ...previous, ...patch }),
              replace: true,
              resetScroll: false,
            });
          }}
        />
      ) : (
        <>
          <div data-section="Alt data filters" className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Theme"
              value={theme}
              onChange={(v) => {
                hold();
                setTheme(v);
              }}
              options={THEME_OPTIONS}
            />
            <Input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Ticker"
              aria-label="Filter by ticker"
              className="h-8 w-28 text-[13px]"
            />
          </div>
          <div data-section="Unusual now" className="min-w-0">
            <UnusualNow theme={theme} find={find} />
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div data-section="Leaderboard" className="min-w-0">
              <Leaders theme={theme} find={find} />
            </div>
            <div data-section="Material filings" className="min-w-0">
              <MaterialFilings theme={theme} find={find} />
            </div>
          </div>
          <div data-section="Datasets" className="min-w-0">
            <Catalogue
              theme={theme}
              selected={dataset}
              onSelect={(x) => {
                hold();
                void navigate({
                  search: (previous) => ({ ...previous, d: x === dataset ? undefined : x }),
                  resetScroll: false,
                  replace: true,
                });
              }}
            />
          </div>
          {dataset && (
            <div data-section="Dataset records" className="min-w-0">
              <DatasetFeed dataset={dataset} />
            </div>
          )}
          <PlantHazardsPanel />
        </>
      )}
    </div>
  );
}
