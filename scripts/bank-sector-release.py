"""Build authenticated Cloud sector files from issuer SEC receipts and an unmodified sector baseline.

Inputs: --base sector files; --facts JSON array of original quarterly income rows (ticker, label,
period_end, value, concept, accession, form, derived); --cohort JSON array (ticker, cik);
--sec-dir raw source companyfacts as 10-digit CIK .json.gz. Writes exact Cloud release inputs.
"""
import argparse
import base64
import calendar
import gzip
import hashlib
import json
import statistics
from pathlib import Path

from lib.bank_filing_revenue import extract

AFFECTED = ["rev_growth", "pct_rev_up", "gm", "om", "nm", "fcfm", "ps", "rev_ttm"]
FEE_ONLY = {"RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax"}
DENOMINATORS = {"gm": "gp_ttm", "om": "oi_ttm", "nm": "ni_ttm", "ps": "mcap", "fcfm": "fcf"}


def shift(q, n):
    idx = int(q[:4]) * 4 + int(q[-1]) - 1 + n
    return f"{idx // 4}Q{idx % 4 + 1}"


def end_of(q):
    year, month = int(q[:4]), int(q[-1]) * 3
    return f"{year:04}-{month:02}-{calendar.monthrange(year, month)[1]:02}"


def total(values):
    return sum(values) if values and None not in values else None


def divide(a, b):
    return a / b if a is not None and b is not None and b > 0 else None


def six(value):
    return float(f"{value:.6g}") if value is not None else None


def row_values(row):
    rev = row["rev_ttm"]
    rev_yoy = divide(row["rev_q"], row["rev_py"])
    fcf = row["ocf_ttm"] - row["capex_ttm"] if row["ocf_ttm"] is not None and row["capex_ttm"] is not None else None
    values = {k: divide(fcf if field == "fcf" else row[field], rev) for k, field in DENOMINATORS.items()}
    values.update(rev_growth=rev_yoy-1 if rev_yoy is not None else None, rev_ttm=rev)
    return values


def aggregate(rows, metric):
    own = [(row_values(row).get(metric), row["mcap"]) for row in rows]
    vals = [v for v, _ in own if v is not None]
    if metric == "pct_rev_up":
        growth = [v for row in rows if (v := row_values(row)["rev_growth"]) is not None]
        return dict(agg=six(sum(v > 0 for v in growth) / len(growth)) if growth else None, cw=None, med=None, n=len(growth))
    if metric == "rev_ttm":
        return dict(agg=six(sum(vals)) if vals else None, cw=None, med=six(statistics.median(vals)) if vals else None, n=len(vals))
    pairs = []
    for row in rows:
        if metric == "rev_growth":
            num, den = row["rev_q"], row["rev_py"]
        elif row["rev_ttm"] is not None and row["rev_ttm"] > 0:
            num = row[DENOMINATORS[metric]] if metric != "fcfm" else (
                row["ocf_ttm"] - row["capex_ttm"] if None not in (row["ocf_ttm"],row["capex_ttm"]) else None)
            den = row["rev_ttm"]
        else:
            continue
        if None not in (num, den):
            pairs.append((num, den))
    agg = divide(sum(n for n, _ in pairs), sum(d for _, d in pairs))
    weighted = [(v, mc) for v, mc in own if v is not None and mc]
    return dict(agg=six(agg-1 if metric == "rev_growth" and agg is not None else agg),
                med=six(statistics.median(vals)) if vals else None, n=len(pairs),
                cw=six(divide(sum(v*mc for v, mc in weighted),sum(mc for _, mc in weighted))))


def filing_notes(overview, as_of):
    notes = []
    for group in overview["groups"]:
        q = group.get("q")
        if group["kind"] != "sector" or not q:
            continue
        facts, clauses = {}, []
        for k, label in (("rev_growth","Revenue growth"), ("ni_growth","Earnings growth"), ("nm","Trailing net margin")):
            point = group["latest"].get(k)
            if not point or point[0] != q or point[1] is None or not point[2]:
                continue
            _, value, count = point
            facts[k] = {"label":f"{group['name']} · {label} · {q} · {count} of {group['n']} constituents",
                        "value":value, "unit":"pct", "text":f"{value*100:.2f}% ({count} of {group['n']})",
                        "ref":{"type":"agg","metric":k,"q":q}}
            clauses.append(label + " was {{" + k + "}}.")
        if facts:
            notes.append({"slug":group["slug"],"sector":group["name"], "week":as_of,"generated_at":as_of,
                          "model":"verified-sector-release","title":f"{group['name']} · Q{q[-1]} {q[:4]} filings",
                          "text":" ".join(clauses),"facts":facts})
    return {"as_of":as_of,"notes":notes}


def pack(value):
    return json.dumps(value, sort_keys=True, separators=(",",":"), allow_nan=False).encode()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("base", "facts", "cohort", "sec-dir", "output"):
        p.add_argument("--"+name, type=Path, required=True)
    p.add_argument("--quarter", required=True)
    p.add_argument("--as-of", required=True)
    p.add_argument("--write-docs", type=Path, help="Save uncompressed release documents for subsequent quarter adjustments")
    args=p.parse_args()
    q, asof = args.quarter, args.as_of
    root=args.output
    root.mkdir(parents=True,exist_ok=True)
    (root/"receipts").mkdir(exist_ok=True)
    receipts={}
    for tk, cik in sorted((r["ticker"],int(r["cik"])) for r in json.loads(args.cohort.read_text())):
        raw=gzip.decompress((args.sec_dir/f"{cik:010}.json.gz").read_bytes())
        receipt=extract(raw,cik,"2024-01-01",asof)
        receipt["reported_inputs"]={}
        receipts[tk]=receipt
    for row in json.loads(args.facts.read_text()):
        if row["label"]=="Revenue" and row["ticker"] in receipts:
            receipts[row["ticker"]]["reported_inputs"][row["period_end"]]=row
    for tk, receipt in receipts.items():
        (root/"receipts"/f"{tk}.json").write_bytes(pack(receipt))

    def revenue(tk, period):
        end=end_of(period)
        source=receipts[tk]
        fact=source["reported_inputs"].get(end)
        calculated=source["periods"].get(end)
        tag=fact["concept"].split(":")[-1] if fact else None
        excluded=(calculated or {}).get("excluded_subtotals",{}).get(tag)
        is_subtotal=(fact and calculated and excluded and fact["accession"]==calculated["accession"]
                     and float(fact["value"])==excluded["value"])
        if fact and tag not in FEE_ONLY and not is_subtotal:
            return float(fact["value"]), None
        return (calculated["net_revenue"], calculated) if calculated else (None,None)

    overview=json.loads((args.base/"sectors.json").read_bytes())
    release={"sectors.json":overview}
    audit={}
    for slug in ("banks","financials"):
        path=f"sectors/{slug}"
        group=json.loads((args.base/(path+".json")).read_bytes())
        comp=json.loads((args.base/(path+".comp.json")).read_bytes())
        if slug=="banks" and set(group["members"])!=set(receipts):
            raise ValueError("Issuer receipts must match the published bank cohort")
        qi=comp["quarters"].index(q)
        gi=group["quarters"].index(q)
        fields=comp["fields"]
        if not all(k in fields for k in ("rev_q","rev_py","rev_ttm","gp_ttm","end")):
            raise ValueError("Unknown company input schema")
        rows={}
        for tk in group["members"]:
            arr=comp["data"][tk][qi]
            if arr is None:
                continue
            row=dict(zip(fields,arr))
            rows[tk]=row
            if tk not in receipts or row["end"]!=end_of(q):
                continue
            values={}
            for back in (0,1,2,3,4):
                period=shift(q,-back)
                value, point=revenue(tk,period)
                values[back]=value
                if point:
                    comp.setdefault("bank_revenue",{}).setdefault(tk,{})[period]=point
            row["rev_q"],row["rev_py"]=values[0], values[4]
            rev=total([values[i] for i in range(4)])
            bridge=receipts[tk]["trailing"].get(row["end"])
            if rev is None and bridge:
                rev=bridge["net_revenue"]
                comp.setdefault("bank_revenue_ttm",{}).setdefault(tk,{})[q]=bridge
            # The published gross-profit fallback is revenue less cost. When
            # it matches that fallback, keep it on the same revenue basis.
            if row["gp_ttm"] is None and rev is not None and row["cor_ttm"] is not None:
                row["gp_ttm"]=rev-row["cor_ttm"]
            row["rev_ttm"]=rev
            comp["data"][tk][qi]=[row[k] for k in fields]
        audit[slug]={}
        for k in AFFECTED:
            old={m:v[gi] for m,v in group["agg"][k].items()}
            new=aggregate(list(rows.values()),k)
            audit[slug][k]={"before":old,"after":new}
            for m,v in new.items():
                group["agg"][k][m][gi]=v
        for company in group["constituents"]:
            tk=company["tk"]
            if tk in receipts and tk in rows and company.get("q")==q:
                ratios=row_values(rows[tk])
                for k in ("rev_growth","gm","om"):
                    company[k]=six(ratios[k])
                company["ps"]=six(divide(company.get("mcap"),rows[tk]["rev_ttm"]))
        val=group["val_now"]
        for vr in val["rows"]:
            if vr[0] in receipts and vr[1]==q and vr[0] in rows:
                vr[4]=rows[vr[0]]["rev_ttm"]
        eligible=[vr for vr in val["rows"] if vr[4] is not None]
        val["ps"]=six(divide(sum(v[2] for v in eligible),sum(v[4] for v in eligible)))
        ratios=[v[2]/v[4] for v in eligible if v[4]>0]
        val["ps_med"]=six(statistics.median(ratios)) if ratios else None
        history=[(k,v) for k,v in zip(group["quarters"],group["agg"]["ps"]["agg"]) if v is not None and v>0][-40:]
        if len(history)>=8:
            vals=[v for _,v in history]
            group["val_range"]["ps"]={"n":len(vals),"med":six(statistics.median(vals)),"from":history[0][0],"to":history[-1][0],
                "min":min(vals),"max":max(vals),"min_q":min(history,key=lambda a:a[1])[0],"max_q":max(history,key=lambda a:a[1])[0]}
            if val["ps"] is not None:
                group["val_range"]["ps"]["pct"]=six(sum(v<=val["ps"] for v in vals)/len(vals))
        summary=next(x for x in overview["groups"] if x["slug"]==slug)
        for k in AFFECTED:
            if summary["latest"][k][0] == q or audit[slug][k]["after"]["agg"] is not None:
                summary["latest"][k]=[q,audit[slug][k]["after"]["agg"],audit[slug][k]["after"]["n"]]
        summary["val_now"]["ps"]=val["ps"]
        release[path+".json"]=group
        release[path+".comp.json"]=comp
    overview["filing_notes"]=filing_notes(overview,asof)
    manifest={}
    for path, file in release.items():
        if args.write_docs:
            dest = args.write_docs / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(pack(file))
        gz=gzip.compress(pack(file),mtime=0)
        encoded=base64.b64encode(gz).decode()
        parts=[encoded[i:i+60000] for i in range(0,len(encoded),60000)]
        for i,part in enumerate(parts):
            (root/(path.replace("/","_")+f".{i}.b64")).write_text(part)
        manifest[path]={"gzip_sha256":hashlib.sha256(gz).hexdigest(),"input_sha256":hashlib.sha256((args.base/path).read_bytes()).hexdigest(),"parts":len(parts)}
    (root/"manifest.json").write_bytes(pack(manifest))
    (root/"audit.json").write_bytes(pack(audit))
    print({slug:{k:(audit[slug][k]["before"]["n"],audit[slug][k]["after"]["n"],audit[slug][k]["after"]["agg"]) for k in ("rev_growth","nm")} for slug in audit})


if __name__=="__main__":
    main()
