/** Additive Nov 19 owner manifest import. Run only against fully verified staging. */
import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { args, sb, dbGate, sleep } from './lib/supa';

const root = String(args.root ?? '/tmp/ir-owner-import');
const rows = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Record<string, string>[];
const allowed = new Set(['CME', 'EFC', 'OWL', 'SPCX', 'ZM', 'WDC']);
const ledger = join(root, 'import-ledger.jsonl');
if (!existsSync(ledger)) writeFileSync(ledger, '');
const prior = readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s));
const done = new Set(prior.filter(r => r.status !== 'failed').map(r => r.sha256));
const fiscal: Record<string, number> = { CME: 12, EFC: 12, OWL: 12, SPCX: 12, ZM: 1 };
function period(r: Record<string, string>): string | null {
  const match = /^Q([1-4]) FY(\d{2}|\d{4})$/.exec(r.fiscal_period);
  const month = fiscal[r.ticker];
  if (!match || !month) return null; // WDC uses a week-based fiscal calendar; do not guess.
  const year = Number(match[2]) + (match[2].length === 2 ? 2000 : 0);
  return new Date(Date.UTC(year, month - (4 - Number(match[1])) * 3, 0)).toISOString().slice(0, 10);
}
// Revalidate all bytes before the first remote write.
for (const r of rows) {
  const b = readFileSync(join(root, r.file));
  if (b.length !== Number(r.bytes) || createHash('sha256').update(b).digest('hex') !== r.sha256) throw new Error(`Invalid staged PDF: ${r.file}`);
}
for (const r of rows) {
  if (done.has(r.sha256)) continue;
  const source_url = `upload://ir/${r.ticker}/${r.vendor_id}/${basename(r.file)}`;
  const path = `${r.ticker}/site/${r.sha256.slice(0, 12)}.pdf`;
  let result: Record<string, unknown> = { ticker: r.ticker, file: r.file, sha256: r.sha256, source_url, path, kind: r.kind, bytes: Number(r.bytes) };
  try {
    if (!allowed.has(r.ticker)) result = { ...result, status: 'excluded', reason: 'Not covered; existing expansion script rebuilds the whole partner universe, not a bounded ticker addition.' };
    else {
      await dbGate('owner-import');
      const { data, error } = await sb.from('ir_documents').select('id,sha256,source_url').or(`sha256.eq.${r.sha256},source_url.eq.${source_url}`).limit(2);
      if (error) throw error;
      if (data?.length) result = { ...result, status: 'skipped', existing: data };
      else {
        const buf = readFileSync(join(root, r.file));
        await dbGate('owner-upload');
        const up = await sb.storage.from('ir-documents').upload(path, buf, { contentType: 'application/pdf', upsert: false });
        if (up.error && !/already exists|duplicate/i.test(up.error.message)) throw up.error;
        if (up.error) {
          const copy = await sb.storage.from('ir-documents').download(path);
          if (copy.error || !copy.data || createHash('sha256').update(new Uint8Array(await copy.data.arrayBuffer())).digest('hex') !== r.sha256) throw new Error('Existing storage object differs; left untouched');
        }
        await dbGate('owner-row');
        const insert = await sb.from('ir_documents').upsert({ ticker: r.ticker, source: 'ir-site', source_url, kind: r.kind, title: r.title, filed: r.filed || null, period: period(r), content_type: 'application/pdf', ext: 'pdf', bytes: Number(r.bytes), sha256: r.sha256, pages: Number(r.pages), path, fetched_at: new Date().toISOString() }, { onConflict: 'source_url', ignoreDuplicates: true }).select('id');
        if (insert.error) throw insert.error;
        result = { ...result, status: insert.data?.length ? 'stored' : 'skipped', id: insert.data?.[0]?.id, storage_bytes_added: up.error ? 0 : buf.length, period: period(r) };
      }
    }
  } catch (e) { result = { ...result, status: 'failed', reason: (e as Error).message }; }
  appendFileSync(ledger, JSON.stringify(result) + '\n');
  console.log(r.ticker, result.status, r.file, result.reason ?? '');
  await sleep(20);
}
console.log('Import finished; exact added IDs and counts are in', ledger);