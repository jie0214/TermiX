//go:build !darwin

package main

import (
	"context"
	termixapp "github.com/jie0214/TermiX/backend/app"
)

func startNativeStatusBar(context.Context, *termixapp.App) func() { return func() {} }
