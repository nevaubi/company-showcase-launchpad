import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import LoadingState from "@/components/ui/loading-state";
import {
  BasketTable,
  ChangesTable,
  CustomPhrase,
  SectorGrid,
  ThemeHeadline,
  ThemeIndexTable,
  ThemeMethod,
  ThemeTrend,
} from "@/components/themes/themes";
import { themeQuery, themesIndexQuery } from "@/lib/themes/data";
import { fmtRelative } from "@/lib/format";

const search = z.object({
  t: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .optional(),
});

export const Route = createFileRoute("/_authenticated/app/themes")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Themes — Filed Under" },
      {
        name: "description",
        content:
          "How companies' 10-K and 10-Q language on tariffs, AI, GLP-1, reshoring, data center power and other themes changes quarter by quarter, with the exact sentences and a basket ranked by disclosed exposure.",
      },
      { property: "og:title", content: "Themes — Filed Under" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Themes,
});

function Loading({ label }: { label: string }) {
  return (
    <div className="flex h-60 items-center justify-center rounded-lg border">
      <LoadingState label={label} variant="Dots" />
    </div>
  );
}

function Unavailable({ what }: { what: string }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-md border border-chart-4/30 bg-chart-4/5 px-3 py-2 text-xs">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-chart-4" />
      <p>
        <span className="font-medium">Could not load {what}.</span>{" "}
        <span className="text-muted-foreground">The filing-language index may still be building; try again shortly.</span>
      </p>
    </div>
  );
}

function Themes() {
  const { t } = Route.useSearch();
  const navigate = Route.useNavigate();
  const idx = useQuery(themesIndexQuery);
  const doc = useQuery({ ...themeQuery(t ?? ""), enabled: !!t });
  const [sector, setSector] = useState<string | null>(null);
  const pick = (id: string | undefined) => {
    setSector(null);
    navigate({ search: { t: id }, replace: false });
  };

  if (!t) {
    return (
      <div className="grid gap-4">
        <PageHeader
          eyebrow="Research"
          title="Themes"
          description={`What companies are writing about in their 10-K and 10-Q filings, quarter by quarter${idx.data ? ` · updated ${fmtRelative(idx.data.generated)}` : ""}`}
        />
        {idx.isLoading ? <Loading label="Loading themes" /> : idx.isError || !idx.data ? <Unavailable what="the theme index" /> : <ThemeIndexTable idx={idx.data} onPick={(id) => pick(id)} />}
        <CustomPhrase />
      </div>
    );
  }

  const name = doc.data?.name ?? idx.data?.themes.find((x) => x.id === t)?.name ?? "Theme";
  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow={
          <button type="button" onClick={() => pick(undefined)} className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" /> Themes
          </button>
        }
        title={name}
        description={doc.data ? `${doc.data.description} · updated ${fmtRelative(doc.data.generated)}` : undefined}
        actions={
          idx.data && (
            <Segmented
              label="Theme"
              value={t}
              onChange={(v) => pick(v)}
              options={idx.data.themes.map((x) => ({ v: x.id, l: x.name.split(/[ ,]/)[0] }))}
            />
          )
        }
      />
      {doc.isLoading ? (
        <Loading label="Loading theme" />
      ) : doc.isError || !doc.data ? (
        <Unavailable what="this theme" />
      ) : (
        <>
          <ThemeHeadline doc={doc.data} />
          <ThemeTrend doc={doc.data} sector={sector} />
          <SectorGrid doc={doc.data} sector={sector} onSector={setSector} />
          <ChangesTable key={`${t}-${sector ?? ""}`} doc={doc.data} sector={sector} />
          <BasketTable doc={doc.data} sector={sector} />
          <ThemeMethod doc={doc.data} idx={idx.data} />
        </>
      )}
    </div>
  );
}
