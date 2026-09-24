#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../native/ssh"
export PATH="$(go env GOPATH)/bin:$PATH"
go install golang.org/x/mobile/cmd/gobind
go tool gomobile init
case "${1:-ios}" in
 ios) go tool gomobile bind -target=ios,iossimulator -iosversion=16.4 -o ../../modules/termix-ssh/ios/TermixSSH.xcframework . ;;
 android) mkdir -p ../../modules/termix-ssh/android/libs; go tool gomobile bind -target=android -androidapi=26 -javapkg=com.termix -o ../../modules/termix-ssh/android/libs/termixssh.aar .; unzip -o ../../modules/termix-ssh/android/libs/termixssh.aar classes.jar 'jni/*' -d ../../modules/termix-ssh/android/libs ;;
 *) echo '請使用 ios 或 android' >&2; exit 1 ;;
esac
