#!/usr/bin/env python3
"""Read-only Gmail IMAP -> SQLite sync, every account in Connections → Gmail. Never writes to a mailbox."""
import checks, email, email.policy, email.utils, imaplib, json, os, re, sqlite3, ssl, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

GOOGLE = os.path.expanduser("~/.config/springroll/google.json")  # accounts (app passwords / Google sign-ins)
LEGACY = os.path.expanduser("~/.config/springroll/gmail")         # the old single account: address, app password
DB = os.environ.get("MAIL_DB") or os.path.expanduser("~/data/mail/mail.db")
DAYS = int(os.environ.get("MAIL_DAYS", "30"))
MAX_INLINE = 1_000_000
DROPPED_NEEDS = []  # messages that left the inbox while on Home's "Needs you"

# Schema 2: several accounts. msgs.id is Mail's own id (the API calls it uid); (account, uid) is Gmail's.
# AUTOINCREMENT: an id is never given to another message. Triage, corrections and Home's "Needs you"
# items point at ids; a reused id made a new message inherit an archived one's triage.
MSGS = """CREATE TABLE IF NOT EXISTS msgs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, uid INTEGER NOT NULL, msgid TEXT, from_name TEXT, from_addr TEXT,
  to_addrs TEXT, subject TEXT, snippet TEXT, date INTEGER, seen INTEGER, text TEXT, html TEXT, attachments TEXT,
  warnings TEXT, UNIQUE(account, uid));"""
SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
""" + MSGS + """
CREATE INDEX IF NOT EXISTS msgs_date ON msgs(date DESC);
CREATE INDEX IF NOT EXISTS msgs_account ON msgs(account, date DESC);
CREATE TABLE IF NOT EXISTS inline(msg INTEGER, cid TEXT, ctype TEXT, data BLOB, PRIMARY KEY(msg,cid));
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(subject, from_name, from_addr, text, content='', tokenize='unicode61 remove_diacritics 2');
"""

def db():
    c = sqlite3.connect(DB, timeout=30)
    c.execute("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)")
    if getmeta(c, "schema") != "2":
        # The local copy is a cache of Gmail: rebuild it rather than migrate (the next sync refills it).
        for t in ("msgs", "inline", "fts"): c.execute(f"DROP TABLE IF EXISTS {t}")
        c.execute("DELETE FROM meta")
    else:
        never_reuse_ids(c)
        add_warnings(c)
    c.executescript(SCHEMA)
    setmeta(c, "schema", "2"); c.commit()
    return c

def has_table(c, name):
    return bool(c.execute("SELECT 1 FROM sqlite_master WHERE name=?", (name,)).fetchone())

def never_reuse_ids(c):
    """Once: rebuild msgs with AUTOINCREMENT (keeping every id), undo triage a new message inherited
    from an archived one that had its id, and rebuild the search index (it had the same problem)."""
    sql = (c.execute("SELECT sql FROM sqlite_master WHERE name='msgs'").fetchone() or [""])[0]
    if not sql or "AUTOINCREMENT" in sql.upper(): return
    c.execute("ALTER TABLE msgs RENAME TO msgs_old")
    c.execute("DROP INDEX IF EXISTS msgs_date"); c.execute("DROP INDEX IF EXISTS msgs_account")
    c.execute(MSGS)
    cols = "id,account,uid,msgid,from_name,from_addr,to_addrs,subject,snippet,date,seen,text,html,attachments"
    c.execute(f"INSERT INTO msgs({cols}) SELECT {cols} FROM msgs_old")
    c.execute("DROP TABLE msgs_old")
    high = [c.execute("SELECT max(id) FROM msgs").fetchone()[0] or 0]
    stale = []
    if has_table(c, "triage"):
        high.append(c.execute("SELECT max(msg) FROM triage").fetchone()[0] or 0)
        # Decided before the message arrived (or its message is gone): it was about another message.
        stale = c.execute("SELECT t.msg, t.category FROM triage t LEFT JOIN msgs m ON m.id=t.msg "
                          "WHERE m.id IS NULL OR t.at < m.date - 300").fetchall()
        c.executemany("DELETE FROM triage WHERE msg=?", [(m,) for m, _ in stale])
    if has_table(c, "corrections"):
        high.append(c.execute("SELECT max(msg) FROM corrections").fetchone()[0] or 0)
    c.execute("DELETE FROM sqlite_sequence WHERE name='msgs'")
    c.execute("INSERT INTO sqlite_sequence(name, seq) VALUES('msgs', ?)", (max(high),))
    if has_table(c, "fts"):
        c.execute("INSERT INTO fts(fts) VALUES('delete-all')")
        c.execute("INSERT INTO fts(rowid,subject,from_name,from_addr,text) SELECT id,subject,from_name,from_addr,substr(text,1,200000) FROM msgs")
    c.commit()
    clear_needs([m for m, cat in stale if cat == "needs_you"])
    print(f"ids are never reused now; {len(stale)} inherited triage decisions undone (sorted again next run)")

def add_warnings(c):
    """Once: the warnings column (checks.py), filled in for mail already here from what we kept
    (the HTML and sender; the arrival headers weren't kept, so no sender-authentication result)."""
    if not has_table(c, "msgs") or any(r[1] == "warnings" for r in c.execute("PRAGMA table_info(msgs)")): return
    c.execute("ALTER TABLE msgs ADD COLUMN warnings TEXT")
    n = 0
    for mid, html, text, name, addr, subj in c.execute("SELECT id,html,text,from_name,from_addr,subject FROM msgs").fetchall():
        _, warn = checks.check(text, html, name, addr, subject=subj or "")
        if warn:
            c.execute("UPDATE msgs SET warnings=? WHERE id=?", (json.dumps(warn), mid)); n += 1
    c.commit()
    print(f"phishing checks: {n} messages already here have warnings")

def clear_needs(ids):
    """Take messages' "Needs you" items off Home (the triage job posts them as mail:<id>)."""
    for mid in ids:
        try:
            req = urllib.request.Request("http://127.0.0.1:8090/signals/clear", json.dumps({"key": f"mail:{mid}"}).encode(), {"content-type": "application/json"})
            urllib.request.urlopen(req, timeout=5).read()
        except Exception:
            pass

def accounts():
    """The accounts to read, and the Google sign-in client (for accounts signed in that way)."""
    try:
        d = json.load(open(GOOGLE))
        return d.get("accounts", []), d.get("client")
    except Exception:
        pass
    try:
        user, pw = [l.strip() for l in open(LEGACY).read().splitlines()[:2]]
        return [{"email": user, "method": "app-password", "password": pw}], None
    except Exception:
        return [], None

def connect(a, client):
    M = imaplib.IMAP4_SSL("imap.gmail.com", timeout=60, ssl_context=ssl.create_default_context())
    if a.get("method") == "google":
        body = urllib.parse.urlencode({"client_id": client["id"], "client_secret": client["secret"],
                                       "refresh_token": a["refresh_token"], "grant_type": "refresh_token"}).encode()
        tok = json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token", body, timeout=20))["access_token"]
        M.authenticate("XOAUTH2", lambda _: f"user={a['email']}\x01auth=Bearer {tok}\x01\x01".encode())
    else:
        M.login(a["email"], a["password"].replace(" ", ""))
    return M

def getmeta(c, k, d=None):
    r = c.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return r[0] if r else d

def setmeta(c, k, v):
    c.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (k, str(v)))

def make_snippet(body):
    b = re.sub(r"(?s)<[^>]*>?", " ", body)
    b = re.sub(r"https?://\S+|\[image:[^\]]*\]|[\u200b-\u200f\u2060\u00ad\u034f\ufeff\u00a0]", " ", b)
    return re.sub(r"\s+", " ", b).strip()[:200]

def parse(account, uid, raw, flags):
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
    # What a person sees, never what's hidden in the HTML; warnings for the triage job (checks.py)
    body, warn = checks.check(text, html, name, addr, hdr("Reply-To"), checks.auth_results(m), hdr("Subject"))
    snippet = make_snippet(body)
    return dict(account=account, uid=uid, msgid=hdr("Message-ID"), from_name=name or addr, from_addr=addr,
                to_addrs=hdr("To")[:500], subject=hdr("Subject") or "(no subject)",
                snippet=snippet, date=ts, seen=int(b"\\Seen" in flags), text=body,
                html=html, attachments="\n".join(atts), warnings=json.dumps(warn) if warn else None), inline

def save(c, d, inline):
    if c.execute("SELECT 1 FROM msgs WHERE account=? AND uid=?", (d["account"], d["uid"])).fetchone():
        return
    cur = c.execute("INSERT INTO msgs(account,uid,msgid,from_name,from_addr,to_addrs,subject,snippet,date,seen,text,html,attachments,warnings) "
                    "VALUES(:account,:uid,:msgid,:from_name,:from_addr,:to_addrs,:subject,:snippet,:date,:seen,:text,:html,:attachments,:warnings)", d)
    mid = cur.lastrowid
    c.execute("INSERT INTO fts(rowid,subject,from_name,from_addr,text) VALUES(?,?,?,?,?)",
              (mid, d["subject"], d["from_name"], d["from_addr"], d["text"][:200000]))
    for cid, ct, data in inline:
        c.execute("INSERT OR REPLACE INTO inline VALUES(?,?,?,?)", (mid, cid, ct, data))

def drop(c, account, uid):
    """A message gone from the inbox (archived, moved, deleted): it goes, with its search entry, its
    triage, and its "Needs you" item on Home (handled in Gmail is handled)."""
    r = c.execute("SELECT id,subject,from_name,from_addr,text FROM msgs WHERE account=? AND uid=?", (account, uid)).fetchone()
    if not r: return
    mid = r[0]
    c.execute("INSERT INTO fts(fts,rowid,subject,from_name,from_addr,text) VALUES('delete',?,?,?,?,?)", (mid, r[1], r[2], r[3], (r[4] or "")[:200000]))
    c.execute("DELETE FROM msgs WHERE id=?", (mid,)); c.execute("DELETE FROM inline WHERE msg=?", (mid,))
    if has_table(c, "triage"):
        t = c.execute("SELECT category FROM triage WHERE msg=?", (mid,)).fetchone()
        c.execute("DELETE FROM triage WHERE msg=?", (mid,))
        if t and t[0] == "needs_you": DROPPED_NEEDS.append(mid)

def sync_account(c, a, client):
    acct = a["email"]
    M = connect(a, client)
    try:
        typ, _ = M.select("INBOX", readonly=True)   # EXAMINE: cannot change anything
        if typ != "OK": raise RuntimeError("cannot select INBOX")
        uv = M.response("UIDVALIDITY")[1][0].decode()
        if getmeta(c, f"uidvalidity:{acct}") not in (None, uv):
            for (u,) in c.execute("SELECT uid FROM msgs WHERE account=?", (acct,)).fetchall(): drop(c, acct, u)
        setmeta(c, f"uidvalidity:{acct}", uv)
        since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).strftime("%d-%b-%Y")
        typ, data = M.uid("SEARCH", None, "SINCE", since)
        uids = [int(x) for x in data[0].split()]
        have = {r[0] for r in c.execute("SELECT uid FROM msgs WHERE account=?", (acct,))}
        new = [u for u in uids if u not in have]
        print(f"{acct}: {len(uids)} in window, {len(new)} new")
        for i in range(0, len(new), 20):
            batch = new[i:i+20]
            typ, resp = M.uid("FETCH", ",".join(map(str, batch)), "(FLAGS BODY.PEEK[])")
            for item in resp:
                if not isinstance(item, tuple): continue
                m = re.search(rb"UID (\d+)", item[0])
                if not m: continue
                d, inl = parse(acct, int(m.group(1)), item[1], item[0])
                save(c, d, inl)
            c.commit()
        # refresh read flags and drop messages gone from the inbox window
        if uids:
            typ, resp = M.uid("FETCH", f"{min(uids)}:{max(uids)}", "(FLAGS)")
            for item in resp:
                if not isinstance(item, bytes): continue
                m = re.search(rb"UID (\d+)", item)
                if m: c.execute("UPDATE msgs SET seen=? WHERE account=? AND uid=?", (int(b"\\Seen" in item), acct, int(m.group(1))))
        cutoff = int(time.time()) - DAYS * 86400
        live = set(uids)
        for (u, dt) in c.execute("SELECT uid,date FROM msgs WHERE account=?", (acct,)).fetchall():
            if u not in live and dt >= cutoff - 86400 * 2:
                drop(c, acct, u)
        c.commit()
    finally:
        try: M.logout()
        except Exception: pass

def main():
    accts, client = accounts()
    c = db()
    # Accounts removed from Connections: their mail goes too.
    names = [a["email"] for a in accts]
    for (acct,) in c.execute("SELECT DISTINCT account FROM msgs").fetchall():
        if acct not in names:
            for (u,) in c.execute("SELECT uid FROM msgs WHERE account=?", (acct,)).fetchall(): drop(c, acct, u)
    c.commit()
    if not accts:
        print("no accounts yet (Connections → Gmail)"); return 0
    failed = 0
    for a in accts:
        try:
            sync_account(c, a, client)
            c.execute("DELETE FROM meta WHERE k=?", (f"error:{a['email']}",))
        except Exception as e:  # one account failing doesn't stop the others
            failed += 1
            print(f"{a['email']}: {e}", file=sys.stderr)
            setmeta(c, f"error:{a['email']}", str(e)[:300])
        c.commit()
    setmeta(c, "last_sync", int(time.time()))
    c.commit()
    clear_needs(DROPPED_NEEDS)
    return 1 if failed == len(accts) else 0

if __name__ == "__main__":
    sys.exit(main())
