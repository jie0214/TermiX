package secrets

import (
	"context"
	"sync"
)

type MemoryStore struct {
	mu      sync.RWMutex
	secrets map[string]string
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		secrets: map[string]string{},
	}
}

func (m *MemoryStore) SetSecret(_ context.Context, ref string, value string) error {
	ref = normalizeRef(ref)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.secrets[ref] = value
	return nil
}

func (m *MemoryStore) GetSecret(_ context.Context, ref string) (string, error) {
	ref = normalizeRef(ref)
	m.mu.RLock()
	defer m.mu.RUnlock()
	value, ok := m.secrets[ref]
	if !ok {
		return "", ErrSecretNotFound
	}
	return value, nil
}

func (m *MemoryStore) DeleteSecret(_ context.Context, ref string) error {
	ref = normalizeRef(ref)
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.secrets[ref]; !ok {
		return ErrSecretNotFound
	}
	delete(m.secrets, ref)
	return nil
}

func (m *MemoryStore) HasSecret(_ context.Context, ref string) (bool, error) {
	ref = normalizeRef(ref)
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.secrets[ref]
	return ok, nil
}

var _ SecretStore = (*MemoryStore)(nil)
