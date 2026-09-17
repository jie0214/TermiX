"""以隔離的假 Apple 工具驗證發佈閘門，不存取憑證或連線 Apple。"""

import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
MOCK = r'''
import json, os, pathlib, shutil, sys, zipfile
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["CALLS"], "a") as log:
    log.write(json.dumps([name] + args) + "\n")
failure = os.environ.get("FAIL_AT", "")
if failure and " ".join([name] + args).startswith(failure):
    sys.exit(1)
if name == "uname":
    print("Darwin")
elif name == "security" and args[0] == "find-identity":
    print('1) ' + 'A' * 40 + ' "' + os.environ.get("IDENTITY", "Developer ID Application: Test (ABCDEFGHIJ)") + '"')
elif name == "lipo":
    print(os.environ.get("ARCHS", "arm64 x86_64"))
elif name == "file":
    print("Mach-O 64-bit executable" if pathlib.Path(args[-1]).name == "TermiX" else "data")
elif name == "codesign" and args[0] == "-dv":
    print("Authority=Developer ID Application: Test (ABCDEFGHIJ)\nTeamIdentifier=ABCDEFGHIJ\nflags=0x10000(runtime)")
elif name == "ditto":
    source, target = map(pathlib.Path, args[-2:])
    if "-c" in args:
        with zipfile.ZipFile(target, "w") as archive:
            for child in source.rglob("*"):
                if child.is_file():
                    archive.write(child, child.relative_to(source.parent))
    else:
        shutil.copytree(source, target)
elif name == "xcrun":
    if args[:2] == ["notarytool", "submit"]:
        print(json.dumps({"status": os.environ.get("NOTARY_STATUS", "Accepted"), "id": "test-id"}))
    elif args[:2] == ["notarytool", "log"]:
        pathlib.Path(args[-1]).write_text("{}")
    elif args[:2] == ["stapler", "staple"]:
        (pathlib.Path(args[-1]) / "ticket").write_text("accepted")
    elif args[:2] == ["stapler", "validate"]:
        assert (pathlib.Path(args[-1]) / "ticket").exists()
'''


class MacOSReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="termix-release-test-")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.bin = self.work / "bin"
        self.bin.mkdir()
        for name in ("uname", "security", "codesign", "xcrun", "ditto", "lipo", "file", "spctl"):
            tool = self.bin / name
            tool.write_text("#!" + sys.executable + "\n" + MOCK)
            tool.chmod(0o755)
        self.app = self.work / "Original.app"
        (self.app / "Contents/MacOS").mkdir(parents=True)
        (self.app / "Contents/MacOS/TermiX").write_text("binary")
        self.plist = self.app / "Contents/Info.plist"
        self.info = {"CFBundleIdentifier": "io.github.jie0214.termix", "CFBundleExecutable": "TermiX", "CFBundleShortVersionString": "1.8.0"}
        self.plist.write_bytes(plistlib.dumps(self.info))
        self.output = self.work / "dist/release.zip"
        self.calls = self.work / "calls.jsonl"
        self.script_root = ROOT
        self.env = {key: value for key, value in os.environ.items() if not key.startswith(("MACOS_", "APPLE_", "SPARKLE_")) and key != "VERSION"}
        self.env.update(PATH=str(self.bin) + os.pathsep + os.environ["PATH"], APPLE_TEAM_ID="ABCDEFGHIJ", MACOS_NOTARY_PROFILE="test", MACOS_NOTARY_LOG_DIR=str(self.work / "logs"), TMPDIR=str(self.work), CALLS=str(self.calls))

    def run_release(self, script="macos-release.sh"):
        return subprocess.run(["bash", str(self.script_root / "scripts" / script), str(self.app), str(self.output)], env=self.env, capture_output=True, text=True)

    def commands(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def assert_rejected(self, **settings):
        self.env.update(settings)
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.work.glob("termix-sign.*")))

    def test_success_packages_ticket_and_preserves_original(self):
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.read("TermiX.app/ticket"), b"accepted")
        self.assertFalse((self.app / "ticket").exists())
        calls = self.commands()
        sign_calls = [call for call in calls if call[:2] == ["codesign", "--force"]]
        self.assertTrue(sign_calls[0][-1].endswith("Contents/MacOS/TermiX"))
        self.assertTrue(sign_calls[-1][-1].endswith("TermiX.app"))
        self.assertTrue(all("--deep" not in call for call in sign_calls))
        self.assertTrue(all("--timestamp" in call and "runtime" in call for call in sign_calls))
        self.assertFalse(list(self.work.glob("termix-sign.*")))

    def test_development_certificate_rejected(self):
        self.assert_rejected(IDENTITY="Apple Development: Test (ABCDEFGHIJ)")

    def test_wails_plist_without_xml_declaration(self):
        self.plist.write_bytes(plistlib.dumps(self.info).split(b"\n", 1)[1])
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.output.exists())

    def test_wrong_team_rejected(self):
        self.assert_rejected(IDENTITY="Developer ID Application: Test (OTHERTEAM1)")

    def test_missing_certificate_rejected(self):
        self.assert_rejected(IDENTITY="")

    def test_identity_selection_must_match(self):
        self.assert_rejected(MACOS_SIGNING_IDENTITY="B" * 40)

    def test_non_universal_rejected(self):
        self.assert_rejected(ARCHS="arm64")

    def test_wrong_bundle_identifier_rejected(self):
        self.info["CFBundleIdentifier"] = "com.wails.TermiX"
        self.plist.write_bytes(plistlib.dumps(self.info))
        self.assert_rejected()

    def test_wrong_version_rejected(self):
        self.assert_rejected(VERSION="1.9.0")

    def test_notarization_rejected(self):
        self.assert_rejected(NOTARY_STATUS="Invalid")
        self.assertTrue(any(call[:3] == ["xcrun", "notarytool", "log"] for call in self.commands()))
        self.assertFalse(any(call[:2] == ["xcrun", "stapler"] for call in self.commands()))

    def test_each_external_gate_failure_stops_release(self):
        for failure in ("codesign --force", "codesign --verify", "xcrun notarytool submit", "xcrun stapler staple", "xcrun stapler validate", "spctl --assess"):
            with self.subTest(failure=failure):
                self.assert_rejected(FAIL_AT=failure)

    def test_output_not_overwritten(self):
        self.output.parent.mkdir()
        self.output.write_bytes(b"existing release")
        self.assertNotEqual(self.run_release().returncode, 0)
        self.assertEqual(self.output.read_bytes(), b"existing release")

    def ci_settings(self):
        # CI 鑰匙圈生命週期測試隔離封裝工具，封裝另以原生整合測試驗證。
        self.script_root = self.work / "repo"
        (self.script_root / "scripts").mkdir(parents=True)
        (self.script_root / "build/darwin").mkdir(parents=True)
        shutil.copy(ROOT / "build/darwin/Info.plist", self.script_root / "build/darwin/Info.plist")
        for name in ("macos-ci-release.sh", "macos-release.sh"):
            shutil.copy(ROOT / "scripts" / name, self.script_root / "scripts" / name)
        for name in ("macos-dmg.sh", "macos-appcast.sh"):
            (self.script_root / "scripts" / name).write_text('set -eu\n[[ "${FAIL_PACKAGE:-}" != true ]]\n')
        self.env.update(SPARKLE_PRIVATE_KEY="test-key", GITHUB_ACTIONS="true", RUNNER_TEMP=str(self.work), MACOS_CERTIFICATE_P12_BASE64="dGVzdA==", MACOS_CERTIFICATE_PASSWORD="test-password", APPLE_ID="test@example.invalid", APPLE_APP_SPECIFIC_PASSWORD="test-app-password")

    def test_ci_missing_secrets_rejected(self):
        self.assertNotEqual(self.run_release("macos-ci-release.sh").returncode, 0)
        self.assertEqual(self.commands(), [])

    def test_ci_cleans_keychain_after_success(self):
        self.ci_settings()
        result = self.run_release("macos-ci-release.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any(call[:2] == ["security", "delete-keychain"] for call in self.commands()))
        self.assertFalse(list(self.work.glob("termix-signing.*")))

    def test_ci_cleans_keychain_after_packaging_failure(self):
        self.ci_settings()
        self.env["FAIL_PACKAGE"] = "true"
        result = self.run_release("macos-ci-release.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(any(call[:2] == ["security", "delete-keychain"] for call in self.commands()))
        self.assertFalse(list(self.work.glob("termix-signing.*")))

    def test_ci_cleans_keychain_after_import_failure(self):
        self.ci_settings()
        self.env["FAIL_AT"] = "security import"
        result = self.run_release("macos-ci-release.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.output.exists())
        self.assertTrue(any(call[:2] == ["security", "delete-keychain"] for call in self.commands()))
        self.assertFalse(list(self.work.glob("termix-signing.*")))


if __name__ == "__main__":
    unittest.main()
