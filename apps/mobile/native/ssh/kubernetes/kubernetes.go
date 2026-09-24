// Package mobilekubernetes 提供手機使用的有限 Kubernetes API。
package mobilekubernetes

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
)

type namedCluster struct {
	Name    string  `yaml:"name"`
	Cluster cluster `yaml:"cluster"`
}
type cluster struct {
	Server   string `yaml:"server"`
	CAData   string `yaml:"certificate-authority-data"`
	CAFile   string `yaml:"certificate-authority"`
	Insecure bool   `yaml:"insecure-skip-tls-verify"`
	ProxyURL string `yaml:"proxy-url"`
}
type namedUser struct {
	Name string `yaml:"name"`
	User user   `yaml:"user"`
}
type user struct {
	Token        string `yaml:"token,omitempty"`
	TokenFile    string `yaml:"tokenFile,omitempty"`
	Exec         any    `yaml:"exec,omitempty"`
	AuthProvider any    `yaml:"auth-provider,omitempty"`
	CertData     string `yaml:"client-certificate-data,omitempty"`
	KeyData      string `yaml:"client-key-data,omitempty"`
	CertFile     string `yaml:"client-certificate,omitempty"`
	KeyFile      string `yaml:"client-key,omitempty"`
	Username     string `yaml:"username,omitempty"`
	Password     string `yaml:"password,omitempty"`
}
type namedContext struct {
	Name    string  `yaml:"name"`
	Context context `yaml:"context"`
}
type context struct {
	AWSProfile string `yaml:"x-termix-aws-profile,omitempty"`
	Cluster    string `yaml:"cluster"`
	User       string `yaml:"user"`
	Namespace  string `yaml:"namespace"`
}
type kubeconfig struct {
	Kind     string         `yaml:"kind"`
	Current  string         `yaml:"current-context"`
	Clusters []namedCluster `yaml:"clusters"`
	Users    []namedUser    `yaml:"users"`
	Contexts []namedContext `yaml:"contexts"`
}
type selected struct {
	EKS                                        *EKSConfig
	ClusterName, ContextName, Namespace, Token string
	URL                                        *url.URL
	Roots                                      *x509.CertPool
	Certificates                               []tls.Certificate
}

var namespacePattern = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)

func selectConfig(raw string) (selected, error) {
	cfg, err := parseConfig(raw)
	if err != nil {
		return selected{}, err
	}
	return selectParsedConfig(cfg)
}
func selectParsedConfig(cfg kubeconfig) (selected, error) {
	var out selected
	var ctx *context
	for i := range cfg.Contexts {
		if cfg.Contexts[i].Name == cfg.Current {
			ctx = &cfg.Contexts[i].Context
			break
		}
	}
	if ctx == nil || ctx.Cluster == "" || ctx.User == "" {
		return out, errors.New("config_invalid")
	}
	var cl *cluster
	var u *user
	for i := range cfg.Clusters {
		if cfg.Clusters[i].Name == ctx.Cluster {
			cl = &cfg.Clusters[i].Cluster
			break
		}
	}
	for i := range cfg.Users {
		if cfg.Users[i].Name == ctx.User {
			u = &cfg.Users[i].User
			break
		}
	}
	if cl == nil || u == nil {
		return out, errors.New("config_invalid")
	}
	if cl.Insecure || cl.Server == "" || strings.HasPrefix(cl.Server, "http://") {
		return out, errors.New("insecure_tls")
	}
	server, err := url.Parse(cl.Server)
	if err != nil || server.Scheme != "https" || server.Hostname() == "" || server.User != nil || server.RawQuery != "" || server.Fragment != "" {
		return out, errors.New("config_invalid")
	}
	if cl.CAFile != "" || cl.ProxyURL != "" || u.AuthProvider != nil || u.TokenFile != "" || u.CertFile != "" || u.KeyFile != "" || u.Username != "" || u.Password != "" {
		return out, errors.New("unsupported_auth")
	}
	var eks *EKSConfig
	if u.Exec != nil {
		if u.Token != "" || u.CertData != "" || u.KeyData != "" {
			return out, errors.New("ambiguous_auth")
		}
		eks, err = parseEKS(u.Exec)
		if err != nil {
			return out, err
		}
	}
	if eks != nil && ctx.AWSProfile != "" {
		eks.Profile = ctx.AWSProfile
		eks.CredentialKey, err = AWSProfileKey(eks.Region, eks.Profile)
		if err != nil {
			return out, err
		}
	}
	var certificates []tls.Certificate
	if u.CertData != "" || u.KeyData != "" {
		if u.Token != "" {
			return out, errors.New("ambiguous_auth")
		}
		if u.CertData == "" || u.KeyData == "" {
			return out, errors.New("certificate_incomplete")
		}
		certPEM, certErr := base64.StdEncoding.DecodeString(u.CertData)
		keyPEM, keyErr := base64.StdEncoding.DecodeString(u.KeyData)
		if certErr != nil || keyErr != nil {
			return out, errors.New("certificate_invalid")
		}
		identity, err := tls.X509KeyPair(certPEM, keyPEM)
		if err != nil {
			return out, errors.New("certificate_invalid")
		}
		now := time.Now()
		for _, der := range identity.Certificate {
			cert, err := x509.ParseCertificate(der)
			if err != nil {
				return out, errors.New("certificate_invalid")
			}
			if !now.Before(cert.NotAfter) {
				return out, errors.New("certificate_expired")
			}
			if now.Before(cert.NotBefore) {
				return out, errors.New("certificate_not_yet_valid")
			}
		}
		certificates = []tls.Certificate{identity}
	} else if u.Token == "" && eks == nil {
		return out, errors.New("missing_token")
	}
	var roots *x509.CertPool
	if cl.CAData != "" {
		roots = x509.NewCertPool()
		pemBytes, err := base64.StdEncoding.DecodeString(cl.CAData)
		if err != nil || !roots.AppendCertsFromPEM(pemBytes) {
			return out, errors.New("config_invalid")
		}
	}
	if cl.CAData == "" {
		var err error
		roots, err = x509.SystemCertPool()
		if err != nil {
			roots = x509.NewCertPool()
		}
	}
	namespace := ctx.Namespace
	if namespace == "" {
		namespace = "default"
	}
	if len(namespace) > 63 || !namespacePattern.MatchString(namespace) {
		return out, errors.New("config_invalid")
	}
	return selected{EKS: eks, ClusterName: ctx.Cluster, ContextName: cfg.Current, Namespace: namespace, Token: u.Token, URL: server, Roots: roots, Certificates: certificates}, nil
}

// Inspect 只回傳非機密摘要與固定錯誤代碼。
func Inspect(raw string) (string, error) {
	cfg, err := selectConfig(raw)
	if err != nil {
		return "", err
	}
	data, _ := json.Marshal(struct {
		EKS       *EKSConfig `json:"eks,omitempty"`
		Context   string     `json:"context"`
		Cluster   string     `json:"cluster"`
		Namespace string     `json:"namespace"`
	}{cfg.EKS, cfg.ContextName, cfg.ClusterName, cfg.Namespace})
	return string(data), nil
}

type pod struct {
	Spec struct {
		Containers     []podContainerSpec `json:"containers"`
		InitContainers []podContainerSpec `json:"initContainers"`
		Resources      resourceSpec       `json:"resources"`
	} `json:"spec"`
	Metadata struct {
		Name              string  `json:"name"`
		Namespace         string  `json:"namespace"`
		DeletionTimestamp *string `json:"deletionTimestamp"`
	} `json:"metadata"`
	Status struct {
		Phase                 string            `json:"phase"`
		Conditions            []healthCondition `json:"conditions"`
		ContainerStatuses     []containerHealth `json:"containerStatuses"`
		InitContainerStatuses []containerHealth `json:"initContainerStatuses"`
	} `json:"status"`
}

type apiRequest struct {
	clusterScoped                        bool
	metrics                              bool
	apiPath, resource, name, subresource string
	query                                url.Values
	maxBytes                             int64
	log                                  bool
	method                               string
	body                                 []byte
}

func getResource(raw, namespace, apiPath, resource, name string) ([]byte, error) {
	query := url.Values{}
	if name == "" {
		query.Set("limit", "200")
	}
	body, err := requestAPI(raw, namespace, apiRequest{apiPath: apiPath, resource: resource, name: name, query: query, maxBytes: 2 * 1024 * 1024})
	if err != nil {
		return nil, err
	}
	if len(body) > 2*1024*1024 {
		return nil, errors.New("api_failed")
	}
	return body, nil
}
func requestAPI(raw, namespace string, options apiRequest) ([]byte, error) {
	if !options.clusterScoped && (len(namespace) > 63 || !namespacePattern.MatchString(namespace)) {
		return nil, errors.New("invalid_namespace")
	}
	cfg, err := selectConfig(raw)
	if err != nil {
		return nil, err
	}
	if cfg.EKS != nil {
		return nil, errors.New("aws_login_required")
	}
	target := *cfg.URL
	if options.clusterScoped {
		target.Path = path.Join(target.Path, options.apiPath, options.resource)
	} else {
		target.Path = path.Join(target.Path, options.apiPath, "namespaces", namespace, options.resource, options.name, options.subresource)
	}
	target.RawQuery = options.query.Encode()
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: cfg.Roots, Certificates: cfg.Certificates, MinVersion: tls.VersionTLS12}, Proxy: nil, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	method := options.method
	if method == "" {
		method = http.MethodGet
	}
	request, err := http.NewRequest(method, target.String(), bytes.NewReader(options.body))
	if err != nil {
		return nil, errors.New("config_invalid")
	}
	if options.body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if cfg.Token != "" {
		request.Header.Set("Authorization", "Bearer "+cfg.Token)
	}
	if options.log {
		// API 先協商可序列化的回應格式，再傳回文字串流；僅接受 text/plain 會收到 406。
		request.Header.Set("Accept", "application/json, */*")
	} else {
		request.Header.Set("Accept", "application/json")
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("connection_failed")
	}
	defer response.Body.Close()
	if options.metrics && response.StatusCode == http.StatusServiceUnavailable {
		return nil, errors.New("metrics_unavailable")
	}
	if response.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("unauthorized")
	}
	if response.StatusCode == http.StatusForbidden {
		return nil, errors.New("forbidden")
	}
	if response.StatusCode == http.StatusNotFound {
		return nil, errors.New("not_found")
	}
	if options.log && response.StatusCode == http.StatusBadRequest {
		return nil, errors.New("logs_unavailable")
	}
	if response.StatusCode == http.StatusConflict {
		return nil, errors.New("scale_conflict")
	}
	if response.StatusCode == http.StatusUnprocessableEntity || response.StatusCode == http.StatusBadRequest {
		return nil, errors.New("api_rejected")
	}
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("api_failed")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, options.maxBytes+1))
	if err != nil {
		return nil, errors.New("api_failed")
	}
	return body, nil
}

func ListPods(raw, namespace string) (string, error) {
	body, err := getResource(raw, namespace, "api/v1", "pods", "")
	if err != nil {
		return "", err
	}
	var list struct {
		Metadata struct {
			Continue string `json:"continue"`
		} `json:"metadata"`
		Items []pod `json:"items"`
	}
	if err := json.Unmarshal(body, &list); err != nil || list.Items == nil || len(list.Items) > 200 {
		return "", errors.New("api_failed")
	}
	type summary struct {
		Limits    podLimits `json:"limits"`
		Reason    string    `json:"reason,omitempty"`
		Health    string    `json:"health"`
		Name      string    `json:"name"`
		Namespace string    `json:"namespace"`
		Phase     string    `json:"phase"`
		Ready     int       `json:"ready"`
		Total     int       `json:"total"`
	}
	result := struct {
		Items   []summary `json:"items"`
		HasMore bool      `json:"hasMore"`
	}{Items: make([]summary, 0, len(list.Items)), HasMore: list.Metadata.Continue != ""}
	for _, item := range list.Items {
		if item.Metadata.Name == "" || item.Metadata.Namespace != namespace {
			return "", errors.New("api_failed")
		}
		s := summary{Limits: limitsForPod(item), Reason: podReason(item), Health: podHealth(item), Name: item.Metadata.Name, Namespace: item.Metadata.Namespace, Phase: item.Status.Phase, Total: len(item.Spec.Containers)}
		for _, c := range item.Status.ContainerStatuses {
			if c.Ready {
				s.Ready++
			}
		}
		result.Items = append(result.Items, s)
	}
	data, _ := json.Marshal(result)
	return string(data), nil
}
