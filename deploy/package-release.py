#!/usr/bin/env python3
"""Package only runtime files and record per-file checksums."""
import argparse, hashlib, json, shutil, tarfile, tempfile
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('game', choices=['magic', 'hill'])
p.add_argument('sha')
p.add_argument('run', type=int)
p.add_argument('attempt', type=int)
p.add_argument('output')
a = p.parse_args()
root = Path(__file__).resolve().parents[1]
out = Path(a.output).resolve()
with tempfile.TemporaryDirectory() as temp:
    stage = Path(temp)
    if a.game == 'magic':
        shutil.copytree(root / 'dist', stage, dirs_exist_ok=True)
    else:
        for pattern in ('*.html', '*.css', '*.js', 'favicon.*', 'VERSION'):
            for source in root.glob(pattern):
                shutil.copy2(source, stage / source.name)
        shutil.copytree(root / 'vendor', stage / 'vendor')
    manifest = {str(f.relative_to(stage)).replace('\\', '/'): hashlib.sha256(f.read_bytes()).hexdigest()
                for f in sorted(stage.rglob('*')) if f.is_file()}
    (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (stage / 'release.json').write_text(json.dumps({'sha': a.sha, 'game': a.game, 'run': a.run, 'attempt': a.attempt}) + '\n')
    out.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out, 'w:gz') as archive:
        for f in sorted(stage.rglob('*')):
            if f.is_file():
                archive.add(f, arcname=str(f.relative_to(stage)), recursive=False)
print('Packaged', len(manifest), 'runtime files:', out.name)
