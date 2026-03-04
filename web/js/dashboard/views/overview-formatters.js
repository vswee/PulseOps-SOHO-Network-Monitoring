(function (window) {
  'use strict';

  const PulseOps = window.PulseOps = window.PulseOps || {};
  const views = PulseOps.views = PulseOps.views || {};

  const METRIC_LABELS = {
    ping_ms: 'Ping',
    iperf_mbps: 'Bandwidth',
    cpu_usage: 'CPU',
    cpu_usage_percent: 'CPU Usage',
    memory_usage: 'Memory',
    memory_used_percent: 'Memory Usage',
    temperature: 'Temperature',
    cpu_load: 'CPU Load',
    bandwidth_mbps: 'Bandwidth',
    bandwidth: 'Bandwidth',
    uptime_seconds: 'Uptime',
    system_uptime: 'System Uptime',
    latency_ms: 'Latency'
  };

  const METRIC_UNITS = {
    ping_ms: 'ms',
    iperf_mbps: 'Mbps',
    cpu_usage: '%',
    cpu_usage_percent: '%',
    memory_usage: '%',
    memory_used_percent: '%',
    temperature: '°C',
    cpu_load: '',
    bandwidth_mbps: 'Mbps',
    bandwidth: 'Mbps',
    uptime_seconds: 's',
    system_uptime: 's',
    latency_ms: 'ms'
  };

  function normalise(value) {
    return (value || '').toString().trim().toLowerCase();
  }

  function normaliseKindValue(value) {
    return (value || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }

  function resolveKindKey(value) {
    const norm = normaliseKindValue(value);
    if (!norm) { return ''; }
    const kindMap = { router: 'router', switch: 'switch', firewall: 'firewall', server: 'server', workstation: 'workstation' };
    return kindMap[norm] || norm;
  }

  function formatKindLabel(value) {
    if (!value) { return 'Device'; }
    return value.toString().replace(/[_\s]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatKind(value) {
    const norm = normalise(value);
    if (!norm) { return 'Device'; }
    return norm.replace(/[_\s]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatRelativeTime(value) {
    if (!value) { return ''; }
    const date = value instanceof Date ? value : new Date(value);
    const timestamp = date.getTime();
    if (!Number.isFinite(timestamp)) { return ''; }
    const diff = Date.now() - timestamp;
    const absDiff = Math.abs(diff);
    if (absDiff < 30 * 1000) {
      return 'just now';
    }
    const minutes = Math.round(absDiff / 60000);
    if (minutes < 60) {
      return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours} hr${hours === 1 ? '' : 's'} ago`;
    }
    const days = Math.round(hours / 24);
    if (days < 7) {
      return `${days} day${days === 1 ? '' : 's'} ago`;
    }
    const weeks = Math.round(days / 7);
    if (weeks < 6) {
      return `${weeks} wk${weeks === 1 ? '' : 's'} ago`;
    }
    const months = Math.round(days / 30);
    if (months < 12) {
      return `${months} mo${months === 1 ? '' : 's'} ago`;
    }
    const years = Math.round(days / 365);
    return `${years} yr${years === 1 ? '' : 's'} ago`;
  }

  function formatUptimeLong(totalSeconds) {
    const n = Number(totalSeconds);
    if (!Number.isFinite(n) || n <= 0) { return '—'; }
    let s = Math.floor(n);

    const MINUTE = 60;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const MONTH = 30 * DAY;
    const YEAR = 365 * DAY;

    const years = Math.floor(s / YEAR); s -= years * YEAR;
    const months = Math.floor(s / MONTH); s -= months * MONTH;
    const days = Math.floor(s / DAY); s -= days * DAY;
    const hours = Math.floor(s / HOUR); s -= hours * HOUR;
    const minutes = Math.floor(s / MINUTE);

    const parts = [];
    if (years)  { parts.push(`${years}y${years === 1 ? '' : ''}`); }
    if (months) { parts.push(`${months}m${months === 1 ? '' : ''}`); }
    if (days)   { parts.push(`${days}d${days === 1 ? '' : ''}`); }
    if (hours)  { parts.push(`${hours}h${hours === 1 ? '' : ''}`); }
    if (minutes || parts.length === 0) { parts.push(`${minutes}min${minutes === 1 ? '' : 's'}`); }

    return parts.join(' ');
  }

  function getMetricUnit(metricType) {
    return METRIC_UNITS[metricType] || '';
  }

  function getMetricLabel(metricType) {
    return METRIC_LABELS[metricType] || formatKind(metricType);
  }

  function resolveNumericValue(value) {
    if (value == null) { return null; }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'object') {
      if (!value) { return null; }
      if (typeof value.value === 'number' && Number.isFinite(value.value)) { return value.value; }
      if (typeof value.Float64 === 'number' && Number.isFinite(value.Float64)) { return value.Float64; }
      if (typeof value.Int64 === 'number' && Number.isFinite(value.Int64)) { return value.Int64; }
      if (typeof value.String === 'string') {
        const parsed = parseFloat(value.String);
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (value.Valid && typeof value.Float64 === 'number' && Number.isFinite(value.Float64)) {
        return value.Float64;
      }
    }
    return null;
  }

  function extractUptimeSeconds(summary, meta = {}) {
    const sources = [
      summary?.metrics?.uptime_seconds?.value,
      summary?.metrics?.uptime?.value,
      summary?.metrics?.system_uptime?.value,
      summary?.metrics?.uptime_seconds,
      meta?.uptime_seconds,
      meta?.uptime,
      meta?.system?.uptime_seconds,
      meta?.system?.uptime,
      meta?.runtime?.uptime_seconds,
      meta?.runtime?.uptime
    ];
    for (const source of sources) {
      const numeric = resolveNumericValue(source);
      if (numeric != null && numeric >= 0) {
        return numeric;
      }
    }
    return null;
  }

  function resolveBackupDetails(device, meta = {}) {
    const supportFlag = meta?.supports_backup ?? meta?.backup_supported ?? meta?.backups_supported;
    const supported = supportFlag !== false;
    const candidates = [
      device?.latest_backup_at,
      meta?.latest_backup_at,
      meta?.last_backup_at,
      meta?.backup?.last_success_at,
      meta?.backup?.latest_at
    ];
    let timestamp = null;
    for (const candidate of candidates) {
      if (!candidate) { continue; }
      if (candidate instanceof Date) {
        timestamp = candidate.toISOString();
        break;
      }
      if (typeof candidate === 'string' && candidate.trim()) {
        timestamp = candidate;
        break;
      }
    }
    return { supported, timestamp };
  }

  function formatMetricValue(metricType, metric) {
    if (!metric || metric.value == null) {
      return '—';
    }
    const value = Number(metric.value);
    if (!Number.isFinite(value)) {
      return '—';
    }

    // Special handling for uptime metrics - format as human-readable duration
    if (metricType === 'uptime_seconds' || metricType === 'system_uptime') {
      return formatUptimeLong(value);
    }

    const unit = metric.unit || getMetricUnit(metricType);
    let formatted;
    if (Math.abs(value) >= 100 || unit === '%') {
      formatted = value.toFixed(0);
    } else if (Math.abs(value) >= 10) {
      formatted = value.toFixed(1);
    } else {
      formatted = value.toFixed(2);
    }
    return `${formatted}${unit ? ` ${unit}` : ''}`;
  }

  views.overviewFormatters = {
    normalise,
    normaliseKindValue,
    resolveKindKey,
    formatKindLabel,
    formatKind,
    formatRelativeTime,
    formatUptimeLong,
    getMetricUnit,
    getMetricLabel,
    resolveNumericValue,
    extractUptimeSeconds,
    resolveBackupDetails,
    formatMetricValue
  };
})(window);
