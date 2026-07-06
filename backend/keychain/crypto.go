package keychain

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"

	cryptossh "golang.org/x/crypto/ssh"
)

const (
	KeyTypeEd25519 = "ed25519"
	KeyTypeECDSA   = "ecdsa"
	KeyTypeRSA     = "rsa"
)

const (
	defaultRSABits   = 3072
	minRSABits       = 2048
	defaultECDSABits = 256
)

var errPassphraseRequired = errors.New("此私鑰受密碼短語保護，請提供密碼短語")

// keyMaterial 封裝一把已就緒的金鑰：OpenSSH 私鑰（可能已加密）與衍生的公開資訊。
type keyMaterial struct {
	Type          string
	Bits          int
	PrivatePEM    string // OpenSSH 格式私鑰，passphrase 非空時為加密內容
	PublicKey     string // authorized_keys 單行格式
	Fingerprint   string // SHA256:...
	HasPassphrase bool   // 私鑰是否受密碼短語保護
}

// generateKeyMaterial 依指定類型產生新的金鑰對，並以 comment/passphrase 序列化私鑰。
func generateKeyMaterial(keyType string, bits int, comment, passphrase string) (keyMaterial, error) {
	var cryptoKey crypto.PrivateKey
	normalizedBits := 0

	switch strings.ToLower(strings.TrimSpace(keyType)) {
	case KeyTypeEd25519, "":
		keyType = KeyTypeEd25519
		_, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return keyMaterial{}, fmt.Errorf("產生 Ed25519 金鑰失敗：%w", err)
		}
		cryptoKey = priv
	case KeyTypeECDSA:
		keyType = KeyTypeECDSA
		curve, curveBits, err := ecdsaCurve(bits)
		if err != nil {
			return keyMaterial{}, err
		}
		priv, err := ecdsa.GenerateKey(curve, rand.Reader)
		if err != nil {
			return keyMaterial{}, fmt.Errorf("產生 ECDSA 金鑰失敗：%w", err)
		}
		cryptoKey = priv
		normalizedBits = curveBits
	case KeyTypeRSA:
		keyType = KeyTypeRSA
		rsaBits := bits
		if rsaBits == 0 {
			rsaBits = defaultRSABits
		}
		if rsaBits < minRSABits {
			return keyMaterial{}, fmt.Errorf("RSA 金鑰長度不得小於 %d 位元", minRSABits)
		}
		priv, err := rsa.GenerateKey(rand.Reader, rsaBits)
		if err != nil {
			return keyMaterial{}, fmt.Errorf("產生 RSA 金鑰失敗：%w", err)
		}
		cryptoKey = priv
		normalizedBits = rsaBits
	default:
		return keyMaterial{}, fmt.Errorf("不支援的金鑰類型：%s", keyType)
	}

	privatePEM, err := marshalPrivate(cryptoKey, comment, passphrase)
	if err != nil {
		return keyMaterial{}, err
	}
	publicKey, fingerprint, err := derivePublic(cryptoKey, comment)
	if err != nil {
		return keyMaterial{}, err
	}

	return keyMaterial{
		Type:          keyType,
		Bits:          normalizedBits,
		PrivatePEM:    privatePEM,
		PublicKey:     publicKey,
		Fingerprint:   fingerprint,
		HasPassphrase: strings.TrimSpace(passphrase) != "",
	}, nil
}

// parseImportedKey 解析使用者提供的私鑰，衍生公鑰與指紋，並保留原始 PEM（維持其加密狀態）。
func parseImportedKey(privatePEM, passphrase, comment string) (keyMaterial, error) {
	pemBytes := []byte(privatePEM)
	raw, err := cryptossh.ParseRawPrivateKey(pemBytes)
	encrypted := false
	if err != nil {
		var missing *cryptossh.PassphraseMissingError
		if errors.As(err, &missing) {
			if strings.TrimSpace(passphrase) == "" {
				return keyMaterial{}, errPassphraseRequired
			}
			raw, err = cryptossh.ParseRawPrivateKeyWithPassphrase(pemBytes, []byte(passphrase))
			if err != nil {
				return keyMaterial{}, fmt.Errorf("解開私鑰失敗，密碼短語可能不正確：%w", err)
			}
			encrypted = true
		} else {
			return keyMaterial{}, fmt.Errorf("解析私鑰失敗：%w", err)
		}
	}

	keyType, bits, err := classifyKey(raw)
	if err != nil {
		return keyMaterial{}, err
	}
	publicKey, fingerprint, err := derivePublic(raw, comment)
	if err != nil {
		return keyMaterial{}, err
	}

	return keyMaterial{
		Type:          keyType,
		Bits:          bits,
		PrivatePEM:    strings.TrimSpace(privatePEM) + "\n",
		PublicKey:     publicKey,
		Fingerprint:   fingerprint,
		HasPassphrase: encrypted,
	}, nil
}

func marshalPrivate(key crypto.PrivateKey, comment, passphrase string) (string, error) {
	var (
		block *pem.Block
		err   error
	)
	if strings.TrimSpace(passphrase) != "" {
		block, err = cryptossh.MarshalPrivateKeyWithPassphrase(key, comment, []byte(passphrase))
	} else {
		block, err = cryptossh.MarshalPrivateKey(key, comment)
	}
	if err != nil {
		return "", fmt.Errorf("序列化私鑰失敗：%w", err)
	}
	return string(pem.EncodeToMemory(block)), nil
}

func derivePublic(key crypto.PrivateKey, comment string) (string, string, error) {
	signer, err := cryptossh.NewSignerFromKey(key)
	if err != nil {
		return "", "", fmt.Errorf("由私鑰衍生公鑰失敗：%w", err)
	}
	pub := signer.PublicKey()
	line := strings.TrimSpace(string(cryptossh.MarshalAuthorizedKey(pub)))
	if c := strings.TrimSpace(comment); c != "" {
		line = line + " " + c
	}
	return line, cryptossh.FingerprintSHA256(pub), nil
}

func classifyKey(raw any) (string, int, error) {
	switch k := raw.(type) {
	case *ed25519.PrivateKey, ed25519.PrivateKey:
		return KeyTypeEd25519, 0, nil
	case *rsa.PrivateKey:
		return KeyTypeRSA, k.N.BitLen(), nil
	case *ecdsa.PrivateKey:
		return KeyTypeECDSA, k.Curve.Params().BitSize, nil
	default:
		return "", 0, fmt.Errorf("不支援的私鑰類型：%T", raw)
	}
}

func ecdsaCurve(bits int) (elliptic.Curve, int, error) {
	switch bits {
	case 0, defaultECDSABits:
		return elliptic.P256(), 256, nil
	case 384:
		return elliptic.P384(), 384, nil
	case 521:
		return elliptic.P521(), 521, nil
	default:
		return nil, 0, fmt.Errorf("不支援的 ECDSA 曲線位元：%d（僅支援 256/384/521）", bits)
	}
}
