package discovery

import (
	"net"
	"testing"
)

func mustCIDR(t *testing.T, cidr string) *net.IPNet {
	t.Helper()
	_, network, err := net.ParseCIDR(cidr)
	if err != nil {
		t.Fatalf("parse cidr %s: %v", cidr, err)
	}
	return network
}

func TestNetworkRangeFromSubnet_Standard(t *testing.T) {
	subnet := mustCIDR(t, "192.168.10.0/24")
	rng := networkRangeFromSubnet(subnet)
	if rng.Network != "192.168.10.0/24" {
		t.Fatalf("unexpected network: %s", rng.Network)
	}
	if rng.Start != "192.168.10.1" {
		t.Fatalf("unexpected start: %s", rng.Start)
	}
	if rng.End != "192.168.10.254" {
		t.Fatalf("unexpected end: %s", rng.End)
	}
}

func TestNetworkRangeFromSubnet_Small(t *testing.T) {
	subnet := mustCIDR(t, "10.0.0.0/31")
	rng := networkRangeFromSubnet(subnet)
	if rng.Start != "10.0.0.0" {
		t.Fatalf("expected start fallback to network, got %s", rng.Start)
	}
	if rng.End != "10.0.0.1" {
		t.Fatalf("expected end fallback to broadcast, got %s", rng.End)
	}
}

func TestNetworkRangeFromSubnet_SingleHost(t *testing.T) {
	subnet := mustCIDR(t, "192.168.1.5/32")
	rng := networkRangeFromSubnet(subnet)
	if rng.Start != "192.168.1.5" || rng.End != "192.168.1.5" {
		t.Fatalf("expected single host start/end to match, got %s-%s", rng.Start, rng.End)
	}
}

func TestDedupeNetworkRanges(t *testing.T) {
	ranges := []NetworkRange{
		{Network: "192.168.1.0/24", Start: "192.168.1.1", End: "192.168.1.254"},
		{Network: "192.168.1.0/24", Start: "192.168.1.1", End: "192.168.1.254"},
		{Network: "10.0.0.0/24", Start: "10.0.0.1", End: "10.0.0.254"},
		{},
	}
	got := dedupeNetworkRanges(ranges)
	if len(got) != 2 {
		t.Fatalf("expected 2 unique ranges, got %d", len(got))
	}
}

func TestNormaliseNetworkRange_FromCIDR(t *testing.T) {
	rng, err := NormaliseNetworkRange(NetworkRange{Network: "10.10.20.0/24"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rng.Start != "10.10.20.1" || rng.End != "10.10.20.254" {
		t.Fatalf("unexpected range: %s-%s", rng.Start, rng.End)
	}
	if rng.Network != "10.10.20.0/24" {
		t.Fatalf("unexpected network: %s", rng.Network)
	}
}

func TestNormaliseNetworkRange_StartEndValidation(t *testing.T) {
	_, err := NormaliseNetworkRange(NetworkRange{Start: "10.0.0.5", End: "10.0.0.4"})
	if err == nil {
		t.Fatalf("expected error for inverted range")
	}
}
