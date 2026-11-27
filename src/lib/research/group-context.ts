import type { GroupSummary, Overview } from "@/lib/sectors/groups";
import { baseMembers, type CoverageLike } from "@/lib/sectors/members";
import { pct } from "@/lib/sectors/format";
import { industryMethod } from "./industry-method";

function groupEvidence(group: GroupSummary, overview: Overview): string[] {
  const lines = [
    `${group.kind}: ${group.name} | ${group.n} members | /app/sectors/g/${encodeURIComponent(group.slug)}`,
  ];
  for (const period of ["1M", "3M"]) {
    const cap = group.returns?.cw?.[period],
      equal = group.returns?.ew?.[period],
      spy = overview.spy_returns?.[period];
    if (cap == null || !Number.isFinite(cap)) continue;
    const parts = [`${period} cap-weighted ${pct(cap)}`];
    if (equal != null && Number.isFinite(equal)) parts.push(`equal-weighted ${pct(equal)}`);
    if (spy != null && Number.isFinite(spy))
      parts.push(`SPY ${pct(spy)}, excess ${((cap - spy) * 100).toFixed(2)} pp`);
    lines.push(parts.join(" | "));
  }
  for (const key of ["rev_growth", "ni_growth", "nm"]) {
    const observation = group.latest?.[key];
    if (!observation) continue;
    const [quarter, value, n] = observation;
    if (!quarter || value == null || !Number.isFinite(value) || !(n > 0)) continue;
    lines.push(
      `${overview.metrics?.[key]?.name ?? key} ${pct(value)} | ${quarter} | ${n} contributing companies`,
    );
  }
  if (group.top5 != null && Number.isFinite(group.top5))
    lines.push(`Largest five members: ${pct(group.top5)} of group market cap`);
  return lines;
}

export function industryWorkup(
  query: string,
  overview: Overview,
  coverage: readonly CoverageLike[],
): string {
  const target = query.trim().toLowerCase();
  const assignment = baseMembers(overview, coverage).list.find(
    (c) => c.ticker.toLowerCase() === target,
  );
  let industry: GroupSummary | undefined;
  let sector: GroupSummary | undefined;
  if (assignment) {
    industry = overview.groups.find(
      (g) =>
        g.kind === "industry" && g.sector === assignment.sector && g.name === assignment.industry,
    );
    sector = overview.groups.find((g) => g.kind === "sector" && g.name === assignment.sector);
  } else {
    const matches = overview.groups.filter((g) =>
      [g.slug, g.name].some((n) => n.toLowerCase() === target),
    );
    if (matches.length !== 1)
      return matches.length
        ? `Multiple matching groups. Use one of these slugs: ${matches.map((g) => g.slug).join(", ")}`
        : "No matching ticker, sector or industry in the stored comparison. Use a covered ticker or exact group name.";
    if (matches[0].kind === "sector") sector = matches[0];
    else {
      industry = matches[0];
      sector = overview.groups.find((g) => g.kind === "sector" && g.name === industry?.sector);
    }
  }
  const sec = sector?.name ?? industry?.sector ?? assignment?.sector ?? "";
  const ind = industry?.name ?? assignment?.industry;
  const lines = [
    `Group context for ${assignment?.ticker ?? industry?.name ?? sec}. Market returns through ${overview.as_of}; build ${overview.generated}.`,
  ];
  for (const g of [industry, sector]) if (g) lines.push(...groupEvidence(g, overview));
  if (!sector && !industry) lines.push("No matching group measurements.");
  lines.push(`Analyst questions to test against primary evidence: ${industryMethod(sec, ind)}`);
  lines.push(
    "Test the proposed channel against issuer disclosures, peer results and data available on the same date. Report missing links and what observation would overturn the thesis.",
  );
  return lines.join("\n");
}
