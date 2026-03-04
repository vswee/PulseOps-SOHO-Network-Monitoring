# Troubleshooting

## "encryption secret is required"
`PULSEOPS_KEY_SECRET` must be set before starting PulseOps. Set it in your shell or in `.env` for Docker Compose.

## "load config" or "no such file" errors
Confirm `config.yml` exists and is readable, or pass the correct path with `-config`.

## Port 8765 already in use
Start PulseOps on a different port:
- Native: `./pulseops -addr :8877`
- Docker: change the left side of the port mapping in `docker-compose.yml` (for example `8877:8765`).

## Web UI not loading
- Ensure the process is running and listening on the expected port.
- Check logs: `docker compose logs -f pulseops` or the stdout from the native process.

## No devices showing
- Add devices to `config.yml` or import from the Devices page.
- Confirm `devices` entries include `name`, `host`, `kind`, and `platform`.

## SSH/iPerf errors
- Make sure the device is reachable and allows SSH for the configured user.
- If using a key path, verify the key file exists and permissions are correct.
- Use the **Keys** page to upload keys and reference them from the UI.

## SNMP metrics missing
- Confirm SNMP is enabled for the device and the community/credentials are correct.
- Check that UDP 161 is reachable from the PulseOps host.

## Backup failures
Only some platforms support automated backups (for example OpenWRT and EdgeOS). Verify platform compatibility and credentials.

## Need more logs
Append `?debug=1` to any dashboard URL and see DEBUG_MODE.md for details.
