package discovery

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pulseops/pulseops/internal/collectors/ping"
	"github.com/pulseops/pulseops/internal/network"
)

// DiscoveredDevice represents a device found during network discovery
type DiscoveredDevice struct {
	IP                        string                        `json:"ip"`
	Hostname                  string                        `json:"hostname,omitempty"`
	MAC                       string                        `json:"mac,omitempty"`
	Vendor                    string                        `json:"vendor,omitempty"`
	OpenPorts                 []int                         `json:"open_ports"`
	Services                  map[string]string             `json:"services"`
	PingTime                  float64                       `json:"ping_time"`
	Reachable                 bool                          `json:"reachable"`
	Suggestions               []string                      `json:"suggestions"` // Suggested device types/templates
	NetworkScope              string                        `json:"network_scope,omitempty"`
	NetworkScopeReason        string                        `json:"network_scope_reason,omitempty"`
	NetworkScopeMatchedSubnet string                        `json:"network_scope_matched_subnet,omitempty"`
	NetworkScopePrivate       *bool                         `json:"network_scope_private,omitempty"`
	NetworkClassification     *network.ClassificationResult `json:"network_classification,omitempty"`
}

// NetworkRange represents a network range to scan
type NetworkRange struct {
	Network string `json:"network"` // e.g., "192.168.1.0/24"
	Start   string `json:"start"`   // e.g., "192.168.1.1"
	End     string `json:"end"`     // e.g., "192.168.1.254"
}

// NormaliseNetworkRange ensures a network range has consistent IPv4 boundaries.
// If a CIDR network is provided, the function derives sensible start/end values
// that align with the subnet. All values are trimmed and validated.
func NormaliseNetworkRange(raw NetworkRange) (NetworkRange, error) {
	out := NetworkRange{
		Network: strings.TrimSpace(raw.Network),
		Start:   strings.TrimSpace(raw.Start),
		End:     strings.TrimSpace(raw.End),
	}

	var subnet *net.IPNet
	if out.Network != "" {
		ip, parsedSubnet, err := net.ParseCIDR(out.Network)
		if err != nil {
			return NetworkRange{}, fmt.Errorf("invalid network: %w", err)
		}
		if ip == nil || ip.To4() == nil {
			return NetworkRange{}, fmt.Errorf("only IPv4 networks are supported")
		}
		if parsedSubnet == nil {
			return NetworkRange{}, fmt.Errorf("invalid network: %s", out.Network)
		}
		subnet = parsedSubnet
		derived := networkRangeFromSubnet(subnet)
		if derived.Network == "" {
			return NetworkRange{}, fmt.Errorf("unsupported network: %s", out.Network)
		}
		out.Network = derived.Network
		if out.Start == "" {
			out.Start = derived.Start
		}
		if out.End == "" {
			out.End = derived.End
		}
	}

	if out.Start == "" || out.End == "" {
		return NetworkRange{}, fmt.Errorf("start and end addresses are required")
	}

	startIP := net.ParseIP(out.Start)
	if startIP == nil || startIP.To4() == nil {
		return NetworkRange{}, fmt.Errorf("invalid start address: %s", out.Start)
	}
	endIP := net.ParseIP(out.End)
	if endIP == nil || endIP.To4() == nil {
		return NetworkRange{}, fmt.Errorf("invalid end address: %s", out.End)
	}
	startIP = startIP.To4()
	endIP = endIP.To4()
	if bytes.Compare(startIP, endIP) > 0 {
		return NetworkRange{}, fmt.Errorf("start address must not exceed end address")
	}

	if subnet != nil {
		if !subnet.Contains(startIP) {
			return NetworkRange{}, fmt.Errorf("start address %s is outside %s", startIP.String(), subnet.String())
		}
		if !subnet.Contains(endIP) {
			return NetworkRange{}, fmt.Errorf("end address %s is outside %s", endIP.String(), subnet.String())
		}
	}

	out.Start = startIP.String()
	out.End = endIP.String()
	return out, nil
}

// DiscoveryOptions configures the discovery process
type DiscoveryOptions struct {
	Timeout       time.Duration `json:"timeout"`
	MaxConcurrent int           `json:"max_concurrent"`
	PortScan      bool          `json:"port_scan"`
	CommonPorts   []int         `json:"common_ports"`
	ResolveNames  bool          `json:"resolve_names"`
}

// DefaultDiscoveryOptions returns sensible defaults for discovery
func DefaultDiscoveryOptions() DiscoveryOptions {
	return DiscoveryOptions{
		Timeout:       3 * time.Second,
		MaxConcurrent: 50,
		PortScan:      true,
		CommonPorts:   []int{22, 23, 53, 80, 135, 139, 443, 445, 515, 631, 993, 995, 8080, 8443, 9100},
		ResolveNames:  true,
	}
}

var fallbackNetworkRanges = []NetworkRange{
	{Network: "192.168.1.0/24", Start: "192.168.1.1", End: "192.168.1.254"},
	{Network: "192.168.0.0/24", Start: "192.168.0.1", End: "192.168.0.254"},
	{Network: "10.0.0.0/24", Start: "10.0.0.1", End: "10.0.0.254"},
	{Network: "10.0.1.0/24", Start: "10.0.1.1", End: "10.0.1.254"},
	{Network: "172.16.0.0/24", Start: "172.16.0.1", End: "172.16.0.254"},
	{Network: "192.168.8.0/24", Start: "192.168.8.1", End: "192.168.8.254"},
}

// DiscoverNetwork scans a network range for devices
func DiscoverNetwork(ctx context.Context, networkRange NetworkRange, options DiscoveryOptions) ([]DiscoveredDevice, error) {
	ips, err := expandNetworkRange(networkRange)
	if err != nil {
		return nil, fmt.Errorf("failed to expand network range: %v", err)
	}

	devices := make([]DiscoveredDevice, 0, len(ips))
	var mu sync.Mutex
	var wg sync.WaitGroup

	var classifier *network.DeviceClassifier
	if c, err := network.NewDeviceClassifier(); err == nil {
		classifier = c
	}

	// Create a semaphore to limit concurrent operations
	sem := make(chan struct{}, options.MaxConcurrent)

	for _, ip := range ips {
		wg.Add(1)
		go func(ip string) {
			defer wg.Done()
			sem <- struct{}{}        // Acquire semaphore
			defer func() { <-sem }() // Release semaphore

			device := discoverDevice(ctx, ip, options, classifier)
			if device.Reachable {
				mu.Lock()
				devices = append(devices, device)
				mu.Unlock()
			}
		}(ip)
	}

	wg.Wait()
	return devices, nil
}

// GetLocalNetworkRanges returns common local network ranges to scan
func GetLocalNetworkRanges() []NetworkRange {
	snapshot, err := network.SnapshotLocalNetworks()
	ranges := make([]NetworkRange, 0, len(snapshot.Subnets)+len(fallbackNetworkRanges))
	if err == nil {
		for _, subnet := range snapshot.Subnets {
			if subnet == nil {
				continue
			}
			rangeCandidate := networkRangeFromSubnet(subnet)
			if rangeCandidate.Network == "" || rangeCandidate.Start == "" || rangeCandidate.End == "" {
				continue
			}
			ranges = append(ranges, rangeCandidate)
		}
	}
	ranges = append(ranges, fallbackNetworkRanges...)
	return dedupeNetworkRanges(ranges)
}

func networkRangeFromSubnet(subnet *net.IPNet) NetworkRange {
	if subnet == nil {
		return NetworkRange{}
	}
	networkIP := subnet.IP.Mask(subnet.Mask)
	if networkIP == nil {
		return NetworkRange{}
	}
	if ip4 := networkIP.To4(); ip4 != nil {
		networkIP = ip4
	}
	broadcastIP := broadcast(subnet)
	if broadcastIP == nil {
		return NetworkRange{}
	}
	if ip4 := broadcastIP.To4(); ip4 != nil {
		broadcastIP = ip4
	}
	startIP := nextIP(networkIP)
	if startIP == nil || !subnet.Contains(startIP) {
		startIP = cloneIP(networkIP)
	}
	endIP := prevIP(broadcastIP)
	if endIP == nil || !subnet.Contains(endIP) {
		endIP = cloneIP(broadcastIP)
	}
	if bytes.Compare(startIP, endIP) > 0 {
		startIP = cloneIP(networkIP)
		endIP = cloneIP(broadcastIP)
	}
	return NetworkRange{
		Network: subnet.String(),
		Start:   startIP.String(),
		End:     endIP.String(),
	}
}

func dedupeNetworkRanges(ranges []NetworkRange) []NetworkRange {
	if len(ranges) == 0 {
		return ranges
	}
	seen := make(map[string]struct{}, len(ranges))
	out := make([]NetworkRange, 0, len(ranges))
	for _, r := range ranges {
		if r.Network == "" && r.Start == "" && r.End == "" {
			continue
		}
		key := r.Network + "|" + r.Start + "|" + r.End
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, r)
	}
	return out
}

func nextIP(ip net.IP) net.IP {
	if ip == nil {
		return nil
	}
	out := make(net.IP, len(ip))
	copy(out, ip)
	for i := len(out) - 1; i >= 0; i-- {
		out[i]++
		if out[i] != 0 {
			return out
		}
	}
	return nil
}

func prevIP(ip net.IP) net.IP {
	if ip == nil {
		return nil
	}
	out := make(net.IP, len(ip))
	copy(out, ip)
	for i := len(out) - 1; i >= 0; i-- {
		out[i]--
		if out[i] != 255 {
			return out
		}
	}
	return nil
}

func cloneIP(ip net.IP) net.IP {
	if ip == nil {
		return nil
	}
	out := make(net.IP, len(ip))
	copy(out, ip)
	return out
}

// discoverDevice performs discovery on a single IP address
func discoverDevice(ctx context.Context, ip string, options DiscoveryOptions, classifier *network.DeviceClassifier) DiscoveredDevice {
	device := DiscoveredDevice{
		IP:       ip,
		Services: make(map[string]string),
	}

	// Test reachability with ping
	pingTime, err := ping.PingOnce(ctx, ip, options.Timeout)
	if err != nil {
		device.Reachable = false
		return device
	}

	device.Reachable = true
	device.PingTime = pingTime

	if classifier != nil {
		result := classifier.Classify(ip)
		if category := string(result.Category); category != "" {
			device.NetworkScope = category
		}
		if result.Reason != "" {
			device.NetworkScopeReason = result.Reason
		}
		if result.MatchedSubnet != "" {
			device.NetworkScopeMatchedSubnet = result.MatchedSubnet
		}
		privateFlag := result.Private
		device.NetworkScopePrivate = &privateFlag
		resultCopy := result
		device.NetworkClassification = &resultCopy
	}

	// Resolve hostname if requested
	if options.ResolveNames {
		if names, err := net.LookupAddr(ip); err == nil && len(names) > 0 {
			device.Hostname = strings.TrimSuffix(names[0], ".")
		}
	}

	// Port scan if requested
	if options.PortScan {
		device.OpenPorts = scanPorts(ctx, ip, options.CommonPorts, options.Timeout)
		device.Services = identifyServices(device.OpenPorts)
	}

	// Generate suggestions based on discovered information
	device.Suggestions = generateSuggestions(device)

	return device
}

// expandNetworkRange converts a network range to a list of IP addresses
func expandNetworkRange(networkRange NetworkRange) ([]string, error) {
	if networkRange.Network != "" {
		// Parse CIDR notation
		_, ipnet, err := net.ParseCIDR(networkRange.Network)
		if err != nil {
			return nil, err
		}

		var ips []string
		for ip := ipnet.IP.Mask(ipnet.Mask); ipnet.Contains(ip); inc(ip) {
			// Skip network and broadcast addresses
			if !ip.Equal(ipnet.IP) && !ip.Equal(broadcast(ipnet)) {
				ips = append(ips, ip.String())
			}
		}
		return ips, nil
	}

	// Parse start and end range
	startIP := net.ParseIP(networkRange.Start)
	endIP := net.ParseIP(networkRange.End)
	if startIP == nil || endIP == nil {
		return nil, fmt.Errorf("invalid IP range")
	}

	var ips []string
	for ip := startIP; !ip.Equal(endIP); inc(ip) {
		ips = append(ips, ip.String())
	}
	ips = append(ips, endIP.String()) // Include end IP

	return ips, nil
}

// scanPorts scans the specified ports on a host
func scanPorts(ctx context.Context, host string, ports []int, timeout time.Duration) []int {
	var openPorts []int
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, port := range ports {
		wg.Add(1)
		go func(port int) {
			defer wg.Done()
			if isPortOpen(ctx, host, port, timeout) {
				mu.Lock()
				openPorts = append(openPorts, port)
				mu.Unlock()
			}
		}(port)
	}

	wg.Wait()
	return openPorts
}

// isPortOpen checks if a port is open on a host
func isPortOpen(ctx context.Context, host string, port int, timeout time.Duration) bool {
	address := net.JoinHostPort(host, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// identifyServices maps open ports to likely services
func identifyServices(openPorts []int) map[string]string {
	services := make(map[string]string)
	serviceMap := map[int]string{
		22:   "SSH",
		23:   "Telnet",
		53:   "DNS",
		80:   "HTTP",
		135:  "RPC",
		139:  "NetBIOS",
		443:  "HTTPS",
		445:  "SMB",
		515:  "LPR",
		631:  "IPP",
		993:  "IMAPS",
		995:  "POP3S",
		8080: "HTTP-Alt",
		8443: "HTTPS-Alt",
		9100: "Raw Print",
	}

	for _, port := range openPorts {
		if service, exists := serviceMap[port]; exists {
			services[fmt.Sprintf("port_%d", port)] = service
		}
	}

	return services
}

// generateSuggestions suggests device templates based on discovered characteristics
func generateSuggestions(device DiscoveredDevice) []string {
	var suggestions []string

	// Check for common router/gateway IPs
	if strings.HasSuffix(device.IP, ".1") || strings.HasSuffix(device.IP, ".254") {
		suggestions = append(suggestions, "router")
	}

	// Check for Huawei modem (common IP)
	if device.IP == "192.168.8.1" {
		suggestions = append(suggestions, "huawei")
	}

	// Check open ports for service identification
	hasSSH := contains(device.OpenPorts, 22)
	hasHTTP := contains(device.OpenPorts, 80) || contains(device.OpenPorts, 443)
	hasPrint := contains(device.OpenPorts, 9100) || contains(device.OpenPorts, 515) || contains(device.OpenPorts, 631)

	if hasSSH && hasHTTP {
		suggestions = append(suggestions, "openwrt", "edgeos", "unifi", "mikrotik", "generic-router")
	} else if hasHTTP && !hasSSH {
		suggestions = append(suggestions, "huawei", "generic-router")
	} else if hasPrint {
		suggestions = append(suggestions, "generic-printer")
	} else if hasSSH {
		suggestions = append(suggestions, "generic-server")
	}

	// Check hostname for hints
	if device.Hostname != "" {
		hostname := strings.ToLower(device.Hostname)
		if strings.Contains(hostname, "router") || strings.Contains(hostname, "gateway") {
			suggestions = append(suggestions, "generic-router")
		} else if strings.Contains(hostname, "printer") || strings.Contains(hostname, "print") {
			suggestions = append(suggestions, "generic-printer")
		} else if strings.Contains(hostname, "unifi") || strings.Contains(hostname, "ubnt") {
			suggestions = append(suggestions, "unifi")
		}
	}

	return removeDuplicates(suggestions)
}

// Helper functions
func inc(ip net.IP) {
	for j := len(ip) - 1; j >= 0; j-- {
		ip[j]++
		if ip[j] > 0 {
			break
		}
	}
}

func broadcast(ipnet *net.IPNet) net.IP {
	broadcast := make(net.IP, len(ipnet.IP))
	copy(broadcast, ipnet.IP)
	for i := 0; i < len(broadcast); i++ {
		broadcast[i] |= ^ipnet.Mask[i]
	}
	return broadcast
}

func contains(slice []int, item int) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func removeDuplicates(slice []string) []string {
	keys := make(map[string]bool)
	var result []string
	for _, item := range slice {
		if !keys[item] {
			keys[item] = true
			result = append(result, item)
		}
	}
	return result
}
