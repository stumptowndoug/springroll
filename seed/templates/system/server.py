#!/usr/bin/env python3
"""System View: what's using this machine, and a watchdog for when it's too much.

Samples every 5 seconds (memory, CPU, disk, memory pressure, and usage grouped
by agent session, View service, and other processes), keeps history in
~/data/system/metrics.db, serves the page and a JSON API, and runs the
watchdog configured in watch.json. Standard library only.
"""
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOME = Path.home()
VIEWS = HOME / "home" / "views"
AGENTS = HOME / "home" / "agents" / "agents.json"
DATA = HOME / "data" / "system"
INCIDENTS = DATA / "incidents"
DATA.mkdir(parents=True, exist_ok=True)
INCIDENTS.mkdir(exist_ok=True)
PORT = int((HERE / "PORT").read_text().strip())
UID = os.getuid()
ENV = dict(os.environ, XDG_RUNTIME_DIR=f"/run/user/{UID}",
           PATH=f"{HOME}/.local/bin:{HOME}/.npm-global/bin:{HOME}/home/bin:" + os.environ.get("PATH", "/usr/bin:/bin"))
CORE_UNITS = {"desk.service", "desk-term.service", "system.service"}  # never paused or stopped from here
SAMPLE_SECONDS = 5

lock = threading.Lock()
state = {"now": None, "groups": None}
group_history = {}  # group key -> deque[(ts, bytes)] for trend detection
watch_state = {"memory_since": None, "disk_since": None, "last_agent_run": 0, "running": None}


def sh(*args, timeout=10):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=ENV).stdout
    except Exception:
        return ""


def read(path, default=""):
    try:
        return Path(path).read_text()
    except Exception:
        return default


def watch_config():
    defaults = {"memoryWarnPercent": 85, "memoryForSeconds": 120, "diskWarnPercent": 90,
                "agent": "claude", "agentEnabled": True, "cooldownMinutes": 30}
    try:
        defaults.update(json.loads(read(HERE / "watch.json", "{}")))
    except Exception:
        pass
    return defaults


# ---------- Machine-wide numbers ----------

_cpu_prev = None


def cpu_percent():
    global _cpu_prev
    parts = [int(x) for x in read("/proc/stat").splitlines()[0].split()[1:]]
    idle, total = parts[3] + parts[4], sum(parts)
    prev, _cpu_prev = _cpu_prev, (idle, total)
    if not prev or total == prev[1]:
        return 0.0
    return round(100 * (1 - (idle - prev[0]) / (total - prev[1])), 1)


def meminfo():
    m = {}
    for line in read("/proc/meminfo").splitlines():
        k, v = line.split(":", 1)
        m[k] = int(v.split()[0]) * 1024
    return m


def pressure():
    m = re.search(r"some avg10=([\d.]+) avg60=([\d.]+)", read("/proc/pressure/memory"))
    return {"avg10": float(m.group(1)), "avg60": float(m.group(2))} if m else None


def machine():
    m = meminfo()
    total, avail = m["MemTotal"], m["MemAvailable"]
    du = shutil.disk_usage("/")
    load = read("/proc/loadavg").split()
    return {
        "host": os.uname().nodename,
        "uptime": int(float(read("/proc/uptime", "0").split()[0])),
        "cpus": os.cpu_count(),
        "cpu": cpu_percent(),
        "load": [float(x) for x in load[:3]] if load else [],
        "mem": {"total": total, "used": total - avail, "available": avail,
                "percent": round(100 * (total - avail) / total, 1)},
        "swap": {"total": m.get("SwapTotal", 0), "used": m.get("SwapTotal", 0) - m.get("SwapFree", 0)},
        "disk": {"total": du.total, "used": du.used, "percent": round(100 * du.used / du.total, 1)},
        "pressure": pressure(),
        "at": time.time(),
    }


# ---------- Processes ----------

PAGE = os.sysconf("SC_PAGE_SIZE")
CLK = os.sysconf("SC_CLK_TCK")


def processes():
    """pid -> {ppid, comm, rss, ticks, state, uid}"""
    out = {}
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            stat = read(f"/proc/{d}/stat")
            comm = stat[stat.index("(") + 1:stat.rindex(")")]
            f = stat[stat.rindex(")") + 2:].split()
            cg = read(f"/proc/{d}/cgroup").strip().rpartition("/")[2]  # e.g. mail.service, agent-x-1.scope
            out[int(d)] = {"ppid": int(f[1]), "comm": comm, "state": f[0], "ticks": int(f[11]) + int(f[12]),
                           "rss": int(f[21]) * PAGE, "uid": os.stat(f"/proc/{d}").st_uid, "unit": cg}
        except Exception:
            continue
    return out


def tree(pid, procs, children):
    stack, seen = [pid], []
    while stack:
        p = stack.pop()
        if p in procs:
            seen.append(p)
            stack.extend(children.get(p, []))
    return seen


_ticks_prev = {}


def cpu_of(key, ticks, now):
    prev = _ticks_prev.get(key)
    _ticks_prev[key] = (ticks, now)
    if not prev or now <= prev[1]:
        return 0.0
    return round(100 * (ticks - prev[0]) / CLK / (now - prev[1]), 1)


def trend(key, rss, now):
    h = group_history.setdefault(key, deque(maxlen=int(1800 / SAMPLE_SECONDS)))
    h.append((now, rss))
    # Growth over the last ~10 minutes, in bytes per minute.
    old = next((v for t, v in h if now - t <= 600), None)
    first_t = next((t for t, v in h if now - t <= 600), now)
    if old is None or now - first_t < 120:
        return 0
    return int((rss - old) / ((now - first_t) / 60))


def unit_props(units):
    if not units:
        return {}
    out, cur = {}, {}
    text = sh("systemctl", "--user", "show", *units,
              "-p", "Id,Description,MemoryCurrent,MemoryMax,MemoryHigh,CPUUsageNSec,FreezerState,ActiveState,MainPID")
    for line in text.splitlines() + [""]:
        if not line.strip():
            if cur.get("Id"):
                out[cur["Id"]] = cur
            cur = {}
            continue
        k, _, v = line.partition("=")
        cur[k] = v
    return out


def view_units():
    """unit file name -> view name, for units kept in View folders."""
    m = {}
    for f in VIEWS.glob("*/*.service"):
        m[f.name] = f.parent.name
    return m


def num(v):
    try:
        n = int(v)
        return None if n >= 2**63 - 1 else n
    except Exception:
        return None


def groups(now):
    procs = processes()
    children = {}
    for pid, p in procs.items():
        children.setdefault(p["ppid"], []).append(pid)
    claimed = set()

    # Agent sessions: every tmux pane's process tree, grouped by session.
    sessions = []
    panes = sh("tmux", "list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}\t#{pane_current_path}")
    by_session = {}
    for line in panes.splitlines():
        try:
            name, pid, cwd = line.split("\t")
            by_session.setdefault(name, {"pids": [], "cwd": cwd})["pids"] += tree(int(pid), procs, children)
        except ValueError:
            continue
    for name, s in by_session.items():
        pids = s["pids"]
        claimed.update(pids)
        rss = sum(procs[p]["rss"] for p in pids)
        ticks = sum(procs[p]["ticks"] for p in pids)
        main = max((procs[p] for p in pids if procs[p]["comm"] not in ("bash", "sh")), key=lambda p: p["rss"], default=None)
        busy_pids = [p for p in pids if procs[p]["comm"] not in ("bash", "sh", "tmux: server")]
        paused = bool(busy_pids) and all(procs[p]["state"] == "T" for p in busy_pids)
        sessions.append({"kind": "session", "id": name, "name": name, "detail": s["cwd"].replace(str(HOME), "~"),
                         "program": main["comm"] if main else "shell", "rss": rss, "cpu": cpu_of("s:" + name, ticks, now),
                         "growth": trend("s:" + name, rss, now), "paused": paused, "processes": len(pids)})

    # Chat agents: agentd runs each in its own scope (agentd-<thread>-<n>.scope).
    chats = []
    scopes = [l.split()[0] for l in sh("systemctl", "--user", "list-units", "--type=scope", "--state=running",
                                       "--no-legend", "--plain").splitlines() if l.strip().startswith("agentd-")]
    titles = {}
    if scopes:
        try:
            import urllib.request
            with urllib.request.urlopen("http://127.0.0.1:8090/threads", timeout=2) as r:
                titles = {t["id"]: t for t in json.loads(r.read())}
        except Exception:
            pass
    for unit, p in unit_props(scopes).items():
        mem = num(p.get("MemoryCurrent")) or 0
        tid = unit.split("-")[1]
        t = titles.get(tid, {})
        mine = [pid for pid, pr in procs.items() if pr["unit"] == unit]
        claimed.update(mine)
        main = max((procs[x] for x in mine if procs[x]["comm"] not in ("bash", "sh", "systemd-run")), key=lambda x: x["rss"], default=None)
        chats.append({"kind": "chat", "id": unit, "name": t.get("title") or f"Chat {tid}", "thread": tid,
                      "detail": " · ".join(x for x in (t.get("agent"), main["comm"] if main else None, f"{len(mine)} processes") if x),
                      "rss": mem, "cpu": cpu_of("u:" + unit, (num(p.get("CPUUsageNSec")) or 0) / 1e9 * CLK, now),
                      "growth": trend("u:" + unit, mem, now), "paused": p.get("FreezerState") == "frozen", "processes": len(mine)})

    # Services: systemd user units (Views and Springroll).
    names = [l.split()[0] for l in sh("systemctl", "--user", "list-units", "--type=service", "--state=running",
                                      "--no-legend", "--plain").splitlines() if l.strip()]
    props = unit_props(names)
    owners = view_units()
    services = []
    for unit, p in props.items():
        mem = num(p.get("MemoryCurrent")) or 0
        claimed.update(pid for pid, pr in procs.items() if pr["unit"] == unit)
        services.append({"kind": "service", "id": unit, "name": unit.removesuffix(".service"),
                         "view": owners.get(unit, "desk" if unit.startswith("desk") else None),
                         "detail": p.get("Description", ""), "rss": mem,
                         "cpu": cpu_of("u:" + unit, (num(p.get("CPUUsageNSec")) or 0) / 1e9 * CLK, now),
                         "growth": trend("u:" + unit, mem, now), "paused": p.get("FreezerState") == "frozen",
                         "limit": num(p.get("MemoryMax")), "core": unit in CORE_UNITS})

    # Everything else: the biggest remaining processes.
    others = []
    for pid, p in sorted(procs.items(), key=lambda kv: -kv[1]["rss"]):
        if pid in claimed or p["rss"] < 20 * 1024 * 1024:
            continue
        cmd = read(f"/proc/{pid}/cmdline").replace("\0", " ").strip().replace(str(HOME), "~")
        where = "started from a terminal" if p["unit"].startswith("tmux-spawn") else p["unit"].removesuffix(".service")
        others.append({"kind": "process", "id": str(pid), "name": p["comm"],
                       "detail": " · ".join(x for x in (cmd[:90], where, f"pid {pid}", "" if p["uid"] == UID else "system") if x),
                       "rss": p["rss"], "cpu": cpu_of(f"p:{pid}", p["ticks"], now), "growth": trend(f"p:{pid}", p["rss"], now),
                       "paused": p["state"] == "T", "mine": p["uid"] == UID})
        if len(others) >= 12:
            break

    key = lambda g: -g["rss"]
    return {"sessions": sorted(sessions, key=key), "chats": sorted(chats, key=key), "services": sorted(services, key=key), "other": others}


# ---------- History ----------

def db():
    c = sqlite3.connect(DATA / "metrics.db")
    c.execute("create table if not exists samples (ts integer primary key, mem real, cpu real, swap integer, disk real, psi real)")
    return c


def record(now):
    n = state["now"]
    with db() as c:
        c.execute("insert or replace into samples values (?,?,?,?,?,?)",
                  (int(now), n["mem"]["percent"], n["cpu"], n["swap"]["used"], n["disk"]["percent"],
                   (n["pressure"] or {}).get("avg60", 0)))
        c.execute("delete from samples where ts < ?", (int(now) - 7 * 86400,))


def history(hours):
    with db() as c:
        rows = c.execute("select ts, mem, cpu, psi from samples where ts > ? order by ts", (int(time.time() - hours * 3600),)).fetchall()
    return [{"ts": r[0], "mem": r[1], "cpu": r[2], "psi": r[3]} for r in rows]


# ---------- Watchdog ----------

def notify(text):
    subprocess.Popen(["bash", "-c", 'notify "$0"', text], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def top_lines():
    g = state["groups"] or {}
    rows = [x for k in ("sessions", "chats", "services", "other") for x in g.get(k, [])]
    rows.sort(key=lambda x: -x["rss"])
    return "\n".join(f"- {x['kind']} {x['name']}: {x['rss'] / 2**20:.0f} MB, CPU {x['cpu']}%, growing "
                     f"{x['growth'] / 2**20:+.0f} MB/min, {x.get('detail', '')}" for x in rows[:12])


def run_agent(reason):
    cfg = watch_config()
    try:
        agent = next(a for a in json.loads(read(AGENTS, "[]")) if a["id"] == cfg["agent"])
    except StopIteration:
        return
    stamp = time.strftime("%Y-%m-%d-%H%M%S")
    out = INCIDENTS / f"{stamp}.md"
    n = state["now"]
    prompt = f"""The System View's watchdog on this machine fired: {reason}.

Memory {n['mem']['percent']}% used ({n['mem']['used'] / 2**30:.1f} of {n['mem']['total'] / 2**30:.1f} GB), swap {n['swap']['used'] / 2**20:.0f} MB, disk {n['disk']['percent']}%, CPU {n['cpu']}%.

Biggest users right now:
{top_lines()}

Diagnose what is happening and act, following the "Machine health" section of ~/home/AGENTS.md:
you may pause, restart or stop things you (an agent) started, Views' services, and caches you can rebuild;
do NOT stop or pause the owner's interactive agent sessions or Springroll (desk, desk-term, system) — recommend instead.
The System View's API (curl localhost:{PORT}/api/act) can pause/resume/stop/restart. Finish with a short report:
what was wrong, what you did, and what you recommend the owner do. Keep it under 200 words."""
    # Same environment as the owner's sessions (tokens, PATH) via the agentos env file.
    argv = ["bash", "-c", f'. "{HOME}/.config/agentos/env"; exec "$@"', "agent"] + \
        [prompt if a == "{prompt}" else a for a in agent["headlessArgv"]]
    watch_state["running"] = {"started": time.time(), "file": out.name, "reason": reason}
    out.write_text(f"# {reason}\n\n_{time.strftime('%Y-%m-%d %H:%M')}, handled by {agent['name']}_\n\n")

    def go():
        try:
            r = subprocess.run(argv, capture_output=True, text=True, timeout=900, env=ENV, cwd=str(HOME / "home"))
            body = r.stdout.strip() or r.stderr.strip() or "(no output)"
        except Exception as e:
            body = f"The agent could not run: {e}"
        with out.open("a") as f:
            f.write(body + "\n")
        watch_state["running"] = None
        notify(f"Watchdog: {body.splitlines()[0][:140] if body else reason}")

    threading.Thread(target=go, daemon=True).start()


def watchdog(now):
    cfg = watch_config()
    n = state["now"]
    fired = []
    for key, value, limit, label in (("memory_since", n["mem"]["percent"], cfg["memoryWarnPercent"], "memory"),
                                     ("disk_since", n["disk"]["percent"], cfg["diskWarnPercent"], "disk")):
        if value >= limit:
            watch_state[key] = watch_state[key] or now
            held = now - watch_state[key]
            if label == "disk" or held >= cfg["memoryForSeconds"]:
                fired.append(f"{label} at {value:.0f}% (limit {limit}%)" + (f" for {held / 60:.0f}+ min" if label == "memory" else ""))
        else:
            watch_state[key] = None
    if not fired or watch_state["running"]:
        return
    if now - watch_state["last_agent_run"] < cfg["cooldownMinutes"] * 60:
        return
    watch_state["last_agent_run"] = now
    reason = "; ".join(fired)
    notify(f"System: {reason}" + (". An agent is looking into it." if cfg["agentEnabled"] else "."))
    if cfg["agentEnabled"]:
        run_agent(reason)
    else:
        (INCIDENTS / f"{time.strftime('%Y-%m-%d-%H%M%S')}.md").write_text(f"# {reason}\n\nNo agent (disabled).\n\n{top_lines()}\n")


def sampler():
    last_record = 0
    while True:
        now = time.time()
        try:
            m, g = machine(), groups(now)
            with lock:
                state["now"], state["groups"] = m, g
            if now - last_record >= 60:
                record(now)
                last_record = now
            watchdog(now)
        except Exception as e:
            print("sample failed:", e, flush=True)
        time.sleep(SAMPLE_SECONDS)


# ---------- Actions ----------

def act(kind, ident, action):
    if kind == "service":
        if ident in CORE_UNITS and action in ("pause", "stop"):
            return "Springroll's own services can only be restarted."
        verb = {"pause": "freeze", "resume": "thaw", "stop": "stop", "restart": "restart"}.get(action)
        if not verb:
            return "unknown action"
        r = subprocess.run(["systemctl", "--user", verb, ident], capture_output=True, text=True, env=ENV)
        return r.stderr.strip() or None
    if kind == "chat":
        verb = {"pause": "freeze", "resume": "thaw", "stop": "stop"}.get(action)
        if not verb:
            return "chat agents can be paused, resumed or stopped (they resume on the next message)"
        r = subprocess.run(["systemctl", "--user", verb, ident], capture_output=True, text=True, env=ENV)
        return r.stderr.strip() or None
    if kind == "session":
        if action == "stop":
            subprocess.run(["tmux", "kill-session", "-t", f"={ident}"], env=ENV)
            return None
        sig = {"pause": signal.SIGSTOP, "resume": signal.SIGCONT}.get(action)
        if not sig:
            return "sessions can be paused, resumed or stopped"
        procs = processes()
        children = {}
        for pid, p in procs.items():
            children.setdefault(p["ppid"], []).append(pid)
        for line in sh("tmux", "list-panes", "-t", f"={ident}", "-F", "#{pane_pid}").split():
            for pid in tree(int(line), procs, children)[1:]:  # leave the pane's shell alone
                try:
                    os.kill(pid, sig)
                except OSError:
                    pass
        return None
    if kind == "process":
        pid = int(ident)
        sig = {"pause": signal.SIGSTOP, "resume": signal.SIGCONT, "stop": signal.SIGTERM}.get(action)
        if not sig:
            return "processes can be paused, resumed or stopped"
        try:
            os.kill(pid, sig)
        except PermissionError:
            r = subprocess.run(["sudo", "-n", "kill", f"-{sig.name.removeprefix('SIG')}", str(pid)], capture_output=True, text=True)
            return r.stderr.strip() or None
        except OSError as e:
            return str(e)
        return None
    return "unknown kind"


# ---------- HTTP ----------

def status():
    n = state["now"]
    if not n:
        return {"text": "…", "level": "", "title": "Starting"}
    cfg = watch_config()
    p = n["mem"]["percent"]
    level = "danger" if p >= cfg["memoryWarnPercent"] else "warn" if p >= cfg["memoryWarnPercent"] - 15 else "ok"
    if n["disk"]["percent"] >= cfg["diskWarnPercent"]:
        level = "danger"
    return {"text": f"{p:.0f}%", "icon": "memory-stick", "level": level,
            "title": f"Memory {n['mem']['used'] / 2**30:.1f} of {n['mem']['total'] / 2**30:.1f} GB · CPU {n['cpu']:.0f}% · disk {n['disk']['percent']:.0f}%"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("cache-control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        q = dict(x.split("=", 1) for x in self.path.partition("?")[2].split("&") if "=" in x)
        with lock:
            snap = {"now": state["now"], "groups": state["groups"]}
        if path in ("/", "/index.html"):
            return self.send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
        if path == "/api/now":
            return self.send(200, snap)
        if path == "/api/status":
            return self.send(200, status())
        if path == "/api/history":
            return self.send(200, history(min(168, float(q.get("hours", 24)))))
        if path == "/api/watch":
            files = sorted(INCIDENTS.glob("*.md"), reverse=True)[:20]
            return self.send(200, {"config": watch_config(), "running": watch_state["running"],
                                   "incidents": [{"file": f.name, "text": f.read_text()} for f in files]})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0) or 0)) or b"{}")
        path = self.path.split("?")[0]
        if path == "/api/act":
            err = act(body.get("kind"), str(body.get("id")), body.get("action"))
            return self.send(400 if err else 200, {"error": err} if err else {"ok": True})
        if path == "/api/watch":
            cfg = watch_config()
            for k in ("memoryWarnPercent", "memoryForSeconds", "diskWarnPercent", "agent", "agentEnabled", "cooldownMinutes"):
                if k in body:
                    cfg[k] = body[k]
            (HERE / "watch.json").write_text(json.dumps(cfg, indent=2) + "\n")
            return self.send(200, cfg)
        if path == "/api/test-watchdog":
            if watch_state["running"]:
                return self.send(409, {"error": "already running"})
            watch_state["last_agent_run"] = time.time()
            run_agent("a test run requested from the System View")
            return self.send(200, {"ok": True})
        self.send(404, {"error": "not found"})


if __name__ == "__main__":
    threading.Thread(target=sampler, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
