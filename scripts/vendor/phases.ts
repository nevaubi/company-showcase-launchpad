/** Catalogue-driven raw archives; no model calls or writes to research tables. */
import { MACRO_SERIES, type CoverageCompany } from '../../src/lib/coverage';
import { type Json, records } from './core';
export interface Archive {
  collect(provider: string, capability: string, name: string, options: Json): Promise<Json | null>;
  ledger(detail: Json, ok?: boolean): Promise<void>;
  catalog: Map<string, Json>;
  stopped(): boolean;
}
function rows(a: Archive, value: Json | null, id: string): Json[] {
  return (value?.pages ?? []).flatMap((p: Json) => records(p.response, a.catalog.get(id) ?? {}));
}
export async function phaseB(a: Archive) {
  const end = new Date().toISOString().slice(0,10);
  for (const s of MACRO_SERIES.filter(s => s.source.includes('stlouisfed.org'))) {
    if (a.stopped()) return;
    await a.collect('fred','series/series',s.id,{series_id:s.id});
    await a.collect('fred','series/observations',s.id,{series_id:s.id,observation_start:'1996-01-01',limit:100000,offset:0});
  }
  await a.collect('bls-gov','economic-statistics/bls_surveys','catalog',{});
  for (const survey of ['CU','CE','LN','WP','AP']) {
    const picks = await a.collect('bls-gov','economic-statistics/bls_top_picks',survey,{survey,limit:200,offset:0});
    const data = picks?.pages?.[0]?.response?.data;
    const series = rows(a,picks,'bls-gov/economic-statistics/bls_top_picks');
    for (const s of series.length ? series : data?.series ?? data?.picks ?? []) {
      const id = s.series_id ?? s.seriesID;
      if (!id || a.stopped()) continue;
      // BLS limits the public API year window; preserve every window in one file.
      const value: Json[] = [];
      for (let y=1996;y<=Number(end.slice(0,4));y+=10) value.push({series_id:id,start_year:y,end_year:Math.min(y+9,Number(end.slice(0,4)))});
      await a.collect('bls-gov','economic-statistics/bls_series_detail',id,{series_id:id,all_years:true});
    }
  }
  const treasury = await a.collect('fiscaldata-treasury-gov','fiscal-data/datasets','catalog',{page_size:100});
  for (const d of rows(a,treasury,'fiscaldata-treasury-gov/fiscal-data/datasets')) {
    if (!/debt|treasury statement|interest|revenue|deficit/i.test(JSON.stringify(d))) continue;
    for (const t of d.tables ?? []) if (t.endpoint) await a.collect('fiscaldata-treasury-gov','fiscal-data/data',t.endpoint.replaceAll('/','__'),{endpoint:t.endpoint,page_size:10000});
  }
  // This catalogue has no Federal Reserve series chooser; never invent package identifiers.
  await a.collect('federalreserve-gov','central-bank-communications/fomc_meetings','full-history',{});
  await a.ledger({phase:'B',provider:'federalreserve-gov',omitted:'data_series requires a 32-hex chooser package id; catalogue exposes no chooser/list capability'},false);
  const indicators = await a.collect('data-worldbank-org','indicators/indicators','catalog',{per_page:1000,page:1});
  await a.collect('data-worldbank-org','indicators/countries','catalog',{include_aggregates:true,per_page:400,page:1});
  for (const i of rows(a,indicators,'data-worldbank-org/indicators/indicators')) {
    if (!/GDP \(current US\$\)|GDP growth \(annual %\)|Inflation, consumer prices|Population, total|Unemployment, total|Exports of goods and services \(% of GDP\)/i.test(i.name ?? '')) continue;
    await a.collect('data-worldbank-org','indicators/data',i.id,{indicator_ids:i.id,country_codes:'USA;WLD',date:`1996:${end.slice(0,4)}`,page:1,per_page:1000});
  }
  // Navigate EIA routes, using only frequencies and columns supplied by each route's contract response.
  const queue=['']; const seen=new Set<string>();
  while (queue.length && !a.stopped()) {
    const path=queue.shift(); if (path == null || seen.has(path)) continue; seen.add(path);
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
      if (cols.length) await a.collect('eia-gov','energy-data/data',path.replaceAll('/','__'),{route:path,frequency:monthly.id,start:monthly.id==='annual'?'1996':'1996-01',page_size:5000,data_columns:cols});
    }
  }
  const census=await a.collect('census-gov','census/datasets','catalog',{query:'acs',page_size:1000});
  for (const d of rows(a,census,'census-gov/census/datasets')) {
    const dataset=Array.isArray(d.c_dataset)?d.c_dataset.join('/'):d.dataset;
    const vintage=Number(d.c_vintage ?? d.vintage);
    if (dataset !== 'acs/acs1' || vintage<1996) continue;
    const vars=await a.collect('census-gov','census/variables',`acs1-${vintage}`,{dataset,vintage,query:'total population',page_size:500});
    const vr=rows(a,vars,'census-gov/census/variables');
    const variable=vr.find(v=>v.name==='B01003_001E');
    if (variable) await a.collect('census-gov','census/data',`population-${vintage}`,{dataset,vintage,variables:[variable.name],geography:{for:'us:*'},page_size:500});
  }
  for (const cap of ['legacy/futures-only','legacy/combined','disaggregated/futures-only','disaggregated/combined','financial/futures-only','financial/combined','supplemental/index-traders']) {
    await a.collect('cftc',cap,'full-history',{'$where':"report_date_as_yyyy_mm_dd >= '1996-01-01T00:00:00'",'$limit':50000,'$offset':0});
  }
  await a.collect('nasdaq-com','news/latest_headlines','catalog',{limit:100,offset:0});
  await a.ledger({phase:'B',provider:'nasdaq-com',omitted:'Catalogue provides news capabilities only, no market-wide historical-series catalogue'},false);
  await a.ledger({phase:'B',stage:'finished',scope:'available headline series; omissions and provider-budget skips recorded separately'});
}
export async function phaseC(a: Archive, c: CoverageCompany, reg: Json, uniqueLegal: boolean) {
  const legal=reg.legal;
  if (reg.fdic && /bank/i.test(c.industry)) for (const cap of ['institutions','financials','deposits','history']) await a.collect('banks-data-fdic-gov',`bank-data/${cap}`,c.ticker,{cert:reg.fdic,page_size:10000});
  if (!legal || !uniqueLegal) { await a.ledger({phase:'C',ticker:c.ticker,skipped:'Missing or ambiguous registry legal name'}); return; }
  await a.collect('lda-gov','lobbying-disclosures/search_filings',c.ticker,{client_name:legal,page_size:100});
  await a.collect('usaspending-gov','awards/award_search',c.ticker,{recipient_search_text:legal,award_type_codes:['A','B','C','D'],time_period:[{start_date:'2007-10-01',end_date:new Date().toISOString().slice(0,10)}],page_size:100});
  await a.collect('courtlistener-com','dockets/search_dockets',c.ticker,{party_name:legal,party_name_exact:true,filed_after:'1996-01-01'});
  const entities=await a.collect('gleif-org','entities/search',c.ticker,{name:legal,limit:200,page:1});
  const normalized=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  const matches=rows(a,entities,'gleif-org/entities/search').filter(e=>normalized(e.attributes?.entity?.legalName?.name ?? e.entity?.legalName?.name ?? e.legal_name ?? '')===normalized(legal));
  if (matches.length===1) {
    const lei=matches[0].id ?? matches[0].lei;
    if (lei) for (const cap of ['entity','direct_parent','ultimate_parent','direct_children','ultimate_children']) await a.collect('gleif-org',`entities/${cap}`,c.ticker,{lei});
  } else await a.ledger({phase:'C',ticker:c.ticker,provider:'gleif-org',skipped:'No unique exact legal-name LEI match'});
  await a.collect('branddb-wipo-int','intellectual-property/search_trademarks',c.ticker,{owner:legal,rows:100});
  await a.collect('patentscope-wipo-int','intellectual-property/search',c.ticker,{query:`PA:("${legal.replaceAll('"','')}")`,page:1});
  await a.collect('govinfo-gov','legislation/search',c.ticker,{query:`"${legal.replaceAll('"','')}"`,historical:true,page:1,page_size:100});
  const health=/health|pharma|biotech|medical|life sci/i.test(`${c.sector} ${c.industry}`);
  if (health) {
    for (const cap of ['approvals/first_generics','devices/pma_approvals','biologics/purple_book']) await a.collect('fda-gov',cap,c.ticker,{applicant:legal,limit:100,skip:0});
    await a.collect('fda-gov','records/orphan_designations',c.ticker,{sponsor:legal,limit:100,skip:0});
    if (/hospital|dialysis|nursing|home health/i.test(c.industry)) {
      const cap=/dialysis/i.test(c.industry)?'dialysis_facilities':/nursing/i.test(c.industry)?'nursing_homes':/home health/i.test(c.industry)?'home_health_agencies':'hospitals';
      await a.collect('data-cms-gov',`clinician-procedure-volume/${cap}`,c.ticker,{name:legal,limit:100,offset:0});
    }
  }
  if (reg.maker && /automobile|vehicle/i.test(c.industry)) await a.collect('nhtsa-gov','recalls/vehicle_recalls',c.ticker,{make:reg.maker});
  // These contracts require product identifiers / an exact profile URL not present in the registry.
  await a.ledger({phase:'C',ticker:c.ticker,omitted:['bbb-org: no hand-verified profile URL or id','cms-gov: no verified company-to-drug/HCPCS map','sec-gov: existing collection already covers company facts, filings and insiders'],stage:'company-finished'});
}