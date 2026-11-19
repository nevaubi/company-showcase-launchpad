// One-off: rewrite datasets/vendor/eodhd/calendar__earnings/<T>.json in place keeping only that
// company's records plus request metadata (drops the duplicated batch `sharedResponse`). A file is
// rewritten only when its record count is unchanged; results go to job_runs `vendor-earnings-compact`.
//   bun scripts/vendor-earnings-compact.ts [--dry]
import { args, log, sb } from "./lib/supa";
import { compactEarningsFile } from "./vendor/core";

const B = sb.storage.from("datasets");
const DIR = "vendor/eodhd/calendar__earnings";
const names: string[] = [];
for (let off = 0; ; off += 1000) {
  const { data } = await B.list(DIR, { limit: 1000, offset: off });
  names.push(...(data ?? []).map((d) => d.name));
  if (!data || data.length < 1000) break;
}
let before = 0, after = 0, rewritten = 0, unchanged = 0;
const mismatch: string[] = [], failed: string[] = [];
const queue = [...names];
await Promise.all(Array.from({ length: 8 }, async () => {
  for (let n = queue.shift(); n; n = queue.shift()) {
    try {
      const { data } = await B.download(`${DIR}/${n}`);
      const text = await data!.text();
      const v = JSON.parse(text);
      const r = compactEarningsFile(v);
      before += text.length;
      if (!r.changed) { after += text.length; unchanged++; continue; }
      if (r.recordsBefore !== r.recordsAfter) { mismatch.push(n); after += text.length; continue; }
      const out = JSON.stringify(r.value);
      if (!("dry" in args)) {
        const { error } = await B.upload(`${DIR}/${n}`, out, { upsert: true, contentType: "application/json" });
        if (error) throw error;
      }
      after += out.length; rewritten++;
    } catch (e) { failed.push(`${n}: ${(e as Error).message.slice(0, 60)}`); }
  }
}));
const detail = { files: names.length, rewritten, unchanged, mismatch, failed, bytesBefore: before, bytesAfter: after, saved: before - after, dry: "dry" in args };
await sb.from("job_runs").insert({ job: "vendor-earnings-compact", started_at: new Date().toISOString(), finished_at: new Date().toISOString(), ok: !mismatch.length && !failed.length, items: rewritten, detail });
log(JSON.stringify(detail));
process.exit(0);
