package mobilessh

import (
	"bytes"
	"encoding/pem"
	"errors"
	"golang.org/x/crypto/ssh"
	"strings"
)

type credentials struct {
	Type       string `json:"type"`
	Password   string `json:"password"`
	PrivateKey string `json:"privateKey"`
	Passphrase string `json:"passphrase"`
}

func (c credentials) valid() bool {
	switch c.Type {
	case "password":
		return c.Password != "" && len(c.Password) <= 16384 && c.PrivateKey == "" && c.Passphrase == ""
	case "privateKey":
		return c.PrivateKey != "" && len(c.PrivateKey) <= 32*1024 && len(c.Passphrase) <= 16384 && c.Password == ""
	default:
		return false
	}
}
func (c credentials) authentication() (ssh.AuthMethod, string) {
	if c.Type == "password" {
		return ssh.Password(c.Password), ""
	}
	data := bytes.TrimSpace([]byte(c.PrivateKey))
	block, rest := pem.Decode(data)
	if block == nil || len(bytes.TrimSpace(rest)) != 0 || !bytes.HasPrefix(data, []byte("-----BEGIN ")) {
		return nil, "private_key_invalid"
	}
	switch block.Type {
	case "OPENSSH PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "PRIVATE KEY":
	default:
		return nil, "private_key_unsupported"
	}
	signer, err := ssh.ParsePrivateKey([]byte(c.PrivateKey))
	if err != nil {
		var missing *ssh.PassphraseMissingError
		if !errors.As(err, &missing) {
			if unsupportedKey(err) {
				return nil, "private_key_unsupported"
			}
			return nil, "private_key_invalid"
		}
		if c.Passphrase == "" {
			return nil, "private_key_passphrase_required"
		}
		signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(c.PrivateKey), []byte(c.Passphrase))
		if err != nil {
			if unsupportedKey(err) {
				return nil, "private_key_unsupported"
			}
			return nil, "private_key_decryption_failed"
		}
	}
	switch signer.PublicKey().Type() {
	case ssh.KeyAlgoRSA, ssh.KeyAlgoED25519, ssh.KeyAlgoECDSA256, ssh.KeyAlgoECDSA384, ssh.KeyAlgoECDSA521:
		return ssh.PublicKeys(signer), ""
	default:
		return nil, "private_key_unsupported"
	}
}

// 不把解析器的原始錯誤傳到 UI，以免包含來自私鑰檔案的資料。
func unsupportedKey(err error) bool {
	for _, marker := range []string{"unknown ", "unsupported ", "unhandled ", "exceed maximum"} {
		if strings.Contains(err.Error(), marker) {
			return true
		}
	}
	return false
}
