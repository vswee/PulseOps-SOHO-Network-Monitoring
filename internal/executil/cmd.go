package executil

import (
	"bytes"
	"context"
	"os/exec"
	"time"
)

type Result struct {
	Stdout string
	Stderr string
	Err    error
}

func Run(ctx context.Context, timeout time.Duration, name string, args ...string) Result {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	return Result{Stdout: out.String(), Stderr: errb.String(), Err: err}
}
