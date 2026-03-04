package store

import (
	"crypto/rand"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pulseops/pulseops/internal/network"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

type Store struct{ DB *sql.DB }

// DeviceRecord represents a device row as stored in the database.
type DeviceRecord struct {
	ID                 int64
	Name               string
	Host               string
	Kind               string
	Platform           string
	User               string
	SSHKey             string
	Password           string
	Meta               string
	Connection         string
	ConnectionOverride bool
}

// User represents a user account
type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email,omitempty"`
	IsAdmin   bool      `json:"is_admin"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Session represents an active user session
type Session struct {
	ID           string    `json:"id"`
	UserID       int64     `json:"user_id"`
	CreatedAt    time.Time `json:"created_at"`
	ExpiresAt    time.Time `json:"expires_at"`
	LastAccessed time.Time `json:"last_accessed"`
}

const pendingDeletionTableDDL = `CREATE TABLE IF NOT EXISTS pending_device_deletions (
  device_id INTEGER PRIMARY KEY,
  delete_at TEXT NOT NULL,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);`

const deletedDevicesTableDDL = `CREATE TABLE IF NOT EXISTS deleted_devices (
  name TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`

const networkRangeMediumTableDDL = `CREATE TABLE IF NOT EXISTS network_range_medium (
  id TEXT PRIMARY KEY,
  network TEXT,
  start TEXT,
  end TEXT,
  medium TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);`

const ipGeolocationTableDDL = `CREATE TABLE IF NOT EXISTS ip_geolocation (
  ip TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);`

type Metric struct {
	ID       int64           `json:"id"`
	DeviceID int64           `json:"device_id"`
	TS       time.Time       `json:"ts"`
	Metric   string          `json:"metric"`
	Value    sql.NullFloat64 `json:"value"`
	Unit     sql.NullString  `json:"unit"`
	Raw      sql.NullString  `json:"raw"`
}

type DeviceLog struct {
	ID       int64     `json:"id"`
	DeviceID int64     `json:"device_id"`
	TS       time.Time `json:"ts"`
	Level    string    `json:"level"`
	Message  string    `json:"message"`
}

type DeviceLogWithMeta struct {
	DeviceLog
	DeviceName string `json:"device_name"`
	DeviceKind string `json:"device_kind"`
	DeviceHost string `json:"device_host"`
}

type DeviceBackup struct {
	ID        int64     `json:"id"`
	DeviceID  int64     `json:"device_id"`
	Filename  string    `json:"filename"`
	MediaType string    `json:"media_type"`
	Size      int64     `json:"size_bytes"`
	CreatedAt time.Time `json:"created_at"`
	Data      []byte    `json:"-"`
}

// Topology mapping structs
type MapGroup struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	ParentID  *string   `json:"parent_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Children  []string  `json:"children,omitempty"`
	MapIDs    []string  `json:"map_ids,omitempty"`
}

type AlertCounts struct {
	Critical int `json:"critical"`
	Warning  int `json:"warning"`
	Info     int `json:"info"`
}

type MapFilters struct {
	Origin  string   `json:"origin"`
	Applied []string `json:"applied"`
}

type SavedMap struct {
	ID               string      `json:"id"`
	Name             string      `json:"name"`
	Description      string      `json:"description"`
	GroupID          string      `json:"group_id"`
	Author           string      `json:"author"`
	Layout           string      `json:"layout"`
	TimeRange        string      `json:"time_range"`
	ShowAlerts       bool        `json:"show_alerts"`
	AllEdges         bool        `json:"all_edges"`
	ShowUndiscovered bool        `json:"show_undiscovered"`
	PinnedNodeCount  int         `json:"pinned_node_count"`
	AlertCounts      AlertCounts `json:"alert_counts"`
	Filters          MapFilters  `json:"filters"`
	CreatedAt        time.Time   `json:"created_at"`
	UpdatedAt        time.Time   `json:"updated_at"`
}

type MapNode struct {
	ID       string         `json:"id"`
	Label    string         `json:"label"`
	Type     string         `json:"type"`
	Status   string         `json:"status"`
	Pinned   bool           `json:"pinned"`
	Position map[string]any `json:"position"`
	Layer    int            `json:"layer,omitempty"`
	Alerts   AlertCounts    `json:"alerts"`
	Props    map[string]any `json:"props"`
}

type MapEdge struct {
	ID      string         `json:"id"`
	From    string         `json:"from"`
	To      string         `json:"to"`
	Kind    string         `json:"kind"`
	Status  string         `json:"status,omitempty"`
	Metrics map[string]any `json:"metrics,omitempty"`
}

type MapTransform struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Scale float64 `json:"scale"`
}

type MapCanvasData struct {
	MapID     string       `json:"map_id"`
	Nodes     []MapNode    `json:"nodes"`
	Edges     []MapEdge    `json:"edges"`
	Transform MapTransform `json:"transform"`
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`
}

type IPGeolocationRecord struct {
	IP        string
	Response  string
	FetchedAt time.Time
}

type DeviceLogFilter struct {
	DeviceIDs  []int64
	DeviceKind string
	Level      string
	Search     string
	Since      time.Time
	Limit      int
}

type SystemLogEntry struct {
	ID       int64     `json:"id"`
	TS       time.Time `json:"ts"`
	Level    string    `json:"level"`
	Category string    `json:"category"`
	Message  string    `json:"message"`
	Context  string    `json:"context"`
}

type SystemLogFilter struct {
	Level    string
	Category string
	Search   string
	Since    time.Time
	Limit    int
}

type PendingDeletion struct {
	DeviceID int64
	DeleteAt time.Time
}

type ManualDiscoveryRange struct {
	ID        string    `json:"id"`
	Label     string    `json:"label"`
	Kind      string    `json:"kind"`
	Network   string    `json:"network"`
	Start     string    `json:"start"`
	End       string    `json:"end"`
	PingHost  string    `json:"ping_host"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type RangeMedium struct {
	ID        string    `json:"id"`
	Network   string    `json:"network"`
	Start     string    `json:"start"`
	End       string    `json:"end"`
	Medium    string    `json:"medium"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SSHKeyMeta struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Fingerprint string `json:"fingerprint"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type SSHKey struct {
	SSHKeyMeta
	Encrypted []byte `json:"-"`
}

func toNullableString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func normaliseLinkValue(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "wireless", "wifi", "wi-fi":
		return "wireless"
	default:
		return "wired"
	}
}

func scanManualDiscoveryRange(scanner interface{ Scan(dest ...any) error }) (ManualDiscoveryRange, error) {
	var (
		rec       ManualDiscoveryRange
		network   sql.NullString
		start     sql.NullString
		end       sql.NullString
		pingHost  sql.NullString
		createdAt sql.NullString
		updatedAt sql.NullString
	)
	if err := scanner.Scan(&rec.ID, &rec.Label, &rec.Kind, &network, &start, &end, &pingHost, &createdAt, &updatedAt); err != nil {
		return rec, err
	}
	if network.Valid {
		rec.Network = strings.TrimSpace(network.String)
	}
	if start.Valid {
		rec.Start = strings.TrimSpace(start.String)
	}
	if end.Valid {
		rec.End = strings.TrimSpace(end.String)
	}
	if pingHost.Valid {
		rec.PingHost = strings.TrimSpace(pingHost.String)
	}
	if createdAt.Valid {
		if ts, err := parseSQLiteTimestamp(createdAt.String); err == nil {
			rec.CreatedAt = ts
		}
	}
	if updatedAt.Valid {
		if ts, err := parseSQLiteTimestamp(updatedAt.String); err == nil {
			rec.UpdatedAt = ts
		}
	}
	if strings.TrimSpace(rec.Kind) == "" {
		rec.Kind = "network"
	}
	return rec, nil
}

func OpenSQLite(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if _, err := db.Exec(`PRAGMA busy_timeout = 5000`); err != nil {
		return nil, fmt.Errorf("set busy timeout: %w", err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		return nil, fmt.Errorf("enable wal: %w", err)
	}
	if _, err := db.Exec(`PRAGMA synchronous = NORMAL`); err != nil {
		return nil, fmt.Errorf("set synchronous mode: %w", err)
	}
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	if err := ensureDevicePasswordColumn(db); err != nil {
		return nil, err
	}
	if err := ensureDeviceConnectionColumns(db); err != nil {
		return nil, err
	}
	s := &Store{DB: db}
	if err := s.ensurePendingDeletionTable(); err != nil {
		return nil, fmt.Errorf("ensure pending deletions table: %w", err)
	}
	if err := s.ensureDeletedDevicesTable(); err != nil {
		return nil, fmt.Errorf("ensure deleted devices table: %w", err)
	}
	if err := s.ensureNetworkRangeMediumTable(); err != nil {
		return nil, fmt.Errorf("ensure network range medium table: %w", err)
	}
	return s, nil
}

func (s *Store) Close() { s.DB.Close() }

func ensureDevicePasswordColumn(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(devices)`)
	if err != nil {
		return fmt.Errorf("inspect devices table: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid       int
			name      string
			ctype     string
			notNull   int
			dfltValue sql.NullString
			pk        int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dfltValue, &pk); err != nil {
			return fmt.Errorf("scan devices table info: %w", err)
		}
		if strings.EqualFold(name, "password") {
			return nil
		}
	}
	if _, err := db.Exec(`ALTER TABLE devices ADD COLUMN password TEXT`); err != nil {
		return fmt.Errorf("add devices.password column: %w", err)
	}
	return nil
}

func ensureDeviceConnectionColumns(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(devices)`)
	if err != nil {
		return fmt.Errorf("inspect devices table: %w", err)
	}
	defer rows.Close()

	hasConnection := false
	hasOverride := false

	for rows.Next() {
		var (
			cid       int
			name      string
			ctype     string
			notNull   int
			dfltValue sql.NullString
			pk        int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dfltValue, &pk); err != nil {
			return fmt.Errorf("scan devices table info: %w", err)
		}
		switch {
		case strings.EqualFold(name, "connection"):
			hasConnection = true
		case strings.EqualFold(name, "connection_override"):
			hasOverride = true
		}
	}

	if !hasConnection {
		if _, err := db.Exec(`ALTER TABLE devices ADD COLUMN connection TEXT NOT NULL DEFAULT 'wired'`); err != nil {
			return fmt.Errorf("add devices.connection column: %w", err)
		}
	}
	if !hasOverride {
		if _, err := db.Exec(`ALTER TABLE devices ADD COLUMN connection_override BOOLEAN NOT NULL DEFAULT 0`); err != nil {
			return fmt.Errorf("add devices.connection_override column: %w", err)
		}
	}
	return nil
}

func (s *Store) UpsertDevice(name, host, kind, platform, user, sshKey, password, meta, connection string, override bool) (int64, error) {
	if err := s.clearDeletedDevice(name); err != nil {
		return 0, err
	}
	connection = normaliseLinkValue(connection)
	overrideValue := 0
	if override {
		overrideValue = 1
	}
	_, err := s.DB.Exec(`INSERT OR IGNORE INTO devices(name,host,kind,platform,user,connection,connection_override,ssh_key,password,meta) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		name, host, kind, platform, user, connection, overrideValue, sshKey, password, meta)
	if err != nil {
		return 0, err
	}
	var id int64
	err = s.DB.QueryRow(`SELECT id FROM devices WHERE name=?`, name).Scan(&id)
	return id, err
}

// ListDeviceRecords returns a typed view over devices for background workers.
func (s *Store) ListDeviceRecords() ([]DeviceRecord, error) {
	rows, err := s.DB.Query(`SELECT id, name, host, kind, platform, user, connection, connection_override, ssh_key, password, meta FROM devices ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var devices []DeviceRecord
	for rows.Next() {
		var rec DeviceRecord
		var password sql.NullString
		var meta sql.NullString
		var connection sql.NullString
		var override sql.NullInt64
		if err := rows.Scan(&rec.ID, &rec.Name, &rec.Host, &rec.Kind, &rec.Platform, &rec.User, &connection, &override, &rec.SSHKey, &password, &meta); err != nil {
			return nil, err
		}
		if password.Valid {
			rec.Password = password.String
		}
		if meta.Valid {
			rec.Meta = meta.String
		}
		if connection.Valid {
			rec.Connection = normaliseLinkValue(connection.String)
		} else {
			rec.Connection = "wired"
		}
		rec.ConnectionOverride = override.Valid && override.Int64 != 0
		devices = append(devices, rec)
	}
	return devices, rows.Err()
}

func (s *Store) ListDevices() ([]map[string]any, error) {
	if err := s.ensurePendingDeletionTable(); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(`SELECT d.id,d.name,d.host,d.kind,d.platform,d.user,d.connection,d.connection_override,d.ssh_key,d.password,d.meta,pd.delete_at,
                (SELECT id FROM device_backups WHERE device_id=d.id ORDER BY created_at DESC LIMIT 1) AS latest_backup_id,
                (SELECT created_at FROM device_backups WHERE device_id=d.id ORDER BY created_at DESC LIMIT 1) AS latest_backup_at,
                (SELECT raw FROM metrics WHERE device_id=d.id AND metric='network_classification' ORDER BY ts DESC LIMIT 1) AS network_classification_raw,
                (SELECT ts FROM metrics WHERE device_id=d.id AND metric='network_classification' ORDER BY ts DESC LIMIT 1) AS network_classification_ts
                FROM devices d LEFT JOIN pending_device_deletions pd ON pd.device_id=d.id ORDER BY d.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int64
		var name, host, kind, platform, user, ssh string
		var password, meta sql.NullString
		var pending sql.NullString
		var latestID sql.NullInt64
		var latestAt sql.NullString
		var classificationRaw sql.NullString
		var classificationTS sql.NullTime
		var connection sql.NullString
		var override sql.NullInt64
		if err := rows.Scan(&id, &name, &host, &kind, &platform, &user, &connection, &override, &ssh, &password, &meta, &pending, &latestID, &latestAt, &classificationRaw, &classificationTS); err != nil {
			return nil, err
		}
		entry := map[string]any{
			"id":       id,
			"name":     name,
			"host":     host,
			"kind":     kind,
			"platform": platform,
			"user":     user,
			"ssh_key":  ssh,
			"password_set": func() bool {
				if !password.Valid {
					return false
				}
				return strings.TrimSpace(password.String) != ""
			}(),
			"meta": func() string {
				if !meta.Valid {
					return ""
				}
				return meta.String
			}(),
		}
		entry["connection"] = func() string {
			if connection.Valid {
				return normaliseLinkValue(connection.String)
			}
			return "wired"
		}()
		entry["connection_override"] = override.Valid && override.Int64 != 0
		entry["pending_delete_at"] = func() any {
			if !pending.Valid || pending.String == "" {
				return nil
			}
			if ts, err := parseDeleteAt(pending.String); err == nil {
				return ts.Format(time.RFC3339)
			}
			return pending.String
		}()
		if latestID.Valid {
			entry["latest_backup_id"] = latestID.Int64
		}
		if latestAt.Valid && latestAt.String != "" {
			if ts, err := parseSQLiteTimestamp(latestAt.String); err == nil {
				entry["latest_backup_at"] = ts.Format(time.RFC3339)
			} else {
				entry["latest_backup_at"] = latestAt.String
			}
		}

		if classificationRaw.Valid && strings.TrimSpace(classificationRaw.String) != "" {
			var result network.ClassificationResult
			if err := json.Unmarshal([]byte(classificationRaw.String), &result); err == nil {
				entry["network_scope"] = string(result.Category)
				if result.Reason != "" {
					entry["network_scope_reason"] = result.Reason
				}
				if result.MatchedSubnet != "" {
					entry["network_scope_matched_subnet"] = result.MatchedSubnet
				}
				if result.IP != "" {
					entry["network_scope_ip"] = result.IP
				}
				entry["network_scope_private"] = result.Private
				entry["network_classification"] = map[string]any{
					"classification": string(result.Category),
					"ip":             result.IP,
					"matched_subnet": result.MatchedSubnet,
					"private":        result.Private,
					"reason":         result.Reason,
				}
			}
		}
		if classificationTS.Valid {
			entry["network_scope_updated_at"] = classificationTS.Time.UTC().Format(time.RFC3339)
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

func (s *Store) ListManualDiscoveryRanges() ([]ManualDiscoveryRange, error) {
	rows, err := s.DB.Query(`SELECT id, label, kind, network, start, end, ping_host, created_at, updated_at FROM manual_discovery_ranges ORDER BY label COLLATE NOCASE, created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ManualDiscoveryRange
	for rows.Next() {
		rec, err := scanManualDiscoveryRange(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *Store) GetManualDiscoveryRange(id string) (*ManualDiscoveryRange, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("range id required")
	}
	row := s.DB.QueryRow(`SELECT id, label, kind, network, start, end, ping_host, created_at, updated_at FROM manual_discovery_ranges WHERE id=?`, id)
	rec, err := scanManualDiscoveryRange(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}

func (s *Store) CreateManualDiscoveryRange(label, kind, network, start, end, pingHost string) (*ManualDiscoveryRange, error) {
	label = strings.TrimSpace(label)
	kind = strings.TrimSpace(strings.ToLower(kind))
	if label == "" {
		return nil, fmt.Errorf("label is required")
	}
	if kind == "" {
		kind = "network"
	}
	id, err := generateManualRangeID()
	if err != nil {
		return nil, err
	}
	_, err = s.DB.Exec(`INSERT INTO manual_discovery_ranges(id, label, kind, network, start, end, ping_host, created_at, updated_at) VALUES(?,?,?,?,?,?,?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		id, label, kind, toNullableString(network), toNullableString(start), toNullableString(end), toNullableString(pingHost))
	if err != nil {
		return nil, err
	}
	return s.GetManualDiscoveryRange(id)
}

func (s *Store) DeleteManualDiscoveryRange(id string) (bool, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return false, fmt.Errorf("range id required")
	}
	res, err := s.DB.Exec(`DELETE FROM manual_discovery_ranges WHERE id=?`, id)
	if err != nil {
		return false, err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	if err := s.DeleteNetworkRangeMedium(id); err != nil {
		// Ignore missing overrides but surface other errors
		if !errors.Is(err, sql.ErrNoRows) {
			return rows > 0, err
		}
	}
	return rows > 0, nil
}

func (s *Store) ListNetworkRangeMedium() ([]RangeMedium, error) {
	if err := s.ensureNetworkRangeMediumTable(); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(`SELECT id, network, start, end, medium, updated_at FROM network_range_medium`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RangeMedium
	for rows.Next() {
		var rec RangeMedium
		var network, start, end, medium sql.NullString
		var updated sql.NullString
		if err := rows.Scan(&rec.ID, &network, &start, &end, &medium, &updated); err != nil {
			return nil, err
		}
		if network.Valid {
			rec.Network = strings.TrimSpace(network.String)
		}
		if start.Valid {
			rec.Start = strings.TrimSpace(start.String)
		}
		if end.Valid {
			rec.End = strings.TrimSpace(end.String)
		}
		rec.Medium = normaliseLinkValue(medium.String)
		if updated.Valid {
			if ts, err := parseSQLiteTimestamp(updated.String); err == nil {
				rec.UpdatedAt = ts
			}
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *Store) ensureIPGeolocationTable() error {
	_, err := s.DB.Exec(ipGeolocationTableDDL)
	return err
}

func (s *Store) GetIPGeolocation(ip string) (*IPGeolocationRecord, error) {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return nil, fmt.Errorf("ip address required")
	}
	if err := s.ensureIPGeolocationTable(); err != nil {
		return nil, err
	}
	row := s.DB.QueryRow(`SELECT ip, response, fetched_at FROM ip_geolocation WHERE ip=?`, ip)
	var rec IPGeolocationRecord
	var fetched sql.NullString
	if err := row.Scan(&rec.IP, &rec.Response, &fetched); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if fetched.Valid && fetched.String != "" {
		if ts, err := parseSQLiteTimestamp(fetched.String); err == nil {
			rec.FetchedAt = ts.UTC()
		}
	}
	return &rec, nil
}

func (s *Store) UpsertIPGeolocation(ip, response string, fetchedAt time.Time) error {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return fmt.Errorf("ip address required")
	}
	if err := s.ensureIPGeolocationTable(); err != nil {
		return err
	}
	fetched := fetchedAt.UTC()
	if fetched.IsZero() {
		fetched = time.Now().UTC()
	}
	_, err := s.DB.Exec(`INSERT INTO ip_geolocation(ip, response, fetched_at) VALUES(?,?,?)
                ON CONFLICT(ip) DO UPDATE SET response=excluded.response, fetched_at=excluded.fetched_at`,
		ip, response, fetched.Format(time.RFC3339))
	return err
}

func (s *Store) SetNetworkRangeMedium(id, network, start, end, medium string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("range id required")
	}
	if err := s.ensureNetworkRangeMediumTable(); err != nil {
		return err
	}
	medium = normaliseLinkValue(medium)
	_, err := s.DB.Exec(`INSERT INTO network_range_medium(id, network, start, end, medium, updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
	ON CONFLICT(id) DO UPDATE SET network=excluded.network, start=excluded.start, end=excluded.end, medium=excluded.medium, updated_at=CURRENT_TIMESTAMP`,
		id, toNullableString(network), toNullableString(start), toNullableString(end), medium)
	return err
}

func (s *Store) DeleteNetworkRangeMedium(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("range id required")
	}
	if err := s.ensureNetworkRangeMediumTable(); err != nil {
		return err
	}
	_, err := s.DB.Exec(`DELETE FROM network_range_medium WHERE id=?`, id)
	return err
}

func (s *Store) InsertMetric(m Metric) error {
	_, err := s.DB.Exec(`INSERT INTO metrics(device_id, ts, metric, value, unit, raw) VALUES(?,?,?,?,?,?)`,
		m.DeviceID, m.TS.UTC(), m.Metric, m.Value, m.Unit, m.Raw)
	return err
}

func (s *Store) LatestMetric(deviceID int64, metric string) (*Metric, error) {
	row := s.DB.QueryRow(`SELECT id, device_id, ts, metric, value, unit, raw FROM metrics WHERE device_id=? AND metric=? ORDER BY ts DESC LIMIT 1`, deviceID, metric)
	var m Metric
	if err := row.Scan(&m.ID, &m.DeviceID, &m.TS, &m.Metric, &m.Value, &m.Unit, &m.Raw); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

func (s *Store) MetricsSince(deviceID int64, metric string, since time.Time, limit int) ([]Metric, error) {
	rows, err := s.DB.Query(`SELECT id, device_id, ts, metric, value, unit, raw FROM metrics WHERE device_id=? AND metric=? AND ts>=? ORDER BY ts LIMIT ?`,
		deviceID, metric, since.UTC(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Metric
	for rows.Next() {
		var m Metric
		if err := rows.Scan(&m.ID, &m.DeviceID, &m.TS, &m.Metric, &m.Value, &m.Unit, &m.Raw); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) AverageMetricSince(deviceID int64, metric string, since time.Time, limit int) (sql.NullFloat64, int64, error) {
	if limit <= 0 {
		limit = 1440
	}
	row := s.DB.QueryRow(`SELECT AVG(value), COUNT(*) FROM (SELECT value FROM metrics WHERE device_id=? AND metric=? AND ts>=? AND value IS NOT NULL ORDER BY ts DESC LIMIT ?)`,
		deviceID, metric, since.UTC(), limit)
	var avg sql.NullFloat64
	var count int64
	if err := row.Scan(&avg, &count); err != nil {
		return sql.NullFloat64{}, 0, err
	}
	return avg, count, nil
}

func (s *Store) InsertDeviceLog(deviceID int64, level string, message string) error {
	if level == "" {
		level = "info"
	}
	_, err := s.DB.Exec(`INSERT INTO device_logs(device_id, ts, level, message) VALUES(?,?,?,?)`, deviceID, time.Now().UTC(), level, message)
	return err
}

func (s *Store) InsertSystemLog(level, category, message string, context map[string]any) error {
	level = strings.TrimSpace(strings.ToLower(level))
	if level == "" {
		level = "info"
	}
	category = strings.TrimSpace(category)
	if category == "" {
		category = "general"
	}
	var ctxValue any
	if len(context) > 0 {
		if data, err := json.Marshal(context); err == nil {
			ctxValue = string(data)
		} else {
			ctxValue = nil
		}
	}
	_, err := s.DB.Exec(`INSERT INTO system_logs(ts, level, category, message, context) VALUES(?,?,?,?,?)`,
		time.Now().UTC(), level, category, message, ctxValue)
	return err
}

func (s *Store) InsertDeviceBackup(deviceID int64, filename, mediaType string, size int64, data []byte) (*DeviceBackup, error) {
	if deviceID <= 0 {
		return nil, fmt.Errorf("invalid device id")
	}
	if strings.TrimSpace(filename) == "" {
		return nil, fmt.Errorf("filename required")
	}
	if size < 0 {
		size = int64(len(data))
	}
	res, err := s.DB.Exec(`INSERT INTO device_backups(device_id, filename, media_type, size, data) VALUES(?,?,?,?,?)`,
		deviceID, filename, mediaType, size, data)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.GetDeviceBackup(id)
}

func (s *Store) ListDeviceBackups(deviceID int64, limit int) ([]DeviceBackup, error) {
	if limit <= 0 {
		limit = 25
	}
	rows, err := s.DB.Query(`SELECT id, device_id, filename, media_type, size, created_at FROM device_backups WHERE device_id=? ORDER BY created_at DESC LIMIT ?`,
		deviceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var backups []DeviceBackup
	for rows.Next() {
		var b DeviceBackup
		var created string
		if err := rows.Scan(&b.ID, &b.DeviceID, &b.Filename, &b.MediaType, &b.Size, &created); err != nil {
			return nil, err
		}
		if created != "" {
			if ts, err := parseSQLiteTimestamp(created); err == nil {
				b.CreatedAt = ts
			}
		}
		backups = append(backups, b)
	}
	return backups, rows.Err()
}

func (s *Store) GetDeviceBackup(id int64) (*DeviceBackup, error) {
	row := s.DB.QueryRow(`SELECT id, device_id, filename, media_type, size, created_at, data FROM device_backups WHERE id=?`, id)
	var b DeviceBackup
	var created string
	if err := row.Scan(&b.ID, &b.DeviceID, &b.Filename, &b.MediaType, &b.Size, &created, &b.Data); err != nil {
		return nil, err
	}
	if created != "" {
		if ts, err := parseSQLiteTimestamp(created); err == nil {
			b.CreatedAt = ts
		}
	}
	return &b, nil
}

func (s *Store) LatestDeviceBackup(deviceID int64) (*DeviceBackup, error) {
	row := s.DB.QueryRow(`SELECT id FROM device_backups WHERE device_id=? ORDER BY created_at DESC LIMIT 1`, deviceID)
	var id int64
	if err := row.Scan(&id); err != nil {
		return nil, err
	}
	return s.GetDeviceBackup(id)
}

func (s *Store) RecentSystemLogs(filter SystemLogFilter) ([]SystemLogEntry, error) {
	limit := filter.Limit
	if limit <= 0 {
		limit = 100
	}
	query := `SELECT id, ts, level, category, message, COALESCE(context, '') FROM system_logs`
	var where []string
	var args []any
	if filter.Level != "" {
		where = append(where, "LOWER(level) = LOWER(?)")
		args = append(args, filter.Level)
	}
	if filter.Category != "" {
		where = append(where, "LOWER(category) = LOWER(?)")
		args = append(args, filter.Category)
	}
	if !filter.Since.IsZero() {
		where = append(where, "ts >= ?")
		args = append(args, filter.Since.UTC())
	}
	if filter.Search != "" {
		like := "%" + strings.ToLower(filter.Search) + "%"
		where = append(where, "(LOWER(message) LIKE ? OR LOWER(category) LIKE ?)")
		args = append(args, like, like)
	}
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY ts DESC LIMIT ?"
	args = append(args, limit)
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var logs []SystemLogEntry
	for rows.Next() {
		var entry SystemLogEntry
		if err := rows.Scan(&entry.ID, &entry.TS, &entry.Level, &entry.Category, &entry.Message, &entry.Context); err != nil {
			return nil, err
		}
		logs = append(logs, entry)
	}
	return logs, rows.Err()
}

func (s *Store) GetSettings() (map[string]string, error) {
	rows, err := s.DB.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	settings := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		settings[key] = value
	}
	return settings, rows.Err()
}

func (s *Store) SetSetting(key, value string) error {
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("setting key cannot be empty")
	}
	_, err := s.DB.Exec(`INSERT INTO settings(key, value, updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`, key, value)
	return err
}

func (s *Store) SetSettings(values map[string]string) error {
	if len(values) == 0 {
		return nil
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO settings(key, value, updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	for key, value := range values {
		if strings.TrimSpace(key) == "" {
			continue
		}
		if _, err := stmt.Exec(key, value); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) RecentDeviceLogs(deviceID int64, limit int) ([]DeviceLog, error) {
	if limit <= 0 {
		limit = 25
	}
	rows, err := s.DB.Query(`SELECT id, device_id, ts, level, message FROM device_logs WHERE device_id=? ORDER BY ts DESC LIMIT ?`, deviceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var logs []DeviceLog
	for rows.Next() {
		var entry DeviceLog
		if err := rows.Scan(&entry.ID, &entry.DeviceID, &entry.TS, &entry.Level, &entry.Message); err != nil {
			return nil, err
		}
		logs = append(logs, entry)
	}
	return logs, rows.Err()
}

func (s *Store) RecentDeviceLogsFiltered(filter DeviceLogFilter) ([]DeviceLogWithMeta, error) {
	limit := filter.Limit
	if limit <= 0 {
		limit = 100
	}
	query := `SELECT l.id, l.device_id, l.ts, l.level, l.message, d.name, d.kind, d.host
		FROM device_logs l
		INNER JOIN devices d ON d.id = l.device_id`
	var where []string
	var args []any
	if len(filter.DeviceIDs) > 0 {
		placeholders := make([]string, 0, len(filter.DeviceIDs))
		for range filter.DeviceIDs {
			placeholders = append(placeholders, "?")
		}
		where = append(where, fmt.Sprintf("l.device_id IN (%s)", strings.Join(placeholders, ",")))
		for _, id := range filter.DeviceIDs {
			args = append(args, id)
		}
	}
	if filter.DeviceKind != "" {
		where = append(where, "LOWER(d.kind) = LOWER(?)")
		args = append(args, filter.DeviceKind)
	}
	if filter.Level != "" {
		where = append(where, "LOWER(l.level) = LOWER(?)")
		args = append(args, filter.Level)
	}
	if !filter.Since.IsZero() {
		where = append(where, "l.ts >= ?")
		args = append(args, filter.Since.UTC())
	}
	if filter.Search != "" {
		like := "%" + strings.ToLower(filter.Search) + "%"
		where = append(where, "(LOWER(l.message) LIKE ? OR LOWER(d.name) LIKE ? OR LOWER(d.host) LIKE ?)")
		args = append(args, like, like, like)
	}
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY l.ts DESC LIMIT ?"
	args = append(args, limit)
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var logs []DeviceLogWithMeta
	for rows.Next() {
		var entry DeviceLogWithMeta
		if err := rows.Scan(&entry.ID, &entry.DeviceID, &entry.TS, &entry.Level, &entry.Message, &entry.DeviceName, &entry.DeviceKind, &entry.DeviceHost); err != nil {
			return nil, err
		}
		logs = append(logs, entry)
	}
	return logs, rows.Err()
}

func (s *Store) EnqueueTask(deviceID int64, kind, args, by string) (int64, error) {
	res, err := s.DB.Exec(`INSERT INTO tasks(device_id, kind, args, requested_by, requested_at, status, output) VALUES(?,?,?,?,datetime('now'), 'queued','')`,
		deviceID, kind, args, by)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) UpdateTaskStatus(id int64, status, output string) error {
	_, err := s.DB.Exec(`UPDATE tasks SET status=?, output=? WHERE id=?`, status, output, id)
	return err
}

func (s *Store) ListTasks(deviceID int64, limit int) ([]map[string]any, error) {
	rows, err := s.DB.Query(`SELECT id, device_id, kind, args, requested_by, requested_at, status, output FROM tasks WHERE device_id=? ORDER BY requested_at DESC LIMIT ?`,
		deviceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, dev int64
		var kind, args, by, at, status, outp string
		if err := rows.Scan(&id, &dev, &kind, &args, &by, &at, &status, &outp); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "device_id": dev, "kind": kind, "args": args, "requested_by": by, "requested_at": at, "status": status, "output": outp})
	}
	return out, rows.Err()
}

// CreateDevice creates a new device and returns its ID
func (s *Store) CreateDevice(name, host, kind, platform, user, sshKey, password, meta, connection string, override bool) (int64, error) {
	if err := s.clearDeletedDevice(name); err != nil {
		return 0, err
	}
	connection = normaliseLinkValue(connection)
	overrideValue := 0
	if override {
		overrideValue = 1
	}
	res, err := s.DB.Exec(`INSERT INTO devices(name,host,kind,platform,user,connection,connection_override,ssh_key,password,meta) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		name, host, kind, platform, user, connection, overrideValue, sshKey, password, meta)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// GetDevice retrieves a device by ID
func (s *Store) GetDevice(id int64) (map[string]any, error) {
	if err := s.ensurePendingDeletionTable(); err != nil {
		return nil, err
	}
	row := s.DB.QueryRow(`SELECT d.id,d.name,d.host,d.kind,d.platform,d.user,d.connection,d.connection_override,d.ssh_key,d.password,d.meta,pd.delete_at FROM devices d LEFT JOIN pending_device_deletions pd ON pd.device_id=d.id WHERE d.id=?`, id)
	var (
		deviceID                   int64
		name, host, kind           string
		platform, user, ssh        string
		connection                 sql.NullString
		override                   sql.NullInt64
		password, meta, pendingStr sql.NullString
	)
	if err := row.Scan(&deviceID, &name, &host, &kind, &platform, &user, &connection, &override, &ssh, &password, &meta, &pendingStr); err != nil {
		return nil, err
	}
	resp := map[string]any{
		"id":       deviceID,
		"name":     name,
		"host":     host,
		"kind":     kind,
		"platform": platform,
		"user":     user,
		"ssh_key":  ssh,
		"password_set": func() bool {
			if !password.Valid {
				return false
			}
			return strings.TrimSpace(password.String) != ""
		}(),
		"meta": func() string {
			if !meta.Valid {
				return ""
			}
			return meta.String
		}(),
	}
	resp["connection"] = func() string {
		if connection.Valid {
			return normaliseLinkValue(connection.String)
		}
		return "wired"
	}()
	resp["connection_override"] = override.Valid && override.Int64 != 0
	if pendingStr.Valid && pendingStr.String != "" {
		if ts, err := parseDeleteAt(pendingStr.String); err == nil {
			resp["pending_delete_at"] = ts.Format(time.RFC3339)
		} else {
			resp["pending_delete_at"] = pendingStr.String
		}
	}
	return resp, nil
}

// UpdateDevice updates an existing device
func (s *Store) UpdateDevice(id int64, name, host, kind, platform, user, sshKey, password, meta, connection string, override bool) error {
	connection = normaliseLinkValue(connection)
	overrideValue := 0
	if override {
		overrideValue = 1
	}
	_, err := s.DB.Exec(`UPDATE devices SET name=?,host=?,kind=?,platform=?,user=?,connection=?,connection_override=?,ssh_key=?,password=?,meta=? WHERE id=?`,
		name, host, kind, platform, user, connection, overrideValue, sshKey, password, meta, id)
	return err
}

func (s *Store) UpdateDeviceConnection(id int64, connection string) error {
	connection = normaliseLinkValue(connection)
	_, err := s.DB.Exec(`UPDATE devices SET connection=? WHERE id=?`, connection, id)
	return err
}

// DeleteDevice removes a device and all its associated data
func (s *Store) DeleteDevice(id int64) error {
	if err := s.ensureDeletedDevicesTable(); err != nil {
		return err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var name string
	if err := tx.QueryRow(`SELECT name FROM devices WHERE id=?`, id).Scan(&name); err != nil {
		return err
	}

	// Delete associated metrics
	if _, err := tx.Exec(`DELETE FROM metrics WHERE device_id=?`, id); err != nil {
		return err
	}

	// Delete associated tasks
	if _, err := tx.Exec(`DELETE FROM tasks WHERE device_id=?`, id); err != nil {
		return err
	}

	// Clear any pending deletion markers
	if _, err := tx.Exec(`DELETE FROM pending_device_deletions WHERE device_id=?`, id); err != nil {
		return err
	}

	// Delete the device
	if _, err := tx.Exec(`DELETE FROM devices WHERE id=?`, id); err != nil {
		return err
	}

	if err := markDeviceDeletedTx(tx, name); err != nil {
		return err
	}

	return tx.Commit()
}

// DeviceExists checks if a device with the given name already exists
func (s *Store) DeviceExists(name string) (bool, error) {
	var count int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM devices WHERE name=?`, name).Scan(&count)
	return count > 0, err
}

func (s *Store) ScheduleDeviceDeletion(deviceID int64, deleteAt time.Time) error {
	if err := s.ensurePendingDeletionTable(); err != nil {
		return err
	}
	stamp := deleteAt.UTC().Format(time.RFC3339Nano)
	_, err := s.DB.Exec(`INSERT INTO pending_device_deletions(device_id, delete_at) VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET delete_at=excluded.delete_at`, deviceID, stamp)
	return err
}

func (s *Store) CancelDeviceDeletion(deviceID int64) (bool, error) {
	if err := s.ensurePendingDeletionTable(); err != nil {
		return false, err
	}
	res, err := s.DB.Exec(`DELETE FROM pending_device_deletions WHERE device_id=?`, deviceID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (s *Store) GetPendingDeviceDeletion(deviceID int64) (*time.Time, error) {
	if err := s.ensurePendingDeletionTable(); err != nil {
		return nil, err
	}
	row := s.DB.QueryRow(`SELECT delete_at FROM pending_device_deletions WHERE device_id=?`, deviceID)
	var raw string
	switch err := row.Scan(&raw); err {
	case nil:
		ts, err := parseDeleteAt(raw)
		if err != nil {
			return nil, err
		}
		return &ts, nil
	case sql.ErrNoRows:
		return nil, nil
	default:
		return nil, err
	}
}

func (s *Store) DueDeviceDeletions(now time.Time) ([]PendingDeletion, error) {
	if err := s.ensurePendingDeletionTable(); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(`SELECT device_id, delete_at FROM pending_device_deletions WHERE delete_at<=?`, now.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PendingDeletion
	for rows.Next() {
		var p PendingDeletion
		var raw string
		if err := rows.Scan(&p.DeviceID, &raw); err != nil {
			return nil, err
		}
		ts, err := parseDeleteAt(raw)
		if err != nil {
			return nil, err
		}
		p.DeleteAt = ts
		out = append(out, p)
	}
	return out, rows.Err()
}

func parseDeleteAt(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, fmt.Errorf("empty delete_at")
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05Z07:00",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		if ts, err := time.Parse(layout, value); err == nil {
			return ts.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("cannot parse delete_at: %s", value)
}

func parseSQLiteTimestamp(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, fmt.Errorf("empty timestamp")
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05Z07:00",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		if ts, err := time.Parse(layout, value); err == nil {
			return ts.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("cannot parse timestamp: %s", value)
}

func (s *Store) ensurePendingDeletionTable() error {
	_, err := s.DB.Exec(pendingDeletionTableDDL)
	return err
}

func (s *Store) ensureDeletedDevicesTable() error {
	_, err := s.DB.Exec(deletedDevicesTableDDL)
	return err
}

func (s *Store) ensureNetworkRangeMediumTable() error {
	_, err := s.DB.Exec(networkRangeMediumTableDDL)
	return err
}

func markDeviceDeletedTx(tx *sql.Tx, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	_, err := tx.Exec(`INSERT INTO deleted_devices(name, deleted_at) VALUES(?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO UPDATE SET deleted_at=CURRENT_TIMESTAMP`, name)
	return err
}

func (s *Store) clearDeletedDevice(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	if err := s.ensureDeletedDevicesTable(); err != nil {
		return err
	}
	_, err := s.DB.Exec(`DELETE FROM deleted_devices WHERE name=?`, name)
	return err
}

func (s *Store) IsDeviceDeleted(name string) (bool, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return false, nil
	}
	if err := s.ensureDeletedDevicesTable(); err != nil {
		return false, err
	}
	var count int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM deleted_devices WHERE name=?`, name).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Store) CreateSSHKey(name, fingerprint string, encrypted []byte) (int64, error) {
	res, err := s.DB.Exec(`INSERT INTO ssh_keys(name, fingerprint, encrypted_data) VALUES(?,?,?)`, name, fingerprint, encrypted)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) ListSSHKeys() ([]SSHKeyMeta, error) {
	rows, err := s.DB.Query(`SELECT id, name, fingerprint, created_at, updated_at FROM ssh_keys ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SSHKeyMeta
	for rows.Next() {
		var meta SSHKeyMeta
		if err := rows.Scan(&meta.ID, &meta.Name, &meta.Fingerprint, &meta.CreatedAt, &meta.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, meta)
	}
	return out, rows.Err()
}

func (s *Store) GetSSHKey(id int64) (*SSHKey, error) {
	row := s.DB.QueryRow(`SELECT id, name, fingerprint, encrypted_data, created_at, updated_at FROM ssh_keys WHERE id=?`, id)
	var key SSHKey
	if err := row.Scan(&key.ID, &key.Name, &key.Fingerprint, &key.Encrypted, &key.CreatedAt, &key.UpdatedAt); err != nil {
		return nil, err
	}
	return &key, nil
}

func (s *Store) DeleteSSHKey(id int64) error {
	_, err := s.DB.Exec(`DELETE FROM ssh_keys WHERE id=?`, id)
	return err
}

// Authentication methods

// IsSetupCompleted checks if the initial setup has been completed
func (s *Store) IsSetupCompleted() (bool, error) {
	var value string
	err := s.DB.QueryRow(`SELECT value FROM settings WHERE key = 'setup_completed'`).Scan(&value)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return value == "true", nil
}

// MarkSetupCompleted marks the initial setup as completed
func (s *Store) MarkSetupCompleted() error {
	_, err := s.DB.Exec(`INSERT OR REPLACE INTO settings(key, value, updated_at) VALUES('setup_completed', 'true', CURRENT_TIMESTAMP)`)
	return err
}

// CreateUser creates a new user with hashed password
func (s *Store) CreateUser(username, password, email string) (*User, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	res, err := s.DB.Exec(`INSERT INTO users(username, password_hash, email, is_admin, created_at, updated_at)
		VALUES(?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, username, string(hashedPassword), email)
	if err != nil {
		return nil, err
	}

	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	return s.GetUserByID(id)
}

// GetUserByID retrieves a user by ID
func (s *Store) GetUserByID(id int64) (*User, error) {
	row := s.DB.QueryRow(`SELECT id, username, email, is_admin, created_at, updated_at FROM users WHERE id = ?`, id)
	var user User
	err := row.Scan(&user.ID, &user.Username, &user.Email, &user.IsAdmin, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// GetUserByUsername retrieves a user by username
func (s *Store) GetUserByUsername(username string) (*User, error) {
	row := s.DB.QueryRow(`SELECT id, username, email, is_admin, created_at, updated_at FROM users WHERE username = ?`, username)
	var user User
	err := row.Scan(&user.ID, &user.Username, &user.Email, &user.IsAdmin, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// ValidateUserPassword validates a user's password
func (s *Store) ValidateUserPassword(username, password string) (*User, error) {
	row := s.DB.QueryRow(`SELECT id, username, password_hash, email, is_admin, created_at, updated_at FROM users WHERE username = ?`, username)
	var user User
	var passwordHash string
	err := row.Scan(&user.ID, &user.Username, &passwordHash, &user.Email, &user.IsAdmin, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, err
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password))
	if err != nil {
		return nil, fmt.Errorf("invalid password")
	}

	return &user, nil
}

// generateSessionID generates a random session ID
func generateSessionID() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func generateManualRangeID() (string, error) {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// CreateSession creates a new session for a user
func (s *Store) CreateSession(userID int64) (*Session, error) {
	sessionID, err := generateSessionID()
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().Add(24 * time.Hour) // 24 hour session
	_, err = s.DB.Exec(`INSERT INTO sessions(id, user_id, created_at, expires_at, last_accessed)
		VALUES(?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)`, sessionID, userID, expiresAt)
	if err != nil {
		return nil, err
	}

	return &Session{
		ID:           sessionID,
		UserID:       userID,
		CreatedAt:    time.Now(),
		ExpiresAt:    expiresAt,
		LastAccessed: time.Now(),
	}, nil
}

// GetSession retrieves a session by ID and updates last accessed time
func (s *Store) GetSession(sessionID string) (*Session, error) {
	row := s.DB.QueryRow(`SELECT id, user_id, created_at, expires_at, last_accessed FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP`, sessionID)
	var session Session
	err := row.Scan(&session.ID, &session.UserID, &session.CreatedAt, &session.ExpiresAt, &session.LastAccessed)
	if err != nil {
		return nil, err
	}

	// Update last accessed time
	_, err = s.DB.Exec(`UPDATE sessions SET last_accessed = CURRENT_TIMESTAMP WHERE id = ?`, sessionID)
	if err != nil {
		return nil, err
	}

	return &session, nil
}

// DeleteSession deletes a session
func (s *Store) DeleteSession(sessionID string) error {
	_, err := s.DB.Exec(`DELETE FROM sessions WHERE id = ?`, sessionID)
	return err
}

// CleanupExpiredSessions removes expired sessions
func (s *Store) CleanupExpiredSessions() error {
	_, err := s.DB.Exec(`DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP`)
	return err
}

// Map Groups methods
func (s *Store) CreateMapGroup(id, name string, parentID *string) error {
	_, err := s.DB.Exec(`INSERT INTO map_groups(id, name, parent_id) VALUES(?, ?, ?)`, id, name, parentID)
	return err
}

func (s *Store) ListMapGroups() ([]MapGroup, error) {
	rows, err := s.DB.Query(`SELECT id, name, parent_id, created_at, updated_at FROM map_groups ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []MapGroup
	for rows.Next() {
		var g MapGroup
		var parentID sql.NullString
		if err := rows.Scan(&g.ID, &g.Name, &parentID, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		if parentID.Valid {
			g.ParentID = &parentID.String
		}
		groups = append(groups, g)
	}
	return groups, nil
}

func (s *Store) GetMapGroup(id string) (*MapGroup, error) {
	var g MapGroup
	var parentID sql.NullString
	err := s.DB.QueryRow(`SELECT id, name, parent_id, created_at, updated_at FROM map_groups WHERE id = ?`, id).
		Scan(&g.ID, &g.Name, &parentID, &g.CreatedAt, &g.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if parentID.Valid {
		g.ParentID = &parentID.String
	}
	return &g, nil
}

func (s *Store) UpdateMapGroup(id, name string, parentID *string) error {
	_, err := s.DB.Exec(`UPDATE map_groups SET name = ?, parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, name, parentID, id)
	return err
}

func (s *Store) DeleteMapGroup(id string) error {
	_, err := s.DB.Exec(`DELETE FROM map_groups WHERE id = ?`, id)
	return err
}

// SavedMap methods
func (s *Store) CreateSavedMap(m SavedMap) error {
	alertCountsJSON, _ := json.Marshal(m.AlertCounts)
	filtersJSON, _ := json.Marshal(m.Filters)

	_, err := s.DB.Exec(`INSERT INTO saved_maps(id, name, description, group_id, author, layout, time_range,
		show_alerts, all_edges, show_undiscovered, pinned_node_count, alert_counts_json, filters_json)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.Name, m.Description, m.GroupID, m.Author, m.Layout, m.TimeRange,
		m.ShowAlerts, m.AllEdges, m.ShowUndiscovered, m.PinnedNodeCount, string(alertCountsJSON), string(filtersJSON))
	return err
}

func (s *Store) ListSavedMaps() ([]SavedMap, error) {
	rows, err := s.DB.Query(`SELECT id, name, description, group_id, author, layout, time_range,
		show_alerts, all_edges, show_undiscovered, pinned_node_count, alert_counts_json, filters_json,
		created_at, updated_at FROM saved_maps ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var maps []SavedMap
	for rows.Next() {
		var m SavedMap
		var alertCountsJSON, filtersJSON sql.NullString
		if err := rows.Scan(&m.ID, &m.Name, &m.Description, &m.GroupID, &m.Author, &m.Layout, &m.TimeRange,
			&m.ShowAlerts, &m.AllEdges, &m.ShowUndiscovered, &m.PinnedNodeCount, &alertCountsJSON, &filtersJSON,
			&m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}

		if alertCountsJSON.Valid {
			json.Unmarshal([]byte(alertCountsJSON.String), &m.AlertCounts)
		}
		if filtersJSON.Valid {
			json.Unmarshal([]byte(filtersJSON.String), &m.Filters)
		}

		maps = append(maps, m)
	}
	return maps, nil
}

func (s *Store) GetSavedMap(id string) (*SavedMap, error) {
	var m SavedMap
	var alertCountsJSON, filtersJSON sql.NullString
	err := s.DB.QueryRow(`SELECT id, name, description, group_id, author, layout, time_range,
		show_alerts, all_edges, show_undiscovered, pinned_node_count, alert_counts_json, filters_json,
		created_at, updated_at FROM saved_maps WHERE id = ?`, id).
		Scan(&m.ID, &m.Name, &m.Description, &m.GroupID, &m.Author, &m.Layout, &m.TimeRange,
			&m.ShowAlerts, &m.AllEdges, &m.ShowUndiscovered, &m.PinnedNodeCount, &alertCountsJSON, &filtersJSON,
			&m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	if alertCountsJSON.Valid {
		json.Unmarshal([]byte(alertCountsJSON.String), &m.AlertCounts)
	}
	if filtersJSON.Valid {
		json.Unmarshal([]byte(filtersJSON.String), &m.Filters)
	}

	return &m, nil
}

func (s *Store) UpdateSavedMap(m SavedMap) error {
	alertCountsJSON, _ := json.Marshal(m.AlertCounts)
	filtersJSON, _ := json.Marshal(m.Filters)

	_, err := s.DB.Exec(`UPDATE saved_maps SET name = ?, description = ?, group_id = ?, author = ?,
		layout = ?, time_range = ?, show_alerts = ?, all_edges = ?, show_undiscovered = ?,
		pinned_node_count = ?, alert_counts_json = ?, filters_json = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`,
		m.Name, m.Description, m.GroupID, m.Author, m.Layout, m.TimeRange,
		m.ShowAlerts, m.AllEdges, m.ShowUndiscovered, m.PinnedNodeCount,
		string(alertCountsJSON), string(filtersJSON), m.ID)
	return err
}

func (s *Store) DeleteSavedMap(id string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Delete canvas data first
	if _, err := tx.Exec(`DELETE FROM map_canvas_data WHERE map_id = ?`, id); err != nil {
		return err
	}

	// Delete the map
	if _, err := tx.Exec(`DELETE FROM saved_maps WHERE id = ?`, id); err != nil {
		return err
	}

	return tx.Commit()
}

// MapCanvasData methods
func (s *Store) SaveMapCanvasData(data MapCanvasData) error {
	nodesJSON, _ := json.Marshal(data.Nodes)
	edgesJSON, _ := json.Marshal(data.Edges)
	transformJSON, _ := json.Marshal(data.Transform)

	_, err := s.DB.Exec(`INSERT OR REPLACE INTO map_canvas_data(map_id, nodes_json, edges_json, transform_json, updated_at)
		VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		data.MapID, string(nodesJSON), string(edgesJSON), string(transformJSON))
	return err
}

func (s *Store) GetMapCanvasData(mapID string) (*MapCanvasData, error) {
	var data MapCanvasData
	var nodesJSON, edgesJSON, transformJSON string
	err := s.DB.QueryRow(`SELECT map_id, nodes_json, edges_json, transform_json, created_at, updated_at
		FROM map_canvas_data WHERE map_id = ?`, mapID).
		Scan(&data.MapID, &nodesJSON, &edgesJSON, &transformJSON, &data.CreatedAt, &data.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	json.Unmarshal([]byte(nodesJSON), &data.Nodes)
	json.Unmarshal([]byte(edgesJSON), &data.Edges)
	json.Unmarshal([]byte(transformJSON), &data.Transform)

	return &data, nil
}

func (s *Store) DeleteMapCanvasData(mapID string) error {
	_, err := s.DB.Exec(`DELETE FROM map_canvas_data WHERE map_id = ?`, mapID)
	return err
}
