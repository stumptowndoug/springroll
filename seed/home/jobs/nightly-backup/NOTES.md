# Nightly backup

Runs `backup --keep 7`: one file per night in ~/backups, the last 7 kept. When off-machine backups
are on (`backup offsite`), the same snapshot goes to the owner's bucket through restic (encrypted,
only changes uploaded, thinned to 3 latest/7 daily/5 weekly/12 monthly, pruned Sundays). A failed
upload fails the run, but the local file is still written. Until they're on, each run posts a quiet
Timeline card recommending them; set up and troubleshooting: skills/backup/SKILL.md.
