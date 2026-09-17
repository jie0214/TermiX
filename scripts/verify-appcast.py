"""核對更新資訊所指向的實際套件、版本與簽章欄位，避免發版資訊不一致。"""
import base64
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def verify(feed, archive, version):
    ns = "{http://www.andymatuschak.org/xml-namespaces/sparkle}"
    root = ET.parse(feed).getroot()
    items = root.findall("./channel/item")
    if len(items) != 1:
        raise ValueError("更新資訊必須只包含此次發佈版本")
    item = items[0]
    enclosure = item.find("enclosure")
    if enclosure is None:
        raise ValueError("缺少更新套件")
    actual = item.findtext(ns + "version") or enclosure.get(ns + "version")
    if actual != version:
        raise ValueError("更新資訊版本與發佈版本不符")
    expected = f"https://github.com/jie0214/TermiX/releases/download/v{version}/{Path(archive).name}"
    if enclosure.get("url") != expected or int(enclosure.get("length", "0")) != Path(archive).stat().st_size:
        raise ValueError("更新網址或套件大小不符")
    if len(base64.b64decode(enclosure.get(ns + "edSignature", ""), validate=True)) != 64:
        raise ValueError("缺少有效格式的更新簽章")
    # 密碼學驗證由 Sparkle generate_appcast 與用戶端負責；這裡只核對發佈資料。


if __name__ == "__main__":
    verify(*sys.argv[1:])
