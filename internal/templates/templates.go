package templates

import (
	"github.com/pulseops/pulseops/internal/config"
)

// GetAllTemplates returns all available device templates
func GetAllTemplates() []config.DeviceTemplate {
	return []config.DeviceTemplate{
		getOpenWrtTemplate(),
		getEdgeOSTemplate(),
		getHuaweiTemplate(),
		getGenericRouterTemplate(),
		getGenericPrinterTemplate(),
		getGenericServerTemplate(),
		getUnifiTemplate(),
		getMikroTikTemplate(),
		getNetgearSwitchTemplate(),
		getHPMFCPrinterTemplate(),
		getIoTDeviceTemplate(),
		getAppleTVTemplate(),
		getFireTVTemplate(),
		getAndroidTVTemplate(),
		getNASDeviceTemplate(),
	}
}

// GetTemplateByID returns a template by its ID
func GetTemplateByID(id string) *config.DeviceTemplate {
	for _, template := range GetAllTemplates() {
		if template.ID == id {
			return &template
		}
	}
	return nil
}

// GetTemplatesByKind returns templates filtered by device kind
func GetTemplatesByKind(kind string) []config.DeviceTemplate {
	var result []config.DeviceTemplate
	for _, template := range GetAllTemplates() {
		if template.Kind == kind {
			result = append(result, template)
		}
	}
	return result
}

func getOpenWrtTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "openwrt",
		Name:             "OpenWrt Router",
		Description:      "OpenWrt-based router or access point",
		Kind:             "router",
		Platform:         "openwrt",
		DefaultUser:      "root",
		RequiresSSH:      true,
		RequiresPassword: true,
		DefaultPorts:     []int{22, 80, 443},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Device Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., main-router",
				Help:        "Unique name for this device",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.1",
				Help:        "IP address or hostname of the device",
			},
			{
				Name:     "user",
				Label:    "SSH Username",
				Type:     "text",
				Required: true,
				Default:  "root",
				Help:     "SSH username (usually 'root' for OpenWrt)",
			},
			{
				Name:        "ssh_key",
				Label:       "SSH Private Key Path",
				Type:        "file",
				Required:    true,
				Placeholder: "/path/to/id_rsa",
				Help:        "Path to SSH private key file",
			},
			{
				Name:        "ssh_port",
				Label:       "SSH Port",
				Type:        "number",
				Required:    false,
				Default:     "22",
				Placeholder: "22",
				Help:        "Defaults to 22; change if the device listens on a custom SSH port.",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{22},
			TestCommands:  []string{"uname -a", "cat /etc/openwrt_release"},
		},
	}
}

func getEdgeOSTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "edgeos",
		Name:             "EdgeOS Router",
		Description:      "Ubiquiti EdgeRouter running EdgeOS",
		Kind:             "router",
		Platform:         "edgeos",
		DefaultUser:      "ubnt",
		RequiresSSH:      true,
		RequiresPassword: true,
		DefaultPorts:     []int{22, 80, 443},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Device Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., edge-router",
				Help:        "Unique name for this device",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.1",
				Help:        "IP address or hostname of the device",
			},
			{
				Name:     "user",
				Label:    "SSH Username",
				Type:     "text",
				Required: true,
				Default:  "ubnt",
				Help:     "SSH username (usually 'ubnt' for EdgeOS)",
			},
			{
				Name:        "ssh_key",
				Label:       "SSH Private Key Path",
				Type:        "file",
				Required:    true,
				Placeholder: "/path/to/id_rsa",
				Help:        "Path to SSH private key file",
			},
			{
				Name:        "ssh_port",
				Label:       "SSH Port",
				Type:        "number",
				Required:    false,
				Default:     "22",
				Placeholder: "22",
				Help:        "Defaults to 22; change if the device listens on a custom SSH port.",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{22},
			TestCommands:  []string{"show version"},
		},
	}
}

func getHuaweiTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "huawei",
		Name:             "Huawei Modem",
		Description:      "Huawei mobile broadband modem",
		Kind:             "modem",
		Platform:         "huawei",
		DefaultUser:      "admin",
		RequiresSSH:      false,
		RequiresPassword: true,
		DefaultPorts:     []int{80, 8080},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Device Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., huawei-modem",
				Help:        "Unique name for this device",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Default:     "192.168.8.1",
				Placeholder: "192.168.8.1",
				Help:        "IP address of the modem (usually 192.168.8.1)",
			},
			{
				Name:     "user",
				Label:    "Username",
				Type:     "text",
				Required: true,
				Default:  "admin",
				Help:     "Web interface username",
			},
			{
				Name:     "password",
				Label:    "Password",
				Type:     "password",
				Required: true,
				Help:     "Web interface password",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{80},
		},
	}
}

func getGenericRouterTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "generic-router",
		Name:             "Generic Router",
		Description:      "Generic router or network device",
		Kind:             "router",
		Platform:         "generic",
		DefaultUser:      "admin",
		RequiresSSH:      false,
		RequiresPassword: false,
		DefaultPorts:     []int{80, 443},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Device Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., router-1",
				Help:        "Unique name for this device",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.1",
				Help:        "IP address or hostname of the device",
			},
			{
				Name:     "user",
				Label:    "Username (optional)",
				Type:     "text",
				Required: false,
				Help:     "Username if SSH access is available",
			},
			{
				Name:        "ssh_key",
				Label:       "SSH Private Key Path (optional)",
				Type:        "file",
				Required:    false,
				Placeholder: "/path/to/id_rsa",
				Help:        "Path to SSH private key file if SSH access is available",
			},
			{
				Name:        "ssh_port",
				Label:       "SSH Port",
				Type:        "number",
				Required:    false,
				Default:     "22",
				Placeholder: "22",
				Help:        "Defaults to 22; set a custom value if the device uses a non-standard SSH port.",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{80},
		},
	}
}

func getGenericPrinterTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "generic-printer",
		Name:             "Network Printer",
		Description:      "Network-connected printer",
		Kind:             "printer",
		Platform:         "generic",
		DefaultUser:      "",
		RequiresSSH:      false,
		RequiresPassword: false,
		DefaultPorts:     []int{80, 443, 515, 631, 9100},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Printer Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., office-printer",
				Help:        "Unique name for this printer",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.100",
				Help:        "IP address of the printer",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{9100}, // Raw printing port
		},
	}
}

func getGenericServerTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "generic-server",
		Name:             "Generic Server",
		Description:      "Linux/Unix server",
		Kind:             "server",
		Platform:         "generic",
		DefaultUser:      "root",
		RequiresSSH:      true,
		RequiresPassword: false,
		DefaultPorts:     []int{22, 80, 443},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Server Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., web-server",
				Help:        "Unique name for this server",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.10",
				Help:        "IP address or hostname of the server",
			},
			{
				Name:     "user",
				Label:    "SSH Username",
				Type:     "text",
				Required: true,
				Default:  "root",
				Help:     "SSH username",
			},
			{
				Name:        "ssh_key",
				Label:       "SSH Private Key Path",
				Type:        "file",
				Required:    true,
				Placeholder: "/path/to/id_rsa",
				Help:        "Path to SSH private key file",
			},
			{
				Name:        "ssh_port",
				Label:       "SSH Port",
				Type:        "number",
				Required:    false,
				Default:     "22",
				Placeholder: "22",
				Help:        "Defaults to 22; change if the server listens on a custom SSH port.",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{22},
			TestCommands:  []string{"uname -a", "uptime"},
		},
	}
}

func getUnifiTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "unifi",
		Name:             "UniFi Access Point",
		Description:      "Ubiquiti UniFi access point or switch",
		Kind:             "access_point",
		Platform:         "unifi",
		DefaultUser:      "ubnt",
		RequiresSSH:      true,
		RequiresPassword: false,
		DefaultPorts:     []int{22, 80, 443, 8080, 8443},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Device Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., unifi-ap-1",
				Help:        "Unique name for this device",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.20",
				Help:        "IP address of the UniFi device",
			},
			{
				Name:     "user",
				Label:    "SSH Username",
				Type:     "text",
				Required: true,
				Default:  "ubnt",
				Help:     "SSH username (usually 'ubnt' for UniFi)",
			},
			{
				Name:        "ssh_key",
				Label:       "SSH Private Key Path",
				Type:        "file",
				Required:    true,
				Placeholder: "/path/to/id_rsa",
				Help:        "Path to SSH private key file",
			},
			{
				Name:        "ssh_port",
				Label:       "SSH Port",
				Type:        "number",
				Required:    false,
				Default:     "22",
				Placeholder: "22",
				Help:        "Defaults to 22; change if the device listens on a custom SSH port.",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{22},
			TestCommands:  []string{"cat /etc/version"},
		},
	}
}

func getMikroTikTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "mikrotik",
		Name:             "MikroTik Router",
		Description:      "MikroTik RouterOS device",
		Kind:             "router",
		Platform:         "mikrotik",
		DefaultUser:      "admin",
		RequiresSSH:      true,
		RequiresPassword: false,
		DefaultPorts:     []int{22, 80, 443, 8291},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Device Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., mikrotik-router",
				Help:        "Unique name for this device",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.88.1",
				Help:        "IP address of the MikroTik device",
			},
			{
				Name:     "user",
				Label:    "SSH Username",
				Type:     "text",
				Required: true,
				Default:  "admin",
				Help:     "SSH username (usually 'admin' for MikroTik)",
			},
			{
				Name:        "ssh_key",
				Label:       "SSH Private Key Path",
				Type:        "file",
				Required:    true,
				Placeholder: "/path/to/id_rsa",
				Help:        "Path to SSH private key file",
			},
			{
				Name:        "ssh_port",
				Label:       "SSH Port",
				Type:        "number",
				Required:    false,
				Default:     "22",
				Placeholder: "22",
				Help:        "Defaults to 22; change if the device listens on a custom SSH port.",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{22},
			TestCommands:  []string{"/system resource print"},
		},
	}
}

func getNetgearSwitchTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "netgear-switch",
		Name:             "Netgear Switch",
		Description:      "Netgear managed switch",
		Kind:             "switch",
		Platform:         "netgear",
		DefaultUser:      "admin",
		RequiresSSH:      true,
		RequiresPassword: true,
		DefaultPorts:     []int{22, 80, 443},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Switch Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., netgear-switch-1",
				Help:        "Unique name for this switch",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.10",
				Help:        "IP address of the Netgear switch",
			},
			{
				Name:     "user",
				Label:    "SSH Username",
				Type:     "text",
				Required: true,
				Default:  "admin",
				Help:     "SSH username (usually 'admin' for Netgear)",
			},
			{
				Name:        "password",
				Label:       "Web UI Password",
				Type:        "password",
				Required:    false,
				Placeholder: "••••••••",
				Help:        "Stored securely and used when SSH is unavailable to perform actions like a web UI reboot.",
			},
			{
				Name:        "ssh_key",
				Label:       "SSH Private Key Path",
				Type:        "file",
				Required:    true,
				Placeholder: "/path/to/id_rsa",
				Help:        "Path to SSH private key file",
			},
			{
				Name:        "ssh_port",
				Label:       "SSH Port",
				Type:        "number",
				Required:    false,
				Default:     "22",
				Placeholder: "22",
				Help:        "Defaults to 22; change if the switch listens on a custom SSH port.",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{22},
			TestCommands:  []string{"show version", "show system"},
		},
	}
}

func getHPMFCPrinterTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "hp-mfc-printer",
		Name:             "HP MFC Printer",
		Description:      "HP Multi-Function Center printer",
		Kind:             "printer",
		Platform:         "hp",
		DefaultUser:      "",
		RequiresSSH:      false,
		RequiresPassword: false,
		DefaultPorts:     []int{80, 443, 515, 631, 9100, 9220},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Printer Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., hp-mfc-printer",
				Help:        "Unique name for this printer",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.100",
				Help:        "IP address of the HP MFC printer",
			},
			{
				Name:        "model",
				Label:       "Printer Model (optional)",
				Type:        "text",
				Required:    false,
				Placeholder: "e.g., HP LaserJet MFP M428fdw",
				Help:        "Specific model of the HP MFC printer for better identification",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{9100}, // Raw printing port
		},
	}
}

func getIoTDeviceTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "iot-device",
		Name:             "IoT Device",
		Description:      "Internet of Things device (smart bulbs, IP cameras, sensors)",
		Kind:             "iot",
		Platform:         "generic",
		DefaultUser:      "",
		RequiresSSH:      false,
		RequiresPassword: false,
		DefaultPorts:     []int{80, 443, 554, 8080},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Device Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., smart-bulb-1 or ip-camera-front",
				Help:        "Unique name for this IoT device",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.50",
				Help:        "IP address of the IoT device",
			},
			{
				Name:     "device_type",
				Label:    "Device Type",
				Type:     "select",
				Required: true,
				Options:  []string{"smart_bulb", "ip_camera", "sensor", "smart_switch", "smart_plug", "other"},
				Help:     "Type of IoT device for better categorization",
			},
			{
				Name:        "manufacturer",
				Label:       "Manufacturer (optional)",
				Type:        "text",
				Required:    false,
				Placeholder: "e.g., Philips, TP-Link, Hikvision",
				Help:        "Device manufacturer for identification",
			},
			{
				Name:        "web_port",
				Label:       "Web Interface Port (optional)",
				Type:        "number",
				Required:    false,
				Default:     "80",
				Placeholder: "80",
				Help:        "Port for web interface if different from default",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{80},
		},
	}
}

func getAppleTVTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "apple-tv",
		Name:             "Apple TV",
		Description:      "Apple TV streaming device",
		Kind:             "streaming_device",
		Platform:         "apple",
		DefaultUser:      "",
		RequiresSSH:      false,
		RequiresPassword: false,
		DefaultPorts:     []int{80, 443, 3689, 5000, 7000, 7001},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Apple TV Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., living-room-apple-tv",
				Help:        "Unique name for this Apple TV",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.150",
				Help:        "IP address of the Apple TV",
			},
			{
				Name:     "generation",
				Label:    "Apple TV Generation",
				Type:     "select",
				Required: false,
				Options:  []string{"Apple TV 4K (3rd gen)", "Apple TV 4K (2nd gen)", "Apple TV 4K (1st gen)", "Apple TV HD", "Apple TV (3rd gen)", "Other"},
				Help:     "Apple TV generation for better identification",
			},
			{
				Name:     "airplay_enabled",
				Label:    "AirPlay Enabled",
				Type:     "select",
				Required: false,
				Options:  []string{"yes", "no", "unknown"},
				Default:  "yes",
				Help:     "Whether AirPlay is enabled on this device",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{7000}, // AirPlay port
		},
	}
}

func getFireTVTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "fire-tv",
		Name:             "Amazon Fire TV",
		Description:      "Amazon Fire TV streaming device",
		Kind:             "streaming_device",
		Platform:         "amazon",
		DefaultUser:      "",
		RequiresSSH:      false,
		RequiresPassword: false,
		DefaultPorts:     []int{80, 443, 5555, 8008, 8009},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Fire TV Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., bedroom-fire-tv",
				Help:        "Unique name for this Fire TV device",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.160",
				Help:        "IP address of the Fire TV device",
			},
			{
				Name:     "device_model",
				Label:    "Fire TV Model",
				Type:     "select",
				Required: false,
				Options:  []string{"Fire TV Stick 4K Max", "Fire TV Stick 4K", "Fire TV Stick", "Fire TV Cube", "Fire TV (3rd gen)", "Other"},
				Help:     "Fire TV model for better identification",
			},
			{
				Name:     "adb_enabled",
				Label:    "ADB Debugging Enabled",
				Type:     "select",
				Required: false,
				Options:  []string{"yes", "no", "unknown"},
				Default:  "no",
				Help:     "Whether ADB debugging is enabled (required for advanced management)",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{80},
		},
	}
}

func getAndroidTVTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "android-tv",
		Name:             "Android TV",
		Description:      "Android TV streaming device or smart TV",
		Kind:             "streaming_device",
		Platform:         "android",
		DefaultUser:      "",
		RequiresSSH:      false,
		RequiresPassword: false,
		DefaultPorts:     []int{80, 443, 5555, 8008, 8009},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "Android TV Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., sony-android-tv",
				Help:        "Unique name for this Android TV device",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.170",
				Help:        "IP address of the Android TV device",
			},
			{
				Name:     "manufacturer",
				Label:    "Manufacturer",
				Type:     "select",
				Required: false,
				Options:  []string{"Sony", "TCL", "Hisense", "Philips", "Sharp", "Xiaomi", "NVIDIA Shield", "Other"},
				Help:     "Manufacturer of the Android TV device",
			},
			{
				Name:     "adb_enabled",
				Label:    "ADB Debugging Enabled",
				Type:     "select",
				Required: false,
				Options:  []string{"yes", "no", "unknown"},
				Default:  "no",
				Help:     "Whether ADB debugging is enabled (required for advanced management)",
			},
			{
				Name:     "chromecast_enabled",
				Label:    "Chromecast Built-in",
				Type:     "select",
				Required: false,
				Options:  []string{"yes", "no", "unknown"},
				Default:  "yes",
				Help:     "Whether Chromecast built-in is available",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{80},
		},
	}
}

func getNASDeviceTemplate() config.DeviceTemplate {
	return config.DeviceTemplate{
		ID:               "nas-device",
		Name:             "NAS Device",
		Description:      "Network Attached Storage device",
		Kind:             "storage",
		Platform:         "generic",
		DefaultUser:      "admin",
		RequiresSSH:      true,
		RequiresPassword: false,
		DefaultPorts:     []int{22, 80, 443, 139, 445, 548, 2049, 5000, 5001},
		Fields: []config.DeviceTemplateField{
			{
				Name:        "name",
				Label:       "NAS Device Name",
				Type:        "text",
				Required:    true,
				Placeholder: "e.g., synology-nas or qnap-storage",
				Help:        "Unique name for this NAS device",
			},
			{
				Name:        "host",
				Label:       "IP Address",
				Type:        "text",
				Required:    true,
				Placeholder: "192.168.1.200",
				Help:        "IP address of the NAS device",
			},
			{
				Name:     "manufacturer",
				Label:    "Manufacturer",
				Type:     "select",
				Required: false,
				Options:  []string{"Synology", "QNAP", "Drobo", "ASUSTOR", "TerraMaster", "Buffalo", "Western Digital", "Seagate", "Other"},
				Help:     "NAS device manufacturer",
			},
			{
				Name:     "user",
				Label:    "SSH Username",
				Type:     "text",
				Required: true,
				Default:  "admin",
				Help:     "SSH username (usually 'admin' or 'root')",
			},
			{
				Name:        "ssh_key",
				Label:       "SSH Private Key Path",
				Type:        "file",
				Required:    true,
				Placeholder: "/path/to/id_rsa",
				Help:        "Path to SSH private key file",
			},
			{
				Name:        "ssh_port",
				Label:       "SSH Port",
				Type:        "number",
				Required:    false,
				Default:     "22",
				Placeholder: "22",
				Help:        "SSH port (default: 22)",
			},
			{
				Name:        "web_port",
				Label:       "Web Interface Port",
				Type:        "number",
				Required:    false,
				Default:     "5000",
				Placeholder: "5000",
				Help:        "Web interface port (varies by manufacturer)",
			},
		},
		Validation: config.DeviceTemplateValidation{
			RequiredPorts: []int{22, 80},
			TestCommands:  []string{"uname -a", "df -h"},
		},
	}
}
