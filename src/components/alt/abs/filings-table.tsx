// Every stored filing of a deal: form, dates, both periods, the asset file and its hash, current or
// superseded, and the notes a reader needs before trusting a series built from them.
import { Fragment } from "react";
import { REVIEW_NOTE, replacedNote, type DealModel } from "@/lib/abs/view/deal";
import { bytes, count, day } from "@/lib/abs/view/format";
import { STAGE_LABEL, stageReason } from "@/lib/abs/view/stage";
import { Hash, Note, SecLink, Tag } from "./ui";

export function FilingsTable({ model }: { model: DealModel }) {
  const rows = model.filings;
  return (
    <div className="grid gap-2">
      {model.review.length > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] leading-relaxed">
          <span className="font-medium">Check this deal's series. </span>
          {REVIEW_NOTE}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b text-[11px] text-muted-foreground">
              <th scope="col" className="h-8 px-2 text-left font-normal">Filing</th>
              <th scope="col" className="px-2 text-right font-normal">Filed</th>
              <th scope="col" className="px-2 text-right font-normal">Cover period (EDGAR header)</th>
              <th scope="col" className="px-2 text-right font-normal">Period the records state</th>
              <th scope="col" className="px-2 text-right font-normal">Records in the file</th>
              <th scope="col" className="px-2 text-right font-normal">File size</th>
              <th scope="col" className="px-2 text-left font-normal">SHA-256</th>
              <th scope="col" className="px-2 text-left font-normal">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const reason = stageReason({ filed: f.filed, cover_end: f.coverEnd, records_end: f.recordsEnd });
              const notes: string[] = [];
              if (f.replacedBy) notes.push(replacedNote(f));
              if (f.aloneAmendment) notes.push(REVIEW_NOTE);
              return (
                <Fragment key={f.accession}>
                  <tr className={notes.length ? "" : "border-b border-border/60"}>
                    <th scope="row" className="h-7 px-2 text-left align-middle font-normal">
                      <SecLink href={f.indexUrl} className="num text-[12.5px] text-foreground">
                        {f.form} {f.accession}
                      </SecLink>
                    </th>
                    <td className="num px-2 text-right">{day(f.filed)}</td>
                    <td className="num px-2 text-right">
                      {f.coverStart ? `${day(f.coverStart)} to ` : ""}
                      {day(f.coverEnd)}
                    </td>
                    <td className="num px-2 text-right">
                      {f.mixedPeriods && <Tag title="The records state more than one period end; the latest is shown.">mixed</Tag>} {day(f.recordsEnd)}
                    </td>
                    <td className="num px-2 text-right">{count(f.records)}</td>
                    <td className="num px-2 text-right">{bytes(f.bytes)}</td>
                    <td className="px-2 text-left">
                      {f.fileUrl ? (
                        <a href={f.fileUrl} target="_blank" rel="noreferrer noopener" className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={`${f.fileName ?? "asset file"}: SHA-256 ${f.sha256 ?? "not recorded"}`}>
                          <Hash sha256={f.sha256} />
                        </a>
                      ) : (
                        <Hash sha256={f.sha256} />
                      )}
                    </td>
                    <td className="px-2 text-left">
                      <span className="inline-flex flex-wrap gap-1">
                        {f.state === "current" ? <Tag>current</Tag> : <Tag tone="warn">superseded</Tag>}
                        {f.stage.offering && (
                          <Tag tone="warn" title={reason}>
                            {STAGE_LABEL.toLowerCase()}
                          </Tag>
                        )}
                      </span>
                    </td>
                  </tr>
                  {notes.length > 0 && (
                    <tr className="border-b border-border/60">
                      <td colSpan={8} className="px-2 pb-1.5">
                        {notes.map((n) => (
                          <Note key={n}>{n}</Note>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {model.waiting != null && model.waiting > 0 && (
        <Note>
          {count(model.waiting)} more {model.waiting === 1 ? "filing is" : "filings are"} listed on EDGAR under this trust's own CIK and
          wait to be read. Filings are read oldest first, so the newest months can be among them.
        </Note>
      )}
      {model.notStored.length > 0 && (
        <Note>
          Set aside or failed under this trust's CIK:{" "}
          {model.notStored.map((n, i) => (
            <span key={n.accession}>
              {i > 0 && "; "}
              {n.form} {n.accession} filed {day(n.filed)}, {n.status}
              {n.status_detail ? ` (${n.status_detail})` : ""}
            </span>
          ))}
          .
        </Note>
      )}
      {model.limits.filings_total == null && <Note>Only the newest {count(model.limits.filings_read)} stored filings of this deal are listed.</Note>}
    </div>
  );
}
