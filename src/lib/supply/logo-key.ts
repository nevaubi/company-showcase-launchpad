// The key a supply-page name is drawn with by `CompanyLogo`. A covered company keeps its ticker. A name without one gets the
// letters and digits of its name, four at most, upper case, plus a trailing space, so it can never equal a bundled ticker:
// "OpenAI Group PBC" must not borrow Opendoor's mark (OPEN), "TeamViewer" Atlassian's (TEAM). Same rule as the globe's plates.
export const logoKey = (n: { ticker?: string | null; name: string }): string =>
  n.ticker ? n.ticker : `${n.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase()} `;
