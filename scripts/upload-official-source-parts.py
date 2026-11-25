#!/usr/bin/env python3
"""Upload exact local byte ranges using short-lived object-scoped Supabase tickets.

No service key is accepted. Ticket and range files stay outside the repository. Each part is
hashed before upload. Receipts acknowledge transport; the importer independently verifies
the complete remote file before publishing any records.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Upload redirect refused")


def checked_part(ticket, ranges):
    part = ranges[ticket['path']]
    if ticket['path'] != 'official/objects/' + ticket['sha256']:
        raise ValueError('Invalid content-addressed object path')
    if part['sha256'] != ticket['sha256'] or part['length'] != ticket['bytes']:
        raise ValueError('Upload ticket disagrees with the local manifest')
    if not 0 < part['length'] <= 32 * 1024 * 1024 or part['offset'] < 0:
        raise ValueError('Invalid local byte range')
    with Path(part['local_source_path']).open('rb') as stream:
        stream.seek(part['offset'])
        body = stream.read(part['length'])
    if len(body) != part['length'] or hashlib.sha256(body).hexdigest() != part['sha256']:
        raise ValueError('Local source bytes changed since preparation')
    url = urllib.parse.urlsplit(ticket['signedUrl'])
    if url.scheme != 'https' or url.hostname not in {
        'gdhfpihswzvelbmmrzmm.supabase.co', 'gdhfpihswzvelbmmrzmm.storage.supabase.co'
    } or '/storage/v1/object/upload/sign/' not in url.path:
        raise ValueError('Upload ticket is outside the authorized project')
    return body


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tickets', required=True)
    parser.add_argument('--ranges', required=True)
    parser.add_argument('--receipts', required=True)
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    tickets = json.loads(Path(args.tickets).read_text())
    ranges = json.loads(Path(args.ranges).read_text())
    out = Path(args.receipts)
    out.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(Path(args.tickets), 0o600)
    receipts = {}
    if out.exists():
        for line in out.read_text().splitlines():
            item = json.loads(line)
            if item['status'] == 'upload_acknowledged':
                receipts[item['path']] = item
    lock = threading.Lock()
    total = len(tickets['uploads'])
    done = 0
    errors = []

    def run(ticket):
        nonlocal done
        if ticket['path'] in receipts and receipts[ticket['path']]['sha256'] == ticket['sha256']:
            return
        body = checked_part(ticket, ranges)
        status = 'failed'
        code = None
        opener = urllib.request.build_opener(NoRedirect())
        for attempt in range(3):
            try:
                request = urllib.request.Request(ticket['signedUrl'], data=body, method='PUT', headers={
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': str(len(body)),
                    'User-Agent': 'FiledUnder-source-transfer/1.0',
                })
                with opener.open(request, timeout=180) as response:
                    code = response.status
                    response.read(4096)
                if code not in (200, 201):
                    raise ValueError('Unexpected upload status')
                status = 'upload_acknowledged'
                break
            except urllib.error.HTTPError as exc:
                code = exc.code
                detail = exc.read(4096).decode('utf-8', 'replace')
                if code in (400, 409) and any(s in detail.lower() for s in ('already exists', 'duplicate')):
                    status = 'exists_requires_remote_hash_verification'
                    break
                if code in (401, 403):
                    break
            except (OSError, ValueError):
                code = None
            if attempt < 2:
                time.sleep(2 ** (attempt + 1))
        record = {'path': ticket['path'], 'sha256': ticket['sha256'], 'bytes': ticket['bytes'],
                  'status': status, 'http_status': code, 'finished_at_unix': int(time.time())}
        with lock:
            with out.open('a') as stream:
                stream.write(json.dumps(record) + '\n')
                stream.flush()
                os.fsync(stream.fileno())
            done += 1
            if status == 'failed':
                errors.append(record)
            print(json.dumps({'completed_this_run': done, 'ticket_parts': total,
                              'sha256': ticket['sha256'], 'bytes': ticket['bytes'], 'status': status}), flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(4, args.workers))) as pool:
        for _ in pool.map(run, tickets['uploads']):
            pass
    print(json.dumps({'parts': total, 'resumed': len(receipts), 'failed': len(errors),
                      'remote_file_hash_verification': 'required before publication'}), flush=True)
    if errors:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
