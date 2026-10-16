#!/usr/bin/env python3
"""To-dos app server: every TODO.md board (each project's, plus the owner's personal one) and a
JSON API for agents, jobs and the page. The files are the source of truth (Shep shows the same
ones), so nothing is copied into a database: each request reads them, each edit rewrites one."""
import glob, json, os, sys, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from board import Board, Changed, parse  # noqa: E402

PORT = int(os.environ.get("TODOS_PORT") or open(os.path.join(HERE, "PORT")).read())
DATA = os.path.expanduser(os.environ.get("TODOS_DATA") or "~/data/todos")
PROJECTS = os.path.expanduser(os.environ.get("TODOS_PROJECTS") or "~/projects")
INDEX = os.path.join(HERE, "index.html")
LOCK = threading.Lock()  # one edit at a time: each is read, change, write


def archive_in(root):
    """A project archives into docs/archive/TODO-done-<day>.md if it has docs/, else TODO-done.md."""
    docs = os.path.join(root, "docs")
    return (lambda day: os.path.join(docs, "archive", f"TODO-done-{day}.md")) if os.path.isdir(docs) \
        else (lambda day: os.path.join(root, "TODO-done.md"))


def boards():
    out = [Board("personal", "Personal", os.path.join(DATA, "TODO.md"), lambda day: os.path.join(DATA, "TODO-done.md"))]
    for root in sorted(glob.glob(os.path.join(PROJECTS, "*"))):
        if not os.path.isdir(root): continue
        f = next((os.path.join(root, n) for n in os.listdir(root) if n.lower() == "todo.md"), None)
        if f: out.append(Board(os.path.basename(root), os.path.basename(root), f, archive_in(root)))
    return out


def board(bid):
    b = next((b for b in boards() if b.id == bid), None)
    if not b: raise LookupError(f"No board {bid!r}")
    return b


def full(b):
    doc = parse(b.read())
    for col in doc["columns"]:
        for c in col["cards"]: c["lines"] = [c["line"] + 1, c["end"]]
    return {**b.summary(), **doc}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
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
            if method == "GET" and p == ["boards"]:
                return self.send(200, [b.summary() for b in boards()])
            if method == "GET" and p == ["now"]:
                # In-progress cards across every board: what's being worked on.
                out = []
                for b in boards():
                    for col in parse(b.read())["columns"]:
                        if col["kind"] in ("progress", "blocked"):
                            out += [dict(c, board=b.id, board_name=b.name, path=b.path, column=col["title"],
                                         lines=[c["line"] + 1, c["end"]]) for c in col["cards"]]
                return self.send(200, out)
            if len(p) >= 2 and p[0] == "boards":
                b = board(p[1])
                if method == "GET" and len(p) == 2: return self.send(200, full(b))
                if method == "POST" and p[2:] == ["cards"]:
                    d = self.body()
                    return self.send(201, b.add(d.get("text", ""), d.get("column"), d.get("notes") or ()))
                if method == "POST" and p[2:] == ["archive"]:
                    return self.send(200, b.archive())
                if len(p) == 4 and p[2] == "cards":
                    if method == "PATCH":
                        d = self.body()
                        card = None
                        if "text" in d: card = b.edit(p[3], d["text"])
                        cid = card["id"] if card else p[3]
                        if "column" in d or "done" in d: card = b.move(cid, d.get("column"), d.get("done"))
                        return self.send(200, card or {})
                    if method == "DELETE":
                        b.delete(p[3]); return self.send(200, {"ok": True})
            return self.send(404, {"error": "not found"})
        except Changed as e: return self.send(409, {"error": str(e)})
        except LookupError as e: return self.send(404, {"error": str(e)})
        except ValueError as e: return self.send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            print(f"{method} {self.path}: {e!r}", file=sys.stderr, flush=True)
            return self.send(500, {"error": str(e)})

    def do_GET(self): self.route("GET")
    def do_POST(self):
        with LOCK: self.route("POST")

    def do_PATCH(self):
        with LOCK: self.route("PATCH")

    def do_DELETE(self):
        with LOCK: self.route("DELETE")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
