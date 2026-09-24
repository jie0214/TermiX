package mobilekubernetes

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestPodListReportsLimitsWithoutTreatingRequestsAsCaps(t *testing.T) {
	cases := []struct {
		name, spec            string
		cpu, memory           float64
		cpuState, memoryState string
		containers            int
	}{
		{"完整上限", `{"containers":[{"name":"app","resources":{"limits":{"cpu":"500m","memory":"128Mi"}}},{"name":"sidecar","resources":{"limits":{"cpu":"250m","memory":"64Mi"}}}]}`, 750, 192, "set", "set", 2},
		{"部分未設定", `{"containers":[{"name":"app","resources":{"limits":{"cpu":"500m","memory":"128Mi"}}},{"name":"sidecar","resources":{"requests":{"cpu":"100m","memory":"32Mi"}}}]}`, 0, 0, "unset", "unset", 2},
		{"只設定requests", `{"containers":[{"name":"app","resources":{"requests":{"cpu":"100m","memory":"32Mi"}}}]}`, 0, 0, "unset", "unset", 1},
		{"Pod層級優先", `{"resources":{"limits":{"cpu":"2","memory":"1Gi"}},"containers":[{"name":"app"}]}`, 2000, 1024, "set", "set", 1},
		{"常駐sidecar", `{"containers":[{"name":"app","resources":{"limits":{"cpu":"500m","memory":"128Mi"}}}],"initContainers":[{"name":"init","resources":{"limits":{"cpu":"8","memory":"4Gi"}}},{"name":"sidecar","restartPolicy":"Always","resources":{"limits":{"cpu":"100m","memory":"32Mi"}}}]}`, 600, 160, "set", "set", 2},
		{"非法值", `{"containers":[{"name":"app","resources":{"limits":{"cpu":"invalid","memory":"-1"}}}]}`, 0, 0, "unknown", "unknown", 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte(`{"items":[{"metadata":{"name":"web","namespace":"dev"},"spec":` + c.spec + `}]}`))
			})
			result, err := ListPods(raw, "dev")
			if err != nil {
				t.Fatal(err)
			}
			var got struct {
				Items []struct {
					Limits podLimits `json:"limits"`
				} `json:"items"`
			}
			if json.Unmarshal([]byte(result), &got) != nil || len(got.Items) != 1 {
				t.Fatal("無效摘要")
			}
			limits := got.Items[0].Limits
			if limits.CPU.State != c.cpuState || limits.Memory.State != c.memoryState || len(limits.Containers) != c.containers {
				t.Fatal(result)
			}
			if c.cpuState == "set" {
				if limits.CPU.Value == nil || *limits.CPU.Value != c.cpu {
					t.Fatal(result)
				}
			} else if limits.CPU.Value != nil {
				t.Fatal("未知或未設定的 CPU 不可變成數字上限")
			}
			if c.memoryState == "set" {
				if limits.Memory.Value == nil || *limits.Memory.Value != c.memory {
					t.Fatal(result)
				}
			} else if limits.Memory.Value != nil {
				t.Fatal("未知或未設定的記憶體不可變成數字上限")
			}
		})
	}
}
