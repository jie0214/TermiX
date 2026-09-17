//go:build !bindings

package storage

func provideDatabase() (*Database, error) {
	return NewDatabase()
}
