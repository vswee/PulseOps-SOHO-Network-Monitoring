package huawei

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"time"
)

type sesTokInfo struct {
	XMLName xml.Name `xml:"response"`
	SesInfo string   `xml:"SesInfo"`
	TokInfo string   `xml:"TokInfo"`
}

type respOK struct {
	XMLName xml.Name `xml:"response"`
	OK      string   `xml:",chardata"`
}

func b64sha256(s string) string {
	h := sha256.Sum256([]byte(s))
	return base64.StdEncoding.EncodeToString(h[:])
}

func tokenisedPassword(user, pass, token string) string {
	p := b64sha256(pass)
	all := user + p + token
	return b64sha256(all)
}

type Client struct {
	Base string
	HC   *http.Client
	Tok  string
}

func New(base string) (*Client, error) {
	jar, _ := cookiejar.New(nil)
	hc := &http.Client{ Timeout: 10 * time.Second, Jar: jar }
	return &Client{ Base: strings.TrimRight(base, "/"), HC: hc }, nil
}

func (c *Client) get(ctx context.Context, path string) (*http.Response, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.Base+path, nil)
	return c.HC.Do(req)
}

func (c *Client) postXML(ctx context.Context, path string, body string) (*http.Response, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.Base+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	if c.Tok != "" {
		req.Header.Set("__RequestVerificationToken", c.Tok)
	}
	return c.HC.Do(req)
}

func (c *Client) refreshToken(ctx context.Context) error {
	for _, ep := range []string{"/api/webserver/SesTokInfo", "/api/webserver/token"} {
		resp, err := c.get(ctx, ep)
		if err != nil { continue }
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		var st sesTokInfo
		if err := xml.Unmarshal(b, &st); err == nil && (st.TokInfo != "" || st.SesInfo != "") {
			c.Tok = st.TokInfo
			return nil
		}
		// Backup: <response><token>value</token></response>
		type t2 struct { XMLName xml.Name `xml:"response"`; Token string `xml:"token"` }
		var alt t2
		if err := xml.Unmarshal(b, &alt); err == nil && alt.Token != "" {
			c.Tok = alt.Token
			return nil
		}
	}
	return fmt.Errorf("failed to fetch token")
}

func (c *Client) login(ctx context.Context, user, pass string) error {
	if err := c.refreshToken(ctx); err != nil { return err }
	pwd := tokenisedPassword(user, pass, c.Tok)
	body := fmt.Sprintf("<request><Username>%s</Username><Password>%s</Password><password_type>4</password_type></request>", user, pwd)
	resp, err := c.postXML(ctx, "/api/user/login", body)
	if err != nil { return err }
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var ok respOK
	if err := xml.Unmarshal(b, &ok); err == nil && strings.EqualFold(strings.TrimSpace(ok.OK), "OK") {
		if toks := resp.Header.Values("__RequestVerificationToken"); len(toks) > 0 { c.Tok = toks[0] }
		return nil
	}
	// Retry once
	if err := c.refreshToken(ctx); err == nil {
		pwd = tokenisedPassword(user, pass, c.Tok)
		resp2, err2 := c.postXML(ctx, "/api/user/login", body)
		if err2 == nil {
			defer resp2.Body.Close()
			b2, _ := io.ReadAll(resp2.Body)
			if err := xml.Unmarshal(b2, &ok); err == nil && strings.EqualFold(strings.TrimSpace(ok.OK), "OK") {
				if toks := resp2.Header.Values("__RequestVerificationToken"); len(toks) > 0 { c.Tok = toks[0] }
				return nil
			}
		}
	}
	return fmt.Errorf("login failed: %s", string(b))
}

func (c *Client) reboot(ctx context.Context) error {
	endpoints := []struct{ path, body string }{
		{"/api/device/control", "<request><Control>1</Control></request>"},
		{"/api/device/control", "<request><DeviceControl>1</DeviceControl></request>"},
		{"/api/device/reboot", "<request><reboot>1</reboot></request>"},
		{"/api/reset/reboot", "<request><Reset>1</Reset></request>"},
	}
	for _, ep := range endpoints {
		resp, err := c.postXML(ctx, ep.path, ep.body)
		if err != nil { continue }
		b, _ := io.ReadAll(resp.Body); resp.Body.Close()
		var ok respOK
		if err := xml.Unmarshal(b, &ok); err == nil && strings.EqualFold(strings.TrimSpace(ok.OK), "OK") { return nil }
		if resp.StatusCode == 200 && strings.Contains(strings.ToUpper(string(b)), "OK") { return nil }
	}
	return fmt.Errorf("reboot request not acknowledged by device")
}

func Reboot(ctx context.Context, host, user, pass string) (string, error) {
	base := host
	if !strings.HasPrefix(base, "http") { base = "http://" + base }
	cli, err := New(base)
	if err != nil { return "", err }
	if err := cli.login(ctx, user, pass); err != nil { return "", err }
	if err := cli.reboot(ctx); err != nil { return "", err }
	return "OK", nil
}
