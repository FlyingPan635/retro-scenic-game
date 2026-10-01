#!/usr/bin/python3
"""Root-owned forced SSH command. Runs as one game's unprivileged user."""
import fcntl, hashlib, json, os, re, shlex, shutil, signal, sys, tarfile, time
from pathlib import Path
from urllib.request import Request, urlopen

GAME = sys.argv[1]
assert GAME in ('magic', 'hill')
BASE = Path('/srv/game-releases') / GAME
RELEASES = BASE / 'releases'
CURRENT = BASE / 'current'
PUBLIC = 'https://play.635cloud.fyi/games/' + GAME + '/'

def log(message):
    print(message, flush=True)

def write_json(path, value):
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    os.replace(temp, path)

def switch(target):
    temp = BASE / 'current.new'
    temp.unlink(missing_ok=True)
    temp.symlink_to(target)
    os.replace(temp, CURRENT)

def interrupted(signum, frame):
    raise RuntimeError('Deployment interrupted by signal ' + str(signum))

for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(sig, interrupted)

def health(target):
    expected = json.loads((target / 'release.json').read_text())
    manifest = json.loads((target / 'manifest.json').read_text())
    for origin in ('http://127.0.0.1:4180/games/' + GAME + '/', PUBLIC):
        for attempt in range(3):
            try:
                nonce = '?deploy=' + str(time.time_ns())
                def fetch(name):
                    with urlopen(Request(origin + name + nonce, headers={'Cache-Control': 'no-cache',
                            'User-Agent': '635cloud-deploy/1.0'}), timeout=20) as res:
                        if res.status != 200:
                            raise RuntimeError('HTTP ' + str(res.status))
                        return res.read()
                actual = json.loads(fetch('release.json'))
                if actual != expected:
                    raise RuntimeError('Served release does not match candidate')
                for name, digest in manifest.items():
                    # Hub intentionally serves browser assets only; VERSION and licenses stay on disk.
                    if name == 'VERSION' or name.endswith('.txt'):
                        continue
                    data = fetch(name)
                    # Hub rewrites old Vite root URLs in HTML. New builds use relative base.
                    if name == 'index.html':
                        if not data or b'<html' not in data.lower():
                            raise RuntimeError('Invalid served index.html')
                        expected_html = (target / name).read_bytes()
                        if GAME == 'magic':
                            expected_html = re.sub(rb'(["\'])/assets/', rb'\1/games/magic/assets/', expected_html)
                        # Existing Cloudflare Web Analytics injects its beacon into public HTML.
                        if origin == PUBLIC:
                            data = re.sub(rb'<script\b[^>]*\bsrc="https://static\.cloudflareinsights\.com/[^"<>]+"[^>]*>\s*</script>', b'', data)
                        normalized = lambda body: re.sub(rb'>\s+<', b'><', body).strip()
                        if normalized(data) != normalized(expected_html):
                            raise RuntimeError('Served HTML mismatch')
                    elif hashlib.sha256(data).hexdigest() != digest:
                        raise RuntimeError('Served asset checksum mismatch: ' + name)
                log('Health OK: ' + origin + ' [' + expected['sha'] + ']')
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2)

def validate(target):
    manifest = json.loads((target / 'manifest.json').read_text())
    files = {str(p.relative_to(target)) for p in target.rglob('*') if p.is_file()}
    if files - {'success.json'} != set(manifest) | {'manifest.json', 'release.json'}:
        raise RuntimeError('Manifest does not cover all runtime files')
    if 'index.html' not in manifest or not manifest:
        raise RuntimeError('Missing index.html')
    for name, digest in manifest.items():
        if not re.fullmatch('[0-9a-f]{64}', digest):
            raise RuntimeError('Invalid checksum')
        if hashlib.sha256((target / name).read_bytes()).hexdigest() != digest:
            raise RuntimeError('Checksum mismatch: ' + name)
    if GAME == 'magic' and not any(n.startswith('assets/') and n.endswith('.js') for n in manifest):
        raise RuntimeError('Missing built JavaScript')
    if GAME == 'hill' and not {'main.js', 'vendor/three.module.js', 'vendor/THREE-LICENSE.txt'} <= set(manifest):
        raise RuntimeError('Missing static runtime files')

def prune():
    successful = sorted((p for p in RELEASES.iterdir() if (p / 'success.json').exists()),
                        key=lambda p: json.loads((p / 'success.json').read_text())['time'], reverse=True)
    keep = set(successful[:5]) | {CURRENT.resolve()}
    for path in successful:
        if path not in keep:
            shutil.rmtree(path)

def main():
    args = shlex.split(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if args == ['status']:
        log(json.dumps({'current': CURRENT.resolve().name,
            'releases': [p.name for p in RELEASES.iterdir() if (p / 'success.json').exists()]}))
        return
    if len(args) != 5 or args[0] not in ('deploy', 'rollback'):
        raise RuntimeError('Allowed: status | deploy SHA RUN ATTEMPT SHA256 | rollback RELEASE RUN ATTEMPT -')
    action, value, run, attempt, digest = args
    if not run.isdigit() or not attempt.isdigit() or int(run) < 1 or int(attempt) < 1:
        raise RuntimeError('Invalid run sequence')
    if action == 'deploy' and (not re.fullmatch('[0-9a-f]{40}', value) or not re.fullmatch('[0-9a-f]{64}', digest)):
        raise RuntimeError('Invalid SHA')
    if action == 'rollback' and (digest != '-' or not re.fullmatch('[a-zA-Z0-9_-]+', value)):
        raise RuntimeError('Invalid rollback release')
    with (BASE / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state_file = BASE / 'sequence.json'
        state = json.loads(state_file.read_text()) if state_file.exists() else [0, 0]
        sequence = [int(run), int(attempt)]
        if sequence <= state:
            raise RuntimeError('Stale or duplicate run rejected: ' + str(sequence) + ' <= ' + str(state))
        write_json(state_file, sequence)
        old = CURRENT.resolve(strict=True)
        if action == 'rollback':
            if value == 'previous':
                choices = sorted((p for p in RELEASES.iterdir() if p != old and (p / 'success.json').exists()),
                    key=lambda p: json.loads((p / 'success.json').read_text())['time'], reverse=True)
                if not choices:
                    raise RuntimeError('No previous successful release')
                target = choices[0]
            else:
                target = RELEASES / value
            if not (target / 'success.json').exists():
                raise RuntimeError('Rollback target is not a successful retained release')
            validate(target)
        else:
            release_id = run + '-' + attempt + '-' + value[:12]
            target = RELEASES / release_id
            if target.exists():
                raise RuntimeError('Release already exists')
            archive = BASE / 'incoming.tar.gz'
            try:
                hasher = hashlib.sha256()
                size = 0
                with archive.open('wb') as out:
                    while chunk := sys.stdin.buffer.read(1024 * 1024):
                        size += len(chunk)
                        if size > 50 * 1024 * 1024:
                            raise RuntimeError('Archive exceeds 50 MB')
                        hasher.update(chunk)
                        out.write(chunk)
                if hasher.hexdigest() != digest:
                    raise RuntimeError('Upload checksum mismatch')
                target.mkdir()
                with tarfile.open(archive, 'r:gz') as tar:
                    total = 0
                    seen = set()
                    for member in tar:
                        name = member.name.removeprefix('./')
                        if name in ('', '.') and member.isdir():
                            continue
                        parts = Path(name).parts
                        if name.startswith('/') or '..' in parts or not re.fullmatch(r'[a-zA-Z0-9_./-]+', name):
                            raise RuntimeError('Unsafe archive path')
                        if any(part.startswith('.') for part in parts):
                            raise RuntimeError('Hidden archive path')
                        dest = target / name
                        if member.isdir():
                            dest.mkdir(parents=True, exist_ok=True)
                        elif member.isfile():
                            total += member.size
                            if total > 100 * 1024 * 1024 or name in seen:
                                raise RuntimeError('Archive exceeds limits or duplicates files')
                            seen.add(name)
                            if dest.suffix not in ('.html', '.js', '.css', '.svg', '.ico', '.png', '.jpg', '.json', '.txt', '.woff2') and name != 'VERSION':
                                raise RuntimeError('Unexpected runtime file: ' + name)
                            dest.parent.mkdir(parents=True, exist_ok=True)
                            with tar.extractfile(member) as source, dest.open('wb') as out:
                                shutil.copyfileobj(source, out)
                            dest.chmod(0o644)
                        else:
                            raise RuntimeError('Links and special files are forbidden')
                validate(target)
                release = json.loads((target / 'release.json').read_text())
                if release != {'sha': value, 'game': GAME, 'run': int(run), 'attempt': int(attempt)}:
                    raise RuntimeError('Release metadata mismatch')
            except BaseException:
                if target.exists():
                    shutil.rmtree(target)
                raise
            finally:
                archive.unlink(missing_ok=True)
        switched = False
        try:
            switch(target)
            switched = True
            log('Switched ' + old.name + ' -> ' + target.name)
            health(target)
            write_json(target / 'success.json', {'time': time.time(), 'sha': json.loads((target / 'release.json').read_text())['sha']})
            with (BASE / 'history.jsonl').open('a') as history:
                history.write(json.dumps({'action': action, 'release': target.name, 'previous': old.name, 'sequence': sequence, 'time': time.time()}) + '\n')
            prune()
            log('SUCCESS ' + target.name)
        except BaseException:
            if switched:
                switch(old)
                log('AUTO ROLLBACK -> ' + old.name)
                try:
                    health(old)
                except Exception as rollback_check:
                    log('Old release restored; rollback health check failed: ' + str(rollback_check))
            if action == 'deploy' and target.exists():
                shutil.rmtree(target)
            raise

try:
    main()
except BaseException as error:
    log('FAILED: ' + str(error))
    sys.exit(1)
