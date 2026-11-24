// One panel for the company's verified statements outside the 10-K link sentences, read three ways: by type, by named
// counterparty, and as agreement terms. Three lenses on the same rows replace three stacked panels that repeated them.
// With nothing read for the company yet, the panel is one quiet line.
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/app/page-header";
import { Segmented, type SegOption } from "@/components/app/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate } from "@/lib/format";
import { useSessionState } from "@/lib/use-session-state";
import { SignalsByCounterparty, SignalsByType, signalsQuery } from "./supply-intel";
import { AgreementTerms } from "./supply-region";

type Lens = "type" | "counterparty" | "terms";
const LENSES: SegOption<Lens>[] = [
  { v: "type", l: "By type", title: "Every statement, newest first, filtered by type, impact and country" },
  { v: "counterparty", l: "By counterparty", title: "Parties named in contract exhibits and on calls, as a dated timeline" },
  { v: "terms", l: "Agreement terms", title: "Dates, term lengths, amounts and clauses read out of the quoted sentences" },
];
const isLens = (v: unknown): v is Lens => v === "type" || v === "counterparty" || v === "terms";

export function SupplySignals({ ticker, name }: { ticker: string; name: string }) {
  const { data, isLoading } = useQuery(signalsQuery(ticker));
  const [lens, setLens] = useSessionState<Lens>("fu:supply:signals", "type", isLens);
  const n = data?.length ?? 0;
  const newest = (data ?? []).reduce((m, s) => (s.filed && s.filed > m ? s.filed : m), "");
  return (
    <Panel
      title="Contracts and calls"
      subtitle={n ? `${n} verified statements from contract exhibits, earnings calls, filings and articles, each quoted word for word · newest ${fmtDate(newest)}` : undefined}
      collapse={false}
      className="min-w-0"
      actions={n > 0 ? <Segmented label="Read the statements" size="xs" value={lens} options={LENSES} onChange={setLens} /> : undefined}
    >
      {isLoading ? <Skeleton className="h-24 w-full" />
        : !n ? <p className="text-xs text-muted-foreground">No contract exhibit, call statement, location or policy item has been read for {name} yet.</p>
        : lens === "counterparty" ? <SignalsByCounterparty ticker={ticker} />
        : lens === "terms" ? <AgreementTerms ticker={ticker} />
        : <SignalsByType ticker={ticker} />}
    </Panel>
  );
}
