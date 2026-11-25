import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Database } from "lucide-react";
import { collectionPath, datasetPath } from "@/components/alt/library/addresses";
import { HrefLink } from "@/components/alt/library/href-link";
import { getSourceSeries } from "@/lib/sources/read.functions";
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
  // One indexed probe: the link shows only when the published table holds a record for this certificate,
  // so a bank outside the FDIC panel's 500 institutions never opens an empty table.
  const held = useQuery({
    queryKey: ["sources", "bank-held", FDIC_NATIVE_DATASET, certificate],
    queryFn: ({ signal }) =>
      getSourceSeries({
        data: { datasetId: FDIC_NATIVE_DATASET, field: 0, address: { by: "entity_id", key: certificate! }, limit: 1 },
        signal,
      }),
    enabled: !!certificate,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (!certificate || !held.data?.ok || held.data.data.points.length === 0) return null;
  return (
    <HrefLink
      href={datasetPath(FDIC_NATIVE_DATASET, { entity: certificate })}
      className="inline-flex min-h-7 items-center gap-1 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      title={`Explore the main insured bank, FDIC certificate ${certificate}. This is the institution's scope, separate from consolidated company statements.`}
    >
      Native institution records
      <ArrowUpRight className="size-3" />
    </HrefLink>
  );
}

export function SectorSourceLink({ sector }: { sector: string }) {
  const collection = sourceCollectionForSector(sector);
  if (!collection) return null;
  return (
    <HrefLink
      href={collectionPath(collection)}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border bg-card px-2.5 text-[11px] text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
      title={`Official tables in the Data library for the ${sector} sector`}
    >
      <Database className="size-3" />
      Official tables for this sector
      <ArrowUpRight className="size-3" />
    </HrefLink>
  );
}
