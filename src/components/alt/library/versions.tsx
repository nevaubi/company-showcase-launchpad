import { ArrowUpRight } from "lucide-react";
import { withoutLongDashes } from "@/lib/sources/catalog";
import { safeSourceHref, sourceCoverageExceptions } from "@/lib/sources/presentation";
import type { SourceDataset, SourceFileManifest, SourceSnapshot } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { bytesText, count, rowChange, utcStamp } from "./dataset-model";
import { checkWords, noteLines, rest, scopeWords, sourceWords, type Said, type Stored } from "./provenance-words";
import type { SnapshotVersion } from "./record-read";
import { FactList, LibrarySection, LINK, PANEL, QuietLine, ShortHash } from "./ui/primitives";

/**
 * Every published version of the table, which one the page shows, and what the shown version declares about its
 * file, its checks and its scope. All open; no raw key names except under "Declared as stored".
 */
export function VersionsSection({
  dataset,
  snapshot,
  file,
  versions,
  versionsError,
  onView,
  retry,
}: {
  dataset: SourceDataset;
  snapshot: SourceSnapshot;
  file: SourceFileManifest | null;
  versions: SnapshotVersion[] | undefined;
  versionsError: boolean;
  onView: (snapshotId: string | undefined) => void;
  retry: () => void;
}) {
  const official = safeSourceHref(dataset.source_url);
  const source = sourceWords(file?.provenance, official);
  const checks = checkWords(snapshot.quality);
  const scope = scopeWords(snapshot.coverage);
  const exceptions = sourceCoverageExceptions(snapshot.coverage);
  for (const e of exceptions) {
    scope.used.add(e.key);
    scope.used.add(e.policyKey);
  }
  const stored: { group: string; items: Stored[] }[] = [
    { group: "File", items: rest(file?.provenance, source.used) },
    { group: "Checks", items: rest(snapshot.quality, checks.used) },
    { group: "Scope", items: rest(snapshot.coverage, scope.used) },
  ].filter((g) => g.items.length);
  const notes = noteLines(withoutLongDashes(dataset.notes ?? ""));
  const ordered = versions ? [...versions].sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? "")) : [];
  const before = new Map(ordered.map((v, i) => [v.id, i > 0 ? ordered[i - 1].rows : null]));
  const parts = file ? (Array.isArray(file.chunks) ? file.chunks.length : null) : null;

  return (
    <LibrarySection id="versions" name="Versions and provenance" title="Versions and provenance">
      <div className="grid gap-4">
        <div className={PANEL} data-section="Versions">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th scope="col" className="h-8 border-b px-3 font-normal">Published here</th>
                  <th scope="col" className="h-8 border-b px-3 font-normal">File retrieved</th>
                  <th scope="col" className="h-8 border-b px-3 text-right font-normal">Records</th>
                  <th scope="col" className="h-8 border-b px-3 text-right font-normal">Change</th>
                  <th scope="col" className="h-8 border-b px-3 font-normal">File SHA-256</th>
                  <th scope="col" className="h-8 border-b px-3 text-right font-normal">Size</th>
                  <th scope="col" className="h-8 border-b px-3 font-normal">
                    <span className="sr-only">Shown</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {versionsError && (
                  <tr>
                    <td colSpan={7} className="px-3 py-3 text-muted-foreground">
                      The list of versions could not be read.{" "}
                      <button type="button" className={cn(LINK, "underline")} onClick={retry}>
                        Retry
                      </button>
                    </td>
                  </tr>
                )}
                {!versions && !versionsError && (
                  <tr aria-hidden>
                    <td colSpan={7} className="h-[29px] border-b px-3">
                      <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
                    </td>
                  </tr>
                )}
                {[...ordered].reverse().map((v) => {
                  const viewing = v.id === snapshot.id;
                  const latest = v.id === dataset.latest_snapshot_id;
                  return (
                    <tr key={v.id} className={cn(viewing && "bg-secondary/50")} style={{ height: 29 }}>
                      <td className="whitespace-nowrap border-b px-3">{utcStamp(v.publishedAt)}</td>
                      <td className="whitespace-nowrap border-b px-3 text-muted-foreground">{utcStamp(v.retrievedAt)}</td>
                      <td className="num border-b px-3 text-right">{count(v.rows)}</td>
                      <td className="num border-b px-3 text-right text-muted-foreground">{rowChange(v.rows, before.get(v.id) ?? null)}</td>
                      <td className="border-b px-3">
                        <ShortHash value={v.fileSha256} label="file SHA-256" />
                      </td>
                      <td className="num whitespace-nowrap border-b px-3 text-right text-muted-foreground">
                        {bytesText(v.bytes)}
                        {v.parts && v.parts > 1 ? `, ${v.parts} parts` : ""}
                      </td>
                      <td className="whitespace-nowrap border-b px-3 text-right">
                        {viewing ? (
                          <span className="text-[11px] font-medium">Viewing{latest ? ", latest" : ""}</span>
                        ) : (
                          <button type="button" className={cn(LINK, "text-[13px] underline")} onClick={() => onView(latest ? undefined : v.id)}>
                            View this version{latest ? " (latest)" : ""}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-2">
          <Block title="This version">
            <FactList
              items={[
                { label: "Snapshot ID", value: <ShortHash value={snapshot.id} label="snapshot ID" chars={16} /> },
                { label: "File SHA-256", value: <ShortHash value={snapshot.file_sha256} label="file SHA-256" chars={16} /> },
                {
                  label: "File",
                  value: file
                    ? `${bytesText(file.bytes)}${parts && parts > 1 ? ` in ${parts} parts` : ""}, ${file.content_type}${file.verified_at ? `, verified ${utcStamp(file.verified_at)}` : ""}`
                    : "–",
                },
                { label: "Records", value: `${count(snapshot.loaded_rows)} loaded of ${count(snapshot.expected_rows)} expected` },
                { label: "Path in the collection", value: <span className="num break-all text-[13px]">{snapshot.source_path}</span> },
                { label: "Published here", value: utcStamp(snapshot.published_at) },
                { label: "File retrieved", value: `${utcStamp(snapshot.retrieved_at)}. This is when the file was collected, not when the publisher last revised the data.` },
              ]}
            />
          </Block>
          <Block title="Source">
            <SaidList items={source.said} empty="This version records no download details." />
          </Block>
          <Block title="Checks">
            <SaidList items={checks.said} empty="This version records no checks." />
          </Block>
          <Block title="Scope">
            <SaidList items={scope.said} empty="This version declares no scope rules." />
            {exceptions.map((e) => (
              <p key={e.key} className="mt-2 text-[13px] leading-5">
                <span className="text-muted-foreground">{e.label}: </span>
                {e.values.join(", ")}
                {e.policy ? <span className="block text-[11px] text-muted-foreground">{e.policy}</span> : null}
              </p>
            ))}
          </Block>
        </div>

        {notes.length > 0 && (
          <Block title="Notes kept with the table">
            <ul className="grid gap-1 text-[13px] leading-5">
              {notes.map((n, i) => (
                <li key={i} className="text-muted-foreground">
                  {n}
                </li>
              ))}
            </ul>
          </Block>
        )}

        {stored.length > 0 && (
          <Block title="Declared as stored">
            <QuietLine className="mb-2 text-[11px] leading-4">Further declarations of this version, under the names the collection gave them.</QuietLine>
            <div className="grid gap-3">
              {stored.map((g) => (
                <div key={g.group}>
                  <p className="eyebrow mb-1 text-muted-foreground">{g.group}</p>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)]">
                    {g.items.map((s) => (
                      <div key={s.key} className="contents">
                        <dt className="num truncate pt-0.5 text-[11px] text-muted-foreground" title={s.key}>
                          {s.key}
                        </dt>
                        <dd className="min-w-0 break-words text-[13px] leading-5">{s.value.length > 600 ? `${s.value.slice(0, 600)}…` : s.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </Block>
        )}
      </div>
    </LibrarySection>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={cn(PANEL, "min-w-0 px-4 py-3")}>
      <h3 className="mb-2 text-[13px] font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function SaidList({ items, empty }: { items: Said[]; empty: string }) {
  if (!items.length) return <QuietLine>{empty}</QuietLine>;
  return (
    <FactList
      items={items.map((s) => ({
        label: s.label,
        value: s.href && safeSourceHref(s.href) ? (
          <a href={safeSourceHref(s.href)!} target="_blank" rel="noreferrer" className={cn(LINK, "inline-flex max-w-full items-baseline gap-1 break-all underline")}>
            {s.text}
            <ArrowUpRight className="size-3 shrink-0" aria-hidden />
          </a>
        ) : (
          s.text
        ),
      }))}
    />
  );
}
