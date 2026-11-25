import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Segmented } from "@/components/app/segmented";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SHAPE_LABEL } from "@/lib/sources/shape";
import { cn } from "@/lib/utils";
import { SHAPE_PARAMS, shapeOfParam, type CollectionSearch, type LibrarySort, type ShapeParam } from "./search";

const ALL = "all";

export type PublisherOption = { id: string; label: string; tables: number };

/**
 * The library's one row of controls: search by every word, shape, publisher and order. Every control writes the
 * address (the page passes `onChange`), so a search can be shared and the back button undoes it.
 */
export function LibrarySearchRow({
  value,
  onChange,
  publishers,
  placeholder = "Search tables, publishers, series codes",
  label = "Search tables",
  section = "Library search",
  sortDefault,
  className,
}: {
  value: CollectionSearch;
  onChange: (patch: Partial<CollectionSearch>) => void;
  publishers: PublisherOption[];
  placeholder?: string;
  label?: string;
  section?: string;
  /** The order the list opens in when none is chosen. */
  sortDefault: LibrarySort;
  className?: string;
}) {
  // Typing stays in the field; the address follows within a frame, so the list never lags the keyboard.
  const [text, setText] = useState(value.q ?? "");
  useEffect(() => setText(value.q ?? ""), [value.q]);
  const hasQuery = text.trim().length > 0;
  const sortOptions: { v: LibrarySort; l: string }[] = [
    ...(hasQuery ? [{ v: "match" as const, l: "Best match" }] : []),
    { v: "new", l: "Newest" },
    { v: "size", l: "Largest" },
    { v: "name", l: "A to Z" },
  ];
  const sort = value.sort === "match" && !hasQuery ? sortDefault : (value.sort ?? (hasQuery ? "match" : sortDefault));
  return (
    <div data-section={section} data-agent-controls className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <div className="relative w-full min-w-0 @2xl:w-80">
        <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={text}
          aria-label={label}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            onChange({ q: e.target.value || undefined, sort: value.sort === "match" ? undefined : value.sort });
          }}
          className="h-8 pl-7 pr-7 text-[13px] [&::-webkit-search-cancel-button]:hidden"
        />
        {hasQuery && (
          <button
            type="button"
            aria-label="Clear the search field"
            onClick={() => {
              setText("");
              onChange({ q: undefined, sort: value.sort === "match" ? undefined : value.sort });
            }}
            className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="max-w-full overflow-x-auto scrollbar-thin">
        <Segmented
          label="Shape"
          value={(value.shape ?? ALL) as ShapeParam | typeof ALL}
          options={[{ v: ALL, l: "All" }, ...SHAPE_PARAMS.map((p) => ({ v: p, l: SHAPE_LABEL[shapeOfParam(p)!] }))]}
          onChange={(v) => onChange({ shape: v === ALL ? undefined : (v as ShapeParam) })}
          className="flex-nowrap"
        />
      </div>
      <Select value={value.pub ?? ALL} onValueChange={(v) => onChange({ pub: v === ALL ? undefined : v })}>
        <SelectTrigger aria-label="Publisher" className="h-8 w-full min-w-0 text-[13px] @2xl:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All publishers</SelectItem>
          {publishers.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label} · {p.tables.toLocaleString("en-US")}
            </SelectItem>
          ))}
          {value.pub && !publishers.some((p) => p.id === value.pub) && <SelectItem value={value.pub}>{value.pub}</SelectItem>}
        </SelectContent>
      </Select>
      <Segmented label="Order" value={sort} options={sortOptions} onChange={(v) => onChange({ sort: v })} />
    </div>
  );
}
