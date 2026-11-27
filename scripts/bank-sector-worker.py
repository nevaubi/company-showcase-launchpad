"""Refresh native sector datasets from current SEC filings and the sector market baseline."""
import argparse
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
PUBLIC_BASE = "https://apxfeteebnspwyajlxfh.supabase.co/storage/v1/object/public/public-data/"
FILES = ["sectors.json", "sectors/banks.json", "sectors/financials.json", "sectors/banks.comp.json", "sectors/financials.comp.json"]
SEC_UA = os.getenv("SEC_USER_AGENT") or "FiledUnder Research research@filedunder.ai"
GATE = threading.Lock()
next_sec = 0.0


def request(url, body=None, headers=None):
    req = Request(url, data=(json.dumps(body).encode() if body is not None else None), headers=headers or {})
    for attempt in range(3):
        try:
            with urlopen(req, timeout=45) as r:
                return r.read()
        except HTTPError as exc:
            if exc.code not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                raise
        except OSError:
            if attempt == 2:
                raise
        time.sleep(2**attempt)


def sec(url):
    global next_sec
    with GATE:
        time.sleep(max(0,next_sec-time.monotonic()))
        next_sec=time.monotonic()+0.30
    return request(url,headers={"User-Agent":SEC_UA})


def cloud(route, body=None, upsert=False):
    url=(os.environ.get("SUPABASE_URL") or os.environ["VITE_SUPABASE_URL"]).rstrip("/")
    key=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers={"apikey":key,"Authorization":"Bearer "+key,"Content-Type":"application/json"}
    if upsert:
        headers["Prefer"]="resolution=ignore-duplicates,return=minimal"
    raw=request(url+"/rest/v1/"+route,body,headers)
    return json.loads(raw) if raw else None


def snapshots(folder):
    for path in FILES:
        dest=folder/path
        dest.parent.mkdir(parents=True,exist_ok=True)
        key=os.getenv("PARTNER_DATA_KEY")
        if key:
            base=os.getenv("PARTNER_DATA_URL") or "https://filedunderai.vercel.app/api/app-data"
            data=request(base+"?"+urlencode({"path":path}),headers={"x-partner-key":key})
        else:
            data=request(PUBLIC_BASE+path)
        json.loads(data)
        dest.write_bytes(data)


def year_quarters(start, end):
    y,q=int(start[:4]),int(start[-1])
    while f"{y}Q{q}" <= end:
        yield f"{y}Q{q}"
        q=q%4+1
        if q==1:
            y+=1


def quarter_end(q):
    return q[:4]+"-"+("03-31","06-30","09-30","12-31")[int(q[-1])-1]


def resolve_reported(raw, tk, asof, base, receipts):
    """Honor a published total only if its value identifies a filed consolidated Revenue observation."""
    gaap=json.loads(raw)["facts"].get("us-gaap",{})
    facts=dict(receipts.get("reported_inputs") or {})
    for q, row in base.items():
        date=quarter_end(q)
        value=row.get("rev_q")
        if value is None or row.get("end")!=date:
            continue
        matches=[]
        for tag in ("RevenuesNetOfInterestExpense","Revenues"):
            for obs in gaap.get(tag,{}).get("units",{}).get("USD",[]):
                if obs.get("end")!=date or obs.get("filed","")>asof or not obs.get("start") or obs.get("form") not in {"10-Q","10-K","10-Q/A","10-K/A"}:
                    continue
                days=(dt.date.fromisoformat(date)-dt.date.fromisoformat(obs["start"])).days+1
                if 75<=days<=105 and float(f"{obs['val']:.6g}")==float(f"{value:.6g}"):
                    matches.append((obs["filed"],obs["accn"],tag,obs))
        if matches:
            _,_,tag,obs=max(matches,key=lambda x:x[:3])
            facts[date]={"ticker":tk,"label":"Revenue","period_end":date,"value":obs["val"],
                         "concept":tag,"accession":obs["accn"],"form":obs["form"],"derived":False}
        elif date in facts and float(f"{float(facts[date]['value']):.6g}")!=float(f"{value:.6g}"):
            # A revised upstream row invalidates the old assertion. Only the new SEC match
            # or same-filing components can establish the revised denominator.
            del facts[date]
    return list(facts.values())


def refresh(work):
    stamp=dt.datetime.now(dt.timezone.utc)
    asof=stamp.date().isoformat()
    releases=cloud("sector_dataset_releases?select=release_id,as_of,activated_at&path=eq.sectors.json&order=as_of.desc,activated_at.desc&limit=1")
    if releases and releases[0]["as_of"]>=asof:
        return "Today’s verified sector release is already active"
    if not releases:
        raise ValueError("Bank-sector release requires a validated starting cohort")
    last= releases[0]["as_of"]
    previous={r["ticker"]:r for r in cloud(f"sector_bank_source_receipts?select=ticker,cik,payload&as_of=eq.{last}&order=ticker")}
    base=work/"base"
    snapshots(base)
    group=json.loads((base/"sectors/banks.json").read_bytes())
    comp=json.loads((base/"sectors/banks.comp.json").read_bytes())
    end=next(g["q"] for g in json.loads((base/"sectors.json").read_bytes())["groups"] if g["slug"]=="banks")
    if not end or end<"2026Q3":
        raise ValueError("Incomplete or out-of-order sector baseline")
    tickers=group["members"]
    ciks={t:int(previous[t]["cik"]) for t in tickers if t in previous}
    if len(ciks)!=len(tickers):
        sec_tickers=json.loads(sec("https://www.sec.gov/files/company_tickers.json"))
        by_ticker={x["ticker"]:int(x["cik_str"]) for x in sec_tickers.values()}
        for t in tickers:
            if t not in ciks:
                ciks[t]=by_ticker[t]
    cohort=work/"cohort.json"
    cohort.write_text(json.dumps([{"ticker":t,"cik":ciks[t]} for t in tickers]))
    sec_dir=work/"sec"
    sec_dir.mkdir()
    def issuer(t):
        cik=ciks[t]
        raw=sec(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
        if int(json.loads(raw)["cik"])!=cik:
            raise ValueError("SEC identity mismatch for "+t)
        (sec_dir/f"{cik:010d}.json.gz").write_bytes(gzip.compress(raw,compresslevel=1,mtime=0))
        published={q:dict(zip(comp["fields"],row)) for q,row in zip(comp["quarters"],comp["data"][t]) if row}
        return resolve_reported(raw,t,asof,published,(previous.get(t) or {}).get("payload",{}))
    with concurrent.futures.ThreadPoolExecutor(3) as pool:
        facts=[row for values in pool.map(issuer,tickers) for row in values]
    facts_path=work/"facts.json"
    facts_path.write_text(json.dumps(facts))
    output=work/"release"
    inputs=base
    for q in year_quarters("2026Q3",end):
        docs=work/q
        subprocess.run([sys.executable,str(ROOT/"bank-sector-release.py"),"--quarter",q,"--as-of",asof,"--base",str(inputs),
                        "--facts",str(facts_path),"--cohort",str(cohort),"--sec-dir",str(sec_dir),"--output",str(output),
                        "--write-docs",str(docs)],check=True)
        inputs=docs
    manifest=json.loads((output/"manifest.json").read_text())
    for path,entry in manifest.items():
        entry["input_sha256"]=hashlib.sha256((base/path).read_bytes()).hexdigest()
    manifest["sectors/banks.json"]["issuer_sha256"]={
        tk:json.loads((output/"receipts"/f"{tk}.json").read_text())["sha256"] for tk in tickers
    }
    revision=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()[:12]
    release=f"bank-sec-{end.lower()}-{asof}-{revision}"
    for start in range(0,len(tickers),12):
        chunk=[]
        for tk in tickers[start:start+12]:
            r=json.loads((output/"receipts"/f"{tk}.json").read_text())
            chunk.append({"as_of":asof,"ticker":tk,"cik":r["cik"],"source_url":r["source_url"],"source_sha256":r["sha256"],"payload":r})
        cloud("sector_bank_source_receipts?on_conflict=as_of,ticker",chunk,True)
    for path,entry in manifest.items():
        files=[{"release_id":release,"path":path,"part":i,"body":(output/(path.replace("/","_")+f".{i}.b64")).read_text()}
               for i in range(entry["parts"])]
        cloud("sector_release_parts?on_conflict=release_id,path,part",files,True)
    activated=cloud("rpc/activate_bank_sector_release_v1",{"_release":release,"_as_of":asof,"_quarter":end,"_manifest":manifest,"_tickers":tickers})
    if activated!=5:
        raise ValueError("Native release did not activate")
    return f"Activated {release} with {len(tickers)} issuer receipts"


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once",action="store_true")
    args=parser.parse_args()
    while True:
        try:
            with tempfile.TemporaryDirectory(prefix="bank-sector-") as tmp:
                print(refresh(Path(tmp)),flush=True)
        except Exception as exc:
            print(f"Bank sector refresh held at last verified release: {exc}",file=sys.stderr,flush=True)
            if args.once:
                raise
            time.sleep(1800)
            continue
        if args.once:
            break
        time.sleep(3*3600)
