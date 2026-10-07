package aiagent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const maxAgentOutput = 2 * 1024 * 1024

func findExecutable(name string) (string, error) {
	if path, err := exec.LookPath(name); err == nil && filepath.IsAbs(path) {
		return path, nil
	}
	home, _ := os.UserHomeDir()
	dirs := []string{filepath.Join(home, ".local", "bin"), filepath.Join(home, ".npm-global", "bin"), "/opt/homebrew/bin", "/usr/local/bin"}
	if runtime.GOOS == "windows" {
		dirs = append(dirs, filepath.Join(os.Getenv("APPDATA"), "npm"))
	}
	for _, pattern := range []string{".nvm/versions/node/*/bin", ".local/share/fnm/node-versions/*/installation/bin"} {
		matches, _ := filepath.Glob(filepath.Join(home, pattern))
		for i := len(matches) - 1; i >= 0; i-- {
			dirs = append(dirs, matches[i])
		}
	}
	for _, dir := range dirs {
		names := []string{name}
		if runtime.GOOS == "windows" {
			names = []string{name + ".exe", name + ".cmd"}
		}
		for _, file := range names {
			path := filepath.Join(dir, file)
			if info, err := os.Stat(path); err == nil && !info.IsDir() && (runtime.GOOS == "windows" || info.Mode()&0111 != 0) {
				return path, nil
			}
		}
	}
	return "", exec.ErrNotFound
}

type wireMessage map[string]json.RawMessage

func (m wireMessage) text(key string) string {
	var result string
	_ = json.Unmarshal(m[key], &result)
	return result
}
func (m wireMessage) object(key string) wireMessage {
	result := wireMessage{}
	_ = json.Unmarshal(m[key], &result)
	return result
}

type process struct {
	cmd           *exec.Cmd
	input         io.WriteCloser
	messages      chan wireMessage
	done          chan struct{}
	cancel        context.CancelFunc
	once          sync.Once
	dir           string
	sequence      int
	sendMu        sync.Mutex
	sessionMu     sync.Mutex
	cancelSession string
}

func startProcess(ctx context.Context, def agentDefinition, path string, args []string, configure func(string) ([]string, error)) (*process, error) {
	dir, err := os.MkdirTemp("", "termix-ai-")
	if err != nil {
		return nil, err
	}
	extraEnv := []string{}
	if configure != nil {
		extraEnv, err = configure(dir)
		if err != nil {
			_ = os.RemoveAll(dir)
			return nil, err
		}
	}
	path, args, err = agentCommand(def, path, args)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, err
	}
	ctx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir = dir
	cmd.Env = childEnvironment(extraEnv)
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 2 * time.Second
	configureProcess(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		_ = os.RemoveAll(dir)
		return nil, err
	}
	input, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		_ = os.RemoveAll(dir)
		return nil, err
	}
	p := &process{cmd: cmd, input: input, messages: make(chan wireMessage, 32), done: make(chan struct{}), cancel: cancel, dir: dir}
	terminate := cmd.Cancel
	cmd.Cancel = func() error {
		// 先送出 ACP 取消，給 Agent 短暫時間中止遠端推論；逾時仍結束整個程序樹。
		notified := make(chan bool, 1)
		go func() { notified <- p.sendCancellation() }()
		select {
		case sent := <-notified:
			if sent {
				time.Sleep(250 * time.Millisecond)
			}
		case <-time.After(100 * time.Millisecond):
		}
		return terminate()
	}
	if err := cmd.Start(); err != nil {
		cancel()
		_ = input.Close()
		_ = stdout.Close()
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("無法啟動 %s：%w", def.name, err)
	}
	go func() {
		defer close(p.messages)
		defer close(p.done)
		defer func() { p.cancel(); _ = cmd.Wait() }()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64*1024), maxAgentOutput)
		for scanner.Scan() {
			var message wireMessage
			if json.Unmarshal(scanner.Bytes(), &message) != nil {
				continue
			}
			select {
			case p.messages <- message:
			case <-ctx.Done():
				return
			}
		}
	}()
	return p, nil
}

func childEnvironment(extra []string) []string {
	blocked := map[string]bool{"CLAUDECODE": true, "CLAUDE_CODE_ENTRYPOINT": true}
	for _, value := range extra {
		key, _, _ := strings.Cut(value, "=")
		blocked[key] = true
	}
	result := []string{}
	for _, value := range os.Environ() {
		key, _, _ := strings.Cut(value, "=")
		if !blocked[key] {
			result = append(result, value)
		}
	}
	return append(result, extra...)
}

func (p *process) Close() {
	p.once.Do(func() {
		p.cancel()
		// 保留 stdin 到取消通知送出與程序結束，避免 Close 搶先關閉取消通道。
		<-p.done
		_ = p.input.Close()
		_ = os.RemoveAll(p.dir)
	})
}

func (p *process) send(message any) error {
	p.sendMu.Lock()
	defer p.sendMu.Unlock()
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	_, err = p.input.Write(append(data, '\n'))
	return err
}

func (p *process) next(ctx context.Context) (wireMessage, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case message, ok := <-p.messages:
		if !ok {
			return nil, errors.New("Agent 程序已結束或回應超過限制；請檢查 CLI 版本與登入狀態")
		}
		return message, nil
	}
}

// rpc 順序處理回覆與通知；所有 Agent 反向要求一律拒絕，不替 Agent 執行工具。
func (p *process) rpc(ctx context.Context, method string, params any, notify func(wireMessage) error) (wireMessage, error) {
	p.sequence++
	id := p.sequence
	if err := p.send(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		return nil, err
	}
	for {
		message, err := p.next(ctx)
		if err != nil {
			return nil, err
		}
		if len(message["method"]) > 0 {
			if len(message["id"]) > 0 {
				reply := map[string]any{"jsonrpc": "2.0", "id": message["id"]}
				if message.text("method") == "session/request_permission" {
					reply["result"] = map[string]any{"outcome": map[string]string{"outcome": "cancelled"}}
				} else {
					reply["error"] = map[string]any{"code": -32601, "message": "TermiX analysis does not allow tools or approvals"}
				}
				if err := p.send(reply); err != nil {
					return nil, err
				}
			} else if notify != nil {
				if err := notify(message); err != nil {
					return nil, err
				}
			}
			continue
		}
		var responseID int
		if json.Unmarshal(message["id"], &responseID) != nil || responseID != id {
			continue
		}
		if raw := message["error"]; len(raw) > 0 && string(raw) != "null" {
			detail := message.object("error").text("message")
			if detail == "" {
				detail = "ACP 請求失敗"
			}
			return nil, fmt.Errorf("Agent：%s", boundedText(detail, 800))
		}
		return message.object("result"), nil
	}
}

func boundedText(value string, size int) string {
	value = strings.ToValidUTF8(value, "")
	if len(value) <= size {
		return value
	}
	return strings.ToValidUTF8(value[:size], "") + "…"
}

func (p *process) setCancelSession(id string) {
	p.sessionMu.Lock()
	p.cancelSession = id
	p.sessionMu.Unlock()
}

func (p *process) sendCancellation() bool {
	p.sessionMu.Lock()
	id := p.cancelSession
	p.sessionMu.Unlock()
	if id != "" {
		return p.send(map[string]any{"jsonrpc": "2.0", "method": "session/cancel", "params": map[string]string{"sessionId": id}}) == nil
	}
	return false
}

// Windows npm shim 透過 Node 執行登錄中的固定入口，不交給 Shell 解譯。
func agentCommand(def agentDefinition, path string, args []string) (string, []string, error) {
	if runtime.GOOS != "windows" || !strings.EqualFold(filepath.Ext(path), ".cmd") {
		return path, args, nil
	}
	if def.nodeEntry == "" {
		return "", nil, errors.New("ACP Agent 未設定 Windows Node 入口")
	}
	script := filepath.Join(filepath.Dir(path), "node_modules", filepath.FromSlash(def.nodeEntry))
	if _, err := os.Stat(script); err != nil {
		return "", nil, errors.New("找不到 ACP Agent 的 Node 入口，請重新安裝轉接程式")
	}
	node, err := exec.LookPath("node.exe")
	if err != nil {
		return "", nil, errors.New("找不到 Node.js")
	}
	return node, append([]string{script}, args...), nil
}

type limitedOutput struct{ bytes.Buffer }

func (b *limitedOutput) Write(data []byte) (int, error) {
	if b.Len()+len(data) > maxAgentOutput {
		return 0, errors.New("Agent 設定回應超過大小限制")
	}
	return b.Buffer.Write(data)
}

func runAgentCommand(ctx context.Context, def agentDefinition, path, dir string, args []string) ([]byte, error) {
	path, args, err := agentCommand(def, path, args)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir, cmd.Env = dir, childEnvironment([]string{"APP_SERVER_LOGS="})
	var output limitedOutput
	cmd.Stdout, cmd.Stderr = &output, io.Discard
	cmd.WaitDelay = 2 * time.Second
	configureProcess(cmd)
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
