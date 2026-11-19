"""Run the workflow's actual shell against a fake curl; never call production.

Run: python -m unittest discover -s tests -v
Set GENBA_WORKFLOW=<path> to run against another copy (e.g. the pre-fix workflow).
"""
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest


WORKFLOW = Path(os.environ.get("GENBA_WORKFLOW") or
                Path(__file__).resolve().parents[1] / ".github/workflows/genba-intake-retention.yml")


class GenbaRetentionTest(unittest.TestCase):
    def setUp(self):
        source = WORKFLOW.read_text()
        block = source.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0]
        self.script = textwrap.dedent(block)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        curl = self.root / "curl"
        curl.write_text(textwrap.dedent('''\
            #!/usr/bin/env python3
            import os, pathlib, sys
            args = sys.argv[1:]
            pathlib.Path(args[args.index("-o") + 1]).write_text(os.environ["MOCK_BODY"])
            if os.environ.get("MOCK_TRANSPORT") == "1":
                sys.exit(28)
            print(os.environ["MOCK_STATUS"], end="")
        '''))
        curl.chmod(0o755)

    def run_workflow(self, body, status="200", transport=False):
        env = dict(os.environ, PATH=f"{self.root}:{os.environ['PATH']}", TMPDIR=str(self.root),
                   CRON_SECRET="dummy", MOCK_BODY=body, MOCK_STATUS=status,
                   MOCK_TRANSPORT="1" if transport else "0")
        r = subprocess.run(["bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", self.script],
                           env=env, text=True, capture_output=True, timeout=10)
        return r, r.stdout + r.stderr

    def test_success(self):
        r, out = self.run_workflow('{"ok":true,"dryRun":false,"requests":2,"deleted":5,"failed":0,"remaining":0}')
        self.assertEqual(r.returncode, 0, out)
        self.assertIn("completed", out)

    def test_zero_targets_is_success(self):
        r, out = self.run_workflow('{"ok":true,"dryRun":false,"requests":0,"deleted":0,"failed":0,"remaining":0}')
        self.assertEqual(r.returncode, 0, out)

    def test_call_failure(self):
        for kw in ({"transport": True, "status": "000"}, {"status": "500"}, {"status": "401"}):
            with self.subTest(kw=kw):
                r, out = self.run_workflow('{"ok":false,"error":"retention failed"}', **kw)
                self.assertNotEqual(r.returncode, 0, out)
                self.assertNotIn("completed", out)

    def test_failed_count_positive(self):
        r, out = self.run_workflow('{"ok":true,"dryRun":false,"requests":2,"deleted":3,"failed":1,"remaining":1}')
        self.assertNotEqual(r.returncode, 0, out)
        self.assertNotIn("completed", out)

    def test_unexpected_200_bodies_fail_closed(self):
        for body in ('{"ok":false,"failed":0}', '{"ok":true}', '{"ok":true,"failed":"0"}', "{}", "null"):
            with self.subTest(body=body):
                r, out = self.run_workflow(body)
                self.assertNotEqual(r.returncode, 0, out)
                self.assertNotIn("completed", out)


if __name__ == "__main__":
    unittest.main()
