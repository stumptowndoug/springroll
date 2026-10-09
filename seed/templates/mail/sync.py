#!/usr/bin/env python3
"""Read-only Gmail IMAP -> SQLite sync. Never writes to the mailbox."""
import email, email.policy, email.utils, imaplib, os, re, sqlite3, sys, time
from datetime import datetime, timedelta, timezone

CRED = os.path.expanduser("~/.config/springroll/gmail")
DB = os.environ.get("MAIL_DB") or os.path.expanduser("~/data/mail/mail.db")
DAYS = int(os.environ.get("MAIL_DAYS", "30"))
MAX_INLINE = 1_000_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS msgs(
  uid INTEGER PRIMARY KEY, msgid TEXT, from_name TEXT, from_addr TEXT, to_addrs TEXT,
  subject TEXT, snippet TEXT, date INTEGER, seen INTEGER, text TEXT, html TEXT,
  attachments TEXT);
CREATE INDEX IF NOT EXISTS msgs_date ON msgs(date DESC);
CREATE TABLE IF NOT EXISTS inline(uid INTEGER, cid TEXT, ctype TEXT, data BLOB, PRIMARY KEY(uid,cid));
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(subject, from_name, from_addr, text, content='', tokenize='unicode61 remove_diacritics 2');
"""

def db():
    c = sqlite3.connect(DB, timeout=30)
    c.executescript(SCHEMA)
    return c

def getmeta(c, k, d=None):
    r = c.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return r[0] if r else d

def setmeta(c, k, v):
    c.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (k, str(v)))

def html_to_text(h):
    h = re.sub(r"(?is)<(script|style|head).*?</\1>", " ", h)
    h = re.sub(r"(?s)<[^>]+>", " ", h)
    import html
    return re.sub(r"\s+", " ", html.unescape(h)).strip()

def make_snippet(body):
    b = re.sub(r"(?s)<[^>]*>?", " ", body)
    b = re.sub(r"https?://\S+|\[image:[^\]]*\]|[\u200b-\u200f\u2060\u00ad\u034f\ufeff\u00a0]", " ", b)
    return re.sub(r"\s+", " ", b).strip()[:200]

def parse(uid, raw, flags):
    m = email.message_from_bytes(raw, policy=email.policy.default)
    def hdr(n):
        try: return str(m[n] or "")
        except Exception: return ""
    name, addr = email.utils.parseaddr(hdr("From"))
    try: ts = int(email.utils.parsedate_to_datetime(hdr("Date")).timestamp())
    except Exception: ts = int(time.time())
    text = html = None
    inline, atts = [], []
    for p in m.walk():
        if p.is_multipart(): continue
        ct = p.get_content_type(); disp = p.get_content_disposition()
        fn = p.get_filename()
        try:
            if ct == "text/plain" and disp != "attachment" and text is None:
                text = p.get_content()
            elif ct == "text/html" and disp != "attachment" and html is None:
                html = p.get_content()
            elif p.get("Content-ID") and ct.startswith("image/"):
                data = p.get_payload(decode=True) or b""
                if len(data) <= MAX_INLINE:
                    inline.append((p["Content-ID"].strip("<> "), ct, data))
            elif fn or disp == "attachment":
                atts.append(fn or "attachment")
        except Exception:
            pass
    body = text or (html_to_text(html) if html else "")
    snippet = make_snippet(body)
    return dict(uid=uid, msgid=hdr("Message-ID"), from_name=name or addr, from_addr=addr,
                to_addrs=hdr("To")[:500], subject=hdr("Subject") or "(no subject)",
                snippet=snippet, date=ts, seen=int(b"\\Seen" in flags), text=body,
                html=html, attachments="\n".join(atts)), inline

def save(c, d, inline):
    uid = d["uid"]
    old = c.execute("SELECT 1 FROM msgs WHERE uid=?", (uid,)).fetchone()
    if old:
        return
    c.execute("INSERT INTO msgs VALUES(:uid,:msgid,:from_name,:from_addr,:to_addrs,:subject,:snippet,:date,:seen,:text,:html,:attachments)", d)
    c.execute("INSERT INTO fts(rowid,subject,from_name,from_addr,text) VALUES(?,?,?,?,?)",
              (uid, d["subject"], d["from_name"], d["from_addr"], d["text"][:200000]))
    for cid, ct, data in inline:
        c.execute("INSERT OR REPLACE INTO inline VALUES(?,?,?,?)", (uid, cid, ct, data))

def main():
    if not os.path.exists(CRED):
        print("no credentials yet"); return 0
    user, pw = [l.strip() for l in open(CRED).read().splitlines()[:2]]
    c = db()
    M = imaplib.IMAP4_SSL("imap.gmail.com", timeout=60)
    M.login(user, pw.replace(" ", ""))
    try:
        typ, _ = M.select("INBOX", readonly=True)   # EXAMINE: cannot change anything
        if typ != "OK": raise SystemExit("cannot select INBOX")
        uv = M.response("UIDVALIDITY")[1][0].decode()
        if getmeta(c, "uidvalidity") not in (None, uv):
            for t in ("msgs", "inline"): c.execute(f"DELETE FROM {t}")
            c.execute("INSERT INTO fts(fts) VALUES('delete-all')")
            c.execute("DELETE FROM meta WHERE k='maxuid'")
        setmeta(c, "uidvalidity", uv)
        since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).strftime("%d-%b-%Y")
        typ, data = M.uid("SEARCH", None, "SINCE", since)
        uids = [int(x) for x in data[0].split()]
        have = {r[0] for r in c.execute("SELECT uid FROM msgs")}
        new = [u for u in uids if u not in have]
        print(f"{len(uids)} in window, {len(new)} new")
        for i in range(0, len(new), 20):
            batch = new[i:i+20]
            typ, resp = M.uid("FETCH", ",".join(map(str, batch)), "(FLAGS BODY.PEEK[])")
            for item in resp:
                if not isinstance(item, tuple): continue
                m = re.search(rb"UID (\d+)", item[0])
                if not m: continue
                flags = item[0]
                d, inl = parse(int(m.group(1)), item[1], flags)
                save(c, d, inl)
            c.commit()
        # refresh read flags and drop messages gone from the inbox window
        if uids:
            typ, resp = M.uid("FETCH", f"{min(uids)}:{max(uids)}", "(FLAGS)")
            for item in resp:
                if not isinstance(item, bytes): continue
                m = re.search(rb"UID (\d+)", item)
                if m: c.execute("UPDATE msgs SET seen=? WHERE uid=?", (int(b"\\Seen" in item), int(m.group(1))))
        cutoff = int(time.time()) - DAYS * 86400
        live = set(uids)
        for (u, dt) in c.execute("SELECT uid,date FROM msgs").fetchall():
            if u not in live and dt >= cutoff - 86400 * 2 and u > 0:
                c.execute("DELETE FROM msgs WHERE uid=?", (u,)); c.execute("DELETE FROM inline WHERE uid=?", (u,))
        setmeta(c, "last_sync", int(time.time()))
        c.commit()
    finally:
        try: M.logout()
        except Exception: pass
    return 0

if __name__ == "__main__":
    sys.exit(main())
