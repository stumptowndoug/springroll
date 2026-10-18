"""Dev: how each project in ~/projects runs, and what's running now. Shared by the `dev` command
(bin/dev) and the Dev app's server, so both see the same thing and neither needs the other.

A recipe (recipes/<project>.json) says how a project runs: its dev servers (command, port, env,
keys), its saved commands (test, lint, ...) and setup. Servers and commands run as transient
systemd user units named dev-<project>-<server> / dev-<project>-cmd-<name>, started through
`dev _exec`, which reads keys at run time so they never sit in a unit's properties.
"""
import glob, json, os, re, shlex, subprocess, time, urllib.error, urllib.parse, urllib.request

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


def status(name, ports=None, pv=None, have=None):
    """Everything about one project: recipe, servers and their state, commands and their last run, git."""
    r = recipe(name)
    d = project_dir(name, r)
    out = {"name": name, "dir": d, "exists": os.path.isdir(d), "recipe": bool(r),
           "recipeFile": os.path.join(RECIPES, f"{name}.json"),
           "title": (r or {}).get("title") or name, "about": (r or {}).get("about", ""),
           "notes": (r or {}).get("notes", ""), "setup": (r or {}).get("setup"), "git": git(name) if os.path.isdir(d) else None}
    if r:
        out["keys"] = keys(name, r, have)
        out["database"] = db_status(name, r)
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
    ports, pv, have = listening(), previews(), secret_names()
    return [status(n, ports, pv, have) for n in project_names()]


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
    if r.get("database") and keys:
        db = db_ensure(name)  # before any server starts, so a Neon problem stops here, not in a log
        out.append({"name": "database", "branch": db["branch"], "made": db["made"]})
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
    if key != "setup" and uses_db(r, "cmd", r["commands"][key]): db_ensure(name)
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


def secret_names():
    """The names set in Keys (never their values)."""
    names = set()
    try:
        for line in open(SECRETS):
            m = re.match(r"\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)", line)
            if m and m.group(2).strip() not in ("", "''", '""'): names.add(m.group(1))
    except OSError: pass
    return names


def keys(name, r=None, have=None):
    """Every key a recipe names: the variables it fills, what uses it, and whether it's set in Keys."""
    r = r if r is not None else need(name)
    have = have if have is not None else secret_names()
    notes = r.get("keyNotes") or {}
    out = {}

    def add(where, spec):
        for field, suffix in (("secrets", ""), ("secretFiles", " (as a file)")):
            for var, sec in (spec.get(field) or {}).items():
                k = out.setdefault(sec, {"name": sec, "vars": [], "usedBy": [], "set": sec in have, "about": notes.get(sec, "")})
                if var + suffix not in k["vars"]: k["vars"].append(var + suffix)
                if where not in k["usedBy"]: k["usedBy"].append(where)

    add("everything", r)
    for k, s in r["servers"].items(): add(k, s)
    for k, c in r["commands"].items(): add(k, c)
    if r.get("database"):
        sec = r["database"].get("key", "NEON_API_KEY")
        k = out.setdefault(sec, {"name": sec, "vars": [], "usedBy": [], "set": sec in have,
                                 "about": notes.get(sec, "Neon API key: makes this project's dev database branch")})
        k["usedBy"].append("database")
    return sorted(out.values(), key=lambda k: (k["set"], k["name"]))


def add_key(name, var, secret, note=None):
    """Have a project use a key: recipe "secrets" {var: secret} (and keyNotes[secret] = note)."""
    need(name)
    var, secret = (var or "").strip().upper(), (secret or "").strip().upper()
    for n in (var, secret):
        if not re.match(r"^[A-Z_][A-Z0-9_]{0,63}$", n): raise ValueError(f"{n or 'A name'} isn't a valid variable or key name")
    f = os.path.join(RECIPES, f"{name}.json")
    raw = json.load(open(f))
    before = (raw.get("secrets") or {}).get(var)
    raw.setdefault("secrets", {})[var] = secret
    if note: raw.setdefault("keyNotes", {})[secret] = note
    with open(f + ".tmp", "w") as fh: fh.write(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    os.replace(f + ".tmp", f)
    return {"project": name, "var": var, "secret": secret, "replaced": before if before and before != secret else None}


# ---------- importing a .env ----------
# The owner pastes a project's .env once; nothing is written to a file. Settings go into the
# recipe's "env", keys into Keys (named <PREFIX>_DEV_<NAME>, or an existing key with the same value)
# and the recipe's "secrets"; what the Dev app supplies, or what looks live, is skipped.

SECRET_RE = re.compile(r"KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS$|PRIVATE|CREDENTIAL|SALT|DSN|_PAT$|^PAT_")
NOT_SECRET_RE = re.compile(r"_(PROVIDER|ENABLED|URL|HOST|PORT|TIMEOUT[A-Z_]*|ID|IDS|SCOPES|ALLOWLIST|ORIGINS|DAYS|SIZE|SECONDS)$")
LIVE_VALUE_RE = re.compile(r"^(sk|rk|pk)_live_")
ANALYTICS_RE = re.compile(r"GA_MEASUREMENT|GTAG|GTM_|CLARITY|UMAMI_WEBSITE|POSTHOG|MIXPANEL|SEGMENT_WRITE|HOTJAR|PLAUSIBLE|SENTRY_DSN")
NAME_RE = re.compile(r"^[A-Z_][A-Z0-9_]{0,63}$")


def parse_env(text):
    """[(NAME, value)] from .env text: comments, `export`, quotes, and `# comments` after unquoted values."""
    out = {}
    for line in (text or "").splitlines():
        m = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if not m: continue
        name, v = m.group(1).upper(), m.group(2).strip()
        if v[:1] in ("'", '"'):
            q = v[0]; end = v.find(q, 1)
            v = v[1:end] if end > 0 else v[1:]
            if q == '"': v = v.replace("\\n", "\n")
        else:
            v = re.split(r"\s+#", v, 1)[0].strip()
        out[name] = v  # the last one wins, as in dotenv
    return list(out.items())


def key_prefix(name, r):
    return (r.get("keyPrefix") or re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")) + "_DEV_"


def _all_secret_values():
    out = {}
    try:
        for line in open(SECRETS):
            m = re.match(r"\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)", line.strip())
            if not m: continue
            v = m.group(2)
            try: v = shlex.split(v)[0] if v.strip() else ""
            except ValueError: pass
            if v: out[m.group(1)] = v
    except OSError: pass
    return out


def _springroll_port(v):
    """A localhost URL on 8000-8199 (Springroll's ports here; often a dev server's on the owner's Mac)."""
    m = re.search(r"(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4})\b", v)
    return int(m.group(1)) if m and 8000 <= int(m.group(1)) <= 8199 else None


def _mask(v):
    return "••••" if len(v) < 10 else f"{v[:4]}…{v[-2:]}"


def env_plan(name, text, r=None):
    """What importing this .env would do, row by row (key values masked; nothing saved)."""
    r = r if r is not None else need(name)
    have = _all_secret_values()
    by_value = {}
    for k, v in have.items(): by_value.setdefault(v, k)
    set_in = {}
    for k in (r.get("env") or {}): set_in.setdefault(k, "the recipe")
    for sk, sp in r["servers"].items():
        for k in (sp.get("env") or {}): set_in.setdefault(k, f"the {sk} server")
    mapped = {var: sec for var, sec in (r.get("secrets") or {}).items()}
    db_env = r["database"].get("env", "DATABASE_URL") if r.get("database") else None
    rows, pasted = [], {}  # pasted: value -> the key an earlier line of this paste already goes to
    for var, v in parse_env(text):
        row = {"name": var, "kind": "setting", "action": "env", "reason": "", "preview": v}
        has_password = bool(re.match(r"^[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@", v, re.I))  # scheme://user:pass@
        secretish = (bool(SECRET_RE.search(var)) and not NOT_SECRET_RE.search(var)) or has_password
        if secretish or LIVE_VALUE_RE.match(v):
            row.update(kind="key", action="key", preview=_mask(v))
            same = by_value.get(v) if v else None
            twin = pasted.get(v) if v and not same else None
            row["secret"] = same or twin or mapped.get(var) or key_prefix(name, r) + var
            row["exists"] = "same" if same else "pasted" if twin else ("different" if row["secret"] in have else None)
            if same: row["reason"] = f"already in Keys as {same}"
            elif twin: row["reason"] = f"same value as an earlier line: uses {twin}"
            elif row["exists"] == "different": row["reason"] = f"replaces the value of {row['secret']} in Keys"
            if v and not same and not twin: pasted[v] = row["secret"]
            if not NAME_RE.match(row["secret"]): row.update(action="skip", reason=f"{row['secret']} is too long a name for Keys")
        if var == "PORT" or var == db_env:
            row.update(kind="supplied", action="skip", preview=_mask(v) if secretish else v,
                       reason="the Dev app sets it" + (" (the dev database)" if var == db_env else ""))
            row.pop("secret", None); row.pop("exists", None)
        elif not v:
            row.update(action="skip", reason="empty")
        elif LIVE_VALUE_RE.match(v):
            row.update(action="skip", reason="a live key: dev should use a test-mode one")
        elif ANALYTICS_RE.search(var):
            row.update(action="skip", reason="analytics: dev visits shouldn't count")
        elif row["kind"] == "setting" and _springroll_port(v):
            row.update(action="skip", reason=f"localhost:{_springroll_port(v)} is Springroll on this machine; "
                                             "point it at a dev server's port in the recipe")
        elif var in set_in and row["kind"] == "setting":
            row.update(action="skip", reason=f"{set_in[var]} already sets it")
        rows.append(row)
    return rows


def import_env(name, text, choices=None):
    """Apply an .env: save its keys into Keys, write settings and key names into the recipe.
    `choices` {NAME: "env"|"key"|"skip"} overrides the plan's defaults. Returns what was done."""
    r = need(name)
    choices = choices or {}
    values = dict(parse_env(text))
    plan = env_plan(name, text, r)
    raw = json.load(open(os.path.join(RECIPES, f"{name}.json")))
    env, secrets, notes = raw.setdefault("env", {}), raw.setdefault("secrets", {}), raw.setdefault("keyNotes", {})
    done = {"settings": [], "keys": [], "skipped": []}
    for row in plan:
        var, act = row["name"], choices.get(row["name"], row["action"])
        if act == "env":
            env[var] = values[var]; done["settings"].append(var)
        elif act == "key":
            sec = row.get("secret") or key_prefix(name, r) + var
            if not NAME_RE.match(sec): raise ValueError(f"{sec} is too long a name for Keys")
            if row.get("exists") not in ("same", "pasted"):
                _save_secret(sec, values[var], f"{name} dev ({var}), imported from a .env")
            secrets[var] = sec
            notes.setdefault(sec, f"{var} for {name} in dev (imported from a .env)")
            done["keys"].append({"name": var, "secret": sec})
        else:
            done["skipped"].append(var)
    for k in ("env", "secrets", "keyNotes"):
        if not raw[k]: del raw[k]
    f = os.path.join(RECIPES, f"{name}.json")
    with open(f + ".tmp", "w") as fh: fh.write(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    os.replace(f + ".tmp", f)
    return done


def _save_secret(name, value, note):
    """Into Keys through Springroll (so it's masked in chats and answers any open request)."""
    req = urllib.request.Request("http://127.0.0.1:8000/api/secrets", method="POST",
                                 data=json.dumps({"name": name, "value": value, "note": note}).encode(),
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp: json.load(resp)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Keys didn't take {name}: {e.read().decode(errors='replace')[:200]}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Couldn't reach Springroll to save {name}: {e.reason}")


# ---------- database: a throwaway Neon branch per project ----------
# A recipe's "database": {"neon": "<project id>", "from": "production", "env": "DATABASE_URL",
#   "name": "neondb", "role": "neondb_owner"} gives its servers (and commands with "database": true)
# a branch dev-<project>, copied from `from` the first time and reused after. Only dev-* branches
# are ever created, reset or deleted; the connection string is fetched at start, never stored.

NEON_API = "https://console.neon.tech/api/v2"
_db_cache = {}


def db_branch(name):
    return "dev-" + re.sub(r"[^a-z0-9-]", "-", name.lower())


def _neon(r, method, path, body=None):
    sec = r["database"].get("key", "NEON_API_KEY")
    key = read_secrets({sec}).get(sec)
    if not key: raise RuntimeError(f"The Neon key {sec} isn't in Keys.")
    req = urllib.request.Request(NEON_API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp: return json.load(resp)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Neon said {e.code} to {method} {path.split('?')[0]}: {e.read().decode(errors='replace')[:200]}")
    except (urllib.error.URLError, TimeoutError) as e:
        raise RuntimeError(f"Couldn't reach Neon: {getattr(e, 'reason', e)}")


def _db_branches(name, r):
    """(the dev branch or None, the branch it's copied from) in the recipe's Neon project."""
    db = r["database"]
    bs = _neon(r, "GET", f"/projects/{db['neon']}/branches")["branches"]
    dev = next((b for b in bs if b["name"] == db_branch(name)), None)
    parent = next((b for b in bs if b["name"] == db.get("from", "production")), None)
    if dev and (dev.get("default") or dev.get("protected") or (parent and dev["id"] == parent["id"])):
        raise RuntimeError(f"{dev['name']} is a default or protected branch; dev won't use it.")
    return dev, parent


def db_status(name, r=None, fresh=False):
    """The project's dev database: branch, where it's copied from, size; cached a minute for the app's polling."""
    r = r if r is not None else need(name)
    db = r.get("database")
    if not db: return None
    hit = _db_cache.get(name)
    if hit and not fresh and time.time() - hit[0] < 60: return hit[1]
    out = {"provider": "neon", "project": db["neon"], "branch": db_branch(name), "from": db.get("from", "production"),
           "env": db.get("env", "DATABASE_URL"), "about": db.get("about", ""), "exists": None}
    try:
        dev, _ = _db_branches(name, r)
        out["exists"] = bool(dev)
        if dev: out.update(id=dev["id"], createdAt=dev.get("created_at"), size=dev.get("logical_size"), state=dev.get("current_state"))
    except RuntimeError as e:
        out["error"] = str(e)
    _db_cache[name] = (time.time(), out)
    return out


def db_ensure(name):
    """Make the dev branch if it doesn't exist (a copy of `from`, with its own compute); reuse it if it does."""
    r = need(name)
    db = r.get("database")
    if not db: raise LookupError(f"{name}'s recipe has no database")
    dev, parent = _db_branches(name, r)
    made = False
    if not dev:
        if not parent: raise RuntimeError(f"No branch {db.get('from', 'production')!r} in Neon project {db['neon']} to copy from.")
        _neon(r, "POST", f"/projects/{db['neon']}/branches",
              {"branch": {"name": db_branch(name), "parent_id": parent["id"]}, "endpoints": [{"type": "read_write"}]})
        made = True
    return {**db_status(name, r, fresh=True), "made": made}


def db_reset(name):
    """Throw away everything written to the dev branch: it becomes a fresh copy of `from`."""
    r = need(name)
    dev, parent = _db_branches(name, r)
    if not dev: raise LookupError(f"{name} has no dev database yet")
    if not parent: raise RuntimeError(f"No branch {r['database'].get('from', 'production')!r} to reset from")
    _neon(r, "POST", f"/projects/{r['database']['neon']}/branches/{dev['id']}/restore", {"source_branch_id": parent["id"]})
    return {**db_status(name, r, fresh=True), "reset": True}


def db_drop(name):
    """Delete the dev branch (only ever a dev-* branch); the next start makes a new one."""
    r = need(name)
    dev, _ = _db_branches(name, r)
    if not dev: return {**db_status(name, r, fresh=True), "deleted": False}
    if not dev["name"].startswith("dev-"): raise RuntimeError(f"Refusing to delete {dev['name']}")
    _neon(r, "DELETE", f"/projects/{r['database']['neon']}/branches/{dev['id']}")
    return {**db_status(name, r, fresh=True), "deleted": True}


def db_url(name, r):
    """The dev branch's connection string, fetched from Neon when a server starts."""
    db = r["database"]
    dev, _ = _db_branches(name, r)
    if not dev: raise RuntimeError(f"No dev database yet ({db_branch(name)}); `dev up {name}` makes it.")
    q = urllib.parse.urlencode({"branch_id": dev["id"], "database_name": db.get("name", "neondb"),
                                "role_name": db.get("role", "neondb_owner"), "pooled": "true" if db.get("pooled") else "false"})
    uri = _neon(r, "GET", f"/projects/{db['neon']}/connection_uri?{q}")["uri"]
    return uri if "sslmode" in uri else uri + ("&" if "?" in uri else "?") + "sslmode=require"


def uses_db(r, kind, spec):
    return bool(r.get("database")) and (kind == "server" or bool(spec.get("database")))


def exec_env(name, r, spec, kind="cmd"):
    """The environment a server or command runs with: ours, plus the recipe's env, its keys, its dev
    database and PORT. Returns (env, problems): keys not in Keys, or a database it couldn't get."""
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
    missing = [f"key {m}" for m in missing]
    if uses_db(r, kind, spec):
        try: env[r["database"].get("env", "DATABASE_URL")] = db_url(name, r)
        except RuntimeError as e: missing.append(f"database ({e})")
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
