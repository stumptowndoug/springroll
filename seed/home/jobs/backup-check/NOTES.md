# Backup check

Runs `backup check` every Sunday at 05:00: restores the newest local backup into a temp folder
(clones the repo bundle, integrity-checks every database, decrypts the secrets) and, when
off-machine backups are on, checks 5% of the bucket's data with restic and test-restores its
latest snapshot the same way. A backup counts only once it restores. Failures land under
"Needs you"; `skills/backup/SKILL.md` has the usual causes.
