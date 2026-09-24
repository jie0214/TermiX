"""驗證正式 App 的權限閘門，不呼叫 Apple 服務。"""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('check', Path(__file__).parents[1] / 'check-apple-cloud.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class ReleaseCloudTests(unittest.TestCase):
    def test_missing_or_mismatched_entitlements_rejected(self):
        info = {'TermixCloudKitContainer': 'iCloud.test.termix'}
        entitlements = {'com.apple.developer.icloud-container-identifiers': ['iCloud.test.termix'],
                        'com.apple.developer.icloud-services': ['CloudKit'],
                        'com.apple.developer.icloud-container-environment': 'Production',
                        'com.apple.developer.team-identifier': 'ABCDEFGHIJ'}
        check.validate(info, entitlements)
        for key in entitlements:
            with self.subTest(missing=key), self.assertRaises(ValueError):
                check.validate(info, {k:v for k,v in entitlements.items() if k != key})
        for key, value in [('com.apple.developer.icloud-container-identifiers', ['iCloud.other']),
                           ('com.apple.developer.icloud-container-environment', 'Development'),
                           ('com.apple.developer.icloud-services', ['CloudDocuments'])]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                check.validate(info, {**entitlements, key:value})


if __name__ == '__main__':
    unittest.main()
