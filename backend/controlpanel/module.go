package controlpanel

import "go.uber.org/fx"

// Module 暴露 controlpanel 領域模組的 Fx 提供者，將 NewExecutor 註冊至 Fx 依賴注入容器
var Module = fx.Options(
	fx.Provide(NewExecutor),
)
