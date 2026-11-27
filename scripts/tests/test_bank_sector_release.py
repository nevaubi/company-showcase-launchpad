import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SCRIPTS))
from lib.bank_filing_revenue import NET_INTEREST, NONINTEREST, extract


def module(name, file):
    spec=importlib.util.spec_from_file_location(name,SCRIPTS/file)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


release=module("release","bank-sector-release.py")
worker=module("worker","bank-sector-worker.py")
LAST="0000000123-26-000001"
PREV="0000000123-25-000001"
ANNUAL="0000000123-26-000002"


def obs(start,end,accn=LAST,form="10-Q",filed="2026-11-01",val=10):
    return dict(start=start,end=end,accn=accn,form=form,filed=filed,val=val)


def raw(rows):
    return json.dumps({"cik":123,"facts":{"us-gaap":{tag:{"units":{"USD":vals}} for tag,vals in rows.items()}}}).encode()


class FilingArithmetic(unittest.TestCase):
    def extract(self, rows):
        return extract(raw(rows),123,"2024-01-01","2026-11-26")

    def test_quarter_requires_same_filing_period_and_both_gaap_concepts(self):
        a=obs("2026-07-01","2026-09-30")
        for b in [dict(a,accn=PREV),dict(a,start="2026-01-01"),dict(a,filed="2026-11-27")]:
            self.assertEqual(self.extract({NET_INTEREST:[a], NONINTEREST:[b]})["periods"], {})
        x=self.extract({NET_INTEREST:[a],NONINTEREST:[dict(a,val=6)],"Revenues":[dict(a,val=16)]})["periods"][a["end"]]
        self.assertEqual((x["net_revenue"],x["reconciled_to"]),(16,["Revenues"]))
        self.assertTrue(x["filing_url"].endswith(LAST+"-index.htm"))

    def test_conflicting_total_and_ambiguous_same_end_withhold_period(self):
        a=obs("2026-07-01","2026-09-30")
        r=self.extract({NET_INTEREST:[a],NONINTEREST:[dict(a,val=2)],"Revenues":[dict(a,val=13)]})
        self.assertIn(a["end"],r["conflicting_periods"])
        b=dict(a,start="2026-07-03")
        self.assertEqual(self.extract({NET_INTEREST:[a,b],NONINTEREST:[a,b]})["periods"],{})

    def test_trailing_bridge_rejects_restated_comparative(self):
        a=obs("2025-01-01","2025-12-31",accn=ANNUAL,form="10-K",filed="2026-02-01",val=40)
        b=obs("2026-01-01","2026-09-30",val=35)
        c=obs("2025-01-01","2025-09-30",val=30)
        original=dict(c,accn=PREV,filed="2025-11-01")
        rows=[a,b,c,original]
        good=self.extract({NET_INTEREST:rows,NONINTEREST:rows})
        self.assertEqual(good["trailing"]["2026-09-30"]["net_revenue"],90)
        mismatch=self.extract({NET_INTEREST:[a,b,c,dict(original,val=29)],NONINTEREST:rows})
        self.assertNotIn("2026-09-30",mismatch["trailing"])

    def test_worker_preserves_supported_total_and_drops_changed_unattested_row(self):
        a=obs("2026-07-01","2026-09-30",val=9)
        prior={"reported_inputs":{a["end"]:{"value":1,"concept":"fee"}}}
        publish={"2026Q3":{"end":a["end"],"rev_q":9}}
        selected=worker.resolve_reported(raw({"Revenues":[a]}),"B","2026-11-26",publish,prior)
        self.assertEqual((selected[0]["concept"],selected[0]["value"],selected[0]["accession"]),("Revenues",9,LAST))
        self.assertEqual(worker.resolve_reported(raw({}),"B","2026-11-26",publish,prior),[])

    def test_growth_uses_matched_pairs_and_amount_weighted_sum(self):
        blank={k:None for k in ("rev_ttm","ocf_ttm","capex_ttm","gp_ttm","oi_ttm","ni_ttm","mcap")}
        rows=[dict(blank,rev_q=20,rev_py=10),dict(blank,rev_q=110,rev_py=100),dict(blank,rev_q=15,rev_py=None)]
        out=release.aggregate(rows,"rev_growth")
        self.assertEqual(out["n"],2)
        self.assertAlmostEqual(out["agg"],130/110-1,places=6)
