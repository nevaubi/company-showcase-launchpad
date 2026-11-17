import { loadFacts } from "@/lib/ir/rebuild.server";
import { buildIrSeries } from "@/lib/ir/kpis";
import { buildIrSeries as buildPrev } from "@/lib/ir/kpis-prev.tmp";
const DAY = 86_400_000;
for (const t of process.argv[2].split(",")) {
  const facts = (await loadFacts(t)).filter((f) => f.method !== "text");
  const a = buildPrev(facts), b = buildIrSeries(facts);
  const vals = (r: typeof a) => { const out: { k: string; e: string; v: number; f: boolean }[] = []; for (const s of r.series) { for (const [e, c] of [...Object.entries(s.cells), ...Object.entries(s.monthly ?? {})]) out.push({ k: s.label, e, v: c.v, f: !!c.derived }); for (const [e, c] of Object.entries(s.annual)) out.push({ k: `${s.label} FY`, e, v: c.v, f: !!c.derived }); } return out; };
  const A = vals(a), B = vals(b);
  const idx = new Map<string, string[]>();
  for (const x of B) idx.set(`${x.k}|${Math.round(x.v * 1000)}`, [...(idx.get(`${x.k}|${Math.round(x.v * 1000)}`) ?? []), x.e]);
  const lost = A.filter((x) => !x.f && !(idx.get(`${x.k}|${Math.round(x.v * 1000)}`) ?? []).some((e) => Math.abs(Date.parse(e) - Date.parse(x.e)) <= 24 * DAY));
  console.log(t, `quarters ${a.quarters.length}→${b.quarters.length}`, `printed cells ${A.filter((x) => !x.f).length}→${B.filter((x) => !x.f).length}`, `derived ${A.filter((x) => x.f).length}→${B.filter((x) => x.f).length}`, "printed lost:", lost.length, lost.slice(0, 4).map((x) => `${x.k} ${x.e} ${x.v}`).join(" | "));
}
process.exit(0);
