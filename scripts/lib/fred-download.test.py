"""Offline contract tests; only the urllib network boundary is replaced."""
import hashlib
import importlib.util
import io
import json
from email.message import Message
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
import urllib.error


SPEC = importlib.util.spec_from_file_location("fred_download", Path(__file__).with_name("fred-download.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10,DGS2&cosd=2020-01-01&coed=2026-11-24"
BODY = b'observation_date,DGS10,DGS2\r\n2026-11-23,0,\r\n2026-11-24,-0.00000000000000001,9007199254740993.0040\r\n'


def request(**changes):
    return {"version": 1, "url": URL, "user_agent": "FiledUnder official-source refresh/1.0", "timeout_ms": 10000, "max_bytes": 1024 * 1024, **changes}


class FakeResponse:
    def __init__(self, body=BODY, status=200, headers=None, url=URL, on_read=None):
        self.status = status
        self.headers = Message()
        for key, value in (headers if headers is not None else [("Content-Type", "text/csv"), ("Content-Length", str(len(body)))]):
            self.headers[key] = value
        self.body = io.BytesIO(body)
        self.url = url
        self.closed = False
        self.on_read = on_read

    def getcode(self):
        return self.status

    def geturl(self):
        return self.url

    def read(self, size):
        if self.on_read:
            self.on_read()
        return self.body.read(size)

    def close(self):
        self.closed = True


class FakeOpener:
    def __init__(self, *responses, on_open=None):
        self.responses = list(responses)
        self.calls = []
        self.on_open = on_open

    def open(self, req, timeout):
        self.calls.append((req, timeout))
        if self.on_open:
            self.on_open()
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


class Clock:
    def __init__(self):
        self.value = 0.0

    def __call__(self):
        return self.value


class FredDownloadTests(unittest.TestCase):
    def error(self, code, req=None, response=None, opener=None, **kwargs):
        sink = io.BytesIO()
        with self.assertRaises(MODULE.DownloadError) as raised:
            MODULE.download(req or request(), sink, opener=opener or FakeOpener(response or FakeResponse()), **kwargs)
        self.assertEqual(raised.exception.code, code)
        return sink, raised.exception

    def test_exact_native_bytes_hash_and_real_transport_headers(self):
        response = FakeResponse(headers=[("Content-Type", "text/csv; charset=utf-8"), ("Content-Length", str(len(BODY))), ("Content-Encoding", "identity"), ("ETag", '"version-1"')])
        opener = FakeOpener(response)
        sink = io.BytesIO()
        result = MODULE.download(request(), sink, opener=opener)
        self.assertEqual(sink.getvalue(), BODY)
        self.assertEqual(result["sha256"], hashlib.sha256(BODY).hexdigest())
        self.assertEqual(result["bytes"], len(BODY))
        self.assertEqual(result["content_length"], len(BODY))
        self.assertEqual(result["content_encoding"], "identity")
        self.assertEqual(result["url"], URL)
        self.assertEqual(result["resolved_url"], URL)
        self.assertRegex(result["retrieved_at"], r"^\d{4}-\d\d-\d\dT")
        self.assertRegex(result["python_version"], r"^3\.")
        headers = {key.lower(): value for key, value in opener.calls[0][0].header_items()}
        self.assertEqual(headers["accept-encoding"], "identity")
        self.assertEqual(headers["user-agent"], request()["user_agent"])
        self.assertIn("text/csv", headers["accept"])
        self.assertTrue(response.closed)

    def test_absent_length_is_null_and_chunked_transfer_is_allowed(self):
        sink = io.BytesIO()
        result = MODULE.download(request(), sink, opener=FakeOpener(FakeResponse(headers=[("Content-Type", "application/csv"), ("Transfer-Encoding", "chunked")])))
        self.assertIsNone(result["content_length"])
        self.assertEqual(sink.getvalue(), BODY)

    def test_utf8_bom_csv_is_preserved_byte_for_byte(self):
        body = b"\xef\xbb\xbf" + BODY
        sink = io.BytesIO()
        result = MODULE.download(request(), sink, opener=FakeOpener(FakeResponse(body=body)))
        self.assertEqual(sink.getvalue(), body)
        self.assertEqual(result["sha256"], hashlib.sha256(body).hexdigest())

    def test_truncated_declared_length_and_oversize_are_rejected(self):
        self.error("length_mismatch", response=FakeResponse(headers=[("Content-Type", "text/csv"), ("Content-Length", str(len(BODY) + 1))]))
        self.error("length_mismatch", response=FakeResponse(headers=[("Content-Type", "text/csv"), ("Content-Length", str(len(BODY) - 1))]))
        self.error("too_large", req=request(max_bytes=8))
        self.error("too_large", req=request(max_bytes=8), response=FakeResponse(headers=[("Content-Type", "text/csv")]))

    def test_duplicate_malformed_or_ambiguous_length_headers(self):
        for headers in [
            [("Content-Length", "10"), ("Content-Length", "10")],
            [("Content-Length", "10,10")], [("Content-Length", "-1")], [("Content-Length", "1.0")],
            [("Content-Length", "garbage")], [("Content-Length", "1"), ("Transfer-Encoding", "chunked")],
            [("Transfer-Encoding", "gzip, chunked")],
        ]:
            with self.subTest(headers=headers):
                self.error("invalid_response_headers", response=FakeResponse(headers=[("Content-Type", "text/csv"), *headers]))

    def test_nonidentity_partial_and_structured_error_bodies_are_rejected(self):
        self.error("invalid_response_headers", response=FakeResponse(headers=[("Content-Type", "text/csv"), ("Content-Encoding", "gzip")]))
        self.error("invalid_response_headers", response=FakeResponse(headers=[("Content-Type", "text/csv"), ("Content-Range", "bytes 0-20/100")]))
        _, refused = self.error("http_status", response=FakeResponse(status=206))
        self.assertEqual(refused.status, 206)

    def test_refused_answer_carries_its_status_and_nothing_else(self):
        for status in (403, 429, 503, 404):
            with self.subTest(status=status):
                _, refused = self.error("http_status", response=FakeResponse(status=status))
                self.assertEqual(refused.status, status)
                self.assertEqual(MODULE._error("http_status", status)["error"],
                                 {"code": "http_status", "message": MODULE.ERRORS["http_status"], "status": status})
        # no status for other codes, and never a value that is not a plain status number
        self.assertNotIn("status", MODULE._error("deadline", 504)["error"])
        self.assertNotIn("status", MODULE._error("http_status", "429")["error"])
        self.assertNotIn("status", MODULE._error("http_status", 99)["error"])
        for content_type in ["text/html", "application/json", "application/problem+json", "application/xml"]:
            self.error("unexpected_content", response=FakeResponse(headers=[("Content-Type", content_type)]))
        for body in [b"  <!doctype html><html>blocked", b'\xef\xbb\xbf {"error":1}', b"<?xml version='1.0'?>", b"[1,2]"]:
            sink, _ = self.error("unexpected_content", response=FakeResponse(body=body, headers=[("Content-Type", "text/plain")]))
            self.assertEqual(sink.getvalue(), b"")

    def test_url_endpoint_query_and_series_bounds(self):
        bad = [
            URL.replace("https:", "http:"), URL.replace("fred.stlouisfed.org", "example.com"),
            URL.replace("/graph/", "/other/"), URL + "#fragment", URL + "#",
            URL.replace("fred.stlouisfed.org", "user:pass@fred.stlouisfed.org"),
            URL.replace("fred.stlouisfed.org", "fred.stlouisfed.org:443"),
            URL + "&id=DGS10", URL + "&api_key=secret", URL.replace("id=DGS10,DGS2", "id="),
            URL.replace("id=DGS10,DGS2", "id=" + ",".join(["A"] * 33)),
            URL.replace("id=DGS10,DGS2", "id=A%20B"), URL.replace("2020-01-01", "2020/01/01"),
        ]
        for value in bad:
            with self.subTest(url=value):
                self.error("invalid_url", req=request(url=value))

    def test_request_bounds_and_header_injection(self):
        for changes in [{"timeout_ms": 0}, {"timeout_ms": True}, {"timeout_ms": 120001}, {"max_bytes": 0}, {"max_bytes": 268435457}, {"version": 2}, {"user_agent": "Mozilla/5.0"}, {"etag": "x\r\nAuthorization: secret"}, {"last_modified": "x" * 2049}]:
            with self.subTest(changes=changes):
                self.error("invalid_request", req=request(**changes))

    def test_manual_same_identity_redirect_and_three_redirect_limit(self):
        target = "https://fred.stlouisfed.org/graph/fredgraph.csv?coed=2026-11-24&id=DGS10%2CDGS2&cosd=2020-01-01"
        opener = FakeOpener(FakeResponse(status=302, headers=[("Location", target)]), FakeResponse(url=target))
        result = MODULE.download(request(), io.BytesIO(), opener=opener)
        self.assertEqual(result["resolved_url"], target)
        self.assertEqual(len(opener.calls), 2)
        repeated = FakeOpener(*[FakeResponse(status=302, headers=[("Location", URL)]) for _ in range(4)])
        self.error("redirect_rejected", opener=repeated)

    def test_redirect_cannot_change_series_dates_presence_host_or_path(self):
        for target in [URL.replace("DGS10", "DGS5"), URL.replace("2020-01-01", "2020-01-02"), URL.split("&cosd")[0], URL.replace("fred.stlouisfed.org", "api.stlouisfed.org"), URL.replace("fredgraph.csv", "fredgraph.json"), URL + "&cosd=2020-01-01"]:
            with self.subTest(target=target):
                self.error("redirect_rejected", response=FakeResponse(status=301, headers=[("Location", target)]))

    def test_conditional_304_uses_etag_priority_and_writes_nothing(self):
        sink = io.BytesIO()
        opener = FakeOpener(FakeResponse(status=304, headers=[("ETag", '"same"')]))
        result = MODULE.download(request(etag='"same"', last_modified="Tue, 24 Nov 2026 00:00:00 GMT"), sink, opener=opener)
        self.assertEqual(result["status"], 304)
        self.assertNotIn("bytes", result)
        self.assertEqual(sink.getvalue(), b"")
        headers = {key.lower(): value for key, value in opener.calls[0][0].header_items()}
        self.assertEqual(headers["if-none-match"], '"same"')
        self.assertNotIn("if-modified-since", headers)
        self.error("conditional_required", response=FakeResponse(status=304))

    def test_http_error_304_is_handled_as_a_valid_conditional_response(self):
        headers = Message(); headers["ETag"] = '"same"'
        response = urllib.error.HTTPError(URL, 304, "Not Modified", headers, io.BytesIO())
        result = MODULE.download(request(etag='"same"'), io.BytesIO(), opener=FakeOpener(response))
        self.assertEqual(result["status"], 304)

    def test_deadline_before_open_and_during_read(self):
        class AdvancingClock:
            def __init__(self): self.value = -2.0
            def __call__(self): self.value += 2.0; return self.value
        opener = FakeOpener(FakeResponse())
        self.error("deadline", req=request(timeout_ms=1000), opener=opener, clock=AdvancingClock())
        self.assertEqual(len(opener.calls), 0)
        clock = Clock()
        def expire(): clock.value = 2.0
        sink, _ = self.error("deadline", req=request(timeout_ms=1000), response=FakeResponse(on_read=expire), clock=clock)
        self.assertEqual(sink.getvalue(), b"")

    def test_cancellation_signals_restore_previous_handlers(self):
        previous = {sig: signal.getsignal(sig) for sig in [signal.SIGALRM, signal.SIGTERM, signal.SIGINT]}
        for sig in [signal.SIGTERM, signal.SIGINT]:
            self.error("cancelled", opener=FakeOpener(FakeResponse(), on_open=lambda: signal.raise_signal(sig)))
            for current, handler in previous.items(): self.assertEqual(signal.getsignal(current), handler)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_remote_exception_text_never_enters_safe_error(self):
        _, error = self.error("network_error", opener=FakeOpener(urllib.error.URLError("https://secret:password@example.com private")))
        self.assertNotIn("password", str(error))
        self.assertNotIn("secret", str(error))

    def test_cli_returns_one_bounded_json_error_without_traceback(self):
        process = subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("fred-download.py"))], input=b'{"invalid":"request"}', capture_output=True, timeout=5)
        self.assertEqual(process.returncode, 1)
        self.assertLess(len(process.stdout), 32768)
        self.assertEqual(process.stdout.count(b"\n"), 1)
        result = json.loads(process.stdout)
        self.assertFalse(result["ok"])
        self.assertEqual(result["version"], 1)
        self.assertNotIn(b"Traceback", process.stderr)

    def test_cli_rejects_oversized_input_and_missing_output_descriptor(self):
        script = str(Path(__file__).with_name("fred-download.py"))
        for payload, code in [(b" " * 16385, "invalid_request"), (json.dumps(request()).encode(), "output_unavailable")]:
            with self.subTest(code=code):
                process = subprocess.run([sys.executable, "-I", script], input=payload, capture_output=True, timeout=5)
                self.assertEqual(process.returncode, 1)
                self.assertEqual(json.loads(process.stdout)["error"]["code"], code)
                self.assertEqual(process.stderr, b"")

    def test_cli_error_protocol_with_real_inherited_output_file(self):
        script = str(Path(__file__).with_name("fred-download.py"))
        # The test parent owns this file. A tiny isolated driver maps its inherited
        # descriptor to FD3 before invoking the actual helper's CLI entry point.
        driver = "import os,runpy,sys;os.dup2(int(sys.argv[1]),3);runpy.run_path(sys.argv[2],run_name='__main__')"
        with tempfile.TemporaryFile() as output:
            process = subprocess.run([sys.executable, "-I", "-c", driver, str(output.fileno()), script], pass_fds=(output.fileno(),), input=b'{"invalid":"request"}', capture_output=True, timeout=5)
            self.assertEqual(process.returncode, 1)
            self.assertEqual(process.stdout.count(b"\n"), 1)
            self.assertEqual(json.loads(process.stdout)["error"]["code"], "invalid_request")
            self.assertEqual(process.stderr, b"")
            output.seek(0)
            self.assertEqual(output.read(), b"")


if __name__ == "__main__":
    unittest.main()
