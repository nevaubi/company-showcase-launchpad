"""Value-fidelity gates for the official-source preparation boundary."""
import gzip
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("official_preparer", Path(__file__).with_name("prepare-official-sources.py"))
preparer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparer)


class SourceFidelityTests(unittest.TestCase):
    def test_quoted_newline_blank_zero_and_leading_zero_remain_distinct(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "native.csv"
            path.write_bytes(b'\xef\xbb\xbfFIPS code,value,note,note\r\n01001,0,"first\r\nsecond",\r\n00001,,"quote ""x""",(D)\r\n')
            scan = preparer.scan_native(path)
            rows = list(preparer.read_native(path, "utf-8-sig", ","))
            self.assertEqual(rows[1], ["01001", "0", "first\r\nsecond", ""])
            self.assertEqual(rows[2], ["00001", "", 'quote "x"', "(D)"])
            self.assertEqual(scan["rows"], 2)
            self.assertEqual(scan["duplicate_header_labels"], {"note": 2})
            self.assertEqual(scan["blank_counts"], [0, 1, 0, 1])
            self.assertEqual(scan["geo_identifier_validation"]["FIPS code"]["invalid"], 0)
            descriptors = preparer.column_descriptors("fixture/native.csv", scan["header"], [], {}, {}, {})
            self.assertEqual([c["key"] for c in descriptors], ["col0001", "col0002", "col0003", "col0004"])
            self.assertEqual(descriptors[2]["label"], descriptors[3]["label"])

    def test_gzip_manifest_hashes_compressed_bytes_without_expanding_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "facts.csv.gz"
            data = b'CIK,Value,Unit\n00002488,6192000000.0000,USD\n'
            path.write_bytes(gzip.compress(data))
            scan = preparer.scan_native(path)
            manifest = preparer.chunk_file(path)
            self.assertEqual(scan["rows"], 1)
            self.assertEqual(manifest["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(manifest["chunks"][0]["local_offset"], 0)
            self.assertEqual(manifest["chunks"][0]["bytes"], path.stat().st_size)
            self.assertEqual(len(list(Path(folder).iterdir())), 1)

    def test_windows1252_tsv_and_fixed_width_geography(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "native.tsv"
            path.write_bytes('tract\tname\n01001020100\tCaf\xe9\n'.encode("cp1252"))
            scan = preparer.scan_native(path)
            self.assertEqual(scan["encoding"], "windows-1252")
            self.assertEqual(scan["delimiter"], "\t")
            self.assertEqual(scan["geo_identifier_validation"]["tract"]["invalid"], 0)

    def test_malformed_row_is_not_silently_padded_or_truncated(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "invalid.csv"
            path.write_text("a,b\n1,2,3\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "width"):
                preparer.scan_native(path)

    def test_fdic_certificate_cannot_be_replaced_by_parent_or_record_id(self):
        header = ["ID", "RSSDHCR", "CERT", "REPDTE", "NAME"]
        dimensions, _, coverage = preparer.dimensions_for("01_financials/data/fdic_native.csv", {
            "header": header, "geo_identifier_validation": {}, "first_row": []}, None)
        self.assertEqual(dimensions["entity_id"], 2)
        self.assertEqual(dimensions["period"], 3)
        self.assertEqual(coverage["entity_type"], "FDIC_certificate")


if __name__ == "__main__":
    unittest.main()
