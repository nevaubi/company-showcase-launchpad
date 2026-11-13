/**
 * Import a hand-collected IR file set (manifest CSV + unpacked files) into ir_documents/ir-documents.
 *   bun scripts/ir-import-manifest.ts --ticker=HOOD --manifest=/path/MANIFEST.csv --root=/path/unpacked
 * Files are matched by sha256 under --root; a missing/mismatched file is refetched from its url.
 * source_url = the original investor-site url, so dedupe is by url (upsert) and nothing is duplicated.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { args, dbGate, log, sb } from "./lib/supa";

const T = String(args.ticker).toUpperCase();
const BUCKET = "ir-documents";

function parseCsv(s: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (ch !== "\r") f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...b] = rows; return b.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const byHash = new Map<string, string>();
(function walk(d: string) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else byHash.set(sha(readFileSync(p)), p); } })(String(args.root));

/** Category → IR kind. SEC originals/10-Q PDFs are stored as sec-copy (not re-read; XBRL covers them). */
function kindOf(cat: string, ext: string): string {
  if (/SEC|10-Q/.test(cat)) return "sec-copy";
  if (/Annual/.test(cat)) return "annual-report";
  if (/Transcript/.test(cat)) return "transcript";
  if (/Presentation|Dashboard/.test(cat)) return "presentation";
  if (/Supplemental Information/.test(cat)) return "supplement";
  if (/Press Release/.test(cat)) return "press-release";
  if (/Excel/.test(cat) || /^xlsx?$/.test(ext)) return "data";
  if (/Monthly Metrics PDF/.test(cat)) return "data";
  return "other";
}
const end = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

const rows = parseCsv(readFileSync(String(args.manifest), "utf8"));
let stored = 0, refetched = 0, failed = 0;
for (const r of rows) {
  await dbGate("import");
  let buf: Uint8Array | null = byHash.has(r.sha256) ? new Uint8Array(readFileSync(byHash.get(r.sha256)!)) : null;
  if (!buf) {
    const res = await fetch(r.url, { headers: { "User-Agent": "Mozilla/5.0 FiledUnder research contact@filedunder.ai" } });
    if (res.ok) { buf = new Uint8Array(await res.arrayBuffer()); refetched++; }
  }
  if (!buf) { failed++; log("missing", r.title); continue; }
  const ext = (r.title.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? r.path.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? "bin").toLowerCase();
  const hash = sha(buf);
  const y = Number(r.year), m = Number(r.month), q = Number(r.quarter);
  const period = m ? end(y, m) : q ? end(y, q * 3) : null;
  const path = `${T}/site/${hash.slice(0, 12)}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: r.type || "application/octet-stream", upsert: true });
  if (up.error) { failed++; log("upload", r.title, up.error.message); continue; }
  const label = m ? `${r.category} ${y}-${String(m).padStart(2, "0")}` : q ? `${r.category} Q${q} ${y}` : r.category;
  const { error } = await sb.from("ir_documents").upsert({
    ticker: T, source: "ir-site", source_url: r.url, kind: kindOf(r.category, ext), title: label,
    period, content_type: r.type, ext, bytes: buf.byteLength, sha256: hash, path, fetched_at: new Date().toISOString(),
  }, { onConflict: "source_url" });
  if (error) { failed++; log("row", r.title, error.message); continue; }
  stored++;
}
log(`import ${T}: stored ${stored}/${rows.length}, refetched ${refetched}, failed ${failed}`);
