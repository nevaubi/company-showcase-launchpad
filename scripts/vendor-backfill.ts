/** Raw Alexandria archive only. No research-table or AI writes. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { COVERAGE } from '../src/lib/coverage';
import { dbGate, sb, sleep, selectAll } from './lib/supa';
import contracts from './vendor/contracts.json';
import { phaseB, phaseC } from './vendor/phases';
import { staticRegistry } from '../src/lib/alt/collect.server';
import { CREDIT_PROBE_MS, MAX_ATTEMPTS, MAX_IN_FLIGHT, assertOptions, exhausted, fileKey, nextOptions, records, requestId, PHASE_B_CALL_LIMIT, PROVIDER_PENDING_MS, PROGRESS_COMPANIES, providerPending, providerMiss, legionIdentifiers, pruneWithdrawn, PHASE_A_CREDIT_LIMIT, PHASE_A_FISCAL_CAPABILITIES, phaseACanCall, earningsBatches, earningsRecords, earningsNext, storageLedger, CreditPause, CREDIT_PAUSE_REASON, type Json } from './vendor/core';

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
const credit = new CreditPause((reason) => state({ paused_reason: reason }), sleep);
let leaseTimer: ReturnType<typeof setInterval> | undefined;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
let leaseUntil: string | null = null;
let stateQueue: Promise<unknown> = Promise.resolve();
const phaseCalls: Record<string,number> = {};
const summary: Json = { calls: 0, credits: {}, files: 0, failures: [], companies: 0, phase: 'A' };
const tickerContext = new AsyncLocalStorage<string[]>();
const tickerCredits = new Map<string,number>();
const billedRequests = new Map<string,number>();
class TickerCreditLimit extends Error {}

async function loadTickerCredits() {
  const rows = await selectAll<{detail:Json}>((from,to) => {
    return sb.from('job_runs').select('detail').eq('job',JOB).in('detail->>phase',['A','A-news']).not('detail->>request_id','is',null).order('id').range(from,to);
  });
  for (const {detail:d} of rows) {
    const previous=billedRequests.get(d.request_id) ?? 0;
    const charged=Math.max(0,Number(d.credits ?? 0)-previous);
    billedRequests.set(d.request_id,Math.max(previous,Number(d.credits ?? 0)));
    const matched=COVERAGE.find(c=>d.name===c.ticker || String(d.name).startsWith(`${c.ticker}-`))?.ticker;
    const tickers: string[]=d.tickers ?? (matched?[matched]:[]);
    for(const t of tickers) tickerCredits.set(t,(tickerCredits.get(t) ?? 0)+charged/tickers.length);
  }
}

async function ledger(detail: Json, ok = true) {
  if (detail.file) detail=storageLedger(detail);
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
    const r = await sb.from('job_state').insert({ job: JOB, cursor: 0, updated_at: now(), lease_until: lease, paused_reason: null });
    if (r.error) return false;
  } else {
    const r = await sb.from('job_state').update({ lease_until: lease, paused_reason: existing.data.paused_reason, updated_at: now() }).eq('job', JOB).or(`lease_until.is.null,lease_until.lt.${now()}`).select('job');
    if (r.error) throw r.error;
    if (!r.data?.length) return false;
  }
  leaseUntil=lease;
  if(existing.data?.paused_reason===CREDIT_PAUSE_REASON) credit.resume();
  console.log(now(), 'lease acquired', owner);
  await ledger({stage:'lease-acquired',owner});
  return true;
}
async function state(patch: Json, renew=false) {
  stateQueue=stateQueue.then(async()=>{
    if (!leaseUntil) return;
    await dbGate(JOB);
    const next=renew?new Date(Date.now()+180000).toISOString():leaseUntil;
    const r=await sb.from('job_state').update({...patch,...(renew?{lease_until:next}:{}),updated_at:now()}).eq('job',JOB).eq('lease_until',leaseUntil).select('job');
    if(r.error || !r.data?.length) { stopped=true; throw new Error('Vendor lease lost'); }
    leaseUntil=next;
  });
  return stateQueue;
}
async function heartbeat() { await state({},true); }
async function remote(path: string): Promise<Json | null> {
  await dbGate(JOB);
  const r = await sb.storage.from('datasets').download(path);
  if (r.error) {
    if (/not found|does not exist|404/i.test(r.error.message)) return null;
    throw new Error(r.error.message);
  }
  return JSON.parse(await r.data.text());
}
async function save(path: string, value: Json, replace=false) {
  await dbGate(JOB);
  const r = await sb.storage.from('datasets').upload(path, JSON.stringify(value), { contentType: 'application/json', upsert: replace });
  if (r.error && !/already exists|duplicate/i.test(r.error.message)) throw r.error;
}
async function call(provider: string, capability: string, name: string, options: Json): Promise<Json> {
  const contract = catalog.get(`${provider}/${capability}`);
  if (!contract) throw new Error(`No reviewed contract: ${provider}/${capability}`);
  assertOptions(contract, options);
  const id = requestId(provider, capability, name, options);
  const checkpoint = join(root, `${id}.json`);
  if (existsSync(checkpoint)) return JSON.parse(readFileSync(checkpoint,'utf8'));
  const pendingUntil=Date.now()+PROVIDER_PENDING_MS;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !stopped; attempt++) {
    if (credit.wait) await credit.wait;
    const tickers=tickerContext.getStore() ?? [];
    const reserved=Number(contract.billing?.maxCredits ?? contract.creditsCost ?? 0)/Math.max(1,tickers.length);
    for(const ticker of tickers) if(!phaseACanCall(tickerCredits.get(ticker) ?? 0,reserved)) {
      const reason=`Phase A ${PHASE_A_CREDIT_LIMIT}-credit ceiling: next call could exceed limit`;
      await ledger({ticker,phase:summary.phase,provider,capability,credits:0,spent:tickerCredits.get(ticker) ?? 0,reserved,skipped:true,error:reason},false);
      throw new TickerCreditLimit(reason);
    }
    if(summary.phase==='B' && (phaseCalls[provider] ?? 0)>=PHASE_B_CALL_LIMIT) {
      await ledger({phase:'B',provider,capability,name,skipped:'2000-call provider budget reached'},false);
      throw new Error('Phase B provider budget reached');
    }
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
      const previous=billedRequests.get(id) ?? 0;
      const charged=Math.max(0,credits-previous);
      billedRequests.set(id,Math.max(previous,credits));
      for(const ticker of tickers) tickerCredits.set(ticker,(tickerCredits.get(ticker) ?? 0)+charged/tickers.length);
      summary.calls++; if(summary.phase==='B') phaseCalls[provider]=(phaseCalls[provider]??0)+1; summary.credits[provider] = (summary.credits[provider] ?? 0) + charged;
      await ledger({ provider, capability, name, tickers, options, request_id:id, attempt, status, credits:charged, started_at, phase:summary.phase, pending:providerPending(body), error:result?.error ?? body.error ?? null }, (r.ok && !!result && !result.error) || providerPending(body));
      if (exhausted(status, body)) {
        // Retrying the same request every 30 minutes is the credit probe; never incur unrelated calls.
        await credit.exhausted(); attempt--; continue;
      }
      if(providerPending(body)) {
        if(Date.now()>=pendingUntil) throw new Error('Provider still running after ten minutes: '+JSON.stringify(result?.error ?? body.error));
        await sleep(Math.min(15000,Math.max(0,pendingUntil-Date.now()))); attempt--; continue;
      }
      if(providerMiss(result ?? body)) return {options,fetchedAt:started_at,creditsCharged:credits,requestId:id,response:result ?? body,miss:true};
      if (!r.ok || !result || result.error) throw new Error(JSON.stringify(result?.error ?? body.error ?? body));
      await credit.success();
      const page = { provider, capability, options, fetchedAt:started_at, creditsCharged:credits, requestId:id, response:result };
      writeFileSync(checkpoint, JSON.stringify(page));
      return page;
    } catch (e) {
      const message = (e as Error).message;
      if (attempt === MAX_ATTEMPTS-1 || (/Provider still running after ten minutes/.test(message))) { summary.failures.push({provider,capability,name,message}); await ledger({provider,capability,name,options,status,error:message,skipped:true},false); throw e; }
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
        const page = await call(provider,capability,name,next); if(page.miss) return null; pages.push(page);
        next = nextOptions(page.response,contract,next);
      }
    }
    if (stopped) return null;
    const value = { provider,capability,options,fetchedAt:now(),creditsCharged:pages.reduce((n,p)=>n+p.creditsCharged,0),pages };
    await save(path,value); summary.files++;
    await ledger({provider,capability,name,file:path,pages:pages.length,credits:value.creditsCharged});
    return value;
  } catch(e) { if(e instanceof TickerCreditLimit) throw e; console.error(now(),provider,capability,name,(e as Error).message); return null; }
}
async function collectEarnings(companies: typeof COVERAGE) {
  const stored=new Set<string>();
  for(const c of companies) if(await remote(fileKey('eodhd','calendar/earnings',c.ticker))) stored.add(c.ticker);
  for(const batch of earningsBatches(companies.map(c=>c.ticker),stored,new Date())) {
    if(stopped) return;
    const eligible=batch.tickers.filter(t=>phaseACanCall(tickerCredits.get(t) ?? 0,100/batch.tickers.length));
    for(const t of batch.tickers.filter(t=>!eligible.includes(t))) await ledger({ticker:t,phase:'A',credits:0,skipped:true,error:'Phase A 1500-credit ceiling: earnings reservation would exceed limit'},false);
    if(!eligible.length) continue;
    await tickerContext.run(eligible,async()=>{
      const options={...batch.options,symbols:eligible.map(t=>`${t}.US`).join(',')};
      const pages: Json[]=[];
      let next: Json | null=options;
      const seen=new Set<string>();
      try {
        while(next && !stopped) {
          const sig=JSON.stringify(next); if(seen.has(sig)) throw new Error('Provider repeated earnings cursor'); seen.add(sig);
          const page=await call('eodhd','calendar/earnings',eligible.join(','),next);
          if(page.miss) return;
          pages.push(page);
          next=earningsNext(page.response,catalog.get('eodhd/calendar/earnings') ?? {},next);
        }
        if(stopped) return;
        for(const ticker of eligible) {
          const path=fileKey('eodhd','calendar/earnings',ticker);
          const split=pages.map(p=>({...p,sharedResponse:p.response,response:{...p.response,data:{...(p.response.data ?? {}),earnings:earningsRecords(p.response,ticker)}},creditsCharged:p.creditsCharged/eligible.length}));
          await save(path,{provider:'eodhd',capability:'calendar/earnings',options,fetchedAt:now(),creditsCharged:split.reduce((n,p)=>n+p.creditsCharged,0),pages:split});
          summary.files++; await ledger({provider:'eodhd',capability:'calendar/earnings',ticker,file:path,pages:split.length});
        }
      } catch(e) { await ledger({provider:'eodhd',capability:'calendar/earnings',tickers:eligible,phase:'A',credits:0,error:(e as Error).message},false); }
    });
  }
}
let registry: Json = {};
async function company(c: (typeof COVERAGE)[number]) {
  console.log(now(),'company',c.ticker);
  const profile = await collect('fiscal-ai','company/profile',c.ticker,{cik:c.cik});
  const p = profile?.pages?.[0]?.response?.data;
  const fscl = p?.companyFiscalIdentifier;
  if (fscl) {
    for (const cap of PHASE_A_FISCAL_CAPABILITIES) {
      if (stopped) return;
      const contract = catalog.get(`fiscal-ai/${cap}`);
      const names = new Set((contract?.options ?? []).map((o:Json)=>o.name));
      const options: Json = {fscl};
      if (names.has('periodType')) options.periodType = 'annual,quarterly';
      if (names.has('pageNumber')) { options.pageNumber=1; options.pageSize=250; }
      const result = await collect('fiscal-ai',cap,c.ticker,options);
      if (cap==='events/ir-events' && result) {
        const events = result.pages.flatMap((page:Json)=>records(page.response,contract ?? {}));
        const transcripts: Json[] = [];
        for (const event of events) if (/transcript/i.test(String(event.resourceType ?? event.type ?? event.resourceName ?? '')) && event.resourceId) {
          try { transcripts.push(await call('fiscal-ai','events/transcript',`${c.ticker}-${event.resourceId}`,{fscl,eventKey:event.resourceId})); } catch(e) { if(e instanceof TickerCreditLimit) throw e; /* ledger keeps failure */ }
        }
        if (transcripts.length) await save(fileKey('fiscal-ai','events/transcript',c.ticker),{options:{fscl},fetchedAt:now(),creditsCharged:transcripts.reduce((n,p)=>n+p.creditsCharged,0),pages:transcripts});
      }
    }
  }
  let domain: string | undefined;
  try { domain = new URL(p?.website ?? c.website).hostname.replace(/^www\./,''); } catch { /* never fuzzy-match */ }
  const legionPath=fileKey('datalegion','companies/enrich-premium',c.ticker);
  if (!await remote(legionPath)) {
    const legal=registry[c.ticker]?.legal ?? p?.legalName ?? p?.companyName;
    const linkedin=p?.linkedinUrl ?? p?.linkedinURL ?? p?.socialLinks?.linkedin;
    for(const identifiers of legionIdentifiers(domain,legal,linkedin)) {
      try {
        const page=await call('datalegion','companies/enrich-premium',c.ticker,identifiers);
        const matches=records(page.response,catalog.get('datalegion/companies/enrich-premium') ?? {});
        if(page.miss || !matches.length) { await ledger({provider:'datalegion',ticker:c.ticker,identifier:identifiers,matched:false}); continue; }
        const match=matches.length===1?matches[0]:null;
        const tickers=match?.company?.tickers ?? [];
        const domains=[match?.company?.domain,...(match?.company?.domains ?? []).map((d:Json)=>d.domain)];
        if (!match || !(tickers.some((t:Json)=>t.symbol===c.ticker) || (domain && domains.includes(domain)))) {
          await ledger({provider:'datalegion',ticker:c.ticker,identifier:identifiers,matched:false,error:'No unique domain/ticker-verified match'},false); continue;
        }
        await save(legionPath,{provider:'datalegion',capability:'companies/enrich-premium',options:identifiers,matchedIdentifier:identifiers,fetchedAt:now(),creditsCharged:page.creditsCharged,pages:[page]});
        summary.files++; await ledger({provider:'datalegion',ticker:c.ticker,file:legionPath,matchedIdentifier:identifiers}); break;
      } catch(e) { if(e instanceof TickerCreditLimit) throw e; console.error('Data Legion',c.ticker,(e as Error).message); }
    }
  }
  for (const cap of ['fundamentals/company','corporate-actions/dividends','corporate-actions/splits']) await collect('eodhd',cap,c.ticker,{ticker:`${c.ticker}.US`});
  await collect('benzinga','calendar/ratings',c.ticker,{'parameters[tickers]':c.ticker,'parameters[date_from]':'1996-01-01',page:0,pagesize:1000});
  await collect('benzinga','calendar/consensus-ratings',c.ticker,{'parameters[tickers]':c.ticker,'parameters[date_from]':'1996-01-01'});
  // Optional passes run only after the working Phase A capabilities cover the entire universe.
  await ledger({ticker:c.ticker,stage:'company',completed:true,phase:'A'});
}
async function news(c: (typeof COVERAGE)[number]) {
  for(const cap of ['news/press-releases','news/search']) await collect('benzinga',cap,c.ticker,{tickers:c.ticker,dateFrom:'1996-01-01',dateTo:now().slice(0,10),displayOutput:'full',page:0,pageSize:100,sort:'created:asc'});
}
async function cleanup(companies: (typeof COVERAGE)) {
  const ids={news:new Set<string>(),ratings:new Set<string>()};
  const stamp=now().slice(0,10);
  for(const [cap,kind,options] of [['news/removed','news',{page:0,pageSize:1000}],['calendar/removed','ratings',{page:0,pageSize:1000,type:'ratings'}]] as const) {
    const v=await collect('benzinga',cap,`withdrawals-${stamp}`,options);
    if (!v) throw new Error('Benzinga withdrawal feed unavailable; retained news cannot be reconciled');
    for(const p of v.pages) for(const r of records(p.response,catalog.get(`benzinga/${cap}`) ?? {})) ids[kind].add(String(r.id));
  }
  for(const c of companies) for(const cap of ['news/press-releases','news/search','calendar/ratings']) {
    const path=fileKey('benzinga',cap,c.ticker); const v=await remote(path); if(!v) continue;
    const clean=pruneWithdrawn(v,cap.startsWith('news/')?ids.news:ids.ratings);
    if(JSON.stringify(clean)!==JSON.stringify(v)) await save(path,clean,true);
  }
  // Cached raw pages are kept copies too: remove withdrawn items there before any retry can reuse them.
  const {readdirSync}=await import('node:fs');
  for(const f of readdirSync(root).filter(f=>/^[a-f0-9]{64}\.json$/.test(f))) {
    const path=join(root,f);const value=JSON.parse(readFileSync(path,'utf8'));
    if(value.provider!=='benzinga') continue;
    const clean=pruneWithdrawn(value,value.capability==='calendar/ratings'?ids.ratings:ids.news);
    if(JSON.stringify(value)!==JSON.stringify(clean)) writeFileSync(path,JSON.stringify(clean));
  }
  await ledger({stage:'withdrawals-cleaned',news:ids.news.size,ratings:ids.ratings.size});
}
async function main() {
  while (!stopped && !await acquire()) await sleep(30000);
  if (stopped) return;
  leaseTimer = setInterval(()=>{ void heartbeat().catch(()=>{stopped=true;}); },45000);
  const universe = await remote('universe.json');
  const sizes = new Map((universe?.companies ?? []).map((c:Json)=>[c.ticker,Number(c.marketCap ?? c.marketCapUsd ?? c.revenueTTM ?? c.revenueFY ?? 0)]));
  const companies = [...COVERAGE].sort((a,b)=>Number(sizes.get(b.ticker)??0)-Number(sizes.get(a.ticker)??0));
  registry=await remote('alt/registry.json') ?? {};
  for(const c of companies) registry[c.ticker]={...registry[c.ticker],...staticRegistry(c.ticker)};
  const archive={collect,ledger,catalog,stopped:()=>stopped};
  const runCompanies=async(phase:string,fn:(c:(typeof COVERAGE)[number])=>Promise<void>)=>{
    summary.phase=phase;summary.companies=0;let cursor=0;
    await ledger({stage:'phase-started',phase,companies:companies.length});
    await Promise.all(Array.from({length:MAX_IN_FLIGHT},async()=>{
      while(!stopped && cursor<companies.length) {
        const c=companies[cursor++];
        try {await tickerContext.run(phase.startsWith('A')?[c.ticker]:[],()=>fn(c));} catch(e) {await ledger({ticker:c.ticker,phase,error:(e as Error).message},false);}
        summary.companies++;
        if(summary.companies%PROGRESS_COMPANIES===0) {
          await ledger({stage:'progress',companies_done:summary.companies,...JSON.parse(JSON.stringify(summary))});
          await state({cursor:summary.companies});
          writeFileSync(join(root,'summary.json'),JSON.stringify(summary,null,2));
        }
      }
    }));
    await ledger({stage:stopped?'phase-interrupted':'phase-finished',...summary});
  };
  await dbGate(JOB);
  await loadTickerCredits();
  await collectEarnings(companies);
  await runCompanies('A',company);
  if(!stopped) await runCompanies('A-news',async c=>{await news(c);await cleanup([c]);});
  if(!stopped) await cleanup(companies);
  if(!stopped) {
    summary.phase='B';
    // Budget survives workspace/Render handover, using the persisted per-call ledger.
    for(const provider of new Set(contracts.map(c=>c.provider))) {
      await dbGate(JOB);
      const r=await sb.from('job_runs').select('id',{count:'exact',head:true}).eq('job',JOB).eq('detail->>phase','B').eq('detail->>provider',provider).not('detail->>request_id','is',null);
      if(r.error) throw r.error;phaseCalls[provider]=r.count ?? 0;
    }
    await phaseB(archive);
  }
  if(!stopped) {
    const names=new Map<string,number>();
    for(const c of companies) {const n=String(registry[c.ticker]?.legal ?? '').toLowerCase();names.set(n,(names.get(n)??0)+1);}
    await runCompanies('C',c=>phaseC(archive,c,registry[c.ticker] ?? {},names.get(String(registry[c.ticker]?.legal ?? '').toLowerCase())===1));
  }
  if(!stopped) await cleanup(companies);
  writeFileSync(join(root,'summary.json'),JSON.stringify(summary,null,2));
  console.log(now(),JSON.stringify(summary));
}
try { await main(); } finally {
  if (leaseTimer) clearInterval(leaseTimer);
  if(leaseUntil) await state({lease_until:null,paused_reason:stopped?'collector interrupted; resume from existing files':credit.paused?CREDIT_PAUSE_REASON:null});
}
