package mobilekubernetes

import (
	stdcontext "context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/aws/smithy-go"
	"gopkg.in/yaml.v3"
)

// EKSConfig 只包含辨識與簽章所需的公開資訊，不包含 AWS 憑證。
type EKSConfig struct {
	ClusterName   string `json:"clusterName"`
	Region        string `json:"region"`
	Profile       string `json:"profile"`
	RoleARN       string `json:"roleArn,omitempty"`
	CredentialKey string `json:"credentialKey"`
}
type eksExec struct {
	Command    string   `yaml:"command"`
	Args       []string `yaml:"args"`
	APIVersion string   `yaml:"apiVersion"`
	Env        []struct {
		Name  string `yaml:"name"`
		Value string `yaml:"value"`
	} `yaml:"env"`
}

var regionPattern = regexp.MustCompile(`^(af|ap|ca|cn|eu|il|me|mx|sa|us)-(gov-)?[a-z]+-[0-9]+$`)
var clusterPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$`)
var profilePattern = regexp.MustCompile(`^[A-Za-z0-9_.@+-]{1,128}$`)
var rolePattern = regexp.MustCompile(`^arn:aws(-cn|-us-gov)?:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]{1,512}$`)

func parseEKS(value any) (*EKSConfig, error) {
	bad := errors.New("unsupported_eks_exec")
	raw, err := yaml.Marshal(value)
	if err != nil {
		return nil, bad
	}
	var exec eksExec
	if yaml.Unmarshal(raw, &exec) != nil || filepath.Base(exec.Command) != "aws" || (exec.Command != "aws" && !filepath.IsAbs(exec.Command)) {
		return nil, bad
	}
	if exec.APIVersion != "client.authentication.k8s.io/v1beta1" && exec.APIVersion != "client.authentication.k8s.io/v1" {
		return nil, bad
	}
	cfg := &EKSConfig{Profile: "default"}
	positional := []string{}
	flags := map[string]string{}
	for i := 0; i < len(exec.Args); i++ {
		arg := exec.Args[i]
		if !strings.HasPrefix(arg, "--") {
			positional = append(positional, arg)
			continue
		}
		name, value, hasValue := strings.Cut(arg, "=")
		switch name {
		case "--region", "--cluster-name", "--cluster-id", "--profile", "--role-arn", "--output":
		default:
			return nil, bad
		}
		if _, exists := flags[name]; exists {
			return nil, bad
		}
		if !hasValue {
			i++
			if i >= len(exec.Args) {
				return nil, bad
			}
			value = exec.Args[i]
		}
		if value == "" || strings.HasPrefix(value, "--") {
			return nil, bad
		}
		flags[name] = value
	}
	if len(positional) != 2 || positional[0] != "eks" || positional[1] != "get-token" {
		return nil, bad
	}
	if output := flags["--output"]; output != "" && output != "json" {
		return nil, bad
	}
	envSeen := map[string]bool{}
	for _, item := range exec.Env {
		if envSeen[item.Name] {
			return nil, bad
		}
		envSeen[item.Name] = true
		switch item.Name {
		case "AWS_PROFILE":
			cfg.Profile = item.Value
		case "AWS_REGION", "AWS_DEFAULT_REGION":
			if cfg.Region != "" && cfg.Region != item.Value {
				return nil, bad
			}
			cfg.Region = item.Value
		default:
			return nil, bad
		}
	}
	if value := flags["--profile"]; value != "" {
		cfg.Profile = value
	}
	if value := flags["--region"]; value != "" {
		cfg.Region = value
	}
	cfg.ClusterName = flags["--cluster-name"]
	if id := flags["--cluster-id"]; id != "" {
		if cfg.ClusterName != "" {
			return nil, bad
		}
		cfg.ClusterName = id
	}
	cfg.RoleARN = flags["--role-arn"]
	if !regionPattern.MatchString(cfg.Region) || !clusterPattern.MatchString(cfg.ClusterName) || !profilePattern.MatchString(cfg.Profile) || (cfg.RoleARN != "" && !rolePattern.MatchString(cfg.RoleARN)) {
		return nil, bad
	}
	partition := awsPartition(cfg.Region)
	if cfg.RoleARN != "" && !strings.HasPrefix(cfg.RoleARN, "arn:"+partition+":") {
		return nil, bad
	}
	cfg.CredentialKey, _ = AWSProfileKey(cfg.Region, cfg.Profile)
	return cfg, nil
}

type awsLogin struct {
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	SessionToken    string `json:"sessionToken"`
}

func readAWSLogin(raw string) (aws.Credentials, error) {
	var value awsLogin
	if len(raw) > 16384 || json.Unmarshal([]byte(raw), &value) != nil || !regexp.MustCompile(`^[A-Z0-9]{16,128}$`).MatchString(value.AccessKeyID) || len(value.SecretAccessKey) < 16 || len(value.SecretAccessKey) > 256 || strings.ContainsAny(value.SecretAccessKey, " \r\n\t") || len(value.SessionToken) > 12000 || strings.ContainsAny(value.SessionToken, "\r\n") {
		return aws.Credentials{}, errors.New("aws_credentials_invalid")
	}
	if strings.HasPrefix(value.AccessKeyID, "ASIA") && value.SessionToken == "" {
		return aws.Credentials{}, errors.New("aws_session_token_required")
	}
	return aws.Credentials{AccessKeyID: value.AccessKeyID, SecretAccessKey: value.SecretAccessKey, SessionToken: value.SessionToken}, nil
}
func awsClient(region string, value aws.Credentials) *sts.Client {
	return sts.NewFromConfig(aws.Config{Region: region, Credentials: credentials.NewStaticCredentialsProvider(value.AccessKeyID, value.SecretAccessKey, value.SessionToken), HTTPClient: &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, RetryMaxAttempts: 1})
}
func safeAWSError(err error) error {
	var api smithy.APIError
	if errors.As(err, &api) {
		switch api.ErrorCode() {
		case "ExpiredToken", "ExpiredTokenException":
			return errors.New("aws_credentials_expired")
		case "InvalidClientTokenId", "SignatureDoesNotMatch", "InvalidSignatureException", "UnrecognizedClientException":
			return errors.New("aws_credentials_invalid")
		case "AccessDenied", "AccessDeniedException":
			return errors.New("aws_access_denied")
		}
	}
	return errors.New("aws_connection_failed")
}

// LoginAWS 只呼叫 AWS STS 確認輸入的身份，不讀取環境或執行本機程式。
func LoginAWS(region, raw string) (string, error) { return loginAWSWithHTTP(region, raw, nil) }
func loginAWSWithHTTP(region, raw string, httpClient aws.HTTPClient) (string, error) {
	if !regionPattern.MatchString(region) {
		return "", errors.New("unsupported_eks_exec")
	}
	value, err := readAWSLogin(raw)
	if err != nil {
		return "", err
	}
	ctx, cancel := stdcontext.WithTimeout(stdcontext.Background(), 15*time.Second)
	defer cancel()
	identity, err := awsClient(region, value).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{}, func(options *sts.Options) {
		if httpClient != nil {
			options.HTTPClient = httpClient
		}
	})
	if err != nil {
		return "", safeAWSError(err)
	}
	if identity.Arn == nil || identity.Account == nil {
		return "", errors.New("aws_connection_failed")
	}
	result, _ := json.Marshal(struct {
		Account string `json:"account"`
		ARN     string `json:"arn"`
	}{*identity.Account, *identity.Arn})
	return string(result), nil
}
func signEKSToken(cfg *EKSConfig, value aws.Credentials, now time.Time) (string, error) {
	suffix := "amazonaws.com"
	if strings.HasPrefix(cfg.Region, "cn-") {
		suffix = "amazonaws.com.cn"
	}
	req, err := http.NewRequest(http.MethodGet, "https://sts."+cfg.Region+"."+suffix+"/?Action=GetCallerIdentity&Version=2011-06-15&X-Amz-Expires=60", nil)
	if err != nil {
		return "", errors.New("aws_signing_failed")
	}
	req.Header.Set("x-k8s-aws-id", cfg.ClusterName)
	signed, _, err := v4.NewSigner().PresignHTTP(stdcontext.Background(), value, req, fmt.Sprintf("%x", sha256.Sum256(nil)), "sts", cfg.Region, now, func(options *v4.SignerOptions) { options.DisableHeaderHoisting = true })
	if err != nil {
		return "", errors.New("aws_signing_failed")
	}
	return "k8s-aws-v1." + base64.RawURLEncoding.EncodeToString([]byte(signed)), nil
}

// AuthorizeEKS 每次操作重新簽發 token；只在記憶體回傳目前 context 的最小設定。
func AuthorizeEKS(raw, login string) (string, error) {
	selected, err := selectConfig(raw)
	if err != nil {
		return "", err
	}
	if selected.EKS == nil {
		return raw, nil
	}
	value, err := readAWSLogin(login)
	if err != nil {
		return "", err
	}
	if selected.EKS.RoleARN != "" {
		ctx, cancel := stdcontext.WithTimeout(stdcontext.Background(), 15*time.Second)
		defer cancel()
		response, err := awsClient(selected.EKS.Region, value).AssumeRole(ctx, &sts.AssumeRoleInput{RoleArn: aws.String(selected.EKS.RoleARN), RoleSessionName: aws.String("termix-mobile"), DurationSeconds: aws.Int32(900)})
		if err != nil {
			return "", safeAWSError(err)
		}
		if response.Credentials == nil || response.Credentials.AccessKeyId == nil || response.Credentials.SecretAccessKey == nil || response.Credentials.SessionToken == nil {
			return "", errors.New("aws_connection_failed")
		}
		value = aws.Credentials{AccessKeyID: *response.Credentials.AccessKeyId, SecretAccessKey: *response.Credentials.SecretAccessKey, SessionToken: *response.Credentials.SessionToken}
	}
	token, err := signEKSToken(selected.EKS, value, time.Now())
	if err != nil {
		return "", err
	}
	var source kubeconfig
	if yaml.Unmarshal([]byte(raw), &source) != nil {
		return "", errors.New("config_invalid")
	}
	for _, ctx := range source.Contexts {
		if ctx.Name == source.Current {
			for _, cl := range source.Clusters {
				if cl.Name == ctx.Context.Cluster {
					out := kubeconfig{Kind: "Config", Current: ctx.Name, Contexts: []namedContext{ctx}, Clusters: []namedCluster{cl}, Users: []namedUser{{Name: ctx.Context.User, User: user{Token: token}}}}
					result, err := yaml.Marshal(out)
					if err != nil {
						return "", errors.New("config_invalid")
					}
					return string(result), nil
				}
			}
		}
	}
	return "", errors.New("config_invalid")
}

func awsPartition(region string) string {
	if strings.HasPrefix(region, "cn-") {
		return "aws-cn"
	}
	if strings.HasPrefix(region, "us-gov-") {
		return "aws-us-gov"
	}
	return "aws"
}
func AWSProfileKey(region, profile string) (string, error) {
	if !regionPattern.MatchString(region) || !profilePattern.MatchString(profile) {
		return "", errors.New("aws_profile_invalid")
	}
	return fmt.Sprintf("termix.aws.%x", sha256.Sum256([]byte(awsPartition(region)+"\x00"+profile))), nil
}
