package server

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"strings"

	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"
	"unicode"

	"github.com/pulseops/pulseops/drivers/huawei"
	"github.com/pulseops/pulseops/drivers/netgear"
	"github.com/pulseops/pulseops/internal/auth"
	"github.com/pulseops/pulseops/internal/backups"
	"github.com/pulseops/pulseops/internal/collectors/ping"
	"github.com/pulseops/pulseops/internal/config"
	"github.com/pulseops/pulseops/internal/discovery"
	"github.com/pulseops/pulseops/internal/geo"
	"github.com/pulseops/pulseops/internal/keys"
	"github.com/pulseops/pulseops/internal/scheduler"
	"github.com/pulseops/pulseops/internal/store"
	"github.com/pulseops/pulseops/internal/templates"
)

type App struct {
	DB      *store.Store
	Cfg     *config.Config
	Keys    *keys.Manager
	AuthMW  *auth.Middleware
	Backups *backups.Manager
	Sched   *scheduler.Svc
	Geo     *geo.Client

	deletionOnce sync.Once
}

const (
	deviceDeletionGracePeriod = 20 * time.Second
	maxBackupSizeBytes        = 50 << 20 // 50 MiB safety limit per backup
	networkRangePingTimeout   = 1500 * time.Millisecond
	networkRangeProbeTimeout  = 3 * time.Second
	ipGeolocationCacheTTL     = 24 * time.Hour
)

var allowedManualRangeKinds = map[string]struct{}{
	"network": {},
	"vlan":    {},
}

type networkRangeResponse struct {
	ID            string   `json:"id,omitempty"`
	Label         string   `json:"label"`
	Network       string   `json:"network,omitempty"`
	Start         string   `json:"start,omitempty"`
	End           string   `json:"end,omitempty"`
	Kind          string   `json:"kind,omitempty"`
	Medium        string   `json:"medium"`
	Source        string   `json:"source"`
	Manual        bool     `json:"manual"`
	PingHost      string   `json:"ping_host,omitempty"`
	PingStatus    string   `json:"ping_status"`
	PingLatencyMs *float64 `json:"ping_latency_ms,omitempty"`
	PingCheckedAt string   `json:"ping_checked_at,omitempty"`
	PingError     string   `json:"ping_error,omitempty"`
}

func RegisterRoutes(mux *http.ServeMux, db *store.Store, cfg *config.Config, keyManager *keys.Manager, backupManager *backups.Manager, sched *scheduler.Svc) {
	authMW := auth.NewMiddleware(db)
	if backupManager == nil {
		backupManager = backups.NewManager(db, keyManager)
	}
	app := &App{DB: db, Cfg: cfg, Keys: keyManager, AuthMW: authMW, Backups: backupManager, Sched: sched}

	geoToken := strings.TrimSpace(os.Getenv("PULSEOPS_GEO_API_TOKEN"))
	if geoToken == "" {
		geoToken = strings.TrimSpace(os.Getenv("GEO_API_TOKEN"))
	}
	geoBase := strings.TrimSpace(os.Getenv("PULSEOPS_GEO_API_BASE"))
	app.Geo = geo.NewClient(geo.Config{
		APIToken: geoToken,
		BaseURL:  geoBase,
		Timeout:  8 * time.Second,
	})

	cwd, _ := os.Getwd()
	webDir := os.Getenv("PULSEOPS_WEB_DIR")
	if webDir == "" {
		webDir = filepath.Join(cwd, "..", "..", "web")
	}

	// Authentication routes (no middleware)
	mux.HandleFunc("/api/auth/status", app.authStatus)
	mux.HandleFunc("/api/auth/setup", app.authSetup)
	mux.HandleFunc("/api/auth/login", app.authLogin)
	mux.HandleFunc("/api/auth/logout", app.authLogout)

	// Public routes
	mux.HandleFunc("/api/health", app.health)

	// Protected API routes
	mux.HandleFunc("/api/devices", authMW.RequireAuth(app.devices))
	mux.HandleFunc("/api/devices/import", authMW.RequireAuth(app.importDevices))
	mux.HandleFunc("/api/devices/", authMW.RequireAuth(app.deviceByID))
	mux.HandleFunc("/api/devices/restore", authMW.RequireAuth(app.restoreDevice))
	mux.HandleFunc("/api/templates", authMW.RequireAuth(app.templates))
	mux.HandleFunc("/api/discovery/scan", authMW.RequireAuth(app.discoveryScan))
	mux.HandleFunc("/api/discovery/ranges", authMW.RequireAuth(app.discoveryRanges))
	mux.HandleFunc("/api/discovery/ranges/", authMW.RequireAuth(app.discoveryRangeByID))
	mux.HandleFunc("/api/devices/validate", authMW.RequireAuth(app.validateDevice))
	mux.HandleFunc("/api/metrics/latest", authMW.RequireAuth(app.metricsLatest))
	mux.HandleFunc("/api/metrics/average", authMW.RequireAuth(app.metricsAverage))
	mux.HandleFunc("/api/metrics", authMW.RequireAuth(app.metricsSince))
	mux.HandleFunc("/api/ipinfo", authMW.RequireAuth(app.ipGeolocation))
	mux.HandleFunc("/api/export/devices", authMW.RequireAuth(app.exportDevices))
	mux.HandleFunc("/api/export/metrics", authMW.RequireAuth(app.exportMetrics))
	mux.HandleFunc("/api/backup", authMW.RequireAuth(app.backup))
	mux.HandleFunc("/api/device-backups", authMW.RequireAuth(app.deviceBackups))
	mux.HandleFunc("/api/device-backups/", authMW.RequireAuth(app.deviceBackupByID))
	mux.HandleFunc("/metrics", authMW.RequireAuth(app.promMetrics))
	mux.HandleFunc("/api/tasks", authMW.RequireAuth(app.tasks))
	mux.HandleFunc("/api/device-logs", authMW.RequireAuth(app.deviceLogs))
	mux.HandleFunc("/api/ssh-keys", authMW.RequireAuth(app.sshKeys))
	mux.HandleFunc("/api/ssh-keys/", authMW.RequireAuth(app.sshKeyByID))
	mux.HandleFunc("/api/ssh-keys-usage", authMW.RequireAuth(app.sshKeysUsage))

	// Topology mapping endpoints
	mux.HandleFunc("/api/map-groups", authMW.RequireAuth(app.mapGroups))
	mux.HandleFunc("/api/map-groups/", authMW.RequireAuth(app.mapGroupByID))
	mux.HandleFunc("/api/saved-maps", authMW.RequireAuth(app.savedMaps))
	mux.HandleFunc("/api/saved-maps/", authMW.RequireAuth(app.savedMapByID))
	mux.HandleFunc("/api/map-canvas/", authMW.RequireAuth(app.mapCanvasByID))
	mux.HandleFunc("/api/logs", authMW.RequireAuth(app.logs))
	mux.HandleFunc("/api/settings", authMW.RequireAuth(app.settings))

	// Static files with setup check
	mux.HandleFunc("/", authMW.RequireSetup(app.serveStaticFiles(webDir)))

	app.startDeletionSweeper()
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// serveStaticFiles serves static files with authentication check
func (a *App) serveStaticFiles(webDir string) http.HandlerFunc {
	fileServer := http.FileServer(http.Dir(webDir))
	return func(w http.ResponseWriter, r *http.Request) {
		fileServer.ServeHTTP(w, r)
	}
}

func (a *App) systemLog(level, category, message string, ctx map[string]any) {
	if a == nil || a.DB == nil {
		return
	}
	if err := a.DB.InsertSystemLog(level, category, message, ctx); err != nil {
		log.Printf("system log insert: %v", err)
	}
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"ok": true, "time": time.Now().UTC()})
}

func (a *App) devices(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		d, err := a.DB.ListDevices()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, d)
	case http.MethodPost:
		var device config.Device
		if err := json.NewDecoder(r.Body).Decode(&device); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}
		a.prepareDeviceConnection(&device)

		// Validate required fields
		if device.Name == "" || device.Host == "" || device.Kind == "" || device.Platform == "" {
			http.Error(w, "missing required fields: name, host, kind, platform", 400)
			return
		}

		// Check if device name already exists
		exists, err := a.DB.DeviceExists(device.Name)
		if err != nil {
			http.Error(w, "database error: "+err.Error(), 500)
			return
		}
		if exists {
			http.Error(w, "device with this name already exists", 409)
			return
		}

		// Create device
		meta := ""
		if device.Meta != nil {
			metaBytes, _ := json.Marshal(device.Meta)
			meta = string(metaBytes)
		}

		id, err := a.DB.CreateDevice(device.Name, device.Host, device.Kind, device.Platform,
			device.User, device.SSHKey, device.Password, meta, device.Connection, device.ConnectionOverride)
		if err != nil {
			http.Error(w, "failed to create device: "+err.Error(), 500)
			return
		}

		writeJSON(w, map[string]any{"id": id, "message": "device created successfully"})
		a.systemLog("info", "device.create", fmt.Sprintf("Device %s created", device.Name), map[string]any{
			"device_id": id,
			"kind":      device.Kind,
			"host":      device.Host,
		})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (a *App) prepareDeviceConnection(device *config.Device) {
	if device == nil {
		return
	}
	device.Host = strings.TrimSpace(device.Host)
	connectionRaw := strings.TrimSpace(device.Connection)
	if device.ConnectionOverride {
		device.Connection = normaliseConnectionValue(connectionRaw)
		return
	}
	if connectionRaw == "" || strings.EqualFold(connectionRaw, "auto") {
		device.Connection = a.resolveConnectionForHost(device.Host)
		device.ConnectionOverride = false
		return
	}
	device.Connection = normaliseConnectionValue(connectionRaw)
	device.ConnectionOverride = true
}

func (a *App) importDevices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20))
	if err != nil {
		http.Error(w, "failed to read request body: "+err.Error(), 400)
		return
	}
	var entries []map[string]any
	if err := json.Unmarshal(body, &entries); err != nil {
		var wrapper struct {
			Devices []map[string]any `json:"devices"`
		}
		if err2 := json.Unmarshal(body, &wrapper); err2 != nil || len(wrapper.Devices) == 0 {
			http.Error(w, "expected an array of device definitions", 400)
			return
		}
		entries = wrapper.Devices
	}
	if len(entries) == 0 {
		writeJSON(w, map[string]any{
			"imported": 0,
			"updated":  0,
			"skipped":  0,
			"errors":   []any{},
		})
		return
	}

	type importError struct {
		Name  string `json:"name"`
		Error string `json:"error"`
	}

	var imported, updated, skipped int
	var errs []importError

	for _, rec := range entries {
		name := strings.TrimSpace(anyToString(rec["name"]))
		host := strings.TrimSpace(anyToString(rec["host"]))
		kind := strings.TrimSpace(anyToString(rec["kind"]))
		platform := strings.TrimSpace(anyToString(rec["platform"]))
		user := strings.TrimSpace(anyToString(rec["user"]))
		sshKey := strings.TrimSpace(anyToString(rec["ssh_key"]))
		meta := importMetaString(rec["meta"])
		connectionRaw := strings.TrimSpace(anyToString(rec["connection"]))
		connectionOverride := false
		if rawOverride, exists := rec["connection_override"]; exists {
			connectionOverride = anyToBool(rawOverride)
		}
		tempDevice := config.Device{
			Host:               host,
			Connection:         connectionRaw,
			ConnectionOverride: connectionOverride,
		}
		a.prepareDeviceConnection(&tempDevice)
		connectionValue := tempDevice.Connection
		connectionOverride = tempDevice.ConnectionOverride

		if name == "" || host == "" || kind == "" || platform == "" {
			skipped++
			errs = append(errs, importError{Name: name, Error: "missing required fields"})
			continue
		}

		passwordValue, passwordProvided := derivePasswordFromImport(rec)

		var existingID int64
		var existingPassword sql.NullString
		err := a.DB.DB.QueryRow(`SELECT id, password FROM devices WHERE name=?`, name).Scan(&existingID, &existingPassword)
		switch {
		case err == nil:
			if !passwordProvided && existingPassword.Valid {
				passwordValue = existingPassword.String
			}
			if err := a.DB.UpdateDevice(existingID, name, host, kind, platform, user, sshKey, passwordValue, meta, connectionValue, connectionOverride); err != nil {
				errs = append(errs, importError{Name: name, Error: err.Error()})
				continue
			}
			updated++
		case errors.Is(err, sql.ErrNoRows):
			if !passwordProvided {
				passwordValue = ""
			}
			if _, err := a.DB.CreateDevice(name, host, kind, platform, user, sshKey, passwordValue, meta, connectionValue, connectionOverride); err != nil {
				errs = append(errs, importError{Name: name, Error: err.Error()})
				continue
			}
			imported++
		default:
			errs = append(errs, importError{Name: name, Error: err.Error()})
			continue
		}
	}

	resp := map[string]any{
		"imported": imported,
		"updated":  updated,
		"skipped":  skipped,
		"errors":   errs,
	}
	writeJSON(w, resp)
	a.systemLog("info", "device.import", "Device import processed", map[string]any{
		"imported": imported,
		"updated":  updated,
		"skipped":  skipped,
		"errors":   len(errs),
	})
}

// deviceByID handles individual device operations (GET, PUT, DELETE)
func (a *App) deviceByID(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devices/"), "/")
	if path == "" {
		http.Error(w, "device ID required", 400)
		return
	}

	parts := strings.Split(path, "/")
	deviceID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		http.Error(w, "invalid device ID", 400)
		return
	}

	if len(parts) > 1 {
		action := strings.ToLower(strings.TrimSpace(parts[1]))
		switch action {
		case "reprovision":
			a.deviceReprovision(w, r, deviceID)
		default:
			http.Error(w, "unknown device action", http.StatusNotFound)
		}
		return
	}

	switch r.Method {
	case http.MethodGet:
		device, err := a.DB.GetDevice(deviceID)
		if err != nil {
			http.Error(w, "device not found", 404)
			return
		}
		writeJSON(w, device)
	case http.MethodPut:
		var device config.Device
		if err := json.NewDecoder(r.Body).Decode(&device); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}
		a.prepareDeviceConnection(&device)

		// Validate required fields
		if device.Name == "" || device.Host == "" || device.Kind == "" || device.Platform == "" {
			http.Error(w, "missing required fields: name, host, kind, platform", 400)
			return
		}

		// Create meta JSON
		meta := ""
		if device.Meta != nil {
			metaBytes, _ := json.Marshal(device.Meta)
			meta = string(metaBytes)
		}

		err := a.DB.UpdateDevice(deviceID, device.Name, device.Host, device.Kind,
			device.Platform, device.User, device.SSHKey, device.Password, meta, device.Connection, device.ConnectionOverride)
		if err != nil {
			http.Error(w, "failed to update device: "+err.Error(), 500)
			return
		}

		writeJSON(w, map[string]any{"message": "device updated successfully"})
		a.systemLog("info", "device.update", fmt.Sprintf("Device %s updated", device.Name), map[string]any{
			"device_id": deviceID,
			"kind":      device.Kind,
			"host":      device.Host,
		})
	case http.MethodDelete:
		device, err := a.DB.GetDevice(deviceID)
		if err != nil {
			http.Error(w, "device not found", http.StatusNotFound)
			return
		}
		immediateParam := strings.ToLower(r.URL.Query().Get("immediate"))
		modeParam := strings.ToLower(r.URL.Query().Get("mode"))
		immediate := immediateParam == "true" || immediateParam == "1" || immediateParam == "now" || modeParam == "now" || modeParam == "immediate"
		if immediate {
			if err := a.DB.DeleteDevice(deviceID); err != nil {
				http.Error(w, "failed to delete device: "+err.Error(), http.StatusInternalServerError)
				return
			}
			log.Printf("device %d deleted immediately", deviceID)
			writeJSON(w, map[string]any{"message": "device deleted", "immediate": true})
			a.systemLog("warn", "device.delete", fmt.Sprintf("Device %v deleted immediately", device["name"]), map[string]any{
				"device_id": deviceID,
				"mode":      "immediate",
				"host":      device["host"],
				"kind":      device["kind"],
			})
			return
		}
		if existing, err := a.DB.GetPendingDeviceDeletion(deviceID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		} else if existing != nil {
			http.Error(w, "device deletion already pending", http.StatusConflict)
			return
		}
		deleteAt := time.Now().Add(deviceDeletionGracePeriod)
		if err := a.DB.ScheduleDeviceDeletion(deviceID, deleteAt); err != nil {
			http.Error(w, "failed to schedule device deletion: "+err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"message": "device deletion pending", "pending_delete_at": deleteAt})
		a.systemLog("warn", "device.delete", fmt.Sprintf("Device %v scheduled for deletion", device["name"]), map[string]any{
			"device_id": deviceID,
			"mode":      "scheduled",
			"host":      device["host"],
			"kind":      device["kind"],
			"delete_at": deleteAt,
		})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (a *App) deviceReprovision(w http.ResponseWriter, r *http.Request, deviceID int64) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if a.Sched == nil {
		http.Error(w, "scheduler unavailable", http.StatusServiceUnavailable)
		return
	}
	device, err := a.DB.GetDevice(deviceID)
	if err != nil {
		http.Error(w, "device not found", http.StatusNotFound)
		return
	}

	name, _ := device["name"].(string)
	ctx := r.Context()
	if ctx == nil {
		ctx = context.Background()
	}

	err = a.Sched.ReprovisionDevice(ctx, deviceID)
	if err != nil {
		status := http.StatusInternalServerError
		switch {
		case errors.Is(err, scheduler.ErrDeviceNotActive):
			status = http.StatusConflict
		case errors.Is(err, scheduler.ErrMissingSSHUser):
			status = http.StatusBadRequest
		case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
			status = http.StatusRequestTimeout
		}
		http.Error(w, err.Error(), status)
		a.systemLog("error", "device.reprovision", fmt.Sprintf("iPerf reprovision failed for %s", name), map[string]any{
			"device_id": deviceID,
			"error":     err.Error(),
		})
		return
	}

	writeJSON(w, map[string]any{
		"device_id": deviceID,
		"message":   "iPerf reprovision completed",
	})
	a.systemLog("info", "device.reprovision", fmt.Sprintf("iPerf reprovision completed for %s", name), map[string]any{
		"device_id": deviceID,
	})
}

func (a *App) restoreDevice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceID int64 `json:"device_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.DeviceID == 0 {
		http.Error(w, "device_id required", http.StatusBadRequest)
		return
	}
	device, err := a.DB.GetDevice(req.DeviceID)
	if err != nil {
		http.Error(w, "device not found", http.StatusNotFound)
		return
	}
	removed, err := a.DB.CancelDeviceDeletion(req.DeviceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !removed {
		http.Error(w, "no pending deletion", http.StatusNotFound)
		return
	}
	writeJSON(w, map[string]any{"restored": req.DeviceID})
	a.systemLog("info", "device.restore", fmt.Sprintf("Device %v restored from deletion queue", device["name"]), map[string]any{
		"device_id": req.DeviceID,
		"host":      device["host"],
		"kind":      device["kind"],
	})
}

// templates returns available device templates
func (a *App) templates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}

	kind := r.URL.Query().Get("kind")
	if kind != "" {
		templates := templates.GetTemplatesByKind(kind)
		writeJSON(w, templates)
	} else {
		allTemplates := templates.GetAllTemplates()
		writeJSON(w, allTemplates)
	}
}

// discoveryScan performs network discovery
func (a *App) discoveryScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}

	type discoveryOptionsPayload struct {
		Timeout       *time.Duration `json:"timeout"`
		MaxConcurrent *int           `json:"max_concurrent"`
		PortScan      *bool          `json:"port_scan"`
		CommonPorts   []int          `json:"common_ports"`
		ResolveNames  *bool          `json:"resolve_names"`
	}

	var req struct {
		Network string                  `json:"network"`
		Start   string                  `json:"start"`
		End     string                  `json:"end"`
		Options discoveryOptionsPayload `json:"options"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), 400)
		return
	}

	// Use default options and override with provided values where set
	options := discovery.DefaultDiscoveryOptions()
	if req.Options.Timeout != nil && *req.Options.Timeout > 0 {
		options.Timeout = *req.Options.Timeout
	}
	if req.Options.MaxConcurrent != nil && *req.Options.MaxConcurrent > 0 {
		options.MaxConcurrent = *req.Options.MaxConcurrent
	}
	if len(req.Options.CommonPorts) > 0 {
		options.CommonPorts = req.Options.CommonPorts
	}
	if req.Options.ResolveNames != nil {
		options.ResolveNames = *req.Options.ResolveNames
	}
	if req.Options.PortScan != nil {
		options.PortScan = *req.Options.PortScan
	}

	networkRange := discovery.NetworkRange{
		Network: req.Network,
		Start:   req.Start,
		End:     req.End,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	devices, err := discovery.DiscoverNetwork(ctx, networkRange, options)
	if err != nil {
		http.Error(w, "discovery failed: "+err.Error(), 500)
		return
	}

	// Ensure devices is never null, always return an array
	if devices == nil {
		devices = []discovery.DiscoveredDevice{}
	}

	writeJSON(w, map[string]any{"devices": devices})
}

// discoveryRanges returns common network ranges for discovery
func (a *App) discoveryRanges(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.handleDiscoveryRangesList(w, r)
	case http.MethodPost:
		a.handleDiscoveryRangeCreate(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleDiscoveryRangesList(w http.ResponseWriter, r *http.Request) {
	if a == nil || a.DB == nil {
		http.Error(w, "database unavailable", http.StatusInternalServerError)
		return
	}

	manualRecords, err := a.DB.ListManualDiscoveryRanges()
	if err != nil {
		http.Error(w, "failed to load manual ranges: "+err.Error(), http.StatusInternalServerError)
		return
	}

	mediumRecords, err := a.DB.ListNetworkRangeMedium()
	if err != nil {
		log.Printf("failed to load range mediums: %v", err)
	}
	mediumLookup := make(map[string]store.RangeMedium, len(mediumRecords))
	for _, rec := range mediumRecords {
		mediumLookup[rec.ID] = rec
	}

	manualResponses := make([]networkRangeResponse, 0, len(manualRecords))
	seen := make(map[string]struct{}, len(manualRecords))

	for _, rec := range manualRecords {
		normalised, err := discovery.NormaliseNetworkRange(discovery.NetworkRange{
			Network: rec.Network,
			Start:   rec.Start,
			End:     rec.End,
		})
		if err != nil {
			normalised = discovery.NetworkRange{
				Network: strings.TrimSpace(rec.Network),
				Start:   strings.TrimSpace(rec.Start),
				End:     strings.TrimSpace(rec.End),
			}
		}
		medium := "wired"
		if stored, ok := mediumLookup[rec.ID]; ok {
			medium = normaliseConnectionValue(stored.Medium)
		}
		resp := networkRangeResponse{
			ID:       rec.ID,
			Label:    strings.TrimSpace(rec.Label),
			Network:  strings.TrimSpace(normalised.Network),
			Start:    strings.TrimSpace(normalised.Start),
			End:      strings.TrimSpace(normalised.End),
			Kind:     normaliseRangeKind(rec.Kind),
			Medium:   medium,
			Source:   "manual",
			Manual:   true,
			PingHost: strings.TrimSpace(rec.PingHost),
		}
		if resp.Label == "" {
			resp.Label = labelForRange(normalised)
		}
		if resp.PingHost == "" {
			resp.PingHost = resp.Start
		}
		key := buildNetworkRangeKey(resp.Network, resp.Start, resp.End)
		if key != "||" {
			seen[key] = struct{}{}
		}
		manualResponses = append(manualResponses, resp)
	}

	detectedRanges := discovery.GetLocalNetworkRanges()
	detectedResponses := make([]networkRangeResponse, 0, len(detectedRanges))
	for _, rng := range detectedRanges {
		key := buildNetworkRangeKey(rng.Network, rng.Start, rng.End)
		if _, exists := seen[key]; exists {
			continue
		}
		medium := "wired"
		if stored, ok := mediumLookup[key]; ok {
			medium = normaliseConnectionValue(stored.Medium)
		}
		resp := networkRangeResponse{
			ID:       key,
			Label:    labelForRange(rng),
			Network:  strings.TrimSpace(rng.Network),
			Start:    strings.TrimSpace(rng.Start),
			End:      strings.TrimSpace(rng.End),
			Kind:     "network",
			Medium:   medium,
			Source:   "detected",
			Manual:   false,
			PingHost: strings.TrimSpace(rng.Start),
		}
		detectedResponses = append(detectedResponses, resp)
	}

	ranges := append(manualResponses, detectedResponses...)
	measureRangePings(ranges)
	writeJSON(w, ranges)
}

func (a *App) handleDiscoveryRangeCreate(w http.ResponseWriter, r *http.Request) {
	if a == nil || a.DB == nil {
		http.Error(w, "database unavailable", http.StatusInternalServerError)
		return
	}

	var req struct {
		Label    string `json:"label"`
		Kind     string `json:"kind"`
		Network  string `json:"network"`
		Start    string `json:"start"`
		End      string `json:"end"`
		PingHost string `json:"ping_host"`
		Medium   string `json:"medium"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	label := strings.TrimSpace(req.Label)
	if label == "" {
		http.Error(w, "label is required", http.StatusBadRequest)
		return
	}

	normalised, err := discovery.NormaliseNetworkRange(discovery.NetworkRange{
		Network: req.Network,
		Start:   req.Start,
		End:     req.End,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	kind := normaliseRangeKind(req.Kind)
	pingHost := strings.TrimSpace(req.PingHost)
	medium := normaliseConnectionValue(req.Medium)
	if pingHost == "" {
		pingHost = normalised.Start
	}

	record, err := a.DB.CreateManualDiscoveryRange(label, kind, normalised.Network, normalised.Start, normalised.End, pingHost)
	if err != nil {
		http.Error(w, "failed to save manual range: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := a.DB.SetNetworkRangeMedium(record.ID, normalised.Network, normalised.Start, normalised.End, medium); err != nil {
		log.Printf("failed to persist range medium for %s: %v", record.ID, err)
	}
	a.applyNetworkMediumToDevices(normalised.Network, normalised.Start, normalised.End, medium)

	resp := networkRangeResponse{
		ID:       record.ID,
		Label:    record.Label,
		Network:  strings.TrimSpace(record.Network),
		Start:    strings.TrimSpace(record.Start),
		End:      strings.TrimSpace(record.End),
		Kind:     normaliseRangeKind(record.Kind),
		Medium:   medium,
		Source:   "manual",
		Manual:   true,
		PingHost: strings.TrimSpace(record.PingHost),
	}
	if resp.PingHost == "" {
		resp.PingHost = resp.Start
	}

	ranges := []networkRangeResponse{resp}
	measureRangePings(ranges)
	writeJSON(w, ranges[0])
}

func (a *App) discoveryRangeByID(w http.ResponseWriter, r *http.Request) {
	if a == nil || a.DB == nil {
		http.Error(w, "database unavailable", http.StatusInternalServerError)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/discovery/ranges/")
	id = strings.TrimSpace(id)
	if id == "" {
		http.Error(w, "range id required", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodDelete:
		manual, err := a.DB.GetManualDiscoveryRange(id)
		if err != nil && err != sql.ErrNoRows {
			http.Error(w, "failed to load range: "+err.Error(), http.StatusInternalServerError)
			return
		}
		deleted, err := a.DB.DeleteManualDiscoveryRange(id)
		if err != nil {
			http.Error(w, "failed to delete range: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if !deleted {
			http.Error(w, "manual range not found", http.StatusNotFound)
			return
		}
		if manual != nil {
			a.applyNetworkMediumToDevices(manual.Network, manual.Start, manual.End, "wired")
		}
		writeJSON(w, map[string]any{"deleted": id})
	case http.MethodPatch, http.MethodPut:
		a.handleDiscoveryRangeUpdate(w, r, id)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleDiscoveryRangeUpdate(w http.ResponseWriter, r *http.Request, id string) {
	if a == nil || a.DB == nil {
		http.Error(w, "database unavailable", http.StatusInternalServerError)
		return
	}

	var req struct {
		Medium string `json:"medium"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	medium := normaliseConnectionValue(req.Medium)

	var network, start, end string
	manual, err := a.DB.GetManualDiscoveryRange(id)
	switch {
	case err == nil && manual != nil:
		network = manual.Network
		start = manual.Start
		end = manual.End
	case err != nil && err != sql.ErrNoRows:
		http.Error(w, "failed to lookup range: "+err.Error(), http.StatusInternalServerError)
		return
	default:
		if n, s, e, ok := parseRangeKey(id); ok {
			network = n
			start = s
			end = e
		} else {
			http.Error(w, "range metadata unavailable", http.StatusBadRequest)
			return
		}
	}

	if err := a.DB.SetNetworkRangeMedium(id, network, start, end, medium); err != nil {
		http.Error(w, "failed to update range medium: "+err.Error(), http.StatusInternalServerError)
		return
	}
	a.applyNetworkMediumToDevices(network, start, end, medium)

	writeJSON(w, map[string]any{"id": id, "medium": medium})
}

func normaliseRangeKind(kind string) string {
	k := strings.ToLower(strings.TrimSpace(kind))
	if _, ok := allowedManualRangeKinds[k]; ok {
		return k
	}
	return "network"
}

func labelForRange(rng discovery.NetworkRange) string {
	network := strings.TrimSpace(rng.Network)
	if network != "" {
		return network
	}
	start := strings.TrimSpace(rng.Start)
	end := strings.TrimSpace(rng.End)
	if start == "" && end == "" {
		return "Network range"
	}
	if start == "" {
		return end
	}
	if end == "" || start == end {
		return start
	}
	return fmt.Sprintf("%s – %s", start, end)
}

func buildNetworkRangeKey(network, start, end string) string {
	return strings.TrimSpace(network) + "|" + strings.TrimSpace(start) + "|" + strings.TrimSpace(end)
}

func measureRangePings(ranges []networkRangeResponse) {
	if len(ranges) == 0 {
		return
	}
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i := range ranges {
		host := strings.TrimSpace(ranges[i].PingHost)
		ranges[i].PingHost = host
		if host == "" {
			ranges[i].PingStatus = "unconfigured"
			ranges[i].PingLatencyMs = nil
			ranges[i].PingCheckedAt = ""
			ranges[i].PingError = ""
			continue
		}
		ranges[i].PingStatus = "probing"
		idx := i
		wg.Add(1)
		go func(position int, target string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), networkRangeProbeTimeout)
			defer cancel()
			latency, err := ping.PingOnce(ctx, target, networkRangePingTimeout)
			checkedAt := time.Now().UTC().Format(time.RFC3339)
			mu.Lock()
			defer mu.Unlock()
			ranges[position].PingCheckedAt = checkedAt
			if err != nil {
				ranges[position].PingStatus = classifyPingError(err)
				ranges[position].PingError = err.Error()
				ranges[position].PingLatencyMs = nil
				return
			}
			ranges[position].PingStatus = "ok"
			ranges[position].PingLatencyMs = float64Ptr(latency)
			ranges[position].PingError = ""
		}(idx, host)
	}

	wg.Wait()
}

func classifyPingError(err error) string {
	if err == nil {
		return "ok"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "timed out"), strings.Contains(msg, "timeout"):
		return "timeout"
	case strings.Contains(msg, "cap_net_raw"), strings.Contains(msg, "operation not permitted"):
		return "permission"
	case strings.Contains(msg, "invalid option"), strings.Contains(msg, "usage"):
		return "unsupported"
	default:
		return "error"
	}
}

func float64Ptr(v float64) *float64 {
	value := v
	return &value
}

func normaliseConnectionValue(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "wireless", "wifi", "wi-fi":
		return "wireless"
	default:
		return "wired"
	}
}

func parseRangeKey(key string) (network, start, end string, ok bool) {
	parts := strings.Split(key, "|")
	if len(parts) != 3 {
		return "", "", "", false
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), strings.TrimSpace(parts[2]), true
}

func ipv4StringToUint32(value string) (uint32, bool) {
	ip := net.ParseIP(strings.TrimSpace(value))
	if ip == nil {
		return 0, false
	}
	if ip4 := ip.To4(); ip4 != nil {
		return binary.BigEndian.Uint32(ip4), true
	}
	return 0, false
}

func hostStringToUint32(value string) (uint32, bool) {
	host := strings.TrimSpace(value)
	if host == "" {
		return 0, false
	}
	if strings.Contains(host, ":") {
		if parsed, _, err := net.SplitHostPort(host); err == nil {
			host = parsed
		}
	}
	return ipv4StringToUint32(host)
}

func (a *App) resolveConnectionForHost(host string) string {
	if a == nil || a.DB == nil {
		return "wired"
	}
	ipNum, ok := hostStringToUint32(host)
	if !ok {
		return "wired"
	}
	records, err := a.DB.ListNetworkRangeMedium()
	if err != nil {
		log.Printf("resolve connection mediums: %v", err)
		return "wired"
	}
	for _, rec := range records {
		network := strings.TrimSpace(rec.Network)
		start := strings.TrimSpace(rec.Start)
		end := strings.TrimSpace(rec.End)
		if start == "" || end == "" {
			if rng, err := discovery.NormaliseNetworkRange(discovery.NetworkRange{Network: network, Start: start, End: end}); err == nil {
				start = rng.Start
				end = rng.End
			}
		}
		startNum, okStart := ipv4StringToUint32(start)
		endNum, okEnd := ipv4StringToUint32(end)
		if !okStart || !okEnd {
			continue
		}
		if startNum > endNum {
			startNum, endNum = endNum, startNum
		}
		if ipNum >= startNum && ipNum <= endNum {
			return normaliseConnectionValue(rec.Medium)
		}
	}
	return "wired"
}

func (a *App) applyNetworkMediumToDevices(network, start, end, medium string) {
	if a == nil || a.DB == nil {
		return
	}
	medium = normaliseConnectionValue(medium)
	network = strings.TrimSpace(network)
	start = strings.TrimSpace(start)
	end = strings.TrimSpace(end)
	if start == "" || end == "" {
		if rng, err := discovery.NormaliseNetworkRange(discovery.NetworkRange{Network: network, Start: start, End: end}); err == nil {
			start = rng.Start
			end = rng.End
		}
	}
	startNum, okStart := ipv4StringToUint32(start)
	endNum, okEnd := ipv4StringToUint32(end)
	if !okStart || !okEnd {
		return
	}
	if startNum > endNum {
		startNum, endNum = endNum, startNum
	}
	devices, err := a.DB.ListDeviceRecords()
	if err != nil {
		log.Printf("list devices for medium update: %v", err)
		return
	}
	for _, device := range devices {
		if device.ConnectionOverride {
			continue
		}
		ipNum, ok := hostStringToUint32(device.Host)
		if !ok {
			continue
		}
		if ipNum < startNum || ipNum > endNum {
			continue
		}
		current := normaliseConnectionValue(device.Connection)
		if current == medium {
			continue
		}
		if err := a.DB.UpdateDeviceConnection(device.ID, medium); err != nil {
			log.Printf("update device %d connection: %v", device.ID, err)
		}
	}
}

func (a *App) sshKeys(w http.ResponseWriter, r *http.Request) {
	if a.Keys == nil {
		http.Error(w, "ssh key manager not configured", http.StatusServiceUnavailable)
		return
	}

	switch r.Method {
	case http.MethodGet:
		keys, err := a.Keys.ListKeys()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, keys)
	case http.MethodPost:
		var req struct {
			Name       string `json:"name"`
			PrivateKey string `json:"private_key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}

		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}

		meta, err := a.Keys.SaveKey(req.Name, req.PrivateKey)
		if err != nil {
			switch {
			case errors.Is(err, keys.ErrInvalidKey):
				http.Error(w, "invalid private key", http.StatusBadRequest)
				return
			case strings.Contains(err.Error(), "UNIQUE"):
				http.Error(w, "key name already exists", http.StatusConflict)
				return
			default:
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}

		writeJSON(w, map[string]any{
			"key":       meta,
			"reference": keys.ReferenceFor(meta.ID),
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) sshKeyByID(w http.ResponseWriter, r *http.Request) {
	if a.Keys == nil {
		http.Error(w, "ssh key manager not configured", http.StatusServiceUnavailable)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/ssh-keys/")
	if idStr == "" {
		http.Error(w, "key id required", http.StatusBadRequest)
		return
	}

	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid key id", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		key, pem, err := a.Keys.GetDecryptedKey(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, map[string]any{
			"id":          key.ID,
			"name":        key.Name,
			"fingerprint": key.Fingerprint,
			"created_at":  key.CreatedAt,
			"updated_at":  key.UpdatedAt,
			"private_key": pem,
		})
	case http.MethodDelete:
		if err := a.Keys.DeleteKey(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"deleted": id})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) sshKeysUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if a.Keys == nil {
		http.Error(w, "ssh key manager not configured", http.StatusServiceUnavailable)
		return
	}

	// Get all SSH keys
	sshKeys, err := a.Keys.ListKeys()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Get all devices
	devices, err := a.DB.ListDeviceRecords()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Build usage map
	usage := make(map[int64][]map[string]any)
	for _, device := range devices {
		if device.SSHKey != "" {
			if keyID, ok := keys.ParseReference(device.SSHKey); ok {
				usage[keyID] = append(usage[keyID], map[string]any{
					"device_id":   device.ID,
					"device_name": device.Name,
					"device_host": device.Host,
					"device_kind": device.Kind,
					"platform":    device.Platform,
				})
			}
		}
	}

	// Build response with usage information
	result := make([]map[string]any, 0, len(sshKeys))
	for _, key := range sshKeys {
		keyUsage := usage[key.ID]
		if keyUsage == nil {
			keyUsage = []map[string]any{}
		}

		result = append(result, map[string]any{
			"id":          key.ID,
			"name":        key.Name,
			"fingerprint": key.Fingerprint,
			"created_at":  key.CreatedAt,
			"updated_at":  key.UpdatedAt,
			"usage_count": len(keyUsage),
			"used_by":     keyUsage,
		})
	}

	writeJSON(w, result)
}

// validateDevice tests device connectivity and configuration
func (a *App) validateDevice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}

	var device config.Device
	if err := json.NewDecoder(r.Body).Decode(&device); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	a.prepareDeviceConnection(&device)

	result := a.validateDeviceConfig(device)
	writeJSON(w, result)
}

func (a *App) metricsLatest(w http.ResponseWriter, r *http.Request) {
	devID, _ := strconv.ParseInt(r.URL.Query().Get("device_id"), 10, 64)
	metric := r.URL.Query().Get("metric")
	if devID == 0 || metric == "" {
		http.Error(w, "missing device_id or metric", 400)
		return
	}
	m, err := a.DB.LatestMetric(devID, metric)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if m == nil {
		writeJSON(w, map[string]any{"value": nil, "ts": nil, "metric": metric})
		return
	}
	writeJSON(w, m)
}

func (a *App) metricsSince(w http.ResponseWriter, r *http.Request) {
	devID, _ := strconv.ParseInt(r.URL.Query().Get("device_id"), 10, 64)
	metric := r.URL.Query().Get("metric")
	sinceStr := r.URL.Query().Get("since")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 500
	}
	if devID == 0 || metric == "" || sinceStr == "" {
		http.Error(w, "missing device_id, metric or since", 400)
		return
	}
	since, err := time.Parse(time.RFC3339, sinceStr)
	if err != nil {
		http.Error(w, "bad since; use RFC3339", 400)
		return
	}
	ms, err := a.DB.MetricsSince(devID, metric, since, limit)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, ms)
}

func (a *App) metricsAverage(w http.ResponseWriter, r *http.Request) {
	devID, _ := strconv.ParseInt(r.URL.Query().Get("device_id"), 10, 64)
	metric := r.URL.Query().Get("metric")
	sinceStr := r.URL.Query().Get("since")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 1440
	}
	if devID == 0 || metric == "" || sinceStr == "" {
		http.Error(w, "missing device_id, metric or since", 400)
		return
	}
	since, err := time.Parse(time.RFC3339, sinceStr)
	if err != nil {
		http.Error(w, "bad since; use RFC3339", 400)
		return
	}
	avg, count, err := a.DB.AverageMetricSince(devID, metric, since, limit)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	resp := map[string]any{
		"device_id": devID,
		"metric":    metric,
		"count":     count,
	}
	if avg.Valid {
		resp["value"] = avg.Float64
	} else {
		resp["value"] = nil
	}
	writeJSON(w, resp)
}

func (a *App) ipGeolocation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}

	ipParam := strings.TrimSpace(r.URL.Query().Get("ip"))
	if ipParam == "" {
		http.Error(w, "ip query parameter required", 400)
		return
	}

	parsedIP := net.ParseIP(ipParam)
	if parsedIP == nil {
		writeJSON(w, map[string]any{
			"ip":         ipParam,
			"geolocated": false,
			"error":      "invalid_ip",
			"message":    "The supplied value is not a valid IP address.",
			"cached":     false,
			"fetched_at": time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	if isNonPublicIP(parsedIP) {
		writeJSON(w, map[string]any{
			"ip":         ipParam,
			"geolocated": false,
			"reason":     "private_ip",
			"message":    "Private or non-routable addresses are not geolocated.",
			"cached":     true,
			"fetched_at": time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	var (
		cachedRecord *store.IPGeolocationRecord
		cachedErr    error
	)
	if a.DB != nil {
		cachedRecord, cachedErr = a.DB.GetIPGeolocation(ipParam)
		if cachedErr != nil {
			http.Error(w, "failed to query geolocation cache: "+cachedErr.Error(), 500)
			return
		}
	}

	var (
		cachedResult *geo.Result
		cachedRaw    []byte
		cachedFresh  bool
	)

	if cachedRecord != nil {
		if parsed, err := geo.Parse([]byte(cachedRecord.Response)); err == nil {
			cachedResult = parsed
			cachedRaw = []byte(cachedRecord.Response)
			if !cachedRecord.FetchedAt.IsZero() && time.Since(cachedRecord.FetchedAt) <= ipGeolocationCacheTTL {
				cachedFresh = true
			}
		} else {
			log.Printf("geo cache parse error for %s: %v", ipParam, err)
		}
	}

	var (
		result    *geo.Result
		raw       []byte
		fetchedAt time.Time
		cached    bool
		stale     bool
	)

	if cachedFresh {
		result = cachedResult
		raw = cachedRaw
		fetchedAt = cachedRecord.FetchedAt
		cached = true
	}

	if result == nil {
		if a.Geo == nil {
			if cachedResult != nil {
				result = cachedResult
				raw = cachedRaw
				fetchedAt = cachedRecord.FetchedAt
				cached = true
				stale = true
			} else {
				writeJSON(w, map[string]any{
					"ip":         ipParam,
					"geolocated": false,
					"error":      "geo_unconfigured",
					"message":    "Geolocation service is not configured.",
					"cached":     false,
				})
			}
			return
		}

		ctx := r.Context()
		if a.Geo.Timeout > 0 {
			if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > a.Geo.Timeout {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, a.Geo.Timeout)
				defer cancel()
			}
		}

		lookup, body, err := a.Geo.LookupIP(ctx, ipParam)
		if err != nil {
			log.Printf("geolocation lookup failed for %s: %v", ipParam, err)
			if cachedResult != nil {
				result = cachedResult
				raw = cachedRaw
				fetchedAt = cachedRecord.FetchedAt
				cached = true
				stale = true
			} else {
				writeJSON(w, map[string]any{
					"ip":         ipParam,
					"geolocated": false,
					"error":      "lookup_failed",
					"message":    err.Error(),
					"cached":     false,
				})
				return
			}
		} else {
			result = lookup
			raw = body
			fetchedAt = time.Now().UTC()
			if a.DB != nil {
				if err := a.DB.UpsertIPGeolocation(ipParam, string(body), fetchedAt); err != nil {
					log.Printf("failed to persist geolocation cache for %s: %v", ipParam, err)
				}
			}
		}
	}

	if result == nil {
		writeJSON(w, map[string]any{
			"ip":         ipParam,
			"geolocated": false,
			"cached":     false,
		})
		return
	}

	if fetchedAt.IsZero() {
		if cachedRecord != nil && !cachedRecord.FetchedAt.IsZero() {
			fetchedAt = cachedRecord.FetchedAt
		} else {
			fetchedAt = time.Now().UTC()
		}
	}

	if result.Source == "" {
		if a.Geo != nil && a.Geo.Source != "" {
			result.Source = a.Geo.Source
		} else {
			result.Source = "flat18"
		}
	}

	resp := map[string]any{
		"ip":         ipParam,
		"geolocated": true,
		"cached":     cached,
		"fetched_at": fetchedAt.UTC().Format(time.RFC3339),
		"source":     result.Source,
	}
	if stale {
		resp["stale"] = true
	}
	if result.IP != "" && !strings.EqualFold(result.IP, ipParam) {
		resp["resolved_ip"] = result.IP
	}
	if result.Display != "" {
		resp["display"] = result.Display
	}
	if result.City != "" {
		resp["city"] = result.City
	}
	if result.Region != "" {
		resp["region"] = result.Region
	}
	if result.Country != "" {
		resp["country"] = result.Country
	}
	if result.CountryCode != "" {
		resp["country_code"] = strings.ToUpper(result.CountryCode)
	}
	if result.Continent != "" {
		resp["continent"] = result.Continent
	}
	if result.Timezone != "" {
		resp["timezone"] = result.Timezone
	}
	if result.Organization != "" {
		resp["organization"] = result.Organization
	}
	if result.ISP != "" {
		resp["isp"] = result.ISP
	}
	if result.ASN != "" {
		resp["asn"] = result.ASN
	}
	if result.Latitude != nil {
		resp["latitude"] = *result.Latitude
	}
	if result.Longitude != nil {
		resp["longitude"] = *result.Longitude
	}
	if len(result.Raw) > 0 {
		resp["raw"] = json.RawMessage(result.Raw)
	} else if len(raw) > 0 {
		resp["raw"] = json.RawMessage(raw)
	}

	writeJSON(w, resp)
}

func isNonPublicIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		switch {
		case v4[0] == 0:
			return true
		case v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127:
			return true
		case v4[0] == 169 && v4[1] == 254:
			return true
		case v4[0] == 192 && v4[1] == 0 && v4[2] == 2:
			return true
		case v4[0] == 198 && v4[1] == 51 && v4[2] == 100:
			return true
		case v4[0] == 203 && v4[1] == 0 && v4[2] == 113:
			return true
		case v4[0] == 198 && (v4[1] == 18 || v4[1] == 19):
			return true
		case v4[0] >= 224:
			return true
		}
	} else {
		// Treat IPv6 unique-local (fc00::/7) and site-local (deprecated) as non-public.
		if strings.HasPrefix(strings.ToLower(ip.String()), "fc") || strings.HasPrefix(strings.ToLower(ip.String()), "fd") {
			return true
		}
	}
	return false
}

type TaskReq struct {
	DeviceID int64  `json:"device_id"`
	Kind     string `json:"kind"`
	Args     string `json:"args"`
	By       string `json:"by"`
}

func (a *App) tasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		devID, _ := strconv.ParseInt(r.URL.Query().Get("device_id"), 10, 64)
		if devID == 0 {
			http.Error(w, "device_id required", 400)
			return
		}
		ts, err := a.DB.ListTasks(devID, 100)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, ts)
		return
	case http.MethodPost:
		var req TaskReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		id, err := a.DB.EnqueueTask(req.DeviceID, req.Kind, req.Args, req.By)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		go a.runTask(id, req.DeviceID, req.Kind)
		writeJSON(w, map[string]any{"enqueued": id})
		a.systemLog("info", "task.enqueue", fmt.Sprintf("Task %s enqueued", req.Kind), map[string]any{
			"task_id":      id,
			"device_id":    req.DeviceID,
			"kind":         req.Kind,
			"requested_by": req.By,
		})
		return
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (a *App) runTask(taskID, deviceID int64, kind string) {
	_ = a.DB.UpdateTaskStatus(taskID, "running", "")
	row := a.DB.DB.QueryRow(`SELECT name, host, kind, platform, user, ssh_key, password, meta FROM devices WHERE id=?`, deviceID)
	var name, host, dkind, platform, user, key, password, metaStr string
	if err := row.Scan(&name, &host, &dkind, &platform, &user, &key, &password, &metaStr); err != nil {
		_ = a.DB.UpdateTaskStatus(taskID, "error", err.Error())
		return
	}

	port := 22
	if metaStr != "" {
		var meta map[string]string
		if err := json.Unmarshal([]byte(metaStr), &meta); err == nil {
			if val, ok := meta["ssh_port"]; ok {
				if p, err := parseSSHPortValue(val); err == nil {
					port = p
				}
			}
		}
	}

	keyPath, cleanup, err := a.resolveSSHKey(key)
	if err != nil {
		_ = a.DB.UpdateTaskStatus(taskID, "error", err.Error())
		return
	}
	defer cleanup()

	var out string
	switch platform {
	case "openwrt":
		out, err = a.taskOpenWrt(kind, user, host, port, keyPath)
	case "edgeos":
		out, err = a.taskEdgeOS(kind, user, host, port, keyPath)
	case "huawei":
		out, err = a.taskHuawei(kind, name, host)
	case "netgear":
		out, err = a.taskNetgear(kind, name, host, user, password)
	default:
		err = fmt.Errorf("unsupported platform: %s", platform)
	}
	status := "done"
	if err != nil {
		status = "error"
		out = out + "\n" + err.Error()
	}
	_ = a.DB.UpdateTaskStatus(taskID, status, out)
	log.Printf("task %d %s on %s -> %s", taskID, kind, name, status)
}

func (a *App) resolveSSHKey(value string) (string, func(), error) {
	if strings.TrimSpace(value) == "" {
		return "", func() {}, nil
	}
	if _, ok := keys.ParseReference(value); ok {
		if a.Keys == nil {
			return "", func() {}, fmt.Errorf("stored ssh key is unavailable")
		}
		return a.Keys.ResolvePath(value)
	}
	return value, func() {}, nil
}

func (a *App) taskOpenWrt(kind, user, host string, port int, key string) (string, error) {
	switch kind {
	case "reboot":
		return sh(user, host, port, key, "reboot")
	case "refresh_firewall":
		return sh(user, host, port, key, "/etc/init.d/firewall restart")
	case "refresh_wireless":
		return sh(user, host, port, key, "wifi reload || ubus call network reload")
	default:
		return "", fmt.Errorf("unknown task: %s", kind)
	}
}

func (a *App) taskEdgeOS(kind, user, host string, port int, key string) (string, error) {
	switch kind {
	case "reboot":
		return sh(user, host, port, key, "sudo reboot")
	case "refresh_firewall":
		return sh(user, host, port, key, "configure; commit; save; exit")
	default:
		return "", fmt.Errorf("unknown task: %s", kind)
	}
}

func (a *App) taskHuawei(kind, name, host string) (string, error) {
	if kind != "reboot" {
		return "", fmt.Errorf("unsupported Huawei task: %s", kind)
	}
	// Find creds from config by matching name or host
	user := "admin"
	pass := ""
	for _, d := range a.Cfg.Devices {
		if d.Name == name || d.Host == host {
			if d.User != "" {
				user = d.User
			}
			pass = d.Password
			break
		}
	}
	if pass == "" {
		return "", fmt.Errorf("no password set for Huawei device in config")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	res, err := huawei.Reboot(ctx, host, user, pass)
	return res, err
}

func (a *App) taskNetgear(kind, name, host, user, password string) (string, error) {
	switch kind {
	case "reboot":
		if strings.TrimSpace(password) == "" {
			return "", fmt.Errorf("netgear reboot requires stored login credentials")
		}
		loginUser := strings.TrimSpace(user)
		if loginUser == "" {
			loginUser = "admin"
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return netgear.Reboot(ctx, host, loginUser, password)
	default:
		return "", fmt.Errorf("unknown task: %s", kind)
	}
}

func sh(user, host string, port int, key, cmd string) (string, error) {
	if port <= 0 {
		port = 22
	}
	args := []string{"-i", key, "-p", strconv.Itoa(port), "-o", "StrictHostKeyChecking=no", fmt.Sprintf("%s@%s", user, host), cmd}
	args = append(args[:len(args)-2], append([]string{"-o", "UserKnownHostsFile=/dev/null", "-o", "GlobalKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR"}, args[len(args)-2:]...)...)
	b, err := exec.Command("ssh", args...).CombinedOutput()
	return string(b), err
}

func (a *App) deviceBackups(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		devID, _ := strconv.ParseInt(r.URL.Query().Get("device_id"), 10, 64)
		if devID == 0 {
			http.Error(w, "device_id required", 400)
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		backups, err := a.DB.ListDeviceBackups(devID, limit)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, backups)
	case http.MethodPost:
		var req struct {
			DeviceID int64 `json:"device_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}
		if req.DeviceID == 0 {
			http.Error(w, "device_id required", 400)
			return
		}
		backup, err := a.createDeviceBackup(req.DeviceID)
		if err != nil {
			a.systemLog("error", "device.backup", "Backup failed", map[string]any{"device_id": req.DeviceID, "error": err.Error()})
			_ = a.DB.InsertDeviceLog(req.DeviceID, "error", fmt.Sprintf("Backup failed: %v", err))
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, backup)
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (a *App) deviceBackupByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/device-backups/")
	path = strings.Trim(path, "/")
	if path == "" {
		http.Error(w, "backup id required", 400)
		return
	}
	backupID, err := strconv.ParseInt(path, 10, 64)
	if err != nil {
		http.Error(w, "invalid backup id", 400)
		return
	}
	backup, err := a.DB.GetDeviceBackup(backupID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "backup not found", 404)
			return
		}
		http.Error(w, err.Error(), 500)
		return
	}
	filename := strings.TrimSpace(backup.Filename)
	if filename == "" {
		filename = fmt.Sprintf("device-backup-%d", backupID)
	}
	mediaType := strings.TrimSpace(backup.MediaType)
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mediaType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Write(backup.Data)
}

func (a *App) createDeviceBackup(deviceID int64) (*store.DeviceBackup, error) {
	if deviceID <= 0 {
		return nil, fmt.Errorf("invalid device id")
	}
	row := a.DB.DB.QueryRow(`SELECT name, host, kind, platform, user, ssh_key, password, meta FROM devices WHERE id=?`, deviceID)
	var name, host, kind, platform, user, sshKey string
	var password sql.NullString
	var meta sql.NullString
	if err := row.Scan(&name, &host, &kind, &platform, &user, &sshKey, &password, &meta); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("device not found")
		}
		return nil, err
	}
	if strings.TrimSpace(host) == "" {
		return nil, fmt.Errorf("device host not configured")
	}
	if !supportsDeviceBackup(platform) {
		return nil, fmt.Errorf("backups not supported for platform %s", platform)
	}
	port := 22
	if meta.Valid && strings.TrimSpace(meta.String) != "" {
		if p := parseSSHPortFromMeta(meta.String); p > 0 {
			port = p
		}
	}
	loginUser := strings.TrimSpace(user)
	if loginUser == "" {
		loginUser = defaultBackupUser(platform)
	}
	if loginUser == "" {
		loginUser = "root"
	}

	keyPath, cleanup, err := a.resolveSSHKey(sshKey)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if strings.TrimSpace(keyPath) == "" {
		return nil, fmt.Errorf("device backup requires an SSH key")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	data, mediaType, ext, err := fetchDeviceBackup(ctx, platform, loginUser, host, port, keyPath)
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

	backup, err := a.DB.InsertDeviceBackup(deviceID, filename, mediaType, int64(len(data)), data)
	if err != nil {
		return nil, err
	}
	_ = a.DB.InsertDeviceLog(deviceID, "info", fmt.Sprintf("Backup stored (%s)", formatBytes(int64(len(data)))))
	a.systemLog("info", "device.backup", fmt.Sprintf("Backup captured for %s", name), map[string]any{
		"device_id":  deviceID,
		"backup_id":  backup.ID,
		"size_bytes": len(data),
		"platform":   platform,
	})
	return backup, nil
}

// exportDevices exports the devices list as JSON or CSV.
func (a *App) exportDevices(w http.ResponseWriter, r *http.Request) {
	format := strings.ToLower(r.URL.Query().Get("format"))
	if format == "" {
		format = "json"
	}
	devs, err := a.DB.ListDevices()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	switch format {
	case "csv":
		var buf bytes.Buffer
		buf.WriteString("id,name,host,kind,platform,user\n")
		for _, d := range devs {
			fmt.Fprintf(&buf, "%v,%v,%v,%v,%v,%v\n", d["id"], d["name"], d["host"], d["kind"], d["platform"], d["user"])
		}
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=devices.csv")
		w.Write(buf.Bytes())
	default:
		writeJSON(w, devs)
	}
}

// exportMetrics exports a metric time series for a device in JSON or CSV.
func (a *App) exportMetrics(w http.ResponseWriter, r *http.Request) {
	devID, _ := strconv.ParseInt(r.URL.Query().Get("device_id"), 10, 64)
	metric := r.URL.Query().Get("metric")
	sinceStr := r.URL.Query().Get("since")
	format := strings.ToLower(r.URL.Query().Get("format"))
	if format == "" {
		format = "json"
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 10000
	}
	if devID == 0 || metric == "" || sinceStr == "" {
		http.Error(w, "missing device_id, metric or since", 400)
		return
	}
	since, err := time.Parse(time.RFC3339, sinceStr)
	if err != nil {
		http.Error(w, "bad since; use RFC3339", 400)
		return
	}
	rows, err := a.DB.MetricsSince(devID, metric, since, limit)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	switch format {
	case "csv":
		var buf bytes.Buffer
		buf.WriteString("ts,value,unit\n")
		for _, m := range rows {
			v := ""
			if m.Value.Valid {
				v = fmt.Sprintf("%f", m.Value.Float64)
			}
			u := ""
			if m.Unit.Valid {
				u = m.Unit.String
			}
			fmt.Fprintf(&buf, "%s,%s,%s\n", m.TS.Format(time.RFC3339), v, u)
		}
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s_%d.csv", metric, devID))
		w.Write(buf.Bytes())
	default:
		writeJSON(w, rows)
	}
}

// backup returns a zip containing config, devices and recent metrics.
func (a *App) backup(w http.ResponseWriter, r *http.Request) {
	// default to last 30 days of metrics
	d := 30
	if v := r.URL.Query().Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			d = n
		}
	}
	since := time.Now().AddDate(0, 0, -d)

	devs, err := a.DB.ListDevices()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	// write config.json
	{
		f, _ := zw.Create("config.json")
		b, _ := json.MarshalIndent(a.Cfg, "", "  ")
		f.Write(b)
	}

	// write devices.json
	{
		f, _ := zw.Create("devices.json")
		b, _ := json.MarshalIndent(devs, "", "  ")
		f.Write(b)
	}

	// write metrics as NDJSON per device
	for _, drow := range devs {
		idAny := drow["id"]
		var id int64
		switch t := idAny.(type) {
		case int64:
			id = t
		case int:
			id = int64(t)
		case float64:
			id = int64(t)
		}
		metrics := []string{"ping_ms", "iperf_mbps"}
		for _, m := range metrics {
			ms, _ := a.DB.MetricsSince(id, m, since, 100000)
			if len(ms) == 0 {
				continue
			}
			f, _ := zw.Create(fmt.Sprintf("metrics/%d_%s.ndjson", id, m))
			for _, row := range ms {
				doc := map[string]any{
					"ts": row.TS.Format(time.RFC3339),
					"value": func() any {
						if row.Value.Valid {
							return row.Value.Float64
						}
						return nil
					}(),
					"unit": func() any {
						if row.Unit.Valid {
							return row.Unit.String
						}
						return nil
					}(),
				}
				b, _ := json.Marshal(doc)
				f.Write(b)
				f.Write([]byte("\n"))
			}
		}
	}

	zw.Close()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=pulseops-backup-%s.zip", time.Now().Format("20060102")))
	w.Write(buf.Bytes())
}

// promMetrics exposes a minimal OpenMetrics/Prometheus text format for quick integration.
func (a *App) promMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintln(w, "# HELP pulseops_up Always 1 if handler reachable")
	fmt.Fprintln(w, "# TYPE pulseops_up gauge")
	fmt.Fprintln(w, "pulseops_up 1")
	// export latest ping per device
	devs, err := a.DB.ListDevices()
	if err != nil {
		return
	}
	for _, d := range devs {
		id := d["id"]
		name := d["name"]
		m, err := a.DB.LatestMetric(toInt64(id), "ping_ms")
		if err == nil && m != nil && m.Value.Valid {
			fmt.Fprintf(w, "pulseops_ping_ms{device_id=\"%v\",device=\"%v\"} %f\n", id, name, m.Value.Float64)
		}
		m2, err := a.DB.LatestMetric(toInt64(id), "iperf_mbps")
		if err == nil && m2 != nil && m2.Value.Valid {
			fmt.Fprintf(w, "pulseops_iperf_mbps{device_id=\"%v\",device=\"%v\"} %f\n", id, name, m2.Value.Float64)
		}
	}
}

type activityLogResponse struct {
	Source     string         `json:"source"`
	ID         int64          `json:"id"`
	DeviceID   *int64         `json:"device_id,omitempty"`
	DeviceName string         `json:"device_name,omitempty"`
	DeviceKind string         `json:"device_kind,omitempty"`
	DeviceHost string         `json:"device_host,omitempty"`
	Level      string         `json:"level"`
	Category   string         `json:"category,omitempty"`
	Message    string         `json:"message"`
	Timestamp  time.Time      `json:"timestamp"`
	Context    map[string]any `json:"context,omitempty"`
}

type ipRangeMatcher struct {
	prefix string
	start  net.IP
	end    net.IP
}

func normalizeIP(ip net.IP) net.IP {
	if ip == nil {
		return nil
	}
	if v4 := ip.To4(); v4 != nil {
		return v4
	}
	return ip.To16()
}

func newIPRangeMatcher(value string) (*ipRangeMatcher, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if strings.Contains(value, "*") {
		prefix := strings.TrimSuffix(value, "*")
		return &ipRangeMatcher{prefix: prefix}, nil
	}
	if strings.Contains(value, "/") {
		_, network, err := net.ParseCIDR(value)
		if err != nil {
			return nil, err
		}
		start := normalizeIP(network.IP)
		if start == nil {
			return nil, fmt.Errorf("invalid cidr")
		}
		end := make(net.IP, len(start))
		copy(end, start)
		mask := network.Mask
		for i := range end {
			end[i] |= ^mask[i]
		}
		return &ipRangeMatcher{start: start, end: end}, nil
	}
	if strings.Contains(value, "-") {
		parts := strings.SplitN(value, "-", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid ip range")
		}
		start := normalizeIP(net.ParseIP(strings.TrimSpace(parts[0])))
		end := normalizeIP(net.ParseIP(strings.TrimSpace(parts[1])))
		if start == nil || end == nil {
			return nil, fmt.Errorf("invalid ip range")
		}
		if bytes.Compare(start, end) > 0 {
			start, end = end, start
		}
		return &ipRangeMatcher{start: start, end: end}, nil
	}
	if strings.HasSuffix(value, ".") {
		return &ipRangeMatcher{prefix: value}, nil
	}
	ip := normalizeIP(net.ParseIP(value))
	if ip == nil {
		return nil, fmt.Errorf("invalid ip range")
	}
	return &ipRangeMatcher{start: ip, end: ip}, nil
}

func (m *ipRangeMatcher) Match(host string) bool {
	if m == nil {
		return true
	}
	if m.prefix != "" {
		return strings.HasPrefix(host, m.prefix)
	}
	ip := normalizeIP(net.ParseIP(host))
	if ip == nil {
		return false
	}
	if len(ip) != len(m.start) {
		if len(m.start) == net.IPv4len {
			ip = ip.To4()
		} else {
			ip = ip.To16()
		}
	}
	if ip == nil {
		return false
	}
	if bytes.Compare(ip, m.start) < 0 {
		return false
	}
	if bytes.Compare(ip, m.end) > 0 {
		return false
	}
	return true
}

func parseIDList(raw string) []int64 {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	var ids []int64
	for _, part := range parts {
		id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err == nil && id > 0 {
			ids = append(ids, id)
		}
	}
	return ids
}

func (a *App) logs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	params := r.URL.Query()
	limit, _ := strconv.Atoi(params.Get("limit"))
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	source := strings.ToLower(strings.TrimSpace(params.Get("source")))
	includeDevice := source == "" || source == "all" || source == "device"
	includeSystem := source == "" || source == "all" || source == "system"
	level := strings.TrimSpace(params.Get("log_level"))
	if level == "" {
		level = strings.TrimSpace(params.Get("log_type"))
	}
	deviceKind := strings.TrimSpace(params.Get("device_kind"))
	if deviceKind == "" {
		deviceKind = strings.TrimSpace(params.Get("device_type"))
	}
	search := strings.TrimSpace(params.Get("q"))
	var since time.Time
	if sinceStr := strings.TrimSpace(params.Get("since")); sinceStr != "" {
		parsed, err := time.Parse(time.RFC3339, sinceStr)
		if err != nil {
			http.Error(w, "invalid since; use RFC3339", http.StatusBadRequest)
			return
		}
		since = parsed
	}
	ipMatcher, err := newIPRangeMatcher(params.Get("ip_range"))
	if err != nil {
		http.Error(w, "invalid ip_range: "+err.Error(), http.StatusBadRequest)
		return
	}
	deviceIDs := parseIDList(params.Get("device_id"))
	if len(deviceIDs) == 0 {
		extra := parseIDList(params.Get("device_ids"))
		if len(extra) > 0 {
			deviceIDs = extra
		}
	}
	var combined []activityLogResponse
	if includeDevice {
		fetchLimit := limit
		if ipMatcher != nil {
			fetchLimit = limit * 4
			if fetchLimit > 2000 {
				fetchLimit = 2000
			}
		}
		dLogs, err := a.DB.RecentDeviceLogsFiltered(store.DeviceLogFilter{
			DeviceIDs:  deviceIDs,
			DeviceKind: deviceKind,
			Level:      level,
			Search:     search,
			Since:      since,
			Limit:      fetchLimit,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		for _, entry := range dLogs {
			if ipMatcher != nil && !ipMatcher.Match(entry.DeviceHost) {
				continue
			}
			deviceID := entry.DeviceID
			combined = append(combined, activityLogResponse{
				Source:     "device",
				ID:         entry.ID,
				DeviceID:   &deviceID,
				DeviceName: entry.DeviceName,
				DeviceKind: entry.DeviceKind,
				DeviceHost: entry.DeviceHost,
				Level:      entry.Level,
				Message:    entry.Message,
				Timestamp:  entry.TS.UTC(),
			})
		}
	}
	if includeSystem {
		sLogs, err := a.DB.RecentSystemLogs(store.SystemLogFilter{
			Level:    level,
			Category: strings.TrimSpace(params.Get("category")),
			Search:   search,
			Since:    since,
			Limit:    limit,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		for _, entry := range sLogs {
			resp := activityLogResponse{
				Source:    "system",
				ID:        entry.ID,
				Level:     entry.Level,
				Category:  entry.Category,
				Message:   entry.Message,
				Timestamp: entry.TS.UTC(),
			}
			if entry.Context != "" {
				var ctx map[string]any
				if err := json.Unmarshal([]byte(entry.Context), &ctx); err == nil {
					resp.Context = ctx
				}
			}
			combined = append(combined, resp)
		}
	}
	if len(combined) == 0 {
		writeJSON(w, combined)
		return
	}
	sort.Slice(combined, func(i, j int) bool {
		return combined[i].Timestamp.After(combined[j].Timestamp)
	})
	if len(combined) > limit {
		combined = combined[:limit]
	}
	writeJSON(w, combined)
}

func (a *App) deviceLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	devID, err := strconv.ParseInt(r.URL.Query().Get("device_id"), 10, 64)
	if err != nil || devID <= 0 {
		http.Error(w, "device_id required", http.StatusBadRequest)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	logs, err := a.DB.RecentDeviceLogs(devID, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	resp := make([]map[string]any, 0, len(logs))
	for _, entry := range logs {
		resp = append(resp, map[string]any{
			"ts":      entry.TS.UTC().Format(time.RFC3339),
			"level":   entry.Level,
			"message": entry.Message,
		})
	}
	writeJSON(w, resp)
}

type settingsResponse struct {
	Theme                     string `json:"theme"`
	AccountName               string `json:"account_name"`
	AccountEmail              string `json:"account_email"`
	EmailNotificationsEnabled bool   `json:"email_notifications_enabled"`
	EmailServerHost           string `json:"email_server_host"`
	EmailServerPort           int    `json:"email_server_port"`
	EmailServerUsername       string `json:"email_server_username"`
	EmailServerPasswordSet    bool   `json:"email_server_password_set"`
	WebNotificationsEnabled   bool   `json:"web_notifications_enabled"`
}

type settingsRequest struct {
	Theme                     string  `json:"theme"`
	AccountName               string  `json:"account_name"`
	AccountEmail              string  `json:"account_email"`
	EmailNotificationsEnabled bool    `json:"email_notifications_enabled"`
	EmailServerHost           string  `json:"email_server_host"`
	EmailServerPort           int     `json:"email_server_port"`
	EmailServerUsername       string  `json:"email_server_username"`
	EmailServerPassword       *string `json:"email_server_password"`
	WebNotificationsEnabled   bool    `json:"web_notifications_enabled"`
}

func (a *App) settings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		resp, err := a.currentSettings()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, resp)
	case http.MethodPut:
		var req settingsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		theme := strings.ToLower(strings.TrimSpace(req.Theme))
		if theme == "" {
			theme = "light"
		}
		switch theme {
		case "light", "dark", "system":
		default:
			http.Error(w, "invalid theme", http.StatusBadRequest)
			return
		}
		port := req.EmailServerPort
		if port <= 0 {
			port = 587
		}
		if port > 65535 {
			http.Error(w, "email_server_port out of range", http.StatusBadRequest)
			return
		}
		updates := map[string]string{
			"theme":                       theme,
			"account_name":                strings.TrimSpace(req.AccountName),
			"account_email":               strings.TrimSpace(req.AccountEmail),
			"email_notifications_enabled": strconv.FormatBool(req.EmailNotificationsEnabled),
			"email_server_host":           strings.TrimSpace(req.EmailServerHost),
			"email_server_username":       strings.TrimSpace(req.EmailServerUsername),
			"email_server_port":           strconv.Itoa(port),
			"web_notifications_enabled":   strconv.FormatBool(req.WebNotificationsEnabled),
		}
		if req.EmailServerPassword != nil {
			updates["email_server_password"] = strings.TrimSpace(*req.EmailServerPassword)
		}
		if err := a.DB.SetSettings(updates); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		a.systemLog("info", "settings.update", "Instance settings updated via web UI", map[string]any{
			"theme":                       theme,
			"email_notifications_enabled": req.EmailNotificationsEnabled,
			"web_notifications_enabled":   req.WebNotificationsEnabled,
		})
		resp, err := a.currentSettings()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, resp)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) currentSettings() (settingsResponse, error) {
	values, err := a.DB.GetSettings()
	if err != nil {
		return settingsResponse{}, err
	}
	resp := settingsResponse{
		Theme:           "light",
		EmailServerPort: 587,
	}
	if v := strings.TrimSpace(values["theme"]); v != "" {
		resp.Theme = v
	}
	resp.AccountName = strings.TrimSpace(values["account_name"])
	resp.AccountEmail = strings.TrimSpace(values["account_email"])
	resp.EmailNotificationsEnabled = parseBoolString(values["email_notifications_enabled"])
	resp.EmailServerHost = strings.TrimSpace(values["email_server_host"])
	resp.EmailServerUsername = strings.TrimSpace(values["email_server_username"])
	if portStr := strings.TrimSpace(values["email_server_port"]); portStr != "" {
		if parsed, err := strconv.Atoi(portStr); err == nil && parsed > 0 {
			resp.EmailServerPort = parsed
		}
	}
	resp.EmailServerPasswordSet = strings.TrimSpace(values["email_server_password"]) != ""
	resp.WebNotificationsEnabled = parseBoolString(values["web_notifications_enabled"])
	return resp, nil
}

func parseBoolString(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func toInt64(v any) int64 {
	switch t := v.(type) {
	case int64:
		return t
	case int:
		return int64(t)
	case float64:
		return int64(t)
	default:
		return 0
	}
}

func parseSSHPortValue(value string) (int, error) {
	value = strings.TrimSpace(value)
	port, err := strconv.Atoi(value)
	if err != nil {
		return 0, err
	}
	if port <= 0 || port > 65535 {
		return 0, fmt.Errorf("ssh port out of range")
	}
	return port, nil
}

func supportsDeviceBackup(platform string) bool {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "openwrt", "edgeos":
		return true
	default:
		return false
	}
}

func defaultBackupUser(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "edgeos":
		return "ubnt"
	default:
		return "root"
	}
}

func parseSSHPortFromMeta(meta string) int {
	var obj map[string]any
	dec := json.NewDecoder(strings.NewReader(meta))
	dec.UseNumber()
	if err := dec.Decode(&obj); err != nil {
		return 22
	}
	if v, ok := obj["ssh_port"]; ok {
		switch val := v.(type) {
		case json.Number:
			if n, err := val.Int64(); err == nil && n > 0 && n < 65536 {
				return int(n)
			}
		case float64:
			n := int(val)
			if n > 0 && n < 65536 {
				return n
			}
		case string:
			if p, err := parseSSHPortValue(val); err == nil {
				return p
			}
		}
	}
	return 22
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
	baseArgs := []string{"-p", strconv.Itoa(port), "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "GlobalKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20"}
	if strings.TrimSpace(keyPath) != "" {
		baseArgs = append([]string{"-i", keyPath}, baseArgs...)
	}
	target := fmt.Sprintf("%s@%s", user, host)
	args := append(baseArgs, target, cmd)
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
		case unicode.IsSpace(r) || r == '.' || r == '/' || r == '\\':
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

func anyToString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case fmt.Stringer:
		return t.String()
	case json.Number:
		return t.String()
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		if v == nil {
			return ""
		}
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(b)
	}
}

func anyToBool(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		s := strings.TrimSpace(strings.ToLower(v))
		return s == "true" || s == "1" || s == "yes" || s == "on"
	case json.Number:
		if i, err := v.Int64(); err == nil {
			return i != 0
		}
	case float64:
		return v != 0
	case int:
		return v != 0
	case int64:
		return v != 0
	}
	return false
}

func importMetaString(value any) string {
	if value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(b)
	}
}

func derivePasswordFromImport(rec map[string]any) (string, bool) {
	var password string
	provided := false
	if v, ok := rec["password"]; ok {
		password = strings.TrimSpace(anyToString(v))
		provided = true
	}
	if v, ok := rec["password_set"]; ok {
		switch val := v.(type) {
		case bool:
			if !val {
				password = ""
				provided = true
			}
		case string:
			lowered := strings.ToLower(strings.TrimSpace(val))
			if lowered == "false" || lowered == "0" || lowered == "no" {
				password = ""
				provided = true
			}
		}
	}
	return password, provided
}

func (a *App) startDeletionSweeper() {
	a.deletionOnce.Do(func() {
		go a.deletionSweeper()
	})
}

func (a *App) deletionSweeper() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for range ticker.C {
		pending, err := a.DB.DueDeviceDeletions(time.Now())
		if err != nil {
			log.Printf("pending deletion sweep: %v", err)
			continue
		}
		for _, p := range pending {
			if err := a.DB.DeleteDevice(p.DeviceID); err != nil {
				log.Printf("finalize device deletion %d: %v", p.DeviceID, err)
			}
		}
	}
}

// validateDeviceConfig tests device connectivity and configuration
func (a *App) validateDeviceConfig(device config.Device) map[string]any {
	result := map[string]any{
		"valid":    false,
		"errors":   []string{},
		"warnings": []string{},
		"tests":    map[string]any{},
	}

	var errors []string
	var warnings []string
	tests := make(map[string]any)

	// Basic validation
	if device.Name == "" {
		errors = append(errors, "device name is required")
	}
	if device.Host == "" {
		errors = append(errors, "host is required")
	}
	if device.Kind == "" {
		errors = append(errors, "device kind is required")
	}
	if device.Platform == "" {
		errors = append(errors, "platform is required")
	}

	// Get template for validation rules
	template := templates.GetTemplateByID(device.Platform)
	if template == nil {
		warnings = append(warnings, "unknown platform, using generic validation")
	}

	sshPort := 22
	portTest := map[string]any{"success": true, "port": sshPort}
	if device.Meta != nil {
		if val, ok := device.Meta["ssh_port"]; ok {
			if port, err := parseSSHPortValue(val); err != nil {
				errors = append(errors, "SSH port must be a number between 1 and 65535")
				portTest = map[string]any{"success": false, "error": "invalid ssh port"}
			} else {
				sshPort = port
				portTest = map[string]any{"success": true, "port": sshPort}
			}
		}
	}
	tests["ssh_port"] = portTest

	// Test connectivity
	if device.Host != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		// Test ping
		pingTime, err := ping.PingOnce(ctx, device.Host, 3*time.Second)
		if err != nil {
			tests["ping"] = map[string]any{"success": false, "error": err.Error()}
			errors = append(errors, "device is not reachable via ping")
		} else {
			tests["ping"] = map[string]any{"success": true, "time_ms": pingTime}
		}

		// Test required ports if template is available
		if template != nil && len(template.Validation.RequiredPorts) > 0 {
			portTests := make(map[string]any)
			for _, port := range template.Validation.RequiredPorts {
				if isPortOpen(ctx, device.Host, port, 3*time.Second) {
					portTests[fmt.Sprintf("port_%d", port)] = map[string]any{"success": true}
				} else {
					portTests[fmt.Sprintf("port_%d", port)] = map[string]any{"success": false}
					warnings = append(warnings, fmt.Sprintf("required port %d is not accessible", port))
				}
			}
			tests["ports"] = portTests
		}
	}

	// SSH key validation
	if device.SSHKey != "" {
		if id, ok := keys.ParseReference(device.SSHKey); ok {
			if a.Keys == nil {
				errors = append(errors, "stored SSH key is not available")
			} else {
				if _, _, err := a.Keys.GetDecryptedKey(id); err != nil {
					errors = append(errors, "stored SSH key could not be loaded")
				} else {
					tests["ssh_key"] = map[string]any{"success": true, "stored": true, "id": id}
				}
			}
		} else {
			if _, err := os.Stat(device.SSHKey); os.IsNotExist(err) {
				errors = append(errors, "SSH key file does not exist")
			} else {
				tests["ssh_key"] = map[string]any{"success": true, "path": device.SSHKey}
			}
		}
	}

	// Platform-specific validation
	if template != nil {
		if template.RequiresSSH && device.SSHKey == "" {
			errors = append(errors, "SSH key is required for this platform")
		}
		if template.RequiresPassword && device.Password == "" {
			warnings = append(warnings, "password may be required for this platform")
		}
	}

	result["errors"] = errors
	result["warnings"] = warnings
	result["tests"] = tests
	result["valid"] = len(errors) == 0

	return result
}

// isPortOpen checks if a port is open (helper function for validation)
func isPortOpen(ctx context.Context, host string, port int, timeout time.Duration) bool {
	address := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// Authentication handlers

// authStatus returns the current authentication status
func (a *App) authStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	authState, err := a.AuthMW.GetAuthState(r)
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, authState)
}

// authSetup handles initial setup
func (a *App) authSetup(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// Check if setup is already completed
		setupCompleted, err := a.DB.IsSetupCompleted()
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"setup_completed": setupCompleted})

	case http.MethodPost:
		// Check if setup is already completed
		setupCompleted, err := a.DB.IsSetupCompleted()
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if setupCompleted {
			http.Error(w, "setup already completed", http.StatusBadRequest)
			return
		}

		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
			Email    string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}

		// Validate input
		if strings.TrimSpace(req.Username) == "" {
			http.Error(w, "username is required", http.StatusBadRequest)
			return
		}
		if len(req.Password) < 6 {
			http.Error(w, "password must be at least 6 characters", http.StatusBadRequest)
			return
		}

		// Create user
		user, err := a.DB.CreateUser(req.Username, req.Password, req.Email)
		if err != nil {
			http.Error(w, "failed to create user: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Mark setup as completed
		if err := a.DB.MarkSetupCompleted(); err != nil {
			http.Error(w, "failed to complete setup", http.StatusInternalServerError)
			return
		}

		// Create session
		session, err := a.DB.CreateSession(user.ID)
		if err != nil {
			http.Error(w, "failed to create session", http.StatusInternalServerError)
			return
		}

		// Set session cookie
		auth.SetSessionCookie(w, session.ID)

		writeJSON(w, map[string]any{
			"success": true,
			"user":    user,
		})

		a.systemLog("info", "auth.setup", "Initial setup completed", map[string]any{
			"username": user.Username,
		})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// authLogin handles user login
func (a *App) authLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if setup is completed
	setupCompleted, err := a.DB.IsSetupCompleted()
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if !setupCompleted {
		http.Error(w, "setup not completed", http.StatusBadRequest)
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate credentials
	user, err := a.DB.ValidateUserPassword(req.Username, req.Password)
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	// Create session
	session, err := a.DB.CreateSession(user.ID)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	// Set session cookie
	auth.SetSessionCookie(w, session.ID)

	writeJSON(w, map[string]any{
		"success": true,
		"user":    user,
	})

	a.systemLog("info", "auth.login", "User logged in", map[string]any{
		"username": user.Username,
	})
}

// authLogout handles user logout
func (a *App) authLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get session cookie
	cookie, err := r.Cookie(auth.SessionCookieName)
	if err == nil {
		// Delete session from database
		_ = a.DB.DeleteSession(cookie.Value)
	}

	// Clear session cookie
	auth.ClearSessionCookie(w)

	writeJSON(w, map[string]any{"success": true})

	a.systemLog("info", "auth.logout", "User logged out", nil)
}

// Topology mapping handlers

func (a *App) mapGroups(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		groups, err := a.DB.ListMapGroups()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}

		// Build hierarchy with children and map IDs
		groupMap := make(map[string]*store.MapGroup)
		for i := range groups {
			groupMap[groups[i].ID] = &groups[i]
		}

		// Get all saved maps to populate map IDs
		maps, err := a.DB.ListSavedMaps()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}

		// Group maps by group ID
		mapsByGroup := make(map[string][]string)
		for _, m := range maps {
			mapsByGroup[m.GroupID] = append(mapsByGroup[m.GroupID], m.ID)
		}

		// Populate children and map IDs
		for _, group := range groups {
			if g := groupMap[group.ID]; g != nil {
				g.MapIDs = mapsByGroup[group.ID]
				if g.MapIDs == nil {
					g.MapIDs = []string{}
				}

				// Find children
				for _, other := range groups {
					if other.ParentID != nil && *other.ParentID == group.ID {
						g.Children = append(g.Children, other.ID)
					}
				}
				if g.Children == nil {
					g.Children = []string{}
				}
			}
		}

		writeJSON(w, groups)
	case http.MethodPost:
		var group store.MapGroup
		if err := json.NewDecoder(r.Body).Decode(&group); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}

		if group.ID == "" || group.Name == "" {
			http.Error(w, "id and name are required", 400)
			return
		}

		if err := a.DB.CreateMapGroup(group.ID, group.Name, group.ParentID); err != nil {
			http.Error(w, "failed to create map group: "+err.Error(), 500)
			return
		}

		writeJSON(w, map[string]any{"id": group.ID, "message": "map group created successfully"})
		a.systemLog("info", "map.group.create", fmt.Sprintf("Map group %s created", group.Name), map[string]any{
			"group_id": group.ID,
			"name":     group.Name,
		})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (a *App) mapGroupByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/map-groups/")
	if path == "" {
		http.Error(w, "group ID required", 400)
		return
	}

	switch r.Method {
	case http.MethodGet:
		group, err := a.DB.GetMapGroup(path)
		if err != nil {
			http.Error(w, "group not found", 404)
			return
		}
		writeJSON(w, group)
	case http.MethodPut:
		var group store.MapGroup
		if err := json.NewDecoder(r.Body).Decode(&group); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}

		if group.Name == "" {
			http.Error(w, "name is required", 400)
			return
		}

		if err := a.DB.UpdateMapGroup(path, group.Name, group.ParentID); err != nil {
			http.Error(w, "failed to update map group: "+err.Error(), 500)
			return
		}

		writeJSON(w, map[string]any{"message": "map group updated successfully"})
		a.systemLog("info", "map.group.update", fmt.Sprintf("Map group %s updated", group.Name), map[string]any{
			"group_id": path,
			"name":     group.Name,
		})
	case http.MethodDelete:
		if err := a.DB.DeleteMapGroup(path); err != nil {
			http.Error(w, "failed to delete map group: "+err.Error(), 500)
			return
		}

		writeJSON(w, map[string]any{"message": "map group deleted successfully"})
		a.systemLog("info", "map.group.delete", fmt.Sprintf("Map group %s deleted", path), map[string]any{
			"group_id": path,
		})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (a *App) savedMaps(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		maps, err := a.DB.ListSavedMaps()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, maps)
	case http.MethodPost:
		var savedMap store.SavedMap
		if err := json.NewDecoder(r.Body).Decode(&savedMap); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}

		if savedMap.ID == "" || savedMap.Name == "" || savedMap.GroupID == "" {
			http.Error(w, "id, name, and group_id are required", 400)
			return
		}

		if err := a.DB.CreateSavedMap(savedMap); err != nil {
			http.Error(w, "failed to create saved map: "+err.Error(), 500)
			return
		}

		writeJSON(w, map[string]any{"id": savedMap.ID, "message": "saved map created successfully"})
		a.systemLog("info", "map.create", fmt.Sprintf("Saved map %s created", savedMap.Name), map[string]any{
			"map_id":   savedMap.ID,
			"name":     savedMap.Name,
			"group_id": savedMap.GroupID,
		})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (a *App) savedMapByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/saved-maps/")
	if path == "" {
		http.Error(w, "map ID required", 400)
		return
	}

	switch r.Method {
	case http.MethodGet:
		savedMap, err := a.DB.GetSavedMap(path)
		if err != nil {
			http.Error(w, "map not found", 404)
			return
		}
		writeJSON(w, savedMap)
	case http.MethodPut:
		var savedMap store.SavedMap
		if err := json.NewDecoder(r.Body).Decode(&savedMap); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}

		savedMap.ID = path // Ensure ID matches URL
		if savedMap.Name == "" || savedMap.GroupID == "" {
			http.Error(w, "name and group_id are required", 400)
			return
		}

		if err := a.DB.UpdateSavedMap(savedMap); err != nil {
			http.Error(w, "failed to update saved map: "+err.Error(), 500)
			return
		}

		writeJSON(w, map[string]any{"message": "saved map updated successfully"})
		a.systemLog("info", "map.update", fmt.Sprintf("Saved map %s updated", savedMap.Name), map[string]any{
			"map_id":   path,
			"name":     savedMap.Name,
			"group_id": savedMap.GroupID,
		})
	case http.MethodDelete:
		if err := a.DB.DeleteSavedMap(path); err != nil {
			http.Error(w, "failed to delete saved map: "+err.Error(), 500)
			return
		}

		writeJSON(w, map[string]any{"message": "saved map deleted successfully"})
		a.systemLog("info", "map.delete", fmt.Sprintf("Saved map %s deleted", path), map[string]any{
			"map_id": path,
		})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (a *App) mapCanvasByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/map-canvas/")
	if path == "" {
		http.Error(w, "map ID required", 400)
		return
	}

	switch r.Method {
	case http.MethodGet:
		canvasData, err := a.DB.GetMapCanvasData(path)
		if err != nil {
			http.Error(w, "canvas data not found", 404)
			return
		}
		writeJSON(w, canvasData)
	case http.MethodPut:
		var canvasData store.MapCanvasData
		if err := json.NewDecoder(r.Body).Decode(&canvasData); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}

		canvasData.MapID = path // Ensure ID matches URL
		if err := a.DB.SaveMapCanvasData(canvasData); err != nil {
			http.Error(w, "failed to save canvas data: "+err.Error(), 500)
			return
		}

		writeJSON(w, map[string]any{"message": "canvas data saved successfully"})
		a.systemLog("info", "map.canvas.save", fmt.Sprintf("Canvas data saved for map %s", path), map[string]any{
			"map_id": path,
			"nodes":  len(canvasData.Nodes),
			"edges":  len(canvasData.Edges),
		})
	case http.MethodDelete:
		if err := a.DB.DeleteMapCanvasData(path); err != nil {
			http.Error(w, "failed to delete canvas data: "+err.Error(), 500)
			return
		}

		writeJSON(w, map[string]any{"message": "canvas data deleted successfully"})
		a.systemLog("info", "map.canvas.delete", fmt.Sprintf("Canvas data deleted for map %s", path), map[string]any{
			"map_id": path,
		})
	default:
		http.Error(w, "method not allowed", 405)
	}
}
