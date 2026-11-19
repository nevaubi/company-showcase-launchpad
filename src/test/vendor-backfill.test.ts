import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CUT_FISCAL_CAPABILITIES, HourlyBudget, MAX_CREDITS_PER_HOUR, hourlyCreditLimit } from '../../scripts/vendor/core';
import { compactEarningsFile, earningsBatches, earningsRecords, earningsNext, phaseACanCall, PHASE_A_FISCAL_CAPABILITIES, storageLedger } from '../../scripts/vendor/core';
import { CREDIT_PROBE_MS, MAX_ATTEMPTS, MAX_IN_FLIGHT, PHASE_B_CALL_LIMIT, PROVIDER_PENDING_MS, PROGRESS_COMPANIES, providerPending, providerMiss, legionIdentifiers, primaryDomain, pageRecords, assertOptions, exhausted, fileKey, nextOptions, pruneWithdrawn, requestId } from '../../scripts/vendor/core';
describe('owner vendor collection rules', () => {
  it('drops the shared batch copy from an earnings file without changing its records', () => {
    const v = { provider: 'eodhd', options: { symbols: 'A.US' }, pages: [{ requestId: 'x', sharedResponse: { data: { earnings: [1, 2, 3, 4] } }, response: { data: { earnings: [1, 2] } } }] };
    const r = compactEarningsFile(v);
    expect(r.changed).toBe(true);
    expect(r.recordsBefore).toBe(2); expect(r.recordsAfter).toBe(2);
    expect('sharedResponse' in r.value.pages[0]).toBe(false);
    expect(r.value.pages[0].requestId).toBe('x');
  });
  it('matches Data Legion on the primary domain, then legal name + domain, then LinkedIn', () => {
    expect(primaryDomain('https://about.nike.com')).toBe('nike.com');
    expect(primaryDomain('https://corporate.lowes.com')).toBe('lowes.com');
    expect(primaryDomain('https://www.cvshealth.com')).toBe('cvshealth.com');
    expect(primaryDomain('https://www.bp.co.uk')).toBe('bp.co.uk');
    expect(primaryDomain(undefined)).toBeUndefined();
    const ids = legionIdentifiers('nike.com', 'NIKE, Inc.', 'https://www.linkedin.com/company/nike');
    expect(ids.map((i: any) => Object.keys(i).filter((k) => k !== 'min_confidence').join('+'))).toEqual(['domain', 'name+domain', 'social_url']);
  });
  it('counts the records each page returned for the ledger', () => {
    expect(pageRecords([{ response: { data: { ratings: [1, 2, 3] } } }, { response: { data: [4] } }], {})).toBe(4);
  });
  it('Phase A never collects vendor daily prices (the app keeps its own price history)', () => {
    expect(PHASE_A_FISCAL_CAPABILITIES).not.toContain('prices/daily');
    expect(PHASE_A_FISCAL_CAPABILITIES).toHaveLength(13);
  });
  it('batches at most ten symbols across full history through today plus ninety days', () => {
    const batches=earningsBatches(Array.from({length:11},(_,i)=>`T${i}`),new Set(),new Date('2026-11-19T00:00:00Z'));
    expect(batches).toHaveLength(2); expect(batches[0].tickers).toHaveLength(10);
    expect(batches[0].options).toEqual({symbols:'T0.US,T1.US,T2.US,T3.US,T4.US,T5.US,T6.US,T7.US,T8.US,T9.US',from:'1996-01-01',to:'2027-02-17'});
  });
  it('never includes a ticker with an existing earnings file',()=>expect(earningsBatches(['A','B'],new Set(['A']),new Date('2026-11-19'))[0].tickers).toEqual(['B']));
  it('splits earnings strictly by provider symbol',()=>expect(earningsRecords({data:{earnings:[{code:'A.US',actual:1},{code:'B.US',actual:2}]}},'A')).toEqual([{code:'A.US',actual:1}]));
  it('does not infer earnings pagination from a full page',()=>expect(earningsNext({data:{earnings:[{}]}},{options:[{name:'page'},{name:'pageSize',default:1}]},{page:0,pageSize:1})).toBeNull());
  it('follows explicit earnings pagination only when supported',()=>{expect(earningsNext({data:{earnings:[{}],pagination:{hasMore:true,nextPage:2}}},{options:[{name:'page'}]},{page:1})).toEqual({page:2});expect(()=>earningsNext({pagination:{hasMore:true}},{options:[]},{})).toThrow('no continuation option');});
  it('keeps credits on requests and zeroes storage rows',()=>{const request={request_id:'abc',credits:10};expect(storageLedger({file:'A.json',credits:10}).credits+request.credits).toBe(10);});
  it('stops before a call would exceed 1500 Phase A credits',()=>{expect(phaseACanCall(1490,10)).toBe(true);expect(phaseACanCall(1491,10)).toBe(false);expect(phaseACanCall(1500,1)).toBe(false);});
  it('waits up to ten minutes for an in-progress provider', () => { expect(PROVIDER_PENDING_MS).toBe(600000); expect(providerPending({error:{message:'This provider request is still running. Retry with the same x-request-id once it has finished'}})).toBe(true); expect(providerPending({error:{message:'invalid option'}})).toBe(false); });
  it('reports progress every fifty companies', () => expect(PROGRESS_COMPANIES).toBe(50));
  it('runs one call at a time', () => expect(MAX_IN_FLIGHT).toBe(1));
  it('never calls the four cut duplicate fiscal-ai capabilities', () => {
    for (const cap of ['prices/daily','prices/splits','filings/list','ownership/insider-transactions']) {
      expect(PHASE_A_FISCAL_CAPABILITIES as readonly string[]).not.toContain(cap);
      expect(CUT_FISCAL_CAPABILITIES as readonly string[]).toContain(cap);
    }
    const src = readFileSync('scripts/vendor-backfill.ts','utf8') + readFileSync('scripts/vendor/phases.ts','utf8');
    for (const cap of ['prices/splits','filings/list','ownership/insider-transactions','prices/daily','news/press-releases','news/search','news/wiims','news/removed']) expect(src.includes(`'${cap}'`)).toBe(false);
  });
  it('hourly budget: 12000 by default, env override', () => {
    expect(MAX_CREDITS_PER_HOUR).toBe(12000);
    expect(hourlyCreditLimit({})).toBe(12000);
    expect(hourlyCreditLimit({VENDOR_MAX_CREDITS_PER_HOUR:'500'})).toBe(500);
  });
  it('hourly budget: under budget calls, over budget waits, seeded window counts and expires', () => {
    let t = 10_000_000;
    const b = new HourlyBudget(12000, () => t);
    b.add(11000, t - 30 * 60000); // seeded from the ledger, 30 minutes ago
    expect(b.spent()).toBe(11000);
    expect(b.canCall(500)).toBe(true);
    expect(b.canCall(1500)).toBe(false);
    t += 31 * 60000; // seeded call leaves the window
    expect(b.canCall(1500)).toBe(true);
  });
  it('retries a failed call twice', () => expect(MAX_ATTEMPTS).toBe(3));
  it('probes exhausted credits every thirty minutes', () => expect(CREDIT_PROBE_MS).toBe(1800000));
  it('limits each market provider to 2000 calls', () => expect(PHASE_B_CALL_LIMIT).toBe(2000));
  it('uses one private file per ticker and capability', () => expect(fileKey('fiscal-ai','company/profile','ZM')).toBe('vendor/fiscal-ai/company__profile/ZM.json'));
  it('reuses billing id across retries and key-order changes', () => expect(requestId('fred','series/series','GDP',{b:2,a:1})).toBe(requestId('fred','series/series','GDP',{a:1,b:2})));
  it('does not treat arbitrary forbidden responses as credit exhaustion', () => { expect(exhausted(403,{message:'missing scope'})).toBe(false); expect(exhausted(403,{message:'Credit limit reached'})).toBe(true); });
  it('walks all four documented holder pages', () => { const c={options:[{name:'pageNumber'},{name:'pageSize',default:250}],response:{key:'holders'}}; expect(nextOptions({data:{holders:[{}],pagination:{totalPages:4,hasNextPage:true}}},c,{pageNumber:3,pageSize:250})).toEqual({pageNumber:4,pageSize:250}); expect(nextOptions({data:{pagination:{hasNextPage:false}}},c,{pageNumber:4})).toBeNull(); });
  it('rejects unknown options before billing', () => expect(() => assertOptions({id:'test',options:[{name:'cik'}]},{ticker:'ZM'})).toThrow('invalid option ticker'));
  it('removes withdrawn stories from every saved page', () => expect(pruneWithdrawn({pages:[{response:{data:[{id:'1',body:'withdrawn'},{id:'2'}]}}]},new Set(['1']))).toEqual({pages:[{response:{data:[{id:'2'}]}}]}));
});
import { CreditPause, CREDIT_PAUSE_REASON } from '../../scripts/vendor/core';
describe('vendor credit pause', () => {
  it('a 402 always records the paused reason and waits 30 minutes', async () => {
    const reasons: (string|null)[] = []; const waits: number[] = [];
    const p = new CreditPause(async r => { reasons.push(r); }, async ms => { waits.push(ms); });
    await p.exhausted();
    expect(reasons).toEqual([CREDIT_PAUSE_REASON]); expect(waits).toEqual([1800000]);
  });
  it('a concurrent success during the wait does not clear the reason; the probe success does', async () => {
    const reasons: (string|null)[] = []; let release!: () => void;
    const p = new CreditPause(async r => { reasons.push(r); }, () => new Promise<void>(r => { release = r; }));
    const waiting = p.exhausted(); await Promise.resolve(); await Promise.resolve();
    await p.success();
    expect(reasons).toEqual([CREDIT_PAUSE_REASON]);
    release(); await waiting; await p.success();
    expect(reasons).toEqual([CREDIT_PAUSE_REASON, null]);
  });
  it('two simultaneous 402s share one probe wait', async () => {
    let waits = 0; const p = new CreditPause(async () => {}, async () => { waits++; });
    await Promise.all([p.exhausted(), p.exhausted()]); expect(waits).toBe(1);
  });
});
