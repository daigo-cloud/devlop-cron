"""Run the workflow's actual shell against a fake curl; never call production.

Run: python -m unittest discover -s tests -v
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest


WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/access-log-prune.yml"
CANARY = "INTERNAL_DB_PASSWORD_DO_NOT_LOG"
SECRET = "TEST_BEARER_SECRET_DO_NOT_LOG"


class AccessLogPruneTest(unittest.TestCase):
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
            import json, os, pathlib, sys
            args = sys.argv[1:]
            pathlib.Path(os.environ["MOCK_CALLED"]).write_text(json.dumps(args))
            assert args[args.index("-X") + 1] == "POST"
            assert args[args.index("--connect-timeout") + 1] == "10"
            assert args[args.index("--max-time") + 1] == "120"
            assert args[args.index("-H") + 1] == "Authorization: Bearer " + os.environ["CRON_SECRET"]
            assert args[-1] == "https://portal.esco-duct.com/api/admin/usage/prune"
            pathlib.Path(args[args.index("-o") + 1]).write_text(os.environ["MOCK_BODY"])
            print(os.environ["MOCK_STATUS"], end="")
            if os.environ.get("MOCK_TRANSPORT") == "1":
                print(os.environ["MOCK_BODY"], file=sys.stderr)
                sys.exit(28)
        '''))
        curl.chmod(0o755)

    def run_workflow(self, body, status="200", secret=SECRET, transport=False):
        env = dict(os.environ, PATH=f"{self.root}:{os.environ['PATH']}",
                   TMPDIR=str(self.root), CRON_SECRET=secret, MOCK_BODY=body,
                   MOCK_STATUS=status, MOCK_TRANSPORT="1" if transport else "0",
                   MOCK_CALLED=str(self.root / "called.json"))
        result = subprocess.run(["bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", self.script],
                                env=env, text=True, capture_output=True, timeout=10)
        output = result.stdout + result.stderr
        self.assertNotIn(CANARY, output)
        self.assertNotIn(SECRET, output)
        # Response files must be removed even when validation/transport fails.
        self.assertEqual(sorted(p.name for p in self.root.iterdir()),
                         ["called.json", "curl"] if secret.strip() else ["curl"])
        return result, output

    def test_success_including_zero(self):
        for count in (0, 17):
            with self.subTest(count=count):
                result, output = self.run_workflow(json.dumps({"ok": True, "deleted": count, "error": CANARY}))
                self.assertEqual(result.returncode, 0, output)
                self.assertIn(f"deleted={count}", output)

    def test_http_errors_do_not_expose_body(self):
        for status in ("401", "500", "302"):
            with self.subTest(status=status):
                result, output = self.run_workflow(json.dumps({"ok": False, "error": CANARY}), status)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"HTTP status: {status}", output)

    def test_rejects_invalid_success(self):
        bodies = ["", CANARY, "<html>" + CANARY, "{}", "null", "[]",
                  '{"ok":false,"deleted":2}', '{"ok":true}',
                  '{"ok":true,"deleted":-1}', '{"ok":true,"deleted":1.5}',
                  '{"ok":true,"deleted":true}',
                  json.dumps({"ok": True, "deleted": CANARY}),
                  json.dumps({"deleted": CANARY}) + '\n{"ok":true,"deleted":1}']
        for body in bodies:
            with self.subTest(body=body):
                result, output = self.run_workflow(body)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("completed", output)

    def test_transport_failure_hides_stderr(self):
        result, output = self.run_workflow(CANARY, status="000", transport=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("transport error", output)

    def test_blank_secret_never_sends_request(self):
        for secret in ("", " \t\n"):
            with self.subTest(secret=secret):
                result, output = self.run_workflow(CANARY, secret=secret)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("not configured", output)
                self.assertFalse((self.root / "called.json").exists())


if __name__ == "__main__":
    unittest.main()
