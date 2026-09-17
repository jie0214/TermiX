#!/usr/bin/env bash
# 將 Wails App 複本正式簽署、公證並封裝；任一步驟失敗皆不產生可發佈 ZIP。
# 用法：bash scripts/macos-release.sh --check
#       bash scripts/macos-release.sh build/bin/TermiX.app dist/TermiX-1.8.1-macos.zip
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR=""
cleanup() { if [[ -n "$WORK_DIR" ]]; then rm -rf -- "$WORK_DIR"; fi; }
trap cleanup EXIT
fail() { printf '錯誤：%s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == Darwin ]] || fail 'macOS 簽署與公證必須在 Mac 執行。'
[[ "${APPLE_TEAM_ID:-}" =~ ^[A-Z0-9]{10}$ ]] || fail '請設定有效的 APPLE_TEAM_ID。'
for tool in security codesign xcrun ditto lipo file python3 spctl; do
  command -v "$tool" >/dev/null || fail "缺少工具：$tool"
done

KEYCHAIN_ARGS=()
if [[ -n "${MACOS_SIGNING_KEYCHAIN:-}" ]]; then
  KEYCHAIN_ARGS=(--keychain "$MACOS_SIGNING_KEYCHAIN")
  identities="$(security find-identity -v -p codesigning "$MACOS_SIGNING_KEYCHAIN")"
else
  identities="$(security find-identity -v -p codesigning)"
fi
# 只接受同一 Team 的有效 Developer ID Application；不接受開發憑證或 ad hoc 簽署。
IDENTITY="$(printf '%s\n' "$identities" | python3 -c '
import os, re, sys
team = os.environ["APPLE_TEAM_ID"]
requested = os.environ.get("MACOS_SIGNING_IDENTITY", "")
matches = []
for line in sys.stdin:
    match = re.search(r"\b([A-Fa-f0-9]{40})\s+\"(Developer ID Application: [^\"]+)\"", line)
    if not match:
        continue
    fingerprint, name = match.groups()
    if name.endswith("(" + team + ")") and (not requested or requested.lower() == fingerprint.lower() or requested == name):
        matches.append(fingerprint)
if len(matches) != 1:
    sys.exit("錯誤：需要唯一且有效、附帶私鑰的 Developer ID Application 憑證；多張時請設定 MACOS_SIGNING_IDENTITY。")
print(matches[0])
')"
printf '已找到 Team %s 的 Developer ID Application 憑證。\n' "$APPLE_TEAM_ID"

if [[ "${1:-}" == --check ]]; then exit 0; fi
[[ $# == 2 ]] || fail '用法：macos-release.sh <App 路徑> <輸出 ZIP 路徑>'
[[ -n "${MACOS_NOTARY_PROFILE:-}" ]] || fail '請先用 notarytool store-credentials 建立 MACOS_NOTARY_PROFILE。'
APP_PATH="$1"
OUTPUT_PATH="$2"
[[ -d "$APP_PATH/Contents/MacOS" ]] || fail '找不到完整的 macOS App。'
[[ "$OUTPUT_PATH" == *.zip ]] || fail '輸出檔案必須使用 .zip 副檔名。'
[[ ! -e "$OUTPUT_PATH" ]] || fail '輸出檔案已存在，請改用新的輸出路徑。'

# 正式識別碼以 Info.plist 範本為準，避免腳本和 App 使用不同識別碼。
metadata="$(python3 - "$APP_PATH/Contents/Info.plist" "$ROOT/build/darwin/Info.plist" <<'PY'
import os, plistlib, re, sys
with open(sys.argv[1], "rb") as source:
    info = plistlib.load(source, fmt=plistlib.FMT_XML)
with open(sys.argv[2]) as source:
    match = re.search(r"<key>CFBundleIdentifier</key>\s*<string>([^<]+)</string>", source.read())
expected = match.group(1) if match else ""
if not expected or "{{" in expected or expected.startswith("com.wails.") or info.get("CFBundleIdentifier") != expected:
    sys.exit("錯誤：App 識別碼未設定為正式 Bundle ID，或與專案設定不符。")
executable = info.get("CFBundleExecutable", "")
version = info.get("CFBundleShortVersionString", "")
if not re.fullmatch(r"[A-Za-z0-9_-]+", executable) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
    sys.exit("錯誤：App 執行檔名稱或版本號無效。")
if os.environ.get("VERSION") and version != os.environ["VERSION"]:
    sys.exit("錯誤：App 版本與發佈版本不符。")
print(executable + "\t" + version)
PY
)"
IFS=$'\t' read -r EXECUTABLE APP_VERSION <<< "$metadata"
architectures="$(lipo -archs "$APP_PATH/Contents/MacOS/$EXECUTABLE")"
[[ " $architectures " == *' arm64 '* && " $architectures " == *' x86_64 '* ]] || fail '正式 macOS 套件必須包含 arm64 與 x86_64。'

LOG_DIR="${MACOS_NOTARY_LOG_DIR:-$ROOT/build/notarization}"
mkdir -p "$LOG_DIR" "$(dirname "$OUTPUT_PATH")"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/termix-sign.XXXXXX")"
STAGED_APP="$WORK_DIR/TermiX.app"
ditto "$APP_PATH" "$STAGED_APP"

# 先簽署內層 Mach-O，再簽署巢狀 bundle 與外層 App；簽署不用 --deep。
# 目前 Wails 不需要額外的 Hardened Runtime 例外，也不沿用開發用 entitlements。
while IFS= read -r -d '' code; do
  if [[ "$(file -b "$code")" == *Mach-O* ]]; then
    codesign --force --sign "$IDENTITY" --timestamp --options runtime "${KEYCHAIN_ARGS[@]}" "$code"
  fi
done < <(find "$STAGED_APP/Contents" -type f -print0)
while IFS= read -r -d '' bundle; do
  codesign --force --sign "$IDENTITY" --timestamp --options runtime "${KEYCHAIN_ARGS[@]}" "$bundle"
done < <(find "$STAGED_APP/Contents" -depth -type d \( -name '*.framework' -o -name '*.app' -o -name '*.xpc' -o -name '*.appex' -o -name '*.bundle' \) -print0)
codesign --force --sign "$IDENTITY" --timestamp --options runtime "${KEYCHAIN_ARGS[@]}" "$STAGED_APP"
codesign --verify --deep --strict --verbose=2 "$STAGED_APP"
signature="$(codesign -dv --verbose=4 "$STAGED_APP" 2>&1)"
[[ "$signature" == *"TeamIdentifier=$APPLE_TEAM_ID"* && "$signature" == *'Authority=Developer ID Application:'* && "$signature" == *'(runtime)'* ]] || fail '簽署身分、Team ID 或 Hardened Runtime 驗證失敗。'

ditto -c -k --keepParent "$STAGED_APP" "$WORK_DIR/submission.zip"
NOTARY_ARGS=(--keychain-profile "$MACOS_NOTARY_PROFILE" "${KEYCHAIN_ARGS[@]}")
RESULT_PATH="$LOG_DIR/submission-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
if ! xcrun notarytool submit "$WORK_DIR/submission.zip" "${NOTARY_ARGS[@]}" --wait --timeout 30m --output-format json > "$RESULT_PATH"; then
  fail "公證提交或等待失敗，停止封裝。回應紀錄：$RESULT_PATH"
fi
status="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status", ""))' "$RESULT_PATH")"
if [[ "$status" != Accepted ]]; then
  submission_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id", ""))' "$RESULT_PATH")"
  if [[ -n "$submission_id" ]]; then
    xcrun notarytool log "$submission_id" "${NOTARY_ARGS[@]}" "${RESULT_PATH%.json}-details.json" || true
  fi
  fail "公證未通過（${status}），停止封裝。紀錄：$RESULT_PATH"
fi
xcrun stapler staple "$STAGED_APP"
xcrun stapler validate "$STAGED_APP"
codesign --verify --deep --strict --verbose=2 "$STAGED_APP"
spctl --assess --type execute --verbose=2 "$STAGED_APP"

# ZIP 不能直接附加票證，必須在 App 附加成功後重新封裝。
ditto -c -k --keepParent "$STAGED_APP" "$WORK_DIR/release.zip"
mv "$WORK_DIR/release.zip" "$OUTPUT_PATH"
printf '正式簽署、公證及 Gatekeeper 驗證通過：%s（%s）\n' "$OUTPUT_PATH" "$APP_VERSION"
