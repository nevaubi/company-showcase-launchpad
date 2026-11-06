import { useState, type ReactNode } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CompanyLogo } from "@/components/app/company-logo";
import { useUniverse } from "@/lib/data";

/** Searchable company list in a popover; `exclude` hides tickers already chosen. */
export function CompanyPicker({ onPick, exclude, children, align = "start" }: {
  onPick: (ticker: string) => void;
  exclude?: Set<string>;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const universe = useUniverse();
  const list = (universe.data?.companies ?? []).filter((c) => !exclude?.has(c.ticker));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Ticker or company…" />
          <CommandList className="max-h-72">
            <CommandEmpty>{universe.isLoading ? "Loading companies…" : "No matching company."}</CommandEmpty>
            <CommandGroup>
              {list.map((c) => (
                <CommandItem key={c.ticker} value={`${c.ticker} ${c.name}`} onSelect={() => { setOpen(false); onPick(c.ticker); }}>
                  <CompanyLogo ticker={c.ticker} src={c.logo} size="xs" />
                  <span className="num w-14 font-medium">{c.ticker}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
