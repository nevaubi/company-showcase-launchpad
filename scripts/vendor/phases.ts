/** Catalogue-driven raw archives; no model calls or writes to research tables. */
import { type CoverageCompany } from '../../src/lib/coverage';
import { type Json, records, EIA_CALL_LIMIT } from './core';
export interface Archive {
  /** `need` false: the caller only wants the file to exist, so a stored one is not downloaded. */
  collect(provider: string, capability: string, name: string, options: Json, need?: boolean): Promise<Json | null>;
  ledger(detail: Json, ok?: boolean): Promise<void>;
  catalog: Map<string, Json>;
  stopped(): boolean;
}
function rows(a: Archive, value: Json | null, id: string): Json[] {
  return (value?.pages ?? []).flatMap((p: Json) => records(p.response, a.catalog.get(id) ?? {}));
}
export async function phaseB(a: Archive) {
  const end = new Date().toISOString().slice(0,10);
  // Cut (owner, Nov 19): FRED, BLS and Treasury duplicate the app's own FRED macro data.
  // This catalogue has no Federal Reserve series chooser; never invent package identifiers.
  await a.collect('federalreserve-gov','central-bank-communications/fomc_meetings','full-history',{},false);
  await a.ledger({phase:'B',provider:'federalreserve-gov',omitted:'data_series requires a 32-hex chooser package id; catalogue exposes no chooser/list capability'},false);
  const indicators = await a.collect('data-worldbank-org','indicators/indicators','catalog',{per_page:1000,page:1});
  await a.collect('data-worldbank-org','indicators/countries','catalog',{include_aggregates:true,per_page:400,page:1},false);
  for (const i of rows(a,indicators,'data-worldbank-org/indicators/indicators')) {
    if (!/GDP \(current US\$\)|GDP growth \(annual %\)|Inflation, consumer prices|Population, total|Unemployment, total|Exports of goods and services \(% of GDP\)/i.test(i.name ?? '')) continue;
    await a.collect('data-worldbank-org','indicators/data',i.id,{indicator_ids:i.id,country_codes:'USA;WLD',date:`1996:${end.slice(0,4)}`,page:1,per_page:1000},false);
  }
  // Navigate EIA routes, using only frequencies and columns supplied by each route's contract response.
  const queue=['']; const seen=new Set<string>();
  let eiaCalls=0;
  while (queue.length && !a.stopped() && eiaCalls < EIA_CALL_LIMIT) {
    const path=queue.shift(); if (path == null || seen.has(path)) continue; seen.add(path);
    eiaCalls++;
    const v=await a.collect('eia-gov','energy-data/routes',path.replaceAll('/','__') || 'catalog',path ? {path,page_size:1000} : {page_size:1000});
    const d=v?.pages?.[0]?.response?.data;
    if (!d) continue;
    for (const r of d.records ?? []) {
      const id=r.id ?? r.route_id;
      if (id && /petroleum|natural.gas|electricity|total.energy|pri|spt|retail|sales|sum|cons|prod|storage/i.test(`${path}/${id}`)) queue.push(`${path}/${id}`.replace(/^\//,''));
    }
    const frequencies=d.route?.frequencies ?? d.frequencies ?? [];
    const monthly=frequencies.find((f:Json)=>f.id==='monthly' || f.id==='annual');
    if (d.has_data && monthly) {
      const cols=(d.route?.data_columns ?? d.data_columns ?? []).map((c:Json)=>c.id ?? c.name).filter(Boolean);
      if (cols.length && eiaCalls++ < EIA_CALL_LIMIT) await a.collect('eia-gov','energy-data/data',path.replaceAll('/','__'),{route:path,frequency:monthly.id,start:monthly.id==='annual'?'1996':'1996-01',page_size:5000,data_columns:cols},false);
    }
  }
  // Cut (owner, Nov 19): Census population is low value.
  for (const cap of ['legacy/futures-only','legacy/combined','disaggregated/futures-only','disaggregated/combined','financial/futures-only','financial/combined','supplemental/index-traders']) {
    await a.collect('cftc',cap,'full-history',{'$where':"report_date_as_yyyy_mm_dd >= '1996-01-01T00:00:00'",'$limit':50000,'$offset':0},false);
  }
  // Cut (owner, Nov 19): Nasdaq headlines are news.
  await a.ledger({phase:'B',stage:'finished',scope:'available headline series; omissions and provider-budget skips recorded separately'});
}
export async function phaseC(a: Archive, c: CoverageCompany, reg: Json, uniqueLegal: boolean) {
  const legal=reg.legal;
  if (reg.fdic && /bank/i.test(c.industry)) for (const cap of ['deposits','history']) await a.collect('banks-data-fdic-gov',`bank-data/${cap}`,c.ticker,{cert:reg.fdic,page_size:10000},false);
  if (!legal || !uniqueLegal) { await a.ledger({phase:'C',ticker:c.ticker,skipped:'Missing or ambiguous registry legal name'}); return; }
  await a.collect('lda-gov','lobbying-disclosures/search_filings',c.ticker,{client_name:legal,page_size:100},false);
  await a.collect('usaspending-gov','awards/award_search',c.ticker,{recipient_search_text:legal,award_type_codes:['A','B','C','D'],time_period:[{start_date:'2007-10-01',end_date:new Date().toISOString().slice(0,10)}],page_size:100},false);
  await a.collect('courtlistener-com','dockets/search_dockets',c.ticker,{party_name:legal,party_name_exact:true,filed_after:'1996-01-01'},false);
  const entities=await a.collect('gleif-org','entities/search',c.ticker,{name:legal,limit:200,page:1});
  const normalized=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  const matches=rows(a,entities,'gleif-org/entities/search').filter(e=>normalized(e.attributes?.entity?.legalName?.name ?? e.entity?.legalName?.name ?? e.legal_name ?? '')===normalized(legal));
  if (matches.length===1) {
    const lei=matches[0].id ?? matches[0].lei;
    if (lei) for (const cap of ['entity','direct_parent','ultimate_parent','direct_children','ultimate_children']) await a.collect('gleif-org',`entities/${cap}`,c.ticker,{lei},false);
  } else await a.ledger({phase:'C',ticker:c.ticker,provider:'gleif-org',skipped:'No unique exact legal-name LEI match'});
  await a.collect('branddb-wipo-int','intellectual-property/search_trademarks',c.ticker,{owner:legal,rows:100},false);
  await a.collect('patentscope-wipo-int','intellectual-property/search',c.ticker,{query:`PA:("${legal.replaceAll('"','')}")`,page:1},false);
  // Cut (owner, Nov 19): government document search matches are noisy.
  const health=/health|pharma|biotech|medical|life sci/i.test(`${c.sector} ${c.industry}`);
  if (health) {
    for (const cap of ['approvals/first_generics','devices/pma_approvals','biologics/purple_book']) await a.collect('fda-gov',cap,c.ticker,{applicant:legal,limit:100,skip:0},false);
    await a.collect('fda-gov','records/orphan_designations',c.ticker,{sponsor:legal,limit:100,skip:0},false);
    if (/hospital|dialysis|nursing|home health/i.test(c.industry)) {
      const cap=/dialysis/i.test(c.industry)?'dialysis_facilities':/nursing/i.test(c.industry)?'nursing_homes':/home health/i.test(c.industry)?'home_health_agencies':'hospitals';
      await a.collect('data-cms-gov',`clinician-procedure-volume/${cap}`,c.ticker,{name:legal,limit:100,offset:0},false);
    }
  }
  // Cut (owner, Nov 19): vehicle recalls are already collected by the alt-data job.
  // These contracts require product identifiers / an exact profile URL not present in the registry.
  await a.ledger({phase:'C',ticker:c.ticker,omitted:['bbb-org: no hand-verified profile URL or id','cms-gov: no verified company-to-drug/HCPCS map','sec-gov: existing collection already covers company facts, filings and insiders'],stage:'company-finished'});
}