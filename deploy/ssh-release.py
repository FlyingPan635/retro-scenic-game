#!/usr/bin/env python3
"""Send archive on stdin; the server key cannot open a shell or use SFTP."""
import hashlib, os, subprocess, sys
from pathlib import Path

action, value, run, attempt = sys.argv[1:5]
options = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'UserKnownHostsFile=' + os.environ['DEPLOY_KNOWN_HOSTS_FILE'],
    '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=4', '-i', os.environ['DEPLOY_KEY_FILE'],
    '-p', '2022', os.environ['DEPLOY_USER'] + '@179.255.115.184']
if action == 'deploy':
    archive = Path(sys.argv[5])
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    with archive.open('rb') as data:
        result = subprocess.run(options + [f'deploy {value} {run} {attempt} {digest}'], stdin=data)
else:
    result = subprocess.run(options + [f'rollback {value} {run} {attempt} -'], stdin=subprocess.DEVNULL)
sys.exit(result.returncode)
