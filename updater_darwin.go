//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa
#include "updater_darwin.h"
#include <stdlib.h>
*/
import "C"
import (
	termixapp "github.com/jie0214/TermiX/backend/app"
	"sync"
	"sync/atomic"
	"unsafe"
)

var nativeUpdaterAvailable atomic.Bool

var updaterApp struct {
	sync.RWMutex
	app  *termixapp.App
	once sync.Once
}

func startNativeUpdater(app *termixapp.App) {
	updaterApp.once.Do(func() { updaterApp.Lock(); updaterApp.app = app; updaterApp.Unlock(); C.TermixStartUpdater() })
}

//export TermixUpdaterReady
func TermixUpdaterReady() {
	nativeUpdaterAvailable.Store(true)
	updaterApp.RLock()
	app := updaterApp.app
	updaterApp.RUnlock()
	termixapp.SetNativeUpdater(app, func() { C.TermixCheckUpdates() }, func() { C.TermixUpdateSettings() })
}

//export TermixMayInstallUpdate
func TermixMayInstallUpdate() C.int {
	updaterApp.RLock()
	app := updaterApp.app
	updaterApp.RUnlock()
	if app == nil {
		return 0
	}
	approved := termixapp.PrepareUpdateWithPrompts(app, func(message string) bool {
		value := C.CString(message)
		defer C.free(unsafe.Pointer(value))
		return C.TermixConfirmUpdate(value) != 0
	}, func() { C.TermixPendingUpdate() })
	if approved {
		return 1
	}
	return 0
}

// finishNativeQuit 讓 Sparkle 收到真正的 AppKit 結束通知，支援結束時安裝。
func finishNativeQuit() bool {
	if !nativeUpdaterAvailable.Load() {
		return false
	}
	C.TermixFinishQuit()
	return true
}

//export TermixUpdateAborted
func TermixUpdateAborted() {
	updaterApp.RLock()
	app := updaterApp.app
	updaterApp.RUnlock()
	if app != nil {
		termixapp.CancelPreparedClose(app)
	}
}
