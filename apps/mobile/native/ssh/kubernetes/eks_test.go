package mobilekubernetes

import (
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const testAWSLogin = `{"accessKeyId":"AKIA1234567890ABCDEF","secretAccessKey":"test-only-secret-not-real-1234567890123456","sessionToken":""}`

func eksConfig(server, ca string) string {
	return strings.Replace(config(server, ca, "qa-token"), "    token: qa-token", `    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: /usr/local/bin/aws
      args: [--region, ap-northeast-1, eks, get-token, --cluster-name, qa-cluster, --output, json]
      env: [{name: AWS_PROFILE, value: qa-profile}]`, 1)
}
func TestEKSImportAndSignedRequest(t *testing.T) {
	var authorization string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"items":[]}`)
	}))
	defer server.Close()
	raw := eksConfig(server.URL, base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})))
	info, err := Inspect(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(info, `"profile":"qa-profile"`) || strings.Contains(info, "secret") {
		t.Fatal("匯入摘要錯誤")
	}
	if _, err = ListPods(raw, "default"); err == nil || err.Error() != "aws_login_required" {
		t.Fatal("不可未簽章就查詢")
	}
	resolved, err := AuthorizeEKS(raw, testAWSLogin)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(resolved, "exec:") || strings.Contains(resolved, "test-only-secret") {
		t.Fatal("暫時設定夾帶 exec 或金鑰")
	}
	if _, err = ListPods(resolved, "default"); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(authorization, "Bearer k8s-aws-v1.") {
		t.Fatal("未使用 EKS token")
	}
	encoded := strings.TrimPrefix(authorization, "Bearer k8s-aws-v1.")
	data, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	endpoint, err := url.Parse(string(data))
	if err != nil {
		t.Fatal(err)
	}
	query := endpoint.Query()
	if endpoint.Host != "sts.ap-northeast-1.amazonaws.com" || query.Get("Action") != "GetCallerIdentity" || query.Get("X-Amz-Expires") != "60" || query.Get("X-Amz-SignedHeaders") != "host;x-k8s-aws-id" || query.Get("X-Amz-Signature") == "" {
		t.Fatal("簽章參數錯誤")
	}
}
func TestEKSExecWhitelist(t *testing.T) {
	base := eksConfig("https://example.com", "")
	for _, raw := range []string{
		strings.Replace(base, "/usr/local/bin/aws", "sh", 1),
		strings.Replace(base, "get-token", "update-kubeconfig", 1),
		strings.Replace(base, "--output, json", "--endpoint-url, https://evil.example", 1),
		strings.Replace(base, "--output, json", "--no-verify-ssl", 1),
		strings.Replace(base, "AWS_PROFILE", "AWS_SECRET_ACCESS_KEY", 1),
		strings.Replace(base, "ap-northeast-1", "bad.example/", 1),
		strings.Replace(base, "--output, json", "--region, us-east-1", 1),
	} {
		if _, err := Inspect(raw); err == nil {
			t.Fatal("接受未支援的 exec 設定")
		}
	}
}
func TestEKSTokenRefreshAndClusterBinding(t *testing.T) {
	selected, err := selectConfig(eksConfig("https://example.com", ""))
	if err != nil {
		t.Fatal(err)
	}
	credentials, err := readAWSLogin(testAWSLogin)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 24, 0, 0, 0, 0, time.UTC)
	first, _ := signEKSToken(selected.EKS, credentials, now)
	later, _ := signEKSToken(selected.EKS, credentials, now.Add(16*time.Minute))
	if first == later {
		t.Fatal("未更新已到期 token")
	}
	selected.EKS.ClusterName = "other-cluster"
	other, _ := signEKSToken(selected.EKS, credentials, now)
	if other == first {
		t.Fatal("簽章未綁定叢集")
	}
	credentials.SessionToken = "test-session"
	temporary, _ := signEKSToken(selected.EKS, credentials, now)
	decoded, _ := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(temporary, "k8s-aws-v1."))
	parsed, _ := url.Parse(string(decoded))
	if parsed.Query().Get("X-Amz-Security-Token") != "test-session" {
		t.Fatal("遺失暫時憑證")
	}
}

type awsHTTP func(*http.Request) (*http.Response, error)

func (f awsHTTP) Do(r *http.Request) (*http.Response, error) { return f(r) }
func TestAWSLoginValidationAndSafeErrors(t *testing.T) {
	success := awsHTTP(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "sts.ap-northeast-1.amazonaws.com" || !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
			t.Fatal("未簽章 AWS 驗證")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/xml"}}, Body: io.NopCloser(strings.NewReader(`<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:iam::123456789012:user/test</Arn><Account>123456789012</Account><UserId>test</UserId></GetCallerIdentityResult></GetCallerIdentityResponse>`))}, nil
	})
	result, err := loginAWSWithHTTP("ap-northeast-1", testAWSLogin, success)
	if err != nil {
		t.Fatal(err)
	}
	var identity map[string]string
	if json.Unmarshal([]byte(result), &identity) != nil || identity["account"] != "123456789012" || strings.Contains(result, "secret") {
		t.Fatal("身份摘要錯誤")
	}
	failure := awsHTTP(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 403, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`<ErrorResponse><Error><Code>ExpiredToken</Code><Message>secret-server-detail</Message></Error></ErrorResponse>`))}, nil
	})
	if _, err = loginAWSWithHTTP("ap-northeast-1", testAWSLogin, failure); err == nil || err.Error() != "aws_credentials_expired" {
		t.Fatalf("錯誤未安全分類：%v", err)
	}
	if _, err = readAWSLogin(strings.Replace(testAWSLogin, "AKIA", "ASIA", 1)); err == nil || err.Error() != "aws_session_token_required" {
		t.Fatal("暫時憑證應要求 Session Token")
	}
}

func TestAWSProfileScopeAndRoleWhitelist(t *testing.T) {
	first, err := AWSProfileKey("ap-northeast-1", "work")
	if err != nil {
		t.Fatal(err)
	}
	same, _ := AWSProfileKey("us-east-1", "work")
	other, _ := AWSProfileKey("ap-northeast-1", "other")
	china, _ := AWSProfileKey("cn-north-1", "work")
	if first != same || first == other || first == china {
		t.Fatal("profile 應跨同分區 Region 共用，跨名稱或分區隔離")
	}
	raw := strings.Replace(eksConfig("https://example.com", ""), "--output, json", "--role-arn, arn:aws:iam::123456789012:role/eks-reader", 1)
	selected, err := selectConfig(raw)
	if err != nil || selected.EKS.RoleARN != "arn:aws:iam::123456789012:role/eks-reader" {
		t.Fatal("未辨識標準 Role")
	}
	if _, err = Inspect(strings.Replace(raw, "arn:aws:iam:", "arn:aws-cn:iam:", 1)); err == nil {
		t.Fatal("不可跨 AWS 分區 AssumeRole")
	}
}
