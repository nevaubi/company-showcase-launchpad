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
// again what an older reader version stored), --retry-skipped (read again the filings the scheduled job
// set aside because their file is over its size limit; no other skip: "no EX-102", "unsupported" and a
// header that does not establish one issuer are permanent), --retry-failed (store only the filings given
// up after --max-attempts, for recovery after an outage; listed filings are left to other runs),
// --max-attempts=3 (tries per filing before it is left alone), --cache=<dir> (SEC files as served;
// default .cache/sec), --offline (use only files already on disk; a listing is then the copy on disk,
// however old), --receipt=<file> (the worker passes it: what the run did, as JSON, for job_runs).
//
// When SEC throttles or is down (no answer, 403, 429, 500 and above) the filing being read is not
// marked and no attempt is counted; the batch and the run stop and the process exits 1, so the worker
// backs off. `status` prints, per watched CIK (or per --cik), the filings to do in the watch range, the
// listed filings outside it (no backlog of the worker) and every filing given up.
//
// Commercial mortgage files are stored record by record. Auto loan and auto lease files (30 to 380 MB
// each) are read in one streaming pass and stored as pool figures only; the file stays on EDGAR under
// the address, size and SHA-256 recorded with the filing.
//
// A run is safe to stop at any point and safe to run again. One filing is stored all or nothing
// (abs_begin_load, abs_put_rows, abs_commit_load); a filing this reader version already stored is not
// planned again; a filing cut off half way is started over by the next run. Rules: src/lib/abs/AGENTS.md.
// Database: the app's own (scripts/lib/supa.ts) unless ABS_DB_URL names a Postgres to prove a change on.
import {
  headerUrl,
  indexUrl,
  listedFilings,
  olderPages,
  submissionsPageUrl,
  submissionsUrl,
  type SubmissionsFile,
} from "../src/lib/abs/edgar";
import {
  fileSink,
  countReplacements,
  filingPayload,
  planFiling,
  ROW_KINDS,
  type FilingPayload,
} from "../src/lib/abs/filing";
import { PARSER } from "../src/lib/abs/metrics";
import { planLoads, type FilingState } from "../src/lib/abs/plan";
import { absWatchList } from "./lib/abs-watch-list";
import { loadFilings, type LoadTally } from "./lib/abs-load";
import { writeRunReceipt } from "./lib/run-receipt";
import { createAbsReader, declaredEncoding } from "../src/lib/abs/xml";
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
const MAX_ATTEMPTS = Number(args["max-attempts"] ?? 3);
const CHUNK = 200;

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

/** Everything one filing says, read from SEC (or the disk copy): no database involved. */
async function readFiling(cik: number, accession: string): Promise<FilingPayload> {
  const h = await src.text(headerUrl(cik, accession));
  const plan = planFiling(
    accession,
    h.text,
    h.sha256,
    (await src.text(indexUrl(cik, accession))).text,
  );
  if (plan.skip !== undefined) return plan;
  const collected = fileSink();
  const reader = createAbsReader((record) => collected.add(record, reader.shape().family));
  const file = await src.open(plan.file.url);
  let decoder: TextDecoder | null = null;
  let head: Uint8Array[] = [];
  let headBytes = 0;
  let replacements = 0;
  const feed = (text: string) => {
    replacements += countReplacements(text);
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
  return filingPayload(plan, shape, file.done(), collected, replacements);
}

const KINDS = ROW_KINDS;

async function storeFiling(
  accession: string,
  p: Exclude<FilingPayload, { skip: string }>,
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
  // the listing changes with every new filing: ask SEC again, whatever copy is on disk (offline, the copy is used)
  const first = JSON.parse(
    (await src.text(submissionsUrl(cik), { fresh: true })).text,
  ) as SubmissionsFile;
  const found = listedFilings(first, cik);
  for (const page of olderPages(first))
    found.push(
      ...listedFilings(
        JSON.parse(
          (await src.text(submissionsPageUrl(page), { fresh: true })).text,
        ) as SubmissionsFile,
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

const plan = async (cik: number, extra: { reparse?: boolean; from?: string } = {}) => {
  const states = await db.rpc<FilingState[]>("abs_filing_states", { _list_cik: cik });
  return {
    states,
    plan: planLoads(states, {
      parser: PARSER,
      maxFilings: MAX_FILINGS,
      maxAttempts: MAX_ATTEMPTS,
      reparse: extra.reparse ?? args.reparse === "true",
      retrySkipped: args["retry-skipped"] === "true",
      retryFailed: args["retry-failed"] === "true",
      from: extra.from ?? args.from,
      to: args.to,
    }),
  };
};

async function load(cik: number): Promise<LoadTally & { given_up: number }> {
  const { plan: p } = await plan(cik);
  log(
    `cik ${cik}: ${p.todo.length} to store now, ${p.left} after this run, ${p.loaded} stored${p.stale ? ` (${p.stale} by an older reader)` : ""}, ${p.skipped} skipped, ${p.givenUp} given up`,
  );
  const t = await loadFilings(p.todo, p.left, {
    read: (accession) => readFiling(cik, accession),
    store: storeFiling,
    async mark(accession, status, detail) {
      await db.rpc("abs_mark_filing", { _accession: accession, _status: status, _detail: detail });
    },
    log,
    done(accession, outcome, parsed) {
      if (outcome === "stored") stored++;
      const kept =
        parsed.filing.family === "cmbs"
          ? `${parsed.counts.cmbs_assets} records and ${parsed.counts.cmbs_properties} properties stored`
          : `${parsed.counts.records} records read, ${parsed.counts.metrics} figures stored`;
      log(
        `  ${accession} ${outcome}: ${parsed.filing.family}, period ${parsed.filing.period_end ?? "?"}, ${kept}, ${parsed.bytes} bytes`,
      );
    },
  });
  return { ...t, given_up: p.givenUp };
}

/** Per CIK: what is to do in the watch range, what is listed outside it, what was given up. */
async function backlog() {
  const watched = absWatchList();
  const list = ciks.length
    ? ciks.map((cik) => ({ cik, from: args.from ?? watched.find((w) => w.cik === cik)?.from }))
    : watched.map((w) => ({ cik: w.cik, from: args.from ?? w.from }));
  const total = { ciks: list.length, to_do: 0, outside_range: 0, given_up: 0 };
  for (const w of list) {
    await db.gate("abs-ee");
    const { plan: p } = await plan(w.cik, { from: w.from });
    const toDo = p.todo.length + p.left;
    total.to_do += toDo;
    total.outside_range += p.outOfRange;
    total.given_up += p.givenUp;
    if (toDo || p.givenUp || p.outOfRange)
      log(`cik ${w.cik} (from ${w.from ?? "the start"}): ${toDo} to do, ${p.outOfRange} listed outside the range, ${p.givenUp} given up${p.givenUp ? `: ${p.givenUpList.join(", ")}` : ""}`);
  }
  log(`backlog: ${total.to_do} filings to do in ${total.ciks} CIKs' ranges, ${total.outside_range} listed outside them (not a backlog), ${total.given_up} given up (bun scripts/abs-ee.ts load --cik=<cik> --retry-failed)`);
  return total;
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

const runId = command === "status" ? null : await db.runStart("abs-ee-script");
const detail: Record<string, unknown> = { command, parser: PARSER, ciks };
/** One line per CIK for the worker's receipt; `left` is what the worker reads to stay on a CIK. */
const perCik: Record<string, unknown>[] = [];
let ok = true;
let items = 0;
try {
  for (const cik of ciks) {
    const line: Record<string, unknown> = { cik };
    perCik.push(line);
    if (command === "discover" || command === "run") {
      const found = await discover(cik);
      detail[`discover:${cik}`] = found;
      Object.assign(line, { found: found.found, listed_new: found.listed });
    }
    if (command === "load" || command === "run") {
      const t = await load(cik);
      detail[`load:${cik}`] = t;
      Object.assign(line, t);
      items += t.stored;
      if (t.failed) ok = false;
      if (t.sec_unavailable) {
        // An outage is nobody's filing: stop here, mark nothing more, and let the caller back off.
        ok = false;
        detail.error = `SEC is throttling or down (status ${t.sec_unavailable.status || "none"}): stopped before filing ${t.sec_unavailable.accession}; no attempt counted`;
        log(detail.error);
        break;
      }
    }
    if (command === "verify") {
      const t = await verify(cik);
      detail[`verify:${cik}`] = t;
      items += t.checked;
      if (t.different) ok = false;
    }
  }
  if (command === "status") detail.backlog = await backlog();
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
  // not errors: what the filings alone do not settle, for a person to look at
  const review = await db.rpc<
    {
      what: string;
      accession: string;
      deal_id: string | null;
      period_end: string | null;
      filed: string;
    }[]
  >("abs_review");
  detail.review = review.length;
  for (const r of review.slice(0, 20))
    log(`to review: ${r.accession} (deal ${r.deal_id ?? "?"}, period ${r.period_end ?? "?"}): ${r.what}`);
  if (review.length > 20) log(`to review: ${review.length - 20} more`);
} catch (e) {
  ok = false;
  detail.error = (e as Error).message;
  log("run failed:", (e as Error).message);
} finally {
  await db.runFinish(runId, ok, items, detail);
  writeRunReceipt(args.receipt, {
    script: "abs-ee",
    command,
    parser: PARSER,
    items,
    ciks: perCik,
    ...(detail.check ? { check_problems: (detail.check as unknown[]).length } : {}),
    ...(typeof detail.review === "number" ? { review: detail.review } : {}),
    ...(typeof detail.error === "string" ? { error: detail.error } : {}),
  });
  await db.close();
}
process.exit(ok ? 0 : 1);
