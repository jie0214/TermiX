//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa
#include "window_appearance_darwin.h"
*/
import "C"

const nativeWindowCornerRadius = 9

func configureNativeWindowAppearance() {
	C.TermixApplyNativeWindowCornerRadius(C.double(nativeWindowCornerRadius))
}
