package secrets

import "os"

func init() {
	getEnv = os.Getenv
}
