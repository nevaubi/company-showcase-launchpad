// Pure helpers for classifying investor-relations files.
import { decodeHtml } from "@/lib/ir/tables";

export type IrKind = "sec-copy" | "report" | "press-release" | "presentation" | "supplement" | "transcript" | "annual-report" | "proxy" | "data" | "image" | "other";

export const IR_FILE_RE = /\.(pdf|xlsx?|xlsm|csv|pptx?|docx?|jpe?g|png)$/i;

export function irFileExt(url: string, contentType: string): string {
  const m = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1].toLowerCase();
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "text/html": "htm",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "image/jpeg": "jpg",
    "image/png": "png",
  };
  return map[contentType] ?? "bin";
}

/**
 * The first words of an HTML exhibit, after the filing's own markers ("EX-99.2 3 c-ex99d2.htm EX-99.2
 * Exhibit 99.2"): tags, scripts, styles, the <title>, entities and zero-width spaces removed.
 */
export function leadingText(html: string, max = 400): string {
  let text = decodeHtml(
    html
      .slice(0, 400_000)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|title)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const marker = /^(?:ex-?99[\d.]*|exhibit\s+99[\d.]*|\d{1,3}|[\w.-]+\.html?)(?:\s+|$)/i;
  for (let i = 0; i < 10 && marker.test(text); i++) text = text.replace(marker, "");
  return text.slice(0, max);
}

/**
 * Kind from an exhibit's own first lines, used only when its name and description say nothing.
 * A release ("reports", "announces", "news release") is checked first, so a release's
 * "Financial Highlights" line never makes it a supplement.
 */
function kindFromHeading(heading: string): IrKind | null {
  const h = heading.toLowerCase();
  if (/\b(reports|reported|announces|announced|news release|press release|for immediate release)\b/.test(h)) return "press-release";
  if (/\b(financial|quarterly|statistical|earnings) (data )?supplement|supplemental (financial )?(information|data|schedules)|trend ?report|fact ?book/.test(h)) return "supplement";
  if (/^(consolidated (balance sheets?|statements? of (income|operations|condition|financial (condition|position)))|financial highlights|selected (consolidated )?financial (data|information|highlights))\b/.test(h)) return "supplement";
  if (/\b(earnings|investor|quarterly results) presentation\b/.test(h)) return "presentation";
  return null;
}

export function classifyIrDocument(p: { exhibit?: string; description?: string; name: string; ext: string; heading?: string }): { kind: IrKind; title: string } {
  const named = classifyByName(p);
  if (named.kind !== "other" || !p.heading) return named;
  return { kind: kindFromHeading(p.heading) ?? "other", title: named.title };
}

function classifyByName(p: { exhibit?: string; description?: string; name: string; ext: string }): { kind: IrKind; title: string } {
  const text = `${p.description ?? ""} ${p.name}`.toLowerCase();
  const title = (p.description && !/^ex-?99/i.test(p.description) ? p.description : p.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ")).trim();
  if (/^(jpe?g|png|gif)$/.test(p.ext)) return { kind: "image", title };
  // Copies of 10-K/10-Q/proxy filings already covered by EDGAR XBRL.
  if (/\b10[- ]?[qk]\b|as[- ]filed|including exhibits|form 10/.test(text)) return { kind: "sec-copy", title };
  if (/transcript/.test(text)) return { kind: "transcript", title };
  // Long-form reports (sustainability, citizenship, annual-report books) — stored, not table-mined.
  if (/sustainab|esg|citizenship|impact report|climate|tcfd|diversity|corporate responsibility|annual ?report|annualreport/.test(text)) return { kind: "report", title };
  // "wellsfargo3q26pres.htm": a quarter tag then "pres" (never "press release").
  if (/presentation|slides|deck|investor day|earnings call materials|\dq\d{2}pres\b/.test(text) || /^pptx?$/.test(p.ext)) return { kind: "presentation", title };
  if (/supplement|suppl\b|financial data|financial ?highlights|trending|trend ?report|schedules|fact ?book|metrics|kpi|statistical|segment/.test(text) || /^(xlsx?|xlsm|csv)$/.test(p.ext)) return { kind: p.ext.startsWith("xls") || p.ext === "csv" ? "data" : "supplement", title };
  if (/10-k wrap/.test(text)) return { kind: "annual-report", title };
  if (/proxy/.test(text)) return { kind: "proxy", title };
  if (/release|results|earnings|announces|reports/.test(text) || /99\.1\b/.test(p.exhibit ?? "")) return { kind: "press-release", title };
  return { kind: "other", title };
}
