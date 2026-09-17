package kubernetes

// ActiveWorkCount 在同一把鎖內讀取 shell 與轉發，供更新前檢查使用。
func (s *Service) ActiveWorkCount() (int, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.podShells), len(s.portForwards)
}
