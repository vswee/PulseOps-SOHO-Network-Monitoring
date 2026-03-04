PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL,
  kind TEXT NOT NULL,
  platform TEXT NOT NULL,
  user TEXT,
  connection TEXT NOT NULL DEFAULT 'wired',
  connection_override BOOLEAN NOT NULL DEFAULT 0,
  ssh_key TEXT,
  password TEXT,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS ssh_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  encrypted_data BLOB NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  ts DATETIME NOT NULL,
  metric TEXT NOT NULL,
  value REAL,
  unit TEXT,
  raw TEXT,
  FOREIGN KEY(device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS device_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  ts DATETIME NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  FOREIGN KEY(device_id) REFERENCES devices(id)
);

CREATE INDEX IF NOT EXISTS idx_device_logs_device_ts ON device_logs(device_id, ts DESC);

CREATE TABLE IF NOT EXISTS manual_discovery_ranges (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'network',
  network TEXT,
  start TEXT,
  end TEXT,
  ping_host TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_manual_discovery_ranges_kind ON manual_discovery_ranges(kind);

CREATE TABLE IF NOT EXISTS network_range_medium (
  id TEXT PRIMARY KEY,
  network TEXT,
  start TEXT,
  end TEXT,
  medium TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data BLOB NOT NULL,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- Topology mapping tables
CREATE TABLE IF NOT EXISTS map_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(parent_id) REFERENCES map_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS saved_maps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  group_id TEXT NOT NULL,
  author TEXT,
  layout TEXT NOT NULL DEFAULT 'hierarchical',
  time_range TEXT NOT NULL DEFAULT '24h',
  show_alerts BOOLEAN NOT NULL DEFAULT 1,
  all_edges BOOLEAN NOT NULL DEFAULT 0,
  show_undiscovered BOOLEAN NOT NULL DEFAULT 0,
  pinned_node_count INTEGER NOT NULL DEFAULT 0,
  alert_counts_json TEXT, -- JSON: {"critical": 0, "warning": 0, "info": 0}
  filters_json TEXT, -- JSON: {"origin": "...", "applied": [...]}
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(group_id) REFERENCES map_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS map_canvas_data (
  map_id TEXT PRIMARY KEY,
  nodes_json TEXT NOT NULL, -- JSON array of nodes
  edges_json TEXT NOT NULL, -- JSON array of edges
  transform_json TEXT, -- JSON: {"x": 0, "y": 0, "scale": 1}
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(map_id) REFERENCES saved_maps(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ip_geolocation (
  ip TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ip_geolocation_fetched_at ON ip_geolocation(fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_backups_device_created ON device_backups(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts DATETIME NOT NULL,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_logs_ts ON system_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs(category);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  args TEXT,
  requested_by TEXT,
  requested_at DATETIME NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  FOREIGN KEY(device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_accessed DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
