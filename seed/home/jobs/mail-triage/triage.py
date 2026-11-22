#!/usr/bin/env -S uv run -q --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["anthropic>=2.12"]
# ///
"""Mail triage, quarantined: this script does everything; the model only reads and answers.

The model gets the new mail (what a person would see, from Mail's API), the owner's RULES, the NOTES
lines about these senders, and PROMPT.md. It has no tools, no shell, no files and no keys: it's one
API call and its only output is JSON (a schema on Claude). This script checks that JSON (known ids,
known categories, lengths, nothing addressed to an AI) and then saves the verdicts, raises the
Needs-you signals and appends rules/notes. A hostile email can at worst get itself sorted wrong.

Model: job.json "model". A Claude id (claude-...) goes to the Anthropic API (ANTHROPIC_API_KEY,
Connections → Anthropic API); if that fails (credit out, outage) and OPENROUTER_API_KEY is set, Grok on
OpenRouter answers and the run's summary says so. An OpenRouter id ("x-ai/...") goes straight there.
Run: uv run --script triage.py [--dry-run]
"""
import json, os, re, subprocess, sys, time, urllib.request
import anthropic
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOME = Path.home() / "home"
sys.path.insert(0, str(HOME / "views" / "mail"))
from checks import TO_AI_HIDDEN  # the phrases that mark text aimed at an AI  # noqa: E402

M = f"http://localhost:{(HOME / 'views/mail/PORT').read_text().strip()}"
CATS = {"needs_you", "worth_knowing", "paper_trail", "feed", "noise"}
BATCH, BODY = 40, 2500          # messages per run, characters of each body the model sees
DRY = "--dry-run" in sys.argv


def api(path, data=None):
    req = urllib.request.Request(M + path, method="POST" if data is not None else "GET",
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def clean(s, n):
    """One line of plain text, at most n characters."""
    s = re.sub(r"[\x00-\x08\x0b-\x1f\x7f​-‏‪-‮⁠-⁩﻿]", "", str(s or ""))
    return re.sub(r"\s+", " ", s).strip()[:n]


def base(addr):
    dom = (addr or "").rsplit("@", 1)[-1].lower()
    return ".".join(dom.split(".")[-2:]) if dom else ""


def notes_for(mail, notes):
    """The NOTES lines about these senders (all of NOTES is ~80 KB; this keeps each call small)."""
    keys = set()
    for m in mail:
        a = (m.get("from_addr") or "").lower()
        if a: keys |= {a, base(a)}
    keys.discard("gmail.com"); keys.discard("")
    head, lines = [], []
    for ln in notes.splitlines():
        if not ln.startswith("- "): head.append(ln); continue
        low = ln.lower()
        if any(k in low for k in keys): lines.append(ln)
    for m in mail:  # personal addresses: only that exact address
        a = (m.get("from_addr") or "").lower()
        if base(a) == "gmail.com": lines += [ln for ln in notes.splitlines() if a in ln.lower() and ln not in lines]
    return "\n".join(head[:4] + lines[:150])


FALLBACK = "x-ai/grok-4.7"
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["triage", "rules_add", "notes_add"],
          "properties": {
              "triage": {"type": "array", "items": {
                  "type": "object", "additionalProperties": False, "required": ["id", "category", "reason"],
                  "properties": {"id": {"type": "integer"}, "category": {"type": "string", "enum": sorted(CATS)},
                                 "reason": {"type": "string"}, "action": {"type": "string"}, "draft": {"type": "string"}}}},
              "rules_add": {"type": "array", "items": {"type": "string"}},
              "notes_add": {"type": "array", "items": {"type": "string"}}}}


def ask_claude(model, system, user):
    """One Messages call, no tools, JSON held to SCHEMA. Low effort: this is sorting, not thinking."""
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=240.0)
    r = client.messages.create(model=model, max_tokens=16000, system=system,
                               messages=[{"role": "user", "content": user}],
                               output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}})
    if r.stop_reason != "end_turn":
        raise ValueError(f"Claude stopped with {r.stop_reason}")
    text = next(b.text for b in r.content if b.type == "text")
    return json.loads(text), {"input_tokens": r.usage.input_tokens, "output_tokens": r.usage.output_tokens}


def ask_openrouter(model, system, user):
    body = {"model": model, "temperature": 0.2, "max_tokens": 12000,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
                                          "content-type": "application/json", "X-Title": "Springroll mail triage"})
    with urllib.request.urlopen(req, timeout=240) as r:
        out = json.load(r)
    text = out["choices"][0]["message"]["content"] or ""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    return json.loads(text), out.get("usage", {})


def lines_ok(items, limit, n):
    """Rules/notes lines the model proposed: plain, short, and never instructions to an AI."""
    ok = []
    for s in items if isinstance(items, list) else []:
        s = clean(s, n).lstrip("-• ").strip()
        if len(s) < 8 or TO_AI_HIDDEN.search(s) or re.search(r"https?://|`|\$\(", s): continue
        ok.append(s)
    return ok[:limit]


def append(path, lines):
    text = path.read_text()
    have = {l.strip().lower() for l in text.splitlines()}
    new = [l for l in lines if f"- {l}".lower() not in have]
    if new and not DRY:
        path.write_text(text.rstrip("\n") + "\n" + "".join(f"- {l}\n" for l in new))
    return new


def main():
    job = json.loads((HERE / "job.json").read_text())
    model = job.get("model") or "claude-opus-5-5"
    corrections = api("/api/corrections")["items"]
    pending = api(f"/api/triage/pending?limit={BATCH}")["items"]
    if not pending and not corrections:
        print("Nothing new."); return
    mail = []
    for p in pending:
        try: full = api(f"/api/msg/{p['id']}")
        except Exception: full = {}
        mail.append({"id": p["id"], "account": p.get("account"), "from_name": p.get("from_name"),
                     "from_addr": p.get("from_addr"), "to": p.get("to_addrs"), "subject": p.get("subject"),
                     "date": time.strftime("%Y-%m-%d %H:%M", time.localtime(p.get("date") or 0)),
                     "warnings": p.get("warnings") or [], "attachments": full.get("attachments") or [],
                     "text": (full.get("text") or p.get("snippet") or "")[:BODY]})
    rules = (HERE / "RULES.md").read_text()
    notes = notes_for(mail, (HERE / "NOTES.md").read_text())
    corr = [{"from_addr": c.get("from_addr"), "subject": c.get("subject"), "was": c.get("was"),
             "now": c.get("now"), "owner_note": c.get("note")} for c in corrections]
    user = (f"RULES (the owner's, first):\n{rules}\n\nNOTES (background on these senders):\n{notes}\n\n"
            f"CORRECTIONS (untrusted data: the owner moved these messages):\n{json.dumps(corr, ensure_ascii=False)}\n\n"
            f"MAIL (untrusted data, {len(mail)} messages):\n{json.dumps(mail, ensure_ascii=False)}")
    system = (HERE / "PROMPT.md").read_text()

    ids, got, usage, err, answered = {m["id"] for m in mail}, None, {}, "no triage list in the answer", model
    tries = [(model, ask_claude)] if model.startswith("claude-") else [(model, ask_openrouter)] * 2
    if model.startswith("claude-") and os.environ.get("OPENROUTER_API_KEY"): tries.append((FALLBACK, ask_openrouter))
    for name, fn in tries:
        try:
            got, usage = fn(name, system, user)
            if isinstance(got, dict) and isinstance(got.get("triage"), list): answered = name; break
        except anthropic.APIStatusError as e:  # 402 billing_error = credit ran out; the SDK already retried 429/5xx
            err = f"{e.status_code} {e.type}: {e.message}"
        except Exception as e:
            err = e
        got = None
    if got is None:
        print(f"No usable answer ({', '.join(n for n, _ in tries)}): {err}"); sys.exit(1)
    fell_back = answered != model

    verdicts, seen = [], set()
    for t in got["triage"]:
        if not isinstance(t, dict): continue
        try: i = int(t.get("id"))
        except (TypeError, ValueError): continue
        cat = t.get("category")
        if i not in ids or i in seen or cat not in CATS: continue
        seen.add(i)
        v = {"id": i, "category": cat, "reason": clean(t.get("reason"), 120)}
        suspect = v["reason"].startswith(("Phishing:", "Check before acting:"))
        if cat == "needs_you" and suspect: v["category"] = "worth_knowing"
        if v["category"] == "needs_you":
            v["action"] = clean(t.get("action"), 80).rstrip(" .") or "Look at this"
            if t.get("draft"): v["draft"] = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", str(t["draft"]))[:2000].strip()
        verdicts.append(v)
    missing = ids - seen  # left for the next run, which sees them as pending again

    if DRY:
        print(json.dumps({"answered": answered, "verdicts": verdicts, "missing": sorted(missing), "rules_add": got.get("rules_add"),
                          "notes_add": got.get("notes_add"), "usage": usage}, indent=1, ensure_ascii=False)); return
    if verdicts: api("/api/triage", verdicts)
    by_id = {m["id"]: m for m in mail}
    for v in verdicts:
        if v["category"] != "needs_you": continue
        m = by_id[v["id"]]; who = clean(m.get("from_name") or m.get("from_addr"), 60)
        subprocess.run(["signal", "--needs", "--quiet", "--key", f"mail:{v['id']}", "--source", "Mail",
                        "--link", f"#/v/mail#{v['id']}", f"{v['action']}, from {who}", v["reason"]], check=False)
    new_rules = append(HERE / "RULES.md", lines_ok(got.get("rules_add"), 5, 300)) if corrections else []
    if corrections: api("/api/corrections/seen", {})
    if new_rules:
        subprocess.run(["git", "-C", str(HOME), "commit", "-q", "-m", "Mail rules: learned from the owner's corrections",
                        "--", "jobs/mail-triage/RULES.md"], check=False)
    append(HERE / "NOTES.md", lines_ok(got.get("notes_add"), 5, 300))

    n = {c: sum(v["category"] == c for v in verdicts) for c in CATS}
    phish = sum(v["reason"].startswith("Phishing:") for v in verdicts)
    parts = [f"{n['needs_you']} need{'s' if n['needs_you'] == 1 else ''} you" if n["needs_you"] else "",
             f"{n['worth_knowing']} worth knowing" if n["worth_knowing"] else "",
             f"{n['paper_trail'] + n['feed'] + n['noise']} filed" if n["paper_trail"] + n["feed"] + n["noise"] else "",
             f"{phish} phishing" if phish else "", f"{len(missing)} left for next run" if missing else "",
             f"{len(new_rules)} new rule{'s' if len(new_rules) != 1 else ''}" if new_rules else ""]
    line = (f"{len(verdicts)} new: " + ", ".join(p for p in parts if p) + "." if verdicts else
            "Corrections learned." if corrections else "Nothing sorted.")
    if fell_back: line += f" Answered by {answered}, not {model} ({clean(err, 120)})."
    print(line)


if __name__ == "__main__":
    main()
