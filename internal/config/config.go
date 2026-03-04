package config

import (
	"os"
	"strings"
)

type Device struct {
	Name               string            `json:"name"`
	Host               string            `json:"host"`
	Kind               string            `json:"kind"`
	Platform           string            `json:"platform"`
	User               string            `json:"user"`
	Password           string            `json:"password,omitempty"`
	SSHKey             string            `json:"ssh_key,omitempty"`
	Meta               map[string]string `json:"meta,omitempty"`
	Schedule           map[string]string `json:"schedule,omitempty"`
	Connection         string            `json:"connection,omitempty"`
	ConnectionOverride bool              `json:"connection_override,omitempty"`
}

// DeviceTemplate defines a template for creating devices
type DeviceTemplate struct {
	ID               string                   `json:"id"`
	Name             string                   `json:"name"`
	Description      string                   `json:"description"`
	Kind             string                   `json:"kind"`
	Platform         string                   `json:"platform"`
	DefaultUser      string                   `json:"default_user"`
	RequiresSSH      bool                     `json:"requires_ssh"`
	RequiresPassword bool                     `json:"requires_password"`
	DefaultPorts     []int                    `json:"default_ports"`
	Fields           []DeviceTemplateField    `json:"fields"`
	Validation       DeviceTemplateValidation `json:"validation"`
}

// DeviceTemplateField defines a configurable field in a template
type DeviceTemplateField struct {
	Name        string   `json:"name"`
	Label       string   `json:"label"`
	Type        string   `json:"type"` // text, password, select, number, file
	Required    bool     `json:"required"`
	Default     string   `json:"default"`
	Options     []string `json:"options,omitempty"` // for select type
	Placeholder string   `json:"placeholder"`
	Help        string   `json:"help"`
}

// DeviceTemplateValidation defines validation rules for a template
type DeviceTemplateValidation struct {
	HostPattern   string   `json:"host_pattern,omitempty"`
	UserPattern   string   `json:"user_pattern,omitempty"`
	RequiredPorts []int    `json:"required_ports,omitempty"`
	TestCommands  []string `json:"test_commands,omitempty"`
}

type Config struct {
	Devices []Device `json:"devices"`
	Iperf   struct {
		Server          string `json:"server"`
		Seconds         int    `json:"seconds"`
		Parallel        int    `json:"parallel"`
		IntervalMinutes int    `json:"interval_minutes"`
	} `json:"iperf,omitempty"`
}

func Load(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(strings.ToLower(path), ".json") {
		return parseJSON(b)
	}
	return parseYAML(b)
}
