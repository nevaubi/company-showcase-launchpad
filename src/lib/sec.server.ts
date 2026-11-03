// Server-only helpers for SEC EDGAR. SEC requires a descriptive User-Agent and
// does not send CORS headers, so every request goes through here.
export const SEC_UA = "FiledUnder Research research@filedunder.ai";

export const archiveUrl = (cik: string, accn: string, doc = "") =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${doc}`;

export async function fetchSec(url: string): Promise<Response> {
  if (!/^https:\/\/(www\.sec\.gov|data\.sec\.gov|efts\.sec\.gov)\//.test(url)) throw new Error("Only SEC URLs are allowed");
  let last = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": SEC_UA, Accept: "*/*" } });
    if (res.ok) return res;
    last = res.status;
    if (res.status === 404) break;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`SEC EDGAR responded ${last || "with an error"} for ${url}`);
}

export interface FullTextHit {
  accn: string;
  doc: string;
  form: string;
  filed: string;
  period?: string;
  company: string;
  cik: string;
  description?: string;
  url: string;
}

export async function searchEdgarFullText(p: {
  q: string;
  ciks?: string[];
  forms?: string[];
  startdt?: string;
  enddt?: string;
}): Promise<{ total: number; hits: FullTextHit[] }> {
  const params = new URLSearchParams({ q: p.q });
  if (p.ciks?.length) params.set("ciks", p.ciks.map((c) => c.padStart(10, "0")).join(","));
  if (p.forms?.length) params.set("forms", p.forms.join(","));
  if (p.startdt || p.enddt) {
    params.set("dateRange", "custom");
    if (p.startdt) params.set("startdt", p.startdt);
    if (p.enddt) params.set("enddt", p.enddt);
  }
  const res = await fetchSec(`https://efts.sec.gov/LATEST/search-index?${params}`);
  const j = (await res.json()) as {
    hits?: {
      total?: { value: number };
      hits?: {
        _id: string;
        _source: {
          ciks: string[];
          display_names: string[];
          form: string;
          file_date: string;
          period_ending?: string;
          adsh: string;
          file_description?: string;
          root_forms?: string[];
        };
      }[];
    };
  };
  const hits = (j.hits?.hits ?? []).slice(0, 25).map((h) => {
    const [accn, doc] = h._id.split(":");
    const cik = h._source.ciks[0] ?? "";
    return {
      accn,
      doc,
      form: h._source.form,
      filed: h._source.file_date,
      period: h._source.period_ending,
      company: (h._source.display_names[0] ?? "").replace(/\s*\(CIK \d+\)/, ""),
      cik,
      description: h._source.file_description,
      url: archiveUrl(cik, accn, doc),
    };
  });
  return { total: j.hits?.total?.value ?? hits.length, hits };
}
