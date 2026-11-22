import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cli_updates', Path(__file__).with_name('cli.py'))
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)

class UpdatesTest(unittest.TestCase):
    def test_release_age_and_latest_tag_bound(self):
        meta = {'dist-tags': {'latest': '1.2.0'}, 'time': {
            '1.0.0': '2026-01-01T00:00:00Z',
            '1.1.0': '2026-01-05T00:00:00Z',
            '1.2.0': '2026-01-09T00:00:00Z',
            '2.0.0': '2026-01-01T00:00:00Z',
            '1.3.0-beta.1': '2026-01-01T00:00:00Z'}}
        now = cli.dt.datetime(2026, 1, 10, tzinfo=cli.dt.timezone.utc).timestamp()
        self.assertEqual(cli.ready_release(meta, now), '1.1.0')

    def test_failed_start_never_switches(self):
        meta = {'dist-tags': {'latest': '1.1.0'}, 'time': {'1.1.0': '2020-01-01T00:00:00Z'}}
        def command(argv, *args):
            if argv[0] == 'npm' and argv[1] == 'view':
                return cli.json.dumps(meta)
            if argv[-1] == '--help':
                raise RuntimeError('startup failed')
            return ''
        with tempfile.TemporaryDirectory() as d, patch.object(cli, 'BASE', Path(d)), \
             patch.object(cli.shutil, 'which', return_value='/old/tool'), \
             patch.object(cli, 'version', side_effect=['1.0.0', '1.1.0']), \
             patch.object(cli, 'run', side_effect=command), patch.object(cli, 'switch') as switch:
            with self.assertRaisesRegex(RuntimeError, 'startup failed'):
                cli.npm_tool('tool', 'package', True)
            switch.assert_not_called()

    def test_launcher_preserves_arguments_and_version_path(self):
        with tempfile.TemporaryDirectory() as d, patch.object(cli, 'BIN', Path(d)):
            entry = Path(d) / 'version with spaces' / 'tool'
            entry.parent.mkdir()
            entry.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
            entry.chmod(0o755)
            cli.switch('tool', entry)
            self.assertEqual(cli.run([Path(d) / 'tool', 'two words', 'literal $HOME']),
                             'two words\nliteral $HOME')

if __name__ == '__main__':
    unittest.main()
