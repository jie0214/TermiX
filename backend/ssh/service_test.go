package ssh

import (
	"github.com/jie0214/TermiX/shared/constants"
	"github.com/jie0214/TermiX/shared/dto"
	"testing"
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

func TestNeedsSudoPasswordRules(t *testing.T) {
	cases := []struct {
		name   string
		config dto.SSHConfig
		want   bool
	}{
		{
			name: "ops key 不需要 sudo password",
			config: dto.SSHConfig{
				Username: "ops",
				AuthMode: constants.AuthModeKey,
			},
			want: false,
		},
		{
			name: "非 ops key 需要 sudo password",
			config: dto.SSHConfig{
				Username: "user",
				AuthMode: constants.AuthModeKey,
			},
			want: true,
		},
		{
			name: "非 ops 密碼登入需要 sudo password",
			config: dto.SSHConfig{
				Username: "user",
				AuthMode: constants.AuthModePassword,
			},
			want: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NeedsSudoPassword(tc.config); got != tc.want {
				t.Fatalf("needsSudoPassword = %v，預期 %v", got, tc.want)
			}
		})
	}
}
