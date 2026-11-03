// Pure helpers for classifying investor-relations files.
export type IrKind = "sec-copy" | "press-release" | "presentation" | "supplement" | "transcript" | "annual-report" | "proxy" | "data" | "image" | "other";

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

export function classifyIrDocument(p: { exhibit?: string; description?: string; name: string; ext: string }): { kind: IrKind; title: string } {
  const text = `${p.description ?? ""} ${p.name}`.toLowerCase();
  const title = (p.description && !/^ex-?99/i.test(p.description) ? p.description : p.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ")).trim();
  if (/^(jpe?g|png|gif)$/.test(p.ext)) return { kind: "image", title };
  // Copies of 10-K/10-Q/proxy filings already covered by EDGAR XBRL.
  if (/\b10[- ]?[qk]\b|as[- ]filed|including exhibits|form 10/.test(text)) return { kind: "sec-copy", title };
  if (/transcript/.test(text)) return { kind: "transcript", title };
  if (/presentation|slides|deck|investor day|earnings call materials/.test(text) || /^pptx?$/.test(p.ext)) return { kind: "presentation", title };
  if (/supplement|financial data|trending|schedules|fact ?book|metrics|kpi|statistical|segment/.test(text) || /^(xlsx?|xlsm|csv)$/.test(p.ext)) return { kind: p.ext.startsWith("xls") || p.ext === "csv" ? "data" : "supplement", title };
  if (/annual report|10-k wrap/.test(text)) return { kind: "annual-report", title };
  if (/proxy/.test(text)) return { kind: "proxy", title };
  if (/release|results|earnings|announces|reports/.test(text) || /99\.1\b/.test(p.exhibit ?? "")) return { kind: "press-release", title };
  return { kind: "other", title };
}
