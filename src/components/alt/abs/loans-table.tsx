// The loans of a commercial mortgage file, as the file states them: one row per loan, the property rows
// of a multi-property loan under it, untied property rows listed apart, never guessed onto a loan.
import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { PAYMENT_STATUS, PAYMENT_STATUS_SHORT, PROPERTY_STATUS, PROPERTY_TYPE, WORKOUT_STRATEGY } from "@/lib/abs/view/codes";
import { sortLoans, watchLoans, type LoanRow, type LoanSortKey, type LoanTable, type PropertyRow } from "@/lib/abs/view/deal";
import { asFiled, count, day, usdM } from "@/lib/abs/view/format";
import { Note, SortHead } from "./ui";

const place = (p: PropertyRow | null) => (p ? [p.city, p.state].filter(Boolean).join(", ") || "–" : "–");
const typeOf = (code: string | null) => (code ? (PROPERTY_TYPE[code] ?? `Code ${code}`) : "–");

function StatusCell({ code }: { code: string | null }) {
  if (code == null) return <span className="text-muted-foreground">not stated</span>;
  const bad = ["1", "2", "3", "5"].includes(code);
  return (
    <span className={cn(bad && "text-negative")} title={PAYMENT_STATUS[code] ? `Code ${code}: ${PAYMENT_STATUS[code]}` : `Code ${code}, not in the list`}>
      {PAYMENT_STATUS_SHORT[code] ?? `Code ${code}`}
    </span>
  );
}

function LoanRows({ l }: { l: LoanRow }) {
  const p = l.own;
  return (
    <Fragment>
      <tr className="border-b border-border/60 transition-colors duration-150 hover:bg-secondary/40">
        <th scope="row" className="num h-7 truncate px-2 text-left align-middle font-normal">{l.number}</th>
        <td className="truncate px-2" title={p?.name ?? undefined}>
          {p?.name ?? (l.properties.length ? `${count(l.properties.length)} properties` : "–")}
        </td>
        <td className="truncate px-2 text-[12px] text-muted-foreground">{p ? typeOf(p.typeCode) : l.properties.length ? "Several" : "–"}</td>
        <td className="truncate px-2 text-[12px] text-muted-foreground" title={place(p)}>{place(p)}</td>
        <td className="num px-2 text-right">{usdM(l.originalAmount)}</td>
        <td className="num px-2 text-right">{usdM(l.endBalance)}</td>
        <td className="num px-2 text-right">{asFiled(l.rate)}</td>
        <td className="num px-2 text-right" title={p?.dscrSecuritization != null ? `At securitization ${asFiled(p.dscrSecuritization, 2)}` : undefined}>
          {asFiled(p?.dscrRecent, 2)}
        </td>
        <td className="num px-2 text-right" title={p?.occupancySecuritization != null ? `At securitization ${asFiled(p.occupancySecuritization)}` : undefined}>
          {asFiled(p?.occupancyRecent)}
        </td>
        <td className="num whitespace-nowrap px-2 text-right">{day(l.maturity)}</td>
        <td className="truncate px-2 text-[12px]" title={l.workoutCode ? `Workout strategy ${l.workoutCode}: ${WORKOUT_STRATEGY[l.workoutCode] ?? "not in the list"}` : undefined}>
          <StatusCell code={l.statusCode} />
          {l.foreclosure ? (
            <span className="text-negative"> · foreclosure or REO</span>
          ) : (
            l.workoutCode && <span className="text-muted-foreground"> · {WORKOUT_STRATEGY[l.workoutCode] ?? `workout ${l.workoutCode}`}</span>
          )}
        </td>
      </tr>
      {l.properties.map((q) => (
        <tr key={q.key} className="border-b border-border/40 text-[12px] text-muted-foreground">
          <th scope="row" className="num h-7 truncate px-2 pl-4 text-left font-normal">{q.number}</th>
          <td className="truncate px-2 pl-4" title={q.name ?? undefined}>
            {q.name ?? "–"}
            {q.statusCode && ["1", "2"].includes(q.statusCode) && <span className="text-negative"> · {PROPERTY_STATUS[q.statusCode]}</span>}
          </td>
          <td className="truncate px-2">{typeOf(q.typeCode)}</td>
          <td className="truncate px-2" title={place(q)}>{place(q)}</td>
          <td className="px-2" />
          <td className="px-2" />
          <td className="px-2" />
          <td className="num px-2 text-right">{asFiled(q.dscrRecent, 2)}</td>
          <td className="num px-2 text-right">{asFiled(q.occupancyRecent)}</td>
          <td className="px-2" />
          <td className="px-2" />
        </tr>
      ))}
    </Fragment>
  );
}

/** One loan of the watch list in words: its number, payment status and what put it on the list. */
function watchText(l: LoanRow): string {
  const status = l.statusCode ? (PAYMENT_STATUS_SHORT[l.statusCode] ?? `code ${l.statusCode}`).toLowerCase() : "no status stated";
  const why: string[] = [];
  if (l.foreclosure) why.push("foreclosure or REO");
  else if (l.workoutCode) why.push(`workout: ${(WORKOUT_STRATEGY[l.workoutCode] ?? l.workoutCode).toLowerCase()}`);
  if (l.specialServicerDate && (l.returnedDate == null || l.returnedDate < l.specialServicerDate)) why.push(`with the special servicer since ${day(l.specialServicerDate)}`);
  return `loan ${l.number}, ${status}${why.length ? `, ${why.join(", ")}` : ""}`;
}

export function LoansTable({ table }: { table: LoanTable }) {
  const [sort, setSort] = useState<{ key: LoanSortKey; dir: "asc" | "desc" }>({ key: "balance", dir: "desc" });
  const loans = sortLoans(table.loans, sort.key, sort.dir);
  const watch = watchLoans(table);
  const click = (key: LoanSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "file" || key === "maturity" ? "asc" : "desc" }));
  const head = (key: LoanSortKey, label: string, align: "left" | "right" = "right") => (
    <SortHead active={sort.key === key} dir={sort.dir} onClick={() => click(key)} align={align}>
      {label}
    </SortHead>
  );
  return (
    <div className="grid gap-3">
      {watch.length > 0 && (
        <Note>
          Loans to look at first: {watch.length} with a payment status other than current, a workout strategy, or a transfer to the
          special servicer without a later return. Worst status first: {watch.slice(0, 5).map(watchText).join("; ")}
          {watch.length > 5 ? "; and more in the table" : ""}.
        </Note>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-[72px]" />
            <col />
            <col className="w-[112px]" />
            <col className="w-[150px]" />
            <col className="w-[76px]" />
            <col className="w-[84px]" />
            <col className="w-[64px]" />
            <col className="w-[60px]" />
            <col className="w-[76px]" />
            <col className="w-[100px]" />
            <col className="w-[180px]" />
          </colgroup>
          <thead>
            <tr className="border-b text-[11px]">
              {head("file", "Loan", "left")}
              <th scope="col" className="h-8 px-2 text-left align-bottom text-[11px] font-normal text-muted-foreground">Property, name as filed</th>
              <th scope="col" className="px-2 text-left align-bottom text-[11px] font-normal text-muted-foreground">Type</th>
              <th scope="col" className="px-2 text-left align-bottom text-[11px] font-normal text-muted-foreground">City, state</th>
              {head("original", "Original $M")}
              {head("balance", "Sched. end $M")}
              {head("rate", "Rate")}
              {head("dscr", "DSCR")}
              {head("occupancy", "Occupancy")}
              {head("maturity", "Maturity")}
              {head("status", "Payment status", "left")}
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => (
              <LoanRows key={l.key} l={l} />
            ))}
          </tbody>
        </table>
      </div>
      <Note>
        Rate, DSCR and occupancy are printed as each file writes them: some files write 0.0435 and others 4.35, and nothing is
        converted. DSCR is the most recent coverage on net cash flow; the figure at securitization shows on hover. A loan's property
        rows are listed under it; {count(table.untied.length)} property {table.untied.length === 1 ? "row matches" : "rows match"} no loan number and{" "}
        {table.untied.length === 1 ? "is" : "are"} not placed under any loan.
      </Note>
    </div>
  );
}
