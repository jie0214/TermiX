package mobilessh_test

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net"
	"testing"
	"time"

	mobile "github.com/jie0214/TermiX/mobile/ssh"
	"golang.org/x/crypto/ssh"
)

func startKey(t *testing.T, engine *mobile.Engine, port int, privateKey, passphrase, expectedKey string) {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"id": "test", "address": "127.0.0.1", "port": port, "username": "tester", "credentials": map[string]string{"type": "privateKey", "privateKey": privateKey, "passphrase": passphrase}, "expectedKey": expectedKey, "cols": 80, "rows": 24})
	if err := engine.Start(string(raw)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { engine.Disconnect("test") })
}
func TestPrivateKeyTerminalAfterTrust(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(key)
	block, _ := ssh.MarshalPrivateKey(key, "test-only")
	port, _, auths, _ := server(t, signer.PublicKey())
	engine := mobile.NewEngine()
	startKey(t, engine, port, string(pem.EncodeToMemory(block)), "", "")
	waitEvent(t, engine, "hostKey")
	if auths.Load() != 0 {
		t.Fatal("信任前不得進行公鑰認證")
	}
	if err := engine.Trust("test", true); err != nil {
		t.Fatal(err)
	}
	waitEvent(t, engine, "connected")
	if err := engine.Write("test", "private-key-ok\r"); err != nil {
		t.Fatal(err)
	}
	ev := waitEvent(t, engine, "data")
	data, _ := base64.StdEncoding.DecodeString(ev.Data)
	if len(data) == 0 {
		t.Fatal("私鑰登入後缺少終端輸出")
	}
}

func TestEncryptedOpenSSHPrivateKeyLogin(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(key)
	const passphrase = " 測試密語 test-only "
	block, err := ssh.MarshalPrivateKeyWithPassphrase(key, "test-only", []byte(passphrase))
	if err != nil {
		t.Fatal(err)
	}
	port, hostKey, _, _ := server(t, signer.PublicKey())
	engine := mobile.NewEngine()
	startKey(t, engine, port, string(pem.EncodeToMemory(block)), passphrase, base64.StdEncoding.EncodeToString(hostKey.PublicKey().Marshal()))
	waitEvent(t, engine, "connected")
}

func TestInvalidPrivateKeysDoNotOpenNetwork(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	encrypted, _ := ssh.MarshalPrivateKeyWithPassphrase(key, "test-only", []byte("test-passphrase"))
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	for _, tc := range []struct{ name, key, passphrase, code string }{
		{"缺少密語", string(pem.EncodeToMemory(encrypted)), "", "private_key_passphrase_required"},
		{"錯誤密語", string(pem.EncodeToMemory(encrypted)), "wrong-secret", "private_key_decryption_failed"},
		{"毀損私鑰", "-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----\n", "", "private_key_invalid"},
		{"不支援加密PKCS8", "-----BEGIN ENCRYPTED PRIVATE KEY-----\ndGVzdA==\n-----END ENCRYPTED PRIVATE KEY-----\n", "test-passphrase", "private_key_unsupported"},
		{"不支援DSA", "-----BEGIN DSA PRIVATE KEY-----\ndGVzdA==\n-----END DSA PRIVATE KEY-----\n", "", "private_key_unsupported"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := mobile.NewEngine()
			startKey(t, e, ln.Addr().(*net.TCPAddr).Port, tc.key, tc.passphrase, "")
			ev := waitEvent(t, e, "error")
			if ev.Code != tc.code {
				t.Fatalf("%s != %s", ev.Code, tc.code)
			}
		})
	}
	ln.(*net.TCPListener).SetDeadline(time.Now().Add(50 * time.Millisecond))
	conn, err := ln.Accept()
	if err == nil {
		conn.Close()
		t.Fatal("無效私鑰不應建立網路連線")
	}
}

func TestPEMPrivateKeyFormats(t *testing.T) {
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, edKey, _ := ed25519.GenerateKey(rand.Reader)
	ecDER, _ := x509.MarshalECPrivateKey(ecKey)
	edDER, _ := x509.MarshalPKCS8PrivateKey(edKey)
	encryptedRSA, err := x509.EncryptPEMBlock(rand.Reader, "RSA PRIVATE KEY", x509.MarshalPKCS1PrivateKey(rsaKey), []byte("test-passphrase"), x509.PEMCipherAES256)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name       string
		key        any
		block      *pem.Block
		passphrase string
	}{
		{"RSA PKCS1", rsaKey, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(rsaKey)}, ""},
		{"ECDSA SEC1", ecKey, &pem.Block{Type: "EC PRIVATE KEY", Bytes: ecDER}, ""},
		{"Ed25519 PKCS8", edKey, &pem.Block{Type: "PRIVATE KEY", Bytes: edDER}, ""},
		{"加密RSA PEM", rsaKey, encryptedRSA, "test-passphrase"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			signer, err := ssh.NewSignerFromKey(tc.key)
			if err != nil {
				t.Fatal(err)
			}
			port, hostKey, _, _ := server(t, signer.PublicKey())
			e := mobile.NewEngine()
			startKey(t, e, port, string(pem.EncodeToMemory(tc.block)), tc.passphrase, base64.StdEncoding.EncodeToString(hostKey.PublicKey().Marshal()))
			waitEvent(t, e, "connected")
		})
	}
}

func TestPrivateKeyRejectsChangedHostAndUnauthorizedKey(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(key)
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	otherSigner, _ := ssh.NewSignerFromKey(other)
	block, _ := ssh.MarshalPrivateKey(key, "test-only")
	for _, mode := range []string{"changed-host", "unauthorized-key"} {
		t.Run(mode, func(t *testing.T) {
			allowed := signer.PublicKey()
			if mode == "unauthorized-key" {
				allowed = otherSigner.PublicKey()
			}
			port, hostKey, auths, _ := server(t, allowed)
			expected := base64.StdEncoding.EncodeToString(hostKey.PublicKey().Marshal())
			if mode == "changed-host" {
				expected = "changed"
			}
			e := mobile.NewEngine()
			startKey(t, e, port, string(pem.EncodeToMemory(block)), "", expected)
			ev := waitEvent(t, e, "error")
			want := "authentication_failed"
			if mode == "changed-host" {
				want = "host_key_changed"
				if auths.Load() != 0 {
					t.Fatal("主機金鑰不符仍認證")
				}
			}
			if ev.Code != want {
				t.Fatalf("%s != %s", ev.Code, want)
			}
		})
	}
}
