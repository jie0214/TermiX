package ssh

import (
	"testing"

	"github.com/jie0214/TermiX/shared/constants"
	"github.com/jie0214/TermiX/shared/dto"
)

func TestValidateSSHConfigRejectsOpsPasswordLogin(t *testing.T) {
	err := ValidateConfig(dto.SSHConfig{
		Host:     "10.20.85.54",
		Port:     22,
		Username: "ops",
		AuthMode: constants.AuthModePassword,
		Password: "secret",
	})
	if err == nil {
		t.Fatal("預期拒絕 ops 使用密碼登入")
	}
}
