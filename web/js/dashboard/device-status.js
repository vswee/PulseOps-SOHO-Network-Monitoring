(function (window) {
  'use strict';

  const PulseOps = window.PulseOps = window.PulseOps || {};

  const STATUS_LABELS = {
    online: { label: 'Online', className: 'status-online' },
    offline: { label: 'Offline', className: 'status-offline' },
    unreachable: { label: 'Unreachable', className: 'status-unreachable' },
    warning: { label: 'Needs attention', className: 'status-warning' },
    unknown: { label: 'Unknown', className: 'status-unknown' },
    loading: { label: 'Checking…', className: 'status-unknown' }
  };

  const PING_ONLINE_THRESHOLD_MS = 90 * 1000;
  const PING_UNREACHABLE_THRESHOLD_MS = 5 * 60 * 1000;
  const STATUS_CACHE_TTL_MS = 15 * 1000;
  const REFRESH_INTERVAL_MS = 30 * 1000;

  const statusCache = new Map();
  const pendingFetches = new Map();
  let sharedRef = null;

  function ensureShared() {
    if (!sharedRef) {
      const shared = PulseOps.shared;
      sharedRef = shared && typeof shared.ensureReady === 'function' ? shared.ensureReady() : shared;
    }
    return sharedRef;
  }

  function normaliseStatus(value) {
    return (value || '').toString().trim().toLowerCase();
  }

  function formatStatusLabel(status) {
    const norm = normaliseStatus(status);
    if (!norm) { return 'Unknown'; }
    return norm.replace(/[_\s]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatAge(ageMs) {
    if (ageMs == null) { return 'unknown'; }
    const seconds = Math.max(0, Math.round(ageMs / 1000));
    if (seconds < 60) { return `${seconds}s`; }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) { return `${minutes}m`; }
    const hours = Math.round(minutes / 60);
    if (hours < 48) { return `${hours}h`; }
    const days = Math.round(hours / 24);
    return `${days}d`;
  }

  function toTimestamp(value) {
    if (value == null) { return null; }
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) { return null; }
      return value > 1e12 ? value : (value > 0 ? value * 1000 : null);
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  function resolveDeviceCreatedAt(device) {
    if (!device) { return null; }
    const fields = ['created_at', 'createdAt', 'created'];
    for (let i = 0; i < fields.length; i += 1) {
      const ts = toTimestamp(device[fields[i]]);
      if (ts != null) {
        return ts;
      }
    }
    const meta = device.meta && typeof device.meta === 'object'
      ? device.meta
      : (typeof device.meta === 'string' ? safeParseJSON(device.meta) : null);
    if (meta) {
      const metaCandidates = [meta.created_at, meta.createdAt, meta.created];
      for (let i = 0; i < metaCandidates.length; i += 1) {
        const ts = toTimestamp(metaCandidates[i]);
        if (ts != null) {
          return ts;
        }
      }
    }
    return null;
  }

  function safeParseJSON(value) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }

  function normaliseNumeric(value) {
    if (value == null) { return null; }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'object') {
      if (value === null) { return null; }
      if (typeof value.value === 'number' && Number.isFinite(value.value)) { return value.value; }
      if (typeof value.Float64 === 'number' && Number.isFinite(value.Float64)) { return value.Float64; }
      if (typeof value.Int64 === 'number' && Number.isFinite(value.Int64)) { return value.Int64; }
      if (typeof value.String === 'string') {
        const parsed = Number(value.String);
        return Number.isFinite(parsed) ? parsed : null;
      }
    }
    return null;
  }

  function getStatusInfo(status, overrideLabel) {
    const key = normaliseStatus(status);
    const base = STATUS_LABELS[key] || STATUS_LABELS.unknown;
    return {
      status: key || 'unknown',
      label: overrideLabel || base.label,
      className: base.className
    };
  }

  function createBadge(status = 'unknown', options = {}) {
    const info = getStatusInfo(status, options.label);
    const badge = document.createElement('span');
    badge.className = `device-card-status ${info.className}`;
    badge.dataset.status = info.status;
    const dot = document.createElement('span');
    dot.className = 'device-card-status-dot';
    dot.setAttribute('aria-hidden', 'true');
    const labelEl = document.createElement('span');
    labelEl.className = 'device-card-status-label';
    labelEl.textContent = info.label;
    badge.append(dot, labelEl);
    return badge;
  }

  function updateBadge(badge, status, options = {}) {
    if (!badge) { return getStatusInfo(status, options.label); }
    const info = getStatusInfo(status, options.label);
    badge.className = `device-card-status ${info.className}`;
    badge.dataset.status = info.status;
    let dot = badge.querySelector('.device-card-status-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'device-card-status-dot';
      dot.setAttribute('aria-hidden', 'true');
      badge.prepend(dot);
    }
    let labelEl = badge.querySelector('.device-card-status-label');
    if (!labelEl) {
      labelEl = document.createElement('span');
      labelEl.className = 'device-card-status-label';
      badge.appendChild(labelEl);
    }
    labelEl.textContent = info.label;
    return info;
  }

  function computeStatus(device, ping, now = Date.now()) {
    const deviceCreatedAt = resolveDeviceCreatedAt(device);
    const deviceAgeMs = deviceCreatedAt != null ? Math.max(0, now - deviceCreatedAt) : null;
    const fallbackStatus = normaliseStatus(device?.status);

    if (!ping || ping.timestampMs == null) {
      const status = fallbackStatus || (deviceAgeMs != null && deviceAgeMs > PING_UNREACHABLE_THRESHOLD_MS ? 'unreachable' : 'unknown');
      return {
        status,
        pingTimestampMs: null,
        pingValue: null,
        pingAgeMs: null,
        deviceCreatedAt,
        deviceAgeMs
      };
    }

    const pingAgeMs = Math.max(0, now - ping.timestampMs);
    const pingValue = normaliseNumeric(ping.value);
    let status = 'unknown';

    if (pingAgeMs <= PING_ONLINE_THRESHOLD_MS) {
      if (Number.isFinite(pingValue) && pingValue >= 0) {
        status = pingValue < 1000 ? 'online' : 'offline';
      } else {
        status = fallbackStatus || 'unknown';
      }
    } else {
      const oldEnough = deviceAgeMs != null && deviceAgeMs > PING_UNREACHABLE_THRESHOLD_MS;
      status = oldEnough ? 'unreachable' : 'offline';
    }

    return {
      status,
      pingTimestampMs: ping.timestampMs,
      pingValue,
      pingAgeMs,
      deviceCreatedAt,
      deviceAgeMs
    };
  }

  async function fetchLatestPingMetric(deviceId) {
    const shared = ensureShared();
    if (!shared?.utils?.jsonFetch || !deviceId) {
      return null;
    }
    const params = new URLSearchParams({
      device_id: String(deviceId),
      metric: 'ping_ms'
    });
    const url = `/api/metrics/latest?${params.toString()}`;
    try {
      const payload = await shared.utils.jsonFetch(url);
      if (!payload) {
        return null;
      }
      const tsValue = payload.ts ?? payload.timestamp ?? payload.time ?? null;
      const timestampMs = toTimestamp(tsValue);
      const value = normaliseNumeric(payload.value ?? payload.last ?? payload.latest);
      let unit = payload.unit;
      if (unit && typeof unit === 'object' && typeof unit.String === 'string') {
        unit = unit.String;
      }
      return {
        timestampMs,
        timestampIso: timestampMs != null ? new Date(timestampMs).toISOString() : null,
        value,
        unit: typeof unit === 'string' ? unit : 'ms',
        source: 'api',
        raw: payload
      };
    } catch (error) {
      console.warn('[DeviceStatus] Failed to fetch ping metric', { deviceId, error });
      return null;
    }
  }

  function buildResult(device, computation, ping, now, meta = {}) {
    const info = getStatusInfo(computation.status);
    return {
      deviceId: device?.id ?? null,
      status: computation.status,
      info,
      label: info.label,
      className: info.className,
      pingTimestampMs: computation.pingTimestampMs ?? null,
      pingTimestamp: computation.pingTimestampMs != null ? new Date(computation.pingTimestampMs).toISOString() : null,
      pingValue: computation.pingValue,
      pingAgeMs: computation.pingAgeMs,
      deviceCreatedAt: computation.deviceCreatedAt,
      deviceAgeMs: computation.deviceAgeMs,
      fetchedAt: now,
      source: ping?.source || meta.source || 'cache',
      fromCache: Boolean(meta.fromCache),
      rawPing: ping?.raw ?? null
    };
  }

  function formatStatusTooltip(result) {
    if (!result) { return 'Status unavailable'; }
    const parts = [];
    const label = result.label || getStatusInfo(result.status).label;
    if (label) { parts.push(label); }
    if (Number.isFinite(result.pingValue)) {
      const value = result.pingValue >= 100 ? result.pingValue.toFixed(0) : result.pingValue.toFixed(1);
      parts.push(`Ping ${value} ms`);
    }
    if (typeof result.pingAgeMs === 'number') {
      parts.push(`${formatAge(result.pingAgeMs)} ago`);
    }
    return parts.join(' • ') || 'Status unavailable';
  }

  async function getStatus(device, options = {}) {
    const id = device?.id;
    const now = Date.now();
    if (id == null) {
      const computation = computeStatus(device, null, now);
      return buildResult(device, computation, null, now);
    }

    const forceRefresh = Boolean(options.forceRefresh);
    const cached = statusCache.get(id);
    if (!forceRefresh && cached && (now - cached.fetchedAt) < STATUS_CACHE_TTL_MS) {
      return { ...cached, fromCache: true };
    }

    if (!forceRefresh && pendingFetches.has(id)) {
      return pendingFetches.get(id);
    }

    const promise = (async () => {
      const start = Date.now();
      const ping = await fetchLatestPingMetric(id);
      const computation = computeStatus(device, ping, Date.now());
      const result = buildResult(device, computation, ping, Date.now(), { fromCache: false, source: ping?.source || 'api' });
      statusCache.set(id, result);
      const duration = Date.now() - start;
      if (duration > 1000 && options.debug) {
        console.debug('[DeviceStatus] Status fetch duration', { deviceId: id, duration });
      }
      return result;
    })();

    pendingFetches.set(id, promise);
    try {
      return await promise;
    } finally {
      pendingFetches.delete(id);
    }
  }

  function clearCache(deviceId) {
    if (deviceId == null) {
      statusCache.clear();
      return;
    }
    statusCache.delete(deviceId);
  }

  const api = {
    STATUS_LABELS,
    PING_ONLINE_THRESHOLD_MS,
    PING_UNREACHABLE_THRESHOLD_MS,
    STATUS_CACHE_TTL_MS,
    REFRESH_INTERVAL_MS,
    getStatus,
    computeStatus,
    createBadge,
    updateBadge,
    getStatusInfo,
    formatStatus: formatStatusLabel,
    formatStatusTooltip,
    formatAge,
    clearCache
  };

  PulseOps.deviceStatus = api;
})(window);
