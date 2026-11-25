// The company to official-record mapping (src/lib/sources/company/links.json): check it, verify it against the
// FDIC today, and rebuild it each quarter. No page ever builds a link; this script does, and only by identifiers.
//
//   bun scripts/company-source-links.ts check                 offline: validates links.json and guard.json, prints a summary
//   bun scripts/company-source-links.ts guard                 rewrites guard.json from links.json
//   bun scripts/company-source-links.ts verify --live [--out=report.csv]
//                                                             reads the FDIC institutions API for every mapped certificate
//                                                             and prints where holder or bank RSSD differ; changes nothing
//   bun scripts/company-source-links.ts build [--tickers=A,B | --all] [--y9c=<dataset id>] [--dry]
//                                                             the quarterly rebuild (steps 1 to 5 of build.ts); needs
//                                                             SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; reads SEC, the
//                                                             FDIC API and the stored NIC, FDIC and FR Y-9C files
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { banksByHolder, fdicVerdict, indexByTax, matchRegistrant, mergeLinks, RULE_VERSION, serializeLinks, walkRelationships } from "../src/lib/sources/company/build";
import { deriveGuard, summarizeLinks, validateLinks } from "../src/lib/sources/company/validate";
import { isLive, type CompanyLink } from "../src/lib/sources/company/types";
import { fdicRecordUrl, institutionsByCert } from "./lib/company-links/fdic";
import { readCover, statedAssets } from "./lib/company-links/sec";

const LINKS = fileURLToPath(new URL("../src/lib/sources/company/links.json", import.meta.url));
const GUARD = fileURLToPath(new URL("../src/lib/sources/company/guard.json", import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "true"])) as Record<string, string>;
const today = new Date().toISOString().slice(0, 10);
const load = (): CompanyLink[] => JSON.parse(readFileSync(LINKS, "utf8")) as CompanyLink[];

function check(): number {
  const text = readFileSync(LINKS, "utf8");
  const links = JSON.parse(text) as CompanyLink[];
  const problems = validateLinks(links);
  if (serializeLinks(links) !== text) problems.push("links.json is not in its written form (run the build or re-serialize it)");
  const guard = JSON.stringify(deriveGuard(links)) + "\n";
  if (readFileSync(GUARD, "utf8") !== guard) problems.push("guard.json is not what links.json derives (run: bun scripts/company-source-links.ts guard)");
  const s = summarizeLinks(links);
  console.log(`${s.rows} rows, ${s.tickers} tickers (${s.provenTickers} with proven links)`);
  console.log(`  registrants ${s.registrants}, FR Y-9C filers ${s.y9cRegistrants} (${s.y9cPointers} row pointers)`);
  console.log(`  insured banks ${s.insuredBanks} (${s.cohortBanks} in the FDIC 500 cohort), noninsured trust companies ${s.trustCompanies}, ABS sponsor banks ${s.absSponsors}`);
  console.log(`  by status ${JSON.stringify(s.byStatus)}; for review: ${s.reviewTickers.join(", ")}`);
  for (const p of problems) console.log(`PROBLEM ${p}`);
  console.log(problems.length ? `${problems.length} problems` : "valid");
  return problems.length ? 1 : 0;
}

async function verifyLive(): Promise<number> {
  if (flags.live !== "true") {
    console.log("verify reads the FDIC API: pass --live");
    return 2;
  }
  const banks = load().filter(l => isLive(l) && (l.link_kind === "insured_bank" || l.link_kind === "noninsured_trust_company"));
  const live = await institutionsByCert(banks.map(l => l.key_value));
  const lines = ["ticker,cert,kind,basis,fdic_report_date,verdict"];
  let differ = 0, trustSeen = 0;
  for (const l of banks) {
    const r = live.get(l.key_value);
    const v = fdicVerdict(l, r);
    const trust = l.link_kind === "noninsured_trust_company";
    // The institutions API lists insured institutions; most noninsured trust companies (FDIC class NC) are not in it.
    if (trust) {
      if (r) trustSeen += 1;
      lines.push([l.ticker, l.key_value, l.link_kind, l.basis, r?.REPDTE ?? "", `"${r ? v.text : "not listed by the API (noninsured trust company)"}"`].join(","));
      continue;
    }
    if (!v.ok) {
      differ += 1;
      console.log(`DIFFERS ${l.ticker} ${l.key_value} ${l.entity_name}: ${v.text}`);
    }
    lines.push([l.ticker, l.key_value, l.link_kind, l.basis, r?.REPDTE ?? "", `"${v.text}"`].join(","));
  }
  const insured = banks.filter(l => l.link_kind === "insured_bank").length;
  console.log(`${insured} insured banks read from api.fdic.gov on ${today}: ${insured - differ} agree, ${differ} differ`);
  console.log(`${banks.length - insured} noninsured trust companies: the API lists ${trustSeen}; they are linked through the stored FDIC all-banks file`);
  if (flags.out) writeFileSync(flags.out, lines.join("\n") + "\n");
  return differ ? 1 : 0;
}

const assetsTie = (y9cK: string | null, sec: { value: number } | null): { result: string; gap: number } | null => {
  if (!y9cK || !/^\d+$/.test(y9cK) || !sec) return null;
  const y9 = Number(y9cK) * 1000;
  const diff = sec.value - y9;
  const m = Math.round(diff / 1e6);
  return { result: diff === 0 ? "equal" : `10-Q less Y-9C = ${m}M on ${(sec.value / 1e9).toFixed(1)}B of assets`, gap: Math.abs(diff) / sec.value };
};

async function build(): Promise<number> {
  const { sb } = await import("./lib/supa");
  const store = await import("./lib/company-links/store");
  const { COVERAGE } = await import("@/lib/coverage");
  const old = load();
  const wanted = flags.tickers ? new Set(flags.tickers.toUpperCase().split(",")) : null;
  // default: every company the mapping names and every covered financial; --all reads every covered company
  const universe = COVERAGE.filter(c => (wanted ? wanted.has(c.ticker) : flags.all === "true" || old.some(l => l.ticker === c.ticker) || c.sector === "Financials"));
  console.log(`step 1: cover pages of ${universe.length} registrants`);
  const covers = new Map<string, NonNullable<Awaited<ReturnType<typeof readCover>>>>();
  for (const c of universe) {
    const cover = await readCover(c.cik).catch(() => null);
    if (cover?.ein) covers.set(c.ticker, cover);
  }
  console.log(`step 2: NIC entities by tax ID`);
  const { snap: nicSnap, entities } = await store.nicEntities(sb as never);
  const byTax = indexByTax(entities);
  const fresh: CompanyLink[] = [];
  const registrants = new Map<string, { link: CompanyLink; rssd: string }>();
  for (const c of universe) {
    const cover = covers.get(c.ticker);
    if (!cover) continue;
    const m = matchRegistrant(cover.ein!, cover.name || c.shortName, byTax);
    if (m.status === "none") continue;
    if (m.status === "review") {
      console.log(`  review ${c.ticker}: ${m.reason}`);
      continue;
    }
    const e = m.entity;
    const evidence = {
      sec: { cik: cover.cik, ein: cover.ein!, ein_source: "cover" as const, accession: cover.accession, form: cover.form, cover_url: cover.coverUrl, ...(cover.headerEin && cover.headerEin !== cover.ein ? { header_ein: cover.headerEin } : {}) },
      nic: { dataset: nicSnap.dataset, snapshot: nicSnap.snapshot, row: e.row, rssd: e.rssd, tax_id: e.taxId, legal_name: e.legalName, entity_type: e.entityType, sec_reporting_status: e.secStatus, name_check: "same after removing legal forms" },
      checks: {},
    };
    const link: CompanyLink = { ticker: c.ticker, cik: cover.cik, link_kind: "registrant_rssd", key_field: "RSSD", key_value: e.rssd, entity_name: cover.name, basis: "ein_equal", status: "proven", valid_from: today, valid_to: null, evidence, rule_version: RULE_VERSION, checked_at: today };
    registrants.set(c.ticker, { link, rssd: e.rssd });
  }
  console.log(`  ${registrants.size} registrants proven by EIN`);
  console.log(`step 3: banks by FDIC top holder, else by NIC relationship rows (stored FDIC all-banks file)`);
  const { snap: fdicSnap, institutions } = await store.fdicInstitutions(sb as never);
  const activeByRssd = new Map(institutions.filter(i => String(i.ACTIVE) === "1").map(i => [String(i.FED_RSSD), i]));
  const banksOf = new Map<string, { inst: (typeof institutions)[number]; basis: CompanyLink["basis"]; relationship?: CompanyLink["evidence"]["relationship"] }[]>();
  for (const [t, r] of registrants) banksOf.set(t, banksByHolder(r.rssd, institutions) as never);
  const without = [...registrants].filter(([t]) => !banksOf.get(t)?.length);
  if (without.length) {
    const { snap: relSnap, relationships } = await store.nicRelationships(sb as never, without.map(([, r]) => r.rssd));
    for (const [t, r] of without) {
      const found = walkRelationships(r.rssd, relationships, new Set(activeByRssd.keys()));
      banksOf.set(t, found.map(p => ({
        inst: activeByRssd.get(p.bank)!,
        basis: p.steps.some(s => s.other_basis) ? "nic_other_basis" : "nic_equity",
        relationship: { dataset: relSnap.dataset, snapshot: relSnap.snapshot, path: p.path, steps: p.steps },
      })));
    }
  }
  const certs = [...banksOf.values()].flat().map(b => String(b.inst.CERT));
  const cohort = await store.cohortCerts(sb as never, certs);
  for (const [t, r] of registrants) {
    for (const b of banksOf.get(t) ?? []) {
      const cert = String(b.inst.CERT);
      const trust = String(b.inst.BKCLASS ?? "") === "NC";
      const date = /^\d{8}$/.test(b.inst.REPDTE ?? "") ? `${b.inst.REPDTE!.slice(0, 4)}-${b.inst.REPDTE!.slice(4, 6)}-${b.inst.REPDTE!.slice(6)}` : (b.inst.REPDTE ?? "");
      fresh.push({
        ...r.link, link_kind: trust ? "noninsured_trust_company" : "insured_bank", key_field: "CERT", key_value: cert, entity_name: b.inst.NAME, basis: b.basis, valid_from: date || today,
        evidence: {
          ...r.link.evidence,
          fdic: {
            // the FDIC institutions API does not list noninsured trust companies: their record is the stored row
            ...(trust ? { api_note: "The FDIC institutions API does not list this noninsured trust company; the stored FDIC all-banks row is the record." } : { api_url: fdicRecordUrl(cert) }),
            dataset: fdicSnap.dataset, snapshot: fdicSnap.snapshot, row: b.inst.row, bank_rssd: String(b.inst.FED_RSSD),
            // the FDIC's own top holder, as it states it: the registrant for top_holder, an entity above it for a NIC path
            holder_rssd: String(b.inst.RSSDHCR ?? "").replace(/^0+/, "") || null,
            report_date: date, total_assets_k: String(b.inst.ASSET ?? ""), cohort500: cohort.has(cert), class: trust ? "noninsured_trust" : "insured",
          },
          ...(b.relationship ? { relationship: b.relationship } : {}),
          checks: {},
        },
      });
    }
  }
  // step 4, first half: today's FDIC API record of every insured bank found
  const insured = fresh.filter(f => f.link_kind === "insured_bank");
  const live = await institutionsByCert(insured.map(f => f.key_value));
  for (const f of insured) {
    const v = fdicVerdict(f, live.get(f.key_value));
    f.evidence.checks = { ...f.evidence.checks, fdic_live: { checked_at: today, report_date: live.get(f.key_value)?.REPDTE ?? "", verdict: v.text } };
    if (!v.ok) console.log(`  ${f.ticker} ${f.key_value} ${f.entity_name}: FDIC API ${v.text}; not linked this run`);
  }
  for (let i = fresh.length - 1; i >= 0; i--) if (fresh[i].link_kind === "insured_bank" && fresh[i].evidence.checks.fdic_live?.verdict !== "agrees") fresh.splice(i, 1);
  console.log(`step 4: FR Y-9C rows and the total-assets tie`);
  const { snap: y9Snap, byRssd } = await store.y9cRowsByRssd(sb as never, flags.y9c ?? store.DATASETS.y9c);
  for (const [t, r] of registrants) {
    // only consolidated reports: a row without total assets (BHCK2170) is a parent-only FR Y-9LP or Y-9SP report
    const rows = (byRssd.get(r.rssd) ?? []).filter(x => x.assetsK != null && x.assetsK.trim() !== "").sort((a, b) => a.date.localeCompare(b.date));
    const hasBank = (banksOf.get(t) ?? []).length > 0;
    if (!rows.length && !hasBank) continue;
    const link = { ...r.link };
    if (rows.length) {
      link.y9c = rows.map(x => ({ report_date: x.date, dataset: y9Snap.dataset, snapshot: y9Snap.snapshot, row: x.row }));
      const tieRow = [...rows].reverse().find(x => x.assetsK);
      const tie = tieRow ? assetsTie(tieRow.assetsK, await statedAssets(r.link.cik, tieRow.date).catch(() => null)) : null;
      if (tie) {
        link.evidence = { ...link.evidence, checks: { ...link.evidence.checks, y9c_assets_tie: { date: tieRow!.date, result: tie.result } } };
        if (tie.gap > 0.005) {
          console.log(`  review ${t}: FR Y-9C total assets differ from the 10-Q by ${(tie.gap * 100).toFixed(2)}%`);
          continue;
        }
      }
    }
    fresh.push(link);
  }
  // asset-backed sponsors are carried over only while their bank is proven again
  for (const s of old.filter(l => isLive(l) && l.link_kind === "abs_sponsor_bank")) {
    if (fresh.some(f => f.ticker === s.ticker && f.link_kind === "insured_bank" && f.key_value === s.evidence.sponsor?.cert)) fresh.push(s);
  }
  const fresher = fresh.filter(f => f.link_kind === "registrant_rssd" || fresh.some(g => g.ticker === f.ticker && g.link_kind === "registrant_rssd"));
  console.log(`step 5: merge (rows are closed, never deleted)`);
  const merged = mergeLinks(old, fresher, today);
  const problems = validateLinks(merged.links);
  console.log(`  kept ${merged.kept}, opened ${merged.opened.length}, closed ${merged.closed.length}`);
  for (const c of merged.closed) console.log(`  closed ${c.ticker} ${c.link_kind} ${c.key_value} ${c.entity_name ?? ""}`);
  for (const o of merged.opened) console.log(`  opened ${o.ticker} ${o.link_kind} ${o.key_value} ${o.entity_name ?? ""}`);
  if (problems.length) {
    for (const p of problems) console.log(`PROBLEM ${p}`);
    console.log("not written: the rebuilt mapping does not validate");
    return 1;
  }
  if (flags.dry === "true") return 0;
  writeFileSync(LINKS, serializeLinks(merged.links));
  writeFileSync(GUARD, JSON.stringify(deriveGuard(merged.links)) + "\n");
  console.log("written: links.json and guard.json; run check, the tests, and review the diff before committing");
  return 0;
}

const run: Record<string, () => number | Promise<number>> = {
  check,
  guard: () => {
    writeFileSync(GUARD, JSON.stringify(deriveGuard(load())) + "\n");
    console.log("guard.json written");
    return 0;
  },
  verify: verifyLive,
  build,
};
const fn = run[command];
if (!fn) {
  console.log("usage: bun scripts/company-source-links.ts check | guard | verify --live [--out=file.csv] | build [--tickers=A,B | --all] [--y9c=<dataset id>] [--dry]");
  process.exit(2);
}
process.exit(await fn());
