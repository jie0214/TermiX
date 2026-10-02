#!/usr/bin/env bash
# 發佈前檢查已知依賴漏洞與原生匯入清理邊界。
set -euo pipefail
cd "$(dirname "$0")/.."
npm audit --audit-level=moderate
(cd native/ssh && go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...)
if [[ "$(uname -s)" == Darwin ]]; then
  test_dir="$(mktemp -d)"
  trap 'rm -rf "$test_dir"' EXIT
  swiftc modules/termix-ssh/ios/SensitiveImports.swift tests/sensitive-imports.swift -o "$test_dir/import-test"
  "$test_dir/import-test"
fi
