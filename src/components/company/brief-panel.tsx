import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/app/page-header";
import { briefQuery, type BriefFact } from "@/lib/insights/brief";
import { fmtRelative } from "@/lib/format";

const chip =
  "num ml-0.5 rounded bg-secondary px-1 align-super text-[9.5px] text-muted-foreground hover:text-foreground";

function FactLink({ ticker, f, n }: { ticker: string; f: BriefFact; n: number }) {
  const l = f.link;
  if (l.tab === "estimates")
    return (
      <Link
        to="/app/companies/$ticker/estimates"
        params={{ ticker }}
        title={f.text}
        className={chip}
      >
        {n}
      </Link>
    );
  if (l.tab === "insiders")
    return (
      <Link
        to="/app/companies/$ticker/insiders"
        params={{ ticker }}
        search={{ section: l.section && l.section !== "overview" ? l.section : undefined }}
        title={f.text}
        className={chip}
      >
        {n}
      </Link>
    );
  if (l.tab === "technicals")
    return (
      <Link to="/app/markets" search={{ symbol: ticker }} title={f.text} className={chip}>
        {n}
      </Link>
    );
  return (
    <span title={f.text} className={chip}>
      {n}
    </span>
  );
}

/** What changed in the last 30 days across sources, in checked sentences that link to their records. */
export function BriefPanel({ ticker }: { ticker: string }) {
  const q = useQuery(briefQuery(ticker));
  const b = q.data;
  if (!b?.sentences.length) return null;
  const facts = new Map(b.facts.map((f) => [f.id, f]));
  return (
    <Panel
      title="Last 30 days"
      subtitle={`${b.label} · ${fmtRelative(b.generated)}`}
      collapse={false}
    >
      <ul className="grid gap-1.5 px-3.5 py-2.5 text-[13px]">
        {b.sentences.map((s, k) => (
          <li key={k} className="leading-relaxed">
            {s.text}{" "}
            {s.refs.map((id, j) => {
              const f = facts.get(id);
              return f ? <FactLink key={id} ticker={ticker} f={f} n={j + 1} /> : null;
            })}
          </li>
        ))}
      </ul>
      <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        Hover a number for the record a sentence rests on; click it to open the tab that shows it.
        Every number was checked against the records in code and a second model (
        {b.models.check ?? "n/a"}) rejected unsupported sentences
        {b.dropped.length ? ` (${b.dropped.length} dropped)` : ""}. Drafted by {b.models.draft} from{" "}
        {b.facts_considered} records.
      </p>
    </Panel>
  );
}
