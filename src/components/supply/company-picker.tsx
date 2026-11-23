// Company picker for the supply-chain page: the company's own mark, a search over every covered company (ticker or name)
// and how many filing links each has, so the reader does not page through a plain list of 1,800 names.
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface PickerCompany { ticker: string; name: string }

/** Best matches first: exact ticker, ticker prefix, name prefix, then anywhere; ties by number of links. No query lists the most linked. */
export function rankCompanies(companies: PickerCompany[], query: string, links: Record<string, number>, limit = 40): PickerCompany[] {
  const q = query.trim().toLowerCase();
  const n = (c: PickerCompany) => links[c.ticker] ?? 0;
  const scored = companies.flatMap((c) => {
    const t = c.ticker.toLowerCase(), name = c.name.toLowerCase();
    const s = !q ? 0 : t === q ? 0 : t.startsWith(q) ? 1 : name.startsWith(q) ? 2 : name.includes(` ${q}`) ? 3 : name.includes(q) ? 4 : t.includes(q) ? 5 : -1;
    return s < 0 ? [] : [{ c, s }];
  });
  return scored.sort((a, b) => a.s - b.s || n(b.c) - n(a.c) || a.c.ticker.localeCompare(b.c.ticker)).slice(0, limit).map((x) => x.c);
}

export function CompanyPicker({ ticker, name, companies, links, onPick }: {
  ticker: string;
  name: string;
  companies: PickerCompany[];
  /** filing links that name each company, as filer or counterparty */
  links: Record<string, number>;
  onPick: (ticker: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => rankCompanies(companies, query, links), [companies, query, links]);
  const linked = useMemo(() => companies.filter((c) => (links[c.ticker] ?? 0) > 0).length, [companies, links]);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} aria-label={`Company: ${name} (${ticker}). Change company`} data-tour="supply-company"
          className="inline-flex h-9 w-[260px] max-w-full items-center gap-2 rounded-md border bg-card px-2.5 text-left text-sm shadow-paper transition-colors duration-150 hover:border-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
          <CompanyLogo ticker={ticker} size="xs" decorative />
          <span className="num shrink-0 font-semibold">{ticker}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] max-w-[calc(100vw-2rem)] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search ticker or company" />
          <CommandList>
            <CommandEmpty>No covered company matches.</CommandEmpty>
            {shown.map((c) => (
              <CommandItem key={c.ticker} value={c.ticker} onSelect={() => { setOpen(false); setQuery(""); if (c.ticker !== ticker) onPick(c.ticker); }} className="gap-2">
                <CompanyLogo ticker={c.ticker} size="xs" decorative />
                <span className="num w-12 shrink-0 text-[13px] font-semibold">{c.ticker}</span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{c.name}</span>
                <span className={cn("num shrink-0 text-[11px] text-muted-foreground", !(links[c.ticker] > 0) && "opacity-60")}>{links[c.ticker] > 0 ? links[c.ticker] : "none"}</span>
                {c.ticker === ticker && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
              </CommandItem>
            ))}
          </CommandList>
          <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
            {query.trim() ? `${shown.length} shown` : "Most linked first"} · <span className="num">{linked.toLocaleString("en-US")}</span> of <span className="num">{companies.length.toLocaleString("en-US")}</span> companies have named links · the number is filing links
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
