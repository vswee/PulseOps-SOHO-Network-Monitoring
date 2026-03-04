package edgeos

import (
	"context"
	"fmt"
	"os/exec"
)

func run(user, host, key, cmd string) (string, error) {
	args := []string{"-i", key, "-o", "StrictHostKeyChecking=no", fmt.Sprintf("%s@%s", user, host), cmd}
	b, err := exec.Command("ssh", args...).CombinedOutput()
	return string(b), err
}

func Reboot(ctx context.Context, user, host, key string) (string, error) { return run(user, host, key, "sudo reboot") }
func RefreshFirewall(ctx context.Context, user, host, key string) (string, error) { return run(user, host, key, "configure; commit; save; exit") }
