package geo

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

type Result struct {
	IP           string          `json:"ip,omitempty"`
	City         string          `json:"city,omitempty"`
	Region       string          `json:"region,omitempty"`
	Country      string          `json:"country,omitempty"`
	CountryCode  string          `json:"country_code,omitempty"`
	Continent    string          `json:"continent,omitempty"`
	Latitude     *float64        `json:"latitude,omitempty"`
	Longitude    *float64        `json:"longitude,omitempty"`
	Timezone     string          `json:"timezone,omitempty"`
	ASN          string          `json:"asn,omitempty"`
	Organization string          `json:"organization,omitempty"`
	ISP          string          `json:"isp,omitempty"`
	Display      string          `json:"display,omitempty"`
	Source       string          `json:"source,omitempty"`
	Raw          json.RawMessage `json:"raw,omitempty"`
}

func Parse(data []byte) (*Result, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty geolocation payload")
	}
	var payload any
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("parse geolocation response: %w", err)
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("unexpected geolocation payload type %T", payload)
	}
	res := &Result{}
	raw := make([]byte, len(data))
	copy(raw, data)
	res.Raw = json.RawMessage(raw)

	res.IP = findString(root, "ip", "query", "address")
	res.City = findString(root, "city", "city_name", "location.city")
	res.Region = findString(root, "region", "region_name", "location.region", "state", "state_name", "province")
	res.Country = findString(root, "country_name", "country", "location.country", "countryName")
	res.CountryCode = findString(root, "country_code", "countryCode", "country_iso_code", "location.country_code")
	res.Continent = findString(root, "continent", "continent_name", "location.continent")
	res.Timezone = findString(root, "timezone", "time_zone", "location.timezone")
	res.Organization = findString(root, "organization", "org", "autonomous_system_organization", "asn.organization", "as.name")
	res.ISP = findString(root, "isp", "internet_service_provider")
	res.ASN = sanitizeASN(findString(root, "asn", "as", "autonomous_system_number", "asn.number"))
	if res.ASN == "" {
		res.ASN = extractASN(res.Organization)
	}
	if res.ISP == "" && res.Organization != "" {
		res.ISP = res.Organization
	}
	if res.Organization == "" && res.ISP != "" {
		res.Organization = res.ISP
	}

	lat, lon := findCoordinates(root)
	if lat != nil {
		res.Latitude = lat
	}
	if lon != nil {
		res.Longitude = lon
	}

	if display := buildDisplay(res); display != "" {
		res.Display = display
	}

	return res, nil
}

func findCoordinates(root map[string]any) (*float64, *float64) {
	lat, _ := findFloat(root, "latitude", "lat", "location.latitude", "location.lat")
	lon, _ := findFloat(root, "longitude", "lon", "lng", "location.longitude", "location.lon")
	if lat != nil && lon != nil {
		return lat, lon
	}
	if loc := findString(root, "loc", "location.loc"); loc != "" {
		parts := strings.Split(loc, ",")
		if len(parts) >= 2 {
			if lat == nil {
				if v, err := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64); err == nil {
					lat = floatPtr(v)
				}
			}
			if lon == nil {
				if v, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64); err == nil {
					lon = floatPtr(v)
				}
			}
		}
	}
	return lat, lon
}

func findString(root map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := lookupValue(root, key); ok {
			switch v := value.(type) {
			case string:
				trimmed := strings.TrimSpace(v)
				if trimmed != "" {
					return trimmed
				}
			case json.Number:
				return strings.TrimSpace(v.String())
			case float64:
				if !math.IsNaN(v) && !math.IsInf(v, 0) {
					return strings.TrimSpace(strconv.FormatFloat(v, 'f', -1, 64))
				}
			case fmt.Stringer:
				s := strings.TrimSpace(v.String())
				if s != "" {
					return s
				}
			}
		}
	}
	return ""
}

func findFloat(root map[string]any, keys ...string) (*float64, bool) {
	for _, key := range keys {
		if value, ok := lookupValue(root, key); ok {
			switch v := value.(type) {
			case float64:
				if !math.IsNaN(v) && !math.IsInf(v, 0) {
					return floatPtr(v), true
				}
			case json.Number:
				if parsed, err := v.Float64(); err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0) {
					return floatPtr(parsed), true
				}
			case string:
				if parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0) {
					return floatPtr(parsed), true
				}
			}
		}
	}
	return nil, false
}

func lookupValue(root map[string]any, key string) (any, bool) {
	if root == nil {
		return nil, false
	}
	parts := strings.Split(key, ".")
	var current any = root
	for _, part := range parts {
		nextMap, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		if value, exists := nextMap[part]; exists {
			current = value
			continue
		}
		lowered := normaliseKey(part)
		matched := false
		for k, v := range nextMap {
			if normaliseKey(k) == lowered {
				current = v
				matched = true
				break
			}
		}
		if !matched {
			return nil, false
		}
	}
	return current, true
}

func normaliseKey(key string) string {
	return strings.ReplaceAll(strings.ReplaceAll(strings.ToLower(key), "-", ""), "_", "")
}

func floatPtr(v float64) *float64 {
	value := v
	return &value
}

func sanitizeASN(value string) string {
	value = strings.TrimSpace(strings.ToUpper(value))
	if !strings.HasPrefix(value, "AS") {
		return ""
	}
	digits := make([]rune, 0, len(value))
	for _, r := range value[2:] {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		} else {
			break
		}
	}
	if len(digits) == 0 {
		return ""
	}
	return "AS" + string(digits)
}

func extractASN(value string) string {
	fields := strings.Fields(strings.ToUpper(value))
	for _, field := range fields {
		if asn := sanitizeASN(field); asn != "" {
			return asn
		}
	}
	return ""
}

func buildDisplay(res *Result) string {
	if res == nil {
		return ""
	}
	var parts []string
	seen := map[string]struct{}{}
	add := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		key := strings.ToLower(trimmed)
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		parts = append(parts, trimmed)
	}
	add(res.City)
	add(res.Region)
	if res.Country != "" {
		add(res.Country)
	} else if res.CountryCode != "" {
		add(strings.ToUpper(res.CountryCode))
	} else if res.Continent != "" {
		add(res.Continent)
	}
	return strings.Join(parts, ", ")
}
