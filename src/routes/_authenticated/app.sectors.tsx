import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { FundCorrelation, MacroContext, RelativePanels, SectorBoard } from "@/components/sectors/board";
import { RotationGraph, SectorNotes } from "@/components/sectors/sector-views";
import { QuietLine, Section } from "@/components/sectors/ui";
import { BOARD_SET_KEYS, BOARD_SORTS, boardSort, SPANS, type BoardSet } from "@/lib/sectors/board";
import { overviewQuery, tapeQuery } from "@/lib/sectors/groups";

const pageSearch = z.object({
  /** Kept for old links (it used to pick a sector detail panel); ignored. */
  sector: z.string().max(40).optional().catch(undefined),
  level: z.enum(["sector", "industry"]).optional().catch(undefined),
  /** Column set of the board: overview (default), fundamentals, or risk and signals. */
  cols: z.enum(BOARD_SET_KEYS.filter((k) => k !== "overview") as [string, ...string[]]).optional().catch(undefined),
  sort: z.enum(BOARD_SORTS as unknown as [string, ...string[]]).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  span: z.enum(SPANS.map((s) => s.v) as unknown as [string, ...string[]]).optional().catch(undefined),
  tail: z.enum(["4w", "10w"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/app/sectors")({
  validateSearch: pageSearch,
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Sectors · FiledUnder" },
      { name: "description", content: "Every sector and industry compared: returns, breadth, fundamentals rolled up from SEC filings and valuation against its own history." },
      { property: "og:title", content: "Sectors · FiledUnder" },
      { property: "og:description", content: "Sector and industry returns, breadth, fundamentals from SEC filings and valuation." },
    ],
  }),
  component: Sectors,
});

function Sectors() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const overview = useQuery(overviewQuery);
  const tape = useQuery(tapeQuery);
  const set = (patch: Partial<z.infer<typeof pageSearch>>) =>
    navigate({ search: (p) => ({ ...p, ...patch }), replace: true, resetScroll: false });
  const level = (s.level ?? "sector") as "sector" | "industry";
  const cols = (s.cols ?? "overview") as BoardSet;
  const bs = boardSort(cols, s.sort, s.dir);
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow="Markets"
        title="Sectors"
        description="Where strength and weakness sit: each sector's and industry's returns, breadth, fundamentals from its companies' filings and valuation against its own history."
        className="mb-0"
      />
      {overview.data ? (
        <SectorBoard
          ov={overview.data}
          tape={tape.data?.idx ?? null}
          tapeFile={tape.data?.file ?? null}
          tapePending={tape.isPending}
          level={level}
          set={cols}
          sort={bs.sort}
          dir={bs.dir}
          onSort={(k, d) => set({ sort: k, dir: d })}
          onLevel={(l) => set({ level: l === "sector" ? undefined : l })}
          onSet={(c) => set({ cols: c === "overview" ? undefined : c, sort: undefined, dir: undefined })}
        />
      ) : overview.isError ? (
        <Section name="Sector board" title="Sectors compared">
          <QuietLine>The sector file is not available right now; the panels below still load from prices.</QuietLine>
        </Section>
      ) : (
        <Skeleton className="h-[420px]" />
      )}
      <RelativePanels span={(s.span ?? "6M") as "3M" | "6M" | "1Y"} onSpan={(v) => set({ span: v === "6M" ? undefined : v })} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {overview.data ? <RotationGraph ov={overview.data} tail={s.tail ?? "4w"} onTail={(t) => set({ tail: t === "4w" ? undefined : t })} /> : null}
        <FundCorrelation />
      </div>
      <SectorNotes />
      <MacroContext />
    </div>
  );
}
