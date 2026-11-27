/** Raw Alexandria archive only. No research-table or AI writes. */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { COVERAGE } from '../src/lib/coverage';
import { issuerDirectory } from '../src/lib/company/issuer-directory.server';
import { issuerLink } from '../src/lib/company/issuer-directory';
import { dbGate, sb, sleep, selectAll } from './lib/supa';
import { working } from './lib/lanes';
import contracts from './vendor/contracts.json';
import { phaseB, phaseC } from './vendor/phases';
import { isOwnerHold } from '../src/lib/jobs/lane-hold';
import { staticRegistry } from '../src/lib/alt/collect.server';
import { CREDIT_PROBE_MS, MAX_ATTEMPTS, MAX_IN_FLIGHT, assertOptions, exhausted, fileKey, nextOptions, records, requestId, PHASE_B_CALL_LIMIT, PROVIDER_PENDING_MS, PROGRESS_COMPANIES, providerPending, providerMiss, legionIdentifiers, pruneWithdrawn, PHASE_A_CREDIT_LIMIT, PHASE_C_CREDIT_LIMIT, PHASE_A_FISCAL_CAPABILITIES, pageRecords, primaryDomain, phaseACanCall, earningsBatches, earningsRecords, earningsNext, storageLedger, CreditPause, CREDIT_PAUSE_REASON, HourlyBudget, PACING_REASON, INTERRUPTED_REASON, answerKey, answerStands, answersFromLedger, checkpointIs, parseCheckpoint, phaseASummary, phaseATodo, passRestLeft, providerExpired, type Answer, type AnswerKind, type Json } from './vendor/core';

const JOB = 'vendor-backfill';
const root = process.env.VENDOR_WORK_DIR ?? '/tmp/vendor-backfill';
mkdirSync(root, { recursive: true });
const owner = `${hostname()}:${process.pid}`;
const key = process.env.FIRECRAWL_API_KEY ?? '';
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
/** The provider's answer is on file and will not change by asking again (vendor/core.ts): no call is made. */
class Unavailable extends Error {}
/** Every file in the archive, from a listing of its folders at the start: existence costs no download. */
const stored = new Set<string>();
/** Answers that stand (expired, not found, no match), by provider/capability/name. */
let answers = new Map<string, Answer>();
/** Request ids the provider will never answer again. */
const expiredIds = new Set<string>();
/** List the archive's folders (vendor/<provider>/<capability>/<name>.json); 40,000 files take about fifteen seconds. */
async function listArchive() {
  const bucket = sb.storage.from('datasets');
  const list = async (prefix: string) => {
    const out: { name: string; folder: boolean }[] = [];
    for (let offset = 0; ; offset += 1000) {
      await dbGate(JOB);
      const r = await bucket.list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (r.error) throw new Error(`archive listing ${prefix}: ${r.error.message}`);
      for (const o of r.data ?? []) out.push({ name: o.name, folder: o.id == null });
      if ((r.data ?? []).length < 1000) break;
    }
    return out;
  };
  stored.clear();
  for (const provider of await list('vendor')) {
    if (!provider.folder) continue;
    for (const capability of await list(`vendor/${provider.name}`)) {
      if (!capability.folder) continue;
      for (const f of await list(`vendor/${provider.name}/${capability.name}`)) if (!f.folder) stored.add(`vendor/${provider.name}/${capability.name}/${f.name}`);
    }
  }
  console.log(now(), 'archive listed:', stored.size, 'files');
}
/** Read the answers on file from the ledger (rows with `unavailable`). */
async function loadAnswers() {
  const rows = await selectAll<{ started_at: string; detail: Json }>((from, to) => sb.from('job_runs').select('started_at,detail').eq('job', JOB).not('detail->>unavailable', 'is', null).order('id').range(from, to));
  answers = answersFromLedger(rows);
  for (const r of rows) if (r.detail?.unavailable === 'expired' && (r.detail?.request_id ?? r.detail?.expired_request)) expiredIds.add(String(r.detail.request_id ?? r.detail.expired_request));
  console.log(now(), 'answers on file:', answers.size);
}
/** Record an answer once: one ledger row, and the collector's memory for the rest of this run. */
async function answer(kind: AnswerKind, provider: string, capability: string, name: string, extra: Json = {}) {
  const key = answerKey(provider, capability, name);
  if (answerStands(answers.get(key), Date.now()) && answers.get(key)!.kind === kind) return;
  answers.set(key, { kind, at: Date.now() });
  await ledger({ provider, capability, name, unavailable: kind, ...extra });
}
const budget = new HourlyBudget();
let pacing = false;
async function loadHourWindow() {
  const since=new Date(Date.now()-3600000).toISOString();
  const rows = await selectAll<{started_at:string,detail:Json}>((from,to) => sb.from('job_runs').select('started_at,detail').eq('job',JOB).gte('started_at',since).not('detail->>request_id','is',null).order('id').range(from,to));
  for (const r of rows) budget.add(Number(r.detail.credits ?? 0), Date.parse(r.started_at));
  console.log(now(),'hourly window seeded',budget.spent(),'of',budget.limit);
}
async function paceHourly(next: number) {
  while (!stopped && !budget.canCall(next)) {
    if (!pacing && !credit.paused) { pacing = true; await state({paused_reason:PACING_REASON}).catch(()=>{}); }
    await sleep(60000);
  }
  if (pacing) { pacing = false; if (!credit.paused) await state({paused_reason:null}).catch(()=>{}); }
}

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
  const r = await sb.from('job_runs').insert({ job: JOB, started_at: detail.started_at ?? now(), finished_at: now(), ok, items: Number(detail.records ?? (detail.file ? 1 : 0)), detail });
  if (r.error) throw new Error(r.error.message);
}
/** True while the owner holds this lane (src/lib/jobs/lane-hold.ts): no lease is taken and no call is made. */
let held = false;
const lane: { done: (() => void) | null } = { done: null };
/** How often a held collector looks again; a waiting one asks for the lease every 30 s. */
const HELD_POLL_MS = 5 * 60_000;
async function acquire() {
  await dbGate(JOB);
  const existing = await sb.from('job_state').select('*').eq('job', JOB).maybeSingle();
  if (existing.error) throw existing.error;
  if (isOwnerHold(existing.data?.paused_reason)) {
    if (!held) console.log(now(), 'held by owner, not collecting:', existing.data?.paused_reason);
    held = true;
    return false;
  }
  if (held) console.log(now(), 'owner hold released');
  held = false;
  const lease = new Date(Date.now() + 180000).toISOString();
  if (!existing.data) {
    const r = await sb.from('job_state').insert({ job: JOB, cursor: 0, updated_at: now(), lease_until: lease, paused_reason: null });
    if (r.error) return false;
  } else {
    const r = await sb.from('job_state').update({ lease_until: lease, paused_reason: existing.data.paused_reason===INTERRUPTED_REASON || existing.data.paused_reason===PACING_REASON ? null : existing.data.paused_reason, updated_at: now() }).eq('job', JOB).or(`lease_until.is.null,lease_until.lt.${now()}`).select('job');
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
  stored.add(path);
}
/** A local checkpoint that is whole, or null; a file cut off mid-write is removed so it is fetched again. */
function readCheckpoint(path: string): Json | null {
  if (!existsSync(path)) return null;
  const value = parseCheckpoint(readFileSync(path, 'utf8'));
  if (!value) rmSync(path, { force: true });
  return value;
}
/** Written beside and renamed into place, so a stop mid-write never leaves half a file under the real name. */
function writeCheckpoint(path: string, value: Json) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value));
  renameSync(`${path}.tmp`, path);
}
async function call(provider: string, capability: string, name: string, options: Json): Promise<Json> {
  const contract = catalog.get(`${provider}/${capability}`);
  if (!contract) throw new Error(`No reviewed contract: ${provider}/${capability}`);
  assertOptions(contract, options);
  const id = requestId(provider, capability, name, options);
  const checkpoint = join(root, `${id}.json`);
  const kept = readCheckpoint(checkpoint);
  if (kept) return kept;
  // The provider already said this request id will never return its data: no call.
  if (expiredIds.has(id)) throw new Unavailable('expired: the provider no longer keeps the response of this request');
  const pendingUntil=Date.now()+PROVIDER_PENDING_MS;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !stopped; attempt++) {
    if (credit.wait) await credit.wait;
    const tickers=tickerContext.getStore() ?? [];
    const reserved=Number(contract.billing?.maxCredits ?? contract.creditsCost ?? 0)/Math.max(1,tickers.length);
    const tickerLimit=summary.phase==='C'?PHASE_C_CREDIT_LIMIT:PHASE_A_CREDIT_LIMIT;
    for(const ticker of tickers) if(!phaseACanCall(tickerCredits.get(ticker) ?? 0,reserved,tickerLimit)) {
      const reason=`Phase ${summary.phase} ${tickerLimit}-credit ceiling: next call could exceed limit`;
      await ledger({ticker,phase:summary.phase,provider,capability,credits:0,spent:tickerCredits.get(ticker) ?? 0,reserved,skipped:true,error:reason},false);
      throw new TickerCreditLimit(reason);
    }
    if(summary.phase==='B' && (phaseCalls[provider] ?? 0)>=PHASE_B_CALL_LIMIT) {
      await ledger({phase:'B',provider,capability,name,skipped:'2000-call provider budget reached'},false);
      throw new Error('Phase B provider budget reached');
    }
    await paceHourly(Number(contract.billing?.maxCredits ?? contract.creditsCost ?? 0));
    if (stopped) break;
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
      budget.add(charged);
      for(const ticker of tickers) tickerCredits.set(ticker,(tickerCredits.get(ticker) ?? 0)+charged/tickers.length);
      summary.calls++; if(summary.phase==='B') phaseCalls[provider]=(phaseCalls[provider]??0)+1; summary.credits[provider] = (summary.credits[provider] ?? 0) + charged;
      const gone = providerExpired(status, body);
      const miss = !gone && providerMiss(result ?? body);
      await ledger({ provider, capability, name, tickers, options, request_id:id, attempt, status, credits:charged, records:result && !result.error ? records(result,contract).length : 0, started_at, phase:summary.phase, pending:providerPending(body), error:result?.error ?? body.error ?? null, ...(gone ? {unavailable:'expired'} : miss ? {unavailable:'not_found'} : {}) }, (r.ok && !!result && !result.error) || providerPending(body));
      if (gone) {
        // Asking again with this id can only be refused again; a new id would be a new charged call (the owner's decision).
        expiredIds.add(id);
        answers.set(answerKey(provider, capability, name), { kind: 'expired', at: Date.now() });
        throw new Unavailable('expired: the provider no longer keeps the response of this request');
      }
      if (exhausted(status, body)) {
        // Retrying the same request every 30 minutes is the credit probe; never incur unrelated calls.
        await credit.exhausted(); attempt--; continue;
      }
      if(providerPending(body)) {
        if(Date.now()>=pendingUntil) throw new Error('Provider still running after ten minutes: '+JSON.stringify(result?.error ?? body.error));
        await sleep(Math.min(15000,Math.max(0,pendingUntil-Date.now()))); attempt--; continue;
      }
      if(miss) { answers.set(answerKey(provider, capability, name), { kind: 'not_found', at: Date.now() }); return {options,fetchedAt:started_at,creditsCharged:credits,requestId:id,response:result ?? body,miss:true}; }
      if (!r.ok || !result || result.error) throw new Error(JSON.stringify(result?.error ?? body.error ?? body));
      await credit.success();
      const page = { provider, capability, options, fetchedAt:started_at, creditsCharged:credits, requestId:id, response:result };
      writeCheckpoint(checkpoint, page);
      return page;
    } catch (e) {
      if (e instanceof Unavailable) throw e;
      const message = (e as Error).message;
      if (attempt === MAX_ATTEMPTS-1 || (/Provider still running after ten minutes/.test(message))) { summary.failures.push({provider,capability,name,message}); await ledger({provider,capability,name,options,status,error:message,skipped:true},false); throw e; }
      await sleep(status === 429 ? 30000*(attempt+1) : 2000*(attempt+1));
    }
  }
  throw new Error('Collector stopping');
}
/**
 * One archive file: returned when stored, fetched when not. `need` false means the caller only wants
 * it to exist: a stored file is then not downloaded (`{stored:true}`). A request whose answer is on
 * file (expired, not found) is not asked again.
 */
async function collect(provider: string, capability: string, name: string, options: Json, windows?: Json[], need = true): Promise<Json | null> {
  const path = fileKey(provider,capability,name);
  if (stored.has(path)) {
    if (!need) return { stored: true, pages: [] };
    const prior = await remote(path);
    if (prior) return prior;
    stored.delete(path);
  }
  if (answerStands(answers.get(answerKey(provider, capability, name)), Date.now())) return null;
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
    await ledger({provider,capability,name,file:path,pages:pages.length,credits:value.creditsCharged,records:pageRecords(pages,contract)});
    return value;
  } catch(e) { if(e instanceof TickerCreditLimit) throw e; if(e instanceof Unavailable) return null; console.error(now(),provider,capability,name,(e as Error).message); return null; }
}
async function collectEarnings(companies: typeof COVERAGE) {
  const have=new Set<string>();
  for(const c of companies) if(stored.has(fileKey('eodhd','calendar/earnings',c.ticker))) have.add(c.ticker);
  for(const batch of earningsBatches(companies.map(c=>c.ticker),have,new Date())) {
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
          // Only this company's records; the batch response is not copied into every file (it was ~290 MB across 1,842 files).
          const split=pages.map(p=>({...p,response:{...p.response,data:{...(p.response.data ?? {}),earnings:earningsRecords(p.response,ticker)}},creditsCharged:p.creditsCharged/eligible.length}));
          await save(path,{provider:'eodhd',capability:'calendar/earnings',options,fetchedAt:now(),creditsCharged:split.reduce((n,p)=>n+p.creditsCharged,0),pages:split});
          summary.files++; await ledger({provider:'eodhd',capability:'calendar/earnings',ticker,file:path,pages:split.length,records:split.reduce((n,p)=>n+earningsRecords(p.response,ticker).length,0)});
        }
      } catch(e) { await ledger({provider:'eodhd',capability:'calendar/earnings',tickers:eligible,phase:'A',credits:0,error:(e as Error).message},false); }
    });
  }
}
let registry: Json = {};
async function company(c: (typeof COVERAGE)[number]) {
  // What is neither stored nor answered. A company with nothing left costs no call, no download and no ledger row,
  // which is how a restart keeps its place: it goes straight to the first company with something missing.
  const todo = phaseATodo(c.ticker, stored, answers, Date.now());
  if (todo.done) return;
  console.log(now(),'company',c.ticker);
  const profile = await collect('fiscal-ai','company/profile',c.ticker,{cik:c.cik});
  const p = profile?.pages?.[0]?.response?.data;
  const fscl = p?.companyFiscalIdentifier;
  if (fscl) {
    for (const cap of PHASE_A_FISCAL_CAPABILITIES) {
      if (stopped) return;
      // the list of IR events is read again only to fetch the transcripts it names
      const forTranscripts = cap==='events/ir-events' && todo.transcripts;
      if (!todo.fiscal.includes(cap) && !forTranscripts) continue;
      const contract = catalog.get(`fiscal-ai/${cap}`);
      const names = new Set((contract?.options ?? []).map((o:Json)=>o.name));
      const options: Json = {fscl};
      if (names.has('periodType')) options.periodType = 'annual,quarterly';
      if (names.has('pageNumber')) { options.pageNumber=1; options.pageSize=250; }
      const result = await collect('fiscal-ai',cap,c.ticker,options,undefined,forTranscripts);
      if (forTranscripts && result?.pages?.length) {
        const events = result.pages.flatMap((page:Json)=>records(page.response,contract ?? {}));
        const wanted = events.filter((event:Json)=>/transcript/i.test(String(event.resourceType ?? event.type ?? event.resourceName ?? '')) && event.resourceId);
        const transcripts: Json[] = [];
        for (const event of wanted) {
          try { transcripts.push(await call('fiscal-ai','events/transcript',`${c.ticker}-${event.resourceId}`,{fscl,eventKey:event.resourceId})); } catch(e) { if(e instanceof TickerCreditLimit) throw e; /* ledger keeps failure */ }
        }
        if (transcripts.length) await save(fileKey('fiscal-ai','events/transcript',c.ticker),{options:{fscl},fetchedAt:now(),creditsCharged:transcripts.reduce((n,p)=>n+p.creditsCharged,0),pages:transcripts});
        // The events list names no transcript: an answer, looked at again in thirty days instead of on every pass.
        else if (!wanted.length) await answer('not_found','fiscal-ai','events/transcript',c.ticker,{error:'The IR events list names no transcript'});
      }
    }
  }
  // A reviewed registrant domain controls vendor entity matching, including an explicit withheld decision.
  const eodFundamentals = todo.legion || todo.eod.includes('fundamentals/company') ? await collect('eodhd','fundamentals/company',c.ticker,{ticker:`${c.ticker}.US`},undefined,todo.legion) : null;
  if (todo.legion) {
    const general = eodFundamentals?.pages?.[0]?.response?.data?.General;
    const directory = await issuerDirectory(c.ticker, c.cik);
    const domain = primaryDomain(issuerLink(directory, "website", c.ticker, p?.website, c.website, general?.WebURL));
    const legionPath=fileKey('datalegion','companies/enrich-premium',c.ticker);
    const legal=p?.legalNameEnglish ?? registry[c.ticker]?.legal ?? p?.legalName ?? p?.companyName;
    const linkedin=p?.linkedinUrl ?? p?.linkedinURL ?? p?.socialLinks?.linkedin ?? general?.LinkedIn;
    const ids=legionIdentifiers(domain,legal,linkedin);
    let matched=false;
    let failed=false;
    for(const identifiers of ids) {
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
        summary.files++; await ledger({provider:'datalegion',ticker:c.ticker,file:legionPath,matchedIdentifier:identifiers}); matched=true; break;
      } catch(e) { if(e instanceof TickerCreditLimit) throw e; if(!(e instanceof Unavailable)) { failed=true; console.error('Data Legion',c.ticker,(e as Error).message); } }
    }
    // Every identifier was tried and none matched (or there was none to try): one answer, not a retry on every pass.
    // A call that failed for another reason leaves no answer, so the match is tried again.
    if(!matched && !failed) await answer('no_match','datalegion','companies/enrich-premium',c.ticker,{ticker:c.ticker,matched:false,error:ids.length?'No unique domain/ticker-verified match':'No website, domain or LinkedIn page to match on'});
  }
  for (const cap of ['corporate-actions/dividends','corporate-actions/splits']) if (todo.eod.includes(cap)) await collect('eodhd',cap,c.ticker,{ticker:`${c.ticker}.US`},undefined,false);
  if (todo.benzinga.includes('calendar/ratings')) await collect('benzinga','calendar/ratings',c.ticker,{'parameters[tickers]':c.ticker,'parameters[date_from]':'1996-01-01',page:0,pagesize:1000},undefined,false);
  if (todo.benzinga.includes('calendar/consensus-ratings')) await collect('benzinga','calendar/consensus-ratings',c.ticker,{'parameters[tickers]':c.ticker,'parameters[date_from]':'1996-01-01'},undefined,false);
  // Optional passes run only after the working Phase A capabilities cover the entire universe.
  await ledger({ticker:c.ticker,stage:'company',completed:true,phase:'A'});
}
// Owner, Nov 19: Benzinga news and press releases are never collected; the withdrawal clean-up covers ratings only.
async function cleanup(companies: (typeof COVERAGE)) {
  const ratings=new Set<string>();
  const stamp=now().slice(0,10);
  const v0=await collect('benzinga','calendar/removed',`withdrawals-${stamp}`,{page:0,pageSize:1000,type:'ratings'});
  if (!v0) throw new Error('Benzinga withdrawal feed unavailable; retained ratings cannot be reconciled');
  for(const p of v0.pages) for(const r of records(p.response,catalog.get('benzinga/calendar/removed') ?? {})) ratings.add(String(r.id));
  let files=0, changed=0;
  for(const c of companies) {
    if (stopped) return;
    const path=fileKey('benzinga','calendar/ratings',c.ticker);
    if(!stored.has(path)) continue;
    const v=await remote(path); if(!v) continue;
    files++;
    const clean=pruneWithdrawn(v,ratings);
    if(JSON.stringify(clean)!==JSON.stringify(v)) { await save(path,clean,true); changed++; }
  }
  // Cached raw pages are kept copies too: remove withdrawn items there before any retry can reuse them.
  // Only ratings pages are read in full (a checkpoint starts with its provider and capability), and a
  // page cut off mid-write is removed instead of ending the run: on 27 Nov 2026 one such file had
  // stopped this step on every pass ("JSON Parse error: Unexpected EOF"), so Phases B and C never began.
  let checkpoints=0, unreadable=0;
  const head=Buffer.alloc(400);
  const names=readdirSync(root).filter(f=>/^[a-f0-9]{64}\.json$/.test(f));
  for(let i=0;i<names.length;i++) {
    // the lease heartbeat and a stop signal get their turn while tens of thousands of files are checked
    if(i%500===499) await new Promise(resolve=>setImmediate(resolve));
    if (stopped) return;
    const path=join(root,names[i]);
    let start='';
    try { const fd=openSync(path,'r'); try { start=head.toString('utf8',0,readSync(fd,head,0,head.length,0)); } finally { closeSync(fd); } } catch { continue; }
    if(!checkpointIs(start,'benzinga','calendar/ratings')) continue;
    checkpoints++;
    const value=readCheckpoint(path);
    if(!value) { unreadable++; continue; }
    const clean=pruneWithdrawn(value,ratings);
    if(JSON.stringify(value)!==JSON.stringify(clean)) writeCheckpoint(path,clean);
  }
  await ledger({stage:'withdrawals-cleaned',ratings:ratings.size,files,changed,checkpoints,unreadable});
}
/**
 * `--plan`: what Phase A would still ask for, from the archive listing and the answers on file.
 * Takes no lease, makes no provider call and writes nothing.
 */
async function plan() {
  await listArchive();
  await loadAnswers();
  const s = phaseASummary(COVERAGE.map(c=>c.ticker), stored, answers, Date.now());
  const kinds: Record<string,number> = {};
  for (const a of answers.values()) if (answerStands(a, Date.now())) kinds[a.kind]=(kinds[a.kind]??0)+1;
  console.log(`Phase A: ${s.done} of ${s.companies} companies have nothing left; ${s.open} have something missing`);
  for (const [k,n] of Object.entries(s.missing).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
  console.log(`answers on file that stand: ${Object.entries(kinds).map(([k,n])=>`${n} ${k}`).join(', ') || 'none'}`);
}
/** Wait out the rest after a whole pass; looks again every five minutes so a stop signal is honoured. */
async function rest() {
  let said = false;
  while (!stopped) {
    await dbGate(JOB);
    const r = await sb.from('job_runs').select('started_at').eq('job', JOB).eq('detail->>stage', 'pass-finished').order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (r.error) throw new Error(r.error.message);
    const left = passRestLeft(r.data?.started_at, Date.now());
    if (!left) return;
    if (!said) { said = true; console.log(now(), `the last whole pass ended ${r.data?.started_at}; the next starts in ${(left / 3_600_000).toFixed(1)} h`); }
    await sleep(Math.min(left, HELD_POLL_MS));
  }
}
async function main() {
  await rest();
  while (!stopped && !await acquire()) await sleep(held ? HELD_POLL_MS : 30000);
  if (stopped) return;
  // the lane board shows the collector as running while it holds its lease
  lane.done = working(JOB);
  leaseTimer = setInterval(()=>{ void heartbeat().catch(()=>{stopped=true;}); },45000);
  const universe = await remote('universe.json');
  const sizes = new Map((universe?.companies ?? []).map((c:Json)=>[c.ticker,Number(c.marketCap ?? c.marketCapUsd ?? c.revenueTTM ?? c.revenueFY ?? 0)]));
  const companies = [...COVERAGE].sort((a,b)=>Number(sizes.get(b.ticker)??0)-Number(sizes.get(a.ticker)??0));
  registry=await remote('alt/registry.json') ?? {};
  for(const c of companies) registry[c.ticker]={...registry[c.ticker],...staticRegistry(c.ticker)};
  // What exists and what was answered, before any company is looked at.
  await listArchive();
  await loadAnswers();
  const open=phaseASummary(companies.map(c=>c.ticker),stored,answers,Date.now());
  console.log(now(),`Phase A: ${open.done} of ${open.companies} companies have nothing left`,JSON.stringify(open.missing));
  const archive={collect:(provider:string,capability:string,name:string,options:Json,need=true)=>collect(provider,capability,name,options,undefined,need),ledger,catalog,stopped:()=>stopped};
  const runCompanies=async(phase:string,fn:(c:(typeof COVERAGE)[number])=>Promise<void>)=>{
    summary.phase=phase;summary.companies=0;let cursor=0;
    await ledger({stage:'phase-started',phase,companies:companies.length});
    await Promise.all(Array.from({length:MAX_IN_FLIGHT},async()=>{
      while(!stopped && cursor<companies.length) {
        const c=companies[cursor++];
        try {await tickerContext.run(phase.startsWith('A')||phase==='C'?[c.ticker]:[],()=>fn(c));} catch(e) {await ledger({ticker:c.ticker,phase,error:(e as Error).message},false);}
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
  await loadHourWindow();
  await collectEarnings(companies);
  await runCompanies('A',company);
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
  // A whole pass: the collector rests (PASS_REST_MS) instead of starting over thirty seconds later.
  if(!stopped) await ledger({stage:'pass-finished',...JSON.parse(JSON.stringify(summary))});
  writeFileSync(join(root,'summary.json'),JSON.stringify(summary,null,2));
  console.log(now(),JSON.stringify(summary));
}
if (process.argv.includes('--plan')) { await plan(); process.exit(0); }
try { await main(); } finally {
  lane.done?.();
  if (leaseTimer) clearInterval(leaseTimer);
  if(leaseUntil) await state({lease_until:null,paused_reason:stopped?INTERRUPTED_REASON:credit.paused?CREDIT_PAUSE_REASON:null});
}
