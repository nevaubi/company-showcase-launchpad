import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { readableDates } from "@/lib/reports/present";
import { fmtDate } from "@/lib/format";

/** SEC EDGAR address of a filing (its index) or one document inside it. */
function secUrl(cik: string | undefined, accn: string, doc?: string): string | null {
  if (!cik || !accn) return null;
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}`;
  return doc ? `${base}/${doc}` : `${base}/`;
}

const period = (start: string | undefined, end: string) =>
  start ? `${fmtDate(start)} to ${fmtDate(end)}` : `As of ${fmtDate(end)}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-1.5 text-[12.5px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function SecLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return <span className="num">{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="num inline-flex items-center gap-0.5 text-link underline decoration-dotted underline-offset-4 hover:decoration-solid"
    >
      {children}
      <ArrowUpRight className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

function Body({ t, ciks }: { t: SourceTarget; ciks: Record<string, string> }) {
  const cik = ciks[t.ticker];
  if (t.src) {
    return (
      <dl className="divide-y">
        <Row label="Company">{t.ticker}</Row>
        <Row label="XBRL concept">
          <span className="num">{t.src.concept}</span>
        </Row>
        <Row label="Period">{period(t.src.start, t.src.end)}</Row>
        <Row label="Filing">
          <SecLink href={secUrl(cik, t.src.accn, t.src.doc)}>{t.src.accn}</SecLink>
        </Row>
      </dl>
    );
  }
  if (t.derived) {
    return (
      <div className="space-y-3">
        <dl className="divide-y">
          <Row label="Company">{t.ticker}</Row>
          <Row label="Calculated as">{t.derived.formula}</Row>
        </dl>
        {t.derived.parts.length > 0 && (
          <div>
            <p className="eyebrow mb-1.5">Inputs, each from a filing</p>
            <ul className="divide-y rounded-md border">
              {t.derived.parts.map((p, i) => (
                <li key={`${p.accn}-${p.concept}-${i}`} className="px-3 py-2 text-[12.5px]">
                  <p>
                    {p.sign < 0 ? "− " : ""}
                    {p.label}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    <span className="num">{p.concept}</span> · {period(p.start, p.end)} ·{" "}
                    <SecLink href={secUrl(cik, p.accn, p.doc)}>{p.accn}</SecLink>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (t.doc) {
    return (
      <dl className="divide-y">
        <Row label="Company">{t.ticker}</Row>
        {t.doc.form && <Row label="Form">{t.doc.form === "4" ? "Form 4" : t.doc.form}</Row>}
        {t.doc.filed && <Row label="Filed">{fmtDate(t.doc.filed)}</Row>}
        <Row label="Filing">
          <SecLink href={secUrl(t.doc.cik ?? cik, t.doc.accn, t.doc.doc)}>{t.doc.accn}</SecLink>
        </Row>
      </dl>
    );
  }
  if (t.external) {
    return (
      <div className="space-y-3">
        {t.external.quote && (
          <blockquote className="border-l-2 pl-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {t.external.quote}
          </blockquote>
        )}
        <dl className="divide-y">
          {t.external.date && <Row label="Date">{readableDates(t.external.date)}</Row>}
          <Row label="Source">
            <SecLink href={t.external.url}>{safeHost(t.external.url)}</SecLink>
          </Row>
        </dl>
      </div>
    );
  }
  return (
    <p className="text-[12.5px] text-muted-foreground">
      This figure is shown with its source note in the report.
    </p>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Open source";
  }
}

/**
 * Source details for the public primer page. The signed-in app opens the filing itself and highlights
 * the line; here the same reference is shown as text with a link to SEC EDGAR, with no sign-in needed.
 */
export function PublicSourcePanel({ ciks }: { ciks: Record<string, string> }) {
  const { target, close } = useSource();
  return (
    <Sheet
      open={!!target}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b px-5 py-4 text-left">
          <p className="eyebrow">Source</p>
          <SheetTitle className="text-[15px] font-semibold leading-snug">
            {target ? readableDates(target.label) : "Source"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Where this figure comes from, with a link to the SEC filing.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 px-5 py-4">{target && <Body t={target} ciks={ciks} />}</div>
        <div className="border-t bg-muted/40 px-5 py-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            In the workspace this opens the filing itself, scrolled to the line and highlighted.
          </p>
          <Button asChild size="sm" className="mt-3">
            <Link to="/auth" search={{ mode: "signup" }}>
              Join the waitlist
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
