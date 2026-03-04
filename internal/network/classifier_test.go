package network

import (
	"net"
	"testing"
	"time"
)

func mustCIDR(t *testing.T, cidr string) *net.IPNet {
	t.Helper()
	_, network, err := net.ParseCIDR(cidr)
	if err != nil {
		t.Fatalf("parse cidr %s: %v", cidr, err)
	}
	return network
}

func TestClassificationResultEqual(t *testing.T) {
	a := ClassificationResult{Category: ClassificationLAN, IP: "192.168.1.10", MatchedSubnet: "192.168.1.0/24", Private: true, Reason: reasonMatchedLocal}
	b := ClassificationResult{Category: ClassificationLAN, IP: "192.168.1.10", MatchedSubnet: "192.168.1.0/24", Private: true, Reason: reasonMatchedLocal}
	if !a.Equal(b) {
		t.Fatalf("expected equality")
	}
	b.MatchedSubnet = "192.168.2.0/24"
	if a.Equal(b) {
		t.Fatalf("expected inequality when matched subnet differs")
	}
}

func TestDeviceClassifier_Classify(t *testing.T) {
	classifier := &DeviceClassifier{
		snapshot: LocalNetworkSnapshot{
			Subnets:    []*net.IPNet{mustCIDR(t, "192.168.1.0/24")},
			CapturedAt: time.Now(),
		},
		refreshInterval: time.Hour,
	}

	res := classifier.Classify("192.168.1.15")
	if res.Category != ClassificationLAN {
		t.Fatalf("expected LAN classification, got %s", res.Category)
	}
	if res.MatchedSubnet != "192.168.1.0/24" {
		t.Fatalf("unexpected matched subnet %s", res.MatchedSubnet)
	}
	if res.Reason != reasonMatchedLocal {
		t.Fatalf("unexpected reason %s", res.Reason)
	}
	if !res.Private {
		t.Fatalf("expected private flag true")
	}

	vlan := classifier.Classify("10.20.30.40")
	if vlan.Category != ClassificationLocalVLAN {
		t.Fatalf("expected Local VLAN classification, got %s", vlan.Category)
	}
	if !vlan.Private {
		t.Fatalf("expected private flag for VLAN classification")
	}
	if vlan.Reason != reasonPrivateNetwork {
		t.Fatalf("unexpected reason %s", vlan.Reason)
	}

	remote := classifier.Classify("8.8.8.8")
	if remote.Category != ClassificationRemote {
		t.Fatalf("expected Remote classification, got %s", remote.Category)
	}
	if remote.Private {
		t.Fatalf("expected remote classification to be public")
	}
	if remote.Reason != reasonPublicNetwork {
		t.Fatalf("unexpected reason %s", remote.Reason)
	}

	withPort := classifier.Classify("192.168.1.15:2222")
	if withPort.Category != ClassificationLAN {
		t.Fatalf("expected LAN classification for host with port, got %s", withPort.Category)
	}

	empty := classifier.Classify("   ")
	if empty.Reason != reasonEmptyHost {
		t.Fatalf("expected empty host reason, got %s", empty.Reason)
	}

	ipv6 := classifier.Classify("fe80::1")
	if ipv6.Category != ClassificationRemote {
		t.Fatalf("expected Remote classification for IPv6, got %s", ipv6.Category)
	}
	if ipv6.Reason != reasonNonIPv4 {
		t.Fatalf("unexpected IPv6 reason %s", ipv6.Reason)
	}
}
