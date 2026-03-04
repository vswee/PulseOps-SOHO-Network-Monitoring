# PulseOps
Network telemetry and task runner with a web UI for small/office networks.

## Quick start (Docker)
```bash
cp config.sample.yml config.yml
cp .env.example .env
# edit .env and set PULSEOPS_KEY_SECRET to a strong, stable secret

docker compose up --build -d
# visit http://localhost:8765
```

First-time setup happens in the browser at `http://localhost:8765/setup`, where you create the admin account.

Optional Prometheus/Grafana stack:
```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up --build -d
```

## Native
Requirements: Go 1.24+.

```bash
cp config.sample.yml config.yml
export PULSEOPS_KEY_SECRET=your-strong-secret

go build -o pulseops ./cmd/pulseops
./pulseops -config config.yml -data data -addr :8765
```

## Defaults
- Web UI + API: `http://localhost:8765`
- Config path: `config.yml` (Docker uses `/etc/pulseops/config.yml`)
- Data directory: `data/` (Docker uses `/var/lib/pulseops`)

## Documentation
- docs/GETTING_STARTED.md
- docs/CONFIGURATION.md
- docs/TROUBLESHOOTING.md
- DEBUG_MODE.md
- KEY_MANAGER_IMPLEMENTATION.md
- METRIC_HIDING_IMPLEMENTATION.md
- web/TAB_SYSTEM_README.md

## API
- GET  /api/devices
- POST /api/devices/import *(import devices from exported JSON)*
- GET  /api/export/devices *(download all devices as JSON)*
- GET  /api/device-backups?device_id=ID *(list captured backups for a device)*
- POST /api/device-backups *(trigger a new device backup)*
- GET  /api/device-backups/ID *(download a specific backup)*
- GET  /api/metrics/latest?device_id=ID&metric=ping_ms
- GET  /api/metrics?device_id=ID&metric=ping_ms&since=RFC3339&limit=500
- GET  /api/tasks?device_id=ID
- POST /api/tasks {"device_id":ID,"kind":"reboot|refresh_firewall|refresh_wireless","args":"","by":"web"}
- POST /api/devices/ID/reprovision *(re-run iPerf provisioning for a managed device)*

## SNMP telemetry

PulseOps can poll SNMP-capable devices to capture uptime, CPU, memory usage, and interface counters even when SSH access is not available.

1. Enable SNMP for a device by adding metadata when importing or editing via JSON:

   ```json
   {
     "name": "core-switch",
     "host": "192.168.1.2",
     "kind": "switch",
     "platform": "generic",
     "meta": {
       "snmp_enabled": true,
       "snmp_host": "192.168.1.2",
       "snmp_community": "monitoring",
       "snmp_interval": "5m"
     }
   }
   ```

   Supported keys include `snmp_enabled`, `snmp_host`/`snmp_target`, `snmp_port`, `snmp_community`, `snmp_version` (`1`, `2c`, or `3`), `snmp_timeout`, `snmp_retries`, `snmp_max_reps`, `snmp_max_oids`, and `snmp_interval`.

2. The scheduler stores SNMP-derived metrics under the existing names used by SSH metrics (`uptime_seconds`, `cpu_usage_percent`, `memory_used_percent`, and `interface_stats`), so the web dashboard automatically renders the data.

3. If both SSH and SNMP are configured, SNMP collections run alongside the SSH system metrics at the configured interval.

## Device import & backups

PulseOps can import devices from the same JSON document it produces via **Export → Devices** in the web UI.
Use the **Import** action in the Devices table or POST to `/api/devices/import` with a JSON array of device objects (or a `{ "devices": [...] }` wrapper).

For device platforms that support programmatic configuration backups (for example OpenWRT and EdgeOS), PulseOps can trigger, store, and download backup archives.
Backups are available from the device overview screen in the web UI or through the `/api/device-backups` endpoints listed above.
The latest backup timestamp and download link are displayed on the overview page, and older backups can be downloaded from the backup history modal.

## iPerf provisioning

PulseOps attempts to keep `iperf3` available on devices where bandwidth testing is enabled. During scheduled collections the backend will check for the `iperf3` binary and install it automatically on supported platforms:

- OpenWrt (via `opkg`)
- Debian/Ubuntu derivatives (via `apt-get`/`apt`)
- RHEL/CentOS/Fedora/Amazon/Oracle derivatives (via `dnf` or `yum`)
- Alpine Linux (via `apk`)
- Arch/Manjaro (via `pacman`)

If an install fails or credentials change, you can manually re-run provisioning from the **Devices** table or the edit drawer using the *Reprovision Device* button, or call `POST /api/devices/{id}/reprovision` directly. Outcomes are written to the device activity log.

## Huawei
Set `platform: huawei` with `user` and `password`. The driver logs in via web API, then attempts reboot across several known endpoints.
