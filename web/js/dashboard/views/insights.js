(function (window, document) {
  'use strict';

  const PulseOps = window.PulseOps = window.PulseOps || {};
  const views = PulseOps.views = PulseOps.views || {};
  let sharedInstance = null;

  function ensureShared() {
    if (!sharedInstance) {
      const base = PulseOps.shared;
      sharedInstance = base && typeof base.ensureReady === 'function' ? base.ensureReady() : base;
    }
    return sharedInstance;
  }

  function attachGeoTooltip(element, value) {
    if (!(element instanceof Element)) { return; }
    const shared = state.shared || ensureShared();
    const utils = shared?.utils;
    if (utils?.attachGeoTooltip) {
      utils.attachGeoTooltip(element, value);
    }
  }

  function resolveDeviceLocation(device) {
    const shared = ensureShared();
    const resolver = shared?.utils?.resolveNetworkLocation;
    if (typeof resolver !== 'function') {
      return null;
    }
    return resolver(device);
  }

  // Device insights page module - can work both as standalone and as part of main dashboard

  const cloneDeep = (value) => {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  };

  const SAMPLE_METRICS = Array.from({ length: 12 }).map((_, index) => ({
    timestamp: new Date(Date.now() - (11 - index) * 30 * 60 * 1000).toISOString(),
    value: 10 + Math.random() * 5 + index
  }));


  const SAMPLE_LOGS = [
    {
      id: 1,
      level: 'info',
      message: 'Interface ge-0/0/0 transitioned to up.',
      timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString()
    },
    {
      id: 2,
      level: 'warn',
      message: 'Packet loss threshold exceeded for WAN circuit.',
      timestamp: new Date(Date.now() - 55 * 60 * 1000).toISOString()
    },
    {
      id: 3,
      level: 'info',
      message: 'Configuration backup completed.',
      timestamp: new Date(Date.now() - 80 * 60 * 1000).toISOString()
    }
  ];

  // ---- Constants & helpers ----
  const METRIC_KEYS = ['ping_ms', 'iperf_mbps', 'cpu_usage', 'memory_usage', 'temperature'];
  const METRIC_PRIORITY = ['ping_ms', 'iperf_mbps', 'cpu_usage', 'memory_usage', 'temperature'];
  const METRIC_LABELS = {
    ping_ms: 'Ping Latency (ms)',
    iperf_mbps: 'Bandwidth (Mbps)',
    cpu_usage: 'CPU Usage (%)',
    memory_usage: 'Memory Usage (%)',
    temperature: 'Temperature (°C)'
  };
  const METRIC_TITLES_SHORT = {
    ping_ms: 'Ping',
    iperf_mbps: 'Bandwidth',
    cpu_usage: 'CPU',
    memory_usage: 'Memory',
    temperature: 'Temperature'
  };
  const UPDATE_INTERVAL_MS = 30000; // 30s

  function withBusy(buttonEl, fn) {
    if (!buttonEl) return fn();
    buttonEl.disabled = true;
    return Promise.resolve()
      .then(fn)
      .finally(() => { buttonEl.disabled = false; });
  }

  const state = {
    shared: null,
    elements: {},
    chart: null,
    overviewChart: null,
    metricCharts: {},
    selectedDeviceId: null,
    unsubscribeDevices: null,
    initialSyncComplete: false,
    standaloneInitialised: false,
    statusBadge: null,
    statusDetailEl: null,
    statusRefreshTimer: null
  };

  // Debug gate for insights page
  function insightsDebugEnabled() {
    try {
      const url = new URL(window.location.href);
      const v = (url.searchParams.get('debugInsights') || '').toLowerCase();
      return v === '1' || v === 'true';
    } catch (_) {
      return false;
    }
  }

  function dbg(...args) {
    if (insightsDebugEnabled()) {
      console.debug(...args);
    }
  }
  // Public debug toggles (matches monolith behaviour)
  (function installInsightsDebugToggles() {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = (params.get('debugInsights') || '').toLowerCase();
      if (v === '1' || v === 'true') {
        try { localStorage.setItem('pulseops-debug-insights', '1'); } catch (_) { }
      }
    } catch (_) { }
    window.PULSEOPS_INSIGHTS_DEBUG = {
      enable() { try { localStorage.setItem('pulseops-debug-insights', '1'); } catch (_) { } },
      disable() { try { localStorage.removeItem('pulseops-debug-insights'); } catch (_) { } },
      state() { return { url: window.location.href, route: document.body?.dataset?.route }; }
    };
  })();

  function readDeviceIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      const value = url.searchParams.get('deviceId');
      return value ? value.trim() : null;
    } catch (error) {
      dbg('Unable to read deviceId from URL', error);
      return null;
    }
  }

  function updateDeviceParamInUrl(deviceId) {
    try {
      const url = new URL(window.location.href);
      if (deviceId) {
        url.searchParams.set('deviceId', deviceId);
      } else {
        url.searchParams.delete('deviceId');
      }
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (error) {
      dbg('Unable to update deviceId in URL', error);
    }
  }

  function setSelectedDevice(deviceId, { updateUrl = true, refresh = true, force = false } = {}) {
    const normalised = deviceId != null && deviceId !== '' ? String(deviceId) : null;
    const changed = normalised !== state.selectedDeviceId;
    state.selectedDeviceId = normalised;

    const select = state.elements.deviceSelect;
    if (select) {
      const desiredValue = normalised ?? '';
      if (normalised && !Array.from(select.options).some((option) => option.value === normalised)) {
        const placeholder = document.createElement('option');
        placeholder.value = normalised;
        placeholder.textContent = `Device ${normalised}`;
        select.appendChild(placeholder);
      }
      if (select.value !== desiredValue) {
        select.value = desiredValue;
      }
    }

    if (state.elements.refreshBtn) {
      state.elements.refreshBtn.disabled = !normalised;
    }

    if (updateUrl) {
      updateDeviceParamInUrl(normalised);
    }

    if (!normalised) {
      setEmptyState();
      return;
    }

    if (refresh && (changed || force)) {
      refreshInsights(normalised);
    }
  }

  function populateDeviceSelect(devices) {
    const select = state.elements.deviceSelect;
    if (!select) { return; }
    select.innerHTML = '<option value="">Select a device…</option>';
    const frag = document.createDocumentFragment();
    devices.forEach((device) => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.name || device.host || `Device ${device.id}`;
      frag.appendChild(option);
    });
    select.appendChild(frag);
    setSelectedDevice(state.selectedDeviceId, { updateUrl: false, refresh: false });
  }
  // Fallback population via API if the shared store is empty or slow
  async function ensureInsightsDeviceOptions() {
    dbg('ensureInsightsDeviceOptions: start');
    const select = state.elements.deviceSelect;
    if (!select) { return; }
    const hasRealOptions = select.options && select.options.length > 1;
    if (hasRealOptions) { dbg('ensureInsightsDeviceOptions: options already present'); return; }
    try {
      const shared = state.shared || ensureShared();
      if (!shared?.utils?.jsonFetch) { return; }
      const list = await shared.utils.jsonFetch('/api/devices', {
        cache: 'no-cache',
        loadingLabel: 'Loading devices'
      });
      dbg('ensureInsightsDeviceOptions: fetched fallback list', { count: Array.isArray(list) ? list.length : 0 });
      if (Array.isArray(list)) {
        select.innerHTML = '<option value=\"\">Select a device…</option>';
        list.forEach((d) => {
          const id = d.id != null ? d.id : d.device_id;
          const opt = document.createElement('option');
          opt.value = String(id);
          const name = d.name || d.hostname || `Device #${id}`;
          const ip = d.ip || d.address || '';
          opt.textContent = ip ? `${name} (${ip})` : name;
          if (ip) {
            attachGeoTooltip(opt, ip);
          }
          select.appendChild(opt);
        });
      }
    } catch (e) {
      if (insightsDebugEnabled()) { console.warn('ensureInsightsDeviceOptions failed', e); }
    }
  }

  function setEmptyState() {
    state.elements.content.classList.add('hidden');
    state.elements.empty.classList.remove('hidden');
    state.elements.refreshBtn.disabled = true;
    stopMetricsUpdates();
    stopStatusUpdates();
  }

  function showContent() {
    state.elements.empty.classList.add('hidden');
    state.elements.content.classList.remove('hidden');
    state.elements.refreshBtn.disabled = false;
  }

  function renderDeviceSummary(device) {
    const container = state.elements.deviceContainer;
    const meta = state.elements.meta;
    if (!container || !meta) { return; }
    container.innerHTML = '';
    meta.innerHTML = '';
    stopStatusUpdates();
    state.statusBadge = null;
    state.statusDetailEl = null;
    if (!device) {
      container.textContent = 'Device not found.';
      return;
    }

    dbg('[Insights] Rendering device summary for:', device);

    const title = document.createElement('h3');
    title.textContent = device.name || device.host || `Device ${device.id}`;
    container.appendChild(title);
    const subtitle = document.createElement('p');
    subtitle.className = 'muted insights-device-subtitle';
    const shared = ensureShared();
    const utils = shared?.utils || {};
    const escapeHTML = typeof utils.escapeHTML === 'function' ? utils.escapeHTML : (value) => String(value ?? '');
    const locationDetails = resolveDeviceLocation(device);
    const badgeFactory = shared?.ui?.createPlatformBadge || shared?.utils?.createPlatformBadge;
    const platformLabel = device.platform_display || device.platform || 'Unknown platform';
    let badgeRendered = false;
    if (typeof badgeFactory === 'function') {
      try {
        const badge = badgeFactory(platformLabel, { variant: 'inline' });
        if (badge) {
          subtitle.appendChild(badge);
          badgeRendered = true;
        }
      } catch (error) {
        if (insightsDebugEnabled()) { console.warn('Unable to render platform badge', error); }
      }
    }
    if (!badgeRendered) {
      const fallback = document.createElement('span');
      fallback.className = 'platform-badge-fallback';
      fallback.textContent = platformLabel;
      subtitle.appendChild(fallback);
    }
    if (subtitle.childNodes.length) {
      const separator = document.createElement('span');
      separator.className = 'insights-device-subtitle-separator';
      separator.textContent = '•';
      separator.setAttribute('aria-hidden', 'true');
      subtitle.appendChild(separator);
    }
    const hostSpan = document.createElement('span');
    hostSpan.textContent = device.host || '—';
    attachGeoTooltip(hostSpan, device.host);
    subtitle.appendChild(hostSpan);
    if (locationDetails) {
      const separator = document.createElement('span');
      separator.className = 'insights-device-subtitle-separator';
      separator.textContent = '•';
      separator.setAttribute('aria-hidden', 'true');
      subtitle.appendChild(separator);

      const locationTag = document.createElement('span');
      locationTag.className = `insights-location-tag network-location-badge network-location-badge--${locationDetails.category}`;
      locationTag.textContent = locationDetails.label;
      if (locationDetails.description || locationDetails.reason) {
        locationTag.title = locationDetails.description || locationDetails.reason;
      }
      subtitle.appendChild(locationTag);
    }

    const statusModule = window.PulseOps?.deviceStatus;
    if (statusModule && typeof statusModule.createBadge === 'function') {
      if (subtitle.childNodes.length) {
        const separator = document.createElement('span');
        separator.className = 'insights-device-subtitle-separator';
        separator.textContent = '•';
        separator.setAttribute('aria-hidden', 'true');
        subtitle.appendChild(separator);
      }
      const statusWrapper = document.createElement('span');
      statusWrapper.className = 'insights-device-status';
      const badge = statusModule.createBadge('loading');
      badge.title = 'Checking status…';
      statusWrapper.appendChild(badge);
      subtitle.appendChild(statusWrapper);
      state.statusBadge = badge;
    } else {
      state.statusBadge = null;
    }
    container.appendChild(subtitle);

    const details = document.createElement('div');
    details.className = 'insights-meta-grid';
    const hostDisplay = device.host || '—';
    details.innerHTML = `
      <div><strong>Kind</strong><span>${formatKind(device.kind)}</span></div>
      <div><strong>Server</strong><span data-role="insights-server">${escapeHTML(hostDisplay)}</span></div>
      <div><strong>Location</strong><span class="insights-location-value">${locationDetails ? locationDetails.label : '—'}</span></div>
      <div><strong>Managed by</strong><span>${device.user || '—'}</span></div>
      <div><strong>Platform</strong><span class="insights-platform-value"></span></div>
      <div><strong>Status</strong><span class="insights-status-value">${statusModule ? 'Checking…' : formatStatus(device.status)}</span></div>
    `;
    const serverSpan = details.querySelector('[data-role="insights-server"]');
    if (serverSpan) {
      attachGeoTooltip(serverSpan, device.host);
    }
    container.appendChild(details);

    const platformTarget = details.querySelector('.insights-platform-value');
    if (platformTarget) {
      let badge = null;
      if (typeof badgeFactory === 'function') {
        try {
          badge = badgeFactory(platformLabel);
        } catch (error) {
          if (insightsDebugEnabled()) { console.warn('Unable to render platform badge details', error); }
        }
      }
      if (badge) {
        platformTarget.appendChild(badge);
      } else {
        platformTarget.textContent = platformLabel;
      }
    }

    const locationTarget = details.querySelector('.insights-location-value');
    if (locationTarget) {
      if (locationDetails) {
        locationTarget.textContent = locationDetails.label;
        if (locationDetails.description || locationDetails.reason) {
          locationTarget.title = locationDetails.description || locationDetails.reason;
        } else {
          locationTarget.removeAttribute('title');
        }
      } else {
        locationTarget.textContent = '—';
        locationTarget.removeAttribute('title');
      }
    }

    state.statusDetailEl = details.querySelector('.insights-status-value');
    if (state.statusDetailEl && (!statusModule || typeof statusModule.getStatus !== 'function')) {
      state.statusDetailEl.textContent = formatStatus(device.status);
    }

    // Add current metrics display
    const metricsContainer = document.createElement('div');
    metricsContainer.className = 'insights-current-metrics';
    metricsContainer.innerHTML = '<h4>Current Metrics</h4><div id="current-metrics-grid" class="insights-meta-grid"></div>';
    container.appendChild(metricsContainer);

    meta.innerHTML = `
      <p>Historical metrics cover the last six hours. Below you’ll see an overall chart and separate charts for each metric.</p>
    `;

    if (statusModule && typeof statusModule.getStatus === 'function') {
      refreshInsightsStatus(device, { forceRefresh: true });
    }
  }

  function formatKind(value) {
    if (!value) { return '—'; }
    return value.replace(/[_\s]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatStatus(value) {
    const statusModule = window.PulseOps?.deviceStatus;
    if (statusModule?.formatStatus) {
      return statusModule.formatStatus(value);
    }
    const norm = (value || '').toString().toLowerCase();
    if (!norm) { return 'Unknown'; }
    return norm.replace(/[_\s]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function refreshInsightsStatus(device, { forceRefresh = false } = {}) {
    const statusModule = window.PulseOps?.deviceStatus;
    if (!statusModule || typeof statusModule.getStatus !== 'function') {
      if (state.statusBadge) {
        state.statusBadge.textContent = formatStatus(device?.status);
      }
      if (state.statusDetailEl) {
        state.statusDetailEl.textContent = formatStatus(device?.status);
      }
      return;
    }

    if (!device) {
      if (state.statusBadge) {
        statusModule.updateBadge(state.statusBadge, 'unknown');
        state.statusBadge.title = 'Status unavailable';
      }
      if (state.statusDetailEl) {
        state.statusDetailEl.textContent = 'Unknown';
      }
      stopStatusUpdates();
      return;
    }

    if (state.statusBadge) {
      statusModule.updateBadge(state.statusBadge, 'loading', { label: 'Checking…' });
      state.statusBadge.title = 'Checking status…';
    }
    if (state.statusDetailEl) {
      state.statusDetailEl.textContent = 'Checking…';
    }

    statusModule.getStatus(device, { forceRefresh }).then((result) => {
      if (state.statusBadge?.isConnected) {
        statusModule.updateBadge(state.statusBadge, result.status);
        state.statusBadge.title = statusModule.formatStatusTooltip
          ? statusModule.formatStatusTooltip(result)
          : buildStatusTooltipFallback(result);
      }
      if (state.statusDetailEl) {
        state.statusDetailEl.textContent = result.label || statusModule.formatStatus(result.status);
      }
      scheduleStatusUpdates(device);
    }).catch((error) => {
      console.warn('[Insights] Failed to resolve device status', device?.id, error);
      if (state.statusBadge?.isConnected) {
        statusModule.updateBadge(state.statusBadge, 'unknown');
        state.statusBadge.title = 'Unable to determine status';
      }
      if (state.statusDetailEl) {
        state.statusDetailEl.textContent = 'Unknown';
      }
      scheduleStatusUpdates(device);
    });
  }

  function scheduleStatusUpdates(device) {
    const statusModule = window.PulseOps?.deviceStatus;
    if (!statusModule || !device || device.id == null) { return; }
    stopStatusUpdates();
    const interval = statusModule.REFRESH_INTERVAL_MS || UPDATE_INTERVAL_MS;
    state.statusRefreshTimer = setTimeout(() => {
      if (!state.statusBadge?.isConnected) {
        state.statusRefreshTimer = null;
        return;
      }
      refreshInsightsStatus(device, { forceRefresh: true });
    }, interval);
  }

  function stopStatusUpdates() {
    if (state.statusRefreshTimer) {
      clearTimeout(state.statusRefreshTimer);
      state.statusRefreshTimer = null;
    }
  }

  function buildStatusTooltipFallback(result) {
    if (!result) { return 'Status unavailable'; }
    const parts = [];
    const label = result.label || formatStatus(result.status);
    if (label) { parts.push(label); }
    if (Number.isFinite(result.pingValue)) {
      const value = result.pingValue >= 100 ? result.pingValue.toFixed(0) : result.pingValue.toFixed(1);
      parts.push(`Ping ${value} ms`);
    }
    if (typeof result.pingAgeMs === 'number') {
      const statusModule = window.PulseOps?.deviceStatus;
      const age = statusModule?.formatAge ? statusModule.formatAge(result.pingAgeMs) : formatAgeFallback(result.pingAgeMs);
      parts.push(`${age} ago`);
    }
    return parts.join(' • ') || 'Status unavailable';
  }

  function formatAgeFallback(ageMs) {
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

  async function loadMetrics(deviceId) {
    // Try last 6 hours as initial window; widen automatically in fetchAllMetricsSmart
    const initialSince = new Date(Date.now() - 6 * 60 * 60 * 1000);

    // Use any currently selected metric as a preference hint
    const preferredSelect = document.getElementById('metric-type-select');
    const preferredMetric = preferredSelect?.value || undefined;

    const discovered = await fetchAllMetricsSmart({ deviceId: String(deviceId), initialSince, preferredMetric });

    // Persist everything for the selector and switching
    state.allMetrics = discovered;

    const keys = Object.keys(discovered);

    if (!keys.length) {
      return { data: cloneDeep(SAMPLE_METRICS), type: 'ping_ms' };
    }

    // Choose a metric to chart: first by priority, else the first discovered
    const chosen = METRIC_PRIORITY.find((m) => keys.includes(m)) || keys[0];
    return { data: discovered[chosen], type: chosen };
  }

  function getMetricUnit(metricType) {
    const units = {
      'ping_ms': 'ms',
      'iperf_mbps': 'Mbps',
      'cpu_usage': '%',
      'memory_usage': '%',
      'temperature': '°C'
    };
    return units[metricType] || '';
  }

  // ---- Insights: robust metrics discovery & normalisation ----
  async function fetchJsonOk(url) {
    // Use shared jsonFetch but surface HTTP errors consistently
    try {
      const data = await state.shared.utils.jsonFetch(url);
      return data;
    } catch (e) {
      throw e;
    }
  }

  function buildMetricSeriesOrder(preferredMetric) {
    const order = [];
    if (preferredMetric && !order.includes(preferredMetric)) {
      order.push(preferredMetric);
    }
    METRIC_PRIORITY.forEach((metric) => {
      if (!order.includes(metric)) {
        order.push(metric);
      }
    });
    return order;
  }

  function normaliseMetricRows(rows, metricType) {
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.map((row) => {
      if (!row || typeof row !== 'object') { return null; }
      const ts = row.ts ?? row.timestamp ?? row.time;
      let rawValue = row.value ?? row.v ?? row.val ?? row.metric_value ?? row[metricType];
      if (ts == null || rawValue == null) { return null; }
      const parsedDate = new Date(ts);
      if (Number.isNaN(parsedDate.getTime())) { return null; }
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
      return { timestamp: parsedDate.toISOString(), value: numericValue };
    }).filter(Boolean);
  }

  async function fetchAllMetricsSmart({ deviceId, initialSince, preferredMetric }) {
    if (!deviceId) {
      return {};
    }

    const metrics = {};
    const metricCandidates = buildMetricSeriesOrder(preferredMetric);
    const windows = [
      { since: initialSince, limit: 180 },
      { since: new Date(Date.now() - 24 * 3600 * 1000), limit: 288 },
      { since: new Date(Date.now() - 7 * 24 * 3600 * 1000), limit: 336 }
    ];

    for (const metricType of metricCandidates) {
      for (const windowConfig of windows) {
        const params = new URLSearchParams({
          device_id: String(deviceId),
          metric: metricType,
          since: windowConfig.since.toISOString(),
          limit: String(windowConfig.limit)
        });
        const url = `/api/metrics?${params.toString()}`;
        try {
          const response = await fetchJsonOk(url);
          const points = normaliseMetricRows(response, metricType);
          if (points.length) {
            points.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            metrics[metricType] = points;
            break;
          }
        } catch (e) {
          dbg('[Insights] Metric fetch failed', { url, metric: metricType, error: e?.message || e });
        }
      }
    }

    return metrics;
  }

  async function loadDeviceLogs(deviceId) {
    const params = new URLSearchParams({
      device_id: String(deviceId),
      source: 'device',
      limit: '10'
    });
    try {
      const response = await state.shared.utils.jsonFetch(`/api/logs?${params.toString()}`);
      if (Array.isArray(response) && response.length) {
        return response.map((entry) => ({
          id: entry.id,
          level: entry.level,
          message: entry.message,
          timestamp: entry.timestamp
        }));
      }
    } catch (error) {
      if (insightsDebugEnabled()) { console.warn('Failed to load device logs', error); }
    }
    return cloneDeep(SAMPLE_LOGS);
  }

  function findChartForCanvas(canvas) {
    if (!canvas || !window.Chart) { return null; }

    const seen = new Set();
    const pick = (candidate) => {
      if (!candidate || typeof candidate.destroy !== 'function') { return null; }
      if (seen.has(candidate)) { return null; }
      seen.add(candidate);
      return candidate;
    };

    if (typeof Chart.getChart === 'function') {
      const direct = pick(Chart.getChart(canvas));
      if (direct) { return direct; }
      if (canvas.id) {
        const byId = pick(Chart.getChart(canvas.id));
        if (byId) { return byId; }
      }
      const context = canvas.getContext?.('2d');
      if (context) {
        const byContext = pick(Chart.getChart(context));
        if (byContext) { return byContext; }
      }
    }

    const instances = Chart.instances;
    if (!instances) { return null; }
    const items = instances instanceof Map
      ? Array.from(instances.values())
      : Array.isArray(instances)
        ? instances
        : Object.values(instances);
    return items.find((chart) => pick(chart) && chart.canvas === canvas) || null;
  }

  // Helper to destroy any existing Chart.js instance on the canvas
  function destroyChartIfExists(canvasOverride) {
    try {
      const canvas = canvasOverride || state.elements.overviewCanvas;
      if (!canvas) { return; }

      const chartsToDestroy = new Set();
      if (state.chart?.canvas === canvas) {
        chartsToDestroy.add(state.chart);
      }
      const located = findChartForCanvas(canvas);
      if (located) {
        chartsToDestroy.add(located);
      }

      chartsToDestroy.forEach((chart) => {
        try {
          chart.destroy();
        } catch (err) {
          dbg('[Insights] Chart destroy warning:', err?.message || err);
        }
      });

      if (!canvasOverride || canvasOverride === state.elements.overviewCanvas) {
        state.chart = null;
      }
    } catch (e) {
      dbg('[Insights] destroyChartIfExists noop:', e?.message || e);
    }
  }

  function destroyOverviewChart() {
    if (state.overviewChart) {
      try { state.overviewChart.destroy(); } catch (_) {}
      state.overviewChart = null;
    }
    destroyChartIfExists(state.elements?.overviewCanvas);
  }

  function destroyMetricCharts() {
    if (state.metricCharts && typeof state.metricCharts === 'object') {
      Object.values(state.metricCharts).forEach((ch) => { try { ch.destroy(); } catch (_) {} });
    }
    state.metricCharts = {};
    const wrap = state.elements?.metricChartsContainer;
    if (wrap) { wrap.innerHTML = ''; }
  }

  function updateOverviewChart(allMetrics) {
    const canvas = state.elements.overviewCanvas;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !allMetrics) { return; }

    // Build datasets with x/y points so timelines don’t need a merged label array
    const datasets = Object.keys(allMetrics).map((metricType) => {
      const cfg = getMetricConfig(metricType);
      const data = (allMetrics[metricType] || []).map((p) => ({ x: new Date(p.timestamp), y: Number(p.value) || 0 }));
      return {
        label: cfg.label,
        borderColor: cfg.color,
        backgroundColor: cfg.backgroundColor,
        tension: 0.3,
        data,
        pointRadius: 0
      };
    });

    // Tear down any previous chart on this canvas
    destroyOverviewChart();

    if (window.Chart) {
      state.overviewChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          resizeDelay: 120,
          parsing: false,
          scales: {
            x: { type: 'time', time: { tooltipFormat: 'HH:mm' } },
            y: { beginAtZero: true, title: { display: true, text: 'Value (mixed units)' } }
          },
          plugins: {
            legend: { position: 'top' },
            tooltip: { mode: 'nearest', intersect: false }
          }
        }
      });
    }
  }

  function renderMetricCharts(allMetrics) {
    const wrap = state.elements.metricChartsContainer;
    if (!wrap) { return; }

    // Clear old charts and DOM
    destroyMetricCharts();

    const fragment = document.createDocumentFragment();
    Object.keys(allMetrics).forEach((metricType) => {
      const points = allMetrics[metricType] || [];
      const cfg = getMetricConfig(metricType);

      const container = document.createElement('div');
      container.className = 'metric-chart-card';

      const h4 = document.createElement('h4');
      h4.textContent = cfg.label;
      container.appendChild(h4);

      const canvas = document.createElement('canvas');
      canvas.id = `metric-chart-${metricType}`;
      container.appendChild(canvas);

      fragment.appendChild(container);

      const labels = points.map((p) => new Date(p.timestamp));
      const data = points.map((p) => Number(p.value) || 0);

      const ctx = canvas.getContext('2d');
      if (window.Chart && ctx) {
        const chart = new Chart(ctx, {
          type: 'line',
          data: { labels, datasets: [{ label: cfg.label, borderColor: cfg.color, backgroundColor: cfg.backgroundColor, tension: 0.3, data }] },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 120,
            scales: {
              x: { type: 'time', time: { unit: 'hour' } },
              y: { beginAtZero: true, title: { display: true, text: cfg.yAxisLabel } }
            },
            plugins: { legend: { display: false } }
          }
        });
        state.metricCharts[metricType] = chart;
      }
    });

    wrap.appendChild(fragment);
  }

  function getMetricConfig(metricType) {
    const configs = {
      'ping_ms': {
        label: 'Ping Latency',
        color: 'rgb(99, 102, 241)',
        backgroundColor: 'rgba(99, 102, 241, 0.2)',
        yAxisLabel: 'Milliseconds'
      },
      'iperf_mbps': {
        label: 'Bandwidth',
        color: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.2)',
        yAxisLabel: 'Mbps'
      },
      'cpu_usage': {
        label: 'CPU Usage',
        color: 'rgb(239, 68, 68)',
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
        yAxisLabel: 'Percentage (%)'
      },
      'memory_usage': {
        label: 'Memory Usage',
        color: 'rgb(245, 158, 11)',
        backgroundColor: 'rgba(245, 158, 11, 0.2)',
        yAxisLabel: 'Percentage (%)'
      },
      'temperature': {
        label: 'Temperature',
        color: 'rgb(168, 85, 247)',
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
        yAxisLabel: 'Celsius (°C)'
      }
    };

    return configs[metricType] || configs['ping_ms'];
  }

  async function loadCurrentMetrics(deviceId) {
    const metricTypes = METRIC_KEYS;
    const currentMetrics = {};

    for (const metricType of metricTypes) {
      try {
        const params = new URLSearchParams({
          device_id: String(deviceId),
          metric: metricType
        });
        const response = await state.shared.utils.jsonFetch(`/api/metrics/latest?${params.toString()}`);
        if (response && response.value !== null && response.value !== undefined) {
          // Handle different value formats
          let value = response.value;
          if (value && typeof value === 'object' && typeof value.Float64 === 'number') {
            value = value.Float64;
          }
          if (typeof value === 'string') {
            value = parseFloat(value);
          }

          // Handle different unit formats - backend returns {String: "unit", Valid: true}
          let unit = response.unit;
          if (typeof unit === 'object' && unit.String) {
            unit = unit.String;
          } else if (typeof unit !== 'string') {
            unit = getMetricUnit(metricType);
          }

          currentMetrics[metricType] = {
            value: isNaN(value) ? null : Number(value),
            unit: unit,
            timestamp: response.ts || response.timestamp
          };
        }
      } catch (error) {
        console.warn(`Failed to load latest ${metricType}:`, error);
      }
    }

    return currentMetrics;
  }

  function renderCurrentMetrics(metrics) {
    const container = document.getElementById('current-metrics-grid');
    if (!container) return;

    dbg('[Insights] Rendering current metrics:', metrics);

    container.innerHTML = '';

    Object.entries(METRIC_TITLES_SHORT).forEach(([metricType, label]) => {
      const metric = metrics[metricType];
      let value = '—';

      if (metric) {
        // Handle different possible data structures
        if (typeof metric === 'object' && metric.value !== undefined && metric.value !== null) {
          const numValue = Number(metric.value);
          if (!isNaN(numValue)) {
            value = `${numValue.toFixed(1)} ${metric.unit || getMetricUnit(metricType)}`;
          }
        } else if (typeof metric === 'number' && !isNaN(metric)) {
          value = `${metric.toFixed(1)} ${getMetricUnit(metricType)}`;
        }
      }

      const div = document.createElement('div');
      div.innerHTML = `<strong>${label}</strong><span>${value}</span>`;
      container.appendChild(div);
    });
  }

  function startMetricsUpdates(deviceId) {
    // Clear any existing interval
    stopMetricsUpdates();

    // Update current metrics every UPDATE_INTERVAL_MS
    state.metricsUpdateInterval = setInterval(async () => {
      if (state.selectedDeviceId === deviceId) {
        try {
          dbg('[Insights] Updating current metrics...');
          const currentMetrics = await loadCurrentMetrics(deviceId);
          renderCurrentMetrics(currentMetrics);
        } catch (error) {
          console.warn('[Insights] Failed to update current metrics:', error);
        }
      }
    }, UPDATE_INTERVAL_MS);

    dbg('[Insights] Started periodic metrics updates for device', deviceId);
  }

  function stopMetricsUpdates() {
    if (state.metricsUpdateInterval) {
      clearInterval(state.metricsUpdateInterval);
      state.metricsUpdateInterval = null;
      dbg('[Insights] Stopped periodic metrics updates');
    }
  }

  function renderLogs(entries) {
    const container = state.elements.logs;
    if (!container) { return; }
    container.innerHTML = '';
    if (!entries.length) {
      container.innerHTML = '<div class="muted">No recent activity for this device.</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    entries.forEach((entry) => {
      const article = document.createElement('article');
      article.className = 'log-entry';
      const meta = document.createElement('div');
      meta.className = 'log-meta';
      const level = document.createElement('span');
      level.className = `log-level ${entry.level || 'info'}`.trim();
      level.textContent = (entry.level || 'info').toUpperCase();
      meta.appendChild(level);
      const time = document.createElement('span');
      time.textContent = state.shared.utils.formatDateTime(entry.timestamp);
      meta.appendChild(time);
      article.appendChild(meta);
      const message = document.createElement('div');
      message.className = 'log-message';
      message.textContent = entry.message || 'Log entry';
      article.appendChild(message);
      fragment.appendChild(article);
    });
    container.appendChild(fragment);
  }
  // Patch fetch for noisy /api/device-logs calls that accidentally pass objects instead of IDs
  (function patchDeviceLogsFetch() {
    if (window.__pulseopsFetchPatched) { return; }
    const __origFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      try {
        const u = (typeof input === 'string') ? new URL(input, window.location.origin)
          : new URL(input.url, window.location.origin);
        if (u.pathname.startsWith('/api/device-logs')) {
          const raw = u.searchParams.get('device_id');
          const needsFix = raw && (raw.includes('[object Object]') || /\[.*\]|\{.*\}/.test(raw));
          if (needsFix) {
            let toValue = '';
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                const ids = parsed
                  .map(v => (typeof v === 'object' && v !== null ? (v.id ?? v.device_id ?? v.value ?? null) : v))
                  .filter(v => v != null)
                  .map(v => String(v).match(/\d+/g))
                  .flat()
                  .filter(Boolean);
                toValue = ids && ids.length ? [...new Set(ids)].join(',') : '';
              } else if (parsed && typeof parsed === 'object') {
                const idLike = parsed.id ?? parsed.device_id ?? parsed.value ?? null;
                if (idLike != null) {
                  const m = String(idLike).match(/\d+/g); if (m) { toValue = m.join(','); }
                }
              }
            } catch (_) {
              const nums = String(raw).match(/\d+/g);
              if (nums && nums.length) { toValue = [...new Set(nums)].join(','); }
            }
            if (!toValue) {
              toValue = state && state.selectedDeviceId ? String(state.selectedDeviceId) : '';
            }
            u.searchParams.set('device_id', toValue);
            if (insightsDebugEnabled()) { console.warn('[Insights] fetch patch: sanitised device_id for /api/device-logs', { from: raw, to: toValue }); }
            input = u.toString();
          }
        }
      } catch (_) { /* ignore parse issues */ }
      return __origFetch(input, init);
    };
    window.__pulseopsFetchPatched = true;
  })();
  async function refreshInsights(deviceId) {
    if (!deviceId) {
      setEmptyState();
      return;
    }

    // Stop any existing updates when switching devices
    stopMetricsUpdates();
    stopStatusUpdates();
    destroyChartIfExists();

    await withBusy(state.elements.refreshBtn, async () => {
      showContent();

      // Ensure devices are loaded before trying to find the device
      await state.shared.stores.devices.load();

      const devices = state.shared.stores.devices.get() || [];
      const device = devices.find((item) => String(item.id) === String(deviceId));
      renderDeviceSummary(device);

      const [metricsResult, logs, currentMetrics] = await Promise.all([
        loadMetrics(deviceId),
        loadDeviceLogs(deviceId),
        loadCurrentMetrics(deviceId)
      ]);
      destroyChartIfExists();
      // Build and render charts
      updateOverviewChart(state.allMetrics || {});
      renderMetricCharts(state.allMetrics || {});

      renderLogs(logs);
      renderCurrentMetrics(currentMetrics);

      // Start periodic updates for current metrics
      startMetricsUpdates(deviceId);
    });
  }

  // Initialize for standalone page
  async function initStandalone() {
    if (state.standaloneInitialised) {
      return;
    }
    state.standaloneInitialised = true;
    dbg('[Insights] Initializing standalone insights page');
    state.shared = ensureShared();
    state.elements = {
      deviceSelect: document.querySelector('#insights-device-select'),
      refreshBtn: document.querySelector('#insights-refresh'),
      empty: document.querySelector('#insights-empty'),
      content: document.querySelector('#insights-content'),
      deviceContainer: document.querySelector('#insights-device-container'),
      meta: document.querySelector('#insights-meta'),
      overviewCanvas: document.querySelector('#insights-overview-canvas'),
      metricChartsContainer: document.querySelector('#insights-metric-charts'),
      logs: document.querySelector('#insights-logs')
    };

    dbg('[Insights] Elements found:', Object.keys(state.elements).filter(key => state.elements[key]));

    // Set up event listeners
    setupEventListeners();

    const requestedDeviceId = readDeviceIdFromUrl();
    let initialSelectionHandled = false;

    // Subscribe to device updates
    state.unsubscribeDevices = state.shared.stores.devices.subscribe((devices) => {
      const list = Array.isArray(devices) ? devices : [];
      dbg('[Insights] Devices loaded:', list.length, 'devices');
      populateDeviceSelect(list);

      if (initialSelectionHandled) {
        return;
      }

      initialSelectionHandled = true;

      if (requestedDeviceId && state.elements.deviceSelect && list.length > 0) {
        const device = list.find((d) => String(d.id) === String(requestedDeviceId));
        if (device) {
          dbg(`[Insights] Found device for ID ${requestedDeviceId}:`, device);
          setSelectedDevice(String(device.id), { updateUrl: false, refresh: true, force: true });
          return;
        }
        if (state.elements.deviceSelect) {
          const opt = document.createElement('option');
          opt.value = String(requestedDeviceId);
          opt.textContent = `Device #${requestedDeviceId}`;
          state.elements.deviceSelect.appendChild(opt);
          state.elements.deviceSelect.value = String(requestedDeviceId);
        }
        dbg(`[Insights] Device not found for ID ${requestedDeviceId}.`);

        if (insightsDebugEnabled()) { console.warn(`[Insights] Device not found for ID ${requestedDeviceId}. Available devices:`, list.map((d) => ({ id: d.id, name: d.name }))); }

        const container = state.elements.deviceContainer;
        if (container) {
          container.innerHTML = `
            <div style="padding: 1rem; background: var(--bg-secondary); border-radius: 8px; border: 1px solid var(--border-primary);">
              <h3>Device Not Found</h3>
              <p>Device ID "${requestedDeviceId}" was not found.</p>
              <p><strong>Available devices:</strong></p>
              <ul style="margin: 0.5rem 0;">
                ${list.map((d) => `<li><a href="?deviceId=${d.id}">${d.name} (ID: ${d.id})</a></li>`).join('')}
              </ul>
            </div>
          `;
        }

        setSelectedDevice(requestedDeviceId, { updateUrl: false, refresh: false });
      } else if (!requestedDeviceId) {
        setEmptyState();
      }
    });

    // Load devices and trigger the subscription
    dbg('[Insights] Loading devices...'); await state.shared.stores.devices.load();
  }

  async function setupEventListeners() {
    state.elements.deviceSelect?.addEventListener('change', (event) => {
      const value = event.target.value;
      setSelectedDevice(value || null, { updateUrl: true, refresh: true });
    });

    state.elements.refreshBtn?.addEventListener('click', () => {
      if (state.selectedDeviceId) {
        refreshInsights(state.selectedDeviceId);
      }
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      stopMetricsUpdates();
      stopStatusUpdates();
    });
    // Attempt fallback device option population before store load
    await ensureInsightsDeviceOptions();
  }

  const controller = {
    async init(context) {
      dbg('[Insights] init() called');
      state.shared = context.shared;
      state.elements = {
        deviceSelect: context.section.querySelector('#insights-device-select'),
        refreshBtn: context.section.querySelector('#insights-refresh'),
        empty: context.section.querySelector('#insights-empty'),
        content: context.section.querySelector('#insights-content'),
        deviceContainer: context.section.querySelector('#insights-device-container'),
        meta: context.section.querySelector('#insights-meta'),
        overviewCanvas: context.section.querySelector('#insights-overview-canvas'),
        metricChartsContainer: context.section.querySelector('#insights-metric-charts'),
        logs: context.section.querySelector('#insights-logs')
      };

      dbg('[Insights] Elements bound', { elementCount: Object.keys(state.elements).length });

      state.elements.deviceSelect?.addEventListener('change', (event) => {
        const value = event.target.value;
        setSelectedDevice(value || null, { updateUrl: true, refresh: true });
      });
      state.elements.refreshBtn?.addEventListener('click', () => {
        if (state.selectedDeviceId) {
          refreshInsights(state.selectedDeviceId);
        }
      });

      state.unsubscribeDevices = context.shared.stores.devices.subscribe((devices) => {
        dbg('[Insights] Device subscription triggered', { deviceCount: Array.isArray(devices) ? devices.length : 0 });
        populateDeviceSelect(Array.isArray(devices) ? devices : []);
      });

      const initialDeviceId = readDeviceIdFromUrl();
      dbg('[Insights] Initial device ID from URL', { deviceId: initialDeviceId });
      setSelectedDevice(initialDeviceId, { updateUrl: false, refresh: false });

      dbg('[Insights] Loading devices store...');
      await context.shared.stores.devices.load();
      dbg('[Insights] Devices loaded');

      if (state.selectedDeviceId) {
        dbg('[Insights] Refreshing insights for device', { deviceId: state.selectedDeviceId });
        setSelectedDevice(state.selectedDeviceId, { updateUrl: false, refresh: true, force: true });
      } else {
        dbg('[Insights] No device selected, showing empty state');
        setEmptyState();
      }

      state.initialSyncComplete = true;
      dbg('[Insights] init() completed');
    },
    onShow() {
      if (!state.initialSyncComplete) { return; }
      const deviceFromUrl = readDeviceIdFromUrl();
      if (deviceFromUrl !== state.selectedDeviceId) {
        setSelectedDevice(deviceFromUrl, { updateUrl: false, refresh: Boolean(deviceFromUrl), force: true });
      } else if (state.selectedDeviceId) {
        refreshInsights(state.selectedDeviceId);
      } else {
        setEmptyState();
      }
    },
    onHide() {
      stopMetricsUpdates();
      stopStatusUpdates();
    },
    destroy() {
      stopMetricsUpdates();
      stopStatusUpdates();
      if (state.unsubscribeDevices) {
        state.unsubscribeDevices();
        state.unsubscribeDevices = null;
      }
      if (state.chart) { try { state.chart.destroy(); } catch (_) {} state.chart = null; }
      if (state.overviewChart) { try { state.overviewChart.destroy(); } catch (_) {} state.overviewChart = null; }
      if (state.metricCharts) { Object.values(state.metricCharts).forEach((ch) => { try { ch.destroy(); } catch (_) {} }); state.metricCharts = {}; }
      state.selectedDeviceId = null;
      state.initialSyncComplete = false;
    }
  };

  views.insights = controller;

  PulseOps.whenReady(() => {
    if (document.body.dataset.page === 'dashboard') {
      initStandalone();
    }
  });
})(window, document);
