import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Database } from "lucide-react";
import { getSourceDataset } from "@/lib/sources/functions";
import {
  FDIC_NATIVE_DATASET,
  soleBankCertificate,
  sourceCollectionForSector,
} from "@/lib/sources/links";

export function BankSourceLink({
  rows,
}: {
  rows: { dataset: string; meta?: Record<string, unknown> | null }[];
}) {
  const certificate = soleBankCertificate(rows);
  const source = useQuery({
    queryKey: ["source_dataset", FDIC_NATIVE_DATASET, undefined],
    queryFn: () => getSourceDataset({ data: { id: FDIC_NATIVE_DATASET } }),
    enabled: !!certificate,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!certificate || source.data?.snapshot?.status !== "ready") return null;
  return (
    <Link
      to="/app/alt-data"
      search={{ view: "sources", source: FDIC_NATIVE_DATASET, entity: certificate }}
      className="inline-flex min-h-7 items-center gap-1 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      title={`Explore the main insured bank, FDIC certificate ${certificate}. This is the institution's scope, separate from consolidated company statements.`}
    >
      Native institution records
      <ArrowUpRight className="size-3" />
    </Link>
  );
}

export function SectorSourceLink({ sector }: { sector: string }) {
  const collection = sourceCollectionForSector(sector);
  if (!collection) return null;
  return (
    <Link
      to="/app/alt-data"
      search={{ view: "sources", sector: collection }}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border bg-card px-2.5 text-[11px] text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
      title={`Official source records for the ${sector} sector`}
    >
      <Database className="size-3" />
      Sector source records
      <ArrowUpRight className="size-3" />
    </Link>
  );
}
