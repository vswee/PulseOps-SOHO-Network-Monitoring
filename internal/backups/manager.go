package backups

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/pulseops/pulseops/internal/keys"
	"github.com/pulseops/pulseops/internal/store"
)

const (
	// DefaultInterval is the default time between automated device backups.
	DefaultInterval    = 24 * time.Hour
	maxBackupSizeBytes = 50 << 20 // 50 MiB safety limit per backup
	backupTimeout      = 2 * time.Minute
)

// Manager coordinates device configuration backups.
type Manager struct {
	DB   *store.Store
	Keys *keys.Manager
}

// NewManager constructs a backup manager.
func NewManager(db *store.Store, keyManager *keys.Manager) *Manager {
	return &Manager{DB: db, Keys: keyManager}
}

// Capture triggers a backup for the specified device and stores the resulting archive.
func (m *Manager) Capture(ctx context.Context, deviceID int64) (*store.DeviceBackup, error) {
	if deviceID <= 0 {
		return nil, fmt.Errorf("invalid device id")
	}
	if m == nil || m.DB == nil {
		return nil, fmt.Errorf("backup manager not initialised")
	}

	row := m.DB.DB.QueryRow(`SELECT name, host, kind, platform, user, ssh_key, password, meta FROM devices WHERE id=?`, deviceID)
	var name, host, kind, platform, user, sshKey string
	var password sql.NullString
	var meta sql.NullString
	if err := row.Scan(&name, &host, &kind, &platform, &user, &sshKey, &password, &meta); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("device not found")
		}
		return nil, err
	}
	if strings.TrimSpace(host) == "" {
		return nil, fmt.Errorf("device host not configured")
	}
	if !Supports(platform) {
		return nil, fmt.Errorf("backups not supported for platform %s", platform)
	}

	port := 22
	if meta.Valid {
		if p := parseSSHPortFromMeta(meta.String); p > 0 {
			port = p
		}
	}

	loginUser := strings.TrimSpace(user)
	if loginUser == "" {
		loginUser = DefaultUser(platform)
	}
	if loginUser == "" {
		loginUser = "root"
	}

	keyPath, cleanup, err := m.resolveSSHKey(sshKey)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if strings.TrimSpace(keyPath) == "" {
		return nil, fmt.Errorf("device backup requires an SSH key")
	}

	backupCtx, cancel := context.WithTimeout(ctx, backupTimeout)
	defer cancel()

	data, mediaType, ext, err := fetchDeviceBackup(backupCtx, platform, loginUser, host, port, keyPath)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("device returned empty backup data")
	}
	if len(data) > maxBackupSizeBytes {
		return nil, fmt.Errorf("backup exceeds size limit (%d bytes)", len(data))
	}

	slug := slugifyFilename(name)
	if slug == "" {
		slug = slugifyFilename(host)
	}
	timestamp := time.Now().UTC().Format("20060102-150405")
	filename := fmt.Sprintf("%s-%s%s", slug, timestamp, ext)

	backup, err := m.DB.InsertDeviceBackup(deviceID, filename, mediaType, int64(len(data)), data)
	if err != nil {
		return nil, err
	}

	_ = m.DB.InsertDeviceLog(deviceID, "info", fmt.Sprintf("Backup stored (%s)", formatBytes(int64(len(data)))))
	_ = m.DB.InsertSystemLog("info", "device.backup", fmt.Sprintf("Backup captured for %s", name), map[string]any{
		"device_id":  deviceID,
		"backup_id":  backup.ID,
		"size_bytes": len(data),
		"platform":   platform,
	})

	return backup, nil
}

// Supports reports whether the provided platform has automated backup support.
func Supports(platform string) bool {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "openwrt", "edgeos":
		return true
	default:
		return false
	}
}

// DefaultUser returns the default SSH user for the given platform when running backups.
func DefaultUser(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "edgeos":
		return "ubnt"
	default:
		return "root"
	}
}

// IntervalFromMeta extracts a preferred backup interval from the device meta JSON string.
// When no preference is provided the DefaultInterval is returned.
func IntervalFromMeta(meta string) time.Duration {
	meta = strings.TrimSpace(meta)
	if meta == "" {
		return DefaultInterval
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(meta), &obj); err != nil {
		return DefaultInterval
	}
	if v, ok := obj["backup_interval"]; ok {
		if d, ok := parseIntervalValue(v, time.Hour); ok {
			return clampInterval(d)
		}
	}
	if v, ok := obj["backup_interval_hours"]; ok {
		if d, ok := parseIntervalValue(v, time.Hour); ok {
			return clampInterval(d)
		}
	}
	if v, ok := obj["backup_interval_minutes"]; ok {
		if d, ok := parseIntervalValue(v, time.Minute); ok {
			return clampInterval(d)
		}
	}
	return DefaultInterval
}

// NextScheduled returns the next backup time based on the most recent backup and interval.
func NextScheduled(last time.Time, now time.Time, interval time.Duration) time.Time {
	if interval <= 0 {
		interval = DefaultInterval
	}
	if last.IsZero() {
		return now.Add(interval)
	}
	next := last.Add(interval)
	for !next.After(now) {
		next = next.Add(interval)
	}
	return next
}

func parseIntervalValue(value any, unit time.Duration) (time.Duration, bool) {
	switch v := value.(type) {
	case string:
		v = strings.TrimSpace(v)
		if v == "" {
			return 0, false
		}
		if d, err := time.ParseDuration(v); err == nil {
			return d, true
		}
		if n, err := strconv.Atoi(v); err == nil {
			return time.Duration(n) * unit, true
		}
	case float64:
		if v <= 0 {
			return 0, false
		}
		return time.Duration(v) * unit, true
	case int:
		if v <= 0 {
			return 0, false
		}
		return time.Duration(v) * unit, true
	case int64:
		if v <= 0 {
			return 0, false
		}
		return time.Duration(v) * unit, true
	}
	return 0, false
}

func clampInterval(d time.Duration) time.Duration {
	if d <= 0 {
		return DefaultInterval
	}
	if d < time.Hour {
		return time.Hour
	}
	if d > 14*24*time.Hour {
		return 14 * 24 * time.Hour
	}
	return d
}

func parseSSHPortFromMeta(meta string) int {
	var obj map[string]any
	dec := json.NewDecoder(strings.NewReader(meta))
	dec.UseNumber()
	if err := dec.Decode(&obj); err != nil {
		return 22
	}
	if v, ok := obj["ssh_port"]; ok {
		switch t := v.(type) {
		case json.Number:
			if port, err := t.Int64(); err == nil {
				if port > 0 && port <= 65535 {
					return int(port)
				}
			}
		case string:
			if port, err := strconv.Atoi(strings.TrimSpace(t)); err == nil {
				if port > 0 && port <= 65535 {
					return port
				}
			}
		case float64:
			port := int(t)
			if port > 0 && port <= 65535 {
				return port
			}
		}
	}
	return 22
}

func (m *Manager) resolveSSHKey(value string) (string, func(), error) {
	if strings.TrimSpace(value) == "" {
		return "", func() {}, nil
	}
	if _, ok := keys.ParseReference(value); ok {
		if m.Keys == nil {
			return "", func() {}, fmt.Errorf("stored ssh key is unavailable")
		}
		return m.Keys.ResolvePath(value)
	}
	return value, func() {}, nil
}

func fetchDeviceBackup(ctx context.Context, platform, user, host string, port int, keyPath string) ([]byte, string, string, error) {
	platform = strings.ToLower(strings.TrimSpace(platform))
	switch platform {
	case "openwrt":
		cmd := "sysupgrade -b -"
		if !strings.EqualFold(strings.TrimSpace(user), "root") {
			cmd = "sudo " + cmd
		}
		data, err := sshCapture(ctx, user, host, port, keyPath, cmd)
		return data, "application/gzip", ".tar.gz", err
	case "edgeos":
		cmd := "tar -czf - /config"
		if !strings.EqualFold(strings.TrimSpace(user), "root") {
			cmd = "sudo " + cmd
		}
		data, err := sshCapture(ctx, user, host, port, keyPath, cmd)
		return data, "application/gzip", ".tar.gz", err
	default:
		return nil, "", "", fmt.Errorf("backups not supported for platform %s", platform)
	}
}

func sshCapture(ctx context.Context, user, host string, port int, keyPath, cmd string) ([]byte, error) {
	if port <= 0 {
		port = 22
	}
	args := []string{"-p", strconv.Itoa(port), "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "GlobalKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20"}
	if strings.TrimSpace(keyPath) != "" {
		args = append([]string{"-i", keyPath}, args...)
	}
	target := fmt.Sprintf("%s@%s", user, host)
	args = append(args, target, cmd)
	command := exec.CommandContext(ctx, "ssh", args...)
	return command.Output()
}

func slugifyFilename(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "backup"
	}
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
			lastDash = false
		case r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case r == '-' || r == '_':
			b.WriteRune(r)
			lastDash = false
		case r == '.' || r == ' ' || r == '/' || r == '\\':
			if !lastDash {
				b.WriteRune('-')
				lastDash = true
			}
		default:
			// skip other characters
		}
	}
	out := strings.Trim(b.String(), "-_ ")
	if out == "" {
		return "backup"
	}
	return out
}

func formatBytes(size int64) string {
	if size < 1024 {
		return fmt.Sprintf("%d B", size)
	}
	units := []string{"KB", "MB", "GB", "TB"}
	v := float64(size)
	for _, unit := range units {
		v /= 1024
		if v < 1024 {
			return fmt.Sprintf("%.1f %s", v, unit)
		}
	}
	return fmt.Sprintf("%.1f PB", v/1024)
}
