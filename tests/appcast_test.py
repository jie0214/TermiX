"""驗證發版資訊拒絕錯誤版本、套件及簽章。"""
import base64
import importlib.util
from pathlib import Path
import tempfile
import sys
sys.dont_write_bytecode = True
import unittest

spec = importlib.util.spec_from_file_location('verify_appcast', Path(__file__).resolve().parents[1] / 'scripts/verify-appcast.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class AppcastTest(unittest.TestCase):
    def test_release_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            archive=Path(directory)/'TermiX-1.8.1-macos.zip'
            archive.write_bytes(b'archive')
            feed=Path(directory)/'appcast.xml'
            signature=base64.b64encode(bytes(64)).decode()
            xml=f'''<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item><sparkle:version>1.8.1</sparkle:version><enclosure url="https://github.com/jie0214/TermiX/releases/download/v1.8.1/{archive.name}" length="7" sparkle:edSignature="{signature}"/></item></channel></rss>'''
            feed.write_text(xml)
            module.verify(feed,archive,'1.8.1')
            for malformed in [xml.replace('length="7"','length="8"'),xml.replace('github.com','attacker.invalid'),xml.replace(signature,'bad'),xml.replace('1.8.1','1.8.2')]:
                with self.subTest(xml=malformed):
                    feed.write_text(malformed)
                    with self.assertRaises(ValueError): module.verify(feed,archive,'1.8.1')

if __name__ == '__main__': unittest.main()
