"""Stream-validate owner archives before any remote write; never fetch replacements."""
import hashlib
import json
import pathlib
import subprocess
import tarfile
import zipfile

ROOT = pathlib.Path('/tmp/ir-combined')
ROOT.mkdir(parents=True, exist_ok=True)
rows = []
archives = []
for name, ticker in [('FROG-filings.tar.xz', 'FROG'), ('COST-filings.tar.xz', 'COST'), ('TSMC.zip', 'TSM'), ('TSMCremaining.zip', 'TSM')]:
    path = pathlib.Path('/mnt/user-uploads') / name
    if not path.exists():
        path = pathlib.Path('/tmp/user-uploads') / name
    digest = hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
    archive = zipfile.ZipFile(path) if name.endswith('.zip') else tarfile.open(path, 'r|xz')
    entries = archive.infolist() if name.endswith('.zip') else archive
    count = 0
    for entry in entries:
        member = entry.filename if name.endswith('.zip') else entry.name
        parts = pathlib.PurePosixPath(member).parts
        if '..' in parts or '.git' in parts or member.startswith('/'):
            raise ValueError('Unsafe archive entry: ' + member)
        if entry.is_dir() if name.endswith('.zip') else entry.isdir():
            continue
        if not member.lower().endswith('.pdf') or (not name.endswith('.zip') and not entry.isfile()):
            raise ValueError('Unexpected archive entry: ' + member)
        data = archive.read(entry) if name.endswith('.zip') else archive.extractfile(entry).read()
        if not data.startswith(b'%PDF-'):
            raise ValueError('Invalid PDF: ' + member)
        sha = hashlib.sha256(data).hexdigest()
        target = ROOT / ticker / (sha + '.pdf')
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(data)
        info = subprocess.run(['pdfinfo', str(target)], capture_output=True, text=True, timeout=30, check=True)
        pages = next(int(line.split(':')[1]) for line in info.stdout.splitlines() if line.startswith('Pages:'))
        rows.append(dict(ticker=ticker, archive=name, archiveSha256=digest, entry=member, file=str(target), sha256=sha, bytes=len(data), pages=pages))
        count += 1
    archives.append(dict(name=name, sha256=digest, files=count))
    print(name, count, 'validated', flush=True)
(ROOT / 'manifest.json').write_text(json.dumps(dict(archives=archives, rows=rows), indent=2))
print('All archives validated:', len(rows), 'PDFs', flush=True)