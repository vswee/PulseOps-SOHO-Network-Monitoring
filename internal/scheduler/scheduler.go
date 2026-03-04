package scheduler

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pulseops/pulseops/internal/backups"
	"github.com/pulseops/pulseops/internal/collectors/iperf3c"
	"github.com/pulseops/pulseops/internal/collectors/ping"
	"github.com/pulseops/pulseops/internal/collectors/snmp"
	"github.com/pulseops/pulseops/internal/config"
	"github.com/pulseops/pulseops/internal/executil"
	"github.com/pulseops/pulseops/internal/keys"
	"github.com/pulseops/pulseops/internal/network"
	"github.com/pulseops/pulseops/internal/store"
)

var (
	ErrDeviceNotActive = errors.New("scheduler: device not active")
	ErrMissingSSHUser  = errors.New("scheduler: missing ssh user")
)

const (
	deviceSyncInterval            = 10 * time.Second
	pingInterval                  = 30 * time.Second
	pingTimeout                   = 5 * time.Second
	pingBudget                    = 8 * time.Second
	systemMetricsInterval         = 1 * time.Minute
	systemMetricsTimeout          = 25 * time.Second
	snmpMetricsTimeout            = 30 * time.Second
	errorLogRetention             = 2 * time.Hour
	errorLogDuplicateGuard        = 30 * time.Minute
	networkClassificationInterval = 5 * time.Minute
)

const systemMetricsScript = `#!/bin/sh
export LC_ALL=C

if [ -r /proc/stat ]; then
line=$(head -n 1 /proc/stat 2>/dev/null)
set -- $line
printf 'CPU_STAT:%s,%s,%s,%s,%s,%s,%s,%s\n' "${2:-0}" "${3:-0}" "${4:-0}" "${5:-0}" "${6:-0}" "${7:-0}" "${8:-0}" "${9:-0}"
fi

if [ -r /proc/loadavg ]; then
read load1 load5 load15 _ < /proc/loadavg
printf 'LOAD_AVG:%s,%s,%s\n' "$load1" "$load5" "$load15"
fi

if [ -r /proc/meminfo ]; then
mem_total=$(awk '/MemTotal/ {print $2; exit}' /proc/meminfo 2>/dev/null)
mem_avail=$(awk '/MemAvailable/ {print $2; exit}' /proc/meminfo 2>/dev/null)
mem_free=$(awk '/MemFree/ {print $2; exit}' /proc/meminfo 2>/dev/null)
swap_total=$(awk '/SwapTotal/ {print $2; exit}' /proc/meminfo 2>/dev/null)
swap_free=$(awk '/SwapFree/ {print $2; exit}' /proc/meminfo 2>/dev/null)
printf 'MEMORY:%s,%s,%s,%s,%s\n' "${mem_total:-0}" "${mem_avail:-0}" "${mem_free:-0}" "${swap_total:-0}" "${swap_free:-0}"
fi

if [ -r /proc/uptime ]; then
read uptime_seconds _ < /proc/uptime
printf 'UPTIME:%s\n' "$uptime_seconds"
fi

if command -v df >/dev/null 2>&1; then
line=$(df -P -k / 2>/dev/null | awk 'NR==2 {print $2","$3","$4","$5}')
if [ -n "$line" ]; then
printf 'DISK:%s\n' "$line"
fi
fi

if [ -d /sys/class/net ]; then
for iface in /sys/class/net/*; do
[ -e "$iface" ] || continue
name=$(basename "$iface")
[ "$name" = "lo" ] && continue
oper=$(cat "$iface/operstate" 2>/dev/null)
speed=$(cat "$iface/speed" 2>/dev/null)
duplex=$(cat "$iface/duplex" 2>/dev/null)
rx_bytes=$(cat "$iface/statistics/rx_bytes" 2>/dev/null)
tx_bytes=$(cat "$iface/statistics/tx_bytes" 2>/dev/null)
rx_packets=$(cat "$iface/statistics/rx_packets" 2>/dev/null)
tx_packets=$(cat "$iface/statistics/tx_packets" 2>/dev/null)
mac=$(cat "$iface/address" 2>/dev/null)
printf 'IFACE:%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$name" "$oper" "$speed" "$duplex" "$rx_bytes" "$tx_bytes" "$rx_packets" "$tx_packets" "$mac"
done
fi

if [ -r /tmp/sysinfo/model ]; then
model=$(cat /tmp/sysinfo/model 2>/dev/null)
elif [ -r /proc/device-tree/model ]; then
model=$(tr -d '\0' </proc/device-tree/model 2>/dev/null)
else
model=""
fi
if [ -n "$model" ]; then
printf 'MODEL:%s\n' "$model"
fi

if [ -r /tmp/sysinfo/board_name ]; then
board=$(cat /tmp/sysinfo/board_name 2>/dev/null)
if [ -n "$board" ]; then
printf 'BOARD:%s\n' "$board"
fi
fi

hostname=$(hostname 2>/dev/null)
if [ -n "$hostname" ]; then
printf 'HOSTNAME:%s\n' "$hostname"
fi

kernel=$(uname -sr 2>/dev/null)
if [ -n "$kernel" ]; then
printf 'KERNEL:%s\n' "$kernel"
fi

arch=$(uname -m 2>/dev/null)
if [ -n "$arch" ]; then
printf 'ARCH:%s\n' "$arch"
fi

if [ -r /etc/os-release ]; then
os_name=$(grep '^PRETTY_NAME=' /etc/os-release | head -n1 | cut -d= -f2- | tr -d '"')
if [ -n "$os_name" ]; then
printf 'OS:%s\n' "$os_name"
fi
fi

cpu_model=$(awk -F: '/model name/ {print $2; exit}' /proc/cpuinfo 2>/dev/null | sed 's/^ //')
if [ -n "$cpu_model" ]; then
printf 'CPU_MODEL:%s\n' "$cpu_model"
fi

cpu_cores=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null)
if [ -n "$cpu_cores" ]; then
printf 'CPU_CORES:%s\n' "$cpu_cores"
fi

collect_logs() {
if command -v logread >/dev/null 2>&1; then
logread -l 200 2>/dev/null
return
fi
if command -v journalctl >/dev/null 2>&1; then
journalctl -n 200 -p 0..4 --no-pager 2>/dev/null
return
fi
if [ -r /var/log/messages ]; then
tail -n 200 /var/log/messages 2>/dev/null
return
fi
dmesg 2>/dev/null
}

collect_logs | tail -n 200 | while IFS= read -r line; do
[ -n "$line" ] || continue
lower=$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')
case "$lower" in
*error*|*fail*|*critical*|*alert*|*warn*) printf 'SYSLOG:%s\n' "$line" ;;
esac
done
`

type deviceRunner struct {
	cancel context.CancelFunc
	state  *deviceState
}

type deviceState struct {
	record         store.DeviceRecord
	meta           map[string]string
	sshPort        int
	snmpEnabled    bool
	snmpConfig     snmp.Config
	snmpInterval   time.Duration
	lastSNMP       time.Time
	iperfEnabled   bool
	iperfInterval  time.Duration
	iperfDuration  int
	iperfParallel  int
	backupEnabled  bool
	backupInterval time.Duration
	recentErrors   map[string]time.Time
	lastCPU        *cpuSample
}

type cpuSample struct {
	total float64
	idle  float64
}

type systemSnapshot struct {
	cpuValues       []float64
	loadAvg         [3]float64
	memTotalKB      float64
	memAvailableKB  float64
	memFreeKB       float64
	swapTotalKB     float64
	swapFreeKB      float64
	uptimeSeconds   float64
	diskTotalKB     float64
	diskUsedKB      float64
	diskFreeKB      float64
	diskUsedPercent float64
	hardwareInfo    map[string]string
	interfaces      []interfaceSnapshot
	logs            []string
}

type interfaceSnapshot struct {
	Name       string   `json:"name"`
	OperState  string   `json:"oper_state"`
	SpeedMbps  *float64 `json:"speed_mbps,omitempty"`
	Duplex     string   `json:"duplex"`
	RXBytes    uint64   `json:"rx_bytes"`
	TXBytes    uint64   `json:"tx_bytes"`
	RXPackets  uint64   `json:"rx_packets"`
	TXPackets  uint64   `json:"tx_packets"`
	MACAddress string   `json:"mac_address"`
	AdminState string   `json:"admin_state,omitempty"`
	InErrors   uint64   `json:"in_errors,omitempty"`
	OutErrors  uint64   `json:"out_errors,omitempty"`
}

type Svc struct {
	Cfg     *config.Config
	DB      *store.Store
	Keys    *keys.Manager
	Backups *backups.Manager
	Stop    chan struct{}

	wg        sync.WaitGroup
	devicesMu sync.Mutex
	devices   map[int64]*deviceRunner

	classifierMu sync.Mutex
	classifier   *network.DeviceClassifier
}

func New(cfg *config.Config, db *store.Store, keyManager *keys.Manager, backupManager *backups.Manager) *Svc {
	svc := &Svc{
		Cfg:     cfg,
		DB:      db,
		Keys:    keyManager,
		Backups: backupManager,
		Stop:    make(chan struct{}),
		devices: make(map[int64]*deviceRunner),
	}

	classifier, err := network.NewDeviceClassifier()
	if err != nil {
		log.Printf("device classifier init: %v", err)
	}
	if classifier != nil && networkClassificationInterval > 0 {
		classifier.SetRefreshInterval(networkClassificationInterval / 2)
	}
	svc.classifier = classifier

	return svc
}

func (s *Svc) ensureClassifier() *network.DeviceClassifier {
	s.classifierMu.Lock()
	defer s.classifierMu.Unlock()
	if s.classifier == nil {
		classifier, err := network.NewDeviceClassifier()
		if err != nil {
			log.Printf("device classifier init: %v", err)
		}
		s.classifier = classifier
	}
	return s.classifier
}

func (s *Svc) Start() {
	s.bootstrapConfigDevices()

	s.wg.Add(1)
	go s.deviceSyncLoop()

	if networkClassificationInterval > 0 {
		s.wg.Add(1)
		go s.classifierRefreshLoop()
	}
}

func (s *Svc) bootstrapConfigDevices() {
	for _, d := range s.Cfg.Devices {
		deleted, err := s.DB.IsDeviceDeleted(d.Name)
		if err != nil {
			log.Printf("device skip check %s: %v", d.Name, err)
			continue
		}
		if deleted {
			log.Printf("device %s skipped (marked deleted)", d.Name)
			continue
		}
		if _, err := s.DB.UpsertDevice(d.Name, d.Host, d.Kind, d.Platform, d.User, d.SSHKey, d.Password, "", "wired", false); err != nil {
			log.Printf("device upsert %s: %v", d.Name, err)
		}
	}
}

func (s *Svc) deviceSyncLoop() {
	defer s.wg.Done()
	defer s.stopAllDevices()

	if err := s.syncDevices(); err != nil {
		log.Printf("scheduler sync: %v", err)
	}

	ticker := time.NewTicker(deviceSyncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.Stop:
			return
		case <-ticker.C:
			if err := s.syncDevices(); err != nil {
				log.Printf("scheduler sync: %v", err)
			}
		}
	}
}

func (s *Svc) classifierRefreshLoop() {
	defer s.wg.Done()
	if networkClassificationInterval <= 0 {
		<-s.Stop
		return
	}
	ticker := time.NewTicker(networkClassificationInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.Stop:
			return
		case <-ticker.C:
			classifier := s.ensureClassifier()
			if classifier == nil {
				continue
			}
			if err := classifier.Refresh(); err != nil {
				log.Printf("device classifier refresh: %v", err)
			}
		}
	}
}

func (s *Svc) syncDevices() error {
	devices, err := s.DB.ListDeviceRecords()
	if err != nil {
		return err
	}

	next := make(map[int64]store.DeviceRecord, len(devices))
	for _, dev := range devices {
		next[dev.ID] = dev
	}

	s.devicesMu.Lock()
	defer s.devicesMu.Unlock()

	for id, runner := range s.devices {
		dev, ok := next[id]
		if !ok || deviceChanged(runner.state.record, dev) {
			runner.cancel()
			delete(s.devices, id)
		}
	}

	for id, dev := range next {
		if _, ok := s.devices[id]; ok {
			continue
		}
		s.startDeviceLocked(dev)
	}

	return nil
}

func deviceChanged(a, b store.DeviceRecord) bool {
	return a.Name != b.Name || a.Host != b.Host || a.Kind != b.Kind || a.Platform != b.Platform || a.User != b.User || a.SSHKey != b.SSHKey || a.Password != b.Password || a.Meta != b.Meta
}

func (s *Svc) startDeviceLocked(dev store.DeviceRecord) {
	ctx, cancel := context.WithCancel(context.Background())
	state := s.buildDeviceState(dev)
	s.devices[dev.ID] = &deviceRunner{cancel: cancel, state: &state}

	s.wg.Add(1)
	go func(st *deviceState) {
		defer s.wg.Done()
		s.runDeviceLoop(ctx, st)
	}(&state)
}

func (s *Svc) runDeviceLoop(ctx context.Context, state *deviceState) {
	if state == nil {
		return
	}
	s.recordDeviceClassification(state)
	pingTicker := time.NewTicker(pingInterval)
	defer pingTicker.Stop()

	var iperfTicker *time.Ticker
	var iperfC <-chan time.Time
	if state.iperfEnabled && state.iperfInterval > 0 {
		iperfTicker = time.NewTicker(state.iperfInterval)
		iperfC = iperfTicker.C
		defer iperfTicker.Stop()
		s.collectIperf(ctx, state)
	}

	var (
		classificationTicker *time.Ticker
		classificationC      <-chan time.Time
		metricsTicker        *time.Ticker
		metricsC             <-chan time.Time
		backupTimer          *time.Timer
		backupC              <-chan time.Time
	)
	if networkClassificationInterval > 0 {
		classificationTicker = time.NewTicker(networkClassificationInterval)
		classificationC = classificationTicker.C
		defer classificationTicker.Stop()
	}
	metricsEnabled := strings.TrimSpace(state.record.User) != "" || state.snmpEnabled
	if metricsEnabled {
		metricsTicker = time.NewTicker(systemMetricsInterval)
		metricsC = metricsTicker.C
		defer metricsTicker.Stop()
	}

	scheduleBackup := func() {}
	if state.backupEnabled && s.Backups != nil {
		scheduleBackup = func() {
			if backupTimer != nil {
				backupTimer.Stop()
				backupTimer = nil
				backupC = nil
			}
			due, next, _ := s.backupSchedule(state)
			if !due && next.IsZero() {
				return
			}
			delay := time.Minute
			if !due {
				delay = time.Until(next)
				if delay < time.Minute {
					delay = time.Minute
				}
			}
			backupTimer = time.NewTimer(delay)
			backupC = backupTimer.C
		}
		scheduleBackup()
	}
	defer func() {
		if backupTimer != nil {
			backupTimer.Stop()
		}
	}()

	s.collectPing(ctx, state.record)
	if metricsEnabled {
		s.collectSystemMetrics(ctx, state)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-pingTicker.C:
			s.collectPing(ctx, state.record)
		case <-classificationC:
			s.recordDeviceClassification(state)
		case <-metricsC:
			s.collectSystemMetrics(ctx, state)
		case <-iperfC:
			s.collectIperf(ctx, state)
		case <-backupC:
			if s.Backups == nil || !state.backupEnabled {
				continue
			}
			due, _, _ := s.backupSchedule(state)
			if !due {
				scheduleBackup()
				continue
			}
			s.captureScheduledBackup(ctx, state)
			scheduleBackup()
		}
	}
}

func (s *Svc) recordDeviceClassification(state *deviceState) {
	if state == nil || s.DB == nil {
		return
	}

	classifier := s.ensureClassifier()
	if classifier == nil {
		return
	}

	result := classifier.Classify(state.record.Host)

	latest, err := s.DB.LatestMetric(state.record.ID, "network_classification")
	if err != nil {
		log.Printf("load network classification metric %d: %v", state.record.ID, err)
	} else if latest != nil && latest.Raw.Valid {
		var existing network.ClassificationResult
		if err := json.Unmarshal([]byte(latest.Raw.String), &existing); err == nil {
			if existing.Equal(result) {
				return
			}
		}
	}

	s.storeMetricWithRaw(state.record.ID, "network_classification", "", nil, result)
}

func (s *Svc) collectPing(parent context.Context, dev store.DeviceRecord) {
	if dev.Host == "" {
		return
	}

	ctx, cancel := context.WithTimeout(parent, pingBudget)
	defer cancel()

	avg, err := ping.PingOnce(ctx, dev.Host, pingTimeout)
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("ping %s: %v", dev.Name, err)
			s.recordDeviceLogf(dev.ID, "error", "Ping failed: %v", err)
		}
		return
	}

	metric := store.Metric{
		DeviceID: dev.ID,
		TS:       time.Now(),
		Metric:   "ping_ms",
		Value:    sql.NullFloat64{Float64: avg, Valid: true},
		Unit:     sql.NullString{String: "ms", Valid: true},
	}
	if err := s.DB.InsertMetric(metric); err != nil {
		log.Printf("store ping metric %d: %v", dev.ID, err)
		return
	}

	s.recordDeviceLogf(dev.ID, "info", "Ping %.1f ms", avg)
}

func (s *Svc) collectSystemMetrics(parent context.Context, state *deviceState) {
	if state == nil {
		return
	}
	if state.record.Host == "" {
		return
	}

	hasSSH := strings.TrimSpace(state.record.User) != ""
	hasSNMP := state.snmpEnabled

	if hasSSH {
		s.collectSSHMetrics(parent, state)
	} else if !hasSNMP {
		if state.recentErrors == nil {
			state.recentErrors = make(map[string]time.Time)
		}
		if _, ok := state.recentErrors["__metrics_user_missing"]; !ok {
			s.recordDeviceLogf(state.record.ID, "warn", "System metrics skipped: missing SSH user")
			state.recentErrors["__metrics_user_missing"] = time.Now()
		}
	}

	if !hasSNMP {
		return
	}

	interval := state.snmpInterval
	if interval <= 0 {
		interval = 2 * time.Minute
	}
	if !state.lastSNMP.IsZero() && time.Since(state.lastSNMP) < interval {
		return
	}

	s.collectSNMPMetrics(parent, state)
}

func (s *Svc) collectSSHMetrics(parent context.Context, state *deviceState) {
	if state == nil {
		return
	}
	if state.record.Host == "" {
		return
	}
	if strings.TrimSpace(state.record.User) == "" {
		return
	}
	if state.recentErrors == nil {
		state.recentErrors = make(map[string]time.Time)
	}

	keyPath, cleanup, err := s.resolveKeyPath(state.record.SSHKey)
	if err != nil {
		log.Printf("system metrics %s: %v", state.record.Name, err)
		s.recordDeviceLogf(state.record.ID, "error", "System metrics key resolution failed: %v", err)
		return
	}
	defer cleanup()

	ctx, cancel := context.WithTimeout(parent, systemMetricsTimeout)
	defer cancel()

	command := fmt.Sprintf("sh <<'PULSEOPS_METRICS'\n%s\nPULSEOPS_METRICS\n", systemMetricsScript)
	res := s.runSSH(ctx, systemMetricsTimeout, keyPath, state.sshPort, state.record.User, state.record.Host, command)
	if res.Err != nil {
		if ctx.Err() == nil {
			log.Printf("system metrics %s: %v", state.record.Name, res.Err)
			stderr := strings.TrimSpace(res.Stderr)
			if stderr != "" {
				log.Printf("system metrics stderr %s: %s", state.record.Name, trimOutput(stderr))
			}
			s.recordDeviceLogf(state.record.ID, "error", "System metrics collection failed: %v", res.Err)
		}
		return
	}

	snapshot := parseSystemSnapshot(res.Stdout)
	now := time.Now()

	if total, idle := snapshot.cpuTotals(); total > 0 {
		sample := &cpuSample{total: total, idle: idle}
		if state.lastCPU != nil {
			deltaTotal := sample.total - state.lastCPU.total
			deltaIdle := sample.idle - state.lastCPU.idle
			if deltaTotal > 0 {
				usage := (deltaTotal - deltaIdle) / deltaTotal * 100
				usage = clampPercent(usage)
				s.storeMetricWithRaw(state.record.ID, "cpu_usage_percent", "%", &usage, nil)
			}
		}
		state.lastCPU = sample
	}

	loadSeries := []struct {
		key   string
		value float64
	}{
		{key: "cpu_load_1m", value: snapshot.loadAvg[0]},
		{key: "cpu_load_5m", value: snapshot.loadAvg[1]},
		{key: "cpu_load_15m", value: snapshot.loadAvg[2]},
	}
	for _, entry := range loadSeries {
		if !math.IsNaN(entry.value) && entry.value >= 0 {
			val := entry.value
			s.storeMetricWithRaw(state.record.ID, entry.key, "", &val, nil)
		}
	}

	if snapshot.memTotalKB > 0 {
		available := snapshot.memAvailableKB
		if available <= 0 && snapshot.memFreeKB > 0 {
			available = snapshot.memFreeKB
		}
		usedKB := snapshot.memTotalKB - available
		if usedKB < 0 {
			usedKB = 0
		}
		usedPercent := clampPercent((usedKB / snapshot.memTotalKB) * 100)
		raw := map[string]float64{
			"total_bytes":      snapshot.memTotalKB * 1024,
			"available_bytes":  snapshot.memAvailableKB * 1024,
			"free_bytes":       snapshot.memFreeKB * 1024,
			"swap_total_bytes": snapshot.swapTotalKB * 1024,
			"swap_free_bytes":  snapshot.swapFreeKB * 1024,
			"used_bytes":       usedKB * 1024,
		}
		s.storeMetricWithRaw(state.record.ID, "memory_used_percent", "%", &usedPercent, raw)
	}

	if snapshot.diskTotalKB > 0 {
		usedPercent := snapshot.diskUsedPercent
		if math.IsNaN(usedPercent) || usedPercent <= 0 {
			usedPercent = (snapshot.diskUsedKB / snapshot.diskTotalKB) * 100
		}
		usedPercent = clampPercent(usedPercent)
		raw := map[string]float64{
			"total_bytes": snapshot.diskTotalKB * 1024,
			"used_bytes":  snapshot.diskUsedKB * 1024,
			"free_bytes":  snapshot.diskFreeKB * 1024,
		}
		s.storeMetricWithRaw(state.record.ID, "disk_used_percent", "%", &usedPercent, raw)
	}

	if snapshot.uptimeSeconds > 0 {
		uptime := snapshot.uptimeSeconds
		s.storeMetricWithRaw(state.record.ID, "uptime_seconds", "s", &uptime, nil)
	}

	if len(snapshot.hardwareInfo) > 0 {
		cleaned := map[string]string{}
		for k, v := range snapshot.hardwareInfo {
			vv := strings.TrimSpace(v)
			if vv != "" {
				cleaned[k] = vv
			}
		}
		if len(cleaned) > 0 {
			s.storeMetricWithRaw(state.record.ID, "hardware_info", "", nil, cleaned)
		}
	}

	if len(snapshot.interfaces) > 0 {
		s.storeMetricWithRaw(state.record.ID, "interface_stats", "", nil, snapshot.interfaces)
	}

	s.recordDeviceErrorsFromSnapshot(state, snapshot.logs, now)
}

func (s *Svc) collectSNMPMetrics(parent context.Context, state *deviceState) {
	if state == nil {
		return
	}
	if state.recentErrors == nil {
		state.recentErrors = make(map[string]time.Time)
	}

	cfg := state.snmpConfig
	cfg.Target = strings.TrimSpace(cfg.Target)
	if cfg.Target == "" {
		cfg.Target = strings.TrimSpace(state.record.Host)
	}
	if cfg.Target == "" {
		return
	}
	state.snmpConfig.Target = cfg.Target
	cfg.Community = strings.TrimSpace(cfg.Community)
	if cfg.Community == "" {
		cfg.Community = "public"
	}
	state.snmpConfig.Community = cfg.Community

	budget := s.snmpBudget(state)
	ctx, cancel := context.WithTimeout(parent, budget)
	defer cancel()

	tele, err := snmp.Collect(ctx, cfg)
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("snmp metrics %s: %v", state.record.Name, err)
			s.recordDedupedSNMPError(state, err)
		}
		return
	}

	state.lastSNMP = time.Now()
	delete(state.recentErrors, "__snmp_metrics_error")

	if tele.SysUpTimeSeconds > 0 {
		uptime := tele.SysUpTimeSeconds
		s.storeMetricWithRaw(state.record.ID, "uptime_seconds", "s", &uptime, nil)
	}

	if tele.CPULoadPercent != nil {
		usage := clampPercent(*tele.CPULoadPercent)
		s.storeMetricWithRaw(state.record.ID, "cpu_usage_percent", "%", &usage, nil)
	}

	if tele.Memory != nil && tele.Memory.TotalBytes > 0 {
		usedPercent := clampPercent(tele.Memory.UsedPercent)
		raw := map[string]float64{
			"total_bytes": tele.Memory.TotalBytes,
			"used_bytes":  tele.Memory.UsedBytes,
			"free_bytes":  tele.Memory.FreeBytes,
		}
		s.storeMetricWithRaw(state.record.ID, "memory_used_percent", "%", &usedPercent, raw)
	}

	if len(tele.Interfaces) > 0 {
		snapshots := make([]interfaceSnapshot, 0, len(tele.Interfaces))
		for _, iface := range tele.Interfaces {
			snap := interfaceSnapshot{
				Name:       iface.Name,
				OperState:  iface.OperState,
				RXBytes:    iface.InOctets,
				TXBytes:    iface.OutOctets,
				MACAddress: iface.MAC,
				AdminState: iface.AdminState,
				InErrors:   iface.InErrors,
				OutErrors:  iface.OutErrors,
			}
			if iface.SpeedMbps != nil {
				val := *iface.SpeedMbps
				snap.SpeedMbps = &val
			}
			snapshots = append(snapshots, snap)
		}
		s.storeMetricWithRaw(state.record.ID, "interface_stats", "", nil, snapshots)
	}
}

func (s *Svc) snmpBudget(state *deviceState) time.Duration {
	budget := snmpMetricsTimeout
	if state == nil {
		return budget
	}
	timeout := state.snmpConfig.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	retries := state.snmpConfig.Retries
	if retries < 0 {
		retries = 0
	}
	candidate := timeout*time.Duration(retries+1) + 3*time.Second
	if candidate < 5*time.Second {
		candidate = 5 * time.Second
	}
	if candidate > snmpMetricsTimeout {
		candidate = snmpMetricsTimeout
	}
	return candidate
}

func (s *Svc) recordDedupedSNMPError(state *deviceState, err error) {
	if state == nil || err == nil {
		return
	}
	if state.recentErrors == nil {
		state.recentErrors = make(map[string]time.Time)
	}
	now := time.Now()
	key := "__snmp_metrics_error"
	if ts, ok := state.recentErrors[key]; ok && now.Sub(ts) < errorLogDuplicateGuard {
		return
	}
	s.recordDeviceLogf(state.record.ID, "error", "SNMP metrics failed: %v", err)
	state.recentErrors[key] = now
}

func (s *Svc) storeMetricWithRaw(deviceID int64, metric string, unit string, value *float64, raw any) {
	if value == nil && raw == nil {
		return
	}
	m := store.Metric{
		DeviceID: deviceID,
		TS:       time.Now(),
		Metric:   metric,
	}
	if value != nil && !math.IsNaN(*value) && !math.IsInf(*value, 0) {
		m.Value = sql.NullFloat64{Float64: *value, Valid: true}
	}
	if unit != "" {
		m.Unit = sql.NullString{String: unit, Valid: true}
	}
	if raw != nil {
		if b, err := json.Marshal(raw); err == nil {
			m.Raw = sql.NullString{String: string(b), Valid: true}
		}
	}
	if !m.Value.Valid && !m.Raw.Valid {
		return
	}
	if err := s.DB.InsertMetric(m); err != nil {
		log.Printf("store metric %s device %d: %v", metric, deviceID, err)
	}
}

func (s *Svc) recordDeviceErrorsFromSnapshot(state *deviceState, lines []string, now time.Time) {
	if state == nil || len(lines) == 0 {
		return
	}
	if state.recentErrors == nil {
		state.recentErrors = make(map[string]time.Time)
	}
	cutoff := now.Add(-errorLogRetention)
	for key, ts := range state.recentErrors {
		if ts.Before(cutoff) {
			delete(state.recentErrors, key)
		}
	}

	logged := 0
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if ts, ok := state.recentErrors[key]; ok && now.Sub(ts) < errorLogDuplicateGuard {
			continue
		}
		state.recentErrors[key] = now
		s.recordDeviceLogf(state.record.ID, "error", "%s", trimmed)
		logged++
		if logged >= 25 {
			break
		}
	}
}

func clampPercent(v float64) float64 {
	if math.IsNaN(v) {
		return v
	}
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func parseSystemSnapshot(output string) systemSnapshot {
	snap := systemSnapshot{
		hardwareInfo: make(map[string]string),
		loadAvg:      [3]float64{math.NaN(), math.NaN(), math.NaN()},
	}
	scanner := bufio.NewScanner(strings.NewReader(output))
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "CPU_STAT:"):
			parts := strings.Split(line[len("CPU_STAT:"):], ",")
			snap.cpuValues = snap.cpuValues[:0]
			for _, part := range parts {
				snap.cpuValues = append(snap.cpuValues, parseFloatDefault(part, 0))
			}
		case strings.HasPrefix(line, "LOAD_AVG:"):
			parts := strings.Split(line[len("LOAD_AVG:"):], ",")
			for i := 0; i < len(parts) && i < len(snap.loadAvg); i++ {
				snap.loadAvg[i] = parseFloatDefault(parts[i], math.NaN())
			}
		case strings.HasPrefix(line, "MEMORY:"):
			parts := strings.Split(line[len("MEMORY:"):], ",")
			if len(parts) > 0 {
				snap.memTotalKB = parseFloatDefault(parts[0], 0)
			}
			if len(parts) > 1 {
				snap.memAvailableKB = parseFloatDefault(parts[1], 0)
			}
			if len(parts) > 2 {
				snap.memFreeKB = parseFloatDefault(parts[2], 0)
			}
			if len(parts) > 3 {
				snap.swapTotalKB = parseFloatDefault(parts[3], 0)
			}
			if len(parts) > 4 {
				snap.swapFreeKB = parseFloatDefault(parts[4], 0)
			}
		case strings.HasPrefix(line, "UPTIME:"):
			snap.uptimeSeconds = parseFloatDefault(line[len("UPTIME:"):], 0)
		case strings.HasPrefix(line, "DISK:"):
			parts := strings.Split(line[len("DISK:"):], ",")
			if len(parts) > 0 {
				snap.diskTotalKB = parseFloatDefault(parts[0], 0)
			}
			if len(parts) > 1 {
				snap.diskUsedKB = parseFloatDefault(parts[1], 0)
			}
			if len(parts) > 2 {
				snap.diskFreeKB = parseFloatDefault(parts[2], 0)
			}
			if len(parts) > 3 {
				snap.diskUsedPercent = parseFloatDefault(strings.TrimSuffix(parts[3], "%"), math.NaN())
			}
		case strings.HasPrefix(line, "IFACE:"):
			fields := strings.Split(line[len("IFACE:"):], ",")
			if len(fields) < 9 {
				continue
			}
			iface := interfaceSnapshot{
				Name:       strings.TrimSpace(fields[0]),
				OperState:  strings.TrimSpace(fields[1]),
				Duplex:     strings.TrimSpace(fields[3]),
				MACAddress: strings.TrimSpace(fields[8]),
			}
			if speed := parseFloatDefault(fields[2], math.NaN()); !math.IsNaN(speed) && speed > 0 {
				iface.SpeedMbps = &speed
			}
			if rxBytes, err := strconv.ParseUint(strings.TrimSpace(fields[4]), 10, 64); err == nil {
				iface.RXBytes = rxBytes
			}
			if txBytes, err := strconv.ParseUint(strings.TrimSpace(fields[5]), 10, 64); err == nil {
				iface.TXBytes = txBytes
			}
			if rxPackets, err := strconv.ParseUint(strings.TrimSpace(fields[6]), 10, 64); err == nil {
				iface.RXPackets = rxPackets
			}
			if txPackets, err := strconv.ParseUint(strings.TrimSpace(fields[7]), 10, 64); err == nil {
				iface.TXPackets = txPackets
			}
			snap.interfaces = append(snap.interfaces, iface)
		case strings.HasPrefix(line, "HOSTNAME:"):
			snap.hardwareInfo["hostname"] = strings.TrimSpace(line[len("HOSTNAME:"):])
		case strings.HasPrefix(line, "KERNEL:"):
			snap.hardwareInfo["kernel"] = strings.TrimSpace(line[len("KERNEL:"):])
		case strings.HasPrefix(line, "ARCH:"):
			snap.hardwareInfo["arch"] = strings.TrimSpace(line[len("ARCH:"):])
		case strings.HasPrefix(line, "OS:"):
			snap.hardwareInfo["os"] = strings.TrimSpace(line[len("OS:"):])
		case strings.HasPrefix(line, "MODEL:"):
			snap.hardwareInfo["model"] = strings.TrimSpace(line[len("MODEL:"):])
		case strings.HasPrefix(line, "BOARD:"):
			snap.hardwareInfo["board"] = strings.TrimSpace(line[len("BOARD:"):])
		case strings.HasPrefix(line, "CPU_MODEL:"):
			snap.hardwareInfo["cpu_model"] = strings.TrimSpace(line[len("CPU_MODEL:"):])
		case strings.HasPrefix(line, "CPU_CORES:"):
			snap.hardwareInfo["cpu_cores"] = strings.TrimSpace(line[len("CPU_CORES:"):])
		case strings.HasPrefix(line, "SYSLOG:"):
			entry := strings.TrimSpace(line[len("SYSLOG:"):])
			if entry != "" {
				snap.logs = append(snap.logs, entry)
			}
		}
	}
	return snap
}

func parseFloatDefault(value string, fallback float64) float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return fallback
	}
	return v
}

func (snap systemSnapshot) cpuTotals() (float64, float64) {
	if len(snap.cpuValues) == 0 {
		return 0, 0
	}
	total := 0.0
	for _, v := range snap.cpuValues {
		if math.IsNaN(v) {
			continue
		}
		total += v
	}
	idle := 0.0
	if len(snap.cpuValues) > 3 && !math.IsNaN(snap.cpuValues[3]) {
		idle += snap.cpuValues[3]
	}
	if len(snap.cpuValues) > 4 && !math.IsNaN(snap.cpuValues[4]) {
		idle += snap.cpuValues[4]
	}
	return total, idle
}

func (s *Svc) collectIperf(parent context.Context, state *deviceState) {
	if state == nil {
		return
	}
	if !state.iperfEnabled || state.record.Host == "" {
		return
	}
	if state.record.User == "" {
		log.Printf("iperf %s skipped: missing SSH user", state.record.Name)
		s.recordDeviceLogf(state.record.ID, "warn", "iPerf skipped: missing SSH user")
		return
	}

	keyPath, cleanup, err := s.resolveKeyPath(state.record.SSHKey)
	if err != nil {
		log.Printf("iperf %s: %v", state.record.Name, err)
		s.recordDeviceLogf(state.record.ID, "error", "iPerf key resolution failed: %v", err)
		return
	}
	defer cleanup()

	timeout := s.iperfTimeout(state)
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	if err := s.ensureIperfAvailable(ctx, state, keyPath); err != nil {
		if ctx.Err() == nil {
			log.Printf("iperf %s: %v", state.record.Name, err)
			s.recordDeviceLogf(state.record.ID, "error", "iPerf preparation failed: %v", err)
		}
		return
	}

	pid, err := s.ensureIperfServer(ctx, state, keyPath)
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("iperf %s: %v", state.record.Name, err)
			s.recordDeviceLogf(state.record.ID, "error", "iPerf server setup failed: %v", err)
		}
		return
	}

	startedByUs := pid != ""
	if startedByUs {
		select {
		case <-time.After(2 * time.Second):
		case <-ctx.Done():
			return
		}
	}

	mbps, raw, err := iperf3c.Run(ctx, state.record.Host, state.iperfDuration, state.iperfParallel)
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("iperf %s: %v", state.record.Name, err)
			s.recordDeviceLogf(state.record.ID, "error", "iPerf run failed: %v", err)
		}
		if startedByUs && pid != "" {
			s.stopIperfServer(context.Background(), state, keyPath, pid)
		}
		return
	}

	metric := store.Metric{
		DeviceID: state.record.ID,
		TS:       time.Now(),
		Metric:   "iperf_mbps",
		Value:    sql.NullFloat64{Float64: mbps, Valid: true},
		Unit:     sql.NullString{String: "Mbps", Valid: true},
		Raw:      sql.NullString{String: raw, Valid: true},
	}
	if err := s.DB.InsertMetric(metric); err != nil {
		log.Printf("store iperf metric %d: %v", state.record.ID, err)
		return
	}

	if startedByUs && pid != "" {
		s.stopIperfServer(context.Background(), state, keyPath, pid)
	}

	s.recordDeviceLogf(state.record.ID, "info", "iPerf %.1f Mbps", mbps)
}

func (s *Svc) ensureIperfAvailable(ctx context.Context, state *deviceState, keyPath string) error {
	if state == nil {
		return fmt.Errorf("nil device state")
	}
	check := s.runSSH(ctx, 30*time.Second, keyPath, state.sshPort, state.record.User, state.record.Host, "sh -c 'command -v iperf3 || which iperf3'")
	if check.Err == nil {
		return nil
	}

	platform := strings.ToLower(strings.TrimSpace(state.record.Platform))
	commands := iperfInstallCommandsForPlatform(platform)
	if len(commands) == 0 {
		return fmt.Errorf("iperf3 not installed on platform %s", state.record.Platform)
	}

	var lastErr error
	for _, cmd := range commands {
		install := s.runSSH(ctx, 4*time.Minute, keyPath, state.sshPort, state.record.User, state.record.Host, cmd)
		if install.Err == nil {
			lastErr = nil
			break
		}
		lastErr = fmt.Errorf("install iperf3 using %q: %v; %s", cmd, install.Err, trimOutput(install.Stdout+install.Stderr))
	}
	if lastErr != nil {
		return lastErr
	}

	verify := s.runSSH(ctx, 30*time.Second, keyPath, state.sshPort, state.record.User, state.record.Host, "sh -c 'command -v iperf3 || which iperf3'")
	if verify.Err != nil {
		return fmt.Errorf("iperf3 still unavailable: %s", trimOutput(verify.Stdout+verify.Stderr))
	}
	return nil
}

func iperfInstallCommandsForPlatform(platform string) []string {
	switch {
	case platform == "openwrt":
		return []string{
			"opkg update && opkg install iperf3",
		}
	case strings.Contains(platform, "ubuntu"), strings.Contains(platform, "debian"), strings.Contains(platform, "raspbian"), strings.Contains(platform, "linuxmint"), strings.Contains(platform, "popos"), strings.Contains(platform, "elementary"):
		return []string{
			"apt-get update && apt-get install -y iperf3",
			"apt update && apt install -y iperf3",
			"sudo apt-get update && sudo apt-get install -y iperf3",
			"sudo apt update && sudo apt install -y iperf3",
		}
	case strings.Contains(platform, "alpine"):
		return []string{
			"apk update && apk add --no-cache iperf3",
			"sudo apk update && sudo apk add --no-cache iperf3",
		}
	case strings.Contains(platform, "centos"), strings.Contains(platform, "rhel"), strings.Contains(platform, "rocky"), strings.Contains(platform, "almalinux"), strings.Contains(platform, "fedora"), strings.Contains(platform, "amazon linux"), strings.Contains(platform, "amazon-linux"), strings.Contains(platform, "oraclelinux"):
		return []string{
			"dnf -y install iperf3",
			"sudo dnf -y install iperf3",
			"yum -y install iperf3",
			"sudo yum -y install iperf3",
		}
	case strings.Contains(platform, "arch"), strings.Contains(platform, "manjaro"), strings.Contains(platform, "endeavouros"):
		return []string{
			"pacman -Sy --noconfirm iperf3",
			"sudo pacman -Sy --noconfirm iperf3",
		}
	default:
		return nil
	}
}

func (s *Svc) ensureIperfServer(ctx context.Context, state *deviceState, keyPath string) (string, error) {
	if state == nil {
		return "", fmt.Errorf("nil device state")
	}
	probe := s.runSSH(ctx, 15*time.Second, keyPath, state.sshPort, state.record.User, state.record.Host, "sh -c 'pgrep iperf3 || pidof iperf3'")
	if probe.Err == nil && strings.TrimSpace(probe.Stdout) != "" {
		return "", nil
	}

	start := s.runSSH(ctx, 15*time.Second, keyPath, state.sshPort, state.record.User, state.record.Host, "sh -c 'iperf3 -s -1 >/tmp/pulseops_iperf.log 2>&1 & echo $!'")
	if start.Err != nil {
		return "", fmt.Errorf("start iperf3 server: %v; %s", start.Err, trimOutput(start.Stdout+start.Stderr))
	}
	pid := strings.TrimSpace(start.Stdout)
	if pid == "" {
		return "", fmt.Errorf("iperf3 server pid not returned")
	}
	return pid, nil
}

func (s *Svc) stopIperfServer(parent context.Context, state *deviceState, keyPath, pid string) {
	if pid == "" {
		return
	}
	if state == nil {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	cmd := fmt.Sprintf("sh -c 'if kill -0 %s 2>/dev/null; then kill %s; fi'", pid, pid)
	s.runSSH(ctx, 10*time.Second, keyPath, state.sshPort, state.record.User, state.record.Host, cmd)
}

// ReprovisionDevice re-runs iperf3 availability checks and installation for a managed device.
func (s *Svc) ReprovisionDevice(ctx context.Context, deviceID int64) error {
	if ctx == nil {
		ctx = context.Background()
	}

	s.devicesMu.Lock()
	runner, ok := s.devices[deviceID]
	s.devicesMu.Unlock()
	if !ok || runner == nil || runner.state == nil {
		return ErrDeviceNotActive
	}

	state := runner.state
	if strings.TrimSpace(state.record.User) == "" {
		s.recordDeviceLogf(state.record.ID, "warn", "iPerf reprovision skipped: missing SSH user")
		return ErrMissingSSHUser
	}

	keyPath, cleanup, err := s.resolveKeyPath(state.record.SSHKey)
	if err != nil {
		s.recordDeviceLogf(state.record.ID, "error", "iPerf reprovision key resolution failed: %v", err)
		return err
	}
	defer cleanup()

	timeout := s.iperfTimeout(state)
	if timeout <= 0 {
		timeout = 5 * time.Minute
	}

	reprovisionCtx := ctx
	if deadline, ok := reprovisionCtx.Deadline(); !ok || time.Until(deadline) < timeout {
		var cancel context.CancelFunc
		reprovisionCtx, cancel = context.WithTimeout(reprovisionCtx, timeout)
		defer cancel()
	}

	if err := s.ensureIperfAvailable(reprovisionCtx, state, keyPath); err != nil {
		if reprovisionCtx.Err() == nil {
			s.recordDeviceLogf(state.record.ID, "error", "iPerf reprovision failed: %v", err)
		}
		return err
	}

	if reprovisionCtx.Err() != nil {
		return reprovisionCtx.Err()
	}

	s.recordDeviceLogf(state.record.ID, "info", "iPerf reprovision completed")
	return nil
}

func (s *Svc) runSSH(ctx context.Context, timeout time.Duration, keyPath string, port int, user, host, command string) executil.Result {
	if user == "" || host == "" {
		return executil.Result{Err: fmt.Errorf("missing ssh parameters")}
	}

	args := []string{
		"-o", "BatchMode=yes",
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"-o", "GlobalKnownHostsFile=/dev/null",
		"-o", "ConnectTimeout=10",
	}
	if keyPath != "" {
		args = append(args, "-i", keyPath)
	}
	if port > 0 && port != 22 {
		args = append(args, "-p", strconv.Itoa(port))
	}
	target := fmt.Sprintf("%s@%s", user, host)
	args = append(args, target, command)
	return executil.Run(ctx, timeout, "ssh", args...)
}

func (s *Svc) stopAllDevices() {
	s.devicesMu.Lock()
	defer s.devicesMu.Unlock()
	for id, runner := range s.devices {
		runner.cancel()
		delete(s.devices, id)
	}
}

func (s *Svc) Shutdown() {
	close(s.Stop)
	s.wg.Wait()
}

func (s *Svc) recordDeviceLogf(deviceID int64, level string, format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	if strings.TrimSpace(msg) == "" {
		return
	}
	if err := s.DB.InsertDeviceLog(deviceID, level, msg); err != nil {
		log.Printf("device log insert %d: %v", deviceID, err)
	}
}

func (s *Svc) backupSchedule(state *deviceState) (bool, time.Time, time.Duration) {
	if s.Backups == nil || !state.backupEnabled {
		return false, time.Time{}, 0
	}
	interval := state.backupInterval
	if interval <= 0 {
		interval = backups.DefaultInterval
	}
	now := time.Now().UTC()
	latest, err := s.DB.LatestDeviceBackup(state.record.ID)
	if err == nil {
		if now.Sub(latest.CreatedAt) >= interval {
			return true, now, interval
		}
		next := backups.NextScheduled(latest.CreatedAt, now, interval)
		return false, next, interval
	}
	if errors.Is(err, sql.ErrNoRows) {
		return true, now, interval
	}
	log.Printf("scheduled backup lookup %s: %v", state.record.Name, err)
	return true, now.Add(5 * time.Minute), interval
}

func (s *Svc) captureScheduledBackup(ctx context.Context, state *deviceState) {
	if s.Backups == nil {
		return
	}
	if _, err := s.Backups.Capture(ctx, state.record.ID); err != nil {
		if ctx.Err() != nil {
			return
		}
		log.Printf("scheduled backup %s: %v", state.record.Name, err)
		s.recordDeviceLogf(state.record.ID, "error", "Scheduled backup failed: %v", err)
		if s.DB != nil {
			_ = s.DB.InsertSystemLog("error", "device.backup", fmt.Sprintf("Scheduled backup failed for %s", state.record.Name), map[string]any{
				"device_id": state.record.ID,
				"platform":  state.record.Platform,
				"mode":      "scheduled",
			})
		}
	}
}

func (s *Svc) buildDeviceState(dev store.DeviceRecord) deviceState {
	meta := parseMeta(dev.Meta)
	state := deviceState{
		record:  dev,
		meta:    meta,
		sshPort: parseSSHPort(meta),
		snmpConfig: snmp.Config{
			Target:    strings.TrimSpace(dev.Host),
			Port:      161,
			Community: "public",
			Version:   "2c",
			Timeout:   5 * time.Second,
			Retries:   1,
			MaxReps:   10,
			MaxOids:   10,
		},
		snmpInterval:  systemMetricsInterval,
		iperfEnabled:  true,
		iperfInterval: s.defaultIperfInterval(),
		iperfDuration: s.defaultIperfDuration(),
		iperfParallel: s.defaultIperfParallel(),
	}

	if val, ok := meta["iperf_enabled"]; ok {
		if enabled, parsed := parseBool(val); parsed {
			state.iperfEnabled = enabled
		}
	}
	if val, ok := meta["iperf_interval"]; ok {
		if d, ok := parseDurationOrMinutes(val); ok && d > 0 {
			state.iperfInterval = d
		}
	}
	if val, ok := meta["iperf_seconds"]; ok {
		if secs := toPositiveInt(val); secs > 0 {
			state.iperfDuration = secs
		}
	} else if val, ok := meta["iperf_duration"]; ok {
		if secs := toPositiveInt(val); secs > 0 {
			state.iperfDuration = secs
		}
	}
	if val, ok := meta["iperf_parallel"]; ok {
		if par := toPositiveInt(val); par > 0 {
			state.iperfParallel = par
		}
	}

	if target := strings.TrimSpace(meta["snmp_target"]); target != "" {
		state.snmpConfig.Target = target
	} else if host := strings.TrimSpace(meta["snmp_host"]); host != "" {
		state.snmpConfig.Target = host
	}
	if val, ok := meta["snmp_port"]; ok {
		if port := toPositiveInt(val); port > 0 && port <= 65535 {
			state.snmpConfig.Port = uint16(port)
		}
	}
	if community := strings.TrimSpace(meta["snmp_community"]); community != "" {
		state.snmpConfig.Community = community
	}
	if version := strings.TrimSpace(meta["snmp_version"]); version != "" {
		state.snmpConfig.Version = version
	}
	if val, ok := meta["snmp_timeout"]; ok {
		if d, ok := parseDurationSeconds(val); ok {
			state.snmpConfig.Timeout = d
		}
	}
	if val, ok := meta["snmp_retries"]; ok {
		if retries, ok := toNonNegativeInt(val); ok {
			state.snmpConfig.Retries = retries
		}
	}
	if val, ok := meta["snmp_max_repetitions"]; ok {
		if reps := toPositiveInt(val); reps > 0 && reps < 65536 {
			state.snmpConfig.MaxReps = uint32(reps)
		}
	} else if val, ok := meta["snmp_max_reps"]; ok {
		if reps := toPositiveInt(val); reps > 0 && reps < 65536 {
			state.snmpConfig.MaxReps = uint32(reps)
		}
	}
	if val, ok := meta["snmp_max_oids"]; ok {
		if maxOids := toPositiveInt(val); maxOids > 0 {
			state.snmpConfig.MaxOids = maxOids
		}
	}
	if val, ok := meta["snmp_interval"]; ok {
		if d, ok := parseDurationOrMinutes(val); ok && d > 0 {
			state.snmpInterval = d
		}
	}
	if val, ok := meta["snmp_enabled"]; ok {
		if enabled, parsed := parseBool(val); parsed {
			state.snmpEnabled = enabled
		}
	} else {
		if strings.TrimSpace(meta["snmp_target"]) != "" || strings.TrimSpace(meta["snmp_host"]) != "" || strings.TrimSpace(meta["snmp_community"]) != "" {
			state.snmpEnabled = true
		}
	}
	if state.snmpInterval <= 0 {
		state.snmpInterval = systemMetricsInterval
	}
	if strings.TrimSpace(state.snmpConfig.Target) == "" {
		state.snmpEnabled = false
	}

	if state.iperfInterval <= 0 {
		state.iperfEnabled = false
	}

	if s.Backups != nil && backups.Supports(dev.Platform) {
		state.backupEnabled = true
		state.backupInterval = backups.IntervalFromMeta(dev.Meta)
	}

	return state
}

func (s *Svc) defaultIperfInterval() time.Duration {
	mins := s.Cfg.Iperf.IntervalMinutes
	if mins <= 0 {
		return time.Hour
	}
	return time.Duration(mins) * time.Minute
}

func (s *Svc) defaultIperfDuration() int {
	secs := s.Cfg.Iperf.Seconds
	if secs <= 0 {
		return 10
	}
	return secs
}

func (s *Svc) defaultIperfParallel() int {
	par := s.Cfg.Iperf.Parallel
	if par <= 0 {
		return 1
	}
	return par
}

func (s *Svc) iperfTimeout(state *deviceState) time.Duration {
	if state == nil {
		return 3 * time.Minute
	}
	base := time.Duration(state.iperfDuration)*time.Second + 2*time.Minute
	if base < 3*time.Minute {
		base = 3 * time.Minute
	}
	return base
}

func (s *Svc) resolveKeyPath(value string) (string, func(), error) {
	if value == "" {
		return "", func() {}, nil
	}
	if s.Keys == nil {
		return value, func() {}, nil
	}
	return s.Keys.ResolvePath(value)
}

func parseMeta(raw string) map[string]string {
	out := map[string]string{}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return out
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return out
	}
	for k, v := range decoded {
		switch t := v.(type) {
		case string:
			out[k] = t
		case float64:
			out[k] = strconv.FormatFloat(t, 'f', -1, 64)
		case bool:
			if t {
				out[k] = "true"
			} else {
				out[k] = "false"
			}
		default:
			b, err := json.Marshal(t)
			if err == nil {
				out[k] = string(b)
			}
		}
	}
	return out
}

func parseSSHPort(meta map[string]string) int {
	if val, ok := meta["ssh_port"]; ok {
		if port := toPositiveInt(val); port > 0 && port <= 65535 {
			return port
		}
	}
	return 22
}

func parseBool(value string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true, true
	case "0", "false", "no", "off":
		return false, true
	default:
		return false, false
	}
}

func parseDurationOrMinutes(value string) (time.Duration, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if d, err := time.ParseDuration(value); err == nil {
		return d, true
	}
	if mins, err := strconv.Atoi(value); err == nil {
		return time.Duration(mins) * time.Minute, true
	}
	return 0, false
}

func parseDurationSeconds(value string) (time.Duration, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if d, err := time.ParseDuration(value); err == nil && d > 0 {
		return d, true
	}
	if secs, err := strconv.Atoi(value); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second, true
	}
	return 0, false
}

func toPositiveInt(value string) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

func toNonNegativeInt(value string) (int, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

func trimOutput(out string) string {
	out = strings.TrimSpace(out)
	if len(out) > 240 {
		return out[:240] + "..."
	}
	return out
}
