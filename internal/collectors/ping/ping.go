package ping

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/pulseops/pulseops/internal/executil"
)

var (
	reUnix        = regexp.MustCompile(`time[=<]([0-9]+\.?[0-9]*)\s*ms`)
	reUnixSummary = regexp.MustCompile(`=\s*([0-9.]+)/([0-9.]+)/([0-9.]+)/([0-9.]+)`)
	reWin         = regexp.MustCompile(`Average = ([0-9]+)ms`)
)

type pingAttempt struct {
	Args []string
}

// PingOnce executes the system ping utility and returns the average latency in milliseconds.
func PingOnce(ctx context.Context, host string, timeout time.Duration) (float64, error) {
	attempts := buildAttempts(host, timeout)
	return runPingAttempts(ctx, host, timeout, attempts)
}

func buildAttempts(host string, timeout time.Duration) []pingAttempt {
	if runtime.GOOS == "windows" {
		return []pingAttempt{{Args: []string{"-n", "1", "-w", fmt.Sprintf("%d", int(timeout.Milliseconds())), host}}}
	}
	sec := int(timeout.Seconds())
	if sec <= 0 {
		sec = 1
	}
	return []pingAttempt{
		{Args: []string{"-n", "-c", "1", "-W", fmt.Sprintf("%d", sec), host}},
		{Args: []string{"-n", "-c", "1", "-w", fmt.Sprintf("%d", sec+2), host}},
		{Args: []string{"-c", "1", "-W", fmt.Sprintf("%d", sec), host}},
		{Args: []string{"-c", "1", "-w", fmt.Sprintf("%d", sec+2), host}},
		{Args: []string{"-c", "1", host}},
	}
}

func runPingAttempts(ctx context.Context, host string, timeout time.Duration, attempts []pingAttempt) (float64, error) {
	var lastErr error
	deadline, hasDeadline := ctx.Deadline()

	for _, attempt := range attempts {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		attemptTimeout := timeout + 3*time.Second
		if hasDeadline {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				return 0, context.DeadlineExceeded
			}
			if remaining < attemptTimeout {
				attemptTimeout = remaining
			}
		}

		res := executil.Run(ctx, attemptTimeout, "ping", attempt.Args...)
		out := res.Stdout + res.Stderr

		if res.Err != nil {
			if val, ok := tryParse(out); ok {
				return val, nil
			}
			msg := strings.ToLower(out)
			if strings.Contains(msg, "invalid option") || strings.Contains(msg, "usage") || strings.Contains(msg, "busybox") {
				lastErr = fmt.Errorf("ping error with args %v: invalid option", attempt.Args)
				continue
			}
			if strings.Contains(msg, "operation not permitted") {
				return 0, fmt.Errorf("ping requires CAP_NET_RAW: %s", strings.TrimSpace(out))
			}
			if errors.Is(res.Err, context.DeadlineExceeded) {
				lastErr = context.DeadlineExceeded
				continue
			}
			lastErr = fmt.Errorf("ping error: %v; %s", res.Err, strings.TrimSpace(out))
			continue
		}

		if val, ok := tryParse(out); ok {
			return val, nil
		}
		lastErr = fmt.Errorf("failed to parse ping output: %s", strings.TrimSpace(out))
	}

	if lastErr != nil {
		return 0, lastErr
	}
	return 0, fmt.Errorf("ping failed for %s", host)
}

func tryParse(out string) (float64, bool) {
	if runtime.GOOS == "windows" {
		if m := reWin.FindStringSubmatch(out); len(m) == 2 {
			var avg int
			fmt.Sscanf(m[1], "%d", &avg)
			return float64(avg), true
		}
		return 0, false
	}

	if summary := reUnixSummary.FindStringSubmatch(out); len(summary) == 5 {
		var avg float64
		fmt.Sscanf(summary[2], "%f", &avg)
		return avg, true
	}
	if m := reUnix.FindStringSubmatch(out); len(m) == 2 {
		var latency float64
		fmt.Sscanf(m[1], "%f", &latency)
		return latency, true
	}
	return 0, false
}
