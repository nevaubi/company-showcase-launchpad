// A flattened earnings slide can print one amount followed by changes versus the labeled
// periods. All numbers share one quote, so the period labels alone do not establish their roles.
const period = String.raw`(?:[1-4]Q\s*(?:FY\s*)?\d{2}(?:\d{2})?|Q[1-4]\s*(?:FY\s*)?\d{2}(?:\d{2})?|FY\s*\d{2}(?:\d{2})?)`;
const comparisonHeading = new RegExp(
  String.raw`\b(?:O\s*\/\s*\(?U\)?|over\s*\/\s*\(?under\)?)\s+((?:${period}\s+){2,5})`,
  "i",
);
const number = /^\s*(\(?\s*[$€£]?\s*[+−–-]?\s*\d[\d,]*(?:\.\d+)?\s*%?\s*\)?)/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function isPeriodComparison(
  quote: string | undefined,
  label: string,
  value: number,
  unit: string,
): boolean {
  if (!quote || !Number.isFinite(value) || !quote.includes("/")) return false;
  const heading = comparisonHeading.exec(quote);
  const printedName = label
    .split(/\s+[—–-]\s+/)
    .at(-1)
    ?.trim();
  if (
    !heading ||
    !printedName ||
    /\b(change|growth|variance|increase|decrease)\b/i.test(printedName)
  )
    return false;
  const n = heading[1].match(new RegExp(period, "gi"))!.length;
  const after = quote.slice(heading.index + heading[0].length);
  const labelPattern = new RegExp(
    `(?:^|\\s)${escape(printedName)}(?:\\s*\\(\\d+\\))?(?=\\s|\\$)`,
    "ig",
  );
  const scales =
    unit === "usd" || unit === "count" || unit === "shares" ? [1, 1e3, 1e6, 1e9, 1e12] : [1];
  let asChange = false;
  for (const row of after.matchAll(labelPattern)) {
    const previous = after.slice(0, row.index).trimEnd();
    // “Revenue” is a row after the header or a prior row's values; it is not the rest of “Noninterest revenue”.
    if (previous && !/[\d)%]$/.test(previous)) continue;
    let rest = after.slice(row.index! + row[0].length);
    const values: number[] = [];
    for (let i = 0; i < n; i++) {
      const token = number.exec(rest);
      if (!token) break;
      values.push(Number(token[1].replace(/[^\d.]/g, "")));
      rest = rest.slice(token[0].length);
    }
    if (values.length !== n) continue;
    const matches = (v: number) =>
      scales.some(
        (s) => Math.abs(v * s - Math.abs(value)) <= Math.max(1e-10, Math.abs(value) * 1e-12),
      );
    // The amount can legitimately repeat in a comparison column (especially zero); keep it when ambiguous.
    if (matches(values[0])) return false;
    if (values.slice(1).some(matches)) asChange = true;
  }
  return asChange;
}
