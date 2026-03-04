package snmp

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"

	gosnmp "github.com/gosnmp/gosnmp"
)

// Config controls how SNMP telemetry is collected.
type Config struct {
	Target    string
	Port      uint16
	Community string
	Version   string
	Timeout   time.Duration
	Retries   int
	MaxReps   uint32
	MaxOids   int
}

// Telemetry captures a snapshot of SNMP derived metrics.
type Telemetry struct {
	SysUpTimeSeconds float64
	CPULoadPercent   *float64
	Memory           *MemoryTelemetry
	Interfaces       []InterfaceTelemetry
}

// MemoryTelemetry describes host memory usage in bytes.
type MemoryTelemetry struct {
	TotalBytes  float64
	UsedBytes   float64
	FreeBytes   float64
	UsedPercent float64
}

// InterfaceTelemetry summarises per-interface counters.
type InterfaceTelemetry struct {
	Index      int
	Name       string
	Alias      string
	AdminState string
	OperState  string
	SpeedMbps  *float64
	MAC        string
	InOctets   uint64
	OutOctets  uint64
	InErrors   uint64
	OutErrors  uint64
}

// Collect gathers telemetry using the provided configuration.
func Collect(ctx context.Context, cfg Config) (*Telemetry, error) {
	gs, err := buildSession(cfg)
	if err != nil {
		return nil, err
	}
	// gosnmp does not support context cancellation directly, so rely on timeout settings.
	if err := gs.Connect(); err != nil {
		return nil, fmt.Errorf("snmp connect %s:%d: %w", cfg.Target, cfg.Port, err)
	}
	defer gs.Conn.Close()

	tele := &Telemetry{}

	if ctx.Err() != nil {
		return nil, ctx.Err()
	}

	if uptime, err := fetchSysUptime(gs); err == nil {
		tele.SysUpTimeSeconds = uptime
	} else {
		return nil, err
	}

	if cpu, err := fetchCPULoad(gs); err == nil {
		tele.CPULoadPercent = cpu
	}

	if mem, err := fetchMemory(gs); err == nil {
		tele.Memory = mem
	}

	if ifaces, err := fetchInterfaces(gs); err == nil {
		tele.Interfaces = ifaces
	}

	return tele, nil
}

func buildSession(cfg Config) (*gosnmp.GoSNMP, error) {
	if cfg.Target == "" {
		return nil, errors.New("snmp target required")
	}
	target := cfg.Target
	if host, _, err := net.SplitHostPort(cfg.Target); err == nil {
		target = host
	}
	session := &gosnmp.GoSNMP{
		Target:             target,
		Port:               cfg.Port,
		Community:          cfg.Community,
		Timeout:            cfg.Timeout,
		Retries:            cfg.Retries,
		MaxRepetitions:     cfg.MaxReps,
		Version:            parseVersion(cfg.Version),
		ExponentialTimeout: false,
	}
	if session.Port == 0 {
		session.Port = 161
	}
	if session.Community == "" {
		session.Community = "public"
	}
	if session.Timeout <= 0 {
		session.Timeout = 5 * time.Second
	}
	if session.Retries <= 0 {
		session.Retries = 1
	}
	if session.MaxRepetitions == 0 {
		session.MaxRepetitions = 10
	}
	if cfg.MaxOids > 0 {
		session.MaxOids = cfg.MaxOids
	} else {
		session.MaxOids = 10
	}
	return session, nil
}

func parseVersion(v string) gosnmp.SnmpVersion {
	switch strings.TrimSpace(strings.ToLower(v)) {
	case "1", "v1", "snmpv1":
		return gosnmp.Version1
	case "3", "v3", "snmpv3":
		return gosnmp.Version3
	default:
		return gosnmp.Version2c
	}
}

const (
	oidSysUpTime = ".1.3.6.1.2.1.1.3.0"
)

func fetchSysUptime(gs *gosnmp.GoSNMP) (float64, error) {
	pkt, err := gs.Get([]string{oidSysUpTime})
	if err != nil {
		return 0, fmt.Errorf("snmp get uptime: %w", err)
	}
	if len(pkt.Variables) == 0 {
		return 0, errors.New("snmp uptime missing")
	}
	v := pkt.Variables[0]
	switch val := v.Value.(type) {
	case uint32:
		return float64(val) / 100.0, nil
	case uint64:
		return float64(val) / 100.0, nil
	case int:
		return float64(val) / 100.0, nil
	default:
		return 0, fmt.Errorf("snmp uptime unexpected type %T", v.Value)
	}
}

const (
	oidHrProcessorLoad = ".1.3.6.1.2.1.25.3.3.1.2"
)

func fetchCPULoad(gs *gosnmp.GoSNMP) (*float64, error) {
	pdus, err := gs.BulkWalkAll(oidHrProcessorLoad)
	if err != nil {
		if isNoSuchErr(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("snmp walk cpu: %w", err)
	}
	if len(pdus) == 0 {
		return nil, nil
	}
	var total float64
	var count int
	for _, pdu := range pdus {
		switch val := pdu.Value.(type) {
		case int:
			total += float64(val)
			count++
		case uint:
			total += float64(val)
			count++
		case uint64:
			total += float64(val)
			count++
		case uint32:
			total += float64(val)
			count++
		}
	}
	if count == 0 {
		return nil, nil
	}
	avg := total / float64(count)
	return &avg, nil
}

const (
	oidHrStorageType           = ".1.3.6.1.2.1.25.2.3.1.2"
	oidHrStorageAllocationUnit = ".1.3.6.1.2.1.25.2.3.1.4"
	oidHrStorageSize           = ".1.3.6.1.2.1.25.2.3.1.5"
	oidHrStorageUsed           = ".1.3.6.1.2.1.25.2.3.1.6"
	oidHrStorageRamType        = ".1.3.6.1.2.1.25.2.1.2"

	oidMemTotalReal = ".1.3.6.1.4.1.2021.4.5.0"
	oidMemAvailReal = ".1.3.6.1.4.1.2021.4.6.0"
)

func fetchMemory(gs *gosnmp.GoSNMP) (*MemoryTelemetry, error) {
	entries, err := collectRamStorage(gs)
	if err != nil {
		return nil, err
	}
	if entries != nil {
		best := entries[0]
		if best.TotalBytes > 0 {
			mem := &MemoryTelemetry{
				TotalBytes: best.TotalBytes,
				UsedBytes:  best.UsedBytes,
				FreeBytes:  best.TotalBytes - best.UsedBytes,
			}
			if mem.FreeBytes < 0 {
				mem.FreeBytes = 0
			}
			if mem.TotalBytes > 0 {
				mem.UsedPercent = (mem.UsedBytes / mem.TotalBytes) * 100
			}
			return mem, nil
		}
	}

	pkt, err := gs.Get([]string{oidMemTotalReal, oidMemAvailReal})
	if err != nil {
		if isNoSuchErr(err) {
			return nil, nil
		}
		return nil, err
	}
	var totalKB, freeKB float64
	for _, pdu := range pkt.Variables {
		switch pdu.Name {
		case oidMemTotalReal:
			totalKB = toFloat(pdu.Value)
		case oidMemAvailReal:
			freeKB = toFloat(pdu.Value)
		}
	}
	if totalKB <= 0 {
		return nil, nil
	}
	usedKB := totalKB - freeKB
	if usedKB < 0 {
		usedKB = 0
	}
	mem := &MemoryTelemetry{
		TotalBytes: totalKB * 1024,
		UsedBytes:  usedKB * 1024,
		FreeBytes:  freeKB * 1024,
	}
	if mem.TotalBytes > 0 {
		mem.UsedPercent = (mem.UsedBytes / mem.TotalBytes) * 100
	}
	return mem, nil
}

type ramEntry struct {
	TotalBytes float64
	UsedBytes  float64
}

func collectRamStorage(gs *gosnmp.GoSNMP) ([]ramEntry, error) {
	type entry struct {
		alloc float64
		total float64
		used  float64
		typ   string
	}
	entries := map[int]*entry{}

	types, err := gs.BulkWalkAll(oidHrStorageType)
	if err != nil {
		if isNoSuchErr(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("snmp walk storage type: %w", err)
	}
	if len(types) == 0 {
		return nil, nil
	}
	for _, pdu := range types {
		idx, ok := parseIndex(pdu.Name, oidHrStorageType)
		if !ok {
			continue
		}
		val := ""
		switch v := pdu.Value.(type) {
		case string:
			val = v
		case []byte:
			val = string(v)
		}
		e := entries[idx]
		if e == nil {
			e = &entry{}
			entries[idx] = e
		}
		e.typ = val
	}

	allocUnits, err := gs.BulkWalkAll(oidHrStorageAllocationUnit)
	if err != nil {
		if isNoSuchErr(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("snmp walk storage alloc: %w", err)
	}
	for _, pdu := range allocUnits {
		idx, ok := parseIndex(pdu.Name, oidHrStorageAllocationUnit)
		if !ok {
			continue
		}
		e := entries[idx]
		if e == nil {
			e = &entry{}
			entries[idx] = e
		}
		e.alloc = toFloat(pdu.Value)
	}

	sizes, err := gs.BulkWalkAll(oidHrStorageSize)
	if err != nil {
		if isNoSuchErr(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("snmp walk storage size: %w", err)
	}
	for _, pdu := range sizes {
		idx, ok := parseIndex(pdu.Name, oidHrStorageSize)
		if !ok {
			continue
		}
		e := entries[idx]
		if e == nil {
			e = &entry{}
			entries[idx] = e
		}
		e.total = toFloat(pdu.Value)
	}

	usedList, err := gs.BulkWalkAll(oidHrStorageUsed)
	if err != nil {
		if isNoSuchErr(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("snmp walk storage used: %w", err)
	}
	for _, pdu := range usedList {
		idx, ok := parseIndex(pdu.Name, oidHrStorageUsed)
		if !ok {
			continue
		}
		e := entries[idx]
		if e == nil {
			e = &entry{}
			entries[idx] = e
		}
		e.used = toFloat(pdu.Value)
	}

	var out []ramEntry
	for _, e := range entries {
		if e.typ != oidHrStorageRamType || e.alloc <= 0 || e.total <= 0 {
			continue
		}
		totalBytes := e.total * e.alloc
		usedBytes := e.used * e.alloc
		out = append(out, ramEntry{TotalBytes: totalBytes, UsedBytes: usedBytes})
	}

	if len(out) == 0 {
		return nil, nil
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TotalBytes > out[j].TotalBytes })
	return out, nil
}

const (
	oidIfName        = ".1.3.6.1.2.1.31.1.1.1.1"
	oidIfDescr       = ".1.3.6.1.2.1.2.2.1.2"
	oidIfAlias       = ".1.3.6.1.2.1.31.1.1.1.18"
	oidIfAdminStatus = ".1.3.6.1.2.1.2.2.1.7"
	oidIfOperStatus  = ".1.3.6.1.2.1.2.2.1.8"
	oidIfHighSpeed   = ".1.3.6.1.2.1.31.1.1.1.15"
	oidIfSpeed       = ".1.3.6.1.2.1.2.2.1.5"
	oidIfHCInOctets  = ".1.3.6.1.2.1.31.1.1.1.6"
	oidIfHCOutOctets = ".1.3.6.1.2.1.31.1.1.1.10"
	oidIfInOctets    = ".1.3.6.1.2.1.2.2.1.10"
	oidIfOutOctets   = ".1.3.6.1.2.1.2.2.1.16"
	oidIfInErrors    = ".1.3.6.1.2.1.2.2.1.14"
	oidIfOutErrors   = ".1.3.6.1.2.1.2.2.1.20"
	oidIfPhysAddr    = ".1.3.6.1.2.1.2.2.1.6"
)

func fetchInterfaces(gs *gosnmp.GoSNMP) ([]InterfaceTelemetry, error) {
	type iface struct {
		index     int
		name      string
		descr     string
		alias     string
		admin     int
		oper      int
		speedMbps *float64
		speedBps  *float64
		mac       string
		inOctets  *uint64
		outOctets *uint64
		inErrors  uint64
		outErrors uint64
	}
	entries := map[int]*iface{}

	fillString := func(pdus []gosnmp.SnmpPDU, base string, apply func(*iface, string)) {
		for _, pdu := range pdus {
			idx, ok := parseIndex(pdu.Name, base)
			if !ok {
				continue
			}
			entry := entries[idx]
			if entry == nil {
				entry = &iface{index: idx}
				entries[idx] = entry
			}
			apply(entry, toString(pdu.Value))
		}
	}

	fillInt := func(pdus []gosnmp.SnmpPDU, base string, apply func(*iface, float64)) {
		for _, pdu := range pdus {
			idx, ok := parseIndex(pdu.Name, base)
			if !ok {
				continue
			}
			entry := entries[idx]
			if entry == nil {
				entry = &iface{index: idx}
				entries[idx] = entry
			}
			apply(entry, toFloat(pdu.Value))
		}
	}

	walk := func(oid string) ([]gosnmp.SnmpPDU, error) {
		pdus, err := gs.BulkWalkAll(oid)
		if err != nil {
			if isNoSuchErr(err) {
				return nil, nil
			}
			return nil, err
		}
		return pdus, nil
	}

	if pdus, err := walk(oidIfName); err == nil {
		fillString(pdus, oidIfName, func(i *iface, v string) { i.name = v })
	}
	if pdus, err := walk(oidIfDescr); err == nil {
		fillString(pdus, oidIfDescr, func(i *iface, v string) {
			if i.name == "" {
				i.name = v
			}
			i.descr = v
		})
	}
	if pdus, err := walk(oidIfAlias); err == nil {
		fillString(pdus, oidIfAlias, func(i *iface, v string) { i.alias = v })
	}
	if pdus, err := walk(oidIfAdminStatus); err == nil {
		fillInt(pdus, oidIfAdminStatus, func(i *iface, v float64) { i.admin = int(v) })
	}
	if pdus, err := walk(oidIfOperStatus); err == nil {
		fillInt(pdus, oidIfOperStatus, func(i *iface, v float64) { i.oper = int(v) })
	}
	if pdus, err := walk(oidIfHighSpeed); err == nil {
		fillInt(pdus, oidIfHighSpeed, func(i *iface, v float64) {
			if v > 0 {
				vv := v
				i.speedMbps = &vv
			}
		})
	}
	if pdus, err := walk(oidIfSpeed); err == nil {
		fillInt(pdus, oidIfSpeed, func(i *iface, v float64) {
			if v > 0 {
				bps := v
				i.speedBps = &bps
			}
		})
	}
	if pdus, err := walk(oidIfPhysAddr); err == nil {
		for _, pdu := range pdus {
			idx, ok := parseIndex(pdu.Name, oidIfPhysAddr)
			if !ok {
				continue
			}
			entry := entries[idx]
			if entry == nil {
				entry = &iface{index: idx}
				entries[idx] = entry
			}
			if mac := toMAC(pdu.Value); mac != "" {
				entry.mac = mac
			}
		}
	}

	hcIn, errHCIn := walk(oidIfHCInOctets)
	if errHCIn == nil {
		for _, pdu := range hcIn {
			idx, ok := parseIndex(pdu.Name, oidIfHCInOctets)
			if !ok {
				continue
			}
			entry := entries[idx]
			if entry == nil {
				entry = &iface{index: idx}
				entries[idx] = entry
			}
			if val, ok := toUint64(pdu.Value); ok {
				entry.inOctets = &val
			}
		}
	}
	hcOut, errHCOut := walk(oidIfHCOutOctets)
	if errHCOut == nil {
		for _, pdu := range hcOut {
			idx, ok := parseIndex(pdu.Name, oidIfHCOutOctets)
			if !ok {
				continue
			}
			entry := entries[idx]
			if entry == nil {
				entry = &iface{index: idx}
				entries[idx] = entry
			}
			if val, ok := toUint64(pdu.Value); ok {
				entry.outOctets = &val
			}
		}
	}

	if errHCIn != nil || errHCOut != nil {
		if pdus, err := walk(oidIfInOctets); err == nil {
			for _, pdu := range pdus {
				idx, ok := parseIndex(pdu.Name, oidIfInOctets)
				if !ok {
					continue
				}
				entry := entries[idx]
				if entry == nil {
					entry = &iface{index: idx}
					entries[idx] = entry
				}
				if val, ok := toUint64(pdu.Value); ok {
					entry.inOctets = &val
				}
			}
		}
		if pdus, err := walk(oidIfOutOctets); err == nil {
			for _, pdu := range pdus {
				idx, ok := parseIndex(pdu.Name, oidIfOutOctets)
				if !ok {
					continue
				}
				entry := entries[idx]
				if entry == nil {
					entry = &iface{index: idx}
					entries[idx] = entry
				}
				if val, ok := toUint64(pdu.Value); ok {
					entry.outOctets = &val
				}
			}
		}
	}

	if pdus, err := walk(oidIfInErrors); err == nil {
		fillInt(pdus, oidIfInErrors, func(i *iface, v float64) {
			if v >= 0 {
				i.inErrors = uint64(v)
			}
		})
	}
	if pdus, err := walk(oidIfOutErrors); err == nil {
		fillInt(pdus, oidIfOutErrors, func(i *iface, v float64) {
			if v >= 0 {
				i.outErrors = uint64(v)
			}
		})
	}

	var out []InterfaceTelemetry
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		name := strings.TrimSpace(entry.name)
		if name == "" {
			name = strings.TrimSpace(entry.descr)
		}
		tel := InterfaceTelemetry{
			Index:      entry.index,
			Name:       name,
			Alias:      strings.TrimSpace(entry.alias),
			AdminState: mapIfStatus(entry.admin),
			OperState:  mapIfStatus(entry.oper),
			MAC:        entry.mac,
			InErrors:   entry.inErrors,
			OutErrors:  entry.outErrors,
		}
		if entry.speedMbps != nil {
			tmp := *entry.speedMbps
			tel.SpeedMbps = &tmp
		} else if entry.speedBps != nil {
			bps := *entry.speedBps
			if bps > 0 {
				mbps := bps / 1_000_000
				tel.SpeedMbps = &mbps
			}
		}
		if entry.inOctets != nil {
			tel.InOctets = *entry.inOctets
		}
		if entry.outOctets != nil {
			tel.OutOctets = *entry.outOctets
		}
		out = append(out, tel)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Index < out[j].Index })
	return out, nil
}

func mapIfStatus(v int) string {
	switch v {
	case 1:
		return "up"
	case 2:
		return "down"
	case 3:
		return "testing"
	case 4:
		return "unknown"
	case 5:
		return "dormant"
	case 6:
		return "notPresent"
	case 7:
		return "lowerLayerDown"
	default:
		if v <= 0 {
			return "unknown"
		}
		return fmt.Sprintf("status_%d", v)
	}
}

func isNoSuchErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "no such") || strings.Contains(msg, "nosuch") {
		return true
	}
	if strings.Contains(msg, "noaccess") || strings.Contains(msg, "no access") {
		return true
	}
	if strings.Contains(msg, "no creation") || strings.Contains(msg, "nocreation") {
		return true
	}
	return false
}

func parseIndex(oid string, base string) (int, bool) {
	if !strings.HasPrefix(oid, base) {
		return 0, false
	}
	suffix := strings.TrimPrefix(oid, base)
	suffix = strings.TrimPrefix(suffix, ".")
	if suffix == "" {
		return 0, false
	}
	idx := 0
	for _, ch := range suffix {
		if ch < '0' || ch > '9' {
			return 0, false
		}
		idx = idx*10 + int(ch-'0')
	}
	if idx <= 0 {
		return 0, false
	}
	return idx, true
}

func toFloat(v any) float64 {
	switch val := v.(type) {
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case uint:
		return float64(val)
	case uint32:
		return float64(val)
	case uint64:
		return float64(val)
	case float32:
		return float64(val)
	case float64:
		return val
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(val), 64); err == nil {
			return f
		}
	case []byte:
		if f, err := strconv.ParseFloat(strings.TrimSpace(string(val)), 64); err == nil {
			return f
		}
	}
	return 0
}

func toString(v any) string {
	switch val := v.(type) {
	case string:
		return strings.TrimSpace(val)
	case []byte:
		return strings.TrimSpace(string(val))
	case int:
		return fmt.Sprintf("%d", val)
	case uint:
		return fmt.Sprintf("%d", val)
	case uint32:
		return fmt.Sprintf("%d", val)
	case uint64:
		return fmt.Sprintf("%d", val)
	default:
		return fmt.Sprintf("%v", v)
	}
}

func toMAC(v any) string {
	switch val := v.(type) {
	case string:
		return normaliseMAC([]byte(val))
	case []byte:
		return normaliseMAC(val)
	}
	return ""
}

func normaliseMAC(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	parts := make([]string, len(b))
	for i, v := range b {
		parts[i] = fmt.Sprintf("%02x", v)
	}
	return strings.Join(parts, ":")
}

func toUint64(v any) (uint64, bool) {
	switch val := v.(type) {
	case uint64:
		return val, true
	case uint32:
		return uint64(val), true
	case uint:
		return uint64(val), true
	case int:
		if val < 0 {
			return 0, false
		}
		return uint64(val), true
	case int64:
		if val < 0 {
			return 0, false
		}
		return uint64(val), true
	case string:
		f, err := strconv.ParseUint(strings.TrimSpace(val), 10, 64)
		if err != nil {
			return 0, false
		}
		return f, true
	case []byte:
		f, err := strconv.ParseUint(strings.TrimSpace(string(val)), 10, 64)
		if err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}
