#!/usr/bin/env bash
# 從已公證 ZIP 製作拖曳安裝磁碟映像，再簽署、公證及附加票證。
set -euo pipefail
[[ $# == 2 && "$2" == *.dmg && ! -e "$2" ]] || { echo '用法：macos-dmg.sh <已公證 ZIP> <新的 DMG 路徑>' >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${APPLE_TEAM_ID:?}" "${MACOS_NOTARY_PROFILE:?}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/termix-dmg.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
mkdir -p "$WORK/volume"
ditto -x -k "$1" "$WORK/volume"
APP="$WORK/volume/TermiX.app"
codesign --verify --deep --strict "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute "$APP"
# 身分取自已驗證的 App，避免磁碟映像誤用不同 Team 的憑證。
SIGNATURE="$(codesign -dv --verbose=4 "$APP" 2>&1)"
printf '%s\n' "$SIGNATURE" | grep -Fx "TeamIdentifier=$APPLE_TEAM_ID" >/dev/null
IDENTITY="$(printf '%s\n' "$SIGNATURE" | sed -n 's/^Authority=\(Developer ID Application:.*\)$/\1/p')"
[[ -n "$IDENTITY" ]] || exit 1
KEYCHAIN_ARGS=()
[[ -z "${MACOS_SIGNING_KEYCHAIN:-}" ]] || KEYCHAIN_ARGS=(--keychain "$MACOS_SIGNING_KEYCHAIN")
ln -s /Applications "$WORK/volume/Applications"
hdiutil create -quiet -volname TermiX -srcfolder "$WORK/volume" -format UDZO -ov "$WORK/TermiX.dmg"
codesign --force --sign "$IDENTITY" --timestamp "${KEYCHAIN_ARGS[@]}" "$WORK/TermiX.dmg"
LOG_DIR="${MACOS_NOTARY_LOG_DIR:-$ROOT/build/notarization}"
mkdir -p "$LOG_DIR"
RESULT="$LOG_DIR/dmg-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
xcrun notarytool submit "$WORK/TermiX.dmg" --keychain-profile "$MACOS_NOTARY_PROFILE" "${KEYCHAIN_ARGS[@]}" --wait --timeout 30m --output-format json > "$RESULT"
python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("status")=="Accepted" else "DMG 公證未通過，停止發佈。")' "$RESULT"
xcrun stapler staple "$WORK/TermiX.dmg"
xcrun stapler validate "$WORK/TermiX.dmg"
codesign --verify --strict "$WORK/TermiX.dmg"
spctl --assess --type open --context context:primary-signature "$WORK/TermiX.dmg"
mkdir -p "$(dirname "$2")"
mv "$WORK/TermiX.dmg" "$2"
