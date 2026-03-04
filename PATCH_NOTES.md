# PulseOps: Charts, Exports, Backups, and Prometheus
This patch adds:
- Inline latency charts on the web UI
- `/api/export/devices` and `/api/export/metrics` (CSV/JSON)
- `/api/backup?days=30` zip export including config, devices, and metrics (NDJSON)
- `/metrics` endpoint in Prometheus text format
- Optional `docker-compose.override.yml` with Prometheus + Grafana wired to PulseOps

## Quick start
```bash
# merge these files into your tree (paths preserved)
cp -R pulseops_audit_build/* /path/to/your/pulseops/

# rebuild
docker compose up --build -d

# UI: http://localhost:8765
# Prometheus: http://localhost:9090
# Grafana: http://localhost:3000 (admin/admin)
```

## API
- `GET /api/export/devices?format=csv|json`
- `GET /api/export/metrics?device_id=ID&metric=ping_ms&since=RFC3339&limit=10000&format=csv|json`
- `GET /api/backup?days=30` -> zip download
- `GET /metrics` -> Prometheus text format

## Notes
- Charts use a tiny canvas renderer; no external libs required.
- Prometheus endpoint emits `pulseops_ping_ms` and `pulseops_iperf_mbps` per device using latest sample.
- For historical charts in Grafana, wire Grafana to Prometheus (included) or InfluxDB if you add remote write.
