package netgear

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

type client struct {
	baseURL   string
	http      *http.Client
	basicUser string
	basicPass string
}

func newClient(base string) (*client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	hc := &http.Client{
		Timeout: 15 * time.Second,
		Jar:     jar,
	}
	return &client{baseURL: strings.TrimRight(base, "/"), http: hc}, nil
}

func (c *client) do(req *http.Request) (*http.Response, error) {
	if c.basicUser != "" {
		req.SetBasicAuth(c.basicUser, c.basicPass)
	}
	req.Header.Set("User-Agent", "PulseOps-Netgear/1.0")
	return c.http.Do(req)
}

func (c *client) tryBasic(ctx context.Context, user, pass, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.SetBasicAuth(user, pass)
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("basic auth rejected")
	}
	c.basicUser = user
	c.basicPass = pass
	return nil
}

func (c *client) tryForm(ctx context.Context, path string, data url.Values) error {
	encoded := data.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, strings.NewReader(encoded))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Referer", c.baseURL+path)
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	status := resp.StatusCode
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return fmt.Errorf("form login rejected: %d", status)
	}
	text := strings.ToLower(string(body))
	if strings.Contains(text, "invalid") || strings.Contains(text, "error") {
		return fmt.Errorf("login response indicated failure")
	}
	if status >= 400 {
		return fmt.Errorf("login returned status %d", status)
	}
	if cookies := c.http.Jar.Cookies(req.URL); len(cookies) > 0 {
		return nil
	}
	if status == http.StatusOK || status == http.StatusFound || status == http.StatusSeeOther {
		return nil
	}
	return fmt.Errorf("login response unrecognised")
}

func (c *client) login(ctx context.Context, user, pass string) error {
	username := strings.TrimSpace(user)
	if username == "" {
		username = "admin"
	}
	attempts := []func(context.Context) error{
		func(ctx context.Context) error { return c.tryBasic(ctx, username, pass, "/") },
		func(ctx context.Context) error { return c.tryBasic(ctx, username, pass, "/index.htm") },
	}
	formAttempts := []struct {
		path string
		data url.Values
	}{
		{path: "/login.cgi", data: url.Values{"username": {username}, "password": {pass}}},
		{path: "/login.cgi", data: url.Values{"user": {username}, "pass": {pass}}},
		{path: "/cgi-bin/Session.cgi", data: url.Values{"Action": {"login"}, "username": {username}, "password": {pass}}},
		{path: "/cgi-bin/Session.cgi", data: url.Values{"action": {"login"}, "username": {username}, "password": {pass}}},
		{path: "/userRpm/LoginRpm.htm", data: url.Values{"username": {username}, "password": {pass}}},
	}
	for _, attempt := range formAttempts {
		a := attempt
		attempts = append(attempts, func(ctx context.Context) error {
			return c.tryForm(ctx, a.path, a.data)
		})
	}
	var lastErr error
	for _, fn := range attempts {
		if err := fn(ctx); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no login attempts executed")
	}
	return lastErr
}

func (c *client) reboot(ctx context.Context) error {
	type action struct {
		method string
		path   string
		data   url.Values
	}
	actions := []action{
		{method: http.MethodPost, path: "/apply.cgi", data: url.Values{"page": {"Reboot"}, "action": {"Apply"}}},
		{method: http.MethodPost, path: "/apply.cgi", data: url.Values{"page": {"reboot"}, "Action": {"1"}}},
		{method: http.MethodPost, path: "/apply.cgi", data: url.Values{"page": {"reboot"}, "action": {"1"}}},
		{method: http.MethodGet, path: "/apply.cgi?Reboot=1"},
		{method: http.MethodGet, path: "/reboot.cgi"},
		{method: http.MethodGet, path: "/restart.cgi"},
		{method: http.MethodGet, path: "/setup.cgi?todo=reboot"},
		{method: http.MethodPost, path: "/cgi-bin/command", data: url.Values{"Command": {"reboot"}}},
		{method: http.MethodPost, path: "/cgi-bin/Command", data: url.Values{"Command": {"reboot"}}},
		{method: http.MethodPost, path: "/adv_reboot.cgi", data: url.Values{"button": {"Yes"}}},
	}

	for _, act := range actions {
		var req *http.Request
		var err error
		if act.method == http.MethodPost {
			encoded := ""
			if act.data != nil {
				encoded = act.data.Encode()
			}
			req, err = http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+act.path, strings.NewReader(encoded))
			if err != nil {
				continue
			}
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		} else {
			req, err = http.NewRequestWithContext(ctx, act.method, c.baseURL+act.path, nil)
			if err != nil {
				continue
			}
		}
		resp, err := c.do(req)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			continue
		}
		if resp.StatusCode >= 400 {
			continue
		}
		text := strings.ToLower(string(body))
		switch {
		case strings.Contains(text, "rebooting"), strings.Contains(text, "restarting"), strings.Contains(text, "please wait"), strings.Contains(text, "device is rebooting"):
			return nil
		case len(body) == 0:
			return nil
		case resp.StatusCode == http.StatusFound || resp.StatusCode == http.StatusSeeOther:
			return nil
		case strings.Contains(text, "success"), strings.Contains(text, "ok"):
			return nil
		}
	}
	return fmt.Errorf("failed to trigger reboot")
}

// Reboot authenticates with the Netgear web interface and issues a reboot command.
func Reboot(ctx context.Context, host, user, pass string) (string, error) {
	trimmed := strings.TrimSpace(host)
	if trimmed == "" {
		return "", fmt.Errorf("host is required")
	}
	candidates := []string{}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		candidates = append(candidates, strings.TrimRight(trimmed, "/"))
	} else {
		candidates = append(candidates, "https://"+trimmed, "http://"+trimmed)
	}
	var lastErr error
	for _, base := range candidates {
		cli, err := newClient(base)
		if err != nil {
			lastErr = err
			continue
		}
		if err := cli.login(ctx, user, pass); err != nil {
			lastErr = err
			continue
		}
		if err := cli.reboot(ctx); err != nil {
			lastErr = err
			continue
		}
		return "OK", nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("unable to contact device")
	}
	return "", lastErr
}
