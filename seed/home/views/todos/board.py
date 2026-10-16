"""TODO.md boards: parse and edit the markdown kanban format that Shep renders and agents keep
(the shep-todos skill). `##` headings are columns, each top-level `- [ ]` line is a card, its
indented lines and nested checkboxes belong to it, and Done-like columns hold `- [x]` cards.

Edits are surgical and follow Shep's own (src-tauri/src/todos.rs): a card's block
ends at the next item at its indent or shallower, the next heading, or a blank line; moves and
adds land at the end of the target column. Every edit re-reads the file and finds the card by
its id (a hash of its text), so a file an agent changed in the meantime fails cleanly instead
of being overwritten."""
import hashlib, os, re, tempfile, time

HEADING = re.compile(r"^\s*(#+)(?:\s+(.*?))?\s*#*\s*$")
CHECK = re.compile(r"^(\s*)(?:[-*+]|\d{1,9}[.)])\s+\[([ xX])\](?:\s+(.*?))?\s*$")
LIST = re.compile(r"^\s*(?:[-*+]|\d{1,9}[.)])\s")
SKELETON = "# To-dos\n\n## 📋 Backlog\n\n## 🚧 In Progress\n\n## ✅ Done\n"


class Changed(Exception):
    """The file changed on disk since the caller read it."""


def kind(title):
    t = title.lower()
    if "✅" in t or re.search(r"\b(done|complete[d]?|finished|shipped)\b", t): return "done"
    if "🚧" in t or re.search(r"\b(in progress|doing|now|active|started)\b", t): return "progress"
    if "⛔" in t or re.search(r"\bblocked\b", t): return "blocked"
    if "📋" in t or re.search(r"\b(backlog|to-?do|later|next|ideas?)\b", t): return "backlog"
    return "other"


def heading(line):
    m = HEADING.match(line)
    if not m or not line.lstrip().startswith("#"): return None
    return len(m.group(1)), (m.group(2) or "").strip()


def continuation(line, indent):
    s = line.lstrip()
    return bool(s) and not s.startswith("#") and len(line) - len(s) > indent and not LIST.match(line)


def parse(text):
    """{title, preamble, columns: [{title, kind, line, level, cards: [card]}]}; a card is
    {id, text, done, line, end, children: [{text, done, depth}], body (its indented lines)}."""
    lines = text.split("\n")
    out = {"title": "", "preamble": [], "columns": []}
    col, seen, i = None, {}, 0
    while i < len(lines):
        h = heading(lines[i])
        if h:
            level, title = h
            if level == 1 and not out["columns"] and not out["title"]: out["title"] = title
            elif title and level >= 2:
                col = {"title": title, "kind": kind(title), "line": i, "level": level, "cards": []}
                out["columns"].append(col)
            i += 1; continue
        m = CHECK.match(lines[i])
        if m and col is not None and not m.group(1) and m.group(3):
            end = block_end(lines, i, 0)
            txt = m.group(3)
            j = i + 1
            while j < end and continuation(lines[j], 0): txt += " " + lines[j].strip(); j += 1
            key = hashlib.sha1(txt.encode()).hexdigest()[:8]
            seen[key] = seen.get(key, 0) + 1
            cid = key if seen[key] == 1 else f"{key}-{seen[key]}"
            kids = []
            for ln in lines[j:end]:
                c = CHECK.match(ln)
                if c and c.group(3): kids.append({"text": c.group(3), "done": c.group(2) != " ", "depth": len(c.group(1))})
            col["cards"].append({"id": cid, "text": txt, "done": m.group(2) != " ", "line": i, "end": end,
                                 "children": kids, "body": dedent(lines[j:end])})
            i = end; continue
        if col is None and lines[i].strip() and not h: out["preamble"].append(lines[i])
        i += 1
    out["preamble"] = "\n".join(out["preamble"]).strip()
    return out


def dedent(lines):
    lines = [l.rstrip() for l in lines]
    pad = min((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
    return "\n".join(l[pad:] for l in lines).strip("\n")


def block_end(lines, start, indent):
    """Shep's card block: up to the next item at the same or shallower indent, heading or blank line."""
    for j in range(start + 1, len(lines)):
        l = lines[j]
        if not l.strip() or heading(l): return j
        m = CHECK.match(l)
        if (m or LIST.match(l)) and len(l) - len(l.lstrip()) <= indent: return j
    return len(lines)


def insert_at(lines, head, level):
    """After the column's last non-blank line, before the next heading at its level or above."""
    end = len(lines)
    for j in range(head + 1, len(lines)):
        h = heading(lines[j])
        if h and h[0] <= level: end = j; break
    while end > head + 1 and not lines[end - 1].strip(): end -= 1
    return end


def splice_into(lines, col, block, doc):
    at = insert_at(lines, col["line"], col["level"])
    if at == col["line"] + 1:  # empty column: blank line after the heading, and before what follows
        lines[at:at] = [""] + block
        after = at + 1 + len(block)
        if after < len(lines) and lines[after].strip(): lines.insert(after, "")
    else:  # keep the file's style: cards separated by a blank line, or not
        spaced = any(not lines[c["line"] - 1].strip() for k in doc["columns"] for c in k["cards"][1:])
        lines[at:at] = ([""] if spaced else []) + block


def set_check(line, done):
    b = line.index("[")
    return line[:b + 1] + ("x" if done else " ") + line[b + 2:]


class Board:
    def __init__(self, bid, name, path, archive):
        self.id, self.name, self.path, self.archive_target = bid, name, path, archive

    def read(self):
        try: return open(self.path, encoding="utf-8").read()
        except FileNotFoundError: return ""

    def write(self, text):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path), prefix=".TODO.")
        with os.fdopen(fd, "w", encoding="utf-8") as f: f.write(text)
        if os.path.exists(self.path): os.chmod(tmp, os.stat(self.path).st_mode & 0o777)
        os.replace(tmp, self.path)

    def load(self):
        text = self.read()
        return text, text.split("\n"), parse(text)

    def find(self, doc, cid):
        for col in doc["columns"]:
            for c in col["cards"]:
                if c["id"] == cid: return col, c
        raise Changed(f"No card {cid} on {self.name}: the board changed, reload it")

    def column(self, doc, want, default_kind="backlog"):
        cols = doc["columns"]
        if want:
            w = want.lower().strip()
            for c in cols:
                if c["title"].lower() == w or c["kind"] == w: return c
            for c in cols:
                if w in c["title"].lower(): return c
            raise ValueError(f"No column {want!r} on {self.name} (has: {', '.join(c['title'] for c in cols)})")
        for c in cols:
            if c["kind"] == default_kind: return c
        if not cols: raise ValueError(f"{self.name} has no columns")
        return cols[0]

    def summary(self):
        doc = parse(self.read())
        n = {k: 0 for k in ("open", "progress", "done")}
        for col in doc["columns"]:
            for c in col["cards"]:
                if col["kind"] == "done": n["done"] += 1
                else:
                    n["open"] += 1
                    if col["kind"] == "progress": n["progress"] += 1
        try: mtime = int(os.path.getmtime(self.path) * 1000)
        except OSError: mtime = None
        return {"id": self.id, "name": self.name, "path": self.path, "exists": os.path.exists(self.path),
                "updated": mtime, "archive": self.archive_target(time.strftime("%Y-%m-%d")), **n}

    # ---- edits ----
    def add(self, text, column=None, notes=()):
        text = " ".join(text.split())
        if not text: raise ValueError("A to-do needs a title")
        if not self.read().strip(): self.write(SKELETON)
        _, lines, doc = self.load()
        col = self.column(doc, column)
        done = col["kind"] == "done"
        block = [f"- [{'x' if done else ' '}] {text}"] + [f"  - {n.strip()}" for n in notes if n.strip()]
        splice_into(lines, col, block, doc)
        self.write("\n".join(lines))
        return self.card_by_text(text)

    def card_by_text(self, text):
        doc = parse(self.read())
        for col in doc["columns"]:
            for c in reversed(col["cards"]):
                if c["text"] == text: return dict(c, column=col["title"])

    def move(self, cid, column=None, done=None):
        """Move a card to a column (keeping its children) and make its checkbox agree."""
        _, lines, doc = self.load()
        src, card = self.find(doc, cid)
        if column is None and done is not None:
            if done == (src["kind"] == "done"): return dict(card, column=src["title"])
            target = self.column(doc, None, "done" if done else "backlog")
        else:
            target = self.column(doc, column)
        if target is src: return dict(card, column=src["title"])
        block = lines[card["line"]:card["end"]]
        block[0] = set_check(block[0], target["kind"] == "done")
        self._cut(lines, card)
        doc = parse("\n".join(lines))
        target = next(c for c in doc["columns"] if c["title"] == target["title"])
        splice_into(lines, target, block, doc)
        self.write("\n".join(lines))
        return self.card_by_text(card["text"])

    def edit(self, cid, text):
        text = " ".join(text.split())
        if not text: raise ValueError("A to-do needs a title")
        _, lines, doc = self.load()
        _, card = self.find(doc, cid)
        first = lines[card["line"]]
        head = first[:first.index("]") + 1]
        j = card["line"] + 1
        while j < card["end"] and continuation(lines[j], 0): j += 1
        lines[card["line"]:j] = [f"{head} {text}"]
        self.write("\n".join(lines))
        return self.card_by_text(text)

    def delete(self, cid):
        _, lines, doc = self.load()
        _, card = self.find(doc, cid)
        self._cut(lines, card)
        self.write("\n".join(lines))

    def _cut(self, lines, card):
        start, end = card["line"], card["end"]
        del lines[start:end]
        if 0 < start < len(lines) and not lines[start - 1].strip() and not lines[start].strip():
            del lines[start]

    def archive(self):
        """Move every card in Done-like columns to the board's archive file (never deleted)."""
        _, lines, doc = self.load()
        blocks, n = [], 0
        for col in doc["columns"]:
            if col["kind"] != "done": continue
            for c in col["cards"]: blocks.append(lines[c["line"]:c["end"]]); n += 1
        if not n: return {"archived": 0, "file": None}
        day = time.strftime("%Y-%m-%d")
        path = self.archive_target(day)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        rel = os.path.relpath(self.path, os.path.dirname(path))
        exists = os.path.exists(path) and open(path, encoding="utf-8").read().strip()
        with open(path, "a", encoding="utf-8") as f:
            if not exists: f.write(f"# Done to-dos\n\nArchived from [{os.path.basename(self.path)}]({rel})'s Done column. Newest at the bottom.\n")
            f.write(f"\n## Archived {day}\n\n" + "\n".join("\n".join(b) for b in blocks) + "\n")
        for col in reversed(doc["columns"]):
            if col["kind"] != "done": continue
            for c in reversed(col["cards"]): self._cut(lines, c)
        self.write("\n".join(lines))
        return {"archived": n, "file": path}
