package knownhosts

import (
	"crypto/ed25519"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"
)

// writeTempKnownHosts 建立臨時 known_hosts，並將 HOME 指向其父層以供 ListKnownHosts 讀取。
func writeTempKnownHosts(t *testing.T, content string) {
	t.Helper()
	home := t.TempDir()
	sshDir := filepath.Join(home, ".ssh")
	if err := os.MkdirAll(sshDir, 0700); err != nil {
		t.Fatalf("建立 .ssh 目錄失敗：%v", err)
	}
	if content != "" {
		if err := os.WriteFile(filepath.Join(sshDir, "known_hosts"), []byte(content), 0600); err != nil {
			t.Fatalf("寫入 known_hosts 失敗：%v", err)
		}
	}
	t.Setenv("HOME", home)
}

// generateHostLine 以隨機金鑰產生一行合法的 known_hosts 條目。
func generateHostLine(t *testing.T, marker, host string) (string, string) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("產生金鑰失敗：%v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("建立 signer 失敗：%v", err)
	}
	pub := signer.PublicKey()
	line := ssh.MarshalAuthorizedKey(pub)
	entry := host + " " + string(line)
	if marker != "" {
		entry = "@" + marker + " " + entry
	}
	return entry, ssh.FingerprintSHA256(pub)
}

func TestListKnownHostsEmptyWhenMissing(t *testing.T) {
	writeTempKnownHosts(t, "")
	v := NewValidator()
	entries, err := v.ListKnownHosts()
	if err != nil {
		t.Fatalf("預期無錯誤，得到：%v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("預期空陣列，得到 %d 筆", len(entries))
	}
}

func TestListKnownHostsParsesEntries(t *testing.T) {
	line, fp := generateHostLine(t, "", "github.com")
	writeTempKnownHosts(t, line)

	v := NewValidator()
	entries, err := v.ListKnownHosts()
	if err != nil {
		t.Fatalf("預期無錯誤，得到：%v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("預期 1 筆，得到 %d 筆", len(entries))
	}
	if entries[0].Host != "github.com" {
		t.Errorf("host 不符：%q", entries[0].Host)
	}
	if entries[0].Type != "ssh-ed25519" {
		t.Errorf("type 不符：%q", entries[0].Type)
	}
	if entries[0].Fingerprint != fp {
		t.Errorf("fingerprint 不符：%q vs %q", entries[0].Fingerprint, fp)
	}
}

func TestListKnownHostsSkipsRevoked(t *testing.T) {
	revoked, _ := generateHostLine(t, "revoked", "old.example.com")
	valid, _ := generateHostLine(t, "", "good.example.com")
	writeTempKnownHosts(t, revoked+"\n"+valid+"\n")

	v := NewValidator()
	entries, err := v.ListKnownHosts()
	if err != nil {
		t.Fatalf("預期無錯誤，得到：%v", err)
	}
	if len(entries) != 1 || entries[0].Host != "good.example.com" {
		t.Fatalf("預期僅保留未撤銷條目，得到：%+v", entries)
	}
}
