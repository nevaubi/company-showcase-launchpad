import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BENCHMARKS, COVERAGE } from "@/lib/coverage";

export interface SymbolEntry {
  symbol: string;
  name: string;
  /** Sector for a company; "Index", "Sector fund" or "Macro" for a benchmark */
  kind: string;
  company: boolean;
}

const GROUP_NAME: Record<string, string> = { index: "Index", sector: "Sector fund", macro: "Macro" };

/** Benchmarks are named "S&P 500 (SPY)". Where the symbol is shown beside the name, it is dropped from the name. */
export const nameWithoutSymbol = (name: string, symbol: string) => (name.endsWith(`(${symbol})`) ? name.slice(0, -(symbol.length + 2)).trim() : name);

/** Every symbol the Technicals page can open: covered companies, then indices, sector funds and macro series. */
export const SYMBOLS: SymbolEntry[] = [
  ...COVERAGE.map((c) => ({ symbol: c.ticker, name: c.shortName, kind: c.sector, company: true })),
  ...BENCHMARKS.map((b) => ({ symbol: b.symbol, name: nameWithoutSymbol(b.name, b.symbol), kind: GROUP_NAME[b.group] ?? "Benchmark", company: false })),
];

/**
 * The best matches for what was typed: an exact symbol first, then symbols that start with it, then names
 * whose words start with it, then names that contain it. Only `limit` rows are returned, so the list
 * never renders the whole coverage.
 */
export function searchSymbols(all: SymbolEntry[], query: string, limit = 40): SymbolEntry[] {
  const q = query.trim().toUpperCase();
  if (!q) return [...all.filter((e) => !e.company), ...all.filter((e) => e.company)].slice(0, limit);
  const scored: [number, number, SymbolEntry][] = [];
  all.forEach((e, i) => {
    const sym = e.symbol.toUpperCase().replace(/^\^/, "");
    const name = e.name.toUpperCase();
    let score = -1;
    if (sym === q.replace(/^\^/, "")) score = 0;
    else if (sym.startsWith(q.replace(/^\^/, ""))) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (name.split(/[^A-Z0-9&]+/).some((w) => w.startsWith(q))) score = 3;
    else if (q.length >= 3 && name.includes(q)) score = 4;
    if (score >= 0) scored.push([score, i, e]);
  });
  return scored
    .sort((a, b) => a[0] - b[0] || a[2].symbol.length - b[2].symbol.length || a[1] - b[1])
    .slice(0, limit)
    .map((x) => x[2]);
}

/** Searchable symbol list in a popover. Only the matches are rendered, so it opens at once with the full coverage behind it. */
export function SymbolPicker({ symbol, onPick }: { symbol: string | null; onPick: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = SYMBOLS.find((e) => e.symbol === symbol);
  const list = useMemo(() => searchSymbols(SYMBOLS, query), [query]);
  const companies = list.filter((e) => e.company);
  const others = list.filter((e) => !e.company);
  const item = (e: SymbolEntry) => (
    <CommandItem
      key={e.symbol}
      value={e.symbol}
      data-agent-click
      onSelect={() => {
        setOpen(false);
        setQuery("");
        if (e.symbol !== symbol) onPick(e.symbol);
      }}
      className="gap-2"
    >
      {e.company ? <CompanyLogo ticker={e.symbol} size="xs" decorative /> : <span className="size-4 shrink-0" aria-hidden />}
      <span className="num w-14 shrink-0 font-medium">{e.symbol}</span>
      <span className="min-w-0 flex-1 truncate">{e.name}</span>
      <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{e.kind}</span>
    </CommandItem>
  );
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-agent-click
          aria-label={symbol ? `Symbol: ${symbol}. Change symbol` : "Choose a symbol"}
          className="inline-flex h-9 w-full min-w-0 items-center gap-2 rounded-md border bg-card px-3 text-sm shadow-xs transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:w-64"
        >
          {symbol && <span className="num shrink-0 font-medium">{symbol}</span>}
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{symbol ? (current?.name ?? "") : "Choose a symbol"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,26rem)] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Ticker or name" aria-label="Search symbols" />
          <CommandList className="max-h-80">
            <CommandEmpty>No covered company, index or fund matches.</CommandEmpty>
            {others.length > 0 && <CommandGroup heading="Indices, sector funds and macro">{others.map(item)}</CommandGroup>}
            {companies.length > 0 && <CommandGroup heading="Companies">{companies.map(item)}</CommandGroup>}
          </CommandList>
          <p className="border-t px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
            {query.trim()
              ? `${list.length}${list.length === 40 ? "+" : ""} matches`
              : `Type to search ${COVERAGE.length.toLocaleString("en-US")} companies and ${BENCHMARKS.length} indices and funds`}
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
