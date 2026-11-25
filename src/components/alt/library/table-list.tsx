import { memo, useLayoutEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { ROW_H, useRowFocus, useWindowRange } from "@/lib/screener/window";
import { cn } from "@/lib/utils";
import { datasetPath } from "./addresses";
import { HrefLink } from "./href-link";
import { indexedBy, TABLE_NARROW_BELOW, TABLE_ROW_H, TABLE_ROW_H_NARROW, utcDay, type TableItem } from "./table-rows";

const STICKY = "top-[var(--sticky-top,3.5rem)]";
const n = (v: number) => v.toLocaleString("en-US");

/** The width of an element, followed as it changes (null before the first layout). */
function useWidth(el: HTMLElement | null) {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

type RowProps = {
  item: TableItem;
  label: (item: TableItem) => string;
  narrow: boolean;
  tab: number;
  onOpen: (href: string) => void;
  onRowFocus: (key: string) => void;
  onRowBlur: (e: React.FocusEvent<HTMLElement>) => void;
  onRowKey: (e: KeyboardEvent<HTMLElement>, key: string, open: () => void) => void;
};

/** The second line under a title: the stored name when it differs, else the code; and the view marker. */
function SubLine({ item }: { item: TableItem }) {
  const { row, parent, olderThanParent } = item;
  const stored = row.storedName && row.storedName !== row.title ? row.storedName : row.code && !row.title.includes(row.code) ? row.code : null;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 text-[11px] leading-[14px] text-muted-foreground">
      {parent && (
        <span className="shrink-0 rounded-[3px] border px-1 leading-[12px]" title={`A view of ${parent.title}: its records repeat the parent's and are never added to them`}>
          view of {parent.title.length > 40 ? `${parent.title.slice(0, 39)}…` : parent.title}
        </span>
      )}
      {olderThanParent && <span className="shrink-0 text-warning" title="The parent table was collected after this view">older than its parent</span>}
      {stored && <span className="min-w-0 truncate" title={stored}>{stored}</span>}
    </span>
  );
}

const Row = memo(function Row({ item, label, narrow, tab, onOpen, onRowFocus, onRowBlur, onRowKey }: RowProps) {
  const { row } = item;
  const href = datasetPath(row.id);
  const open = () => onOpen(href);
  const common = {
    "data-row": true,
    "data-key": row.id,
    tabIndex: tab,
    onClick: open,
    onFocus: () => onRowFocus(row.id),
    onBlur: onRowBlur,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => onRowKey(e, row.id, open),
    "aria-label": `${row.title}, ${label(item)}, ${n(row.rows)} records`,
  };
  const title = (
    // A real link (new tab, the assistant can follow it) outside the tab order: the row is the tab stop.
    <HrefLink href={href} tabIndex={-1} onClick={(e) => e.stopPropagation()} className="block min-w-0 truncate rounded-sm text-[13px] font-medium leading-[18px] hover:underline">
      {row.title}
    </HrefLink>
  );
  if (narrow)
    return (
      <li {...common} className="group flex h-[61px] cursor-pointer flex-col justify-center gap-0.5 border-b px-3 transition-colors duration-150 hover:bg-secondary/40 focus-visible:bg-highlight-soft focus-visible:outline-none">
        <div className={cn("min-w-0", item.depth && "pl-3")}>{title}</div>
        <div className={cn("min-w-0", item.depth && "pl-3")}>
          <SubLine item={item} />
        </div>
        <div className={cn("num min-w-0 truncate text-[11px] leading-[14px] text-muted-foreground", item.depth && "pl-3")}>
          {label(item)} · {n(row.rows)} records · {n(row.fields)} fields · {utcDay(row.retrievedAt)}
        </div>
      </li>
    );
  const cell = "border-b px-2 group-hover:bg-secondary/40";
  return (
    <tr {...common} className="group h-[41px] cursor-pointer focus-visible:outline-none focus-visible:[&>td]:bg-highlight-soft [&>td]:transition-colors [&>td]:duration-150">
      <td className={cn(cell, "pl-3.5", item.depth && "pl-7")}>
        <div className="flex min-w-0 flex-col">
          {title}
          <SubLine item={item} />
        </div>
      </td>
      <td className={cn(cell, "truncate text-[13px]")} title={label(item)}>
        {label(item)}
      </td>
      <td className={cn(cell, "truncate text-[11px] text-muted-foreground")} title={row.grain}>
        {row.grain || "–"}
      </td>
      <td className={cn(cell, "truncate text-[11px] text-muted-foreground")}>{indexedBy(row.dimensions) || "–"}</td>
      <td className={cn(cell, "num text-right text-[13px]")}>{n(row.rows)}</td>
      <td className={cn(cell, "num text-right text-[13px]")}>{n(row.fields)}</td>
      <td className={cn(cell, "num pr-3.5 text-right text-[11px] text-muted-foreground")} title={row.retrievedAt ? `Retrieved ${row.retrievedAt}` : undefined}>
        {utcDay(row.retrievedAt)}
      </td>
    </tr>
  );
});

/**
 * The shared list of tables (library results, a collection's tables): rows windowed against the page scroll,
 * a head that sticks under the app header, the whole row a link to the table page. A view of another table is
 * listed under its parent. Below 880 px of width each table is a three line row, so the page never scrolls sideways.
 */
export function TableList({
  items,
  publisherLabel,
  loading = false,
  dim = false,
  storeKey,
  empty,
  section,
  heading,
}: {
  items: TableItem[];
  publisherLabel: (item: TableItem) => string;
  loading?: boolean;
  /** The previous result stays on screen, dimmed, while the next one is computed. */
  dim?: boolean;
  storeKey: string;
  empty?: ReactNode;
  section: string;
  heading?: ReactNode;
}) {
  const router = useRouter();
  const [wrap, setWrap] = useState<HTMLElement | null>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const width = useWidth(wrap);
  const narrow = width != null && width < TABLE_NARROW_BELOW;
  const rowH = narrow ? TABLE_ROW_H_NARROW : TABLE_ROW_H;
  const [start, end] = useWindowRange(body, items.length, rowH);
  const nav = useMemo(() => {
    const at = new Map(items.map((it, i) => [it.row.id, i]));
    // useRowFocus measures in 29 px rows: scale the index so its offsets land on these taller rows
    return { keys: items.map((it) => it.row.id), pos: (k: string) => ((at.get(k) ?? 0) * rowH) / ROW_H };
  }, [items, rowH]);
  const focus = useRowFocus(body, nav.keys, nav.pos, storeKey);
  const firstKey = items[start]?.row.id;
  const onOpen = useMemo(() => (href: string) => void router.navigate({ href }), [router]);

  const rows = items.slice(start, end).map((item) => (
    <Row
      key={item.row.id}
      item={item}
      label={publisherLabel}
      narrow={narrow}
      tab={focus.tabIndex(item.row.id, firstKey)}
      onOpen={onOpen}
      onRowFocus={focus.onFocus}
      onRowBlur={focus.onBlur}
      onRowKey={focus.onKey}
    />
  ));
  const before = start * rowH;
  const after = Math.max(0, items.length - end) * rowH;
  const skeleton = Array.from({ length: 10 });

  return (
    <section ref={setWrap} data-section={section} className="min-w-0 rounded-md border bg-card shadow-paper">
      {heading}
      <div className={cn("transition-opacity duration-150", dim && "opacity-60")} style={{ overflowAnchor: "none" }}>
        {narrow ? (
          <ul ref={setBody} aria-label="Tables">
            {loading ? (
              skeleton.map((_, i) => (
                <li key={i} aria-hidden className="flex h-[61px] flex-col justify-center gap-1.5 border-b px-3">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </li>
              ))
            ) : (
              <>
                {before > 0 && <li aria-hidden style={{ height: before }} />}
                {rows}
                {after > 0 && <li aria-hidden style={{ height: after }} />}
              </>
            )}
          </ul>
        ) : (
          <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
            <colgroup>
              <col />
              <col style={{ width: 136 }} />
              <col style={{ width: 208 }} />
              <col style={{ width: 132 }} />
              <col style={{ width: 92 }} />
              <col style={{ width: 64 }} />
              <col style={{ width: 104 }} />
            </colgroup>
            <thead>
              <tr className="text-[11px] text-muted-foreground">
                {[
                  ["Table", "pl-3.5 text-left", "The publisher's title where the catalogue has one; the stored name under it when it differs"],
                  ["Publisher", "text-left", undefined],
                  ["One record is", "text-left", "What one stored row stands for, as the source registered it"],
                  ["Indexed by", "text-left", "The dimensions the store indexes for this table"],
                  ["Records", "text-right", "Rows in the latest published snapshot"],
                  ["Fields", "text-right", "Fields in the snapshot's dictionary"],
                  ["Collected", "pr-3.5 text-right", "When the file was retrieved from the publisher, not when the publisher last revised it"],
                ].map(([label, cls, title]) => (
                  <th key={label} scope="col" title={title} className={cn("sticky z-20 h-7 border-b bg-card px-2 font-normal", STICKY, cls)}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={setBody}>
              {loading ? (
                skeleton.map((_, i) => (
                  <tr key={i} aria-hidden className="h-[41px]">
                    <td colSpan={7} className="border-b px-3.5">
                      <Skeleton className="h-4" />
                    </td>
                  </tr>
                ))
              ) : (
                <>
                  {before > 0 && (
                    <tr aria-hidden style={{ height: before }}>
                      <td colSpan={7} />
                    </tr>
                  )}
                  {rows}
                  {after > 0 && (
                    <tr aria-hidden style={{ height: after }}>
                      <td colSpan={7} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        )}
        {!loading && items.length === 0 && empty}
      </div>
      {!loading && items.length > 0 && (
        <p className="border-t px-3.5 py-2 text-[11px] leading-4 text-muted-foreground">
          Collected is when the file was retrieved from the publisher, not when the publisher last revised it. A view repeats its parent's records and is never added to them. Arrow keys move between rows; Enter opens the table.
        </p>
      )}
    </section>
  );
}
