package network

import (
	"bytes"
	"net"
	"sort"
	"strings"
	"sync"
	"time"
)

// Classification represents the inferred network scope for a device.
type Classification string

const (
	// ClassificationLAN indicates the device is on the same Layer 2/3 network as the controller.
	ClassificationLAN Classification = "lan"
	// ClassificationLocalVLAN indicates the device is reachable on a private network that is not
	// directly attached to the controller but still within the local infrastructure.
	ClassificationLocalVLAN Classification = "local_vlan"
	// ClassificationRemote indicates the device is reachable via a public or otherwise remote network.
	ClassificationRemote Classification = "remote"
)

const (
	reasonUnspecified    = "unspecified"
	reasonEmptyHost      = "empty_host"
	reasonUnparseable    = "unparseable_host"
	reasonNonIPv4        = "non_ipv4_address"
	reasonMatchedLocal   = "matched_local_subnet"
	reasonPrivateNetwork = "private_nonlocal"
	reasonPublicNetwork  = "public_network"
)

const defaultClassifierRefreshInterval = time.Minute

// ClassificationResult contains the details of a classification decision.
type ClassificationResult struct {
	Category      Classification `json:"classification"`
	IP            string         `json:"ip,omitempty"`
	MatchedSubnet string         `json:"matched_subnet,omitempty"`
	Private       bool           `json:"private,omitempty"`
	Reason        string         `json:"reason,omitempty"`
}

// Equal reports whether two classification results represent the same decision.
func (r ClassificationResult) Equal(other ClassificationResult) bool {
	return r.Category == other.Category &&
		r.IP == other.IP &&
		r.MatchedSubnet == other.MatchedSubnet &&
		r.Private == other.Private &&
		r.Reason == other.Reason
}

// LocalNetworkSnapshot captures the controller's current IPv4 addresses and connected subnets.
type LocalNetworkSnapshot struct {
	InternalIPs []net.IP
	Subnets     []*net.IPNet
	CapturedAt  time.Time
}

// clone makes a deep copy of the snapshot, ensuring returned slices can be modified independently.
func (s LocalNetworkSnapshot) clone() LocalNetworkSnapshot {
	if len(s.InternalIPs) == 0 && len(s.Subnets) == 0 {
		return LocalNetworkSnapshot{CapturedAt: s.CapturedAt}
	}
	clone := LocalNetworkSnapshot{CapturedAt: s.CapturedAt}
	if len(s.InternalIPs) > 0 {
		clone.InternalIPs = make([]net.IP, len(s.InternalIPs))
		for i, ip := range s.InternalIPs {
			clone.InternalIPs[i] = cloneIP(ip)
		}
	}
	if len(s.Subnets) > 0 {
		clone.Subnets = make([]*net.IPNet, len(s.Subnets))
		for i, subnet := range s.Subnets {
			clone.Subnets[i] = cloneIPNet(subnet)
		}
	}
	return clone
}

// DeviceClassifier analyses device hosts and assigns them to LAN/VLAN/remote scopes.
type DeviceClassifier struct {
	mu              sync.RWMutex
	snapshot        LocalNetworkSnapshot
	refreshInterval time.Duration
}

// NewDeviceClassifier builds a classifier using the host's active network interfaces.
func NewDeviceClassifier() (*DeviceClassifier, error) {
	snapshot, err := SnapshotLocalNetworks()
	classifier := &DeviceClassifier{
		snapshot:        snapshot,
		refreshInterval: defaultClassifierRefreshInterval,
	}
	return classifier, err
}

// Classify determines the network classification for a host string.
func (c *DeviceClassifier) Classify(host string) ClassificationResult {
	result := ClassificationResult{Category: ClassificationRemote, Reason: reasonUnspecified}
	if strings.TrimSpace(host) == "" {
		result.Reason = reasonEmptyHost
		return result
	}

	hostPart := strings.TrimSpace(host)
	if strings.Contains(hostPart, ":") {
		if parsedHost, _, err := net.SplitHostPort(hostPart); err == nil {
			hostPart = parsedHost
		}
	}

	ip := net.ParseIP(hostPart)
	if ip == nil {
		result.Reason = reasonUnparseable
		return result
	}

	if ip4 := ip.To4(); ip4 != nil {
		ip = ip4
	} else {
		result.IP = ip.String()
		result.Reason = reasonNonIPv4
		return result
	}

	result.IP = ip.String()

	var subnets []*net.IPNet
	if c != nil {
		c.refreshIfStale()
		c.mu.RLock()
		subnets = c.snapshot.Subnets
		c.mu.RUnlock()
	}

	for _, subnet := range subnets {
		if subnet == nil {
			continue
		}
		if subnet.Contains(ip) {
			result.Category = ClassificationLAN
			result.Private = true
			result.MatchedSubnet = subnet.String()
			result.Reason = reasonMatchedLocal
			return result
		}
	}

	if ip.IsPrivate() {
		result.Category = ClassificationLocalVLAN
		result.Private = true
		result.Reason = reasonPrivateNetwork
		return result
	}

	result.Reason = reasonPublicNetwork
	return result
}

// Snapshot returns a copy of the cached local network snapshot.
func (c *DeviceClassifier) Snapshot() LocalNetworkSnapshot {
	if c == nil {
		return LocalNetworkSnapshot{}
	}
	c.refreshIfStale()
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snapshot.clone()
}

// Refresh immediately refreshes the classifier's cached snapshot.
func (c *DeviceClassifier) Refresh() error {
	if c == nil {
		return nil
	}
	snapshot, err := SnapshotLocalNetworks()
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.snapshot = snapshot
	if c.refreshInterval <= 0 {
		c.refreshInterval = defaultClassifierRefreshInterval
	}
	c.mu.Unlock()
	return nil
}

// SetRefreshInterval overrides how frequently the cached snapshot is refreshed when accessed.
func (c *DeviceClassifier) SetRefreshInterval(interval time.Duration) {
	if c == nil {
		return
	}
	if interval <= 0 {
		interval = defaultClassifierRefreshInterval
	}
	c.mu.Lock()
	c.refreshInterval = interval
	c.mu.Unlock()
}

func (c *DeviceClassifier) refreshIfStale() {
	if c == nil {
		return
	}
	interval := c.refreshInterval
	if interval <= 0 {
		interval = defaultClassifierRefreshInterval
	}
	c.mu.RLock()
	last := c.snapshot.CapturedAt
	c.mu.RUnlock()
	if !last.IsZero() && time.Since(last) < interval {
		return
	}
	snapshot, err := SnapshotLocalNetworks()
	if err != nil {
		return
	}
	c.mu.Lock()
	c.snapshot = snapshot
	c.mu.Unlock()
}

// SnapshotLocalNetworks captures the host's current internal IPv4 addresses and subnets.
func SnapshotLocalNetworks() (LocalNetworkSnapshot, error) {
	return captureLocalNetworks()
}

func captureLocalNetworks() (LocalNetworkSnapshot, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return LocalNetworkSnapshot{}, err
	}

	seenSubnets := make(map[string]*net.IPNet)
	seenIPs := make(map[string]net.IP)

	for _, iface := range interfaces {
		if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var (
				ip      net.IP
				network *net.IPNet
			)
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
				network = v
			case *net.IPAddr:
				ip = v.IP
				network = &net.IPNet{IP: v.IP, Mask: net.CIDRMask(len(v.IP)*8, len(v.IP)*8)}
			default:
				continue
			}

			if ip == nil {
				continue
			}
			if ip4 := ip.To4(); ip4 != nil {
				ip = ip4
			} else {
				continue
			}

			mask := network.Mask
			if mask == nil {
				mask = net.CIDRMask(len(ip)*8, len(ip)*8)
			}

			normalized := &net.IPNet{IP: cloneIP(ip.Mask(mask)), Mask: cloneIPMask(mask)}
			if normalized.Mask == nil {
				continue
			}
			key := normalized.String()
			if _, exists := seenSubnets[key]; !exists {
				seenSubnets[key] = normalized
			}

			ipKey := ip.String()
			if _, exists := seenIPs[ipKey]; !exists {
				seenIPs[ipKey] = cloneIP(ip)
			}
		}
	}

	subnets := make([]*net.IPNet, 0, len(seenSubnets))
	for _, subnet := range seenSubnets {
		subnets = append(subnets, subnet)
	}
	sort.Slice(subnets, func(i, j int) bool {
		return strings.Compare(subnets[i].String(), subnets[j].String()) < 0
	})

	ips := make([]net.IP, 0, len(seenIPs))
	for _, ip := range seenIPs {
		ips = append(ips, ip)
	}
	sort.Slice(ips, func(i, j int) bool {
		return bytes.Compare(ips[i], ips[j]) < 0
	})

	return LocalNetworkSnapshot{
		InternalIPs: ips,
		Subnets:     subnets,
		CapturedAt:  time.Now(),
	}, nil
}

func cloneIP(ip net.IP) net.IP {
	if ip == nil {
		return nil
	}
	dup := make(net.IP, len(ip))
	copy(dup, ip)
	return dup
}

func cloneIPMask(mask net.IPMask) net.IPMask {
	if mask == nil {
		return nil
	}
	dup := make(net.IPMask, len(mask))
	copy(dup, mask)
	return dup
}

func cloneIPNet(subnet *net.IPNet) *net.IPNet {
	if subnet == nil {
		return nil
	}
	return &net.IPNet{IP: cloneIP(subnet.IP), Mask: cloneIPMask(subnet.Mask)}
}
