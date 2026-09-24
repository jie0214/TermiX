//go:build darwin && cgo

package mobilecloud

/*
#cgo LDFLAGS: -framework Foundation -framework CloudKit -framework Security
#include <stdlib.h>
int termixCloudConfigured(void);
char *termixCloudPublish(const char *payload);
*/
import "C"
import "unsafe"

func Publish(payload string) string {
	input := C.CString(payload)
	defer C.free(unsafe.Pointer(input))
	output := C.termixCloudPublish(input)
	defer C.free(unsafe.Pointer(output))
	return C.GoString(output)
}

func Capability() string {
	if C.termixCloudConfigured() != 0 {
		return "available"
	}
	return "not_configured"
}
