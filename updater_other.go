//go:build !darwin

package main

import termixapp "github.com/jie0214/TermiX/backend/app"

func startNativeUpdater(app *termixapp.App) {}

func finishNativeQuit() bool { return false }
