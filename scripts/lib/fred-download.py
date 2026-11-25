#!/usr/bin/env python3
"""Bounded FRED CSV transport. The parent owns the already-open output FD 3.

No alternate endpoint, proxy override, TLS exception, browser impersonation,
decompression, CSV parsing, or output-path operation is performed here.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
import platform
import re
import signal
import ssl
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


MAX_REQUEST_BYTES = 16 * 1024
MAX_RESULT_BYTES = 32 * 1024
MAX_HEADER_CHARS = 2048
CHUNK_BYTES = 64 * 1024
ERRORS = {
    "invalid_request": "The download request is invalid or exceeds its allowed bounds.",
    "invalid_url": "The request is not an allowed FRED CSV URL.",
    "redirect_rejected": "The source redirect changed the approved request or exceeded its limit.",
    "invalid_response_headers": "The source response has invalid or ambiguous transport headers.",
    "unexpected_content": "The source did not return an acceptable CSV response body.",
    "http_status": "The source did not return a complete successful response.",
    "conditional_required": "A not-modified response requires a sent conditional validator.",
    "length_mismatch": "The response ended without its declared complete byte length.",
    "too_large": "The source response exceeds the approved byte limit.",
    "deadline": "The bounded download deadline expired.",
    "cancelled": "The bounded download was cancelled.",
    "network_error": "The verified source connection could not complete.",
    "write_failed": "The supplied output descriptor could not receive the complete response.",
    "output_unavailable": "The parent did not supply an empty regular output file on descriptor 3.",
    "unsupported_environment": "The helper requires a POSIX main-thread signal environment.",
    "result_too_large": "The response metadata exceeds the allowed protocol size.",
    "internal_error": "The bounded source download could not complete safely.",
}


class DownloadError(Exception):
    def __init__(self, code):
        self.code = code if code in ERRORS else "internal_error"
        super().__init__(ERRORS[self.code])


def _safe_request_header(value):
    return (isinstance(value, str) and 0 < len(value) <= MAX_HEADER_CHARS
            and value.strip() and all(32 <= ord(char) < 127 for char in value))


def _url_identity(url):
    try:
        if (not isinstance(url, str) or len(url) > MAX_REQUEST_BYTES
                or not url.startswith("https://") or "#" in url
                or any(ord(char) < 33 or ord(char) > 126 for char in url)):
            raise DownloadError("invalid_url")
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "https" or parsed.netloc != "fred.stlouisfed.org"
                or parsed.path != "/graph/fredgraph.csv" or parsed.fragment
                or parsed.username is not None or parsed.password is not None
                or parsed.port is not None):
            raise DownloadError("invalid_url")
        pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True,
                                      strict_parsing=True, encoding="utf-8", errors="strict")
        params = {}
        for key, value in pairs:
            if key not in {"id", "cosd", "coed"} or key in params:
                raise DownloadError("invalid_url")
            params[key] = value
        series = params.get("id", "").split(",")
        if not 1 <= len(series) <= 32 or any(not re.fullmatch(r"[A-Za-z0-9_.-]+", value, flags=re.ASCII) for value in series):
            raise DownloadError("invalid_url")
        for key in ("cosd", "coed"):
            if key in params and not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", params[key], flags=re.ASCII):
                raise DownloadError("invalid_url")
        return params
    except DownloadError:
        raise
    except (TypeError, ValueError, UnicodeError):
        raise DownloadError("invalid_url") from None


def _validate_request(request):
    allowed = {"version", "url", "user_agent", "etag", "last_modified", "timeout_ms", "max_bytes"}
    if not isinstance(request, dict) or set(request) - allowed:
        raise DownloadError("invalid_request")
    if type(request.get("version")) is not int or request["version"] != 1:
        raise DownloadError("invalid_request")
    if (type(request.get("timeout_ms")) is not int or not 1 <= request["timeout_ms"] <= 120000
            or type(request.get("max_bytes")) is not int or not 1 <= request["max_bytes"] <= 268435456):
        raise DownloadError("invalid_request")
    if not _safe_request_header(request.get("user_agent")):
        raise DownloadError("invalid_request")
    if request["user_agent"].lower().startswith(("mozilla/", "chrome/", "firefox/", "safari/", "edge/", "edg/")):
        raise DownloadError("invalid_request")
    for key in ("etag", "last_modified"):
        if key in request and not _safe_request_header(request[key]):
            raise DownloadError("invalid_request")
    return _url_identity(request.get("url"))


class _Budget:
    def __init__(self, timeout_ms, clock):
        self.clock = clock
        self.end = clock() + timeout_ms / 1000.0

    def remaining(self):
        remaining = self.end - self.clock()
        if remaining <= 0:
            raise DownloadError("deadline")
        return remaining


@contextmanager
def _deadline(timeout_ms, clock=time.monotonic):
    budget = _Budget(timeout_ms, clock)
    previous = {}
    previous_timer = (0.0, 0.0)
    real_started = time.monotonic()

    def alarm(_signum, _frame):
        raise DownloadError("deadline")

    def cancel(_signum, _frame):
        raise DownloadError("cancelled")

    try:
        for sig, handler in ((signal.SIGALRM, alarm), (signal.SIGTERM, cancel), (signal.SIGINT, cancel)):
            previous[sig] = signal.getsignal(sig)
            signal.signal(sig, handler)
        previous_timer = signal.getitimer(signal.ITIMER_REAL)
        signal.setitimer(signal.ITIMER_REAL, timeout_ms / 1000.0)
    except (AttributeError, ValueError, OSError):
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        raise DownloadError("unsupported_environment") from None
    try:
        yield budget
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        if previous_timer[0] > 0:
            left = max(0.000001, previous_timer[0] - (time.monotonic() - real_started))
            signal.setitimer(signal.ITIMER_REAL, left, previous_timer[1])


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _default_opener():
    # build_opener retains its normal environment ProxyHandler. No proxy, CA,
    # certificate, hostname, or credential environment setting is overridden.
    return urllib.request.build_opener(
        _NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))


def _one_header(headers, name, max_chars=MAX_HEADER_CHARS):
    values = headers.get_all(name, [])
    if len(values) > 1:
        raise DownloadError("invalid_response_headers")
    if not values:
        return None
    value = values[0]
    if (not isinstance(value, str) or len(value) > max_chars
            or any(ord(char) < 32 or ord(char) > 126 for char in value)):
        raise DownloadError("invalid_response_headers")
    return value.strip()


def _metadata(response):
    result = {}
    for name, key in (("ETag", "etag"), ("Last-Modified", "last_modified")):
        value = _one_header(response.headers, name)
        if value:
            result[key] = value
    return result


def _transport_headers(response, max_bytes):
    if response.headers.get_all("Content-Range", []):
        raise DownloadError("invalid_response_headers")
    encoding = _one_header(response.headers, "Content-Encoding")
    if encoding is not None and encoding.lower() != "identity":
        raise DownloadError("invalid_response_headers")
    raw_length = _one_header(response.headers, "Content-Length")
    transfer = _one_header(response.headers, "Transfer-Encoding")
    if transfer is not None and (raw_length is not None or transfer.lower() != "chunked"):
        raise DownloadError("invalid_response_headers")
    length = None
    if raw_length is not None:
        if not re.fullmatch(r"[0-9]+", raw_length, flags=re.ASCII):
            raise DownloadError("invalid_response_headers")
        length = int(raw_length)
        if length > max_bytes:
            raise DownloadError("too_large")
    content_type = _one_header(response.headers, "Content-Type") or ""
    media_type = content_type.split(";", 1)[0].strip().lower()
    if media_type and media_type not in {"text/csv", "application/csv", "text/plain", "application/octet-stream", "application/vnd.ms-excel"}:
        raise DownloadError("unexpected_content")
    return content_type, length


def _read_timeout(response, remaining):
    # urllib's HTTPResponse owns fp.raw._sock; update the socket deadline on
    # each fixed-size read while SIGALRM also bounds DNS/TLS/blocking calls.
    current = response
    for attribute in ("fp", "raw", "_sock"):
        current = getattr(current, attribute, None)
        if current is None:
            return
    if callable(getattr(current, "settimeout", None)):
        current.settimeout(remaining)


def _write_all(sink, data):
    view = memoryview(data)
    try:
        while view:
            written = sink.write(view)
            if type(written) is not int or written <= 0 or written > len(view):
                raise DownloadError("write_failed")
            view = view[written:]
    except DownloadError:
        raise
    except (OSError, ValueError, TypeError):
        raise DownloadError("write_failed") from None


def download(request, binary_sink, *, opener=None, clock=time.monotonic):
    """Return bounded success metadata; errors leave disposal of partial bytes to the parent."""
    identity = _validate_request(request)
    current_url = request["url"]
    headers = {"Accept": "text/csv, application/csv;q=0.9, text/plain;q=0.8",
               "Accept-Encoding": "identity", "User-Agent": request["user_agent"]}
    conditional = False
    if "etag" in request:
        headers["If-None-Match"] = request["etag"]
        conditional = True
    elif "last_modified" in request:
        headers["If-Modified-Since"] = request["last_modified"]
        conditional = True
    redirects = 0
    with _deadline(request["timeout_ms"], clock) as budget:
        transport = opener if opener is not None else _default_opener()
        while True:
            response = None
            try:
                try:
                    response = transport.open(urllib.request.Request(current_url, headers=headers, method="GET"), timeout=budget.remaining())
                except urllib.error.HTTPError as error:
                    response = error
                budget.remaining()
                actual_url = response.geturl()
                try:
                    if _url_identity(actual_url) != identity:
                        raise DownloadError("redirect_rejected")
                except DownloadError:
                    raise DownloadError("redirect_rejected") from None
                status = response.getcode()
                if status in (301, 302, 303, 307, 308):
                    location = _one_header(response.headers, "Location", MAX_REQUEST_BYTES)
                    if not location or redirects >= 3:
                        raise DownloadError("redirect_rejected")
                    target = urllib.parse.urljoin(current_url, location)
                    try:
                        if _url_identity(target) != identity:
                            raise DownloadError("redirect_rejected")
                    except DownloadError:
                        raise DownloadError("redirect_rejected") from None
                    current_url = target
                    redirects += 1
                    continue
                common = {"version": 1, "ok": True, "status": status,
                          "url": request["url"], "resolved_url": actual_url,
                          "python_version": platform.python_version(), **_metadata(response)}
                if status == 304:
                    if not conditional:
                        raise DownloadError("conditional_required")
                    budget.remaining()
                    return common
                if status != 200:
                    raise DownloadError("http_status")
                content_type, length = _transport_headers(response, request["max_bytes"])
                total = 0
                digest = hashlib.sha256()
                first = True
                while True:
                    _read_timeout(response, budget.remaining())
                    chunk = response.read(CHUNK_BYTES)
                    budget.remaining()
                    if not isinstance(chunk, bytes):
                        raise DownloadError("unexpected_content")
                    if not chunk:
                        break  # Explicit EOF is required, including without Content-Length.
                    total += len(chunk)
                    if total > request["max_bytes"]:
                        raise DownloadError("too_large")
                    if first:
                        prefix = chunk[3:] if chunk.startswith(b"\xef\xbb\xbf") else chunk
                        prefix = prefix.lstrip(b" \r\n\t")
                        if not prefix or prefix.startswith((b"<", b"{", b"[")):
                            raise DownloadError("unexpected_content")
                        first = False
                    _write_all(binary_sink, chunk)
                    digest.update(chunk)
                if length is not None and total != length:
                    raise DownloadError("length_mismatch")
                if first:
                    raise DownloadError("unexpected_content")
                if callable(getattr(binary_sink, "flush", None)):
                    binary_sink.flush()
                budget.remaining()
                return {**common, "bytes": total, "sha256": digest.hexdigest(),
                        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                        "content_type": content_type, "content_length": length, "content_encoding": "identity"}
            except DownloadError:
                raise
            except (TimeoutError,):
                raise DownloadError("deadline") from None
            except http.client.IncompleteRead:
                raise DownloadError("length_mismatch") from None
            except (urllib.error.URLError, ssl.SSLError, http.client.HTTPException, OSError):
                raise DownloadError("network_error") from None
            finally:
                if response is not None:
                    try:
                        response.close()
                    except OSError:
                        pass


class _DescriptorSink:
    def __init__(self):
        try:
            info = os.fstat(3)
            if not stat.S_ISREG(info.st_mode) or info.st_size != 0 or os.lseek(3, 0, os.SEEK_CUR) != 0:
                raise DownloadError("output_unavailable")
        except (OSError, ValueError):
            raise DownloadError("output_unavailable") from None

    def write(self, data):
        return os.write(3, data)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise DownloadError("invalid_request")
        result[key] = value
    return result


def _error(code):
    code = code if code in ERRORS else "internal_error"
    return {"version": 1, "ok": False, "error": {"code": code, "message": ERRORS[code]}}


def main():
    result = None
    try:
        # Bound malformed/incomplete stdin too. The parent also owns the process deadline.
        with _deadline(120000):
            payload = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
            if len(payload) > MAX_REQUEST_BYTES:
                raise DownloadError("invalid_request")
            try:
                request = json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_object)
            except (UnicodeError, ValueError, RecursionError):
                raise DownloadError("invalid_request") from None
            _validate_request(request)
            result = download(request, _DescriptorSink())
    except DownloadError as error:
        result = _error(error.code)
    except KeyboardInterrupt:
        result = _error("cancelled")
    except BaseException:
        result = _error("internal_error")
    encoded = (json.dumps(result, separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")
    if len(encoded) >= MAX_RESULT_BYTES:
        result = _error("result_too_large")
        encoded = (json.dumps(result, separators=(",", ":")) + "\n").encode("ascii")
    try:
        remaining = memoryview(encoded)
        while remaining:
            written = os.write(1, remaining)
            if written <= 0:
                return 1
            remaining = remaining[written:]
    except OSError:
        return 1
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
