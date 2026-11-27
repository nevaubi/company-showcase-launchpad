import { useState } from "react";
import { ArrowUpRight, Info } from "lucide-react";
import { IrPanel } from "@/components/ir/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCompanyContext } from "@/lib/company/context-query";
import { useCompanyDetails } from "@/lib/company/details-query";
import { aboutFields, aboutSubtitle } from "@/lib/company/details";
import { ceoSourceNote, commonsThumb, rankPeople, type Credit } from "@/lib/company/context";
import { fiscalYearEndLabel, fmtCompact, fmtDate, titleCase } from "@/lib/format";
import { sicDescription } from "@/lib/sec/sic";
import type { CompanyDataset } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

/** Photos shown in the strip under the description. */
const PHOTOS = 4;

export function CreditNote({ credit, className }: { credit: Credit; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button aria-label="Photo credit" className={cn("grid size-5 place-items-center rounded-full bg-background/80 text-muted-foreground backdrop-blur hover:text-foreground", className)}>
          <Info className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 text-[13px]"
        side="top"
        // focus moves into the note without scrolling: opening it must not move the page
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
      >
        <p className="font-medium">{credit.kind === "wikimedia" ? "Free-licensed photo" : "Company photo"}</p>
        <p className="mt-1 text-muted-foreground">
          {credit.kind === "wikimedia"
            ? `${credit.author ? `By ${credit.author}. ` : ""}${credit.license ?? "Free licence"}, via Wikimedia Commons.`
            : "From the company's own leadership page."}
        </p>
        <a href={credit.page} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] underline">
          View original <ArrowUpRight className="size-3" />
        </a>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The description in full, key facts and a strip of photos. Nothing is cut behind a button. A profile of the
 * generated coverage list that lacks its website, IR address, founding year or description takes them from the
 * coverage details (`getCompanyDetails`); when there is still nothing for the left column, the facts take the width.
 */
export function AboutPanel({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const ctx = useCompanyContext(ticker);
  const p = data.profile;
  const details = useCompanyDetails(ticker, p);
  const f = aboutFields(p, details.data ?? { directory: { website: null, ir: null } });
  const c = ctx.data;
  const paras = c?.description?.paragraphs ?? [];
  const proxyCeo = c?.people?.length ? rankPeople(c.people).ceo : undefined;
  const ceo: React.ReactNode = p.ceo ? (
    <CeoFact name={p.ceo} note={ceoSourceNote(p.ceo, data.insiders ?? [], proxyCeo?.name, fmtDate)} other={proxyCeo} />
  ) : proxyCeo ? (
    // no Form 4 names a chief executive: the proxy's, with its filing
    <>
      {proxyCeo.name}
      <span className="block text-[11px] leading-4 text-muted-foreground">
        Per the {proxyCeo.source.form} filed {fmtDate(proxyCeo.source.filed)}
      </span>
    </>
  ) : null;
  const facts = (
    [
      ["Sector", p.sector],
      ["Industry", p.industry],
      ["Founded", f.founded],
      ["Founders", c?.facts.founders?.length ? c.facts.founders.join(", ") : null],
      ["Headquarters", p.address?.city ? `${titleCase(p.address.city)}, ${p.address.state}` : null],
      ["Employees", c?.facts.employees ? `${fmtCompact(c.facts.employees.value, 0)}${c.facts.employees.asOf ? ` (${c.facts.employees.asOf.slice(0, 4)})` : ""}` : null],
      ["Chief executive", ceo],
      ["Fiscal year ends", p.fiscalYearEnd ? fiscalYearEndLabel(p.fiscalYearEnd) : null],
      ["Incorporated", p.stateOfIncorporation],
      ["Exchange", `${p.exchange}: ${ticker}`],
      ["SIC", p.sic ? `${p.sic} · ${titleCase(sicDescription(p.sic, p.sicDescription))}` : null],
      ["CIK", <span className="num text-[13px]">{p.cik}</span>],
    ] as [string, React.ReactNode][]
  ).filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== 0);
  // the left column waits for both reads (no column that appears later); with nothing in it the facts take the width
  const pending = ctx.isLoading || (details.isLoading && details.fetchStatus !== "idle");
  const fromProfile = f.description?.origin === "profile";
  const left = pending || !!f.description || paras.length > 0 || !!f.website || !!f.ir;

  return (
    <IrPanel section="About" title="About" subtitle={aboutSubtitle({ wikipedia: !!c?.description, description: f.description })} bodyClassName="p-4">
      <div className={cn("grid grid-cols-1 gap-5", left && "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]")}>
        {left && (
          <div className="min-w-0">
            {pending ? (
              <Skeleton className="h-40" />
            ) : (
              <>
                {f.description && fromProfile && <p className="mb-2 text-sm font-semibold leading-5 tracking-tight">{f.description.text}</p>}
                <div className="space-y-2 text-[13px] leading-5 text-foreground/90">
                  {f.description && !fromProfile && !paras.length && <p>{f.description.text}</p>}
                  {paras.map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {c?.description && (
                    <a href={c.description.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                      Wikipedia <ArrowUpRight className="size-3" />
                    </a>
                  )}
                  {/* a button with no address is not drawn */}
                  {f.website && (
                    <Button size="xs" variant="outline" asChild>
                      <a href={f.website} target="_blank" rel="noreferrer">Website <ArrowUpRight /></a>
                    </Button>
                  )}
                  {f.ir && (
                    <Button size="xs" variant="outline" asChild>
                      <a href={f.ir} target="_blank" rel="noreferrer">Investor relations <ArrowUpRight /></a>
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <dl
          className={cn(
            "grid h-fit grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-secondary/30 px-4 py-3 text-[13px] leading-5",
            !left && "sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-x-6 lg:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]",
          )}
        >
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {!!c?.images.length && <Photos images={c.images} />}
    </IrPanel>
  );
}

/** The profile's chief executive; when the proxy names someone else, where this name comes from and when. */
function CeoFact({ name, note, other }: { name: string; note: string | null; other?: { name: string; source: { form: string; filed: string } } }) {
  if (!note || !other) return <>{name}</>;
  return (
    <>
      {name}
      <span className="block text-[11px] leading-4 text-muted-foreground">
        Per {note}. Management and board names {other.name} from the {other.source.form} filed {fmtDate(other.source.filed)}.
      </span>
    </>
  );
}

function Photos({ images }: { images: NonNullable<ReturnType<typeof useCompanyContext>["data"]>["images"] }) {
  // a photo the image host will not serve is dropped (no frame, no caption) and the next one takes its place
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const shown = images.filter((m) => !failed.has(m.url)).slice(0, PHOTOS);
  if (!shown.length) return null;
  return (
    <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {shown.map((m) => (
        <PhotoTile key={m.url} m={m} onFail={() => setFailed((f) => new Set(f).add(m.url))} />
      ))}
    </ul>
  );
}

/**
 * One photo. Its slot keeps the strip's row height but stays blank until the picture has arrived, so a photo that
 * is slow or never comes is not shown as an empty grey frame with a caption. An error that fired before the page
 * was interactive (server-rendered markup) is caught on mount from the image's own state.
 */
function PhotoTile({ m, onFail }: { m: NonNullable<ReturnType<typeof useCompanyContext>["data"]>["images"][number]; onFail: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const check = (img: HTMLImageElement | null) => {
    if (!img || !img.complete) return;
    if (img.naturalWidth > 0) setLoaded(true);
    else onFail();
  };
  return (
    <li className={cn("min-w-0", !loaded && "invisible")} aria-hidden={!loaded || undefined}>
      <figure className="relative overflow-hidden rounded-md border bg-secondary">
        <img
          ref={check}
          src={commonsThumb(m.url, 500)}
          alt=""
          referrerPolicy="no-referrer"
          onLoad={(e) => (e.currentTarget.naturalWidth > 0 ? setLoaded(true) : onFail())}
          onError={onFail}
          className="aspect-[16/10] w-full object-cover"
        />
        <CreditNote credit={m.credit} className="absolute right-1 top-1" />
      </figure>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground" title={m.caption}>
        {m.caption}
      </p>
    </li>
  );
}
