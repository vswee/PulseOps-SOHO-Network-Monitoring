package config

import (
	"encoding/json"
	"errors"
	"strings"
)

func parseJSON(b []byte) (*Config, error) {
	c := &Config{}
	if err := json.Unmarshal(b, c); err != nil {
		return nil, err
	}
	return c, nil
}

// Minimal YAML shim for sample configs. For production, use a proper YAML library.
func parseYAML(b []byte) (*Config, error) {
	s := string(b)
	s = strings.ReplaceAll(s, "\t", "")
	c := &Config{}
	lines := strings.Split(s, "\n")
	inDevices := false
	var cur Device
	for _, ln := range lines {
		l := strings.TrimSpace(ln)
		if l == "" || strings.HasPrefix(l, "#") {
			continue
		}
		if l == "iperf:" {
			continue
		}
		if strings.HasPrefix(l, "server:") {
			c.Iperf.Server = strings.TrimSpace(strings.TrimPrefix(l, "server:"))
			continue
		}
		if strings.HasPrefix(l, "seconds:") {
			c.Iperf.Seconds = atoi(strings.TrimSpace(strings.TrimPrefix(l, "seconds:")))
			continue
		}
		if strings.HasPrefix(l, "parallel:") {
			c.Iperf.Parallel = atoi(strings.TrimSpace(strings.TrimPrefix(l, "parallel:")))
			continue
		}
		if strings.HasPrefix(l, "interval_minutes:") {
			c.Iperf.IntervalMinutes = atoi(strings.TrimSpace(strings.TrimPrefix(l, "interval_minutes:")))
			continue
		}
		if strings.HasPrefix(l, "devices:") {
			inDevices = true
			continue
		}
		if !inDevices {
			continue
		}
		if strings.HasPrefix(l, "- ") {
			if cur.Name != "" {
				c.Devices = append(c.Devices, cur)
				cur = Device{}
			}
			l = strings.TrimPrefix(l, "- ")
			if strings.Contains(l, ":") {
				parts := strings.SplitN(l, ":", 2)
				k := strings.TrimSpace(parts[0])
				v := strings.TrimSpace(parts[1])
				v = strim(v)
				switch k {
				case "name":
					cur.Name = v
				case "host":
					cur.Host = v
				case "kind":
					cur.Kind = v
				case "platform":
					cur.Platform = v
				case "user":
					cur.User = v
				case "password":
					cur.Password = v
				case "ssh_key":
					cur.SSHKey = v
				}
			}
			continue
		}
		if strings.Contains(l, ":") {
			parts := strings.SplitN(l, ":", 2)
			k := strings.TrimSpace(parts[0])
			v := strings.TrimSpace(strings.TrimPrefix(l, parts[0]+":"))
			v = strim(v)
			switch k {
			case "name":
				cur.Name = v
			case "host":
				cur.Host = v
			case "kind":
				cur.Kind = v
			case "platform":
				cur.Platform = v
			case "user":
				cur.User = v
			case "password":
				cur.Password = v
			case "ssh_key":
				cur.SSHKey = v
			}
		}
	}
	if cur.Name != "" {
		c.Devices = append(c.Devices, cur)
	}
	if len(c.Devices) == 0 {
		return nil, errors.New("YAML shim failed; use JSON")
	}
	return c, nil
}

func atoi(s string) int {
	n := 0
	for _, r := range s {
		if r >= '0' && r <= '9' {
			n = n*10 + int(r-'0')
		}
	}
	return n
}
func strim(s string) string { return strings.Trim(strings.TrimSpace(s), "'\"") }
