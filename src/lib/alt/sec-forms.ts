// SEC form maps shared by the alt-data ETL script and the scheduled refresh job (pure, no I/O).
export const ITEMS: Record<string, [string, string]> = {
  "1.01": ["deal", "Entered a material agreement"], "1.02": ["deal", "Terminated a material agreement"],
  "2.01": ["m&a", "Completed an acquisition or disposition"], "2.03": ["debt", "Took on a direct financial obligation"],
  "2.04": ["debt", "Debt acceleration triggered"], "2.05": ["restructuring", "Exit or restructuring costs"],
  "2.06": ["impairment", "Material impairment"], "3.01": ["listing", "Listing standard notice"],
  "3.02": ["equity", "Unregistered equity sale"], "4.01": ["audit", "Changed auditor"],
  "4.02": ["restatement", "Prior financials no longer reliable"], "5.01": ["control", "Change in control"],
  "5.02": ["management", "Director or officer change"], "5.03": ["governance", "Charter or bylaw amendment"],
  "1.05": ["cyber", "Material cybersecurity incident"],
};

export const CAPITAL: [RegExp, string, string][] = [
  [/^S-3ASR$/, "shelf", "Automatic shelf registration (S-3ASR)"], [/^S-3(\/A)?$/, "shelf", "Shelf registration (S-3)"],
  [/^424B[2357]$/, "offering", "Securities offering prospectus"],
  [/^S-4(\/A)?$/, "merger", "Merger/exchange registration (S-4)"], [/^SC TO-I(\/A)?$/, "tender", "Issuer tender offer"],
  [/^SC TO-T(\/A)?$/, "tender", "Third-party tender offer"], [/^SC 14D9(\/A)?$/, "tender", "Response to tender offer"],
  [/^S-8$/, "equity_plan", "Employee stock plan registration (S-8)"], [/^DEFM14A$/, "merger", "Merger proxy"],
];

export interface SubmissionBlock { accessionNumber: string[]; form: string[]; filingDate: string[]; items?: string[]; primaryDocument: string[]; primaryDocDescription?: string[] }

const edgarUrl = (cik: string, accn: string, doc?: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${doc || `${accn}-index.htm`}`;

/** 8-K item events and capital-markets filings from an EDGAR submissions block. */
export function secAltRows(ticker: string, cik: string, b: SubmissionBlock) {
  const out: { uid: string; ticker: string; dataset: string; kind: "event"; date: string; title: string; meta: Record<string, unknown>; source: string; source_url: string }[] = [];
  // Banks file thousands of 424B2 structured-note pricing supplements; those are routine, not capital events.
  const routineNotes = new Set(["424B2", "424B3"].filter((x) => b.form.filter((f) => f === x).length > 100));
  for (let i = 0; i < b.accessionNumber.length; i++) {
    if (routineNotes.has(b.form[i])) continue;
    const accn = b.accessionNumber[i]; const url = edgarUrl(cik, accn, b.primaryDocument[i]);
    if (/^8-K/.test(b.form[i])) {
      for (const it of String(b.items?.[i] ?? "").split(",")) {
        const m = ITEMS[it.trim()]; if (!m) continue;
        out.push({ uid: `8k:${ticker}:${accn}:${it.trim()}`, ticker, dataset: "events", kind: "event", date: b.filingDate[i], title: m[1], meta: { item: it.trim(), category: m[0], form: b.form[i] }, source: "SEC EDGAR 8-K", source_url: url });
      }
      continue;
    }
    const hit = CAPITAL.find(([re]) => re.test(b.form[i])); if (!hit) continue;
    out.push({ uid: `cap:${ticker}:${accn}`, ticker, dataset: "capital", kind: "event", date: b.filingDate[i], title: hit[2], meta: { form: b.form[i], category: hit[1], description: b.primaryDocDescription?.[i] || null }, source: "SEC EDGAR", source_url: url });
  }
  return out;
}
