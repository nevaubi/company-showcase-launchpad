"""Build private archive records from reviewed issuer originals. Run on a downloaded PDF or HTML;
the input manifest supplies ticker, date, fiscal quarter, source URL and expected binary SHA-256.
Preserve the original bytes alongside parsed turns. Fail closed on partial/unrecognized documents.
Optional --sql-file writes an idempotent transaction for a service administrator. The script does
not connect to production. Existing private originals are reused only after SHA and path verification.
"""
import argparse
import base64
from collections import Counter
from datetime import date
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit


def compact(value):
    return " ".join(value.replace("\u200b", "").replace("\ufeff", "").split())


def serialized(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Transcript:
    def __init__(self):
        self.turns = []
        self.speakers = {}
        self.section = "prepared"
        self.current = None

    def speaker(self, name, kind, role=None, firm=None):
        if kind == "analyst":
            self.section = "qa"
        if name not in self.speakers:
            self.speakers[name] = dict(idx=len(self.speakers), name=name, kind=kind, role=role,
                                       firm=firm, turns=0, words=0)
        self.current = dict(i=len(self.turns), sp=self.speakers[name]["idx"], sec=self.section, parts=[])
        self.turns.append(self.current)

    def line(self, text, page):
        if self.current is not None and text:
            self.current.setdefault("p", page)
            self.current["parts"].append(text)

    def finish(self):
        by_idx = {s["idx"]: s for s in self.speakers.values()}
        complete = []
        for turn in self.turns:
            text = compact(" ".join(turn.pop("parts")))
            if not text:
                continue
            turn.update(i=len(complete), x=text, w=len(text.split()))
            s = by_idx[turn["sp"]]
            s["words"] += turn["w"]
            s["turns"] += 1
            complete.append(turn)
        counts = Counter(by_idx[t["sp"]]["kind"] for t in complete)
        if counts["management"] < 2 or counts["analyst"] < 2 or sum(t["w"] for t in complete) < 2500:
            raise ValueError("The source does not contain a complete management presentation and Q&A")
        return list(self.speakers.values()), complete


def pdf_lines(path):
    output = subprocess.check_output(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"]).decode("utf8")
    return [(page, compact(line)) for page, text in enumerate(output.split("\f"), 1)
            for line in text.splitlines() if compact(line)]


def bank_of_america(path, record):
    source = pdf_lines(path)
    lines = [text for _, text in source]
    title = lines[1]
    expected = date.fromisoformat(record["date"]).strftime("%B %d, %Y").replace(" 0", " ")
    if lines[0] != "Bank of America" or lines[2] != expected or record["quarterWord"] not in title:
        raise ValueError("Issuer, quarter or event date mismatch")
    start, end = lines.index("Presentation"), lines.index("Disclaimer")
    roster = {"operator": ("Operator", "operator", None, None)}
    for line in lines[:start]:
        parts = re.split(r"\s+[–-]\s+", line, maxsplit=1)
        if len(parts) != 2:
            continue
        name, affiliation = parts
        firm, sep, role = affiliation.partition(", ")
        management = firm == "Bank of America"
        roster[name.lower().replace("’", "'")] = (name, "management" if management else "analyst",
                                                   role if management and sep else None,
                                                   firm if management else affiliation)
    # The Q1 2026 participant list spells Glenn Schorr's surname with a single final r.
    if "glenn schor" in roster:
        _, kind, role, firm = roster["glenn schor"]
        roster["glenn schorr"] = ("Glenn Schorr", kind, role, firm)
    result = Transcript()
    for page, line in source[start + 1:end]:
        if line in (title, expected) or line.isdigit():
            continue
        if line == "Q&A":
            result.section = "qa"
        elif member := roster.get(line.lower().replace("’", "'")):
            result.speaker(*member)
        else:
            result.line(line, page)
    return result.finish()


def alphabet(path, record):
    source = pdf_lines(path)
    if not any("Alphabet" in x for _, x in source[:7]) or not any(record["quarterWord"] in x for _, x in source[:7]):
        raise ValueError("Alphabet earnings-call header mismatch")
    result = Transcript()
    for page, line in source:
        if line.isdigit():
            continue
        if re.match(r"^Operator:", line):
            name, kind, role, firm, rest = "Operator", "operator", None, None, line.partition(":")[2]
            if result.turns and re.search(r"as a reminder, to ask a question|our first question|first question comes", rest, re.I):
                result.section = "qa"
        elif m := re.match(r"^([A-Z][\w’'.-]+(?: [A-Z][\w’'.-]+){1,3})(?:, ([^:]{2,55})| \(([^()]{1,40})\)):\s*(.*)$", line):
            name, label, parenthetical, rest = m.groups()
            management = bool(label and re.search(r"\b(CEO|CFO|CBO|Head of Investor Relations)\b", label))
            kind, role, firm = ("management", label, "Alphabet") if management else ("analyst", None, parenthetical or label)
        else:
            result.line(line, page)
            continue
        result.speaker(name, kind, role, firm)
        result.line(rest, page)
    return result.finish()


def microsoft(path, record):
    from lxml import html
    root = html.fromstring(path.read_bytes())
    # Only the issuer's transcript component. Navigation, related events and display duplicates
    # elsewhere in the page must never become remarks by the final speaker.
    bodies = [el for el in root.xpath("//div[contains(concat(' ',normalize-space(@class),' '),' cmp-text ')]")
              if len(el.xpath("./p")) > 50 and "JONATHAN NEILSON:" in el.text_content()]
    if len(bodies) != 1:
        raise ValueError("Could not identify one Microsoft earnings transcript")
    lines = [compact(p.text_content()) for p in bodies[0].xpath("./p")]
    lines = [s for s in lines if s]
    expected = date.fromisoformat(record["date"]).strftime("%B %d, %Y").replace(" 0", " ")
    if not any(expected in s for s in lines[:6]) or not re.search(
        "FY" + record["label"][-2:] + r"\s+" + record["quarterWord"] + r" Quarter Earnings",
        compact(root.text_content()), re.I,
    ):
        raise ValueError("Microsoft event metadata mismatch")
    managers = {"SATYA NADELLA":"Chairman and CEO", "AMY HOOD":"EVP and CFO", "JONATHAN NEILSON":"Investor Relations"}
    result = Transcript()
    for line in lines:
        if line in ("END", "(Operator Direction.)"):
            continue
        if m := re.match(r"^([A-Z][A-Z ’'.-]+?)(?:, ([^:]{1,55}))?:\s*(.*)$", line):
            name, firm, rest = m.groups()
            if name in managers:
                kind, role, firm = "management", managers[name], "Microsoft"
            elif name == "OPERATOR":
                kind, role, firm = "operator", None, None
            else:
                kind, role = "analyst", None
            if re.search(r"(move|turn|switch|go).{0,22}(Q&A|questions)", rest, re.I):
                result.section = "qa"
            result.speaker(name.title(), kind, role, firm)
            result.line(rest, None)
        else:
            result.line(line, None)
    return result.finish()


def build(record, directory):
    ticker = record["ticker"]
    path = directory / record["file"]
    original = path.read_bytes()
    binary_hash = sha(original)
    if binary_hash != record["sha256"]:
        raise ValueError("Downloaded bytes do not match the reviewed source hash")
    host = urlsplit(record["url"]).hostname
    sources = {"BAC": ("d1io3yog0oux5.cloudfront.net", bank_of_america),
               "GOOGL": ("s206.q4cdn.com", alphabet), "MSFT": ("www.microsoft.com", microsoft)}
    expected_host, parse = sources[ticker]
    if host != expected_host or urlsplit(record["url"]).scheme != "https":
        raise ValueError("Unexpected issuer source origin")
    speakers, turns = parse(path, record)
    document_text = "\n".join(t["x"] for t in turns)
    text_hash = sha(document_text.encode())
    call_id = f"{ticker}-{record['date']}-{text_hash[:6]}"
    document = {"url": record["url"], "fiscal_label": record["label"], "sha256": binary_hash,
                "originalKey": "issuer-original:v1:" + binary_hash,
                "sourcePage": record["sourcePage"], "checkedOn": record["checkedOn"]}
    call = {"ticker": ticker, "call_id": call_id, "date": record["date"], "doc": binary_hash,
            "event_type": "earnings", "kind": "transcript", "label": record["label"],
            "n_turns": len(turns), "words": sum(s["words"] for s in speakers), "speakers": speakers,
            "sha": text_hash, "title": record["label"] + " earnings conference call", "pending": True}
    file = {"call_id": call_id, "turns": turns}
    source = {"mime": record["mime"], "sha256": binary_hash, "bytes": len(original), "sourceUrl": record["url"]}
    if record.get("existingOriginal"):
        source.update(encoding="storage-object", **record["existingOriginal"])
    else:
        compressed = gzip.compress(original, mtime=0)
        source.update(encoding="gzip+base64", data=base64.b64encode(compressed).decode(), storedSha256=sha(compressed))
    return {"ticker": ticker, "doc": document, "call": call, "original": source,
            "turns": {"file": file, "ticker": ticker, "sourceHash": text_hash, "sourceUrl": record["url"],
                      "kind": "transcript", "sha256": sha(serialized(file).encode()), "documentSha256": binary_hash}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("sources", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sql-file", type=Path)
    args = parser.parse_args()
    reviewed = []
    args.output.mkdir(parents=True, exist_ok=True)
    for record in json.loads(args.manifest.read_text()):
        result = build(record, args.sources)
        reviewed.append(result)
        (args.output / (result["call"]["call_id"] + ".json")).write_text(serialized(result))
    if args.sql_file:
        with args.sql_file.open("w") as sql:
            sql.write("BEGIN;\nCREATE TEMP TABLE reviewed_call_import(document jsonb) ON COMMIT DROP;\n")
            for result in reviewed:
                wire = base64.b64encode(serialized(result).encode()).decode()
                sql.write("INSERT INTO reviewed_call_import VALUES(convert_from(decode('" + wire + "','base64'),'utf8')::jsonb);\n")
            sql.write(Path(__file__).with_name("transcript-primary-publish.sql").read_text())
            sql.write("COMMIT;\n")
