package hostvault

import "go.uber.org/fx"

var Module = fx.Options(
	fx.Provide(NewService),
	fx.Provide(NewScheduler),
	fx.Invoke(func(s *Scheduler) {}),
)
