package kubernetes

import (
	"reflect"
	"testing"
)

func TestPodShellCommand設定互動提示字元(t *testing.T) {
	got := podShellCommand("general-api-5488-5f86465d58-f8hxw")
	want := []string{
		"/bin/sh",
		"-c",
		"PS1=\"$(id -un)@general-api-5488-5f86465d58-f8hxw:\\$PWD# \"; export PS1; exec /bin/sh -i",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Pod Shell 指令不符預期：got %#v, want %#v", got, want)
	}
}
