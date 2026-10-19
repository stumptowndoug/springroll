"""Exercise backup/recovery with real git, SQLite and encrypted restic data, offline.

Run: python3 tests/backup-offsite.test.py
The restic shim substitutes a local repository for GCS; systemctl is a no-op.
"""

import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1] / "seed" / "home"
RESTIC = shutil.which("restic")


class BackupRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="backup-test-")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.home = self.base / "owner"
        self.config = self.home / "home" / "desk.json"
        self.config.parent.mkdir(parents=True)
        self.settings = {"backup": {"host": "fixture", "offsite": {
            "repository": "gs:fixture:/springroll", "http2": False, "connections": 30,
        }}}
        self.write_settings()
        conf = self.home / ".config" / "springroll"
        conf.mkdir(parents=True)
        password = conf / "backup-passphrase"
        password.write_text("fixture passphrase, no real credentials\n")
        self.calls = self.base / "calls.jsonl"
        self.env = {"HOME": str(self.home), "PATH": os.environ["PATH"], "LANG": "C.UTF-8",
                    "RESTIC_PASSWORD_FILE": str(password), "GODEBUG": "fixture=1",
                    "RESTIC_CACHE_DIR": str(self.base / "cache")}
        stage = self.base / "springroll"
        (stage / "data").mkdir(parents=True)
        with sqlite3.connect(stage / "data" / "fixture.db") as db:
            db.execute("create table facts (value text)")
            db.execute("insert into facts values ('restored data')")
        secrets = stage / "secrets" / ".config" / "springroll"
        secrets.mkdir(parents=True)
        (secrets / "secrets.env").write_text("FIXTURE=yes\n")
        (stage / "manifest.json").write_text(json.dumps({
            "host": "fixture", "created": "2026-10-18T00:00:00Z", "agents": [],
        }))
        self.run_cmd("git", "init", "-q", str(self.config.parent))
        self.run_cmd("git", "-C", str(self.config.parent), "add", ".")
        self.run_cmd("git", "-C", str(self.config.parent), "-c", "user.name=Fixture",
                     "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
                     "commit", "-qm", "Fixture")
        self.run_cmd("git", "-C", str(self.config.parent), "bundle", "create",
                     str(stage / "home.bundle"), "--all")
        plain = self.base / "secrets.tar.gz"
        with tarfile.open(plain, "w:gz") as archive:
            archive.add(stage / "secrets", arcname=".")
        self.run_cmd("openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000",
                     "-salt", "-pass", f"file:{password}", "-in", str(plain),
                     "-out", str(stage / "secrets.tar.gz.enc"))
        backups = self.home / "backups"
        backups.mkdir()
        with tarfile.open(backups / "springroll-fixture.tar.gz", "w:gz") as archive:
            archive.add(stage, arcname="springroll-fixture")
        repository = self.base / "repository"
        self.run_cmd(RESTIC, "-r", str(repository), "init")
        self.run_cmd(RESTIC, "-r", str(repository), "backup", "--host", "fixture", str(stage))
        shim = self.base / "bin"
        shim.mkdir()
        (shim / "restic").write_text(
            "#!/usr/bin/env python3\nimport json, os, sys\n"
            f"with open({str(self.calls)!r}, 'a') as f:\n"
            "    f.write(json.dumps({'args': sys.argv[1:], 'debug': os.getenv('GODEBUG')})+'\\n')\n"
            "args=sys.argv[1:]\n"
            "if args[:1] == ['-o']: args=args[2:]\n"
            "if args[:1] == ['-r']: args=args[2:]\n"
            f"os.execv({RESTIC!r}, [{RESTIC!r}, '-r', {str(repository)!r}, *args])\n"
        )
        (shim / "systemctl").write_text("#!/bin/sh\nexit 0\n")
        for path in shim.iterdir():
            path.chmod(0o755)
        self.env["PATH"] = str(shim) + os.pathsep + self.env["PATH"]

    def write_settings(self):
        self.config.write_text(json.dumps(self.settings))

    def run_cmd(self, *args, check=True):
        return subprocess.run(args, env=self.env, text=True, capture_output=True,
                              check=check, timeout=60)

    def recorded(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def test_check_and_full_recovery(self):
        result = self.run_cmd(str(ROOT / "bin" / "backup"), "check")
        self.assertEqual(result.stdout.count("✓ data: 1 databases pass"), 2)
        self.assertIn("✓ secrets decrypt", result.stdout)
        self.assertIn("Restoring the latest snapshot for fixture", result.stdout)
        self.run_cmd(str(ROOT / "bin" / "restore"), "--offsite", "gs:fixture:/springroll")
        with sqlite3.connect(self.home / "data" / "fixture.db") as db:
            self.assertEqual(db.execute("select value from facts").fetchone()[0], "restored data")
        self.assertEqual((self.home / ".config/springroll/secrets.env").read_text(), "FIXTURE=yes\n")
        calls = self.recorded()
        self.assertTrue(all(call["args"][:2] == ["-o", "gs.connections=30"] for call in calls))
        self.assertTrue(all(call["debug"] == "fixture=1,http2client=0" for call in calls))
        restores = [call for call in calls if "restore" in call["args"]]
        self.assertEqual(len(restores), 2)
        self.assertTrue(all("--verify" in call["args"] for call in restores))

    def test_defaults_provider_scope_and_invalid_connections(self):
        offsite = self.settings["backup"]["offsite"]
        del offsite["http2"], offsite["connections"]
        self.write_settings()
        self.run_cmd(str(ROOT / "bin" / "backup"), "snapshots")
        self.assertEqual(self.recorded()[-1]["args"][:2], ["-o", "gs.connections=5"])
        self.assertEqual(self.recorded()[-1]["debug"], "fixture=1")
        offsite["connections"] = 0
        self.write_settings()
        result = self.run_cmd(str(ROOT / "bin" / "backup"), "snapshots", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be a positive integer", result.stderr)
        self.assertEqual(len(self.recorded()), 1)
        offsite["repository"] = "s3:fixture/springroll"
        offsite["http2"] = False
        self.write_settings()
        self.run_cmd(str(ROOT / "bin" / "backup"), "snapshots")
        self.assertNotIn("-o", self.recorded()[-1]["args"])
        self.assertEqual(self.recorded()[-1]["debug"], "fixture=1")


if __name__ == "__main__":
    unittest.main()
