#!/usr/bin/env bash
# CI 專用：只在臨時鑰匙圈匯入簽署資料，成功或失敗都移除。
set +x
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail() { printf '錯誤：%s\n' "$*" >&2; exit 1; }
for name in MACOS_CERTIFICATE_P12_BASE64 MACOS_CERTIFICATE_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID SPARKLE_PRIVATE_KEY; do
  [[ -n "${!name:-}" ]] || fail "GitHub Actions 尚未設定 ${name}，停止 macOS 發佈。"
done
[[ "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || fail 'APPLE_TEAM_ID 必須是 10 碼英文大寫字母或數字。'
[[ "${1:-}" != --check ]] || exit 0
[[ "${GITHUB_ACTIONS:-}" == true && -d "${RUNNER_TEMP:-}" ]] || fail '此腳本僅限 GitHub Actions；本機請使用 macos-release.sh。'
[[ $# == 2 ]] || fail '用法：macos-ci-release.sh <App 路徑> <輸出 ZIP 路徑>'
umask 077
SIGNING_DIR="$(mktemp -d "$RUNNER_TEMP/termix-signing.XXXXXX")"
export MACOS_SIGNING_KEYCHAIN="$SIGNING_DIR/signing.keychain-db"
export MACOS_NOTARY_PROFILE=termix-ci-notary
ORIGINAL_KEYCHAINS=()
while IFS= read -r keychain; do
  ORIGINAL_KEYCHAINS+=("$keychain")
done < <(security list-keychains -d user | python3 -c 'import shlex,sys; print("\n".join(shlex.split(sys.stdin.read())))')
cleanup() {
  security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
  security delete-keychain "$MACOS_SIGNING_KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf -- "$SIGNING_DIR"
}
trap cleanup EXIT
python3 - "$SIGNING_DIR/certificate.p12" <<'PY'
import base64, os, sys
with open(sys.argv[1], "wb") as output:
    output.write(base64.b64decode("".join(os.environ["MACOS_CERTIFICATE_P12_BASE64"].split()), validate=True))
PY
keychain_password="$(openssl rand -hex 32)"
security create-keychain -p "$keychain_password" "$MACOS_SIGNING_KEYCHAIN"
security set-keychain-settings -lut 21600 "$MACOS_SIGNING_KEYCHAIN"
security unlock-keychain -p "$keychain_password" "$MACOS_SIGNING_KEYCHAIN"
# codesign 的身分解析仍依賴搜尋清單，指定 --keychain 並不足以註冊新鑰匙圈。
security list-keychains -d user -s "$MACOS_SIGNING_KEYCHAIN" "${ORIGINAL_KEYCHAINS[@]}"
security import "$SIGNING_DIR/certificate.p12" -k "$MACOS_SIGNING_KEYCHAIN" -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$MACOS_SIGNING_KEYCHAIN" >/dev/null
xcrun notarytool store-credentials "$MACOS_NOTARY_PROFILE" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --keychain "$MACOS_SIGNING_KEYCHAIN" >/dev/null
rm -f "$SIGNING_DIR/certificate.p12"
unset MACOS_CERTIFICATE_P12_BASE64 MACOS_CERTIFICATE_PASSWORD APPLE_APP_SPECIFIC_PASSWORD keychain_password
bash "$ROOT/scripts/macos-release.sh" "$@"

bash "$ROOT/scripts/macos-dmg.sh" "$2" "${2%.zip}.dmg"
bash "$ROOT/scripts/macos-appcast.sh" "$2" "$(dirname "$2")/appcast.xml"
