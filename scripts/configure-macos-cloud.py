#!/usr/bin/env python3
"""依已驗證的 provisioning profile 準備 CloudKit 簽章資料，不進行簽署或上傳。"""
import argparse
import datetime
import plistlib
import re
from pathlib import Path


def configure(profile_path, info_path, output_path, container, team):
    if not re.fullmatch(r"iCloud\.[A-Za-z0-9.-]+", container):
        raise ValueError("CloudKit 容器識別碼無效")
    profile = plistlib.loads(Path(profile_path).read_bytes())
    info_bytes = Path(info_path).read_bytes()
    info = plistlib.loads(info_bytes, fmt=plistlib.FMT_BINARY if info_bytes.startswith(b"bplist") else plistlib.FMT_XML)
    entitlements = profile.get("Entitlements", {})
    application = f"{team}.{info['CFBundleIdentifier']}"
    services = entitlements.get("com.apple.developer.icloud-services", [])
    # Apple 的 Developer ID 描述檔可使用萬用服務授權；App 仍僅簽入 CloudKit。
    cloud_allowed = services == "*" or (isinstance(services, list) and any(value in ("*", "CloudKit") for value in services))
    if (profile.get("ExpirationDate", datetime.datetime.min) <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            or team not in profile.get("TeamIdentifier", [])
            or entitlements.get("com.apple.application-identifier") != application
            or entitlements.get("com.apple.developer.team-identifier") != team
            or container not in entitlements.get("com.apple.developer.icloud-container-identifiers", [])
            or not cloud_allowed
            or entitlements.get("com.apple.developer.icloud-container-environment") != "Production"
            or entitlements.get("get-task-allow") or entitlements.get("com.apple.security.get-task-allow")):
        raise ValueError("描述檔的 Team、App、CloudKit 正式環境或有效期不符")
    selected = {"com.apple.application-identifier": application,
                "com.apple.developer.team-identifier": team,
                "com.apple.developer.icloud-container-identifiers": [container],
                "com.apple.developer.icloud-services": ["CloudKit"],
                "com.apple.developer.icloud-container-environment": "Production"}
    info["TermixCloudKitContainer"] = container
    Path(output_path).write_bytes(plistlib.dumps(selected))
    Path(info_path).write_bytes(plistlib.dumps(info))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile")
    parser.add_argument("info")
    parser.add_argument("output")
    parser.add_argument("container")
    parser.add_argument("team")
    args = parser.parse_args()
    configure(args.profile, args.info, args.output, args.container, args.team)
