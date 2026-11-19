/** Raw Alexandria archive only. No research-table or AI writes. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { COVERAGE } from '../src/lib/coverage';
import { args, dbGate, sb, sleep } from './lib/supa';
import contracts from './vendor/contracts.json';
import { CREDIT_PROBE_MS, MAX_ATTEMPTS, MAX_IN_FLIGHT, assertOptions, exhausted, fileKey, nextOptions, records, requestId, type Json } from './vendor/core';

const JOB = 'vendor-backfill';
const root = process.env.VENDOR_WORK_DIR ?? '/tmp/vendor-backfill';
mkdirSync(root, { recursive: true });
const owner = `${hostname()}:${process.pid}`;
const key = process.env.FIRECRAWL_API_KEY;
if (!key) throw new Error('FIRECRAWL_API_KEY is missing; vendor collector was not started');
const gateway = key.startsWith('lovc_');
const gatewayKey = process.env.LOVABLE_API_KEY;
if (gateway && !gatewayKey) throw new Error('LOVABLE_API_KEY is required for this Firecrawl connection');
const url = gateway ? 'https://connector-gateway.lovable.dev/firecrawl/v2/scrape' : 'https://api.firecrawl.dev/v2/scrape';
const catalog = new Map(contracts.map(c => [c.id, c as Json]));
const now = () => new Date().toISOString();
let stopped = false;
let creditWait: Promise<void> | null = null;
let leaseTimer: ReturnType<typeof setInterval> | undefined;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
const summary: Json = { calls: 0, credits: {}, files: 0, failures: [], companies: 0, phase: 'A' };

async function ledger(detail: Json, ok = true) {
  await dbGate(JOB);
  const r = await sb.from('job_runs').insert({ job: JOB, started_at: detail.started_at ?? now(), finished_at: now(), ok, items: detail.file ? 1 : 0, detail });
  if (r.error) throw new Error(r.error.message);
}
async function acquire() {
  await dbGate(JOB);
  const existing = await sb.from('job_state').select('*').eq('job', JOB).maybeSingle();
  if (existing.error) throw existing.error;
  const lease = new Date(Date.now() + 180000).toISOString();
  if (!existing.data) {
    const r = await sb.from('job_state').insert({ job: JOB, cursor: 0, updated_at: now(), lease_until: lease, paused_reason: `owner:${owner}` });
    if (r.error) return false;
    return true;
  }
  const r = await sb.from('job_state').update({ lease_until: lease, paused_reason: `owner:${owner}`, updated_at: now() }).eq('job', JOB).or(`lease_until.is.null,lease_until.lt.${now()}`).select('job');
  if (r.error) throw r.error;
  return !!r.data?.length;
}
async function heartbeat() {
  await dbGate(JOB);
  const r = await sb.from('job_state').update({ lease_until: new Date(Date.now()+180000).toISOString(), updated_at: now() }).eq('job', JOB).like('paused_reason', `%owner:${owner}%`).select('job');
  if (r.error || !r.data?.length) stopped = true;
}
async function remote(path: string): Promise<Json | null> {
  await dbGate(JOB);
  const r = await sb.storage.from('datasets').download(path);
  if (r.error) {
    if (/not found|does not exist|404/i.test(r.error.message)) return null;
    throw new Error(r.error.message);
  }
  return JSON.parse(await r.data.text());
}
async function save(path: string, value: Json) {
  await dbGate(JOB);
  const r = await sb.storage.from('datasets').upload(path, JSON.stringify(value), { contentType: 'application/json', upsert: false });
  if (r.error && !/already exists|duplicate/i.test(r.error.message)) throw r.error;
}
async function call(provider: string, capability: string, name: string, options: Json): Promise<Json> {
  const contract = catalog.get(`${provider}/${capability}`);
  if (!contract) throw new Error(`No reviewed contract: ${provider}/${capability}`);
  assertOptions(contract, options);
  const id = requestId(provider, capability, name, options);
  const checkpoint = join(root, `${id}.json`);
  if (existsSync(checkpoint)) return JSON.parse(readFileSync(checkpoint,'utf8'));
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !stopped; attempt++) {
    if (creditWait) await creditWait;
    await dbGate(JOB);
    const started_at = now();
    let status = 0;
    let body: Json = {};
    try {
      const headers: Record<string,string> = { 'Content-Type':'application/json', 'x-request-id':id, Authorization:`Bearer ${gateway ? gatewayKey : key}` };
      if (gateway) headers['X-Connection-Api-Key'] = key;
      const r = await fetch(url, { method:'POST', headers, body:JSON.stringify({alexandria:{provider,capability,options}}), signal:AbortSignal.timeout(150000) });
      status = r.status;
      const text = await r.text();
      try { body = JSON.parse(text); } catch { body = { error: { message: text } }; }
      const result = body.data?.alexandria?.[0];
      const credits = Number(body.creditsCost ?? result?.creditsCost ?? body.data?.creditsCost ?? 0);
      summary.calls++; summary.credits[provider] = (summary.credits[provider] ?? 0) + credits;
      await ledger({ provider, capability, name, options, request_id:id, attempt, status, credits, started_at, error:result?.error ?? body.error ?? null }, r.ok && !!result && !result.error);
      if (exhausted(status, body)) {
        if (!creditWait) creditWait = (async () => {
          await sb.from('job_state').update({ paused_reason:`credits exhausted; owner:${owner}` }).eq('job',JOB).like('paused_reason',`%owner:${owner}%`);
          // Retrying the same request every 30 minutes is the credit probe; never incur unrelated calls.
          await sleep(CREDIT_PROBE_MS);
        })().finally(() => { creditWait = null; });
        await creditWait; attempt--; continue;
      }
      if (!r.ok || !result || result.error) throw new Error(JSON.stringify(result?.error ?? body.error ?? body));
      const page = { options, fetchedAt:started_at, creditsCharged:credits, requestId:id, response:result };
      writeFileSync(checkpoint, JSON.stringify(page));
      return page;
    } catch (e) {
      const message = (e as Error).message;
      if (attempt === MAX_ATTEMPTS-1) { summary.failures.push({provider,capability,name,message}); await ledger({provider,capability,name,options,status,error:message,skipped:true},false); throw e; }
      await sleep(status === 429 ? 30000*(attempt+1) : 2000*(attempt+1));
    }
  }
  throw new Error('Collector stopping');
}
async function collect(provider: string, capability: string, name: string, options: Json, windows?: Json[]): Promise<Json | null> {
  const path = fileKey(provider,capability,name);
  const prior = await remote(path);
  if (prior) return prior;
  const contract = catalog.get(`${provider}/${capability}`);
  if (!contract) { await ledger({provider,capability,name,error:'Capability absent from catalogue',skipped:true},false); return null; }
  const pages: Json[] = [];
  try {
    for (const window of windows ?? [options]) {
      let next: Json | null = window;
      const seen = new Set<string>();
      while (next && !stopped) {
        const sig = JSON.stringify(next);
        if (seen.has(sig)) throw new Error('Provider repeated pagination cursor');
        seen.add(sig);
        const page = await call(provider,capability,name,next); pages.push(page);
        next = nextOptions(page.response,contract,next);
      }
    }
    if (stopped) return null;
    const value = { provider,capability,options,fetchedAt:now(),creditsCharged:pages.reduce((n,p)=>n+p.creditsCharged,0),pages };
    await save(path,value); summary.files++;
    await ledger({provider,capability,name,file:path,pages:pages.length,credits:value.creditsCharged});
    return value;
  } catch { return null; }
}
async function company(c: (typeof COVERAGE)[number]) {
  const profile = await collect('fiscal-ai','company/profile',c.ticker,{cik:c.cik});
  const p = profile?.pages?.[0]?.response?.data;
  const fscl = p?.companyFiscalIdentifier;
  if (fscl) {
    const capabilities = ['company/segments-and-kpis','financials/income-statement','financials/balance-sheet','financials/cash-flow-statement','financials/income-statement-as-reported','financials/balance-sheet-as-reported','financials/cash-flow-statement-as-reported','financials/adjusted-metrics','company/shares-outstanding','ratios/series','ownership/institutional-holders','ownership/insider-holders','ownership/insider-transactions','filings/list','events/ir-events','prices/daily','prices/splits'];
    for (const cap of capabilities) {
      if (stopped) return;
      const contract = catalog.get(`fiscal-ai/${cap}`);
      const names = new Set((contract?.options ?? []).map((o:Json)=>o.name));
      const options: Json = {fscl};
      if (names.has('periodType')) options.periodType = 'annual,quarterly';
      if (names.has('pageNumber')) { options.pageNumber=1; options.pageSize=250; }
      if (cap==='prices/daily') options.startDate='1996-01-01';
      const result = await collect('fiscal-ai',cap,c.ticker,options);
      if (cap==='events/ir-events' && result) {
        const events = result.pages.flatMap((page:Json)=>records(page.response,contract ?? {}));
        const transcripts: Json[] = [];
        for (const event of events) if (/transcript/i.test(String(event.resourceType ?? event.type ?? event.resourceName ?? '')) && event.resourceId) {
          try { transcripts.push(await call('fiscal-ai','events/transcript',`${c.ticker}-${event.resourceId}`,{fscl,eventKey:event.resourceId})); } catch { /* ledger keeps failure */ }
        }
        if (transcripts.length) await save(fileKey('fiscal-ai','events/transcript',c.ticker),{options:{fscl},fetchedAt:now(),creditsCharged:transcripts.reduce((n,p)=>n+p.creditsCharged,0),pages:transcripts});
      }
    }
  }
  let domain: string | undefined;
  try { domain = new URL(p?.website ?? c.website).hostname.replace(/^www\./,''); } catch { /* never fuzzy-match */ }
  if (domain) await collect('datalegion','companies/enrich-premium',c.ticker,{domain,min_confidence:'high'});
  for (const cap of ['fundamentals/company','corporate-actions/dividends','corporate-actions/splits']) await collect('eodhd',cap,c.ticker,{ticker:`${c.ticker}.US`});
  await collect('eodhd','calendar/earnings',c.ticker,{symbols:`${c.ticker}.US`,from:'1996-01-01',to:now().slice(0,10)});
  await collect('benzinga','calendar/ratings',c.ticker,{'parameters[tickers]':c.ticker,'parameters[date_from]':'1996-01-01',page:0,pagesize:1000});
  await collect('benzinga','calendar/consensus-ratings',c.ticker,{'parameters[tickers]':c.ticker,'parameters[date_from]':'1996-01-01'});
  // News retention awaits the complete withdrawal reconciliation; do not archive licensed stories prematurely.
  await ledger({ticker:c.ticker,stage:'company',completed:true,remaining:['Benzinga news + removal reconciliation','Phase B','Phase C']});
  summary.companies++;
}
async function main() {
  while (!stopped && !await acquire()) await sleep(30000);
  if (stopped) return;
  leaseTimer = setInterval(()=>{ void heartbeat().catch(()=>{stopped=true;}); },45000);
  const universe = await remote('universe.json');
  const sizes = new Map((universe?.companies ?? []).map((c:Json)=>[c.ticker,Number(c.marketCap ?? c.marketCapUsd ?? c.revenueTTM ?? c.revenueFY ?? 0)]));
  const companies = [...COVERAGE].sort((a,b)=>Number(sizes.get(b.ticker)??0)-Number(sizes.get(a.ticker)??0));
  const first = companies.slice(0,25);
  let cursor=0;
  await Promise.all(Array.from({length:MAX_IN_FLIGHT},async()=>{
    while (!stopped && cursor<first.length) { const c=first[cursor++]; try { await company(c); } catch(e) { await ledger({ticker:c.ticker,error:(e as Error).message},false); } }
  }));
  // Fail closed until all requested capabilities and retention reconciliation are implemented.
  await ledger({stage:'initial-batch',...summary,projection:Object.fromEntries(Object.entries(summary.credits).map(([p,n])=>[p,Number(n)/Math.max(1,summary.companies)*COVERAGE.length])),status:'partial implementation; full continuation not enabled'},false);
  writeFileSync(join(root,'summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));
}
try { await main(); } finally {
  if (leaseTimer) clearInterval(leaseTimer);
  await sb.from('job_state').update({lease_until:null,paused_reason:'collector initial batch only; remaining capabilities pending',updated_at:now()}).eq('job',JOB).like('paused_reason',`%owner:${owner}%`);
}