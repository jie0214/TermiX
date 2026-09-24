#!/usr/bin/env python3
"""正式發佈前核對已簽署 App 的 CloudKit 容器、環境與簽章。"""
import argparse
import plistlib
import subprocess
from pathlib import Path


def validate(info, entitlements):
    container = info.get('TermixCloudKitContainer')
    if (not isinstance(container, str) or not container.startswith('iCloud.')
            or container not in entitlements.get('com.apple.developer.icloud-container-identifiers', [])
            or 'CloudKit' not in entitlements.get('com.apple.developer.icloud-services', [])
            or entitlements.get('com.apple.developer.icloud-container-environment') != 'Production'
            or not entitlements.get('com.apple.developer.team-identifier')):
        raise ValueError('正式 App 缺少 CloudKit 容器、Production 環境或團隊簽章')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', type=Path)
    args = parser.parse_args()
    info_path = args.app / ('Contents/Info.plist' if (args.app / 'Contents').is_dir() else 'Info.plist')
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(args.app)], check=True)
    entitlements = plistlib.loads(subprocess.check_output(['codesign', '-d', '--entitlements', ':-', str(args.app)], stderr=subprocess.DEVNULL))
    raw = info_path.read_bytes()
    info = plistlib.loads(raw, fmt=plistlib.FMT_BINARY if raw.startswith(b'bplist') else plistlib.FMT_XML)
    validate(info, entitlements)
    print('PASS：正式 App 的 CloudKit 容器、Production 與簽章檢查通過。')
