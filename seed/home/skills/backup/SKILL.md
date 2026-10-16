---
name: backup
description: Set up, check and restore off-machine backups (an encrypted restic copy of every nightly backup in the owner's own Google Cloud Storage, S3, R2, B2 or Azure bucket). Use when the owner asks to back up off this machine / to the cloud / to GCS or S3, presses "Set up" under Settings → Backups or on the Timeline card, when an off-machine backup fails, or when restoring a machine from the bucket.
---

# Off-machine backups

`backup` (the nightly-backup job, 03:30) writes one file to `~/backups/` and keeps the last 7.
Those copies sit on the same disk as everything else. Off-machine backups send each night's
backup to a bucket the owner owns, through **restic**: everything is encrypted on this machine
with the backup passphrase, only what changed is uploaded, and old snapshots are thinned to
3 latest + 7 daily + 5 weekly + 12 monthly (pruned Sundays). The weekly **backup-check** job
test-restores both copies.

It's opt-in. Settings → Backups shows its state; until it's on, each backup posts a quiet
Timeline card (`backup:offsite`) recommending it.

## Commands

    backup offsite [--json]           status: repository, last run
    backup offsite init <repository>  connect (creates the restic repository if it's new), saves it in desk.json
    backup offsite off                stop sending (the bucket keeps what's there)
    backup                            a backup now, local and off-machine
    backup snapshots                  what's in the bucket
    backup verify --offsite           check the bucket and test-restore its latest snapshot
    backup check                      what the weekly job runs: both verifies
    restore --offsite <repository> [snapshot]   rebuild this machine from the bucket

Credentials are keys named `BACKUP_*` (Keys page): `backup` maps them to what restic reads, so
they never collide with other keys the owner has for the same cloud.

| Provider | Repository | Keys |
|---|---|---|
| Google Cloud Storage | `gs:<bucket>:/springroll` | `BACKUP_GCS_CREDENTIALS` (the service account's JSON key; paste the whole file) |
| Amazon S3 | `s3:s3.<region>.amazonaws.com/<bucket>/springroll` | `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY`, `BACKUP_AWS_DEFAULT_REGION` |
| Cloudflare R2 | `s3:https://<account-id>.r2.cloudflarestorage.com/<bucket>/springroll` | the same three, region `auto` |
| Backblaze B2 | `b2:<bucket>:springroll` | `BACKUP_B2_ACCOUNT_ID`, `BACKUP_B2_ACCOUNT_KEY` |
| Azure Blob | `azure:<container>:/springroll` | `BACKUP_AZURE_ACCOUNT_NAME`, `BACKUP_AZURE_ACCOUNT_KEY` |

## Walking the owner through it

Keep it to a few short messages; do everything you can yourself.

1. **Provider.** Ask which they use, or suggest one: Google Cloud if they already have a
   project, otherwise Cloudflare R2 (no download fees) or B2 (cheapest). A few GB costs cents a month.
2. **Passphrase.** `wc -c < ~/.config/springroll/backup-passphrase`. Restic encrypts the whole
   off-machine copy with it, so without it the bucket is unreadable. If it's short (under ~20
   characters) or the owner may not have it written down, offer a new one:
   `(umask 077; openssl rand -base64 24 > ~/.config/springroll/backup-passphrase)` before `init`
   (local backups from before keep needing the old one until they rotate out, 7 days). Then ask
   them to open **Keys → Backup passphrase → Show** and put it in their password manager. Don't
   print it in the chat. Don't finish until they say it's saved.
3. **A bucket and a key that only reaches that bucket**, with deleted data kept for 30 days, so
   an agent on this machine (which has the key) can't destroy the backups for good. Steps per
   provider below. Ask for the key with `secret request <NAME> "…"`; never have it pasted in chat.
4. **Connect and run**: `backup offsite init <repository>`, then `backup` (the first upload
   is the whole backup, ~100 MB; later ones are the changes), then `backup verify --offsite`.
   Tell the owner it's on and what it costs roughly; `show settings`.

### Google Cloud Storage

Two ways; ask which they prefer.

**They click, you do the rest** (no Google sign-in on this machine). In console.cloud.google.com,
in the project they choose:
1. Cloud Storage → Buckets → Create: a name (`<something>-springroll-backup`), a region near
   them, Standard class, "Enforce public access prevention" on, and under data protection
   **soft delete: 30 days**.
2. IAM → Service accounts → Create `springroll-backup` (no project roles).
3. The bucket → Permissions → Grant access: that service account, role **Storage Object Admin**
   (on the bucket only).
4. The service account → Keys → Add key → JSON. It downloads a file.
5. Save it in Springroll: you run `secret request BACKUP_GCS_CREDENTIALS "The JSON key file for
   springroll-backup (paste the whole file)"` and they paste it on the card.

**You do it with gcloud** (they sign in once, you sign out after):
install the Google Cloud CLI (`sudo apt-get install -y google-cloud-cli` after adding Google's
apt repo, or the tarball from cloud.google.com/sdk), start `gcloud auth login --no-launch-browser`
in a terminal session the owner opens in Terminal, and they finish the sign-in there. Then:

    P=<project>; B=<bucket>; SA=springroll-backup@$P.iam.gserviceaccount.com
    gcloud storage buckets create gs://$B --project $P --location <region> --default-storage-class STANDARD \
      --uniform-bucket-level-access --public-access-prevention --soft-delete-duration 30d
    gcloud iam service-accounts create springroll-backup --project $P --display-name "Springroll backups"
    gcloud storage buckets add-iam-policy-binding gs://$B --member serviceAccount:$SA --role roles/storage.objectAdmin
    gcloud iam service-accounts keys create /dev/stdout --iam-account $SA 2>/dev/null \
      | secret set BACKUP_GCS_CREDENTIALS "Service account key for gs://$B (off-machine backups)"
    gcloud auth revoke --all

An organization policy may block key creation (`iam.disableServiceAccountKeyCreation`); then the
owner (or their admin) has to allow it for the project.

Why Object Admin: restic deletes its lock files and prunes old data, so it needs delete. Soft
delete keeps anything deleted for 30 days, and the key can't shorten that (it has no bucket
permissions), so the worst a bad agent can do is recoverable from the console.

### S3

A bucket with versioning on and a lifecycle rule expiring noncurrent versions after 30 days. An
IAM user whose only policy allows `s3:ListBucket` on the bucket and `s3:GetObject`,
`s3:PutObject`, `s3:DeleteObject` on `<bucket>/*`: no `DeleteObjectVersion`, so a delete only
hides data. Its access key → the three `BACKUP_AWS_*` keys.

### R2

Dashboard → R2 → Create bucket; Manage API tokens → Create: **Object Read & Write**, only that
bucket. The token's Access Key ID and Secret → `BACKUP_AWS_ACCESS_KEY_ID` /
`BACKUP_AWS_SECRET_ACCESS_KEY`, region `auto`; the account id is in the endpoint URL. R2 has
no soft delete, so tell the owner a key leak could delete the copies; GCS, S3 or B2 protect better.

### B2

Create a private bucket with lifecycle "keep prior versions for 30 days"; an application key
for that bucket only → `BACKUP_B2_ACCOUNT_ID` (keyID) and `BACKUP_B2_ACCOUNT_KEY`.

## When it fails

`backup offsite` shows the last error (also in `~/data/backup/offsite.json`; the nightly-backup
run's output has the rest). Usual causes: the key was revoked or lacks a permission (403), the
bucket name or repository is wrong, the passphrase changed (restic: "wrong password"; put the old
one back, or `restic key passwd` with both), a stale lock (`backup` already runs `restic unlock`).
The local backup still happened; fix the off-machine part and run `backup` again.

## Restoring a machine

On a fresh machine (after `install.sh`): put the bucket key where restic finds it (e.g.
`export GOOGLE_APPLICATION_CREDENTIALS=key.json` or `AWS_ACCESS_KEY_ID=…`), then
`restore --offsite <repository>`. It asks for the passphrase (or reads
`SPRINGROLL_BACKUP_PASSPHRASE`), restores ~/home, ~/data and the keys, and restarts Springroll.
`backup snapshots` (from a machine that's connected) lists the snapshots to pick an older one.
