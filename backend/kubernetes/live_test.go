package kubernetes

import (
	"context"
	"testing"
	"time"

	"github.com/jie0214/TermiX/shared/dto"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	ktesting "k8s.io/client-go/testing"
)

func testLiveResource(section string) liveResource {
	for _, resource := range liveResources {
		if resource.section == section {
			return resource
		}
	}
	panic(section)
}

func livePod(uid, version string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1", "kind": "Pod", "metadata": map[string]interface{}{"name": "api", "namespace": "default", "uid": uid, "resourceVersion": version},
		"spec":   map[string]interface{}{"containers": []interface{}{map[string]interface{}{"name": "app", "image": "test"}}},
		"status": map[string]interface{}{"phase": "Running"},
	}}
}

func receiveLive(t *testing.T, changes <-chan LiveChange, kind string) LiveChange {
	t.Helper()
	timer := time.NewTimer(4 * time.Second)
	defer timer.Stop()
	for {
		select {
		case change := <-changes:
			if change.Type == kind {
				return change
			}
		case <-timer.C:
			t.Fatalf("未收到 %s 事件", kind)
			return LiveChange{}
		}
	}
}

func TestLiveWatchResumesVersionAndRelistsExpired(t *testing.T) {
	resource := testLiveResource("pods")
	client := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{resource.gvr: "PodList"})
	watches := make(chan *watch.RaceFreeFakeWatcher, 4)
	versions := make(chan string, 4)
	lists := 0
	client.PrependReactor("list", "pods", func(ktesting.Action) (bool, runtime.Object, error) {
		lists++
		item := livePod("original", "10")
		if lists > 1 {
			item = livePod("replacement", "30")
		}
		list := &unstructured.UnstructuredList{Items: []unstructured.Unstructured{*item}}
		list.SetResourceVersion(item.GetResourceVersion())
		return true, list, nil
	})
	client.PrependWatchReactor("pods", func(action ktesting.Action) (bool, watch.Interface, error) {
		versions <- action.(ktesting.WatchAction).GetWatchRestrictions().ResourceVersion
		stream := watch.NewRaceFreeFake()
		watches <- stream
		return true, stream, nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	changes := make(chan LiveChange, 32)
	done := make(chan struct{})
	go func() {
		watchResource(ctx, client.Resource(resource.gvr), resource, func(change LiveChange) { changes <- change })
		close(done)
	}()
	initial := receiveLive(t, changes, "reset")
	if initial.Items[0]["uid"] != "original" {
		t.Fatalf("錯誤初始資料：%v", initial)
	}
	stream := <-watches
	if version := <-versions; version != "10" {
		t.Fatalf("Watch 未接續 List 版本：%s", version)
	}
	stream.Modify(livePod("original", "11"))
	modified := receiveLive(t, changes, "MODIFIED")
	if modified.Item["resourceVersion"] != "11" {
		t.Fatalf("修改版本錯誤：%v", modified)
	}
	stream.Stop()
	stream = <-watches
	if version := <-versions; version != "11" {
		t.Fatalf("重連未接續最後版本：%s", version)
	}
	stream.Error(&metav1.Status{Status: "Failure", Reason: metav1.StatusReasonExpired, Code: 410})
	reset := receiveLive(t, changes, "reset")
	if reset.Items[0]["uid"] != "replacement" {
		t.Fatalf("410 後未重建快照：%v", reset)
	}
	stream = <-watches
	if version := <-versions; version != "30" {
		t.Fatalf("410 後版本錯誤：%s", version)
	}
	stream.Delete(livePod("replacement", "31"))
	if change := receiveLive(t, changes, "DELETED"); change.Item["uid"] != "replacement" {
		t.Fatalf("刪除未包含 UID：%v", change)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("取消後 Watch 未結束")
	}
}

func TestLiveSecretOnlyProjectsSummary(t *testing.T) {
	secret := corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "credential", Namespace: "default"}, Data: map[string][]byte{"password": []byte("do-not-send")}}
	obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&secret)
	if err != nil {
		t.Fatal(err)
	}
	item, err := testLiveResource("secrets").project(unstructured.Unstructured{Object: obj})
	if err != nil {
		t.Fatal(err)
	}
	if item["data"] != nil || item["stringData"] != nil || item["password"] != nil {
		t.Fatalf("Secret 內容外洩：%v", item)
	}
	if item["dataKeys"] != float64(1) {
		t.Fatalf("摘要未保留 key 數量：%v", item)
	}
}

func TestLiveSubscriptionIsolatedByConnectionAndStream(t *testing.T) {
	kinds := make(map[schema.GroupVersionResource]string)
	for _, resource := range liveResources {
		kinds[resource.gvr] = resource.gvr.Resource + "List"
	}
	client := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), kinds)
	service := NewService(nil)
	service.activeSession = &dto.KubernetesSession{ConnectedAt: "current"}
	service.activeClients = &clusterClients{dynamic: client}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := service.StartLiveUpdates(ctx, "old", "old", func(LiveBatch) {}); err == nil {
		t.Fatal("接受過期連線")
	}
	if err := service.StartLiveUpdates(ctx, "current", "first", func(LiveBatch) {}); err != nil {
		t.Fatal(err)
	}
	if err := service.StartLiveUpdates(ctx, "current", "second", func(LiveBatch) {}); err != nil {
		t.Fatal(err)
	}
	service.StopLiveUpdates("first")
	if service.liveStreamID != "second" {
		t.Fatal("舊訂閱取消了新訂閱")
	}
	service.Disconnect()
	if service.liveCancel != nil || service.liveStreamID != "" {
		t.Fatal("斷線未清除監看")
	}
}
