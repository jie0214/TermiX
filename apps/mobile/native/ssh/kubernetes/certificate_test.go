package mobilekubernetes

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func clientIdentity(t *testing.T, start, end time.Time) (string, string, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "mobile-user"}, NotBefore: start, NotAfter: end, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, IsCA: true, BasicConstraintsValid: true}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(certPEM)
	return base64.StdEncoding.EncodeToString(certPEM), base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})), roots
}
func certificateConfig(server, ca, cert, key string) string {
	return strings.Replace(config(server, ca, ""), "    token: \n", "    client-certificate-data: "+cert+"\n    client-key-data: "+key+"\n", 1)
}
func TestClientCertificateMutualTLS(t *testing.T) {
	cert, key, roots := clientIdentity(t, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS.PeerCertificates[0].Subject.CommonName != "mobile-user" || r.Header.Get("Authorization") != "" {
			t.Error("用戶端身分或驗證方式錯誤")
		}
		w.Write([]byte(`{"items":[]}`))
	}))
	server.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	defer server.Close()
	ca := base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}))
	raw := certificateConfig(server.URL, ca, cert, key)
	if _, err := Inspect(raw); err != nil {
		t.Fatal(err)
	}
	if _, err := ListPods(raw, "dev"); err != nil {
		t.Fatal(err)
	}
	otherCert, otherKey, _ := clientIdentity(t, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if _, err := ListPods(certificateConfig(server.URL, ca, otherCert, otherKey), "dev"); err == nil || err.Error() != "connection_failed" {
		t.Fatalf("不可信用戶端：%v", err)
	}
}
func TestRejectInvalidClientIdentity(t *testing.T) {
	now := time.Now()
	cert, key, _ := clientIdentity(t, now.Add(-time.Hour), now.Add(time.Hour))
	_, otherKey, _ := clientIdentity(t, now.Add(-time.Hour), now.Add(time.Hour))
	expired, expiredKey, _ := clientIdentity(t, now.Add(-2*time.Hour), now.Add(-time.Hour))
	future, futureKey, _ := clientIdentity(t, now.Add(time.Hour), now.Add(2*time.Hour))
	for _, tc := range []struct{ name, cert, key, code string }{
		{"缺私鑰", cert, "", "certificate_incomplete"}, {"缺憑證", "", key, "certificate_incomplete"},
		{"憑證格式", "invalid-base64", key, "certificate_invalid"}, {"私鑰格式", cert, "invalid-base64", "certificate_invalid"},
		{"不匹配", cert, otherKey, "certificate_invalid"}, {"過期", expired, expiredKey, "certificate_expired"}, {"尚未生效", future, futureKey, "certificate_not_yet_valid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Inspect(certificateConfig("https://localhost", "", tc.cert, tc.key))
			if err == nil || err.Error() != tc.code {
				t.Fatalf("%v", err)
			}
		})
	}
	raw := certificateConfig("https://localhost", "", cert, key)
	raw = strings.Replace(raw, "  user:\n", "  user:\n    token: secret\n", 1)
	if _, err := Inspect(raw); err == nil || err.Error() != "ambiguous_auth" {
		t.Fatalf("混合驗證：%v", err)
	}
}
