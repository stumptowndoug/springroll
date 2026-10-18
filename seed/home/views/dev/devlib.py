"""Dev: how each project in ~/projects runs, and what's running now. Shared by the `dev` command
(bin/dev) and the Dev app's server, so both see the same thing and neither needs the other.

A recipe (recipes/<project>.json) says how a project runs: its dev servers (command, port, env,
keys), its saved commands (test, lint, ...) and setup. Servers and commands run as transient
systemd user units named dev-<project>-<server> / dev-<project>-cmd-<name>, started through
`dev _exec`, which reads keys at run time so they never sit in a unit's properties.
"""
import glob, json, os, re, shlex, subprocess, time

HOME = os.path.expanduser("~")
HERE = os.path.dirname(os.path.abspath(__file__))
RECIPES = os.path.join(HERE, "recipes")
PROJECTS = os.path.expanduser(os.environ.get("DEV_PROJECTS") or "~/projects")
DATA = os.path.expanduser(os.environ.get("DEV_DATA") or "~/data/dev")
SECRETS = os.path.expanduser("~/.config/springroll/secrets.env")
PREVIEW = os.path.expanduser("~/home/bin/preview")
DEV = os.path.expanduser("~/home/bin/dev")
UNIT_RE = re.compile(r"[^a-zA-Z0-9_-]")


def sh(args, timeout=10, **kw):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout, **kw)
    except (OSError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(args, 1, "", str(e))


# ---------- recipes and projects ----------

def recipe(name):
    f = os.path.join(RECIPES, f"{name}.json")
    if not os.path.exists(f): return None
    r = json.load(open(f))
    # Commands may be "cmd" or {"run": "cmd", "about": "..."}; servers always objects.
    r["commands"] = {k: (v if isinstance(v, dict) else {"run": v}) for k, v in (r.get("commands") or {}).items()}
    r.setdefault("servers", {})
    return r


def project_names():
    names = {os.path.basename(p) for p in glob.glob(os.path.join(PROJECTS, "*")) if os.path.isdir(p)}
    names |= {os.path.basename(f)[:-5] for f in glob.glob(os.path.join(RECIPES, "*.json"))}
    return sorted(names)


def project_dir(name, r=None):
    r = r if r is not None else recipe(name)
    return os.path.expanduser((r or {}).get("dir") or os.path.join(PROJECTS, name))


def need(name):
    r = recipe(name)
    if not r:
        raise LookupError(f"No recipe for {name!r} (recipes/{name}.json). `dev detect {name}` shows what its Makefile/package.json offer.")
    return r


def detect(name):
    """What a project's own files offer to run: Makefile targets (with their ## help) and package.json scripts."""
    d, out = project_dir(name), []
    mk = os.path.join(d, "Makefile")
    if os.path.exists(mk):
        for line in open(mk, errors="replace"):
            m = re.match(r"^([a-zA-Z0-9][a-zA-Z0-9_.-]*):(?!=)[^#]*(?:##\s*(.*))?", line)
            if m and m.group(1) not in (".PHONY",):
                out.append({"source": "make", "name": m.group(1), "run": f"make {m.group(1)}", "about": (m.group(2) or "").strip()})
    pj = os.path.join(d, "package.json")
    if os.path.exists(pj):
        pm = "pnpm" if os.path.exists(os.path.join(d, "pnpm-lock.yaml")) else "yarn" if os.path.exists(os.path.join(d, "yarn.lock")) else "npm"
        for k, v in (json.load(open(pj)).get("scripts") or {}).items():
            out.append({"source": pm, "name": k, "run": f"{pm} run {k}", "about": v})
    return out


def git(name):
    d = project_dir(name)
    if not os.path.isdir(os.path.join(d, ".git")): return None
    st = sh(["git", "-C", d, "status", "--porcelain=v1", "-b"]).stdout.splitlines()
    head = st[0][3:] if st else ""
    m = re.match(r"([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?", head)
    branch, upstream, track = (m.group(1), m.group(2), m.group(3) or "") if m else (head, None, "")
    ahead = int((re.search(r"ahead (\d+)", track) or [0, 0])[1])
    behind = int((re.search(r"behind (\d+)", track) or [0, 0])[1])
    log = sh(["git", "-C", d, "log", "-8", "--format=%h%x1f%ct%x1f%an%x1f%s"]).stdout.splitlines()
    commits = [dict(zip(("hash", "time", "author", "subject"), l.split("\x1f"))) for l in log if l]
    for c in commits: c["time"] = int(c["time"])
    return {"branch": branch, "upstream": upstream, "ahead": ahead, "behind": behind,
            "changed": [l[3:] for l in st[1:]], "commits": commits}


# ---------- units ----------

def unit(name, kind, key):
    """dev-<project>-<server> or dev-<project>-cmd-<command>."""
    return UNIT_RE.sub("_", f"dev-{name}-{'cmd-' if kind == 'cmd' else ''}{key}") + ".service"


def unit_state(u):
    out = sh(["systemctl", "--user", "show", u, "-p", "ActiveState,SubState,ActiveEnterTimestampMonotonic,MainPID,Result,ExecMainStatus,MemoryCurrent"]).stdout
    p = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
    state = p.get("ActiveState", "inactive")
    since = None
    mono = int(p.get("ActiveEnterTimestampMonotonic") or 0)
    if state == "active" and mono:
        since = time.time() - (time.monotonic() - mono / 1e6)
    mem = p.get("MemoryCurrent", "")
    return {"state": state, "since": since, "pid": int(p.get("MainPID") or 0) or None,
            "result": p.get("Result"), "memory": int(mem) if mem.isdigit() else None}


def listening():
    """{port: [pid, ...]} for every TCP port something listens on (pids only for our own processes)."""
    out = {}
    for line in sh(["ss", "-ltnpH"]).stdout.splitlines():
        cols = line.split()
        if len(cols) < 4: continue
        addr = cols[3]
        port = int(addr.rsplit(":", 1)[1]) if addr.rsplit(":", 1)[-1].isdigit() else None
        if port is None: continue
        pids = [int(p) for p in re.findall(r"pid=(\d+)", line)]
        names = re.findall(r'\("([^"]+)"', line)
        host = addr.rsplit(":", 1)[0].strip("[]")
        e = out.setdefault(port, {"port": port, "pids": set(), "names": set(), "hosts": set()})
        e["pids"].update(pids); e["names"].update(names); e["hosts"].add(host)
    return out


def previews():
    """{port: url} for ports `preview` has published."""
    r = sh([PREVIEW, "list", "--json"], timeout=8)
    try: return {int(k): v for k, v in json.loads(r.stdout or "{}").items()}
    except ValueError: return {}


def last_run(name, key):
    f = os.path.join(DATA, "runs", f"{name}--{key}.json")
    try: return json.load(open(f))
    except (OSError, ValueError): return None


def server_status(name, key, s, ports=None, pv=None):
    u = unit(name, "server", key)
    st = unit_state(u)
    port = s.get("port")
    ports = ports if ports is not None else listening()
    pv = pv if pv is not None else previews()
    return {"name": key, "unit": u, "port": port, "about": s.get("about", ""), "run": s.get("run"),
            **st, "listening": port in ports, "preview": pv.get(port), "wantsPreview": s.get("preview", True),
            "log": f"journalctl --user -u {u} -n 100"}


def status(name, ports=None, pv=None):
    """Everything about one project: recipe, servers and their state, commands and their last run, git."""
    r = recipe(name)
    d = project_dir(name, r)
    out = {"name": name, "dir": d, "exists": os.path.isdir(d), "recipe": bool(r),
           "recipeFile": os.path.join(RECIPES, f"{name}.json"),
           "title": (r or {}).get("title") or name, "about": (r or {}).get("about", ""),
           "notes": (r or {}).get("notes", ""), "setup": (r or {}).get("setup"), "git": git(name) if os.path.isdir(d) else None}
    if r:
        ports = ports if ports is not None else listening()
        pv = pv if pv is not None else previews()
        out["servers"] = [server_status(name, k, s, ports, pv) for k, s in r["servers"].items()]
        out["commands"] = []
        for k, c in r["commands"].items():
            u = unit(name, "cmd", k)
            out["commands"].append({"name": k, "run": c["run"], "about": c.get("about", ""), "unit": u,
                                    "running": unit_state(u)["state"] in ("active", "activating"),
                                    "last": last_run(name, k)})
        if r.get("setup"):
            u = unit(name, "cmd", "setup")
            out["setupRun"] = {"unit": u, "running": unit_state(u)["state"] in ("active", "activating"), "last": last_run(name, "setup")}
    else:
        out["detected"] = detect(name) if os.path.isdir(d) else []
    return out


def all_status():
    ports, pv = listening(), previews()
    return [status(n, ports, pv) for n in project_names()]


# ---------- running ----------

def _systemd_run(u, args, memory=("1500M", "3G")):
    sh(["systemctl", "--user", "reset-failed", u])
    return sh(["systemd-run", "--user", "--unit", u, "--quiet",
               "-p", f"MemoryHigh={memory[0]}", "-p", f"MemoryMax={memory[1]}", "-p", "OOMScoreAdjust=500",
               "-p", "TimeoutStopSec=10", *args], timeout=20)


def up(name, which=None):
    """Start a project's servers (all, or the named ones) and publish their ports with `preview`."""
    r = need(name)
    keys = which or list(r["servers"])
    out = []
    for k in keys:
        s = r["servers"].get(k)
        if not s: raise LookupError(f"{name} has no server {k!r} (has: {', '.join(r['servers']) or 'none'})")
        u = unit(name, "server", k)
        if unit_state(u)["state"] in ("active", "activating"):
            out.append({"name": k, "unit": u, "already": True})
        else:
            port = s.get("port")
            e = listening().get(port)
            # A leftover preview forwarder on the port is fine; anything else is in the way.
            if e and (not e["pids"] or any(not (_cgroup_unit(p) or "").startswith("preview-") for p in e["pids"])):
                raise RuntimeError(f"Port {port} is already in use ({', '.join(e['names']) or 'a system process'}); `dev ports` shows by whom.")
            mem = s.get("memory") or ["1500M", "3G"]
            res = _systemd_run(u, [DEV, "_exec", name, "server", k], tuple(mem))
            if res.returncode: raise RuntimeError(f"Couldn't start {u}: {res.stderr.strip()}")
            out.append({"name": k, "unit": u, "started": True})
        if s.get("port") and s.get("preview", True):
            p = sh([PREVIEW, str(s["port"]), "--no-show"], timeout=20)
            out[-1]["preview"] = p.stdout.strip().splitlines()[-1] if p.returncode == 0 and p.stdout.strip() else None
            if p.returncode: out[-1]["previewError"] = (p.stderr or p.stdout).strip()
    return out


def down(name, which=None):
    r = need(name)
    out = []
    for k in which or list(r["servers"]):
        s = r["servers"].get(k) or {}
        u = unit(name, "server", k)
        sh(["systemctl", "--user", "stop", u], timeout=20)
        sh(["systemctl", "--user", "reset-failed", u])
        if s.get("port") and s.get("preview", True):
            sh([PREVIEW, str(s["port"]), "off"], timeout=20)
        out.append({"name": k, "unit": u, "stopped": True})
    return out


def start_command(name, key):
    """Run a saved command (or "setup") in the background as its own unit; its output goes to the journal."""
    r = need(name)
    if key != "setup" and key not in r["commands"]:
        raise LookupError(f"{name} has no command {key!r} (has: {', '.join(r['commands']) or 'none'})")
    if key == "setup" and not r.get("setup"): raise LookupError(f"{name} has no setup")
    u = unit(name, "cmd", key)
    if unit_state(u)["state"] in ("active", "activating"): return {"name": key, "unit": u, "already": True}
    res = _systemd_run(u, ["-p", "RemainAfterExit=no", DEV, "_exec", name, "cmd", key], ("2G", "4G"))
    if res.returncode: raise RuntimeError(f"Couldn't start {u}: {res.stderr.strip()}")
    return {"name": key, "unit": u, "started": True}


def stop_command(name, key):
    u = unit(name, "cmd", key)
    sh(["systemctl", "--user", "stop", u], timeout=20)
    return {"name": key, "unit": u, "stopped": True}


def logs(u, n=200, since=None):
    """A unit's recent output; `since` (unix time) keeps it to the latest run."""
    if not re.fullmatch(r"(dev|preview)-[a-zA-Z0-9_-]+\.service", u): raise LookupError("not a dev unit")
    extra = ["--since", f"@{int(float(since)) - 2}"] if since else []
    r = sh(["journalctl", "--user", "-u", u, "-n", str(int(n)), "--no-pager", "-o", "cat", *extra])
    return r.stdout


def read_secrets(names):
    """Only the named keys from secrets.env (KEY=value lines, optionally quoted)."""
    out = {}
    try:
        for line in open(SECRETS):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            k, v = line.split("=", 1)
            k = k.removeprefix("export ").strip()
            if k in names:
                try: v = shlex.split(v)[0] if v.strip() else ""
                except ValueError: pass
                out[k] = v
    except OSError: pass
    return out


def exec_env(name, r, spec):
    """The environment a server or command runs with: ours, plus the recipe's env, its keys and PORT."""
    env = dict(os.environ)
    env.update({k: str(v) for k, v in (r.get("env") or {}).items()})
    env.update({k: str(v) for k, v in (spec.get("env") or {}).items()})
    want = {**(r.get("secrets") or {}), **(spec.get("secrets") or {})}  # {ENV_VAR: SECRET_NAME}
    files = {**(r.get("secretFiles") or {}), **(spec.get("secretFiles") or {})}  # {ENV_VAR: SECRET_NAME}, as a file path
    got = read_secrets(set(want.values()) | set(files.values()))
    missing = sorted({s for s in [*want.values(), *files.values()] if s not in got})
    for var, sec in want.items():
        if sec in got: env[var] = got[sec]
    for var, sec in files.items():
        if sec not in got: continue
        # Credentials some tools only take as a file (GOOGLE_APPLICATION_CREDENTIALS): kept beside the secrets, 0600.
        d = os.path.expanduser("~/.config/springroll/dev")
        os.makedirs(d, mode=0o700, exist_ok=True)
        path = os.path.join(d, sec)
        fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh: fh.write(got[sec])
        os.replace(path + ".tmp", path)
        env[var] = path
    if spec.get("port"): env["PORT"] = str(spec["port"])
    return env, missing


# ---------- ports ----------

KNOWN = {22: "SSH", 8000: "Springroll", 8090: "agentd (chats and jobs)"}
KNOWN_UNITS = {"desk-term.service": "Terminal", "tailscale-browser.service": "Browser app (Tailscale)"}


def _cgroup_unit(pid):
    try:
        for line in open(f"/proc/{pid}/cgroup"):
            m = re.findall(r"/([^/]+\.service)", line)
            if m: return m[-1]
    except OSError: pass
    return None


def _cwd(pid):
    try: return os.readlink(f"/proc/{pid}/cwd")
    except OSError: return None


def ports():
    """Every open TCP port and who it belongs to: a project's dev server, a Springroll app, or a stray process."""
    apps = {}
    for f in glob.glob(os.path.expanduser("~/home/views/*/PORT")):
        try: apps[int(open(f).read().strip())] = os.path.basename(os.path.dirname(f))
        except ValueError: pass
    pv = previews()
    rec = {}
    for n in project_names():
        r = recipe(n)
        for k, s in ((r or {}).get("servers") or {}).items():
            if s.get("port"): rec[s["port"]] = (n, k)
    out = []
    for port, e in sorted(listening().items()):
        pids = sorted(e["pids"])
        units = {u for u in (_cgroup_unit(p) for p in pids) if u}
        cwds = {c for c in (_cwd(p) for p in pids) if c}
        names = sorted(n for n in e["names"] if n != "socat") or sorted(e["names"])  # socat is preview's forwarder
        row = {"port": port, "hosts": sorted(e["hosts"]), "process": ", ".join(names) or None,
               "pids": pids, "unit": next(iter(units), None), "preview": pv.get(port), "kind": "other", "owner": None}
        dev_unit = next((u for u in units if u.startswith("dev-")), None)
        prev_unit = next((u for u in units if u.startswith("preview-")), None)
        if dev_unit:
            row["kind"], row["owner"] = "dev", rec.get(port, (dev_unit[4:-8], None))[0]
            row["server"] = rec.get(port, (None, None))[1]
        elif prev_unit:
            row["kind"], row["owner"] = "preview", f"forwards to :{port}"
        elif port in apps:
            row["kind"], row["owner"] = "app", apps[port]
        elif port in KNOWN or units & KNOWN_UNITS.keys():
            row["kind"], row["owner"] = "springroll", KNOWN.get(port) or KNOWN_UNITS[next(iter(units & KNOWN_UNITS.keys()))]
        else:
            proj = next((os.path.relpath(c, PROJECTS).split(os.sep)[0] for c in cwds
                         if c.startswith(PROJECTS + os.sep) or c == PROJECTS), None)
            if proj: row["kind"], row["owner"] = "stray", proj  # a project's process started outside `dev`
            elif not pids: row["owner"] = "system"
            else: row["owner"] = next(iter(units), None) or (cwds and next(iter(cwds))) or None
        out.append(row)
    return out
