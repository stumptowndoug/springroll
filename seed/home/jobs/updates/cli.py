#!/usr/bin/env python3
"""Daily standalone CLI maintenance. --check is read-only; --apply stages updates.

Run from the Updates job alongside bin/updates (which owns chat adapters).
Versioned npm installs and atomic launchers leave running processes alone.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sqlite3
import urllib.request
import subprocess
import time

HOME = Path.home()
BASE = HOME / '.local/share/springroll/cli'
BIN = HOME / '.local/bin'
DATA = HOME / 'data/updates'
TOOLS = {
    'claude': '@anthropic-ai/claude-code',
    'codex': '@openai/codex',
    'opencode': 'opencode-ai',
    'pi': '@earendil-works/pi-coding-agent',
    'agent-browser': 'agent-browser',
}
ENV = dict(os.environ)
# Subscription credentials stay available; API billing credentials are never needed.
for key in ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'):
    ENV.pop(key, None)


def run(argv, timeout=120):
    p = subprocess.run([str(a) for a in argv], capture_output=True, text=True,
                       timeout=timeout, env=ENV)
    if p.returncode:
        # Do not include arbitrary child output in job failures (it may contain credentials).
        raise RuntimeError(f'{argv[0]} {argv[1]} exited {p.returncode}')
    return p.stdout.strip()


def version(binary):
    output = run([binary, '--version'], 30)
    match = re.search(r'\d+\.\d+\.\d+(?:-[\w.]+)?|\d{4}\.\d{2}\.\d{2}-[\w]+', output)
    if not match:
        raise RuntimeError(f'{binary}: unrecognized version output')
    return match.group()


def semver(value):
    return tuple(map(int, value.split('.')))


def ready_release(meta, now):
    latest = meta['dist-tags']['latest']
    candidates = []
    for v, published in meta['time'].items():
        if not re.fullmatch(r'\d+\.\d+\.\d+', v) or semver(v) > semver(latest):
            continue
        age = now - dt.datetime.fromisoformat(published.replace('Z', '+00:00')).timestamp()
        if age >= 3 * 86400:
            candidates.append(v)
    return max(candidates, key=semver) if candidates else None


def prune(tool, current):
    root = BASE / tool
    if not root.exists():
        return
    directories = sorted((p for p in root.iterdir() if p.is_dir()),
                         key=lambda p: p.stat().st_mtime, reverse=True)
    keep = {current, *(p.name for p in directories[:2])}
    # A process may still import files after its launcher has switched. Keep any
    # version named in its command line or holding its running executable.
    used = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            used.extend((proc / 'cmdline').read_bytes().decode(errors='replace').split('\0'))
            used.append(os.readlink(proc / 'exe'))
        except OSError:
            continue
    for directory in directories:
        prefix = str(directory) + '/'
        if directory.name in keep or any(p.startswith(prefix) for p in used):
            continue
        shutil.rmtree(directory)


def switch(tool, entry):
    BIN.mkdir(parents=True, exist_ok=True)
    target = BIN / tool
    temp = BIN / f'.{tool}-{os.getpid()}'
    # Keep Claude on subscription auth; use the concrete version path so child imports
    # in an already-running process never move when tomorrow's update switches.
    clean = 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN\n' if tool == 'claude' else ''
    temp.write_text('#!/bin/sh\n' + clean + 'exec ' + shlex.quote(str(entry)) + ' "$@"\n')
    temp.chmod(0o755)
    temp.replace(target)


def npm_tool(tool, package, apply):
    if not shutil.which(tool):
        return {'tool': tool, 'status': 'not installed'}
    current = version(tool)
    meta = json.loads(run(['npm', 'view', package, 'time', 'dist-tags', '--json']))
    ready = ready_release(meta, time.time())
    row = {'tool': tool, 'before': current, 'current': current,
           'latest': meta['dist-tags']['latest'], 'ready': ready}
    if not ready or semver(ready) <= semver(current):
        row['status'] = 'current' if current == row['latest'] else 'waiting for release age'
        if apply:
            prune(tool, current)
        return row
    row['status'] = 'update available'
    if not apply:
        return row
    directory = BASE / tool / ready
    entry = directory / 'node_modules/.bin' / tool
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'package.json').write_text('{"private":true}\n')
    run(['npm', 'install', '--prefix', directory, '--no-audit', '--no-fund',
         '--loglevel=error', f'{package}@{ready}'], 600)
    if version(entry) != ready:
        raise RuntimeError(f'{tool}: installed version did not match {ready}')
    run([entry, '--help'], 45)
    switch(tool, entry)
    if version(tool) != ready:
        raise RuntimeError(f'{tool}: PATH is hiding the updated launcher')
    prune(tool, ready)
    row.update(current=ready, status='updated')
    return row


def native_tool(tool, apply):
    if not shutil.which(tool):
        return {'tool': tool, 'status': 'not installed'}
    before = version(tool)
    if apply:
        # Both vendors stage their own binaries. Do not overwrite a running executable.
        run([tool, 'update'], 600)
    after = version(tool)
    run([tool, '--help'], 45)
    return {'tool': tool, 'before': before, 'current': after,
            'status': ('updated' if before != after else 'vendor updater checked') if apply else 'installed',
            'policy': 'vendor stable channel (no local three-day delay)'}


# Chat menus agentd remembers per agent and never re-asks for on its own. Codex's model list
# comes from OpenAI's server (new models appear without a codex-acp release), so a stale row
# hides them (2026-11-17: GPT-6.2 served, menu still on 6.1).
MENU_AGENTS = {'antigravity': 'agy-acp-server', 'codex': 'codex-acp'}


def refresh_chat_menu(agent):
    # agentd has no force-refresh API. Its existing cache-miss path probes a fresh
    # session when images is unknown. Invalidate only that marker, preserving the
    # owner's preferred model and all remembered options; let agentd write the result.
    db_path = HOME / 'data/agentd/agentd.db'
    if not db_path.exists():
        return
    with sqlite3.connect(db_path, timeout=15) as db:
        db.execute("UPDATE agent_options SET options=json_remove(options, '$.images') WHERE agent=?", (agent,))
    with urllib.request.urlopen(f'http://localhost:8090/agents/{agent}/options', timeout=120) as response:
        options = json.load(response)
    if not options.get('models') or 'images' not in options:
        raise RuntimeError(f'{agent} chat model refresh failed')
    (DATA / f'{agent}-chat-models.json').write_text(json.dumps(options, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA / 'cli.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        rows = []
        for tool, package in [*TOOLS.items(), ('agy', None), ('cursor-agent', None)]:
            try:
                row = npm_tool(tool, package, args.apply) if package else native_tool(tool, args.apply)
            except Exception as e:
                row = {'tool': tool, 'status': 'failed', 'error': str(e)}
            rows.append(row)
            print(json.dumps(row), flush=True)
        # These commands fetch the account's actual catalog without generating a response.
        # Keep snapshots for diagnosis; binary freshness does not prove model availability.
        if args.apply:
            for tool, argv in [('agy', ['agy', 'models']), ('cursor-agent', ['cursor-agent', 'models'])]:
                if not shutil.which(tool):
                    continue
                try:
                    models = run(argv, 90)
                    if not models.strip():
                        raise RuntimeError(f'{tool}: empty model catalog')
                    (DATA / f'{tool}-models.txt').write_text(models + '\n')
                except Exception as e:
                    rows.append({'tool': tool, 'status': 'failed', 'error': f'model catalog: {e}'})
        for agent, launcher in MENU_AGENTS.items() if args.apply else ():
            if not shutil.which(launcher):
                continue
            try:
                refresh_chat_menu(agent)
            except Exception as e:
                rows.append({'tool': f'{agent} chat menu', 'status': 'failed', 'error': str(e)})
        snapshot = {'checked': dt.datetime.now(dt.timezone.utc).isoformat(), 'tools': rows}
        temp = DATA / 'cli-status.tmp'
        temp.write_text(json.dumps(snapshot, indent=2) + '\n')
        temp.replace(DATA / 'cli-status.json')
        return int(any(r['status'] == 'failed' for r in rows))


if __name__ == '__main__':
    raise SystemExit(main())
