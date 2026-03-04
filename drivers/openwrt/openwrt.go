package openwrt

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

func Reboot(ctx context.Context, user, host, key string) (string, error) { return run(user, host, key, "reboot") }
func RefreshFirewall(ctx context.Context, user, host, key string) (string, error) { return run(user, host, key, "/etc/init.d/firewall restart") }
func RefreshWireless(ctx context.Context, user, host, key string) (string, error) { return run(user, host, key, "wifi reload || ubus call network reload") }
