//go:build darwin && cgo

package mobilecloud

import "testing"

func TestUnsignedBuildDoesNotAccessCloudKit(t *testing.T) {
	if got := Publish(`{"version":"termix.mobile-settings.v1","sourceId":"test","hosts":[]}`); got != "not_configured" {
		t.Fatalf("未簽章測試程式應安全停用 CloudKit，收到 %s", got)
	}
}
