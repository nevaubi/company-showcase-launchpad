import { useEffect, useRef, useState } from "react";
import { FileText, MousePointerClick } from "lucide-react";
import { cn } from "@/lib/utils";

// Apple Inc. Form 10-K for fiscal 2025 (accession 0000320193-25-000079),
// Consolidated Statements of Operations. Values in $ millions except EPS.
const ROWS = [
  { key: "rev", label: "Net sales", concept: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", v: ["416,161", "391,035", "383,285"] },
  { key: "cogs", label: "Cost of sales", concept: "us-gaap:CostOfGoodsAndServicesSold", v: ["220,960", "210,352", "214,137"] },
  { key: "gp", label: "Gross margin", concept: "us-gaap:GrossProfit", v: ["195,201", "180,683", "169,148"] },
  { key: "oi", label: "Operating income", concept: "us-gaap:OperatingIncomeLoss", v: ["133,050", "123,216", "114,301"] },
  { key: "ni", label: "Net income", concept: "us-gaap:NetIncomeLoss", v: ["112,010", "93,736", "96,995"] },
  { key: "eps", label: "Diluted EPS", concept: "us-gaap:EarningsPerShareDiluted", v: ["7.46", "6.08", "6.13"] },
] as const;

const YEARS = ["FY2025", "FY2024", "FY2023"];
const FILING_COLS = ["September 27, 2025", "September 28, 2024", "September 30, 2023"];
const FILING_LABEL: Record<string, string> = {
  rev: "Total net sales",
  cogs: "Total cost of sales",
  gp: "Gross margin",
  oi: "Operating income",
  ni: "Net income",
  eps: "Diluted",
};

const CYCLE: [number, number][] = [
  [0, 0],
  [4, 0],
  [3, 1],
  [5, 0],
  [2, 2],
];

export function AttributionDemo() {
  const [sel, setSel] = useState<[number, number]>([0, 0]);
  const [touched, setTouched] = useState(false);
  const [tick, setTick] = useState(0);
  const i = useRef(0);

  useEffect(() => {
    if (touched) return;
    const id = setInterval(() => {
      i.current = (i.current + 1) % CYCLE.length;
      setSel(CYCLE[i.current]);
      setTick((t) => t + 1);
    }, 3200);
    return () => clearInterval(id);
  }, [touched]);

  const [r, c] = sel;
  const row = ROWS[r];

  return (
    <div className="relative">
      <div className="absolute -inset-4 -z-10 rounded-[1.25rem] bg-ink/[0.03]" />
      <div className="overflow-hidden rounded-xl border bg-card shadow-lift">
        <div className="flex items-center gap-2 border-b bg-secondary/60 px-4 py-2.5">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-rule" />
            <span className="size-2.5 rounded-full bg-rule" />
            <span className="size-2.5 rounded-full bg-rule" />
          </span>
          <span className="num ml-2 text-[11px] text-muted-foreground">AAPL · Income statement · Annual</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <MousePointerClick className="size-3" /> click a number
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.05fr]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">$ millions</th>
                {YEARS.map((y) => (
                  <th key={y} className="num px-2 py-2 text-right font-medium">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((rw, ri) => (
                <tr key={rw.key} className={cn("border-b last:border-0", ri === r && "bg-highlight-soft/50")}>
                  <td className={cn("px-4 py-2", (rw.key === "gp" || rw.key === "ni") && "font-semibold")}>{rw.label}</td>
                  {rw.v.map((val, ci) => (
                    <td key={ci} className="px-1 py-1 text-right">
                      <button
                        onClick={() => {
                          setTouched(true);
                          setSel([ri, ci]);
                          setTick((t) => t + 1);
                        }}
                        className={cn(
                          "num w-full rounded px-1.5 py-1 text-right transition-colors hover:bg-highlight-soft",
                          ri === r && ci === c && "bg-highlight font-medium text-highlight-foreground",
                        )}
                      >
                        {val}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t bg-paper md:border-l md:border-t-0">
            <div className="flex items-center gap-2 border-b px-4 py-2 text-[11px]">
              <FileText className="size-3.5" />
              <span className="font-medium">Form 10-K</span>
              <span className="text-muted-foreground">filed Oct 31, 2025 · p. 28</span>
            </div>
            <div key={tick} className="px-4 py-3 font-serif text-[11.5px] leading-relaxed text-foreground/85">
              <p className="text-center text-[10px] font-semibold uppercase tracking-wide">Apple Inc.</p>
              <p className="text-center text-[10px] font-semibold uppercase tracking-wide">Consolidated statements of operations</p>
              <p className="mb-2 text-center text-[9.5px] italic text-muted-foreground">
                (In millions, except number of shares and per-share amounts)
              </p>
              <div className="grid grid-cols-[1.6fr_repeat(3,1fr)] gap-x-2 border-b pb-1 text-[9.5px] text-muted-foreground">
                <span />
                {FILING_COLS.map((d) => (
                  <span key={d} className="text-right">
                    {d}
                  </span>
                ))}
              </div>
              {ROWS.map((rw, ri) => (
                <div
                  key={rw.key}
                  className={cn(
                    "grid grid-cols-[1.6fr_repeat(3,1fr)] gap-x-2 py-[3px]",
                    ri === r && "rounded-sm bg-highlight-soft",
                    rw.key === "eps" && "mt-1 border-t pt-1",
                  )}
                >
                  <span className={cn(rw.key === "gp" || rw.key === "ni" ? "font-semibold" : "pl-2")}>
                    {rw.key === "eps" ? "Earnings per share — diluted" : FILING_LABEL[rw.key]}
                  </span>
                  {rw.v.map((val, ci) => (
                    <span key={ci} className="num text-right text-[11px]">
                      <span className={cn(ri === r && ci === c && "hl-sweep rounded-sm px-0.5 outline outline-1 outline-foreground/70")}>
                        {rw.key !== "eps" && ci === 0 && ri === 0 ? "$ " : ""}
                        {val}
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <div className="border-t px-4 py-2.5">
              <p className="num truncate text-[10.5px] text-muted-foreground">
                {row.concept} · {YEARS[c]} · accn 0000320193-25-000079
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
