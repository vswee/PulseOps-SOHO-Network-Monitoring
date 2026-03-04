# Getting Started

## Requirements
- Docker + Docker Compose (recommended), or Go 1.24+ for native builds
- Optional: an iperf3 server if you want bandwidth tests (the Docker stack includes one)

## Quick start (Docker)
```bash
cp config.sample.yml config.yml
cp .env.example .env
# edit .env and set PULSEOPS_KEY_SECRET to a strong, stable secret

docker compose up --build -d
```

Then open `http://localhost:8765`. You will be redirected to `/setup` on first run to create the admin account.

### Optional: Prometheus + Grafana
```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up --build -d
```

## Native run
```bash
cp config.sample.yml config.yml
export PULSEOPS_KEY_SECRET=your-strong-secret

go build -o pulseops ./cmd/pulseops
./pulseops -config config.yml -data data -addr :8765
```

Open `http://localhost:8765` and complete `/setup`.

## Next steps
- Add devices in `config.yml`, or import them from the Devices page in the web UI.
- For SNMP devices, see docs/CONFIGURATION.md.
- If anything looks off, see docs/TROUBLESHOOTING.md.
