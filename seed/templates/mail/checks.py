"""Phishing and prompt-injection checks for one message: the text an agent may read, and warnings.

Agents sort this mail, so a message can try to talk to them instead of the owner: instructions in
HTML comments, in hidden elements (display:none, zero font size), in zero-width characters or in
an encoded block (Barracuda, Oct 2026). The text we store is what a person would see; what was
hidden is left out and named in `warnings` (short strings for the triage job: hints, not verdicts).
"""
import base64, binascii, email.utils, re
from html import unescape
from html.parser import HTMLParser

ZW = "​‌‍⁠⁡⁢⁣⁤﻿᠎‪-‮⁦-⁩"
ZW_RE = re.compile(f"[{ZW}]")
ZW_IN_WORD = re.compile(f"[^\\W\\d_][{ZW}]+[^\\W\\d_]")  # "Pay\u200bPal"
GONE = re.compile(r"display\s*:\s*none|opacity\s*:\s*0(?:\.0+)?\s*(?:;|!|$)", re.I)  # nothing inside can undo these
FONT = re.compile(r"font-size\s*:\s*([\d.]+)\s*(px|pt|em|rem|%)?", re.I)
VIS = re.compile(r"visibility\s*:\s*(hidden|visible|collapse)", re.I)
# Hidden text gets the broad test; text a person can see only the strong phrases (AI newsletters
# talk about assistants all day).
TO_AI = re.compile(r"\b(?:ignore|disregard|forget|override)\b.{0,40}\b(?:previous|prior|above|earlier|all|other)\b.{0,20}\b(?:instructions?|prompts?|rules?)\b"
                   r"|\bsystem prompt\b|\b(?:tell|inform|remind|advise) the (?:user|owner|recipient)\b|\bnote to (?:the )?(?:ai|assistant|agent|model)\b"
                   r"|\bif you are an? (?:ai|assistant|agent|language model|llm)\b|\b(?:ai|email) assistants?\s*[:,]\s*(?:please|you)", re.I | re.S)
TO_AI_HIDDEN = re.compile(TO_AI.pattern + r"|\b(?:this|the) (?:e-?mail|message) is (?:urgent|legitimate|safe|verified|genuine)\b"
                          r"|\bpriority action\b|\b(?:mark|classify|categori[sz]e|label|flag|treat) (?:this|it) as\b", re.I | re.S)
B64 = re.compile(r"(?<![\w/+=%.-])[A-Za-z0-9+/]{120,}={0,2}(?![\w/+=%-])")
URL = re.compile(r"https?://\S+|www\.\S+")
FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "aol.com", "icloud.com",
            "me.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "mail.com", "mail.ru", "yandex.com", "yandex.ru", "zoho.com"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SELF_CLOSING = {"p", "li", "td", "th", "tr", "option"}  # often left open: a new one closes the last
BLOCK = {"br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote", "pre", "hr", "section", "article"}
DROP = {"script", "style", "head", "title", "template"}

class _Visible(HTMLParser):
    """Text split into shown and hidden, inheriting the way CSS does: a child can bring back a zero
    font size (a common layout trick on table cells) or visibility, nothing undoes display:none."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.hidden, self.stack = [], [], []  # stack: (tag, gone, drop, tiny, invisible)
    def handle_starttag(self, tag, attrs):
        self.out.append("\n" if tag in BLOCK else " ")
        if tag in VOID: return
        if tag in SELF_CLOSING and self.stack and self.stack[-1][0] == tag: self.stack.pop()
        a = {k: (v or "") for k, v in attrs}; st = a.get("style", "")
        _, gone, drop, tiny, invisible = self.stack[-1] if self.stack else ("", False, False, False, False)
        if f := FONT.findall(st): tiny = float(f[-1][0] or 0) <= (1 if f[-1][1].lower() in ("px", "pt", "") else 0)
        if v := VIS.findall(st): invisible = v[-1].lower() != "visible"
        self.stack.append((tag, gone or "hidden" in a or bool(GONE.search(st)), drop or tag in DROP, tiny, invisible))
    def handle_endtag(self, tag):
        self.out.append("\n" if tag in BLOCK else " ")
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]; return
    def handle_data(self, data):
        top = self.stack[-1] if self.stack else ("", False, False, False, False)
        if top[2]: return
        (self.hidden if top[1] or top[3] or top[4] else self.out).append(data)
    def handle_comment(self, data):
        if not re.match(r"\s*\[if|\s*<!\[endif|\s*\[endif", data, re.I):  # Outlook's conditional HTML, not text
            self.hidden.append(" " + data + " ")

def _squash(s):
    return re.sub(r"\s+", " ", ZW_RE.sub("", s)).strip()

def _lines(s):
    s = re.sub(r"[ \t\r\f\v\u00a0\u034f\u00ad]+", " ", ZW_RE.sub("", s))
    return re.sub(r"\s*\n\s*(?:\n\s*)+", "\n\n", re.sub(r" *\n *", "\n", s)).strip()

def visible_text(h):
    """(what a person sees in the HTML, paragraphs kept; what was hidden from them)."""
    p = _Visible()
    try:
        p.feed(h); p.close()
        return _lines("".join(p.out)), _squash("".join(p.hidden))
    except Exception:
        h = re.sub(r"(?is)<(script|style|head).*?</\1>|<!--.*?-->", " ", h)
        return _squash(unescape(re.sub(r"(?s)<[^>]+>", " ", h))), ""

def _encoded(s):
    for b in B64.findall(URL.sub(" ", s)):
        try: d = base64.b64decode(b + "=" * (-len(b) % 4), validate=True)
        except (binascii.Error, ValueError): continue
        if len(d) >= 60 and sum(32 <= c < 127 or c in (9, 10, 13) for c in d) / len(d) > 0.9:
            return d.decode("ascii", "replace")
    return None

def _domain(addr):
    return addr.rpartition("@")[2].lower().strip(">. ") if "@" in (addr or "") else ""

def _base(dom):  # last two labels: news.paypal.com and paypal.com are one sender
    return ".".join(dom.split(".")[-2:])

def auth_results(m):
    """spf/dkim/dmarc as Gmail recorded them on arrival (its own Authentication-Results header)."""
    for h in m.get_all("Authentication-Results") or []:
        h = str(h)
        if not h.strip().lower().startswith("mx.google.com"): continue
        return {k: r.group(1).lower() for k in ("spf", "dkim", "dmarc") if (r := re.search(rf"\b{k}=(\w+)", h))}
    return {}

def check(text, html, from_name="", from_addr="", reply_to="", auth=None, subject=""):
    """(the text to store, [warnings]). text is the text/plain part or None; html the HTML part or None."""
    warn = []
    raw = (text or "") + " " + (html or "")
    # In the body they're everywhere (addresses split so phones don't link them) and stripped
    # before anyone reads it; in the sender or subject they disguise who's writing.
    if ZW_IN_WORD.search((from_name or "") + " " + (subject or "")):
        warn.append("Invisible characters inside the sender or subject")
    plain = re.sub(r"[ \t]+", " ", ZW_RE.sub("", text or "")).strip()
    seen, hidden = visible_text(html) if html else ("", "")
    # Mail apps show the HTML; a plain part beside it is unseen by the owner, so read what they see
    # (unless the HTML is all pictures).
    body = seen if html and len(seen) >= min(10, len(plain)) else plain
    if body is seen: hidden += " " + plain
    if hidden and TO_AI_HIDDEN.search(hidden):
        warn.append("Hidden text addressed to an AI")
    elif TO_AI.search(subject + " " + (body or "")):
        warn.append("Text addressed to an AI assistant")
    if _encoded(raw):
        warn.append("Encoded text block")
    if auth:
        if auth.get("dmarc") == "fail":
            warn.append("Sender authentication failed (dmarc=fail)")
        elif auth.get("spf") in ("fail", "softfail") and auth.get("dkim") != "pass":
            warn.append(f"Sender authentication failed (spf={auth['spf']})")
        elif not any(v == "pass" for v in auth.values()):
            warn.append("Sender not authenticated")
    fd = _domain(from_addr)
    for shown in re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", from_name or ""):
        if fd and _base(_domain(shown)) != _base(fd):
            warn.append(f"Display name shows {shown}, sent from {fd}"); break
    rt = _domain(email.utils.parseaddr(reply_to or "")[1])
    if rt and rt in FREEMAIL and rt != fd:
        warn.append(f"Replies go to a {rt} address")
    return body, warn
