#!/usr/bin/env bash
# 在已啟動的 iOS 模擬器執行原生 Scene 遮罩回歸，不使用真實帳號。
set -euo pipefail
cd "$(dirname "$0")/.."
device="${1:?請提供已啟動的模擬器 UDID}"
test_dir="$(mktemp -d)"
bundle=com.jie0214.termix.privacytest
trap 'xcrun simctl uninstall "$device" "$bundle" >/dev/null 2>&1 || true; rm -rf "$test_dir"' EXIT
app="$test_dir/PrivacyTest.app"
mkdir -p "$app"
python3 - "$app/Info.plist" "$bundle" <<'PY'
import plistlib,sys
with open(sys.argv[1],'wb') as f:
    plistlib.dump({'CFBundleIdentifier':sys.argv[2], 'CFBundleName':'PrivacyTest', 'CFBundleExecutable':'PrivacyTest', 'CFBundlePackageType':'APPL', 'CFBundleVersion':'1', 'CFBundleShortVersionString':'1.0', 'MinimumOSVersion':'16.4', 'LSRequiresIPhoneOS':True, 'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False}},f)
PY
xcrun --sdk iphonesimulator swiftc -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" -target "$(uname -m)-apple-ios16.4-simulator" modules/termix-ssh/ios/PrivacyShield.swift tests/privacy-shield.swift -o "$app/PrivacyTest"
codesign --force --sign - "$app" >/dev/null 2>&1
xcrun simctl install "$device" "$app"
xcrun simctl launch "$device" "$bundle"
data="$(xcrun simctl get_app_container "$device" "$bundle" data)"
for ((i=0; i<20; i++)); do
  if [[ -f "$data/Documents/privacy-result.txt" ]]; then
    [[ "$(cat "$data/Documents/privacy-result.txt")" == PASS ]]
    echo 'PASS：原生失去前景時遮蔽、重複通知不疊加、恢復前景時移除'
    exit 0
  fi
  sleep 1
done
echo 'FAIL：未取得原生遮罩測試結果' >&2
exit 1
