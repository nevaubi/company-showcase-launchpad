// ABS-EE importer: the asset-level data that issuers of asset-backed securities file with the SEC
// (Form ABS-EE and ABS-EE/A, exhibit EX-102), into the abs_* tables of migration 0067.
//
//   bun scripts/abs-ee.ts discover --cik=1767379[,…]   list a CIK's ABS-EE filings (nothing is downloaded)
//   bun scripts/abs-ee.ts load     --cik=…             store listed filings, oldest first, a bounded batch
//   bun scripts/abs-ee.ts run      --cik=…             discover, then load
//   bun scripts/abs-ee.ts verify   --cik=…             re-read stored filings from SEC and compare
//   bun scripts/abs-ee.ts status                       totals and the store's invariants
//
// Options: --max-filings=25 (per CIK and run), --from=YYYY-MM-DD, --to=YYYY-MM-DD, --reparse (store
// again what an older reader version stored), --retry-skipped, --cache=<dir> (SEC files as served;
// default .cache/sec), --offline (use only files already on disk).
//
// A run is safe to stop at any point and safe to run again. One filing is stored all or nothing
// (abs_begin_load, abs_put_rows, abs_commit_load); a filing this reader version already stored is not
// planned again; a filing cut off half way is started over by the next run. Rules: src/lib/abs/AGENTS.md.
// Database: the app's own (scripts/lib/supa.ts) unless ABS_DB_URL names a Postgres to prove a change on.
import {
  cmbsMetrics,
  cmbsRows,
  linkProperties,
  type CmbsAssetRow,
  type CmbsPropertyRow,
} from "../src/lib/abs/cmbs";
import {
  assetFiles,
  dealOf,
  familyOfClass,
  headerUrl,
  indexUrl,
  listedFilings,
  olderPages,
  parseAbsHeader,
  parseFilingIndex,
  submissionsPageUrl,
  submissionsUrl,
  type SubmissionsFile,
} from "../src/lib/abs/edgar";
import { PARSER, type MetricRow } from "../src/lib/abs/metrics";
import { planLoads, type FilingState } from "../src/lib/abs/plan";
import { createAbsReader, declaredEncoding, type AbsFileShape } from "../src/lib/abs/xml";
import { connectAbsDb, type AbsDb } from "./lib/abs-store";
import { SecSource } from "./lib/abs-source";

const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith("--")) ?? "";
const args = Object.fromEntries(
  argv
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k, v.length ? v.join("=") : "true"];
    }),
) as Record<string, string | undefined>;
const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);

const ciks = String(args.cik ?? "")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean)
  .map(Number);
const MAX_FILINGS = Number(args["max-filings"] ?? 25);
const MAX_ATTEMPTS = 3;
const CHUNK = 200;
const READS = new Set(["cmbs"]);
const SMALL_FILE = 5_000_000;

if (
  !["discover", "load", "run", "verify", "status"].includes(command) ||
  (command !== "status" && (!ciks.length || ciks.some((c) => !Number.isInteger(c) || c <= 0)))
) {
  console.error(
    "usage: bun scripts/abs-ee.ts discover|load|run|verify --cik=<cik>[,<cik>…] [options]   |   bun scripts/abs-ee.ts status",
  );
  process.exit(2);
}

const src = new SecSource(args.cache ?? ".cache/sec", { offline: args.offline === "true", log });
const db = await connectAbsDb();

// For the interruption proof only: ABS_FAULT=<begin|put|commit>:<n> kills the process, without any
// cleanup, at that point of the n-th filing this run stores.
const FAULT = /^(begin|put|commit):(\d+)$/.exec(process.env.ABS_FAULT ?? "");
let stored = 0;
const fault = (point: string) => {
  if (FAULT && FAULT[1] === point && Number(FAULT[2]) === stored + 1)
    process.kill(process.pid, "SIGKILL");
};

type Parsed =
  | { skip: string }
  | {
      skip?: undefined;
      sha256: string;
      bytes: number;
      filing: Record<string, unknown>;
      documents: Record<string, unknown>[];
      rows: {
        cmbs_assets: CmbsAssetRow[];
        cmbs_properties: CmbsPropertyRow[];
        metrics: MetricRow[];
      };
      counts: Record<string, unknown>;
    };

/** Everything one filing says, read from SEC (or the disk copy): no database involved. */
async function readFiling(cik: number, accession: string): Promise<Parsed> {
  const h = await src.text(headerUrl(cik, accession));
  const header = parseAbsHeader(h.text);
  if (header.accession !== accession) throw new Error(`header is for ${header.accession}`);
  const deal = dealOf(header);
  if (!deal) return { skip: "the header does not establish one issuing entity" };
  const docs = parseFilingIndex((await src.text(indexUrl(cik, accession))).text);
  const files = assetFiles(docs);
  if (!files.length) return { skip: "no EX-102 asset data file" };
  if (files.length > 1) return { skip: `unsupported: ${files.length} EX-102 files in one filing` };
  // The header's asset class is the filer's label and has been seen wrong, so a small file is read and
  // judged by its own namespace. Only a large file whose label names nothing this reader covers is left
  // on SEC's side (an auto loan file is 30 to 220 MB).
  const labelled = header.assetClasses.map(familyOfClass);
  const covered = !labelled.length || labelled.some((f) => READS.has(f));
  if (!covered && (files[0].listed_bytes ?? Infinity) > SMALL_FILE)
    return {
      skip: `unsupported: asset class "${header.assetClasses.join("; ")}" is not read by ${PARSER}`,
    };

  const assets: CmbsAssetRow[] = [];
  const properties: CmbsPropertyRow[] = [];
  let family: AbsFileShape["family"] | null = null;
  const reader = createAbsReader((record) => {
    family ??= reader.shape().family;
    if (family !== "cmbs") return;
    const rows = cmbsRows(record);
    assets.push(rows.asset);
    properties.push(...rows.properties);
  });
  const file = await src.open(files[0].url);
  let decoder: TextDecoder | null = null;
  let head: Uint8Array[] = [];
  let headBytes = 0;
  let replacements = 0;
  const feed = (text: string) => {
    for (let i = text.indexOf("�"); i >= 0; i = text.indexOf("�", i + 1)) replacements++;
    reader.write(text);
  };
  for await (const chunk of file.chunks) {
    if (decoder) feed(decoder.decode(chunk, { stream: true }));
    else {
      // the encoding is declared in the first bytes; wait for enough of them
      head.push(chunk);
      headBytes += chunk.length;
      if (headBytes < 200) continue;
      const first = Buffer.concat(head);
      decoder = new TextDecoder(declaredEncoding(first));
      feed(decoder.decode(first, { stream: true }));
      head = [];
    }
  }
  if (!decoder) {
    const first = Buffer.concat(head);
    decoder = new TextDecoder(declaredEncoding(first));
    feed(decoder.decode(first, { stream: true }));
  }
  feed(decoder.decode());
  const shape = reader.close();
  const served = file.done();
  if (!READS.has(shape.family))
    return {
      skip: `unsupported: asset files in ${shape.namespace || "no namespace"} are not read by ${PARSER}`,
    };
  linkProperties(assets, properties);
  const metrics = cmbsMetrics(assets, properties);
  const tally = (
    rows: { unparsed: Record<string, unknown>; extra: Record<string, unknown> }[],
    key: "unparsed" | "extra",
  ) => {
    const t: Record<string, number> = {};
    for (const r of rows) for (const name of Object.keys(r[key])) t[name] = (t[name] ?? 0) + 1;
    return t;
  };
  return {
    sha256: served.sha256,
    bytes: served.bytes,
    filing: {
      ...deal,
      family: shape.family,
      asset_class: header.assetClasses.join("; ") || null,
      depositor_cik: header.depositorCik,
      sponsor_cik: header.sponsorCik,
      period_start: header.periodStart,
      period_end: header.periodEnd,
      accepted_at: header.acceptedAt,
      header_sha256: h.sha256,
    },
    documents: docs.map((d) =>
      d.url === files[0].url
        ? {
            ...d,
            bytes: served.bytes,
            sha256: served.sha256,
            records: shape.records,
            namespace: shape.namespace,
            retrieved_at: served.retrievedAt,
          }
        : d,
    ),
    rows: { cmbs_assets: assets, cmbs_properties: properties, metrics },
    counts: {
      cmbs_assets: assets.length,
      cmbs_properties: properties.length,
      metrics: metrics.length,
      records: shape.records,
      attributes: shape.attributes,
      decode_replacements: replacements,
      unparsed: { assets: tally(assets, "unparsed"), properties: tally(properties, "unparsed") },
      extra: { assets: tally(assets, "extra"), properties: tally(properties, "extra") },
    },
  };
}

const KINDS = ["cmbs_assets", "cmbs_properties", "metrics"] as const;

async function storeFiling(
  accession: string,
  p: Exclude<Parsed, { skip: string }>,
): Promise<"stored" | "unchanged"> {
  await db.gate("abs-ee");
  const begin = await db.rpc<{ skip: boolean; load_id: number }>("abs_begin_load", {
    _accession: accession,
    _parser: PARSER,
    _sha256: p.sha256,
    _bytes: p.bytes,
    _force: false,
  });
  if (begin.skip) return "unchanged";
  fault("begin");
  let first = true;
  for (const kind of KINDS) {
    const rows = p.rows[kind] as unknown[];
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.gate("abs-ee");
      await db.rpc<number>("abs_put_rows", {
        _load_id: begin.load_id,
        _kind: kind,
        _rows: rows.slice(i, i + CHUNK),
      });
      if (first) fault("put");
      first = false;
    }
  }
  fault("commit");
  await db.gate("abs-ee");
  await db.rpc("abs_commit_load", {
    _load_id: begin.load_id,
    _filing: p.filing,
    _documents: p.documents,
    _expect: p.counts,
  });
  return "stored";
}

async function discover(cik: number) {
  const first = JSON.parse((await src.text(submissionsUrl(cik))).text) as SubmissionsFile;
  const found = listedFilings(first, cik);
  for (const page of olderPages(first))
    found.push(
      ...listedFilings(
        JSON.parse((await src.text(submissionsPageUrl(page))).text) as SubmissionsFile,
        cik,
      ),
    );
  let listed = 0;
  let known = 0;
  for (let i = 0; i < found.length; i += 500) {
    await db.gate("abs-ee");
    const r = await db.rpc<{ listed: number; known: number }>("abs_register_filings", {
      _rows: found.slice(i, i + 500),
    });
    listed += r.listed;
    known += r.known;
  }
  log(
    `cik ${cik} (${first.name ?? "?"}): ${found.length} ABS-EE filings on EDGAR, ${listed} new, ${known} already listed`,
  );
  return { found: found.length, listed };
}

const plan = async (cik: number, extra: { reparse?: boolean } = {}) => {
  const states = await db.rpc<FilingState[]>("abs_filing_states", { _list_cik: cik });
  const retry = args["retry-skipped"] === "true";
  const seen = retry
    ? states.map((s) => (s.status === "skipped" ? { ...s, status: "listed" as const } : s))
    : states;
  return {
    states,
    plan: planLoads(seen, {
      parser: PARSER,
      maxFilings: MAX_FILINGS,
      maxAttempts: MAX_ATTEMPTS,
      reparse: extra.reparse ?? args.reparse === "true",
      from: args.from,
      to: args.to,
    }),
  };
};

async function load(cik: number) {
  const { plan: p } = await plan(cik);
  const t = { stored: 0, unchanged: 0, skipped: 0, failed: 0, left: p.left };
  log(
    `cik ${cik}: ${p.todo.length} to store now, ${p.left} after this run, ${p.loaded} stored${p.stale ? ` (${p.stale} by an older reader)` : ""}, ${p.skipped} skipped, ${p.givenUp} given up`,
  );
  for (const accession of p.todo) {
    try {
      const parsed = await readFiling(cik, accession);
      if (parsed.skip !== undefined) {
        await db.rpc("abs_mark_filing", {
          _accession: accession,
          _status: "skipped",
          _detail: parsed.skip,
        });
        t.skipped++;
        log(`  ${accession} skipped: ${parsed.skip}`);
        continue;
      }
      const outcome = await storeFiling(accession, parsed);
      t[outcome]++;
      if (outcome === "stored") stored++;
      log(
        `  ${accession} ${outcome}: period ${parsed.filing.period_end ?? "?"}, ${parsed.counts.cmbs_assets} records, ${parsed.counts.cmbs_properties} properties, ${parsed.bytes} bytes`,
      );
    } catch (e) {
      t.failed++;
      const message = (e as Error).message;
      log(`  ${accession} FAILED: ${message}`);
      await db
        .rpc("abs_mark_filing", { _accession: accession, _status: "failed", _detail: message })
        .catch(() => undefined);
    }
  }
  return t;
}

/** Re-reads stored filings and compares the store with the source: same bytes, same rows, value for value. */
async function verify(cik: number) {
  const { states } = await plan(cik);
  const loaded = states
    .filter(
      (s) =>
        s.status === "loaded" &&
        (!args.from || s.filed >= args.from) &&
        (!args.to || s.filed <= args.to),
    )
    .slice(0, Number(args["max-filings"] ?? 1e9));
  const t = { checked: 0, same: 0, different: 0 };
  for (const s of loaded) {
    t.checked++;
    const have = await db.rpc<{
      parser: string;
      sha256: string;
      counts: Record<string, number>;
    } | null>("abs_filing_load", { _accession: s.accession });
    const parsed = await readFiling(cik, s.accession);
    const problems: string[] = [];
    if (!have) problems.push("no committed load");
    else if (parsed.skip !== undefined) problems.push(`the source now reads as: ${parsed.skip}`);
    else {
      if (have.sha256 !== parsed.sha256)
        problems.push(
          `source bytes changed (stored ${have.sha256.slice(0, 12)}, now ${parsed.sha256.slice(0, 12)})`,
        );
      if (have.parser !== PARSER) problems.push(`stored by ${have.parser}, this is ${PARSER}`);
      for (const kind of KINDS) {
        const rows = parsed.rows[kind] as unknown[];
        if (have.counts[kind] !== rows.length)
          problems.push(`${kind}: ${have.counts[kind]} stored, ${rows.length} in the source`);
        let off = 0;
        for (let i = 0; i < rows.length; i += CHUNK)
          off += await db.rpc<number>("abs_verify_rows", {
            _accession: s.accession,
            _kind: kind,
            _rows: rows.slice(i, i + CHUNK),
          });
        if (off) problems.push(`${kind}: ${off} rows are not stored as the source states them`);
      }
    }
    if (problems.length) {
      t.different++;
      log(`  ${s.accession} DIFFERS: ${problems.join("; ")}`);
    } else t.same++;
  }
  log(
    `cik ${cik}: ${t.checked} stored filings re-read, ${t.same} identical to the source, ${t.different} different`,
  );
  return t;
}

const runId = command === "status" ? null : await db.runStart("abs-ee");
const detail: Record<string, unknown> = { command, parser: PARSER, ciks };
let ok = true;
let items = 0;
try {
  for (const cik of ciks) {
    if (command === "discover" || command === "run")
      detail[`discover:${cik}`] = await discover(cik);
    if (command === "load" || command === "run") {
      const t = await load(cik);
      detail[`load:${cik}`] = t;
      items += t.stored;
      if (t.failed) ok = false;
    }
    if (command === "verify") {
      const t = await verify(cik);
      detail[`verify:${cik}`] = t;
      items += t.checked;
      if (t.different) ok = false;
    }
  }
  const problems = (await db.rpc<{ problem: string; bad: number | string }[]>("abs_check")).filter(
    (r) => Number(r.bad) !== 0,
  );
  const summary = await db.rpc<Record<string, unknown>>("abs_summary");
  detail.check = problems;
  log("store:", JSON.stringify(summary));
  if (problems.length) {
    ok = false;
    for (const p of problems) log(`INVARIANT BROKEN: ${p.problem}: ${p.bad}`);
  } else log("invariants: all hold");
} catch (e) {
  ok = false;
  detail.error = (e as Error).message;
  log("run failed:", (e as Error).message);
} finally {
  await db.runFinish(runId, ok, items, detail);
  await db.close();
}
process.exit(ok ? 0 : 1);
