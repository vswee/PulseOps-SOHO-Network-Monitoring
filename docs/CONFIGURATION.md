# Configuration

PulseOps reads YAML or JSON config files. By default it loads `config.yml` from the working directory, or you can point to a different file with `-config`.

## Minimal example
```yaml
iperf:
  server: 127.0.0.1
  seconds: 5
  parallel: 1
  interval_minutes: 60

devices: []
```

## Device fields
Each entry in `devices` can include:
- `name` (required): Friendly display name.
- `host` (required): IP address or hostname.
- `kind` (required): router, switch, modem, printer, etc.
- `platform` (required): `openwrt`, `edgeos`, `netgear`, `huawei`, or `generic`.
- `user` (required for SSH-based features): SSH or API user.
- `password` (optional): required for platforms that use passwords (for example Huawei web API).
- `ssh_key` (optional): path to a private key file, or an exported `sshkey:<id>` reference from the UI.
- `meta` (optional): key/value metadata for SNMP and iPerf (see below).
- `connection` (optional): `wired` or `wireless` (also accepts `wifi`/`wi-fi`).
- `connection_override` (optional): set `true` to force the `connection` value.

## SNMP metadata
Add SNMP settings under `meta`:

```json
{
  "snmp_enabled": true,
  "snmp_host": "192.168.1.2",
  "snmp_community": "monitoring",
  "snmp_interval": "5m"
}
```

Supported keys include `snmp_enabled`, `snmp_host`/`snmp_target`, `snmp_port`, `snmp_community`, `snmp_version` (`1`, `2c`, or `3`), `snmp_timeout`, `snmp_retries`, `snmp_max_reps`, `snmp_max_oids`, and `snmp_interval`.

## iPerf settings
The top-level `iperf` block controls defaults for duration, parallel streams, and interval. The `server` field is currently unused and reserved for future external server support.

Per-device overrides can be supplied in `meta`:
- `iperf_enabled` (`true`/`false`)
- `iperf_interval` (duration string, for example `30m`)
- `iperf_seconds` or `iperf_duration` (seconds)
- `iperf_parallel` (integer)

## Secrets and data
- `PULSEOPS_KEY_SECRET` is required at runtime. Keep it stable; changing it will prevent previously stored SSH keys from being decrypted.
- Data is stored in the directory passed via `-data` (default `data/`). The SQLite database and encrypted SSH key materials live there.
