// Short names for long federal agency names in one-line lists (p5-shots M11: "National Aeronautics and Space
// Administr..." cut the contract's own description off). The list row keeps the full text in its title; the
// short form is the agency's own standard abbreviation, so nothing is guessed. Pure.

const SHORT: [RegExp, string][] = [
  [/\bNational Aeronautics and Space Administration\b/gi, "NASA"],
  [/\bNational Oceanic and Atmospheric Administration\b/gi, "NOAA"],
  [/\bDepartment of Homeland Security\b/gi, "DHS"],
  [/\bDepartment of Health and Human Services\b/gi, "HHS"],
  [/\bDepartment of Veterans Affairs\b/gi, "VA"],
  [/\bGeneral Services Administration\b/gi, "GSA"],
  [/\bDefense Logistics Agency\b/gi, "DLA"],
  [/\bDepartment of Defense\b/gi, "DoD"],
  [/\bDepartment of Energy\b/gi, "DOE"],
  [/\bDepartment of Transportation\b/gi, "DOT"],
  [/\bEnvironmental Protection Agency\b/gi, "EPA"],
  [/\bFederal Aviation Administration\b/gi, "FAA"],
  [/\bDepartment of the Air Force\b/gi, "Air Force"],
  [/\bDepartment of the Army\b/gi, "Army"],
  [/\bDepartment of the Navy\b/gi, "Navy"],
];

/** `text` with long agency names replaced by their standard abbreviations. */
export function shortAgency(text: string): string {
  let out = text;
  for (const [re, short] of SHORT) out = out.replace(re, short);
  return out;
}
