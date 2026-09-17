#!/usr/bin/env bash
# 使用 Sparkle 官方工具產生及簽署更新資訊；私鑰僅由鑰匙圈或 CI 標準輸入提供。
set +x
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ $# == 2 && -f "$1" && "$1" == *.zip && ! -e "$2" ]] || { echo '用法：macos-appcast.sh <已公證 ZIP> <新的 appcast.xml 路徑>' >&2; exit 1; }
: "${VERSION:?請設定正式版本 VERSION}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
WORK="$(mktemp -d "${TMPDIR:-/tmp}/termix-appcast.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
cp "$1" "$WORK/$(basename "$1")"
ARGS=(--download-url-prefix "https://github.com/jie0214/TermiX/releases/download/v${VERSION}/" --link "https://github.com/jie0214/TermiX/releases/tag/v${VERSION}" --maximum-deltas 0 "$WORK")
if [[ -n "${SPARKLE_PRIVATE_KEY:-}" ]]; then
  printf '%s' "$SPARKLE_PRIVATE_KEY" | "$ROOT/build/sparkle/bin/generate_appcast" --ed-key-file - "${ARGS[@]}"
else
  "$ROOT/build/sparkle/bin/generate_appcast" --account io.github.jie0214.termix "${ARGS[@]}"
fi
python3 "$ROOT/scripts/verify-appcast.py" "$WORK/appcast.xml" "$1" "$VERSION"
mkdir -p "$(dirname "$2")"
mv "$WORK/appcast.xml" "$2"
