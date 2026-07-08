# TermiX

[English](README.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md)

TermiX is a desktop app that brings **SSH host management, terminal workspaces, Kubernetes cluster operations, a control panel, and log viewing** together in a single window — so day-to-day operations no longer mean switching between tools.

Available for macOS, Windows, and Linux.

---

## Features

- **Host Vault** — Centrally manage SSH hosts, groups, and credentials, with support for password, private key, and SSH certificate; searchable, categorizable, and drag-to-organize.
- **Terminal workspace** — Remote SSH and local terminals with tabs and panes, automatic resizing, and interactive TUI support.
- **Control panel** — FunctionBox for one-click common actions and InfoBox status boards; local commands are gated by default (only `open` is allowed).
- **Kubernetes** — Reads `~/.kube/config`, switches context and namespace, and views Overview, Nodes, Pods, Deployments, StatefulSets, Workloads, Networking, Storage, and Events; provides a resource drawer, YAML, logs, port forwarding, delete, and create resource.
- **Logs** — Session logs, control-panel logs, and the Kubernetes logs viewer (filter, pause, download, clear).

---

## Requirements

- **Operating system**: macOS 11+, Windows 10+, or a mainstream Linux distribution.
- **Kubernetes features (optional)**: a valid `~/.kube/config` and access to the corresponding cluster.
- No separate runtime needed — the downloaded installer bundles everything required.

---

## Download and install

Download the file for your OS from the project's [Releases](https://github.com/jie0214/TermiX/releases) page:

### macOS
1. Download the `.app` (or `.dmg`) and unzip it.
2. Drag `TermiX.app` into your Applications folder.
3. On first launch, if you see "cannot verify developer", right-click the app → "Open" → "Open" again.

### Windows
1. Download and run the installer (`.exe`).
2. If SmartScreen appears, click "More info" → "Run anyway".

### Linux
1. Download the binary and make it executable: `chmod +x TermiX`.
2. Run it directly: `./TermiX`.

> The current builds are not code-signed, so your system may show a security warning — follow the steps above to bypass it. If Releases doesn't yet provide your platform, see "Build from source" below.

---

## Quick start

1. **Add a host**: In Host Vault, add an SSH host with its address and login method (password / key / certificate), then connect.
2. **Use the terminal**: After connecting, open the terminal workspace with multiple tabs and panes; you can also open a local terminal.
3. **Control panel**: Run preset actions via FunctionBox and watch status via InfoBox.
4. **Operate Kubernetes**: Make sure `~/.kube/config` exists, open the Kubernetes tab, then switch context/namespace and browse and operate cluster resources.

---

## Advanced settings (environment variables)

Not required for normal use; the following are optional:

- `TERMIX_ALLOW_UNSAFE_LOCAL_COMMANDS=1`
  By default FunctionBox only allows `open`. Set this variable to run arbitrary local shell commands — **only enable it if you trust the source.**
- `TERMIX_SECRET_STORE=memory`
  Use an in-memory secret store (not persisted across restarts), suitable for temporary or testing scenarios.

---

## FAQ

- **Kubernetes resources show access failures or missing values**: usually insufficient `~/.kube/config` permissions, or the cluster doesn't expose metrics; confirm your account has the right permissions for the cluster.
- **Security warning on launch**: because the builds aren't signed; follow the "Download and install" steps to bypass it.
- **FunctionBox can't run some commands**: this is the safe default; if you must run local commands, see the environment variables above.

---

## License

This project is under the [MIT License](LICENSE) — free to use, modify, and distribute. Bundled third-party packages retain their original licenses (MIT / BSD / Apache-2.0).

---

## Build from source (developers)

Requires Go 1.25+, Node.js and npm, and the [Wails CLI](https://wails.io):

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest   # install the Wails CLI
npm install --prefix frontend                              # install frontend deps

wails dev        # development mode (hot reload)
wails build      # package, output to build/bin/TermiX.app
```

Tests:

```bash
go test ./...                    # backend
npm test --prefix frontend       # frontend
```
