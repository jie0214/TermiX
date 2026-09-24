#!/usr/bin/env bash
# 產生可供後續匯出／上傳的 iOS 封存；缺少正式同步權限即停止。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${APPLE_TEAM_ID:?請提供 Apple Developer Team ID}"
export TERMIX_APPLE_RELEASE=1
npx expo config --type public --json >/dev/null
npm run build:terminal
npm run build:ssh:ios
npx expo prebuild --platform ios --no-install
npx pod-install
archive_path="${TERMIX_IOS_ARCHIVE:-$PWD/dist/TermiX.xcarchive}"
xcodebuild -workspace ios/TermiX.xcworkspace -scheme TermiX -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$archive_path" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates archive
python3 ../../scripts/check-apple-cloud.py "$archive_path/Products/Applications/TermiX.app"
