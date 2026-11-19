// Read-only content audit of datasets/vendor/ (no provider calls). Writes datasets/ops/vendor/content-audit-<ts>.json.
//   bun scripts/vendor-audit.ts [--caps=fiscal-ai/prices__daily]
import { args, log, sb } from "./lib/supa";
import contracts from "./vendor/contracts.json";
import { records } from "./vendor/core";

const catalog = new Map((contracts as any[]).map((c) => [c.id, c]));
const B = sb.storage.from("datasets");
async function ls(prefix: string) {
  const out: { name: string; size: number }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await B.list(prefix, { limit: 1000, offset: off });
    if (error) throw error;
    for (const d of data ?? []) out.push({ name: d.name, size: Number((d.metadata as any)?.size ?? 0) });
    if (!data || data.length < 1000) return out;
  }
}
const DATE_KEYS = ["date", "eventDate", "report_date", "reportDate", "reportDate", "report_date", "periodEndDate", "periodEnd", "period_end", "fiscalPeriodEnd", "eventDate", "event_date", "filingDate", "filedDate", "created", "updated", "date_from", "datetime"];
const FACETS = ["periodType", "period_type", "fiscalYear", "fiscal_year", "fiscalQuarter", "fiscalPeriod", "resourceType", "type", "reportDate"];
/** Contract records, else the natural list (prices, numbered-object arrays), else a single snapshot object. */
function recordsOf(res: any, contract: any): any[] {
  const r = records(res, contract);
  if (r.length) return r;
  const d = res?.data;
  if (!d || typeof d !== "object" || res?.error) return [];
  if (Array.isArray(d.prices)) return d.prices;
  const keys = Object.keys(d);
  if (keys.length && keys.every((k) => /^\d+$/.test(k))) return Object.values(d);
  if (d.event && d.transcript) return [{ ...d.event, paragraphs: d.stats?.paragraphCount }];
  return [d];
}
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
const pct = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] } : null; };
const pcts = (xs: string[]) => { const s = [...xs].sort(); return s.length ? { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] } : null; };

const result: any = { generatedAt: new Date().toISOString(), capabilities: {}, companies: {} };
const only = args.caps?.split(",");
for (const prov of await ls("vendor")) {
  for (const cap of await ls(`vendor/${prov.name}`)) {
    const id = `${prov.name}/${cap.name}`;
    if (only && !only.includes(id)) continue;
    const contract = catalog.get(`${prov.name}/${cap.name.replaceAll("__", "/")}`) ?? {};
    const files = await ls(`vendor/${id}`);
    const per: any[] = [];
    const fields = { top: new Set<string>(), record: new Set<string>() };
    const empty: string[] = [], failed: string[] = [];
    let dateKey: string | null = null;
    const queue = [...files];
    await Promise.all(Array.from({ length: 12 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const name = f.name.replace(/\.json$/, "");
        try {
          const { data, error } = await B.download(`vendor/${id}/${f.name}`);
          if (error || !data) throw new Error(error?.message ?? "no body");
          const text = await data.text();
          const v = JSON.parse(text);
          Object.keys(v).forEach((k) => fields.top.add(k));
          const pages: any[] = v.pages ?? [];
          const recs = pages.flatMap((p) => recordsOf(p.response ?? {}, contract));
          const shared = pages.some((p) => p.sharedResponse) ? JSON.stringify(pages.map((p) => p.sharedResponse)).length : 0;
          const errOnly = !recs.length && pages.some((p) => p.response?.error || p.error || p.miss);
          if (!recs.length) empty.push(name);
          for (const r of recs.slice(0, 50)) if (r && typeof r === "object") Object.keys(r).forEach((k) => fields.record.add(k));
          const sample = recs.find((r) => r && typeof r === "object") ?? {};
          if (!dateKey) dateKey = DATE_KEYS.find((k) => isDate(sample[k])) ?? Object.keys(sample).find((k) => isDate(sample[k])) ?? null;
          const dates = dateKey ? recs.map((r) => r?.[dateKey!]).filter(isDate).map((d: string) => d.slice(0, 10)).sort() : [];
          const facets: Record<string, Record<string, number>> = {};
          for (const k of FACETS) for (const r of recs) if (r && r[k] != null && typeof r[k] !== "object") { (facets[k] ??= {})[String(r[k])] = (facets[k][String(r[k])] ?? 0) + 1; }
          const sections = id.includes("enrich") ? recs.flatMap((r) => Object.keys(r ?? {}).concat(Object.keys(r?.company ?? {}).map((k) => `company.${k}`))) : undefined;
          per.push({ name, bytes: text.length, records: recs.length, earliest: dates[0] ?? null, latest: dates[dates.length - 1] ?? null, errOnly, sharedBytes: shared, facets, sections: sections ? [...new Set(sections)] : undefined, hitPageSize: recs.length >= 1000 });
          ((result.companies[name] ??= { caps: 0, bytes: 0, records: 0 }), result.companies[name].caps++, result.companies[name].bytes += text.length, result.companies[name].records += recs.length);
        } catch (e) { failed.push(`${name}: ${(e as Error).message.slice(0, 80)}`); }
      }
    }));
    result.capabilities[id] = {
      files: files.length, bytes: per.reduce((s, p) => s + p.bytes, 0), sharedBytes: per.reduce((s, p) => s + p.sharedBytes, 0),
      emptyOrError: empty.length, emptyTickers: empty, parseFailures: failed, dateField: dateKey,
      records: pct(per.map((p) => p.records)), earliest: pcts(per.map((p) => p.earliest).filter(Boolean)), latest: pcts(per.map((p) => p.latest).filter(Boolean)),
      topFields: [...fields.top], recordFields: [...fields.record].slice(0, 80), atPageSize: per.filter((p) => p.hitPageSize).map((p) => p.name), perFile: per,
    };
    log(`${id}: ${files.length} files, ${empty.length} empty, records ${JSON.stringify(result.capabilities[id].records)}`);
  }
}
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const path = `ops/vendor/content-audit-${ts}.json`;
const { error } = await B.upload(path, JSON.stringify(result), { contentType: "application/json", upsert: true });
if (error) throw error;
await Bun.write(`/tmp/vendor-audit.json`, JSON.stringify(result));
log(`saved ${path}`);
process.exit(0);
