package iperf3c

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/pulseops/pulseops/internal/executil"
)

func Run(ctx context.Context, serverHost string, seconds int, parallel int) (mbps float64, raw string, err error) {
	args := []string{"-J", "-t", fmt.Sprintf("%d", seconds), "-P", fmt.Sprintf("%d", parallel), "-c", serverHost}
	res := executil.Run(ctx, time.Duration(seconds+3)*time.Second, "iperf3", args...)
	if res.Err != nil {
		return 0, res.Stdout+res.Stderr, fmt.Errorf("iperf3: %v", res.Err)
	}
	raw = res.Stdout
	var parsed map[string]any
	if err := json.Unmarshal([]byte(res.Stdout), &parsed); err != nil {
		return 0, raw, fmt.Errorf("iperf3 parse: %v", err)
	}
	if end, ok := parsed["end"].(map[string]any); ok {
		if sum, ok := end["sum_sent"].(map[string]any); ok {
			if bps, ok := sum["bits_per_second"].(float64); ok { return bps/1e6, raw, nil }
		}
		if sum, ok := end["sum_received"].(map[string]any); ok {
			if bps, ok := sum["bits_per_second"].(float64); ok { return bps/1e6, raw, nil }
		}
	}
	return 0, raw, fmt.Errorf("iperf3: missing fields")
}
