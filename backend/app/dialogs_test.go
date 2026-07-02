package app

import "testing"

func TestNormalizeYAMLFilename(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: "kubernetes-resource.yaml"},
		{name: "without extension", input: "termix-pod", want: "termix-pod.yaml"},
		{name: "yaml", input: "deployment.yaml", want: "deployment.yaml"},
		{name: "yml uppercase", input: "service.YML", want: "service.YML"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeYAMLFilename(test.input); got != test.want {
				t.Fatalf("normalizeYAMLFilename(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestHasYAMLExtension(t *testing.T) {
	if !hasYAMLExtension("resource.yaml") || !hasYAMLExtension("resource.YML") || hasYAMLExtension("resource.json") {
		t.Fatal("hasYAMLExtension() 未正確辨識 YAML 副檔名")
	}
}
