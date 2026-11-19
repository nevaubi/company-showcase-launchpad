/** Import verified originals only; inventory vendor archives without promoting uncited figures. */
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { COVERAGE } from '../src/lib/coverage';
import { dbGate, sb, selectAll } from './lib/supa';

const root = '/tmp/ir-combined';
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8')) as { archives: unknown[]; rows: { ticker: string; archive: string; entry: string; file: string; sha256: string; bytes: number; pages: number }[] };
for (const row of manifest.rows) {
  const bytes = readFileSync(row.file);
  if (bytes.length !== row.bytes || createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error(`Staging mismatch: ${row.entry}`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const ticker of ['FROG', 'COST', 'TSM']) {
  const results: Record<string, unknown>[] = [];
  const started_at = new Date().toISOString();
  for (const row of manifest.rows.filter(r => r.ticker === ticker)) {
    let result: Record<string, unknown> = { ...row };
    try {
      await dbGate('ir-upload-combined');
      const source_url = `upload://ir/${ticker}/sha256/${row.sha256}`;
      const existing = await sb.from('ir_documents').select('id,ticker,sha256,path').or(`sha256.eq.${row.sha256},source_url.eq.${source_url}`).limit(10);
      if (existing.error) throw existing.error;
      if (existing.data?.length) result = { ...result, status: 'duplicate', existing: existing.data };
      else {
        const path = `${ticker}/owner/${row.sha256}.pdf`;
        const up = await sb.storage.from('ir-documents').upload(path, readFileSync(row.file), { contentType: 'application/pdf', upsert: false });
        if (up.error) {
          const prior = await sb.storage.from('ir-documents').download(path);
          if (prior.error || !prior.data || createHash('sha256').update(new Uint8Array(await prior.data.arrayBuffer())).digest('hex') !== row.sha256) throw up.error;
        }
        if (!COVERAGE.some(c => c.ticker === ticker)) result = { ...result, status: 'archived-only', path, reason: 'Ticker not covered; identity not added automatically' };
        else {
          const label = row.entry.split('/').at(-1)?.split('__')[2] ?? '';
          const kind = /slides|presentation_material/.test(label) ? 'presentation' : /transcript/.test(label) ? 'transcript' : /release/.test(label) ? 'press-release' : 'supplement';
          // Filename dates are unverified collection labels, not filing or fiscal-period evidence.
          const insert = await sb.from('ir_documents').upsert({ ticker, source: 'ir-site', source_url, path, sha256: row.sha256, bytes: row.bytes, pages: row.pages, kind, title: row.entry.split('/').at(-1), ext: 'pdf', content_type: 'application/pdf', filed: null, period: null }, { onConflict: 'source_url', ignoreDuplicates: true }).select('id');
          if (insert.error) throw insert.error;
          result = { ...result, status: insert.data?.length ? 'stored' : 'duplicate', ids: insert.data?.map(d => d.id), path };
        }
      }
    } catch (e) { result = { ...result, status: 'failed', reason: (e as Error).message }; }
    appendFileSync(`${root}/import.jsonl`, JSON.stringify(result) + '\n');
    results.push(result);
    console.log(ticker, result.status, row.entry);
  }
  await dbGate('ir-upload-combined');
  const docs = await selectAll<any>((a,b) => sb.from('ir_documents').select('id,sha256,path,kind,extract_status,vision_status,prose_status').eq('ticker', ticker).order('id').range(a,b));
  const vendors: Record<string, unknown>[] = [];
  for (const provider of ['fiscal-ai','datalegion','eodhd','benzinga']) {
    const dirs = await sb.storage.from('datasets').list(`vendor/${provider}`, { limit: 1000 });
    if (dirs.error) throw dirs.error;
    for (const dir of dirs.data ?? []) {
      const path = `vendor/${provider}/${dir.name}/${ticker}.json`;
      const file = await sb.storage.from('datasets').download(path);
      if (file.error) {
        if (/not found|does not exist|404/i.test(file.error.message)) continue;
        throw file.error;
      }
      const value = JSON.parse(await file.data.text());
      vendors.push({ path, fetchedAt: value.fetchedAt, pages: value.pages?.length, status: 'awaiting source-coordinate verification' });
    }
  }
  const reportPath = `ops/ir-upload/combined-${stamp}-${ticker}.json`;
  const detail = { ticker, archives: manifest.archives, results, documents: docs, vendors, analysisComplete: false, blockers: ['New PDFs require evidence-only dating and coordinate-based extraction', 'Vendor metrics cannot become live facts without primary-document locators'], deletionPolicy: 'Deduplicated on import; cited originals and conflicting vintages retained' };
  const save = await sb.storage.from('datasets').upload(reportPath, JSON.stringify(detail), { contentType: 'application/json', upsert: false });
  if (save.error) throw save.error;
  const run = await sb.from('job_runs').insert({ job: 'ir-upload-import', started_at, finished_at: new Date().toISOString(), ok: !results.some(r => r.status === 'failed'), items: results.filter(r => r.status === 'stored').length, detail: { ticker, reportPath, stored: results.filter(r => r.status === 'stored').length, duplicates: results.filter(r => r.status === 'duplicate').length, archivedOnly: results.filter(r => r.status === 'archived-only').length, failed: results.filter(r => r.status === 'failed') } });
  if (run.error) throw run.error;
  console.log('TICKER REPORT', reportPath);
}