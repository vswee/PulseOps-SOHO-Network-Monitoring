/**
 * PulseOps Dashboard - Overview View
 *
 * Displays a grid of device cards showing:
 * - Device status (online/offline/warning)
 * - Key metrics (ping, CPU, memory, uptime, etc.)
 * - Device information (name, host, platform)
 * - Quick actions (edit, delete, view insights)
 *
 * Features:
 * - Real-time device status updates via store subscriptions
 * - Filtering by device type and status
 * - Responsive grid layout
 * - Metric visualization with color coding
 * - Device interactions (edit, delete, insights)
 */
(function (window, document) {
  'use strict';

  const PulseOps = window.PulseOps = window.PulseOps || {};
  const views = PulseOps.views = PulseOps.views || {};
  const overviewFormatters = views.overviewFormatters;

  if (!overviewFormatters) {
    throw new Error('PulseOps.views.overviewFormatters is required for the overview view');
  }

  // Import formatting utilities
  const {
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
  } = overviewFormatters;

  // ============================================================================
  // CONSTANTS
  // ============================================================================

  /** Device status display configuration */
  const statusManager = PulseOps.deviceStatus || null;
  const STATUS_LABELS = statusManager?.STATUS_LABELS
    ? Object.assign({}, statusManager.STATUS_LABELS)
    : {
      online: { label: 'Online', className: 'status-online' },
      offline: { label: 'Offline', className: 'status-offline' },
      unreachable: { label: 'Unreachable', className: 'status-unreachable' },
      warning: { label: 'Needs attention', className: 'status-warning' },
      unknown: { label: 'Unknown', className: 'status-unknown' }
    };

  /** Freshness thresholds derived from backend ping cadence */
  const STATUS_CACHE_TTL_MS = 12 * 1000; // ensure we re-evaluate status regularly while data loads
  const PING_EXPECTED_INTERVAL_MS = 30 * 1000; // scheduler collects ping samples every 30s
  const PING_ONLINE_THRESHOLD_MS = 90 * 1000; // allow up to one summary TTL (~60s) + one ping interval of drift
  const PING_UNREACHABLE_THRESHOLD_MS = 5 * 60 * 1000;
  const DEVICE_UNREACHABLE_AGE_MS = PING_UNREACHABLE_THRESHOLD_MS;

  /** Metrics to display on device cards, in priority order */
  const METRIC_KEYS = ['ping_ms', 'iperf_mbps', 'cpu_usage', 'memory_usage', 'temperature', 'cpu_load', 'bandwidth_mbps', 'bandwidth', 'uptime_seconds', 'system_uptime'];
  const METRIC_PRIORITY = METRIC_KEYS.slice();

  /** Color assignments for specific metrics */
  const METRIC_COLOR_MAP = {
    ping_ms: '#6366f1',
    iperf_mbps: '#22c55e',
    bandwidth: '#0ea5e9',
    throughput_mbps: '#0ea5e9',
    cpu_usage: '#ef4444',
    cpu_load: '#ef4444',
    memory_usage: '#f59e0b',
    temperature: '#a855f7',
    uptime_seconds: '#14b8a6',
    uptime: '#14b8a6',
    system_uptime: '#0ea5e9',
    latency_ms: '#fb7185'
  };
  const METRIC_COLOR_PALETTE = ['#6366f1', '#22c55e', '#ef4444', '#f59e0b', '#0ea5e9', '#a855f7', '#14b8a6', '#ec4899', '#10b981'];
  const ADDITIONAL_METRIC_CANDIDATES = ['throughput_mbps', 'cpu_load_1m', 'cpu_load_5m', 'cpu_load_15m', 'load_average', 'uptime', 'latency_ms'];
  const SUMMARY_TTL_MS = 60 * 1000; // refresh summaries every 60s
  const SUMMARY_RETRY_DELAY_MS = 8 * 1000;

  const state = {
    shared: null,
    devices: [],
    filteredDevices: [],
    filters: {
      kind: '',
      status: '',
      query: ''
    },
    unsubscribe: null,
    typeSelect: null,
    statusSelect: null,
    searchInput: null,
    resetButton: null,
    grid: null,
    empty: null,
    section: null,
    networkMapEl: null,
    networkMapNodes: null,
    networkMapLinks: null,
    networkMapEmpty: null,
    networkMapPanel: null,
    networkMapActiveDevices: [],
    deviceStatusCache: new Map(),
    deviceSummaries: new Map(),
    summaryFetches: new Map(),
    summaryErrorUntil: new Map(),
    debug: false,
    activeMenu: null,
    menuHandlerAttached: false,
    standalone: false,
    standaloneInitialised: false,
    overviewLoading: false,
    overviewLoadingToken: null,
    renderScheduled: false
  };

  const AGENT_THRESHOLDS = {
    latencyWarning: 120,
    latencyCritical: 180,
    cpuWarning: 75,
    cpuCritical: 90,
    memoryWarning: 80,
    memoryCritical: 90
  };

  function escapeDeviceSelector(value) {
    const raw = value == null ? '' : String(value);
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      try {
        return CSS.escape(raw);
      } catch (_) {
        return raw.replace(/["\\]/g, '\\$&');
      }
    }
    return raw.replace(/["\\]/g, '\\$&');
  }

  function buildDeviceSelector(deviceId) {
    if (!deviceId) { return ''; }
    return `[data-device-id="${escapeDeviceSelector(deviceId)}"]`;
  }

  function normaliseMetricSnapshot(metricKey, metrics) {
    if (!metrics || typeof metrics !== 'object' || !metrics[metricKey]) {
      return null;
    }
    const raw = Number(metrics[metricKey].value);
    if (!Number.isFinite(raw)) {
      return null;
    }
    const unit = metrics[metricKey].unit || getMetricUnit(metricKey) || '';
    const label = getMetricLabel(metricKey) || formatKindLabel(metricKey) || metricKey.replace(/_/g, ' ');
    return {
      key: metricKey,
      value: raw,
      unit,
      label,
      snapshot: metrics[metricKey]
    };
  }

  function describeMetricValue(metricKey, metricInfo) {
    if (!metricInfo) { return ''; }
    const formatted = formatMetricValue(metricKey, metricInfo.snapshot || { value: metricInfo.value, unit: metricInfo.unit });
    if (formatted && typeof formatted === 'string') {
      return formatted;
    }
    const digits = Math.abs(metricInfo.value) >= 10 ? 0 : 1;
    return `${metricInfo.value.toFixed(digits)}${metricInfo.unit ? ` ${metricInfo.unit}` : ''}`;
  }

  function resolveMetricCategory(metricKey) {
    const key = String(metricKey || '').toLowerCase();
    if (key.includes('latency') || key.includes('ping')) { return 'latency'; }
    if (key.includes('throughput') || key.includes('bandwidth') || key.includes('iperf')) { return 'throughput'; }
    if (key.includes('cpu')) { return 'cpu'; }
    if (key.includes('memory')) { return 'memory'; }
    if (key.includes('temp')) { return 'thermal'; }
    if (key.includes('uptime')) { return 'uptime'; }
    return 'metric';
  }

  function analyseMetricTrend(device, summary) {
    if (!summary || typeof summary !== 'object') { return null; }
    const chartSeries = summary.chartSeries || {};
    const order = Array.isArray(summary.chartOrder) ? summary.chartOrder : [];
    const metrics = summary.metrics || {};
    const candidateKey = order.find((key) => Array.isArray(chartSeries[key]) && chartSeries[key].length >= 4)
      || Object.keys(chartSeries).find((key) => Array.isArray(chartSeries[key]) && chartSeries[key].length >= 4);
    if (!candidateKey) { return null; }
    const series = chartSeries[candidateKey];
    const firstPoint = series[0];
    const lastPoint = series[series.length - 1];
    if (!firstPoint || !lastPoint) { return null; }
    const firstValue = Number(firstPoint.value);
    const lastValue = Number(lastPoint.value);
    if (!Number.isFinite(firstValue) || !Number.isFinite(lastValue)) { return null; }
    const baseline = Math.abs(firstValue) > 1e-6 ? Math.abs(firstValue) : 1;
    const percentChange = ((lastValue - firstValue) / baseline) * 100;
    if (!Number.isFinite(percentChange)) { return null; }

    const category = resolveMetricCategory(candidateKey);
    let severity = null;
    let improvement = false;
    let headline = '';

    if (category === 'latency') {
      if (percentChange >= 60) { severity = 'critical'; headline = 'Latency surged sharply'; }
      else if (percentChange >= 30) { severity = 'warning'; headline = 'Latency trending up'; }
      else if (percentChange <= -30) { severity = 'success'; headline = 'Latency improved markedly'; improvement = true; }
    } else if (category === 'throughput') {
      if (percentChange <= -40) { severity = 'warning'; headline = 'Throughput dropped'; }
      else if (percentChange >= 35) { severity = 'success'; headline = 'Throughput improved'; improvement = true; }
    } else if (category === 'cpu' || category === 'memory') {
      if (percentChange >= 50) { severity = 'critical'; headline = category === 'cpu' ? 'CPU load spiking' : 'Memory pressure spiking'; }
      else if (percentChange >= 30) { severity = 'warning'; headline = category === 'cpu' ? 'CPU load rising' : 'Memory usage increasing'; }
    } else if (category === 'thermal') {
      if (percentChange >= 20) { severity = 'warning'; headline = 'Temperature increasing'; }
    } else {
      if (percentChange >= 60) { severity = 'warning'; headline = 'Metric increased sharply'; }
      if (percentChange <= -50) { severity = 'success'; headline = 'Metric improved'; improvement = true; }
    }

    if (!severity) { return null; }

    const metricInfo = normaliseMetricSnapshot(candidateKey, metrics) || {
      key: candidateKey,
      value: lastValue,
      unit: '',
      label: getMetricLabel(candidateKey) || candidateKey.replace(/_/g, ' '),
      snapshot: { value: lastValue, unit: '' }
    };
    const nowFormatted = describeMetricValue(candidateKey, metricInfo);
    const startFormatted = `${firstValue.toFixed(Math.abs(firstValue) >= 10 ? 0 : 1)}${metricInfo.unit ? ` ${metricInfo.unit}` : ''}`;

    return {
      id: `overview-${device.id}-trend-${candidateKey}`,
      title: `${device.name || device.host || device.id}: ${headline}`,
      detail: `${metricInfo.label} shifted ${percentChange >= 0 ? 'up' : 'down'} ${Math.abs(percentChange).toFixed(1)}% (now ${nowFormatted}, was ${startFormatted}).`,
      severity: improvement ? 'success' : severity,
      category: 'trend',
      deviceId: device.id,
      deviceName: device.name || device.host || device.id,
      selector: buildDeviceSelector(device.id),
      actions: improvement
        ? ['Validate that the improvement aligns with expected changes and document the result for reporting.']
        : [
          `Inspect utilisation and error counters related to ${metricInfo.label}.`,
          'Review recent change windows or saturation events that could explain the deviation.'
        ],
      metric: { name: metricInfo.label, unit: metricInfo.unit, value: lastValue },
      improvement
    };
  }

  function publishAgentContext(context) {
    if (!context) { return; }
    const sharedInstance = state.shared || getShared();
    const events = sharedInstance?.events;
    if (events && typeof events.emit === 'function') {
      events.emit('agent:context', context);
    }
  }

  function buildOverviewAgentContext(devicePairs, totals) {
    const highlights = [];
    let offlineCount = 0;
    let warningCount = 0;
    let latencyAlerts = 0;
    let cpuAlerts = 0;
    let memoryAlerts = 0;
    let logAlerts = 0;
    let improvementCount = 0;

    devicePairs.forEach(({ device, summary }) => {
      if (!device) { return; }
      const deviceName = device.name || device.host || device.id;
      const selector = buildDeviceSelector(device.id);
      if (device.status === 'offline' || device.status === 'unreachable') {
        offlineCount += 1;
        const label = STATUS_LABELS[device.status]?.label || (device.status === 'offline' ? 'Offline' : 'Unreachable');
        const lastSeen = device.updated_at ? formatRelativeTime(device.updated_at) : null;
        highlights.push({
          id: `overview-${device.id}-status`,
          title: `${deviceName} is ${label.toLowerCase()}`,
          detail: lastSeen ? `Last heartbeat ${lastSeen}.` : '',
          severity: 'critical',
          category: 'status',
          deviceId: device.id,
          deviceName,
          selector,
          actions: [
            `Check site power and upstream transport for ${device.site || 'the affected location'}.`,
            'Attempt recovery via the Devices panel or engage on-site hands if remote checks fail.'
          ]
        });
      } else if (device.status === 'warning') {
        warningCount += 1;
        highlights.push({
          id: `overview-${device.id}-status-warning`,
          title: `${deviceName} reports a degraded state`,
          detail: `Review the device card for validation or backup warnings.`,
          severity: 'warning',
          category: 'status',
          deviceId: device.id,
          deviceName,
          selector,
          actions: [
            'Run validation from the device quick actions menu.',
            'Check recent configuration or backup events for anomalies.'
          ]
        });
      }

      const metrics = summary?.metrics || {};
      const latencyMetric = normaliseMetricSnapshot('latency_ms', metrics) || normaliseMetricSnapshot('ping_ms', metrics);
      if (latencyMetric && Number.isFinite(latencyMetric.value)) {
        const severity = latencyMetric.value >= AGENT_THRESHOLDS.latencyCritical
          ? 'critical'
          : (latencyMetric.value >= AGENT_THRESHOLDS.latencyWarning ? 'warning' : null);
        if (severity) {
          latencyAlerts += 1;
          highlights.push({
            id: `overview-${device.id}-latency`,
            title: `${deviceName} latency ${severity === 'critical' ? 'is critical' : 'needs attention'}`,
            detail: `Current latency ${describeMetricValue(latencyMetric.key, latencyMetric)}.`,
            severity,
            category: 'latency',
            deviceId: device.id,
            deviceName,
            selector,
            metric: { name: latencyMetric.label, unit: latencyMetric.unit, value: latencyMetric.value },
            actions: [
              `Check WAN utilisation or link errors impacting ${device.site || deviceName}.`,
              'Compare against baseline in Insights to confirm whether the spike is transient.'
            ]
          });
        }
      }

      const cpuMetric = normaliseMetricSnapshot('cpu_usage', metrics) || normaliseMetricSnapshot('cpu_load', metrics);
      if (cpuMetric) {
        const severity = cpuMetric.value >= AGENT_THRESHOLDS.cpuCritical
          ? 'critical'
          : (cpuMetric.value >= AGENT_THRESHOLDS.cpuWarning ? 'warning' : null);
        if (severity) {
          cpuAlerts += 1;
          highlights.push({
            id: `overview-${device.id}-cpu`,
            title: `${deviceName} CPU utilisation elevated`,
            detail: `CPU at ${describeMetricValue(cpuMetric.key, cpuMetric)}.`,
            severity,
            category: 'cpu',
            deviceId: device.id,
            deviceName,
            selector,
            metric: { name: cpuMetric.label, unit: cpuMetric.unit, value: cpuMetric.value },
            actions: [
              'Review process utilisation or control-plane events on the device.',
              'Validate that scheduled jobs or telemetry collectors are not overwhelming resources.'
            ]
          });
        }
      }

      const memoryMetric = normaliseMetricSnapshot('memory_usage', metrics);
      if (memoryMetric) {
        const severity = memoryMetric.value >= AGENT_THRESHOLDS.memoryCritical
          ? 'critical'
          : (memoryMetric.value >= AGENT_THRESHOLDS.memoryWarning ? 'warning' : null);
        if (severity) {
          memoryAlerts += 1;
          highlights.push({
            id: `overview-${device.id}-memory`,
            title: `${deviceName} memory pressure detected`,
            detail: `Memory at ${describeMetricValue('memory_usage', memoryMetric)}.`,
            severity,
            category: 'memory',
            deviceId: device.id,
            deviceName,
            selector,
            metric: { name: memoryMetric.label, unit: memoryMetric.unit, value: memoryMetric.value },
            actions: [
              'Inspect running services and consider clearing caches or rotating logs.',
              'Plan for capacity upgrade if utilisation is persistently high.'
            ]
          });
        }
      }

      const latestLog = summary?.latestLog;
      if (latestLog && latestLog.level) {
        const level = String(latestLog.level).toLowerCase();
        const isError = level === 'error' || level === 'critical';
        const isWarn = level === 'warn' || level === 'warning';
        if (isError || isWarn) {
          if (isError) { logAlerts += 1; }
          highlights.push({
            id: `overview-${device.id}-log`,
            title: `${deviceName} recent ${level} log`,
            detail: `'${latestLog.message || 'Log entry'}' ${latestLog.timestamp ? formatRelativeTime(latestLog.timestamp) : 'recently'}.`,
            severity: isError ? 'critical' : 'warning',
            category: 'log',
            deviceId: device.id,
            deviceName,
            selector,
            actions: [
              'Open Activity Logs filtered to this device for the full context.',
              'Correlate with recent changes or authentication events that could trigger the alert.'
            ]
          });
        }
      }

      const trendHighlight = analyseMetricTrend(device, summary);
      if (trendHighlight) {
        highlights.push(trendHighlight);
        if (trendHighlight.improvement) {
          improvementCount += 1;
        }
      }
    });

    const filteredCount = totals.filtered;
    const totalCount = totals.total;

    if (filteredCount > 0) {
      const offlineRatio = offlineCount / filteredCount;
      if (offlineRatio >= 0.3) {
        highlights.push({
          id: 'overview-network-degradation',
          title: `Network degradation: ${offlineCount} of ${filteredCount} devices unreachable`,
          detail: 'Investigate upstream transport links or power for the affected segment.',
          severity: 'critical',
          category: 'topology',
          actions: [
            'Use Network Visualisation to confirm alternate paths and isolate the failure domain.',
            'Escalate to site operations if multiple adjacent nodes remain offline.'
          ]
        });
      } else if (offlineRatio >= 0.15) {
        highlights.push({
          id: 'overview-network-warning',
          title: `Reachability concern: ${offlineCount} nodes offline`,
          detail: 'Several devices lost connectivity; validate redundancy before performing changes.',
          severity: 'warning',
          category: 'topology',
          actions: ['Schedule targeted diagnostics during a maintenance window to prevent cascading faults.']
        });
      }
    }

    if (improvementCount > 0) {
      highlights.push({
        id: 'overview-positive-trends',
        title: `${improvementCount} notable performance improvement${improvementCount === 1 ? '' : 's'}`,
        detail: 'Capture these gains for reporting and ensure configuration changes are preserved.',
        severity: 'success',
        category: 'trend',
        actions: ['Document the improvement and validate that automation baselines reflect the new performance.']
      });
    }

    const summaryParts = [];
    if (!filteredCount) {
      summaryParts.push('No devices match the current filters. Add a device or clear filters to resume monitoring.');
    } else {
      summaryParts.push(`${filteredCount} device${filteredCount === 1 ? '' : 's'} visible (${totalCount} total managed).`);
      if (offlineCount) {
        summaryParts.push(`${offlineCount} offline or unreachable.`);
      }
      if (latencyAlerts) {
        summaryParts.push(`${latencyAlerts} experiencing high latency.`);
      }
      if (cpuAlerts || memoryAlerts) {
        summaryParts.push(`${cpuAlerts + memoryAlerts} showing resource saturation.`);
      }
      if (logAlerts) {
        summaryParts.push(`${logAlerts} device${logAlerts === 1 ? '' : 's'} logged recent errors.`);
      }
      if (!offlineCount && !latencyAlerts && !cpuAlerts && !memoryAlerts && !logAlerts && !warningCount) {
        summaryParts.push('All monitored devices are operating within expected thresholds.');
      }
      if (improvementCount) {
        summaryParts.push(`${improvementCount} positive trend${improvementCount === 1 ? ' is' : 's are'} worth reporting.`);
      }
    }

    const signature = [
      totalCount,
      filteredCount,
      offlineCount,
      warningCount,
      latencyAlerts,
      cpuAlerts,
      memoryAlerts,
      logAlerts,
      improvementCount,
      highlights.map((item) => item.id).join('|')
    ].join('::');

    return {
      route: 'overview',
      summary: summaryParts.join(' '),
      highlights,
      meta: {
        totalCount,
        filteredCount,
        offlineCount,
        warningCount,
        latencyAlerts,
        cpuAlerts,
        memoryAlerts,
        logAlerts,
        improvementCount
      },
      signature,
      generatedAt: Date.now()
    };
  }

(function configureOverviewDebug() {
  try {
    const params = new URLSearchParams(window.location.search);
    const toggleOverview = (params.get('debugOverview') || '').toLowerCase();
    const toggleGeneric  = (params.get('debug') || '').toLowerCase();
    if (toggleOverview === '1' || toggleOverview === 'true' || toggleGeneric === '1' || toggleGeneric === 'true') {
      state.debug = true;
      try { localStorage.setItem('pulseops-debug-overview', '1'); } catch (_) {}
    } else {
      try {
        state.debug = localStorage.getItem('pulseops-debug-overview') === '1';
      } catch (_) {
        state.debug = false;
      }
    }
  } catch (_) {
    state.debug = false;
  }

  if (state.debug) {
    console.log('[Overview] Debug enabled', {
      STATUS_CACHE_TTL_MS,
      PING_EXPECTED_INTERVAL_MS,
      PING_ONLINE_THRESHOLD_MS,
      PING_UNREACHABLE_THRESHOLD_MS
    });
  }
})();

  function overviewDebug(...args) {
    if (state.debug) {
      console.log('[Overview]', ...args);
    }
  }

  function updateOverviewLoadingState() {
    const isLoading = state.summaryFetches.size > 0;
    if (state.section) {
      state.section.classList.toggle('view-section--loading', isLoading);
      state.section.setAttribute('data-loading', isLoading ? 'true' : 'false');
    }

    if (state.overviewLoading === isLoading) {
      return;
    }
    state.overviewLoading = isLoading;

    const events = state.shared?.events;
    if (events && typeof events.emit === 'function') {
      events.emit('overview:loading-state', { loading: isLoading });
    }

    const loadingService = state.shared?.loading;
    if (!loadingService) {
      return;
    }
    if (isLoading) {
      if (!state.overviewLoadingToken && typeof loadingService.begin === 'function') {
        state.overviewLoadingToken = loadingService.begin({
          id: 'overview-device-data',
          label: 'Loading device activity'
        });
      }
    } else if (state.overviewLoadingToken && typeof loadingService.done === 'function') {
      loadingService.done(state.overviewLoadingToken);
      state.overviewLoadingToken = null;
    }
  }

  function getShared() {
    const shared = PulseOps.shared;
    return shared && typeof shared.ensureReady === 'function' ? shared.ensureReady() : shared;
  }

  function getSharedUtils() {
    const shared = state.shared || getShared();
    return shared?.utils || {};
  }

  function getDeviceInteractions() {
    return PulseOps.deviceInteractions || {};
  }

  function resolveDeviceLocation(device) {
    const shared = state.shared || getShared();
    const resolver = shared?.utils?.resolveNetworkLocation;
    if (typeof resolver !== 'function') {
      return null;
    }
    return resolver(device);
  }

  function resolveDeviceGeoIP(device) {
    if (!device || typeof device !== 'object') { return ''; }
    const classification = device.network_classification && typeof device.network_classification === 'object'
      ? device.network_classification
      : null;
    const candidates = [
      classification?.ip,
      device.network_scope_ip,
      device.host
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return '';
  }

  function isValidIPv4(value) {
    const parts = String(value || '').trim().split('.');
    if (parts.length !== 4) { return false; }
    return parts.every((part) => {
      if (!/^[0-9]{1,3}$/.test(part)) { return false; }
      const n = Number(part);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }

  function isPrivateIPv4(value) {
    const parts = String(value || '').trim().split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return false;
    }
    if (parts[0] === 10) { return true; }
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) { return true; }
    if (parts[0] === 192 && parts[1] === 168) { return true; }
    if (parts[0] === 169 && parts[1] === 254) { return true; }
    if (parts[0] === 127) { return true; }
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) { return true; }
    return false;
  }

  function isValidIPv6(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed.includes(':')) { return false; }
    if (!/^[0-9a-f:.]+$/i.test(trimmed)) { return false; }
    return true;
  }

  function isLikelyIPAddress(value) {
    if (isValidIPv4(value)) { return true; }
    if (isValidIPv6(value)) { return true; }
    return false;
  }

  function requestRender() {
    if (state.renderScheduled) { return; }
    if (!state.section && !state.standalone) { return; }
    state.renderScheduled = true;
    window.requestAnimationFrame(() => {
      state.renderScheduled = false;
      if (!state.section && !state.standalone) { return; }
      render();
    });
  }

  function ensureDeviceGeolocation(device, geoService) {
    if (!geoService || typeof geoService.get !== 'function') { return; }
    const ip = resolveDeviceGeoIP(device);
    if (!ip || !isLikelyIPAddress(ip)) { return; }
    const location = resolveDeviceLocation(device);
    if (location?.isPrivate) { return; }
    if (isValidIPv4(ip) && isPrivateIPv4(ip)) { return; }
    const peekFn = typeof geoService.peek === 'function' ? geoService.peek : null;
    const pendingFn = typeof geoService.isPending === 'function' ? geoService.isPending : null;
    const cached = peekFn ? peekFn(ip) : null;
    const pending = pendingFn ? pendingFn(ip) : false;
    if (cached || pending) { return; }
    const promise = geoService.get(ip).catch(() => null);
    if (promise && typeof promise.finally === 'function') {
      promise.finally(() => requestRender());
    }
  }

  function buildGeolocationLabel(data) {
    if (!data || typeof data !== 'object') { return ''; }
    if (typeof data.display === 'string' && data.display.trim()) {
      return data.display.trim();
    }
    const parts = [];
    const add = (value) => {
      if (!value) { return; }
      const text = String(value).trim();
      if (!text) { return; }
      if (!parts.includes(text)) { parts.push(text); }
    };
    add(data.city);
    add(data.region);
    add(data.country);
    if (!parts.length && data.country_code) {
      add(String(data.country_code).toUpperCase());
    }
    return parts.join(', ');
  }

  function buildGeolocationTooltip(data) {
    if (!data || typeof data !== 'object') { return ''; }
    const parts = [];
    if (data.organization) { parts.push(String(data.organization)); }
    if (data.asn) { parts.push(String(data.asn)); }
    if (data.timezone) { parts.push(`TZ ${data.timezone}`); }
    const lat = Number(data.latitude);
    const lon = Number(data.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      parts.push(`(${lat.toFixed(2)}, ${lon.toFixed(2)})`);
    }
    return parts.join(' • ');
  }

  function formatGeolocationEntry(data, { pending = false, ip = '' } = {}) {
    const base = { term: 'GeoIP', value: '—' };
    if (pending) {
      return { ...base, value: 'Resolving…' };
    }
    if (!data) {
      return null;
    }
    if (data.reason === 'private_ip') {
      return { ...base, value: 'Private address', tooltip: 'Private or non-routable addresses are not geolocated.' };
    }
    if (data.error && data.geolocated === false) {
      return {
        ...base,
        value: 'Lookup failed',
        tooltip: data.message || 'Unable to resolve geolocation.'
      };
    }
    if (data.geolocated === false && !data.error) {
      return {
        ...base,
        value: 'Unavailable',
        tooltip: data.message || (ip ? `No geolocation available for ${ip}` : 'No geolocation available.')
      };
    }
    const label = buildGeolocationLabel(data) || (data.country_code ? String(data.country_code).toUpperCase() : data.country) || (ip || '—');
    const tooltip = buildGeolocationTooltip(data);
    const entry = { ...base, value: label };
    if (tooltip) {
      entry.tooltip = tooltip;
    }
    return entry;
  }

  function getDeviceStatus(device) {
    if (!device) { return 'unknown'; }
    const cacheKey = device.id ?? null;
    const now = Date.now();
    if (cacheKey != null) {
      const cached = state.deviceStatusCache.get(cacheKey);
      if (cached) {
        const cacheAge = now - cached.timestamp;
        const cachedPingAge = cached.lastPingAt != null ? now - cached.lastPingAt : null;
        const hasPingSample = cached.lastPingAt != null;
        if (cacheAge < STATUS_CACHE_TTL_MS && hasPingSample) {
          return cached.status;
        }
      }
    }

    const pingDetails = resolveLatestPing(device, now);
    const createdAtTs = resolveDeviceCreatedAt(device);
    const createdAgeMs = createdAtTs ? now - createdAtTs : null;

    let status = 'unknown';

    const hasPingSample = pingDetails.timestamp != null;
    const pingAgeMs = pingDetails.ageMs;
    const pingValue = pingDetails.value;
    const successfulPing = pingDetails.successful && Number.isFinite(pingValue);

    if (hasPingSample) {
      if (pingAgeMs <= PING_ONLINE_THRESHOLD_MS) {
        if (successfulPing) {
          status = pingValue < 1000 ? 'online' : 'offline';
        } else {
          status = 'unknown';
        }
      } else {
        const oldEnoughToFlag = createdAgeMs != null && createdAgeMs > DEVICE_UNREACHABLE_AGE_MS;
        status = oldEnoughToFlag ? 'unreachable' : 'offline';
      }
    } else {
      const oldEnoughToFlag = createdAgeMs != null && createdAgeMs > DEVICE_UNREACHABLE_AGE_MS;
      status = oldEnoughToFlag ? 'unreachable' : 'unknown';
    }

    if (cacheKey != null) {
      state.deviceStatusCache.set(cacheKey, {
        status,
        timestamp: now,
        lastPingAt: pingDetails.timestamp || null,
        lastPingValue: pingDetails.value,
        lastPingAge: pingDetails.ageMs,
        lastPingSource: pingDetails.source,
        createdAt: createdAtTs
      });
    }

    return status;
  }

  function resolveLatestPing(device, now) {
    const result = {
      timestamp: null,
      ageMs: Number.POSITIVE_INFINITY,
      value: null,
      successful: false,
      source: 'none'
    };
    if (!device) { return result; }

    const metricsStore = state.shared?.stores?.metrics;
    const metrics = typeof metricsStore?.get === 'function' ? metricsStore.get(device.id) : null;

    const summaryMetric = state.deviceSummaries?.get(device.id)?.metrics?.ping_ms;
    let pingMetric = null;
    if (metrics?.ping_ms) {
      pingMetric = metrics.ping_ms;
      result.source = 'store';
    } else if (summaryMetric) {
      pingMetric = summaryMetric;
      result.source = 'summary';
    }
    if (!pingMetric) {
      return result;
    }

    const tsValue = pingMetric.ts || pingMetric.timestamp || null;
    const ts = toTimestamp(tsValue);
    if (ts == null) {
      return result;
    }

    const valueRaw = pingMetric.value;
    const value = typeof valueRaw === 'number' ? valueRaw : Number(valueRaw);
    const successful = Number.isFinite(value) && value >= 0;
    const ageMs = Math.max(0, now - ts);

    result.timestamp = ts;
    result.ageMs = ageMs;
    result.value = successful ? value : null;
    result.successful = successful;

    return result;
  }

  function resolveDeviceCreatedAt(device) {
    if (!device) { return null; }
    const fields = ['created_at', 'createdAt', 'created'];
    for (let i = 0; i < fields.length; i += 1) {
      const value = device[fields[i]];
      const ts = toTimestamp(value);
      if (ts != null) {
        return ts;
      }
    }
    const meta = getDeviceMeta(device);
    if (meta && typeof meta === 'object') {
      const metaValue = meta.created_at || meta.createdAt || meta.created;
      const ts = toTimestamp(metaValue);
      if (ts != null) {
        return ts;
      }
    }
    return null;
  }

  function toTimestamp(value) {
    if (value == null) { return null; }
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) { return null; }
      // Treat values exceeding 1e12 as milliseconds, otherwise seconds.
      return value > 1e12 ? value : (value > 0 ? value * 1000 : null);
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  function applyFilters(devices) {
    const { kind, status, query } = state.filters;
    const search = normalise(query);
    state.filteredDevices = devices.filter((device) => {
      if (kind && normalise(device.kind) !== kind) {
        return false;
      }
      if (status) {
        const deviceStatus = getDeviceStatus(device);
        if (normalise(deviceStatus) !== normalise(status)) {
          return false;
        }
      }
      if (search) {
        const haystack = [device.name, device.host, device.platform, device.site, device.kind]
          .map(normalise)
          .join(' ');
        if (!haystack.includes(search)) {
          return false;
        }
      }
      return true;
    });
    return state.filteredDevices;
  }

  function updateTypeFilterOptions(devices) {
    if (!state.typeSelect) { return; }
    const kinds = new Set();
    devices.forEach((device) => {
      const value = normalise(device.kind);
      if (value) {
        kinds.add(value);
      }
    });
    const previous = state.typeSelect.value;
    state.typeSelect.innerHTML = '<option value="">All types</option>';
    Array.from(kinds).sort().forEach((kind) => {
      const label = kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const option = document.createElement('option');
      option.value = kind;
      option.textContent = label;
      state.typeSelect.appendChild(option);
    });
    if (previous && kinds.has(previous)) {
      state.typeSelect.value = previous;
    }
  }

  function createDeviceCard(device, summary) {
    const { shared } = state;
    const { createElement, formatDateTime, formatDuration } = shared.utils;
    const utils = getSharedUtils();
    const card = createElement('article', { class: 'device-card' });
    const interactions = getDeviceInteractions();

    const metrics = summary?.metrics || {};
    const deviceMeta = getDeviceMeta(device);
    let chartSeriesMap = summary?.chartSeries;
    if (Array.isArray(chartSeriesMap)) {
      const legacyMetric = summary?.chartOrder?.[0] || summary?.chartMetric || choosePreferredMetric(metrics);
      chartSeriesMap = legacyMetric ? { [legacyMetric]: chartSeriesMap } : {};
    }
    chartSeriesMap = chartSeriesMap || {};
    const chartOrder = Array.isArray(summary?.chartOrder) ? summary.chartOrder : [];
    const orderedMetrics = (chartOrder.length ? chartOrder : Object.keys(chartSeriesMap || {}));
    const activeChartMetrics = orderedMetrics.filter((metric) => Array.isArray(chartSeriesMap[metric]) && chartSeriesMap[metric].length);
    const latestLog = summary?.latestLog || null;
    const hasPendingFetch = state.summaryFetches.has(device.id);
    const isLoading = hasPendingFetch || !summary || summary?.loading;
    const hasError = summary?.error;

    card.classList.toggle('device-card--loading', isLoading);
    card.classList.toggle('device-card--error', hasError);
    card.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if (isLoading) {
      card.setAttribute('aria-disabled', 'true');
    } else {
      card.removeAttribute('aria-disabled');
    }

    const statusKeyRaw = normalise(device.status);
    const computedStatus = normalise(getDeviceStatus(device)) || statusKeyRaw || 'unknown';
    const statusInfo = statusManager?.getStatusInfo
      ? statusManager.getStatusInfo(computedStatus)
      : STATUS_LABELS[computedStatus] || { label: formatKind(computedStatus || 'Unknown'), className: 'status-unknown' };

    const header = createElement('header', { class: 'device-card-header' });
    const headerTop = createElement('div', { class: 'device-card-header-top' });
    const heading = createElement('div', { class: 'device-card-heading' });
    const titleText = device.name || device.host || 'Device';
    const title = createElement('h3', { class: 'device-card-title', title: titleText }, titleText);
    heading.appendChild(title);

    const subtitle = createElement('div', { class: 'device-card-subtitle' });
    const badgesRow = createElement('div', { class: 'device-card-badges' });
    const locationDetails = resolveDeviceLocation(device);
    const badgeFactory = shared.ui?.createPlatformBadge || shared.utils.createPlatformBadge;
    const platformLabel = device.platform_display || device.platform;
    if (platformLabel && typeof badgeFactory === 'function') {
      try {
        const badge = badgeFactory(platformLabel, { variant: 'compact' });
        if (badge) {
          subtitle.appendChild(badge);
        }
      } catch (error) {
        overviewDebug('Unable to render platform badge', error);
        subtitle.appendChild(createElement('span', { class: 'device-card-subtitle-text' }, String(platformLabel)));
      }
    } else if (platformLabel) {
      subtitle.appendChild(createElement('span', { class: 'device-card-subtitle-text' }, String(platformLabel)));
    }
    if (device.site) {
      subtitle.appendChild(createElement('span', { class: 'device-card-subtitle-text' }, device.site));
    }

    if (locationDetails) {
      const locationBadge = createElement('span', {
        class: `device-card-location network-location-badge network-location-badge--${locationDetails.category}`,
        title: locationDetails.description || locationDetails.reason || ''
      }, locationDetails.label);
      subtitle.appendChild(locationBadge);
    }
    headerTop.appendChild(heading);
    if (subtitle.childNodes.length) {
      badgesRow.appendChild(subtitle);
    }

    const headerActions = createElement('div', { class: 'device-card-header-actions' });
    const statusEl = createElement('span', { class: `device-card-status ${statusInfo.className}` });
    statusEl.appendChild(createElement('span', { class: 'device-card-status-dot', 'aria-hidden': 'true' }));
    statusEl.appendChild(createElement('span', { class: 'device-card-status-label' }, statusInfo.label));
    badgesRow.appendChild(statusEl);

    const menuWrapper = createElement('div', { class: 'device-card-menu' });
    const menuTrigger = createElement('button', {
      type: 'button',
      class: 'device-card-menu-trigger',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      title: 'Open device menu'
    });
    menuTrigger.appendChild(createElement('span', { class: 'sr-only' }, 'Open device actions'));
    menuTrigger.appendChild(createElement('span', { 'aria-hidden': 'true' }, '⋮'));

    const menuList = createElement('div', { class: 'device-card-menu-list', role: 'menu' });
    menuList.hidden = true;

    const actionItems = [
      {
        key: 'insights',
        label: 'View insights',
        handler: () => goToDeviceInsights(device.id)
      },
      {
        key: 'edit',
        label: 'Edit device',
        handler: () => interactions.edit?.(device.id)
      },
      {
        key: 'reboot',
        label: 'Reboot device',
        handler: () => interactions.reboot?.(device.id)
      },
      {
        key: 'delete',
        label: 'Delete device',
        handler: () => interactions.delete?.(device.id),
        destructive: true
      }
    ];

    actionItems.forEach((item) => {
      if (typeof item.handler !== 'function') { return; }
      const itemButton = createElement('button', {
        type: 'button',
        class: `device-card-menu-item${item.destructive ? ' device-card-menu-item--danger' : ''}`,
        role: 'menuitem'
      }, item.label);
      itemButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeActiveMenu();
        item.handler();
      });
      menuList.appendChild(itemButton);
    });

    menuTrigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu(menuTrigger, menuList);
    });

    menuWrapper.appendChild(menuTrigger);
    menuWrapper.appendChild(menuList);
    headerActions.appendChild(menuWrapper);
    headerTop.appendChild(headerActions);
    header.appendChild(headerTop);
    header.appendChild(badgesRow);
    card.appendChild(header);

    const body = createElement('div', { class: 'device-card-body' });

    const metricsSection = createElement('div', { class: 'device-card-metrics' });
    if (hasError) {
      metricsSection.appendChild(createElement('div', { class: 'device-card-empty' }, 'Metrics unavailable'));
    } else if (isLoading) {
      metricsSection.appendChild(createElement('div', { class: 'device-card-empty' }, 'Loading metrics…'));
    } else {
      const metricKeys = Object.keys(metrics);
      if (!metricKeys.length) {
        metricsSection.appendChild(createElement('div', { class: 'device-card-empty' }, 'No metrics yet'));
      } else {
        metricKeys.slice(0, 3).forEach((metricType) => {
          const metric = metrics[metricType];
          const metricEl = createElement('div', { class: 'device-metric-chip', title: metric?.timestamp ? `Updated ${formatDateTime(metric.timestamp)}` : '' });
          metricEl.appendChild(createElement('span', { class: 'device-metric-label' }, getMetricLabel(metricType)));
          metricEl.appendChild(createElement('span', { class: 'device-metric-value' }, formatMetricValue(metricType, metric)));
          metricsSection.appendChild(metricEl);
        });
      }
    }
    body.appendChild(metricsSection);

    const chartSection = createElement('div', { class: 'device-card-chart' });
    if (hasError) {
      chartSection.appendChild(createElement('div', { class: 'device-card-chart-empty' }, '—'));
    } else if (!activeChartMetrics.length) {
      chartSection.appendChild(createElement('div', { class: 'device-card-chart-empty' }, 'No metric data yet'));
    } else {
      const sparkline = createSparkline(chartSeriesMap, activeChartMetrics);
      chartSection.appendChild(sparkline);
      const metricLabels = Array.from(new Set(activeChartMetrics.map((metric) => getMetricLabel(metric))));
      chartSection.appendChild(createElement('div', { class: 'device-card-chart-label' }, `Trend: ${metricLabels.join(', ')}`));
    }
    body.appendChild(chartSection);
    card.appendChild(body);

    const logSection = createElement('div', { class: 'device-card-log' });
    const logLabel = createElement('div', { class: 'device-card-log-label' }, 'Latest activity');
    logSection.appendChild(logLabel);
    if (!latestLog) {
      logSection.appendChild(createElement('div', { class: 'device-card-log-empty' }, hasError ? 'Unable to load logs' : 'Waiting for logs…'));
    } else {
      const message = createElement('div', { class: 'device-card-log-message' }, latestLog.message || 'Log entry');
      logSection.appendChild(message);
      const meta = createElement('div', { class: 'device-card-log-meta' });
      if (latestLog.level) {
        meta.appendChild(createElement('span', { class: `device-card-log-level level-${latestLog.level}` }, latestLog.level.toUpperCase()));
      }
      if (latestLog.timestamp) {
        meta.appendChild(createElement('span', { class: 'device-card-log-time' }, formatRelativeTime(latestLog.timestamp)));
      }
      logSection.appendChild(meta);
    }
    card.appendChild(logSection);

    const metaList = createElement('dl', { class: 'device-card-details' });

    const uptimeSeconds = extractUptimeSeconds(summary, deviceMeta);
    const uptimeValue = Number.isFinite(uptimeSeconds) && uptimeSeconds > 0
      ? formatUptimeLong(uptimeSeconds)
      : '—';
    // if (state.debug) { return; }

    const backupDetails = resolveBackupDetails(device, deviceMeta);

    let backupEntry = null;
    if (backupDetails) {
      let backupValue;
      let backupTooltip = '';
      if (!backupDetails.supported) {
        backupValue = 'Not supported';
      } else if (backupDetails.timestamp) {
        backupValue = formatRelativeTime(backupDetails.timestamp);
        backupTooltip = formatDateTime(backupDetails.timestamp);
      } else {
        backupValue = 'No backups yet';
      }
      backupEntry = { term: 'Last backup', value: backupValue };
      if (backupTooltip) {
        backupEntry.tooltip = backupTooltip;
      }
    }

    const metaEntries = [
      { term: 'Host', value: device.host || '—', ip: device.host },
      { term: 'Type', value: formatKind(device.kind) },
      { term: 'Uptime', value: uptimeValue },
      backupEntry
    ].filter(Boolean);
    if (locationDetails) {
      metaEntries.splice(1, 0, {
        term: 'Location',
        value: locationDetails.label,
        tooltip: locationDetails.description || locationDetails.reason || undefined
      });
    }
    const geoService = state.shared?.services?.geolocation || null;
    const geoIP = resolveDeviceGeoIP(device);
    const geoPeek = typeof geoService?.peek === 'function' ? geoService.peek.bind(geoService) : null;
    const geoPendingFn = typeof geoService?.isPending === 'function' ? geoService.isPending.bind(geoService) : null;
    const geoData = geoPeek && geoIP ? geoPeek(geoIP) : null;
    const geoPending = geoPendingFn && geoIP ? Boolean(geoPendingFn(geoIP)) : false;
    const geoEntry = formatGeolocationEntry(geoData, { pending: geoPending, ip: geoIP });
    if (geoEntry) {
      const insertAt = locationDetails ? Math.min(2, metaEntries.length) : Math.min(1, metaEntries.length);
      metaEntries.splice(insertAt, 0, geoEntry);
    }
    metaEntries.forEach((entry) => {
      const dt = createElement('dt', {}, entry.term);
      const ddAttrs = entry.tooltip ? { title: entry.tooltip } : {};
      const dd = createElement('dd', ddAttrs, entry.value);
      if (entry.ip && utils?.attachGeoTooltip) {
        utils.attachGeoTooltip(dd, entry.ip);
      }
      metaList.appendChild(dt);
      metaList.appendChild(dd);
    });
    card.appendChild(metaList);

    if (Array.isArray(device.tags) && device.tags.length) {
      const tagList = createElement('div', { class: 'device-card-tags' });
      device.tags.forEach((tag) => {
        tagList.appendChild(createElement('span', { class: 'device-tag' }, tag));
      });
      card.appendChild(tagList);
    }

    card.addEventListener('click', (event) => {
      if (event.defaultPrevented) { return; }
      if (event.target.closest('.device-card-menu')) { return; }
      closeActiveMenu();
      goToDeviceInsights(device.id);
    });

    card.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('.device-card-menu')) {
        event.preventDefault();
        closeActiveMenu();
        goToDeviceInsights(device.id);
      }
    });

    card.setAttribute('tabindex', isLoading ? '-1' : '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${titleText} details`);

    return card;
  }

  function getDeviceMeta(device) {
    if (!device) { return {}; }
    const raw = device.meta;
    if (!raw) { return {}; }
    if (typeof raw === 'object' && raw !== null) {
      return raw;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) { return {}; }
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        overviewDebug('Failed to parse device meta', device.id || device.host || 'unknown', error);
        return {};
      }
    }
    return {};
  }

  function goToDeviceInsights(deviceId) {
    if (!deviceId) { return; }
    window.location.href = `/insights.html?deviceId=${encodeURIComponent(deviceId)}`;
  }

  function pruneMissingSummaries(devices) {
    const validIds = new Set(devices.map((device) => device.id));
    let modified = false;
    Array.from(state.deviceSummaries.keys()).forEach((id) => {
      if (!validIds.has(id)) {
        state.deviceSummaries.delete(id);
        state.summaryFetches.delete(id);
        state.summaryErrorUntil.delete(id);
        modified = true;
      }
    });
    if (modified) {
      updateOverviewLoadingState();
    }
  }

  function ensureDeviceSummary(device) {
    if (!device || !device.id) { return null; }
    const now = Date.now();
    let current = state.deviceSummaries.get(device.id) || null;
    if (current && now - current.fetchedAt < SUMMARY_TTL_MS && !current.error) {
      return current;
    }

    const suspendedUntil = state.summaryErrorUntil.get(device.id) || 0;
    if (now < suspendedUntil) {
      return current;
    }

    if (!state.summaryFetches.has(device.id)) {
      overviewDebug('Fetching summary for device', device.id);
      if (current) {
        current.loading = true;
        state.deviceSummaries.set(device.id, current);
      } else {
        current = {
          deviceId: device.id,
          latestLog: null,
          metrics: {},
          chartSeries: {},
          chartOrder: [],
          loading: true,
          fetchedAt: now
        };
        state.deviceSummaries.set(device.id, current);
      }

      const promise = loadDeviceSummary(device)
        .then((summary) => {
          summary.fetchedAt = Date.now();
          summary.loading = false;
          state.deviceSummaries.set(device.id, summary);
          state.summaryErrorUntil.delete(device.id);
          overviewDebug('Summary ready', device.id, summary);
          return summary;
        })
        .catch((error) => {
          console.warn('Failed to load device summary', device?.id, error);
          state.summaryErrorUntil.set(device.id, Date.now() + SUMMARY_RETRY_DELAY_MS);
          const fallback = {
            deviceId: device.id,
            latestLog: null,
            metrics: {},
            chartSeries: {},
            chartOrder: [],
            fetchedAt: Date.now(),
            error: true,
            loading: false
          };
          state.deviceSummaries.set(device.id, fallback);
          return fallback;
        })
        .finally(() => {
          state.summaryFetches.delete(device.id);
          updateOverviewLoadingState();
          if (state.grid) {
            requestAnimationFrame(render);
          }
        });
      state.summaryFetches.set(device.id, promise);
      updateOverviewLoadingState();
      if (state.grid) {
        requestAnimationFrame(render);
      }
    }
    return state.deviceSummaries.get(device.id) || current;
  }

  function closeActiveMenu() {
    const active = state.activeMenu;
    if (!active) { return; }
    const { trigger, menu } = active;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.classList.remove('device-card-menu-trigger--open');
    }
    if (menu) {
      menu.classList.remove('device-card-menu-list--open');
      menu.hidden = true;
    }
    state.activeMenu = null;
  }

  function setupGlobalMenuHandlers() {
    if (state.menuHandlerAttached) { return; }
    document.addEventListener('click', (event) => {
      if (!state.activeMenu) { return; }
      const { trigger, menu } = state.activeMenu;
      if (trigger?.contains(event.target) || menu?.contains(event.target)) {
        return;
      }
      closeActiveMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeActiveMenu();
      }
    });
    state.menuHandlerAttached = true;
  }

  function toggleMenu(trigger, menu) {
    if (!trigger || !menu) { return; }
    const isActive = state.activeMenu && state.activeMenu.trigger === trigger;
    if (isActive) {
      closeActiveMenu();
      return;
    }
    closeActiveMenu();
    setupGlobalMenuHandlers();
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('device-card-menu-trigger--open');
    menu.hidden = false;
    requestAnimationFrame(() => {
      menu.classList.add('device-card-menu-list--open');
    });
    state.activeMenu = { trigger, menu };
  }

  async function loadDeviceSummary(device) {
    if (!device || !device.id) {
      throw new Error('Invalid device provided');
    }
    if (!state.shared || !state.shared.utils) {
      throw new Error('Shared utilities not ready');
    }

    const deviceId = String(device.id);
    const [metrics, latestLog] = await Promise.all([
      fetchCurrentMetrics(deviceId),
      fetchLatestLog(deviceId)
    ]);

    const deviceMeta = getDeviceMeta(device);
    const metricsForChart = { ...metrics };

    const uptimeFromMeta = extractUptimeSeconds({ metrics }, deviceMeta);
    if (Number.isFinite(uptimeFromMeta) && uptimeFromMeta > 0) {
      metricsForChart.uptime_seconds = metricsForChart.uptime_seconds || { value: uptimeValue, unit: '' };
    }

    const bandwidthMeta = resolveNumericValue(deviceMeta?.bandwidth_mbps ?? deviceMeta?.bandwidth ?? deviceMeta?.throughput_mbps);
    if (bandwidthMeta != null) {
      metricsForChart.bandwidth_mbps = metricsForChart.bandwidth_mbps || { value: bandwidthMeta, unit: 'Mbps' };
    }

    const throughputMeta = resolveNumericValue(deviceMeta?.throughput_mbps);
    if (throughputMeta != null) {
      metricsForChart.throughput_mbps = metricsForChart.throughput_mbps || { value: throughputMeta, unit: 'Mbps' };
    }

    const cpuLoadMeta = resolveNumericValue(deviceMeta?.cpu_load ?? deviceMeta?.cpu?.load ?? deviceMeta?.load_average ?? deviceMeta?.cpu_load_1m);
    if (cpuLoadMeta != null) {
      metricsForChart.cpu_load = metricsForChart.cpu_load || { value: cpuLoadMeta, unit: '' };
    }

    const latencyMeta = resolveNumericValue(deviceMeta?.latency_ms ?? deviceMeta?.latency);
    if (latencyMeta != null) {
      metricsForChart.latency_ms = metricsForChart.latency_ms || { value: latencyMeta, unit: 'ms' };
    }

    const preferredMetric = choosePreferredMetric(metrics) || null;
    const chart = await fetchMetricSeries(deviceId, preferredMetric, metricsForChart);

    return {
      deviceId,
      metrics,
      latestLog,
      chartSeries: chart.series,
      chartOrder: chart.order
    };
  }

  async function fetchLatestLog(deviceId) {
    if (!deviceId || !state.shared?.utils?.jsonFetch) {
      return null;
    }
    const params = new URLSearchParams({
      device_id: String(deviceId),
      source: 'device',
      limit: '1'
    });
    try {
      const response = await state.shared.utils.jsonFetch(`/api/logs?${params.toString()}`);
      if (Array.isArray(response) && response.length) {
        const entry = response[0];
        return {
          id: entry.id,
          level: entry.level || 'info',
          message: entry.message || 'Log entry',
          timestamp: entry.timestamp || entry.ts || null
        };
      }
    } catch (error) {
      overviewDebug('Latest log fetch failed for', deviceId, error);
    }
    return null;
  }

  async function fetchCurrentMetrics(deviceId) {
    if (!deviceId || !state.shared?.utils?.jsonFetch) {
      return {};
    }
    const results = await Promise.allSettled(METRIC_KEYS.map(async (metricType) => {
      const params = new URLSearchParams({
        device_id: String(deviceId),
        metric: metricType
      });
      const url = `/api/metrics/latest?${params.toString()}`;
      const payload = await state.shared.utils.jsonFetch(url);
      if (!payload || payload.value == null) {
        return null;
      }
      let value = payload.value;
      if (value && typeof value === 'object' && typeof value.Float64 === 'number') {
        value = value.Float64;
      }
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        value = Number.isNaN(parsed) ? null : parsed;
      }
      if (typeof value !== 'number') {
        return null;
      }
      let unit = payload.unit;
      if (unit && typeof unit === 'object' && typeof unit.String === 'string') {
        unit = unit.String;
      }
      if (typeof unit !== 'string') {
        unit = getMetricUnit(metricType);
      }
      const timestamp = payload.ts || payload.timestamp || payload.time || null;
      return {
        metric: metricType,
        value,
        unit,
        timestamp
      };
    }));

    const metrics = {};
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        metrics[result.value.metric] = {
          value: result.value.value,
          unit: result.value.unit,
          timestamp: result.value.timestamp
        };
      }
    });
    return metrics;
  }

  function choosePreferredMetric(metrics) {
    if (!metrics || typeof metrics !== 'object') {
      return null;
    }
    const keys = Object.keys(metrics);
    if (!keys.length) {
      return null;
    }
    return METRIC_PRIORITY.find((key) => metrics[key] && Number.isFinite(metrics[key].value))
      || keys.find((key) => Number.isFinite(metrics[key]?.value))
      || keys[0];
  }

  function buildMetricSeriesOrder(preferredMetric, availableMetrics = {}) {
    const order = [];
    if (preferredMetric && !order.includes(preferredMetric)) {
      order.push(preferredMetric);
    }
    Object.keys(availableMetrics).forEach((key) => {
      if (!order.includes(key)) {
        order.push(key);
      }
    });
    METRIC_PRIORITY.forEach((metric) => {
      if (!order.includes(metric)) {
        order.push(metric);
      }
    });
    ADDITIONAL_METRIC_CANDIDATES.forEach((metric) => {
      if (!order.includes(metric)) {
        order.push(metric);
      }
    });
    return order;
  }

  function clipSeries(points, maxPoints = 180) {
    if (!Array.isArray(points) || points.length <= maxPoints) {
      return points || [];
    }
    const sorted = points.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const step = Math.ceil(sorted.length / maxPoints);
    const clipped = [];
    for (let i = 0; i < sorted.length; i += step) {
      clipped.push(sorted[i]);
    }
    if (clipped[clipped.length - 1] !== sorted[sorted.length - 1]) {
      clipped.push(sorted[sorted.length - 1]);
    }
    return clipped;
  }

  function getMetricColor(metric, index = 0) {
    if (metric && METRIC_COLOR_MAP[metric]) {
      return METRIC_COLOR_MAP[metric];
    }
    return METRIC_COLOR_PALETTE[index % METRIC_COLOR_PALETTE.length];
  }

  function normaliseMetricSeries(rows, metricType) {
    if (!Array.isArray(rows)) { return []; }
    const mapped = rows.map((row) => {
      if (!row || typeof row !== 'object') { return null; }
      const ts = row.ts ?? row.timestamp ?? row.time;
      let rawValue = row.value ?? row.v ?? row.val ?? row.metric_value ?? row[metricType];
      if (ts == null || rawValue == null) { return null; }
      const date = new Date(ts);
      if (Number.isNaN(date.getTime())) { return null; }
      if (rawValue && typeof rawValue === 'object') {
        if (typeof rawValue.Float64 === 'number') {
          rawValue = rawValue.Float64;
        } else if (typeof rawValue.String === 'string') {
          const parsed = parseFloat(rawValue.String);
          rawValue = Number.isNaN(parsed) ? rawValue : parsed;
        }
      }
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) { return null; }
      return { timestamp: date.toISOString(), value: numericValue };
    }).filter(Boolean);
    mapped.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return mapped;
  }

  function buildSyntheticSeries(metricSnapshot) {
    if (!metricSnapshot || metricSnapshot.value == null) {
      return [];
    }
    let baseValue = metricSnapshot.value;
    if (baseValue && typeof baseValue === 'object' && typeof baseValue.Float64 === 'number') {
      baseValue = baseValue.Float64;
    }
    if (typeof baseValue === 'string') {
      const parsed = parseFloat(baseValue);
      baseValue = Number.isNaN(parsed) ? null : parsed;
    }
    if (!Number.isFinite(Number(baseValue))) {
      return [];
    }
    baseValue = Number(baseValue);
    const now = Date.now();
    const points = [];
    for (let i = 24; i >= 0; i -= 1) {
      const ts = new Date(now - i * 60 * 60 * 1000);
      const wave = Math.sin(i / 3) * Math.max(Math.abs(baseValue) * 0.03, 0.35);
      const drift = (i % 2 === 0 ? 1 : -1) * Math.max(Math.abs(baseValue) * 0.01, 0.1);
      points.push({ timestamp: ts.toISOString(), value: baseValue + wave + drift });
    }
    return points;
  }

  async function fetchMetricSeries(deviceId, preferredMetric, availableMetrics = {}) {
    if (!deviceId || !state.shared?.utils?.jsonFetch) {
      return { series: {}, order: [] };
    }

    const series = {};
    const collectedOrder = [];
    const metricOrder = buildMetricSeriesOrder(preferredMetric, availableMetrics);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const limit = 288;

    for (const metricType of metricOrder) {
      const params = new URLSearchParams({
        device_id: String(deviceId),
        metric: metricType,
        since: since.toISOString(),
        limit: String(limit)
      });
      try {
        const response = await state.shared.utils.jsonFetch(`/api/metrics?${params.toString()}`);
        const points = normaliseMetricSeries(response, metricType);
        if (points.length) {
          series[metricType] = clipSeries(points, 180);
          collectedOrder.push(metricType);
        }
      } catch (error) {
        overviewDebug('Metric series request failed', { deviceId, metric: metricType, error });
      }
    }

    Object.keys(availableMetrics || {}).forEach((metricType) => {
      if (collectedOrder.includes(metricType)) {
        return;
      }
      const snapshot = availableMetrics[metricType];
      const synthetic = buildSyntheticSeries(snapshot);
      if (synthetic.length) {
        series[metricType] = clipSeries(synthetic, 180);
        collectedOrder.push(metricType);
      }
    });

    if (!collectedOrder.length && preferredMetric) {
      const fallbackSynthetic = buildSyntheticSeries(availableMetrics[preferredMetric]);
      if (fallbackSynthetic.length) {
        series[preferredMetric] = clipSeries(fallbackSynthetic, 180);
        collectedOrder.push(preferredMetric);
      }
    }

    return { series, order: collectedOrder };
  }

  function createSparkline(seriesMap, metricOrder = [], { width = 160, height = 56 } = {}) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.classList.add('device-card-sparkline');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    if (!seriesMap || typeof seriesMap !== 'object') {
      return svg;
    }

    const metrics = (Array.isArray(metricOrder) && metricOrder.length ? metricOrder : Object.keys(seriesMap));
    const seriesList = metrics.map((metric, index) => ({ metric, index, points: seriesMap[metric] || [] }))
      .filter((entry) => Array.isArray(entry.points) && entry.points.length);

    if (!seriesList.length) {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('x2', String(width));
      line.setAttribute('y1', String(height / 2));
      line.setAttribute('y2', String(height / 2));
      line.setAttribute('class', 'device-card-sparkline-placeholder');
      svg.appendChild(line);
      return svg;
    }

    const paddingX = 6;
    const paddingY = 6;
    const drawWidth = width - paddingX * 2;
    const drawHeight = height - paddingY * 2;

    const allTimes = [];
    const allValues = [];
    seriesList.forEach((entry) => {
      entry.points.forEach((point) => {
        const timeValue = new Date(point.timestamp).getTime();
        const numericValue = Number(point.value);
        if (Number.isFinite(timeValue)) { allTimes.push(timeValue); }
        if (Number.isFinite(numericValue)) { allValues.push(numericValue); }
      });
    });

    if (!allTimes.length || !allValues.length) {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('x2', String(width));
      line.setAttribute('y1', String(height / 2));
      line.setAttribute('y2', String(height / 2));
      line.setAttribute('class', 'device-card-sparkline-placeholder');
      svg.appendChild(line);
      return svg;
    }

    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(...allTimes);
    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    const timeRange = maxTime - minTime || 1;
    const valueRange = maxValue - minValue || 1;

    seriesList.forEach(({ metric, index, points }) => {
      const sorted = points.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const coords = sorted.map((point) => {
        const time = new Date(point.timestamp).getTime();
        const value = Number(point.value);
        const x = paddingX + ((time - minTime) / timeRange) * drawWidth;
        const normalised = (value - minValue) / valueRange;
        const y = height - paddingY - normalised * drawHeight;
        return { x, y };
      }).filter((coord) => Number.isFinite(coord.x) && Number.isFinite(coord.y));

      if (coords.length < 2) {
        return;
      }

      const pathData = coords.reduce((acc, coord, idx) => {
        const prefix = idx === 0 ? 'M' : 'L';
        return `${acc} ${prefix} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`.trim();
      }, '');

      const stroke = document.createElementNS(svgNS, 'path');
      stroke.setAttribute('d', pathData);
      stroke.setAttribute('fill', 'none');
      stroke.setAttribute('stroke', getMetricColor(metric, index));
      stroke.setAttribute('stroke-width', coords.length > 30 ? '1.6' : '1.8');
      stroke.setAttribute('stroke-linecap', 'round');
      stroke.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(stroke);

      const last = coords[coords.length - 1];
      const marker = document.createElementNS(svgNS, 'circle');
      marker.setAttribute('cx', last.x.toFixed(1));
      marker.setAttribute('cy', last.y.toFixed(1));
      marker.setAttribute('r', '1.8');
      marker.setAttribute('fill', getMetricColor(metric, index));
      svg.appendChild(marker);
    });

    return svg;
  }


  function focusDeviceCard(deviceId) {
    if (!deviceId || !state.grid) { return; }
    const card = state.grid.querySelector(`[data-device-id="${deviceId}"]`);
    if (!card) { return; }
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('card-highlight');
    setTimeout(() => { card.classList.remove('card-highlight'); }, 1600);
  }

  function renderNetworkMap(devicesList) {
    if (!state.networkMapEl || !state.networkMapNodes || !state.networkMapLinks) { return; }

    state.networkMapActiveDevices = Array.isArray(devicesList) ? devicesList.slice() : [];
    const hasDevices = state.networkMapActiveDevices.length > 0;

    if (!hasDevices) {
      state.networkMapNodes.innerHTML = '';
      while (state.networkMapLinks.firstChild) { state.networkMapLinks.removeChild(state.networkMapLinks.firstChild); }
      state.networkMapPanel?.classList.add('network-map-panel--empty');
      if (state.networkMapEmpty) { state.networkMapEmpty.classList.remove('hidden'); }
      return;
    }

    state.networkMapPanel?.classList.remove('network-map-panel--empty');
    if (state.networkMapEmpty) { state.networkMapEmpty.classList.add('hidden'); }

    const width = state.networkMapEl.clientWidth || state.networkMapEl.offsetWidth || state.networkMapEl.parentElement?.clientWidth || 920;
    const mapHeight = Math.round(Math.max(Math.min(width * 0.6, 620), 420));
    state.networkMapEl.style.setProperty('--network-map-height', `${mapHeight}px`);

    const height = mapHeight;
    const center = { x: width / 2, y: height / 2 };
    const radiusX = Math.max(160, width / 2 - 120);
    const radiusY = Math.max(150, height / 2 - 110);
    const isCompact = width < 720;
    const levelFactor = isCompact ? { kind: 0.36, platform: 0.68, device: 0.95 } : { kind: 0.42, platform: 0.74, device: 0.98 };

    function polar(angle, factor) {
      return {
        x: center.x + Math.cos(angle) * radiusX * factor,
        y: center.y + Math.sin(angle) * radiusY * factor
      };
    }

    function offsetFor(index, count, spread) {
      if (!Number.isFinite(index) || !Number.isFinite(count) || count <= 1 || spread <= 0) { return 0; }
      if (count === 2) { return index === 0 ? -spread / 2 : spread / 2; }
      const step = spread / (count - 1);
      return -spread / 2 + (step * index);
    }

    function formatDeviceCount(count) {
      const safe = Number(count) || 0;
      const suffix = safe === 1 ? 'device' : 'devices';
      return `${safe} ${suffix}`;
    }

    const groupsByKind = new Map();
    state.networkMapActiveDevices.forEach(device => {
      const kindKey = resolveKindKey(device?.kind) || `kind:${(device?.kind || 'unclassified').toString().toLowerCase()}`;
      const kindLabel = formatKindLabel(device?.kind || 'Unclassified');
      if (!groupsByKind.has(kindKey)) {
        groupsByKind.set(kindKey, {
          key: kindKey,
          label: kindLabel,
          total: 0,
          platforms: new Map()
        });
      }
      const kindGroup = groupsByKind.get(kindKey);
      kindGroup.total += 1;
      const platformRaw = (device?.platform || 'Unspecified').toString();
      const platformKey = platformRaw.trim().toLowerCase() || 'unspecified';
      if (!kindGroup.platforms.has(platformKey)) {
        kindGroup.platforms.set(platformKey, {
          key: platformKey,
          label: formatKindLabel(platformRaw || 'Unspecified'),
          devices: []
        });
      }
      kindGroup.platforms.get(platformKey).devices.push(device);
    });

    const kindGroups = Array.from(groupsByKind.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    const rootNode = {
      type: 'root',
      label: 'PulseOps Network',
      chip: formatDeviceCount(state.networkMapActiveDevices.length),
      subtitle: 'Grouped by device type and platform',
      x: center.x,
      y: center.y
    };

    const nodes = [rootNode];
    const links = [];
    const baseAngle = -Math.PI / 2;
    const kindCount = Math.max(kindGroups.length, 1);
    const platformSpreadBase = Math.min(Math.PI / Math.max(kindCount, 3), Math.PI / 1.65);

    kindGroups.forEach((kindGroup, kindIndex) => {
      const angle = baseAngle + ((2 * Math.PI * kindIndex) / kindCount);
      const kindPosition = polar(angle, levelFactor.kind);
      const kindNode = {
        type: 'kind',
        label: kindGroup.label,
        chip: formatDeviceCount(kindGroup.total),
        subtitle: 'Device type',
        x: kindPosition.x,
        y: kindPosition.y
      };
      nodes.push(kindNode);
      links.push({ from: rootNode, to: kindNode, level: 1 });

      const platformGroups = Array.from(kindGroup.platforms.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
      const platformSpread = platformGroups.length > 1 ? platformSpreadBase : platformSpreadBase * 0.6;

      platformGroups.forEach((platformGroup, platformIndex) => {
        const platformAngle = angle + offsetFor(platformIndex, platformGroups.length, platformSpread);
        const platformPosition = polar(platformAngle, levelFactor.platform);
        const platformNode = {
          type: 'platform',
          label: platformGroup.label,
          chip: formatDeviceCount(platformGroup.devices.length),
          subtitle: 'Platform',
          x: platformPosition.x,
          y: platformPosition.y
        };
        nodes.push(platformNode);
        links.push({ from: kindNode, to: platformNode, level: 2 });

        const deviceSpreadBase = platformSpread / Math.max(platformGroups.length, 1);
        const deviceList = platformGroup.devices.slice().sort((a, b) => {
          const nameA = (a?.name || a?.host || '').toString();
          const nameB = (b?.name || b?.host || '').toString();
          return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
        });
        const deviceSpread = Math.min(Math.PI / 2.6, Math.max(deviceSpreadBase * 0.75, Math.PI / 16));

        deviceList.forEach((device, deviceIndex) => {
          const deviceAngle = platformAngle + offsetFor(deviceIndex, deviceList.length, deviceSpread);
          const devicePosition = polar(deviceAngle, levelFactor.device);
          const deviceName = (device?.name || '').trim();
          const deviceHost = (device?.host || '').trim();
          const displayLabel = deviceName || deviceHost || `Device #${device?.id ?? ''}`;
          const platformLabel = formatKindLabel(device?.platform || 'Unspecified');
          const detailParts = [];
          if (platformLabel && platformLabel !== displayLabel) { detailParts.push(platformLabel); }
          if (deviceHost && deviceHost !== displayLabel) { detailParts.push(deviceHost); }
          const detail = detailParts.join(' • ');
          const status = getDeviceStatus(device);
          const statusText = status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : status === 'unreachable' ? 'Unreachable' : 'Unknown';
          const deviceNode = {
            type: 'device',
            label: displayLabel,
            subtitle: detailParts[0] || '',
            detail: detailParts.length > 1 ? detailParts.slice(1).join(' • ') : '',
            status,
            statusText,
            deviceId: device?.id,
            x: devicePosition.x,
            y: devicePosition.y,
            aria: `${displayLabel}${detail ? `. ${detail}` : ''}. ${statusText} status.`
          };
          nodes.push(deviceNode);
          links.push({ from: platformNode, to: deviceNode, level: 3 });
        });
      });
    });

    state.networkMapNodes.innerHTML = '';
    while (state.networkMapLinks.firstChild) { state.networkMapLinks.removeChild(state.networkMapLinks.firstChild); }

    const svgNS = 'http://www.w3.org/2000/svg';
    state.networkMapLinks.setAttribute('viewBox', `0 0 ${width} ${height}`);
    state.networkMapLinks.setAttribute('width', width);
    state.networkMapLinks.setAttribute('height', height);

    const defs = document.createElementNS(svgNS, 'defs');
    const gradient = document.createElementNS(svgNS, 'linearGradient');
    gradient.id = 'network-map-link-gradient';
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '100%');
    gradient.setAttribute('y2', '100%');

    const stopPrimary = document.createElementNS(svgNS, 'stop');
    stopPrimary.setAttribute('offset', '0%');
    stopPrimary.setAttribute('stop-color', 'var(--accent-secondary)');
    stopPrimary.setAttribute('stop-opacity', '0.95');
    const stopSecondary = document.createElementNS(svgNS, 'stop');
    stopSecondary.setAttribute('offset', '60%');
    stopSecondary.setAttribute('stop-color', 'var(--accent-primary)');
    stopSecondary.setAttribute('stop-opacity', '0.9');
    const stopTertiary = document.createElementNS(svgNS, 'stop');
    stopTertiary.setAttribute('offset', '100%');
    stopTertiary.setAttribute('stop-color', 'var(--text-primary)');
    stopTertiary.setAttribute('stop-opacity', '0.4');

    gradient.appendChild(stopPrimary);
    gradient.appendChild(stopSecondary);
    gradient.appendChild(stopTertiary);
    defs.appendChild(gradient);
    state.networkMapLinks.appendChild(defs);

    function createCurve(from, to, level) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy) || 1;
      const baseStrength = level === 1 ? 0.32 : level === 2 ? 0.28 : 0.24;
      const taper = level === 1 ? 1 : level === 2 ? 0.8 : 0.6;
      const curvature = Math.min(120, distance * baseStrength);
      const normalX = -dy / distance;
      const normalY = dx / distance;
      const c1x = from.x + dx * 0.25 + normalX * curvature;
      const c1y = from.y + dy * 0.25 + normalY * curvature;
      const c2x = from.x + dx * 0.75 + normalX * curvature * taper;
      const c2y = from.y + dy * 0.75 + normalY * curvature * taper;
      return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
    }

    links.forEach((link, index) => {
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('class', 'network-map-link');
      path.setAttribute('data-level', String(link.level));
      path.setAttribute('d', createCurve(link.from, link.to, link.level));
      const dash = 60 + (index % 5) * 18;
      const dashGap = Math.round(dash * 1.6);
      const offset = -1 * (dash + dashGap);
      path.style.setProperty('--dash-length', `${dash}`);
      path.style.setProperty('--dash-gap', `${dashGap}`);
      path.style.setProperty('--link-offset', `${offset}`);
      path.style.setProperty('--link-duration', `${6 + (index % 4)}s`);
      path.style.setProperty('--link-delay', `${(index % 7) * 0.35}s`);
      state.networkMapLinks.appendChild(path);
    });

    nodes.forEach(node => {
      const nodeEl = document.createElement('div');
      nodeEl.className = `map-node map-node--${node.type}`;
      nodeEl.style.left = `${node.x}px`;
      nodeEl.style.top = `${node.y}px`;

      const titleEl = document.createElement('div');
      titleEl.className = 'map-node-title';
      titleEl.textContent = node.label;
      nodeEl.appendChild(titleEl);

      if (node.chip) {
        const chipEl = document.createElement('div');
        chipEl.className = 'map-node-chip';
        chipEl.textContent = node.chip;
        nodeEl.appendChild(chipEl);
      }

      if (node.subtitle) {
        const subtitleEl = document.createElement('div');
        subtitleEl.className = 'map-node-meta';
        subtitleEl.textContent = node.subtitle;
        nodeEl.appendChild(subtitleEl);
      }

      if (node.detail) {
        const detailEl = document.createElement('div');
        detailEl.className = 'map-node-meta map-node-meta-detail';
        detailEl.textContent = node.detail;
        nodeEl.appendChild(detailEl);
      }

      if (node.type === 'device') {
        nodeEl.dataset.status = node.status;
        nodeEl.tabIndex = 0;
        nodeEl.setAttribute('role', 'button');
        if (node.aria) { nodeEl.setAttribute('aria-label', node.aria); }
        const statusEl = document.createElement('div');
        statusEl.className = 'map-node-status';
        const dotEl = document.createElement('span');
        dotEl.className = `map-node-status-dot ${node.status}`;
        statusEl.appendChild(dotEl);
        const textEl = document.createElement('span');
        textEl.textContent = node.statusText;
        statusEl.appendChild(textEl);
        nodeEl.appendChild(statusEl);
        nodeEl.addEventListener('click', () => focusDeviceCard(node.deviceId));
        nodeEl.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter' || evt.key === ' ') {
            evt.preventDefault();
            focusDeviceCard(node.deviceId);
          }
        });
      } else {
        nodeEl.setAttribute('aria-hidden', 'true');
      }

      state.networkMapNodes.appendChild(nodeEl);
    });
  }

  function render() {
    state.renderScheduled = false;
    const devices = Array.isArray(state.devices) ? state.devices : [];
    pruneMissingSummaries(devices);
    const filtered = applyFilters(devices);

    const geoService = state.shared?.services?.geolocation || null;
    if (geoService) {
      filtered.forEach((device) => ensureDeviceGeolocation(device, geoService));
    }

    const devicePairs = filtered.map((device) => ({
      device,
      summary: ensureDeviceSummary(device)
    }));

    publishAgentContext(buildOverviewAgentContext(devicePairs, { total: devices.length, filtered: filtered.length }));

    renderNetworkMap(filtered);

    if (!state.grid || !state.empty) { return; }

    closeActiveMenu();
    state.grid.innerHTML = '';
    if (!filtered.length) {
      state.empty.classList.remove('hidden');
      state.grid.classList.add('hidden');
      return;
    }
    state.empty.classList.add('hidden');
    state.grid.classList.remove('hidden');
    const fragment = document.createDocumentFragment();
    devicePairs.forEach(({ device, summary }) => {
      const card = createDeviceCard(device, summary);
      card.setAttribute('data-device-id', device.id);
      fragment.appendChild(card);
    });
    state.grid.appendChild(fragment);
  }

  function resetFilters() {
    state.filters.kind = '';
    state.filters.status = '';
    state.filters.query = '';
    if (state.typeSelect) { state.typeSelect.value = ''; }
    if (state.statusSelect) { state.statusSelect.value = ''; }
    if (state.searchInput) { state.searchInput.value = ''; }
    render();
  }

  function setupStandaloneListeners() {
    if (state.typeSelect) {
      state.typeSelect.addEventListener('change', () => {
        state.filters.kind = state.typeSelect.value;
        render();
      });
    }
    if (state.statusSelect) {
      state.statusSelect.addEventListener('change', () => {
        state.filters.status = state.statusSelect.value;
        render();
      });
    }
    if (state.searchInput) {
      state.searchInput.addEventListener('input', () => {
        state.filters.query = state.searchInput.value;
        render();
      });
    }
    if (state.resetButton) {
      state.resetButton.addEventListener('click', resetFilters);
    }
  }

  async function bootstrapStandalone() {
    if (state.standaloneInitialised) {
      return;
    }
    state.standaloneInitialised = true;
    state.standalone = true;
    state.shared = getShared();
    state.section = document.querySelector('#view-overview');
    state.grid = document.querySelector('#devices');
    state.empty = document.querySelector('#overview-empty');
    state.typeSelect = document.querySelector('#device-type-filter');
    state.statusSelect = document.querySelector('#device-status-filter');
    state.searchInput = document.querySelector('#device-search-filter');
    state.resetButton = document.querySelector('#device-filters-reset');
    state.networkMapEl = document.querySelector('#network-map');
    state.networkMapNodes = document.querySelector('#network-map-nodes');
    state.networkMapLinks = document.querySelector('#network-map-links');
    state.networkMapEmpty = document.querySelector('#network-map-empty');
    state.networkMapPanel = document.querySelector('#network-map-panel');

    updateOverviewLoadingState();

    setupStandaloneListeners();

    const interactions = getDeviceInteractions();
    interactions.init?.();

    state.unsubscribe = state.shared.stores.devices.subscribe((devices) => {
      state.devices = Array.isArray(devices) ? devices : [];
      updateTypeFilterOptions(state.devices);
      render();
    });

    await state.shared.stores.devices.load();
    render();
  }

  const controller = {
    async init(context) {
      state.shared = context.shared;
      state.section = context.section;
      state.grid = context.section.querySelector('#devices');
      state.empty = context.section.querySelector('#overview-empty');
      state.typeSelect = context.section.querySelector('#device-type-filter');
      state.statusSelect = context.section.querySelector('#device-status-filter');
      state.searchInput = context.section.querySelector('#device-search-filter');
      state.resetButton = context.section.querySelector('#device-filters-reset');
      state.networkMapEl = context.section.querySelector('#network-map');
      state.networkMapNodes = context.section.querySelector('#network-map-nodes');
      state.networkMapLinks = context.section.querySelector('#network-map-links');
      state.networkMapEmpty = context.section.querySelector('#network-map-empty');
      state.networkMapPanel = context.section.querySelector('#network-map-panel');

      updateOverviewLoadingState();

      if (state.typeSelect) {
        state.typeSelect.addEventListener('change', () => {
          state.filters.kind = state.typeSelect.value;
          render();
        });
      }
      if (state.statusSelect) {
        state.statusSelect.addEventListener('change', () => {
          state.filters.status = state.statusSelect.value;
          render();
        });
      }
      if (state.searchInput) {
        state.searchInput.addEventListener('input', () => {
          state.filters.query = state.searchInput.value;
          render();
        });
      }
      if (state.resetButton) {
        state.resetButton.addEventListener('click', resetFilters);
      }

      getDeviceInteractions().init?.();

      state.unsubscribe = context.shared.stores.devices.subscribe((devices) => {
        state.devices = Array.isArray(devices) ? devices : [];
        updateTypeFilterOptions(state.devices);
        render();
      });

      await context.shared.stores.devices.load();
      render();
    },
    onShow(context) {
      context.shared.stores.devices.load();
    },
    onHide() {},
    destroy() {
      if (typeof state.unsubscribe === 'function') {
        state.unsubscribe();
        state.unsubscribe = null;
      }
      if (state.overviewLoadingToken && state.shared?.loading && typeof state.shared.loading.done === 'function') {
        state.shared.loading.done(state.overviewLoadingToken);
      }
      state.overviewLoadingToken = null;
      state.overviewLoading = false;
      state.renderScheduled = false;
      if (state.section) {
        state.section.classList.remove('view-section--loading');
        state.section.removeAttribute('data-loading');
      }
      state.section = null;
    }
  };

  views.overview = controller;

  PulseOps.whenReady(() => {
    if (document.body.dataset.page === 'dashboard') {
      bootstrapStandalone();
    }
  });
})(window, document);
