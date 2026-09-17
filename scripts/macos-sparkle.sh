#!/usr/bin/env bash
# 固定官方版本與 SHA-256，將更新框架及公開設定嵌入待簽署 App。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/build/sparkle"
read -r SPARKLE_VERSION SPARKLE_SHA < <(python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); print(c["version"],c["sha256"])' "$ROOT/build/sparkle-config.json")
mkdir -p "$CACHE"
if [[ ! -f "$CACHE/Sparkle.tar.xz" ]] || [[ "$(shasum -a 256 "$CACHE/Sparkle.tar.xz" | cut -d ' ' -f 1)" != "$SPARKLE_SHA" ]]; then
  curl -fsSL --retry 3 "https://github.com/sparkle-project/Sparkle/releases/download/$SPARKLE_VERSION/Sparkle-$SPARKLE_VERSION.tar.xz" -o "$CACHE/Sparkle.tar.xz"
fi
[[ "$(shasum -a 256 "$CACHE/Sparkle.tar.xz" | cut -d ' ' -f 1)" == "$SPARKLE_SHA" ]] || { echo 'Sparkle SHA-256 不符，停止。' >&2; exit 1; }
# 重新解開已驗證的壓縮檔，避免使用曾被修改的快取 framework。
tar -xJf "$CACHE/Sparkle.tar.xz" -C "$CACHE"
[[ "${1:-}" != --prepare ]] || exit 0
[[ $# == 1 && -d "$1/Contents/MacOS" ]] || { echo '用法：macos-sparkle.sh <App 路徑> 或 --prepare' >&2; exit 1; }
APP="$1"
# Wails 的 clean 不會清掉所有舊框架；只替換此腳本管理的 Sparkle 目錄。
rm -rf -- "$APP/Contents/Frameworks/Sparkle.framework"
mkdir -p "$APP/Contents/Frameworks" "$APP/Contents/Resources"
cp "$CACHE/LICENSE" "$APP/Contents/Resources/Sparkle-LICENSE.txt"
ditto "$CACHE/Sparkle.framework" "$APP/Contents/Frameworks/Sparkle.framework"
# TermiX 未啟用 App Sandbox，不使用這兩項 XPC 服務。
rm -rf "$APP/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices"
rm -f "$APP/Contents/Frameworks/Sparkle.framework/XPCServices"
python3 - "$APP/Contents/Info.plist" "$ROOT/build/sparkle-config.json" <<'PY'
import json, plistlib, sys
path=sys.argv[1]
with open(path,'rb') as source: info=plistlib.load(source,fmt=plistlib.FMT_XML)
with open(sys.argv[2]) as source: config=json.load(source)
info.update(SUPublicEDKey=config['publicKey'], SUFeedURL=config['feedURL'], SUEnableAutomaticChecks=True, SUAutomaticallyUpdate=False, SUAllowsAutomaticUpdates=True, SUScheduledCheckInterval=86400, SURequireSignedFeed=True, SUVerifyUpdateBeforeExtraction=True, LSMinimumSystemVersion='11.0')
with open(path,'wb') as output: plistlib.dump(info,output)
PY
