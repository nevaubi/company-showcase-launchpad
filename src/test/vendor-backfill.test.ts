import { describe, expect, it } from 'vitest';
import { earningsBatches, earningsRecords, earningsNext, phaseACanCall, storageLedger } from '../../scripts/vendor/core';
import { CREDIT_PROBE_MS, MAX_ATTEMPTS, MAX_IN_FLIGHT, PHASE_B_CALL_LIMIT, PROVIDER_PENDING_MS, PROGRESS_COMPANIES, providerPending, providerMiss, legionIdentifiers, assertOptions, exhausted, fileKey, nextOptions, pruneWithdrawn, requestId } from '../../scripts/vendor/core';
describe('owner vendor collection rules', () => {
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
  it('retries a company miss with LinkedIn then legal name and domain', () => { expect(providerMiss({error:{code:'not_found'}})).toBe(true); expect(legionIdentifiers('meta.com','Meta Platforms Inc.','https://www.linkedin.com/company/meta')).toEqual([{domain:'meta.com',min_confidence:'high'},{social_url:'https://www.linkedin.com/company/meta',min_confidence:'high'},{name:'Meta Platforms Inc.',domain:'meta.com',min_confidence:'high'}]); expect(legionIdentifiers(undefined,'Meta',undefined)).toEqual([]); });
  it('allows no more than four calls in flight', () => expect(MAX_IN_FLIGHT).toBe(4));
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