#!/usr/bin/env python3
"""Dev app server: the page, and a JSON API over devlib (the same code the `dev` command uses)."""
import json, os, sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import devlib  # noqa: E402

PORT = int(os.environ.get("DEV_PORT") or open(os.path.join(HERE, "PORT")).read())
INDEX = os.path.join(HERE, "index.html")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body=None, ctype="application/json"):
        data = b"" if body is None else body if isinstance(body, bytes) else json.dumps(body, default=list).encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def route(self, method):
        u = urlparse(self.path)
        parts = [unquote(p) for p in u.path.strip("/").split("/") if p]
        q = {k: v[-1] for k, v in parse_qs(u.query).items()}
        try:
            if method == "GET" and parts in ([], ["index.html"]):
                return self.send(200, open(INDEX, "rb").read(), "text/html; charset=utf-8")
            if parts[:1] != ["api"]: return self.send(404, {"error": "not found"})
            p = parts[1:]
            if method == "GET" and p == ["projects"]: return self.send(200, devlib.all_status())
            if method == "GET" and p == ["ports"]: return self.send(200, devlib.ports())
            if method == "GET" and p == ["logs"]: return self.send(200, {"text": devlib.logs(q.get("unit", ""), q.get("n", 300), q.get("since"))})
            if method == "GET" and p == ["status"]:
                # The sidebar chip: only while something runs (no body hides it).
                n = sum(1 for x in devlib.all_status() for s in x.get("servers", []) if s["state"] == "active")
                if not n: return self.send(204)
                return self.send(200, {"text": f"{n} running", "level": "ok", "icon": "square-terminal",
                                       "title": "Dev servers running"})
            if len(p) >= 2 and p[0] == "projects":
                name = p[1]
                if name not in devlib.project_names(): return self.send(404, {"error": f"no project {name!r}"})
                if method == "GET" and len(p) == 2: return self.send(200, devlib.status(name))
                b = self.body() if method == "POST" else {}
                act = p[2] if len(p) > 2 else None
                if method == "POST" and act == "up": return self.send(200, devlib.up(name, b.get("servers")))
                if method == "POST" and act == "down": return self.send(200, devlib.down(name, b.get("servers")))
                if method == "POST" and act == "restart":
                    devlib.down(name, b.get("servers"))
                    return self.send(200, devlib.up(name, b.get("servers")))
                if method == "POST" and act == "run": return self.send(200, devlib.start_command(name, b["command"]))
                if method == "POST" and act == "stop": return self.send(200, devlib.stop_command(name, b["command"]))
                if method == "GET" and act == "keys": return self.send(200, devlib.keys(name))
                if method == "POST" and act == "keys": return self.send(200, devlib.add_key(name, b.get("var"), b.get("secret"), b.get("note")))
                if method == "POST" and act == "env" and p[3:] == ["preview"]:
                    return self.send(200, {"rows": devlib.env_plan(name, b.get("text", "")), "prefix": devlib.key_prefix(name, devlib.need(name))})
                if method == "POST" and act == "env" and p[3:] == ["import"]:
                    return self.send(200, devlib.import_env(name, b.get("text", ""), b.get("choices") or {}))
                if act == "database":
                    if method == "GET": return self.send(200, devlib.db_status(name, fresh=True))
                    do = {"create": devlib.db_ensure, "reset": devlib.db_reset, "delete": devlib.db_drop}.get(b.get("action"))
                    if not do: return self.send(400, {"error": "action is create, reset or delete"})
                    return self.send(200, do(name))
            return self.send(404, {"error": "not found"})
        except LookupError as e:
            return self.send(404, {"error": str(e).strip("'\"")})
        except (RuntimeError, KeyError, ValueError) as e:
            return self.send(400, {"error": str(e)})

    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
