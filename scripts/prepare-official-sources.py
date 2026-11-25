#!/usr/bin/env python3
"""Prepare immutable, source-native research datasets without copying large files.

The output is a manifest accepted by official-source-ingest. Source bytes stay in
place; content-addressed chunks describe ranges an uploader can stream. Values
remain source strings, including blanks, leading zeros and disclosure markers.
Nothing is uploaded, published, or written to a database by this command.

Example:
  python scripts/prepare-official-sources.py --data-root ../sector_data \
    --archive-root ../data_archives --output-dir ../prepared_sources \
    --sector-map ../integration_audit/sectors/source_native_mapping.json
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sys
from typing import Any

CHUNK_BYTES = 32 * 1024 * 1024
SCHEMA_VERSION = 1
EXCLUDED_METADATA = {"_PACKAGE_INDEX.csv", "validation_checks.csv", "csv_manifest.csv"}
LEXICAL_MARKERS = {"NA", "N/A", "(D)", "(NA)", "W", "*", ".", "-", "--", "NM", "(S)"}
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def sha_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compact_write(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(path)


def is_tabular(path: Path) -> bool:
    name = path.name.lower()
    return name.endswith((".csv", ".tsv", ".csv.gz", ".tsv.gz"))


def is_metadata(path: Path) -> bool:
    return path.name in EXCLUDED_METADATA or path.name.startswith("validation_")


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def dataset_id(relative: str) -> str:
    # Include the relative directory so repeated source filenames do not collide.
    normalized = relative.removesuffix(".gz")
    normalized = re.sub(r"\.(csv|tsv)$", "", normalized, flags=re.I)
    readable = slug(normalized)
    return "official_" + readable[:145] + "_" + sha_text(relative)[:10]


def content_type(path: Path) -> str:
    if path.name.lower().endswith(".gz"):
        return "application/gzip"
    if path.suffix.lower() == ".zip":
        return "application/zip"
    if path.suffix.lower() == ".tsv":
        return "text/tab-separated-values"
    return "text/csv"


def chunk_file(path: Path) -> dict[str, Any]:
    """Hash the source and chunk ranges in one pass; do not materialize chunks."""
    whole = hashlib.sha256()
    chunks = []
    offset = 0
    with path.open("rb") as handle:
        while block := handle.read(CHUNK_BYTES):
            whole.update(block)
            digest = hashlib.sha256(block).hexdigest()
            chunks.append({"index": len(chunks), "path": f"official/objects/{digest}",
                           "sha256": digest, "bytes": len(block),
                           "local_path": str(path), "local_source_path": str(path),
                           "local_offset": offset})
            offset += len(block)
    if offset != path.stat().st_size:
        raise ValueError(f"Source changed during hashing: {path}")
    return {"sha256": whole.hexdigest(), "bytes": offset, "content_type": content_type(path),
            "chunks": chunks, "local_path": str(path), "local_source_path": str(path), "provenance": {}}


def binary_input(path: Path):
    return gzip.open(path, "rb") if path.name.lower().endswith(".gz") else path.open("rb")


def detect_format(path: Path) -> tuple[str, str, str]:
    with binary_input(path) as handle:
        sample = handle.read(128 * 1024)
    if sample.startswith(b"\xff\xfe"):
        encoding, python_encoding = "utf-16le", "utf-16"
    elif sample.startswith(b"\xfe\xff"):
        raise ValueError("UTF-16BE is not supported by the ingestion worker")
    else:
        try:
            # A sample can end inside a valid multibyte sequence.
            sample.decode("utf-8-sig", errors="strict")
            encoding, python_encoding = "utf-8", "utf-8-sig"
        except UnicodeDecodeError as error:
            if error.reason == "unexpected end of data":
                encoding, python_encoding = "utf-8", "utf-8-sig"
            else:
                encoding, python_encoding = "windows-1252", "cp1252"
    decoded = sample.decode(python_encoding, errors="replace")
    delimiter = "\t" if ".tsv" in path.name.lower() else ","
    try:
        inferred = csv.Sniffer().sniff(decoded, delimiters=",\t|")
        delimiter = inferred.delimiter
    except csv.Error:
        pass
    return encoding, python_encoding, delimiter


def read_native(path: Path, python_encoding: str, delimiter: str):
    with binary_input(path) as binary:
        with io.TextIOWrapper(binary, encoding=python_encoding, newline="") as text:
            yield from csv.reader(text, delimiter=delimiter, strict=True)


def scan_native(path: Path) -> dict[str, Any]:
    encoding, python_encoding, delimiter = detect_format(path)
    reader = iter(read_native(path, python_encoding, delimiter))
    header = next(reader, [])
    if header:
        header[0] = header[0].removeprefix("\ufeff")
    if not header:
        raise ValueError("Source has no header")
    blank_counts = [0] * len(header)
    markers = Counter()
    width_errors = []
    row_count = 0
    sample = None
    geo_codes = {name: {"nonempty": 0, "invalid": 0, "examples": []}
                 for name in header if name in {"FIPS code", "Five-Digit ZIP Code", "tract", "FIPSST", "STCNTYBR"}}
    geo_checks = [(header.index(name), name, {"FIPS code": 5, "Five-Digit ZIP Code": 5, "tract": 11, "FIPSST": 2, "STCNTYBR": 5}[name])
                  for name in geo_codes]
    for row_count, row in enumerate(reader, 1):
        if sample is None:
            sample = row
        if len(row) != len(header):
            if len(width_errors) < 20:
                width_errors.append({"source_row": row_count, "expected": len(header), "actual": len(row)})
            continue
        for i, value in enumerate(row):
            if value == "":
                blank_counts[i] += 1
            elif value in LEXICAL_MARKERS:
                markers[value] += 1
        for pos, name, width in geo_checks:
            value = row[pos]
            if value == "":
                continue
            geo_codes[name]["nonempty"] += 1
            if not re.fullmatch(rf"[0-9]{{{width}}}", value):
                geo_codes[name]["invalid"] += 1
                if len(geo_codes[name]["examples"]) < 4:
                    geo_codes[name]["examples"].append(value)
    if width_errors:
        raise ValueError("Source row width does not match header: " + json.dumps(width_errors[:3]))
    return {"encoding": encoding, "delimiter": delimiter, "header": header, "rows": row_count,
            "blank_counts": blank_counts, "lexical_marker_counts": dict(markers),
            "duplicate_header_labels": {key: count for key, count in Counter(header).items() if count > 1},
            "geo_identifier_validation": geo_codes, "first_row": sample or []}


def original_to_relative(value: str, collection: str) -> str | None:
    value = value.replace("\\", "/")
    for anchor in ("/sector_build/", "/sector_data/"):
        if anchor in value:
            return value.split(anchor, 1)[1]
    if value.startswith(collection + "/"):
        return value
    return None


def load_specs(data_root: Path):
    registries = defaultdict(dict)
    sheets_by_file = defaultdict(list)
    raw_evidence = defaultdict(list)
    for collection_path in sorted(data_root.iterdir()):
        if not collection_path.is_dir():
            continue
        collection = collection_path.name
        # Later final/addendum entries enrich source metadata; all original source
        # statuses remain available in collection specifications preserved in ZIP.
        paths = sorted(collection_path.glob("workbook*.json"),
                       key=lambda p: ("final" in p.name, "identity_addendum" in p.name, p.name))
        paths = [p for p in paths if "portable" not in p.name]
        for path in paths:
            spec = json.loads(path.read_text(encoding="utf-8-sig"))
            for source in spec.get("sources", []):
                if source.get("source_id"):
                    registries[collection][source["source_id"]] = source
            for sheet in spec.get("sheets", []):
                for key in ("csv", "full_csv"):
                    source_path = sheet.get(key)
                    if source_path:
                        relative = original_to_relative(source_path, collection)
                        if relative:
                            sheets_by_file[relative].append({**sheet, "_spec": path.name, "_path_role": key})
                        sheets_by_file[collection + "/" + Path(source_path).name].append({**sheet, "_spec": path.name, "_path_role": key})
            for evidence in spec.get("raw_files", []):
                if not isinstance(evidence, dict) or not evidence.get("path"):
                    continue
                relative = original_to_relative(evidence["path"], collection)
                if relative and evidence not in raw_evidence[relative]:
                    raw_evidence[relative].append(evidence)
        for path in collection_path.rglob("*.provenance.json"):
            evidence = json.loads(path.read_text(encoding="utf-8-sig"))
            source_path = Path(str(path).removesuffix(".provenance.json"))
            relative = str(source_path.relative_to(data_root))
            if evidence not in raw_evidence[relative]:
                raw_evidence[relative].append(evidence)
    return registries, sheets_by_file, raw_evidence


def primary_source_ids(relative: str, sheets, registries, sector_map):
    if relative in sector_map and sector_map[relative].get("source_ids"):
        return sector_map[relative]["source_ids"], "inspected_sector_mapping"
    linked = sorted({source for sheet in sheets for source in sheet.get("source_ids", [])})
    if linked:
        return linked, "workbook_specification"
    collection, name = relative.split("/", 1)[0], Path(relative).name
    registry = registries[collection]
    lower = name.lower()
    if "fed_z1_native_tables/" in relative:
        return ["FED_Z1"], "registered_complete_307_table_archive"
    if relative.startswith("04_energy/") and (name.startswith("MER_") or "/full_data_MER/" in relative):
        return ["EIA_MER"], "retained_MER_source_files_and_archive"
    if relative.startswith("07_materials/") and name.startswith("DS140_"):
        return ["USGS_DS140"], "registered_complete_DS140_source_workbooks"
    if name == "aircraft_assets.csv" and "FAA_REGISTRY" in registry:
        return ["FAA_REGISTRY"], "retained_complete_aircraft_master"
    if name in {"latest_all_banks_core.csv", "latest_insured_universe_core.csv"}:
        return ["FDIC_FINANCIALS"], "retained_FDIC_financials_universe_selection"
    if "nport_2026q3_range_extract/" in relative:
        return ["SEC_NPORT"], "retained_SEC_NPORT_source_archive_members"
    if name == "fred_electronics_ip.csv":
        return [sid for sid in registry if sid.startswith("FRED_IPG334")], "retained_official_FRED_multi_series_download"
    if name == "WB_TELECOM_Missing_Observations.csv":
        return [sid for sid in registry if sid.startswith("WB_TELECOM_IT_")], "retained_World_Bank_missing_observation_projection"
    rules = [
        (r"fdic_.*(dictionary|field_)", "FDIC_DICTIONARY"), (r"fdic_.*sod", "FDIC_SOD"),
        (r"fdic_.*fail", "FDIC_FAILURES"), (r"fdic_.*history", "FDIC_HISTORY"),
        (r"fdic_.*institution", "FDIC_INSTITUTIONS"), (r"fdic_.*summary", "FDIC_SUMMARY"),
        (r"fdic_", "FDIC_FINANCIALS"), (r"fed_nic|csv_attributes|csv_relationships", "FED_NIC"),
        (r"fed_.*y9|bhcf|bhcp|bhsp|bhcr", "FED_Y9"), (r"fed_h8", "FED_H8"), (r"fed_z1", "FED_Z1"),
        (r"ncua_", "NCUA_CALL"), (r"sec_nport", "SEC_NPORT"), (r"sec_nmfp|nmfp", "SEC_NMFP"),
        (r"sec_bdc", "SEC_BDC"), (r"ofr_", "OFR_STFM"),
        (r"hpi_at_tract", "FHFA_TRACT"), (r"hpi_master", "FHFA_MASTER"),
        (r"hpi_at_county", "FHFA_COUNTY"), (r"hpi_at_zip5", "FHFA_ZIP5"),
        (r"msha_.*controller", "MSHA_HISTORY"), (r"msha_.*contractor", "MSHA_CONTRACTOR"),
        (r"msha_.*mine", "MSHA_MINES"), (r"msha_", "MSHA_EMPLOYMENT"),
        (r"usgs_", "USGS_DS140"),
    ]
    for pattern, source in rules:
        if re.match(pattern, lower):
            if source in registry or source == "FHFA_TRACT":
                return [source], "source_filename_family"
    for directory, source in [("fed_nic_native", "FED_NIC"), ("fed_bhcf", "FED_Y9"), ("fed_bhcp", "FED_Y9"),
                              ("fed_bhsp", "FED_Y9"), ("ncua_2026q2_native", "NCUA_CALL"),
                              ("sec_nport", "SEC_NPORT"), ("sec_nmfp", "SEC_NMFP"), ("sec_bdc", "SEC_BDC")]:
        if directory in relative and source in registry:
            return [source], "source_directory_family"
    if "/raw/fred/" in relative:
        source = "FRED_" + Path(relative).stem
        return ([source], "FRED_source_filename") if source in registry else ([], "unresolved")
    if collection in {"12_sec_company_financials", "13_ir_integration", "14_source_atlas"}:
        return list(registry), "collection_specification"
    return [], "unresolved"


def priority(relative: str) -> tuple[int, str]:
    name = Path(relative).name
    if name == "fdic_top500_all_native_quarterly_2000_latest.csv":
        return 0, relative
    if name == "fdic_native_field_dictionary_and_coverage.csv":
        return 1, relative
    if name in {"TWSE_Revenue_All_Industries.csv", "TPEX_Revenue_All_Industries.csv"}:
        return 2, relative
    if name in {"hpi_at_county.csv", "hpi_at_zip5.csv", "hpi_master_all.csv", "hpi_at_tract.csv"}:
        return 3, relative
    if name == "selected_standard_facts.csv.gz":
        return 4, relative
    if "identity" in name or "dictionary" in name:
        return 5, relative
    if relative.startswith("01_financials/") and "/raw/" not in relative:
        return 6, relative
    return 10 if "/raw/" not in relative else 20, relative


def choose_index(header, names):
    for name in names:
        if name in header:
            return header.index(name)
    return None


def dimensions_for(relative: str, scan: dict, source_url: str | None):
    header = scan["header"]
    name = Path(relative).name
    dimensions, constants, coverage = {}, {}, {}
    if source_url:
        constants["source_url"] = source_url
    # Explicit source-native IDs; no automatic company/parent/entity matching.
    if relative.startswith("01_financials/") and "CERT" in header:
        entity_ids, entity_names, entity_type = ["CERT"], ["NAME", "Institution name", "Bank name"], "FDIC_certificate"
        coverage["identity_rule"] = "CERT identifies insured institution; ID identifies source record; RSSDHCR identifies regulatory parent and must not replace CERT."
    elif "TWSE" in name or "TPEX" in name:
        entity_ids, entity_names, entity_type = ["公司代號", "company_code"], ["公司名稱", "company_name", "short_name"], "listed_issuer"
    elif name.startswith("EIA860_") or name.startswith("EIA923_") or name.startswith("EGRID2023_"):
        entity_ids, entity_names, entity_type = ["Plant Code", "Plant Id", "ORISPL", "Utility ID"], ["Plant Name", "PNAME", "Utility Name"], "power_plant_or_reporting_utility"
        coverage["identity_rule"] = "Plant, generator, operator, owner, service utility and corporate parent are distinct. EIA923 99999 is a state adjustment."
    elif name.startswith("EIA861_"):
        entity_ids = ["Utility Characteristics | Utility Number", "Utility Number", "Balancing Authority Code"]
        entity_names = ["Utility Characteristics | Utility Name", "Utility Name", "Balancing Authority Name"]
        entity_type = "reporting_utility"
    elif name.startswith("FDA_") or name.startswith("OB_"):
        entity_ids, entity_names, entity_type = ["ApplNo", "Appl_No"], ["DrugName", "Trade_Name", "SponsorName"], "drug_application"
        coverage["identity_rule"] = "Products/submissions/statuses have separate child keys; application or ORIG submission is not automatically approval or marketed product."
    elif name.startswith("hpi_"):
        entity_ids, entity_names, entity_type = [], [], "housing_index_geography"
    elif "selected_standard_facts" in name or relative.startswith("12_sec_company_financials/"):
        entity_ids, entity_names, entity_type = ["CIK", "cik"], ["Company", "name"], "SEC_registrant"
    elif name.startswith("MSHA_"):
        entity_ids, entity_names, entity_type = ["MINE_ID"], ["CURRENT_MINE_NAME", "CURR_MINE_NM", "MINE_NAME"], "mine"
    elif name.startswith("BSEE_"):
        entity_ids, entity_names, entity_type = ["API Well Number", "Segment Num", "Operator Number", "MMS Company Num"], ["Bus Asc Name", "Sort Name"], "offshore_source_entity"
    else:
        entity_ids = ["nct_id", "cveID", "CU_NUMBER", "ID_RSSD", "RSSD_ID", "CIK", "Ticker", "ticker",
                      "N-NUMBER", "N Number", "N-number", "RCL_ID", "Recall ID", "SPIN", "provider_id", "Series Key", "Series code", "series_id"]
        entity_names = ["lead_sponsor_name", "vendorProject", "CU_NAME", "NAME", "Company", "company_name", "Registrant name", "provider_name", "Series name"]
        entity_type = "source_native_entity"
    for role, candidates in [("entity_id", entity_ids), ("entity_name", entity_names)]:
        index = choose_index(header, candidates)
        if index is not None:
            dimensions[role] = index
    if "entity_id" in dimensions:
        coverage["entity_type"] = entity_type
        coverage["entity_id_column"] = header[dimensions["entity_id"]]
    periods = ["REPDTE", "period_gregorian", "source_period_roc", "資料年月", "Fact period end", "Report period",
               "Document period", "YYYYMM", "observation_date", "Date", "date", "YEAR", "Year", "year", "yr",
               "CALENDAR_YR", "Data Year", "Utility Characteristics | Data Year", "Utility Characteristics | Year",
               "Characteristics | Data Year", "RPT_PERIOD", "DATE", "RPT_DATE", "REPORT_DATE"]
    index = choose_index(header, periods)
    if index is not None:
        dimensions["period"] = index
        coverage["period_index_is_native_text"] = True
        coverage["period_components"] = [h for h in header if h in {"YEAR", "Year", "year", "yr", "Month", "month", "period", "frequency", "hpi_type", "hpi_flavor"}]
    geo = [
        ("FIPS code", "county", None), ("Five-Digit ZIP Code", "zip5", None), ("tract", "census_tract", None),
        ("STCNTYBR", "county", "CNTYNAMB"),
        ("FIPSST", "state", None),
        ("place_id", None, "place_name"), ("Plant State", "state", None), ("PSTATABB", "state", None),
        ("state_abbr", "state", None), ("STATE_ABBR", "state", None), ("STALP", "state", None),
        ("Utility Characteristics | State", "state", None), ("State", "state", None), ("STATE", "state", None),
        ("state", "state", None), ("country_code", "country", "country_name"),
    ]
    for code, level, label in geo:
        if code not in header:
            continue
        validated = scan["geo_identifier_validation"].get(code)
        if validated and validated["invalid"] and code != "STCNTYBR":
            coverage.setdefault("geography_index_omissions", []).append({"column": code, "reason": "source values fail fixed-width code validation", **validated})
            continue
        dimensions["geo_code"] = header.index(code)
        if level is not None:
            constants["geo_level"] = level
        elif "level" in header:
            dimensions["geo_level"] = header.index("level")
        if label and label in header:
            dimensions["geo_name"] = header.index(label)
        elif code == "FIPS code" and "County" in header:
            dimensions["geo_name"] = header.index("County")
        break
    if "STCNTYBR" in header:
        coverage["geography_rule"] = "STCNTYBR is the branch county; STCNTY is the institution headquarters county. CNTYNUMB alone is not full county FIPS."
    if "geo_code" not in dimensions and "County" in header:
        constants["geo_level"] = "county_name"
        dimensions["geo_name"] = header.index("County")
        coverage["geography_rule"] = "County name is not a FIPS code; no inferred code or name crosswalk."
    source_index = choose_index(header, ["Source URL", "source_url", "Source filing URL", "url"])
    if source_index is not None:
        dimensions["source_url"] = source_index
        constants.pop("source_url", None)
    return dimensions, constants, coverage


def column_descriptors(relative, header, sheets, sector_info, fdic_dictionary, egrid_dictionary):
    units = {key: value for sheet in sheets for key, value in sheet.get("units", {}).items()}
    semantic = {c["name"]: c for c in sector_info.get("columns", [])}
    cols = []
    for index, label in enumerate(header):
        col = {"key": f"col{index + 1:04d}", "label": label, "type": "string"}
        if label in units:
            col.update({"unit": units[label], "basis": "Retained workbook source-unit specification; no value conversion"})
        if label in semantic:
            info = semantic[label]
            if info.get("unit"):
                col.update({"unit": info["unit"], "basis": info.get("unit_basis", "source metadata")})
            if info.get("source_description"):
                col["description"] = info["source_description"]
        if "fdic" in Path(relative).name.lower() and label in fdic_dictionary:
            native = fdic_dictionary[label]
            for field in ["title", "native_type", "unit", "period_basis", "unit_evidence"]:
                if native.get(field):
                    col[field] = native[field]
            if native.get("definition"):
                col["description"] = native["definition"]
            col["basis"] = "Official FDIC dictionary and source report definitions; native values retained"
        if "fdic" in Path(relative).name.lower() and label == "ID":
            col.update({"title": "FDIC source record identifier", "unit": "identifier",
                        "description": "Source ID is preserved as supplied; CERT is the institution identity and REPDTE is its reporting period."})
        if Path(relative).name.startswith("EGRID2023_"):
            table = Path(relative).name.split("_")[1]
            if (table, label) in egrid_dictionary:
                col["description"] = egrid_dictionary[(table, label)]
                col["basis"] = "eGRID2023 revision 2 source field dictionary"
        if relative.endswith("hpi_at_tract.csv"):
            if label in {"hpi", "hpi1990", "hpi2000"}:
                col["unit"] = "index" if label == "hpi" else "index; " + label[3:] + "=100"
            elif label == "annual_change":
                col["unit"] = "percent"
            elif label == "tract":
                col["unit"] = "11-character census tract identifier"
        cols.append(col)
    return cols


def merged_notes(sources, sheets, extra):
    values = []
    for source in sources:
        for key in ["limitations", "scope"]:
            if source.get(key) and source[key] not in values:
                values.append(source[key])
    for sheet in sheets:
        if sheet.get("notes") and sheet["notes"] not in values:
            values.append(sheet["notes"])
    if extra and extra not in values:
        values.append(extra)
    return "\n".join(values)


CANONICAL_TITLES = {
    "fdic_top500_all_native_quarterly_2000_latest.csv": ("FDIC bank financial statements — all reported quarters, 2000–2026Q2",
        "Institution-quarter observations for the validated 500-bank cohort selected in 2026Q2. All available quarterly records from 2000Q1 through 2026Q2 and all native fields are retained; this is not the complete historical universe of every insured bank.", "FDIC certificate / reporting quarter"),
    "TWSE_Revenue_All_Industries.csv": ("TWSE monthly operating revenue — all industries, October 2026",
        "Complete 1,091-issuer TWSE API snapshot for ROC reporting month 11510 (October 2026), retaining all native Chinese columns and comparators. Amounts are thousands of source reporting currency; the payload does not separately establish currency.", "exchange / listed issuer / reporting month"),
    "TPEX_Revenue_All_Industries.csv": ("TPEX monthly operating revenue — all industries, October 2026",
        "Complete 898-issuer TPEX API snapshot for ROC reporting month 11510 (October 2026), retaining all native Chinese columns and comparators. Amounts are thousands of source reporting currency; the payload does not separately establish currency.", "exchange / listed issuer / reporting month"),
    "hpi_at_county.csv": ("FHFA county House Price Index — complete annual history",
        "Complete retained annual county index history. Five-character county FIPS strings preserve leading zeros. Index levels, rebased indexes and annual percent change remain distinct; values are not dollar prices.", "county FIPS / year"),
    "hpi_at_zip5.csv": ("FHFA ZIP5 House Price Index — complete annual history",
        "Complete retained annual five-digit ZIP index history. ZIP identifiers preserve leading zeros. Index values and annual percent change are not property dollar prices.", "five-character ZIP / year"),
    "hpi_at_tract.csv": ("FHFA census tract House Price Index — complete annual source file",
        "Complete retained official FHFA annual census tract CSV, including the 11-character tract identifier, state, year, annual change and native/rebased indexes. This raw download was outside the workbook projections; its URL, retrieval time and full-file hash are retained.", "11-character census tract / year"),
    "hpi_master_all.csv": ("FHFA House Price Index — complete master history",
        "Complete retained FHFA master history across index types, flavors, frequencies and geographic levels. Keep all series-context fields; index bases and seasonal adjustments differ.", "index type / flavor / frequency / geography / year / period"),
    "MER_ALL_107_TABLES_ALL_HISTORY.csv": ("EIA Monthly Energy Review — all 107 tables and complete history",
        "Complete 737,825 source-context records from the 107 retained MER tables. Native units are row-specific; YYYYMM ending in 13 identifies annual values and 01–12 identifies monthly values. MSN alone is not unique across units or publication contexts.", "publication table / column / MSN / period"),
    "EIA923_Record_Monthly_Netgen_2020_2025_FULL.csv": ("EIA-923 monthly generation records — 2020–2025",
        "All 1,215,648 monthly net-generation records derived from the six final U.S. page-1 source releases. Plant, state, prime mover, fuel, nuclear unit, year and month remain distinct; this file does not contain operator IDs. Pseudo-plant 99999 denotes state adjustments.", "plant / state / prime mover / fuel / nuclear unit / year / month / source row"),
    "EIA923_Record_Annual_2020_2025_FULL.csv": ("EIA-923 annual generation and fuel records — 2020–2025",
        "All 101,304 annual source records from the six final U.S. page-1 source releases, including source-year operator fields, physical fuel units and annual generation/consumption. Source-year operators are not historical owners.", "plant / state / prime mover / fuel / nuclear unit / year / source row"),
    "EIA923_Plant_Annual_2020_2025_FULL.csv": ("EIA-923 plant annual generation and consumption — 2020–2025",
        "Complete retained plant-year aggregation of source generation and consumption, with reporting-year plant and operator attributes. This table is an aggregation of the detailed fuel records and must not be added to them.", "plant / state / year"),
    "EGRID2023_PLNT23_FULL.csv": ("EPA eGRID2023 revision 2 — complete plant table",
        "Complete 12,612-plant, 150-column table for data year 2023 from the revision-2 workbook published under the June 2025 source path. Native US customary emission units and rates are retained; the data year is not 2025.", "plant / data year / source revision"),
    "CMS_PartD_2024_full.csv": ("CMS Medicare Part D spending — all manufacturers, 2020–2024",
        "Complete 14,536-row, 46-column 2024 source release with all five annual measure sets. Overall manufacturer rows overlap named manufacturers and cannot be summed together. Gross spending excludes manufacturer rebates; suppression and outlier flags remain intact.", "drug brand / generic / manufacturer scope with annual measure columns"),
    "FDA_Submissions_full.csv": ("Drugs@FDA — all original and supplemental submissions",
        "Complete 194,613-row submissions table in the retrieved FDA snapshot, including original and supplemental records and their published statuses. An original submission is not automatically an approval.", "application / submission type / submission number"),
    "EIA814_Company_Imports_2016_2025_FULL.csv": ("EIA company petroleum imports — complete 2016–2025 source records",
        "Complete retained company-level import records for all ten source years. Quantities are thousand barrels; sulfur and API gravity retain their own units. Source record IDs are snapshot-specific. These file totals exclude certain estimates included in published aggregate EIA totals.", "source import record / reporting month"),
    "EV_Charging_Microdata_201506_202609_FULL.csv": ("EIA charging-port microdata — complete June 2015–September 2026 history",
        "Complete 183,547-row location-port/network-context source file with 136 monthly port-count columns. Blank observations remain missing; location and port IDs do not identify corporate parents. Wide native source rows are retained without expanding cells into duplicated records.", "location / port / network context with monthly port-count columns"),
}


def dataset_caption(relative, linked, sources, rows, columns):
    name = Path(relative).name
    if name in CANONICAL_TITLES:
        title, description, grain = CANONICAL_TITLES[name]
        return title, description + f" Retained table: {rows:,} source rows and {columns:,} columns.", grain
    direct = [sheet for sheet in linked if sheet.get("_path_role") == "csv"]
    title = next((sheet.get("title") or sheet.get("name") for sheet in direct if sheet.get("title") or sheet.get("name")), None)
    if not title:
        title = name.removesuffix(".gz").rsplit(".", 1)[0].replace("_", " ")
    description = next((sheet.get("description") for sheet in direct if sheet.get("description")), None)
    if not description:
        description = "Complete retained source table with all original fields and records from this file."
    description += f" Retained table: {rows:,} source rows and {columns:,} columns."
    grain = next((source.get("granularity") for source in sources if source.get("granularity")), "Source table record; see source identifiers and retained reference tables")
    return title, description, grain


def attach_index_rules(snapshot):
    labels = [column["label"] for column in snapshot["columns"]]
    name = Path(snapshot["source_path"]).name
    if name.startswith("EIA923_") or name == "State_fuel_monthly.csv":
        if "YEAR" in labels and "Month" in labels:
            snapshot["ingest"]["composites"] = {"period": {"indices": [labels.index("YEAR"), labels.index("Month")], "separator": "-", "format": "year_month"}}
            snapshot["ingest"]["dimensions"].pop("period", None)
            snapshot["coverage"].update({"period_frequency": "monthly", "period_search_index_rule": "Validated native YEAR and Month; month zero-padded in search index only. Source values remain unchanged."})
    if "STCNTYBR" in labels:
        snapshot["ingest"]["dimensions"]["geo_code"] = labels.index("STCNTYBR")
        snapshot["ingest"].setdefault("constants", {})["geo_level"] = "county"
        snapshot["ingest"]["geo_code_format"] = "county_fips_5"
        snapshot["coverage"]["geography_rule"] = "Branch county STCNTYBR only: validated 4/5-digit numeric source code is zero-padded to five in the search index. Native values unchanged; missing/invalid codes are unindexed. STCNTY county names and CNTYNUMB components are not used."


def refresh_metadata(args):
    """Enrich a prepared manifest without changing source bytes or chunk hashes."""
    data_root, output = args.data_root.resolve(), args.output_dir.resolve()
    manifest = json.loads((output / "manifest.json").read_text())
    old_files_fingerprint = sha_text(json.dumps([(f["sha256"], [(c["path"], c["sha256"], c["bytes"]) for c in f["chunks"]]) for f in manifest["files"]], separators=(",", ":")))
    registries, sheets_by_file, raw_evidence = load_specs(data_root)
    saved = json.loads((output / "source_registries.json").read_text())
    for collection, sources in saved.items():
        registries[collection].update(sources)
    sector_map = {}
    if args.sector_map:
        source_map = json.loads(args.sector_map.read_text())
        sector_map = {d["relative_path"]: d for d in source_map.get("datasets", [])}
    files = {f["sha256"]: f for f in manifest["files"]}
    datasets = {d["id"]: d for d in manifest["datasets"]}
    quarantines = []
    for snap in manifest["snapshots"]:
        relative = snap["source_path"]
        collection, name = relative.split("/", 1)[0], Path(relative).name
        linked = sheets_by_file.get(relative, sheets_by_file.get(collection + "/" + name, []))
        if not linked and "/raw/" in relative:
            linked = sheets_by_file.get(collection + "/" + name.removesuffix(".csv") + "_normalized.csv", [])
        source_ids, source_linkage = primary_source_ids(relative, linked, registries, sector_map)
        evidence = raw_evidence.get(relative, [])
        exact_downloads = [e for e in evidence if e.get("sha256") == snap["file_sha256"] and e.get("url")]
        if not source_ids and exact_downloads:
            # A retained, hash-matching official download is direct evidence even
            # when the workbook index omitted a named registry row.
            source_id = "RETAINED_RAW_" + slug(name).upper()
            ev = exact_downloads[0]
            registries[collection][source_id] = {"source_id": source_id, "provider": "Official publisher identified by retained source URL",
                "dataset": name, "access_url": ev["url"], "verified_at": ev.get("retrieved_at"), "status": "DATA_RETRIEVED",
                "granularity": "Native source table record; retain source column definitions", "registry_origin": "hash_matching_retained_raw_download",
                "raw_evidence": ev, "limitations": "Source table scope follows the retained file; no company-parent mapping or inferred metric conversion."}
            source_ids, source_linkage = [source_id], "hash_matching_retained_raw_download"
        sources = [registries[collection][source_id] for source_id in source_ids if source_id in registries[collection]]
        evidence_urls = sorted({e.get("url") or e.get("final_url") for e in evidence if e.get("url") or e.get("final_url")})
        urls = evidence_urls or sorted({s.get("access_url") or s.get("official_url") for s in sources if s.get("access_url") or s.get("official_url")})
        source_url = urls[0] if len(urls) == 1 else None
        exact_times = sorted({e.get("retrieved_at") for e in evidence if e.get("retrieved_at")})
        times = exact_times or sorted({s.get("verified_at") for s in sources if s.get("verified_at")})
        snap["retrieved_at"] = times[0] if len(times) == 1 else None
        snap["published_at"] = None
        snap["coverage"].update({"source_ids": source_ids, "source_linkage_basis": source_linkage, "source_urls": urls, "source_retrieval_times": times})
        # STCNTY is a county-name field in the financials file; do not claim a
        # failed FIPS check on a correctly retained county name.
        snap["quality"].get("geo_identifier_validation", {}).pop("STCNTY", None)
        snap["coverage"].pop("geography_index_omissions", None)
        labels = [column["label"] for column in snap["columns"]]
        dims, constants, extra = dimensions_for(relative, {"header": labels, "geo_identifier_validation": snap["quality"].get("geo_identifier_validation", {})}, source_url)
        snap["ingest"]["dimensions"] = dims
        snap["ingest"]["constants"] = constants
        snap["coverage"].update(extra)
        attach_index_rules(snap)
        d = datasets[snap["dataset_id"]]
        d["name"], d["description"], d["grain"] = dataset_caption(relative, linked, sources, snap["expected_rows"], len(labels))
        d["source_id"] = source_ids[0] if len(source_ids) == 1 else None
        d["source_url"] = source_url
        d["agency"] = "; ".join(sorted({s.get("provider") for s in sources if s.get("provider")})) or "Source attribution unresolved"
        d["notes"] = merged_notes(sources, [s for s in linked if s.get("_path_role") == "csv"], "Source values and disclosure flags are unchanged. Retrieval time does not establish historical public availability.")
        if source_ids == ["SPEC_REGISTRY"]:
            snap["coverage"]["source_reference"] = "Hashed finalized collection specifications retained in 14_source_atlas/raw/specifications and original archive; derived metadata catalogue, not independent observations."
        if not source_ids or (not urls and source_ids != ["SPEC_REGISTRY"]):
            reason = "No verified source-registry association or hash-matching direct-download provenance was found for this retained table. Original file bytes are preserved; research publication is quarantined."
            snap.update({"status": "failed", "loaded_rows": 0})
            snap["quality"].update({"quarantined": True, "quarantine_reason": reason})
            quarantines.append({"path": relative, "rows": snap["expected_rows"], "snapshot_id": snap["id"], "reason": reason})
        else:
            snap["status"] = "staging"
            snap["quality"].pop("quarantined", None)
            snap["quality"].pop("quarantine_reason", None)
        if exact_downloads:
            files[snap["file_sha256"]]["provenance"].update({"direct_url": exact_downloads[0]["url"], "direct_download_sha256_verified": True})
    new_files_fingerprint = sha_text(json.dumps([(f["sha256"], [(c["path"], c["sha256"], c["bytes"]) for c in f["chunks"]]) for f in manifest["files"]], separators=(",", ":")))
    if old_files_fingerprint != new_files_fingerprint:
        raise AssertionError("Metadata refresh changed a source or chunk hash")
    compact_write(output / "manifest.json", manifest)
    compact_write(output / "manifest.in_progress.json", manifest)
    compact_write(output / "source_registries.json", registries)
    compact_write(output / "quarantined.json", quarantines)
    summary = json.loads((output / "summary.json").read_text())
    summary.update({"quarantined_datasets": len(quarantines), "quarantined_rows": sum(q["rows"] for q in quarantines),
                    "staging_datasets": sum(s["status"] == "staging" for s in manifest["snapshots"]),
                    "staging_rows": sum(s["expected_rows"] for s in manifest["snapshots"] if s["status"] == "staging"),
                    "unresolved_source_linkage": quarantines, "metadata_frozen": True})
    compact_write(output / "summary.json", summary)
    print(json.dumps({"quarantines": quarantines, "staging_datasets": summary["staging_datasets"], "staging_rows": summary["staging_rows"], "source_bytes_and_chunk_hashes_unchanged": True}, indent=2))
    return manifest, summary


def prepare(args):
    data_root = args.data_root.resolve()
    output = args.output_dir.resolve()
    if output == data_root or data_root in output.parents:
        raise ValueError("Output must be outside the immutable source-data directory")
    output.mkdir(parents=True, exist_ok=True)
    registries, sheets_by_file, raw_evidence = load_specs(data_root)
    sector_map = {}
    if args.sector_map:
        source_map = json.loads(args.sector_map.read_text(encoding="utf-8"))
        sector_map = {d["relative_path"]: d for d in source_map.get("datasets", [])}
        for collection, registry in source_map.get("registries", {}).items():
            registries[collection].update(registry)
    # The tract file was downloaded and preserved, but omitted from the workbook
    # projections. Its own exact raw evidence authorizes this source supplement.
    tract_relative = "11_real_estate/raw/hpi_at_tract.csv"
    if tract_relative in raw_evidence:
        tract_evidence = raw_evidence[tract_relative][0]
        registries["11_real_estate"]["FHFA_TRACT"] = {
            "source_id": "FHFA_TRACT", "provider": "Federal Housing Finance Agency", "dataset": "Annual census tract House Price Index",
            "access_url": tract_evidence.get("url"), "verified_at": tract_evidence.get("retrieved_at"),
            "granularity": "11-character census tract / year", "status": "DATA_RETRIEVED",
            "limitations": "Index values are not dollar prices; annual_change is percent; original source identifier strings and blanks remain intact.",
            "registry_origin": "retained_raw_file_evidence", "raw_evidence": tract_evidence}
    fdic_dictionary = {}
    path = data_root / "01_financials/data/fdic_native_field_dictionary_and_coverage.csv"
    if path.exists():
        with path.open(encoding="utf-8-sig", newline="") as handle:
            fdic_dictionary = {row["field"]: row for row in csv.DictReader(handle)}
    egrid_dictionary = {}
    path = data_root / "05_utilities/csv/eGRID_field_dictionary.csv"
    if path.exists():
        with path.open(encoding="utf-8-sig", newline="") as handle:
            egrid_dictionary = {(row["Table"], row["Field"]): row["Description and units"] for row in csv.DictReader(handle)}
    candidates = [p for p in data_root.rglob("*") if p.is_file() and is_tabular(p) and not is_metadata(p)]
    candidates.sort(key=lambda p: priority(str(p.relative_to(data_root))))
    files_by_hash, snapshots, datasets, aliases, excluded, stats = {}, [], [], [], [], []
    manifest = {"version": SCHEMA_VERSION, "files": [], "datasets": datasets, "snapshots": snapshots}
    seen_snapshot_hash = {}
    total = len(candidates)
    for index, path in enumerate(candidates, 1):
        relative = str(path.relative_to(data_root))
        collection = relative.split("/", 1)[0]
        print(f"[{index}/{total}] {relative}", flush=True)
        info = sector_map.get(relative, {})
        if info.get("record_population_role") == "package_metadata" and collection != "14_source_atlas":
            excluded.append({"path": relative, "reason": "package metadata, not a research dataset"})
            continue
        # Keep raw acquisition files that are not in normalized projections.
        # Retained normalized full files are preferred to exact raw aliases by
        # ordering; all candidate bytes are preserved by source files or ZIPs.
        file = chunk_file(path)
        existing = files_by_hash.get(file["sha256"])
        if existing:
            existing["provenance"].setdefault("alias_paths", []).append(relative)
        else:
            file["provenance"] = {"relative_path": relative, "collection": collection, "role": "source_tabular_file",
                                  "original_evidence": raw_evidence.get(relative, [])}
            exact_downloads = [e for e in raw_evidence.get(relative, []) if e.get("sha256") == file["sha256"] and e.get("url")]
            if exact_downloads:
                file["provenance"]["direct_url"] = exact_downloads[0]["url"]
                file["provenance"]["direct_download_sha256_verified"] = True
            files_by_hash[file["sha256"]] = file
        if file["sha256"] in seen_snapshot_hash:
            canonical = seen_snapshot_hash[file["sha256"]]
            alias = {"path": relative, "sha256": file["sha256"], "dataset_id": canonical["dataset_id"], "snapshot_id": canonical["id"]}
            aliases.append(alias)
            canonical["coverage"].setdefault("byte_exact_aliases", []).append(relative)
            continue
        try:
            scan = scan_native(path)
        except (ValueError, UnicodeError, csv.Error) as error:
            excluded.append({"path": relative, "sha256": file["sha256"], "reason": str(error), "source_bytes_preserved": True})
            print("  PRESERVED ONLY:", str(error), flush=True)
            continue
        linked = sheets_by_file.get(relative, sheets_by_file.get(collection + "/" + path.name, []))
        source_ids, source_linkage = primary_source_ids(relative, linked, registries, sector_map)
        sources = [registries[collection][sid] for sid in source_ids if sid in registries[collection]]
        evidence = raw_evidence.get(relative, [])
        evidence_urls = sorted({e.get("url") or e.get("final_url") for e in evidence if e.get("url") or e.get("final_url")})
        urls = evidence_urls or sorted({s.get("access_url") or s.get("official_url") for s in sources if s.get("access_url") or s.get("official_url")})
        source_url = urls[0] if len(urls) == 1 else None
        exact_times = sorted({e.get("retrieved_at") for e in evidence if e.get("retrieved_at")})
        source_times = sorted({s.get("verified_at") for s in sources if s.get("verified_at")})
        times = exact_times or source_times
        retrieved_at = times[0] if len(times) == 1 else None
        dims, constants, coverage = dimensions_for(relative, scan, source_url)
        population = info.get("record_population_role", "source_native_table")
        did = dataset_id(relative)
        sid = sha_text(f"{did}:{file['sha256']}:source-1")
        title, description, grain = dataset_caption(relative, linked, sources, scan["rows"], len(scan["header"]))
        agency = "; ".join(sorted({s.get("provider") for s in sources if s.get("provider")})) or "See source evidence"
        dataset = {"id": did, "name": title, "sector": collection, "agency": agency,
                   "source_id": source_ids[0] if len(source_ids) == 1 else None, "source_url": source_url,
                   "description": description, "grain": grain,
                   "units": "Source-native, column-specific units; retained official dictionaries and row unit fields govern interpretation.",
                   "notes": merged_notes(sources, [s for s in linked if s.get("_path_role") == "csv"], "Source values and disclosure flags are unchanged. Retrieval time does not establish historical public availability."),
                   "latest_snapshot_id": None}
        coverage.update({"collection_slug": collection, "source_path": relative, "source_ids": source_ids,
                         "source_linkage_basis": source_linkage, "source_urls": urls, "source_retrieval_times": times,
                         "population_role": population, "overlaps_files": info.get("overlaps_files", []),
                         "archive_population_is_not_unique_entity_count": True,
                         "publication_time_known": False, "availability_time_known": False})
        if info:
            for key in ["data_year", "source_revision", "publication_path_month", "snapshot_reporting_month", "currency_verified",
                        "revenue_unit", "revenue_native_scale", "wide_period_columns", "wide_period_years", "overlap_rule"]:
                if key in info:
                    coverage[key] = info[key]
        if path.name.startswith("EIA860_") or path.name.startswith("EIA861_"):
            coverage["reporting_year_from_source_release"] = 2025
        if path.name == "EIA923_Record_Monthly_Netgen_2020_2025_FULL.csv":
            coverage["operator_fields_available"] = False
            coverage["period_frequency"] = "monthly"
        if path.name == "EIA923_Record_Annual_2020_2025_FULL.csv":
            coverage["period_frequency"] = "annual"
        if path.name.startswith("EGRID2023_"):
            coverage.update({"data_year": 2023, "source_revision": "eGRID2023rev2"})
        if path.name == "hpi_at_tract.csv":
            coverage.update({"geo_level": "census_tract", "index_not_currency_price": True,
                             "source_registry_addition_basis": "retained original FHFA CSV and workbook raw_files provenance"})
        ingest = {"format": "csv", "encoding": scan["encoding"], "delimiter": scan["delimiter"], "header_rows": 1, "dimensions": dims}
        if constants:
            ingest["constants"] = constants
        if path.name.lower().endswith(".gz"):
            ingest["compression"] = "gzip"
        snapshot = {"id": sid, "dataset_id": did, "file_sha256": file["sha256"], "source_path": relative,
                    "retrieved_at": retrieved_at, "status": "staging", "expected_rows": scan["rows"], "loaded_rows": 0,
                    "columns": column_descriptors(relative, scan["header"], linked, info, fdic_dictionary, egrid_dictionary),
                    "coverage": coverage, "quality": {"row_width_verified": True, "source_value_policy": "exact_strings_blank_is_empty_string",
                        "blank_counts_by_column": scan["blank_counts"], "source_lexical_marker_counts": scan["lexical_marker_counts"],
                        "duplicate_header_labels": scan["duplicate_header_labels"], "geo_identifier_validation": scan["geo_identifier_validation"],
                        "source_bytes_sha256_verified": True}, "ingest": ingest}
        attach_index_rules(snapshot)
        snapshots.append(snapshot)
        datasets.append(dataset)
        seen_snapshot_hash[file["sha256"]] = snapshot
        stats.append({"path": relative, "dataset_id": did, "snapshot_id": sid, "rows": scan["rows"], "columns": len(scan["header"]),
                      "bytes": file["bytes"], "source_ids": source_ids, "source_linkage": source_linkage})
        # Make each priority result reviewable immediately. Metadata only; no rows
        # are duplicated on disk and a partial manifest is explicitly named.
        if index <= 10 or index % 25 == 0:
            manifest["files"] = list(files_by_hash.values())
            compact_write(output / "manifest.in_progress.json", manifest)
            compact_write(output / "progress.json", {"files_considered": index, "total_candidates": total,
                                                       "datasets_prepared": len(datasets), "expected_rows": sum(s["expected_rows"] for s in snapshots)})
    if args.archive_root:
        for path in sorted(args.archive_root.resolve().glob("*.zip")):
            print("[archive]", path.name, flush=True)
            file = chunk_file(path)
            if file["sha256"] in files_by_hash:
                files_by_hash[file["sha256"]]["provenance"].setdefault("alias_paths", []).append(str(path))
                continue
            file["provenance"] = {"role": "original_download_archive", "archive_name": path.name,
                                  "snapshot_availability_time_asserted": False}
            files_by_hash[file["sha256"]] = file
    manifest["files"] = list(files_by_hash.values())
    summary = {"manifest_version": SCHEMA_VERSION, "datasets": len(datasets), "snapshots": len(snapshots),
               "expected_source_rows": sum(s["expected_rows"] for s in snapshots), "unique_files": len(files_by_hash),
               "unique_file_bytes": sum(f["bytes"] for f in files_by_hash.values()),
               "chunk_bytes_limit": CHUNK_BYTES, "byte_exact_aliases": len(aliases), "preserved_only_or_excluded": len(excluded),
               "unresolved_source_linkage": [s for s in stats if not s["source_ids"]],
               "collections": dict(Counter(d["sector"] for d in datasets)),
               "scope": "All discovered native CSV/TSV and gzip tables except package-index/validation files; exact byte duplicates are aliases. Overlapping views retain declared populations and must not be summed as unique observations."}
    compact_write(output / "manifest.json", manifest)
    compact_write(output / "source_registries.json", registries)
    compact_write(output / "aliases.json", aliases)
    compact_write(output / "excluded.json", excluded)
    compact_write(output / "table_inventory.json", stats)
    compact_write(output / "summary.json", summary)
    compact_write(output / "local_ranges.json", {
        chunk["path"]: {"local_source_path": chunk["local_path"], "offset": chunk["local_offset"],
                        "length": chunk["bytes"], "sha256": chunk["sha256"]}
        for file in files_by_hash.values() for chunk in file["chunks"]})
    print(json.dumps({k: v for k, v in summary.items() if k != "unresolved_source_linkage"}, indent=2), flush=True)
    print("Source linkage unresolved:", len(summary["unresolved_source_linkage"]), flush=True)
    return manifest, summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--archive-root", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--sector-map", type=Path)
    parser.add_argument("--refresh-metadata", action="store_true", help="Reconcile prepared metadata without rescanning or changing source bytes/chunks")
    args = parser.parse_args()
    if args.refresh_metadata:
        refresh_metadata(args)
    else:
        prepare(args)


if __name__ == "__main__":
    main()
