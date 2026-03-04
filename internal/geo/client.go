package geo

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultBaseURL   = "https://geo.flat18.app/api/ipinfo"
	defaultSource    = "flat18"
	maxResponseBytes = 1 << 20 // 1 MiB
)

type Config struct {
	BaseURL    string
	APIToken   string
	HTTPClient *http.Client
	Timeout    time.Duration
	Source     string
}

type Client struct {
	BaseURL    string
	APIToken   string
	HTTPClient *http.Client
	Timeout    time.Duration
	Source     string
}

func NewClient(cfg Config) *Client {
	base := strings.TrimSpace(cfg.BaseURL)
	if base == "" {
		base = defaultBaseURL
	}
	token := strings.TrimSpace(cfg.APIToken)
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	source := strings.TrimSpace(cfg.Source)
	if source == "" {
		source = defaultSource
	}
	return &Client{
		BaseURL:    base,
		APIToken:   token,
		HTTPClient: cfg.HTTPClient,
		Timeout:    timeout,
		Source:     source,
	}
}

func (c *Client) LookupIP(ctx context.Context, ip string) (*Result, []byte, error) {
	if c == nil {
		return nil, nil, fmt.Errorf("geolocation client not configured")
	}
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return nil, nil, fmt.Errorf("ip address required")
	}
	if c.APIToken == "" {
		return nil, nil, fmt.Errorf("geolocation api token not configured")
	}

	endpoint, err := url.Parse(c.BaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid geolocation base url: %w", err)
	}
	query := endpoint.Query()
	query.Set("ip", ip)
	endpoint.RawQuery = query.Encode()

	if c.Timeout > 0 {
		if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > c.Timeout {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, c.Timeout)
			defer cancel()
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, nil, fmt.Errorf("build geolocation request: %w", err)
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.APIToken))
	req.Header.Set("Accept", "application/json")

	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("geolocation request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, nil, fmt.Errorf("geolocation response read failed: %w", err)
	}
	if resp.StatusCode >= 400 {
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = resp.Status
		}
		return nil, body, fmt.Errorf("geolocation lookup failed: %s", message)
	}

	result, err := Parse(body)
	if err != nil {
		return nil, body, err
	}
	if result.Source == "" {
		result.Source = c.Source
	}
	return result, body, nil
}
