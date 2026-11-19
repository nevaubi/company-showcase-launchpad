import json,re,datetime,collections,os,requests
from pathlib import Path
from openpyxl import load_workbook
root=os.environ.get('IR_OWNER_IMPORT_ROOT','/tmp/ir-owner-import')
headers={'apikey':os.environ['SUPABASE_SERVICE_ROLE_KEY'],'Authorization':'Bearer '+os.environ['SUPABASE_SERVICE_ROLE_KEY']}
base=os.environ['SUPABASE_URL']
for ticker in ['C','GOOGL','WFC']:
 response=requests.get(base+'/storage/v1/object/authenticated/ir-documents/series/'+ticker+'.json',headers=headers,timeout=180)
 response.raise_for_status()
 Path(root+'/'+ticker+'-stored.json').write_text(response.text)
def norm(v):return re.sub(r'[^a-z0-9]+',' ',str(v or '').lower()).strip()
def unit(v):return {'$':'usd','USD':'usd','%':'percent','units':'units'}.get(v,str(v).lower())
def date(v):return v.strftime('%Y-%m-%d') if isinstance(v,datetime.datetime) else str(v)[:10]
report={}
for ticker,fn in [('C','C_segment_KPI_master_audited.xlsx'),('GOOGL','GOOGL_segment_financials_kpis.xlsx'),('WFC','WFC_segment_financials.xlsx')]:
 data=json.load(open(root+'/'+ticker+'-stored.json'));index=collections.defaultdict(list)
 for s in data['series']:
  for kind,key in [('Q','q'),('FY','y')]:
   for d,c in s.get(key,{}).items():index[(norm(s['label']),s['unit'],d,kind)].append((c['v'],s))
 w=load_workbook(root+'/'+fn,read_only=True,data_only=True);counts=collections.Counter();diff=[];provenance=collections.Counter()
 def compare(label,u,d,kind,value,source=False,parent=None,breakdown=None):
  counts['values']+=1;provenance['with_source_locator' if source else 'without_source_locator']+=1
  candidates=index.get((norm(label),unit(u),date(d),kind),[])
  if parent is not None and candidates:
   exact=[c for c in candidates if norm(next((p['label'] for p in data['series'] if p['k']==c[1]['parent']),None))==norm(parent)]
   if exact:candidates=exact
  values=set(c[0] for c in candidates)
  if any(abs(v-value)<=max(abs(value)*1e-9,1e-8) for v in values):counts['agree']+=1
  elif len(values)==1:
   v=next(iter(values));counts['differ']+=1;diff.append({'label':label,'period':date(d),'kind':kind,'unit':u,'workbook':value,'stored':v,'difference':value-v})
  elif values:counts['ambiguous_existing_match']+=1
  else:counts['new_or_unmatched']+=1
 if ticker=='C':
  for r in w['Data & sources'].iter_rows(min_row=5,values_only=True):
   if not isinstance(r[8],(int,float)) or not r[6]:continue
   compare(r[2],r[4],r[6],'FY' if 'FY' in str(r[0]) else 'Q',r[8],bool(r[13] and r[14]),r[3],r[1])
 else:
  for sn,kind in [('Quarterly (USD)','Q'),('Annual (USD)','FY')]:
   rows=list(w[sn].values);ends=rows[4]
   for r in rows[5:]:
    if not r[1]:continue
    for col,value in enumerate(r[2:],2):
     if isinstance(value,(int,float)):compare(r[0],r[1],ends[col],kind,value,False)
 report[ticker]={'counts':dict(counts),'provenance':dict(provenance),'ten_largest_differences':sorted(diff,key=lambda r:abs(r['difference']),reverse=True)[:10],'method':'Exact normalized label/unit/date/frequency matching against displayed payload; ambiguous matches separate; unmatched are not proven new facts. No writes.'}
report['Anthropic']={'action':'Not compared or imported: private company outside coverage. Requires separate private-company identity, permission/licensing for supplied data, dated primary-source documents with stable stored-copy/cell or page locators, private-company financial model not SEC assumption, and explicit approval.'}
json.dump(report,open(root+'/workbook-dry-run.json','w'),indent=2)
for k,v in report.items():print(k,v.get('counts',v))

path='ops/ir-upload/workbook-dry-run-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json'
body=json.dumps(report).encode()
response=requests.post(base+'/storage/v1/object/datasets/'+path,headers={**headers,'Content-Type':'application/json','x-upsert':'false'},data=body,timeout=180)
response.raise_for_status()
print('PRIVATE REPORT: datasets/'+path,flush=True)
