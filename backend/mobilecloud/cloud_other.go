//go:build !darwin || !cgo

package mobilecloud

func Publish(payload string) string { return "unsupported" }

func Capability() string { return "unsupported" }
