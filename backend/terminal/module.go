package terminal

import "go.uber.org/fx"

// Module 暴露 terminal 領域模組的 Fx 提供者，用以將 NewManager 註冊至 Fx 依賴注入容器
var Module = fx.Options(
	fx.Provide(NewManager),
)
