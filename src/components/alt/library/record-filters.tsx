import { useEffect, useState, type FormEvent } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SourceEntities } from "@/lib/sources/read-types";
import { cn } from "@/lib/utils";
import type { DatasetSearch, RecordFilterPatch } from "./dataset-search";

export type FilterOffer = {
  /** Entity filter: the snapshot fills an entity id or name that varies by row. */
  entity: boolean;
  /** Place filter: a place code or name that varies by row. */
  geography: boolean;
  /** Period filter: a period that varies by row. */
  period: boolean;
  /** Name search: the snapshot has names or codes to search. */
  search: boolean;
};

const CONTROL =
  "h-8 min-w-0 rounded-md border bg-card px-2.5 text-[13px] shadow-paper transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The filters a snapshot can answer, and only those (rev-app S6). Choices come from the entities of the last
 * period (a simpler form until facet counts exist); an exact identifier, name, code or period can always be typed.
 * Nothing is read per keystroke: a choice applies at once, typed text applies on Enter.
 */
export function RecordFilters({
  offer,
  search,
  entities,
  entityNoun,
  periods,
  onApply,
}: {
  offer: FilterOffer;
  search: Pick<DatasetSearch, "entity" | "geography" | "period" | "q">;
  entities: SourceEntities | null | undefined;
  entityNoun: string;
  periods: { first: string; last: string } | null | undefined;
  onApply: (patch: RecordFilterPatch) => void;
}) {
  const chips: { key: keyof RecordFilterPatch; label: string }[] = [];
  if (search.entity) chips.push({ key: "entity", label: `${entityNoun}: ${nameOf(entities, search.entity)}` });
  if (search.geography) chips.push({ key: "geography", label: `Place: ${search.geography}` });
  if (search.period) chips.push({ key: "period", label: `Period: ${search.period}` });
  if (search.q) chips.push({ key: "q", label: `Names containing "${search.q}"` });
  if (!offer.entity && !offer.geography && !offer.period && !offer.search && !chips.length) return null;
  return (
    <div className="grid grid-cols-1 gap-2" data-section="Record filters">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {offer.entity && (
          <EntityPicker
            noun={entityNoun}
            value={search.entity}
            entities={entities}
            onPick={(v) => onApply({ entity: v })}
          />
        )}
        {offer.period && (
          <PeriodPicker value={search.period} periods={periods} onPick={(v) => onApply({ period: v })} />
        )}
        {offer.geography && <ExactInput label="Place code or name" value={search.geography} onApply={(v) => onApply({ geography: v })} />}
        {offer.search && <NameSearch value={search.q} onApply={(v) => onApply({ q: v })} />}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((c) => (
            <span key={c.key} className="inline-flex min-h-7 max-w-full items-center gap-1 rounded-md border bg-secondary/60 pl-2.5 text-[13px]">
              <span className="truncate">{c.label}</span>
              <button
                type="button"
                aria-label={`Remove filter ${c.label}`}
                onClick={() => onApply({ [c.key]: undefined })}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
          {chips.length > 1 && (
            <Button
              variant="ghost"
              size="xs"
              className="text-[13px] text-muted-foreground"
              onClick={() => onApply({ entity: undefined, geography: undefined, period: undefined, q: undefined })}
            >
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function nameOf(entities: SourceEntities | null | undefined, value: string): string {
  const hit = entities?.entities.find((e) => e.id === value || e.name === value);
  if (!hit) return value;
  return hit.name && hit.id && hit.name !== hit.id ? `${hit.name} (${hit.id})` : value;
}

function EntityPicker({
  noun,
  value,
  entities,
  onPick,
}: {
  noun: string;
  value: string | undefined;
  entities: SourceEntities | null | undefined;
  onPick: (v: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const list = entities?.entities ?? [];
  const trimmed = typed.trim();
  const exact = trimmed && !list.some((e) => e.id === trimmed || e.name === trimmed);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(CONTROL, "inline-flex max-w-[18rem] items-center gap-1.5")} aria-label={`Filter by ${noun.toLowerCase()}`}>
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? nameOf(entities, value) : noun}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput placeholder={`Name or identifier`} value={typed} onValueChange={setTyped} className="h-9 text-[13px]" />
          <CommandList>
            <CommandEmpty className="px-3 py-3 text-[13px] text-muted-foreground">
              {entities === undefined ? "Loading the last period's list" : "Not in the last period's list"}
            </CommandEmpty>
            {exact && (
              <CommandGroup heading="Exact text">
                <CommandItem
                  value={`exact ${trimmed}`}
                  onSelect={() => {
                    onPick(trimmed);
                    setOpen(false);
                  }}
                  className="text-[13px]"
                >
                  Records whose identifier or name is exactly "{trimmed}"
                </CommandItem>
              </CommandGroup>
            )}
            {list.length > 0 && (
              <CommandGroup
                heading={`${entities?.complete ? "" : "First "}${list.length.toLocaleString("en-US")} in ${entities?.period ?? "the first rows"}`}
              >
                {list.map((e) => {
                  const key = e.id || e.name || "";
                  return (
                    <CommandItem
                      key={`${e.id}|${e.name}|${e.row}`}
                      value={`${e.name ?? ""} ${e.id ?? ""} ${e.row}`}
                      onSelect={() => {
                        onPick(key || undefined);
                        setOpen(false);
                      }}
                      className="text-[13px]"
                    >
                      <Check className={cn("mr-1.5 size-3.5", value && value === key ? "opacity-100" : "opacity-0")} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{e.name || e.id || "(blank)"}</span>
                      {e.name && e.id && <span className="num ml-2 shrink-0 text-[11px] text-muted-foreground">{e.id}</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PeriodPicker({
  value,
  periods,
  onPick,
}: {
  value: string | undefined;
  periods: { first: string; last: string } | null | undefined;
  onPick: (v: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const trimmed = typed.trim();
  const ends = periods ? [...new Set([periods.last, periods.first])] : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(CONTROL, "inline-flex items-center gap-1.5")} aria-label="Filter by period">
          <span className={cn("num", !value && "font-sans text-muted-foreground")}>{value ?? "Period"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[18rem] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={periods ? `As stored, e.g. ${periods.last}` : "As stored"}
            value={typed}
            onValueChange={setTyped}
            className="h-9 text-[13px]"
          />
          <CommandList>
            {trimmed && (
              <CommandGroup heading="Exact text">
                <CommandItem
                  value={`exact ${trimmed}`}
                  onSelect={() => {
                    onPick(trimmed);
                    setOpen(false);
                  }}
                  className="text-[13px]"
                >
                  Records of period "{trimmed}"
                </CommandItem>
              </CommandGroup>
            )}
            {ends.length > 0 && (
              <CommandGroup heading="Last and first period">
                {ends.map((p) => (
                  <CommandItem
                    key={p}
                    value={p}
                    onSelect={() => {
                      onPick(p);
                      setOpen(false);
                    }}
                    className="num text-[13px]"
                  >
                    <Check className={cn("mr-1.5 size-3.5", value === p ? "opacity-100" : "opacity-0")} aria-hidden />
                    {p}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ExactInput({ label, value, onApply }: { label: string; value: string | undefined; onApply: (v: string | undefined) => void }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply(text.trim() || undefined);
  };
  return (
    <form onSubmit={submit} className="min-w-0" role="search" aria-label={label}>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={512}
        placeholder={label}
        aria-label={`${label}, exact; press Enter`}
        className="h-8 w-48 max-w-full text-[13px]"
      />
    </form>
  );
}

function NameSearch({ value, onApply }: { value: string | undefined; onApply: (v: string | undefined) => void }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply(text.trim() || undefined);
  };
  return (
    <form onSubmit={submit} className="flex min-w-0 items-center gap-1" role="search" aria-label="Search names">
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="Search names"
          aria-label="Search names; press Enter"
          className="h-8 w-52 max-w-full pl-7 text-[13px]"
        />
      </div>
      <Button type="submit" variant="outline" size="sm" className="h-8 text-[13px]">
        Search
      </Button>
    </form>
  );
}
