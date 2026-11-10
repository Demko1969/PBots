#!/usr/bin/env python3
"""Build a source ZIP from an explicit set of distributable files."""
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
output = root / 'output' / 'release'
output.mkdir(parents=True, exist_ok=True)
archive = output / 'ortak-akil-source.zip'
roots = ['README.md', 'PROJECT_SPEC.md', 'SECURITY.md', 'compose.yaml', '.dockerignore', '.gitignore', 'package.json', 'deployment', 'scripts', 'workflows', 'ui']
excluded = {'node_modules', 'dist', '.git', '.next', '.vinext', '.wrangler', '.idea', '__pycache__', '.DS_Store', 'outputs', 'work'}
files = []
for name in roots:
    path = root / name
    candidates = path.rglob('*') if path.is_dir() else [path]
    for file in candidates:
        relative = file.relative_to(root)
        if not file.is_file() or file.is_symlink() or excluded.intersection(relative.parts):
            continue
        if file.name.startswith('.env') and file.name != '.env.example':
            continue
        if file.name.endswith(('.tsbuildinfo', '.log', '.pem', '.key')):
            continue
        files.append(file)
with ZipFile(archive, 'w', ZIP_DEFLATED) as bundle:
    for file in sorted(files):
        bundle.write(file, Path('ortak-akil') / file.relative_to(root))
checksum = sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(f'{checksum}  {archive.name}\n')
print(f'Packaged {len(files)} files into {archive}')
print(f'SHA-256 {checksum}')
