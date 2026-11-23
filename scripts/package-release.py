#!/usr/bin/env python3
"""Archive approved source directories from the current Git commit."""
from hashlib import sha256
from pathlib import Path
from subprocess import run

root = Path(__file__).resolve().parent.parent
output = root / 'output' / 'release'
output.mkdir(parents=True, exist_ok=True)
archive = output / 'ortak-akil-source.zip'
source = [
    '.dockerignore', '.env.example', '.gitignore', 'README.md', 'PROJECT_SPEC.md',
    'SECURITY.md', 'compose.yaml', 'package.json', 'deployment', 'scripts',
    'workflows', 'ui',
]
run([
    'git', '-C', str(root), 'archive', '--format=zip', '--prefix=ortak-akil/',
    f'--output={archive}', 'HEAD', '--', *source,
], check=True)
checksum = sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(f'{checksum}  {archive.name}\n')
print(f'Packaged the current commit into {archive}')
print(f'SHA-256 {checksum}')
