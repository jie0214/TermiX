package hostvault

import (
	"context"
	"errors"
	"time"

	"github.com/jie0214/TermiX/backend/storage"

	"go.uber.org/fx"
)

type Scheduler struct {
	svc    *Service
	ticker *time.Ticker
	stop   chan struct{}
}

func NewScheduler(svc *Service, lc fx.Lifecycle) *Scheduler {
	s := &Scheduler{
		svc:  svc,
		stop: make(chan struct{}),
	}
	lc.Append(fx.Hook{
		OnStart: func(ctx context.Context) error {
			s.Start()
			return nil
		},
		OnStop: func(ctx context.Context) error {
			s.Stop()
			return nil
		},
	})
	return s
}

func (s *Scheduler) Start() {
	s.ticker = time.NewTicker(5 * time.Minute)
	go func() {
		log.Info("AWS 同步排程器已啟動（每 5 分鐘自動執行）")
		
		// 啟動時非同步執行一次同步
		go s.syncAll()

		for {
			select {
			case <-s.ticker.C:
				s.syncAll()
			case <-s.stop:
				return
			}
		}
	}()
}

func (s *Scheduler) Stop() {
	if s.ticker != nil {
		s.ticker.Stop()
	}
	close(s.stop)
	log.Info("AWS 同步排程器已停止")
}

func (s *Scheduler) syncAll() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	integrations, err := s.svc.ListAWSIntegrations(ctx)
	if err != nil {
		log.WithError(err).Error("背景同步：無法取得 AWS 整合設定列表")
		return
	}

	for _, integration := range integrations {
		log.Infof("背景同步：開始同步 AWS 群組 %s", integration.GroupID)
		if err := s.svc.SyncAWS(ctx, integration.GroupID); err != nil {
			if errors.Is(err, storage.ErrAWSIntegrationNotFound) {
				log.Debugf("背景同步：群組 %s 的 AWS 整合設定已不存在，跳過同步", integration.GroupID)
			} else {
				log.WithError(err).Errorf("背景同步：同步 AWS 群組 %s 失敗", integration.GroupID)
			}
		} else {
			log.Infof("背景同步：同步 AWS 群組 %s 成功", integration.GroupID)
		}
	}
}
