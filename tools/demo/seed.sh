#!/usr/bin/env bash
# Fill a fresh Springroll with a believable week, for screenshots. Runs on the demo machine as the
# agent user (tools/demo/up.sh copies it there). Everything here is made up; nothing is real data.
#   seed.sh            jobs with reports and prompts, Timeline items, a to-do list, settings
set -euo pipefail
DEMO=$(cd "$(dirname "$0")" && pwd)
A=localhost:8090
cd ~/home

# Settings: Inter renders the same on Linux as on a Mac; the clock is Pacific.
curl -fsS -X POST localhost:8000/api/settings -H 'content-type: application/json' \
  -d '{"font":"inter","theme":"springroll-dark-glass","timezone":"America/Los_Angeles"}' >/dev/null

# No Mail on the demo, so no mail triage; a backup passphrase so nightly backups don't ask for one.
[ -d jobs/mail-triage ] && git rm -rq jobs/mail-triage && git commit -qm "Demo: no mail triage"
[ -s ~/.config/springroll/backup-passphrase ] || (umask 077; openssl rand -hex 16 > ~/.config/springroll/backup-passphrase)

# Jobs: each publishes its report from reports/<name>.md. They keep their schedules for the Jobs
# page, but onlyIf "false" skips every scheduled run, so the week stays as seeded.
job() { # name title schedule group
  mkdir -p "jobs/$1"
  cp "$DEMO/reports/$1.md" "jobs/$1/report.md"
  jq -n --arg t "$2" --arg s "$3" --arg g "$4" --arg n "$1" \
    '{title: $t, type: "command", schedule: $s, group: $g, enabled: true, notify: false, onlyIf: "false",
      command: ("report ~/home/jobs/" + $n + "/report.md")}' > "jobs/$1/job.json"
  printf '# %s\n\nNotes the agent keeps between runs.\n' "$2" > "jobs/$1/NOTES.md"
}
job morning-brief "Morning brief" "0 7 * * *" "Daily"
job price-watch "Price watch" "0 */6 * * *" "Watching"
job repos-week "Your repos this week" "0 8 * * 1" "Work"
job site-traffic "Site traffic" "0 6 * * *" "Work"
job bills "Bills" "0 9 1 * *" "Home"
git add jobs && git commit -qm "Demo jobs" || true
sleep 3 # agentd notices new job folders

for j in bills site-traffic repos-week price-watch morning-brief; do
  curl -fsS -X POST "$A/jobs/$j/run" -H 'content-type: application/json' -d '{}' >/dev/null
  sleep 2
done
sleep 5

# Move runs back so the Timeline spans the week: name, days ago, hour.
python3 - <<'PY'
import sqlite3, time, datetime, os
db = sqlite3.connect(os.path.expanduser("~/data/agentd/agentd.db"))
back = {"bills": (3, 9), "site-traffic": (1, 6), "repos-week": (2, 8), "price-watch": (0, 6), "morning-brief": (0, 7)}
today = datetime.datetime.now().replace(minute=0, second=0, microsecond=0)
for job, (days, hour) in back.items():
    row = db.execute("select id, thread_id, started, finished from runs where job=? order by id desc limit 1", (job,)).fetchone()
    if not row: continue
    rid, tid, started, finished = row
    at = int((today - datetime.timedelta(days=days)).replace(hour=hour).timestamp() * 1000)
    shift = at - started
    db.execute("update runs set started=started+?, finished=finished+? where id=?", (shift, shift, rid))
    db.execute("update threads set created=created+?, updated=updated+?, last_read=updated+? where id=?", (shift, shift, shift, tid))
    db.execute("update items set created=created+?, updated=updated+? where thread_id=?", (shift, shift, tid))
db.commit()
PY

# Now that the runs are in, each job becomes what it would be on a real machine: an agent job whose
# prompt is one sentence, with a few lines of the notes an agent keeps between runs.
agentjob() { # name prompt notes
  jq --arg p "$2" 'del(.command) | .type = "agent" | .agent = "claude" | .prompt = $p | .retries = 2' "jobs/$1/job.json" > "jobs/$1/job.tmp"
  mv "jobs/$1/job.tmp" "jobs/$1/job.json"
  printf '%s\n\n%s\n' "$(head -1 "jobs/$1/NOTES.md")" "$3" > "jobs/$1/NOTES.md"
}
agentjob morning-brief "Every morning, look at my calendar and the weather and tell me what today looks like, and which emails need me before noon." \
  "- Lead with the weather only if it changes plans (rain, a late flight).
- Priya's lunches are always downtown; don't repeat the address."
agentjob price-watch "Every six hours, check the prices on my watch list and tell me when one drops, with a chart of the last month." \
  "- The watch list is ~/data/prices/watch.md (9 items).
- The desk's store shows a sale price only after 6am; check after that."
agentjob site-traffic "Every morning, check yesterday's visitors and sign-ups and tell me if anything looks off." \
  "- Search has driven most of the growth since Oct 12.
- Sundays run about 10% low; that's normal, not a drop."
agentjob repos-week "Every Monday, sum up what changed in my GitHub repos last week, and what's waiting on my review." \
  "- Three repos: app, site, scripts. Dependabot PRs count as merged work, not review."
agentjob bills "On the 1st, check that every bill got paid and tell me the total." \
  "- Four bills from the joint account. Electric varies with the season; flag only a jump over 25%."
git add jobs && git commit -qm "Demo: the jobs as their prompts" || true

# The Timeline: what needs you, and what's worth knowing.
signal --needs --quiet --key demo:quote --source Mail --icon mail \
  "Approve the plumber's quote?" "\$480 to replace the water heater valve, Thursday 9am. Dana asked for a yes by tonight."
signal --needs --quiet --key demo:pr42 --source GitHub --icon git-pull-request \
  "Review #42: Add dark mode to the dashboard" "Sam's pull request, 6 files. Tests pass."
signal --needs --quiet --key demo:passport --source To-dos --icon file-signature \
  "Sign the passport renewal" "The form is filled in and printed. It expires in five months."
signal --key demo:flight --source Mail --icon plane "Flight to Denver, Friday 7:40am" "Checked in. Seat 14C, confirmation in Mail."
signal --key demo:electric --source Bills --icon zap "Electric bill: \$84.12" "Down 9% from September."

# A to-do list.
mkdir -p ~/data/todos
cat > ~/data/todos/TODO.md <<'MD'
# To-dos

## 📋 Backlog

- [ ] Book the cabin for Thanksgiving
- [ ] Find a new dentist closer to work
- [ ] Sell the old bike

## 🚧 In Progress

- [ ] Sign the passport renewal
  - [x] Fill in the form
  - [x] Print the photo
  - [ ] Sign and mail it
- [ ] Plan Priya's birthday dinner

## ✅ Done

- [x] Cancel the gym membership
- [x] Pay the October bills
MD
# Needs you is read by a model; tell it what this machine is.
curl -fsS -X POST localhost:8000/api/needs/preferences -H 'content-type: application/json' \
  -d '{"text":"This is a demo machine for screenshots. There is no Mail app and no mail sync on purpose: never flag mail being unavailable, unreachable or off."}' >/dev/null
# Let Needs you read it all again.
curl -fsS -X POST localhost:8000/api/needs/refresh >/dev/null || true
echo "Seeded."
