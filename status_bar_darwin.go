//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
#include "status_bar_darwin.h"
*/
import "C"

import (
	"context"
	"encoding/json"
	"sync"
	"time"
	"unsafe"

	termixapp "github.com/jie0214/TermiX/backend/app"
)

var nativeStatusActions struct {
	sync.RWMutex
	handle func(string, string)
}

//export TermixStatusBarDisconnect
func TermixStatusBarDisconnect(kind, identifier *C.char) {
	// AppKit 傳入的字串僅在回呼期間有效，先複製再交給背景執行。
	action, id := C.GoString(kind), C.GoString(identifier)
	nativeStatusActions.RLock()
	handle := nativeStatusActions.handle
	nativeStatusActions.RUnlock()
	if handle != nil {
		go handle(action, id)
	}
}

func startNativeStatusBar(parent context.Context, app *termixapp.App) func() {
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	refresh := make(chan struct{}, 1)
	nativeStatusActions.Lock()
	nativeStatusActions.handle = func(kind, id string) {
		if ctx.Err() != nil || id == "" {
			return
		}
		switch kind {
		case "ssh":
			app.CloseTerminalSession(id)
		case "forward":
			if err := app.StopKubernetesPodPortForward(termixapp.KubernetesPodPortForwardStopRequest{ID: id}); err != nil && ctx.Err() == nil {
				message := C.CString(err.Error())
				C.TermixStatusBarShowError(message)
				C.free(unsafe.Pointer(message))
			}
		default:
			return
		}
		select {
		case refresh <- struct{}{}:
		default:
		}
	}
	nativeStatusActions.Unlock()
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		previous := ""
		for {
			data, err := json.Marshal(termixapp.NativeStatusBarSnapshot(app))
			if err == nil && string(data) != previous {
				previous = string(data)
				value := C.CString(previous)
				C.TermixUpdateStatusBar(value)
				C.free(unsafe.Pointer(value))
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-refresh:
			}
		}
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			cancel()
			nativeStatusActions.Lock()
			nativeStatusActions.handle = nil
			nativeStatusActions.Unlock()
			<-done
			C.TermixRemoveStatusBar()
		})
	}
}
