"""Reconcile same-filing US GAAP bank revenue, preserving the filing inputs."""
import datetime as dt
import hashlib
import json
import math
import re
from collections import defaultdict

NET_INTEREST = "InterestIncomeExpenseNet"
NONINTEREST = "NoninterestIncome"
REPORTED = ("RevenuesNetOfInterestExpense", "Revenues")


def source_url(cik):
    return f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json"


def extract(raw, cik, start, as_of):
    """Only pair USD values in the same fiscal quarter, accession and filing."""
    source = json.loads(raw)
    if int(source["cik"]) != int(cik):
        raise ValueError("Mismatched SEC issuer")
    gaap = source["facts"].get("us-gaap", {})
    contexts = defaultdict(lambda: defaultdict(set))
    for concept in (NET_INTEREST, NONINTEREST, *REPORTED):
        for row in gaap.get(concept, {}).get("units", {}).get("USD", []):
            s, e, accession = row.get("start"), row.get("end"), row.get("accn", "")
            filed, form, value = row.get("filed", ""), row.get("form", ""), row.get("val")
            if (not s or not e or s < start or not e <= filed <= as_of or
                    form not in {"10-Q", "10-K", "10-Q/A", "10-K/A"} or
                    not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession) or
                    isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
                continue
            days = (dt.date.fromisoformat(e) - dt.date.fromisoformat(s)).days + 1
            if 75 <= days <= 105 or (s.endswith("-01-01") and e[:4] == s[:4] and e[5:] in {"06-30", "09-30", "12-31"}):
                contexts[s, e, filed, accession, form][concept].add(value)
    latest, by_filing = {}, {}
    for (s, e, filed, accession, form), tags in sorted(contexts.items(), key=lambda kv: kv[0][2:]):
        if NET_INTEREST not in tags or NONINTEREST not in tags:
            continue
        # Withhold the period if the newest paired filing contains conflicting
        # values or disagrees with a tagged consolidated total, including FTE.
        if any(len(values) != 1 for values in tags.values()):
            latest[s, e] = None
            continue
        nii, fees = next(iter(tags[NET_INTEREST])), next(iter(tags[NONINTEREST]))
        total = nii + fees
        excluded = {}
        # CBSH's original iXBRL applies Revenues=0 to “no material intersegment
        # revenues”. It is a segment disclosure, not the consolidated income line.
        # Limit the exception to the reviewed filing and its two verified periods.
        cbsh_values = {("2026-07-01","2026-09-30"):(308877000,185466000),
                       ("2025-07-01","2025-09-30"):(279457000,161511000)}
        if (int(cik) == 22356 and accession == "0000022356-26-000213" and
                tags.get("Revenues") == {0} and (nii, fees) == cbsh_values.get((s,e))):
            excluded["Revenues"] = {"value":0, "scope":"intersegment", "filing_section":"Business Segment Data",
                "source_text":"There were no material intersegment revenues between the three segments.",
                "filing_url":"https://www.sec.gov/Archives/edgar/data/22356/000002235626000213/cbsh-20260930.htm"}
        reported = [tag for tag in REPORTED if tag in tags and tag not in excluded]
        if any(next(iter(tags[tag])) != total for tag in reported):
            latest[s, e] = None
            continue
        point = {"start": s, "end": e, "filed": filed, "accession": accession, "form": form,
                     NET_INTEREST: nii, NONINTEREST: fees, "net_revenue": total,
                     "reconciled_to": reported,
                     "filing_url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{accession}-index.htm"}
        if excluded:
            point["excluded_subtotals"] = excluded
        latest[s, e] = by_filing[s, e, accession] = point
    def quarterly(s, e):
        return 75 <= (dt.date.fromisoformat(e) - dt.date.fromisoformat(s)).days + 1 <= 105
    by_end = {}
    for (s, e), point in latest.items():
        if quarterly(s, e):
            by_end[e] = None if e in by_end else point
    ttm = {}
    for (s, e), current in latest.items():
        if not current or s[5:] != "01-01" or e[:4] != s[:4] or e[5:] not in {"03-31", "06-30", "09-30", "12-31"}:
            continue
        if e.endswith("-12-31"):
            ttm[e] = {"net_revenue": current["net_revenue"], "annual": current}
            continue
        prior_year = str(int(s[:4]) - 1)
        prior_start, prior_end = prior_year + s[4:], prior_year + e[4:]
        annual = latest.get((prior_start, prior_year + "-12-31"))
        prior = by_filing.get((prior_start, prior_end, current["accession"]))
        if not prior or not annual or current["filed"] < annual["end"]:
            continue
        # A change in a comparative or a reporting basis can make the
        # annual/YTD bridge unreliable. Require the two components to agree
        # across the current comparative and the fiscal year's original 10-Q.
        original = [v for (a, b, _), v in by_filing.items() if a == prior_start and b == prior_end and v["filed"] <= annual["end"]]
        if not original or not all(v[NET_INTEREST] == prior[NET_INTEREST] and v[NONINTEREST] == prior[NONINTEREST] for v in original):
            continue
        ttm[e] = {"net_revenue": annual["net_revenue"] + current["net_revenue"] - prior["net_revenue"],
                  "annual": annual, "current_ytd": current, "prior_ytd": prior}
    return {"cik": int(cik), "source_url": source_url(cik), "sha256": hashlib.sha256(raw).hexdigest(),
            "periods": {end: row for end, row in sorted(by_end.items()) if row},
            "conflicting_periods": sorted(end for end, row in by_end.items() if row is None),
            "trailing": ttm}
