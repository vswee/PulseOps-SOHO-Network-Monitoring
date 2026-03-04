# PulseOps Debug Mode

## Enabling Debug Mode

To enable debug logging throughout the application, add `?debug=1` to the URL:

```
http://localhost:3000/overview.html?debug=1
http://localhost:3000/logs.html?debug=1
http://localhost:3000/devices.html?debug=1
http://localhost:3000/keys.html?debug=1
http://localhost:3000/settings.html?debug=1
http://localhost:3000/map.html?debug=1
http://localhost:3000/insights.html?debug=1
```

## What Gets Logged

When debug mode is enabled, the following information is logged to the browser console:

### Main Application (main.js)
- Dashboard initialization start/completion
- Shared services setup
- Authentication refresh
- Route resolution
- View controller initialization
- Ready callback processing

### View Controllers
Each view logs:
- Controller initialization
- Element binding
- Data loading start/completion
- API calls and responses
- Error conditions with fallback data

### Shared Services (shared.js)
- Debug utilities available via `PulseOps.shared.utils.debugLog()`

## Log Format

All debug logs follow this format:
```
[ISO_TIMESTAMP] [MODULE_NAME] message data
```

Example:
```
[2024-10-22T14:30:45.123Z] [LOGS] loadLogs() started
[2024-10-22T14:30:45.124Z] [LOGS] Fetching logs from API {url: "/api/logs?limit=200"}
[2024-10-22T14:30:45.456Z] [LOGS] Logs fetched successfully {count: 15}
```

## Module Names

- `[MAIN]` - Main dashboard initialization
- `[LOGS]` - Activity Logs view
- `[DEVICES]` - Devices management view
- `[KEYS]` - SSH Keys view
- `[SETTINGS]` - Settings view
- `[MAP]` - Network Map view
- `[Insights]` - Device Insights view

## Troubleshooting

### Views Show Empty Content

1. Open browser DevTools (F12)
2. Go to Console tab
3. Add `?debug=1` to the URL and reload
4. Look for error messages or failed API calls
5. Check if data is being loaded (look for "loaded successfully" messages)

### API Endpoints Not Responding

Debug logs will show which API endpoints are being called and if they fail:
```
[LOGS] Fetching logs from API {url: "/api/logs?limit=200"}
[LOGS] Failed to load logs from API {error: "Request failed with status 404"}
```

### Device Data Not Populating

Check the device store loading:
```
[DEVICES] Loading devices store...
[DEVICES] Devices loaded, rendering table
```

If devices aren't loading, the API endpoint `/api/devices` may be unavailable.

## Performance Monitoring

Debug logs include timing information. Look for patterns like:
```
[LOGS] loadLogs() started
... (API call happens here)
[LOGS] loadLogs() completed {entryCount: 15}
```

This helps identify slow API endpoints or rendering issues.

## Disabling Debug Mode

Simply remove `?debug=1` from the URL or reload without it.

