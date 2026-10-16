#!/usr/bin/env bash
# Skill audit for nightly housekeeping: one line per skill (size, frontmatter, linked into each
# agent, chats that read it in the last 30 days, paths it names that no longer exist), then the
# size of what every chat loads. Read-only. Usage: skills-check.sh
set -u
H=~/home DB=~/data/agentd/agentd.db
AGENT_DIRS=(~/.claude/skills ~/.codex/skills ~/.pi/agent/skills)
since=$(( ($(date +%s) - 30*86400) * 1000 ))

printf '%-12s %6s %5s  %-11s %-7s %5s  %s\n' skill bytes lines frontmatter linked chats30d missing-paths
for d in "$H"/skills/*/; do
  s=$(basename "$d") f="$d/SKILL.md"
  [ -f "$f" ] || { printf '%-12s no SKILL.md\n' "$s"; continue; }
  bytes=$(wc -c <"$f") lines=$(wc -l <"$f")
  name=$(sed -n '2,5s/^name: *//p' "$f" | head -1)
  desc=$(sed -n '2,6s/^description: *//p' "$f" | head -1)
  fm=ok; [ "$name" = "$s" ] || fm="name≠dir"; [ -n "$desc" ] || fm="no-desc"
  linked=0; for a in "${AGENT_DIRS[@]}"; do [ -e "$a/$s/SKILL.md" ] && linked=$((linked+1)); done
  chats=$(sqlite3 "$DB" "select count(distinct thread_id) from items where kind='tool' and created > $since
    and (data like '%skills/$s/SKILL.md%' or data like '%\"skill\":\"$s\"%')" 2>/dev/null || echo '?')
  # Paths in backticks that point into ~/home (or ~/...) and don't exist any more.
  missing=$(grep -o '`[^` ]*`' "$f" | tr -d '`' | grep -E '^(~/|(skills|views|jobs|bin|agentd|connections|agents|notes|personas)/)' \
    | sed -E 's/[:#].*$//; s/[),.;]+$//' | grep -v '[<>*{…]' | sort -u | while read -r p; do
      q=${p/#\~/$HOME}; [[ $q = /* ]] || q="$H/$q"; [ -e "$q" ] || printf '%s ' "$p"; done)
  printf '%-12s %6s %5s  %-11s %s/%-5s %5s  %s\n' "$s" "$bytes" "$lines" "$fm" "$linked" "${#AGENT_DIRS[@]}" "$chats" "${missing:--}"
done

echo
echo "Loaded into every chat:"
printf '  AGENTS.md        %6s bytes (keep under ~6000)\n' "$(wc -c <"$H/AGENTS.md")"
printf '  notes/memory.md  %6s bytes, %s lines (keep under ~80 lines)\n' "$(wc -c <"$H/notes/memory.md")" "$(wc -l <"$H/notes/memory.md")"
echo "  skill descriptions: $(cat "$H"/skills/*/SKILL.md | sed -n 's/^description: *//p' | wc -c) bytes"
# Skills linked into an agent that no longer exist in ~/home/skills.
for a in "${AGENT_DIRS[@]}"; do for l in "$a"/*; do
  [ -L "$l" ] && [ ! -e "$l" ] && echo "  broken link: $l"
done; done
exit 0
