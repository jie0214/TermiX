"""以簽章資料輸入／輸出邊界檢查容器與 Team，不呼叫 Apple 服務。"""
import datetime
import importlib.util
import plistlib
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("cloud", Path(__file__).parents[1] / "configure-macos-cloud.py")
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)


class CloudSigningTests(unittest.TestCase):
    def test_profile_matches_app_team_container_and_production(self):
        with tempfile.TemporaryDirectory() as temp:
            profile, info, output = [Path(temp) / name for name in ("profile.plist", "Info.plist", "entitlements.plist")]
            info.write_bytes(plistlib.dumps({"CFBundleIdentifier": "io.github.jie0214.termix"}).split(b"\n", 1)[1])
            entitlements = {"com.apple.application-identifier": "ABCDEFGHIJ.io.github.jie0214.termix",
                            "com.apple.developer.team-identifier": "ABCDEFGHIJ",
                            "com.apple.developer.icloud-container-identifiers": ["iCloud.test.termix"],
                            "com.apple.developer.icloud-services": ["CloudKit"],
                            "com.apple.developer.icloud-container-environment": "Production"}
            profile.write_bytes(plistlib.dumps({"ExpirationDate": datetime.datetime(2099, 1, 1), "TeamIdentifier": ["ABCDEFGHIJ"], "Entitlements": entitlements}))
            before = info.read_bytes()
            with self.assertRaises(ValueError):
                cloud.configure(profile, info, output, "iCloud.other", "ABCDEFGHIJ")
            self.assertEqual(info.read_bytes(), before)
            self.assertFalse(output.exists())
            cloud.configure(profile, info, output, "iCloud.test.termix", "ABCDEFGHIJ")
            self.assertEqual(plistlib.loads(info.read_bytes())["TermixCloudKitContainer"], "iCloud.test.termix")
            self.assertEqual(plistlib.loads(output.read_bytes()), entitlements)
            for services, allowed in [("*", True), (["*"], True), (["CloudDocuments"], False), ("CloudKitExtra", False)]:
                with self.subTest(services=services):
                    entitlements["com.apple.developer.icloud-services"] = services
                    profile.write_bytes(plistlib.dumps({"ExpirationDate": datetime.datetime(2099, 1, 1), "TeamIdentifier": ["ABCDEFGHIJ"], "Entitlements": entitlements}))
                    if allowed:
                        cloud.configure(profile, info, output, "iCloud.test.termix", "ABCDEFGHIJ")
                        self.assertEqual(plistlib.loads(output.read_bytes())["com.apple.developer.icloud-services"], ["CloudKit"])
                    else:
                        with self.assertRaises(ValueError):
                            cloud.configure(profile, info, output, "iCloud.test.termix", "ABCDEFGHIJ")



if __name__ == "__main__":
    unittest.main()
