#!/usr/bin/env python3
"""Mail View server: JSON API + static UI over the SQLite store. Read-only."""
import json, os, re, sqlite3, html as H
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

DB = os.environ.get("MAIL_DB") or os.path.expanduser("~/data/mail/mail.db")
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("MAIL_PORT") or open(os.path.join(HERE, "PORT")).read())
GOOGLE = os.path.expanduser("~/.config/springroll/google.json")
LEGACY = os.path.expanduser("~/.config/springroll/gmail")

def configured():
    """The account addresses from Connections → Gmail (no secrets)."""
    try: return [a["email"] for a in json.load(open(GOOGLE)).get("accounts", [])]
    except Exception: pass
    try: return [open(LEGACY).read().splitlines()[0].strip()]
    except Exception: return []

def q(sql, args=()):
    if not os.path.exists(DB): return []
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
    c.row_factory = sqlite3.Row
    try: return c.execute(sql, args).fetchall()
    finally: c.close()

def fts_query(s):
    toks = re.findall(r"\w+", s)
    return " ".join(f'"{t}"*' for t in toks)

class H_(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)): body = json.dumps(body)
        if isinstance(body, str): body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path); qs = parse_qs(u.query); p = u.path
        if p in ("/", "/index.html"):
            return self.send(200, open(os.path.join(HERE, "index.html"), "rb").read(), "text/html; charset=utf-8", {"Cache-Control": "no-cache"})
        if p == "/api/list":
            term = qs.get("q", [""])[0].strip()
            before = int(qs.get("before", ["0"])[0] or 0)
            account = qs.get("account", [""])[0]
            cols = "id AS uid,account,from_name,from_addr,subject,snippet,date,seen,attachments!=''  AS att"
            args = []; where = []
            if term:
                fq = fts_query(term)
                if not fq: return self.send(200, {"items": []})
                where.append("id IN (SELECT rowid FROM fts WHERE fts MATCH ?)"); args.append(fq)
            if account: where.append("account=?"); args.append(account)
            if before: where.append("date<?"); args.append(before)
            sql = f"SELECT {cols} FROM msgs {'WHERE '+' AND '.join(where) if where else ''} ORDER BY date DESC LIMIT 60"
            try: rows = q(sql, args)
            except sqlite3.Error: rows = []
            return self.send(200, {"items": [dict(r) for r in rows]})
        if p == "/api/status":
            m = {r["k"]: r["v"] for r in q("SELECT k,v FROM meta")}
            n = q("SELECT count(*) c, sum(seen=0) u FROM msgs")
            per = {r["account"]: r for r in q("SELECT account, count(*) c, sum(seen=0) u FROM msgs GROUP BY account")}
            accts = [{"email": e, "count": per[e]["c"] if e in per else 0, "unread": (per[e]["u"] or 0) if e in per else 0,
                      "error": m.get(f"error:{e}")} for e in configured()]
            return self.send(200, {"configured": bool(accts), "accounts": accts, "last_sync": int(m.get("last_sync", 0)),
                                   "count": n[0]["c"] if n else 0, "unread": (n[0]["u"] or 0) if n else 0})
        m = re.fullmatch(r"/api/msg/(\d+)", p)
        if m:
            r = q("SELECT id AS uid,account,from_name,from_addr,to_addrs,subject,date,seen,text,html!='' AND html IS NOT NULL AS has_html,attachments FROM msgs WHERE id=?", (int(m.group(1)),))
            if not r: return self.send(404, {"error": "not found"})
            d = dict(r[0]); d["attachments"] = [a for a in d["attachments"].split("\n") if a]
            return self.send(200, d)
        m = re.fullmatch(r"/frame/(\d+)", p)
        if m:
            uid = int(m.group(1)); images = qs.get("images", ["0"])[0] == "1"
            r = q("SELECT html,text FROM msgs WHERE id=?", (uid,))
            if not r: return self.send(404, "not found", "text/plain")
            body = r[0]["html"]; extra_bg = ""
            if not body:
                fg = qs.get("fg", [""])[0]
                bg = qs.get("bg", [""])[0]
                col = f"#{fg}" if re.fullmatch(r"[0-9a-fA-F]{6}", fg) else "inherit"
                if re.fullmatch(r"[0-9a-fA-F]{6}", bg): extra_bg = f"<style>html{{background:#{bg}}}</style>"
                body = f"<pre style='white-space:pre-wrap;font:inherit;color:{col}'>" + H.escape(r[0]["text"] or "") + "</pre>"
            # inline cid images are local data, always safe
            body = re.sub(r"(?i)cid:([^\"'\s)>]+)", lambda mm: f"inline/{uid}/{mm.group(1)}", body)
            body = re.sub(r"(?i)<meta[^>]+http-equiv[^>]*>", "", body)
            img = "img-src 'self' data:" + (" https: http:" if images else "")
            csp = f"default-src 'none'; {img}; style-src 'unsafe-inline'; font-src data:" + (" https:" if images else "")
            head = ('<base target="_blank"><meta name="viewport" content="width=device-width,initial-scale=1">'
                    '<style>:root{color-scheme:light}body{margin:12px;font:15px/1.5 system-ui,sans-serif;word-wrap:break-word}img{max-width:100%;height:auto}</style>')
            if r[0]["html"]:
                head += "<style>html{background:#fff}</style>"  # HTML mail is designed for white paper
            if qs.get("dark", ["0"])[0] == "1" and r[0]["html"]:
                bg = qs.get("bg", [""])[0]
                inv = "".join(f"{255-int(bg[i:i+2],16):02x}" for i in (0, 2, 4)) if re.fullmatch(r"[0-9a-fA-F]{6}", bg) else "ffffff"
                # dark mode: invert the whole page, then re-invert media so photos look normal
                extra_bg = (f"<style>html{{background:#{inv};filter:invert(1) hue-rotate(180deg)}}"
                            "img,video,picture,svg image{filter:invert(1) hue-rotate(180deg)}"
                            "[style*=background-image]{filter:invert(1) hue-rotate(180deg)}</style>")
            return self.send(200, head + extra_bg + body, "text/html; charset=utf-8", {"Content-Security-Policy": csp, "Referrer-Policy": "no-referrer"})
        m = re.fullmatch(r"/frame/inline/(\d+)/(.+)", p)
        if m:
            r = q("SELECT ctype,data FROM inline WHERE msg=? AND cid=?", (int(m.group(1)), m.group(2)))
            if not r: return self.send(404, "", "text/plain")
            ct = r[0]["ctype"]
            if ct == "image/svg+xml": return self.send(404, "", "text/plain")
            return self.send(200, r[0]["data"], ct, {"Cache-Control": "max-age=86400"})
        self.send(404, {"error": "not found"})

ThreadingHTTPServer(("127.0.0.1", PORT), H_).serve_forever()
