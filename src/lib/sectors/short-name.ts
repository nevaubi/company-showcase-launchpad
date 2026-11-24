// Short company names for the sector companies table. SEC registrant names carry state tags ("/MD/"), legal
// forms ("Inc.", "Corp /De/") and long words ("Bancorporation", "Financial Services"), so about one in six
// Financials names was cut with an ellipsis at 1440 px. The rule: always drop the tags and the trailing legal
// form; when the name is still longer than `max`, abbreviate the common long words, then drop a trailing
// "Group"/"Holdings". The full name stays in the cell's title.

const TAG = /\s*\/[A-Za-z]{2,3}\/?\s*$/;
const FORM = /[\s,]+(inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|plc|llc|l\.?p\.?|n\.?a\.?|s\.?a\.?|n\.?v\.?|ag|se)$/i;

const ABBR: [RegExp, string][] = [
  [/\bBancorporation\b/g, "Bancorp"],
  [/\bBancshares\b/g, "Bancsh."],
  [/\bFinancial\b/g, "Fin."],
  [/\bServices\b/g, "Svcs."],
  [/\bInsurance\b/g, "Ins."],
  [/\bManagement\b/g, "Mgmt."],
  [/\bInformation\b/g, "Info."],
  [/\bInternational\b/g, "Intl."],
  [/\bInvestment\b/g, "Inv."],
  [/\bMortgage\b/g, "Mtg."],
  [/\bInfrastructure\b/g, "Infra."],
  [/\bAgricultural\b/g, "Agri."],
  [/\bCommercial\b/g, "Comm."],
  [/\bCorporation\b/g, "Corp."],
  [/\bTechnologies\b/g, "Tech."],
  [/\bPharmaceuticals\b/g, "Pharma."],
  [/\bCommunications\b/g, "Comms."],
];

/** Tags and legal forms off, then abbreviations only while the name is longer than `max` characters. */
export function shortCompany(name: string, max = 22): string {
  let s = name.trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(TAG, "").replace(FORM, "").replace(/[\s,]+$/, "");
    if (next === s) break;
    s = next;
  }
  if (!s) return name.trim();
  if (s.length <= max) return s;
  for (const [re, to] of ABBR) {
    s = s.replace(re, to);
    if (s.length <= max) return s;
  }
  const bare = s.replace(/\s+(Group|Holdings|Holding)$/, "");
  return bare || s;
}
