package snippets

import "go.uber.org/fx"

var Module = fx.Module("snippets",
	fx.Provide(NewService),
)
