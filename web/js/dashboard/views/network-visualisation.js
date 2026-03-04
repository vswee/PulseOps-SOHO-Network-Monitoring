(function (window, document) {
  'use strict';

  const PulseOps = window.PulseOps = window.PulseOps || {};
  const views = PulseOps.views = PulseOps.views || {};

  const DEVICE_TYPE_PALETTE = ['#6366f1', '#0ea5e9', '#22c55e', '#f97316', '#a855f7', '#14b8a6', '#facc15', '#ef4444', '#8b5cf6', '#ec4899'];
  const LOCATION_PALETTE = ['#0ea5e9', '#f97316', '#14b8a6', '#a855f7', '#ef4444', '#22c55e', '#6366f1', '#ec4899', '#8b5cf6', '#facc15'];
  const GRID_SIZE = 24;
  const MIN_ROW_SPACING = GRID_SIZE * 4;
  const MIN_COLUMN_SPACING = GRID_SIZE * 4;

  const LINK_BANDS = [
    { id: 'fast', label: 'Fast (<40 ms & >500 Mbps)', color: '#22c55e' },
    { id: 'healthy', label: 'Healthy (<120 ms & >120 Mbps)', color: '#0ea5e9' },
    { id: 'steady', label: 'Steady (<180 ms & >40 Mbps)', color: '#f59e0b' },
    { id: 'constrained', label: 'Constrained (<250 ms or >20 Mbps)', color: '#f97316' },
    { id: 'critical', label: 'Critical latency or bandwidth', color: '#ef4444' },
    { id: 'unknown', label: 'Telemetry unavailable', color: '#6b7280' }
  ];

  const state = {
    shared: null,
    section: null,
    elements: {},
    devices: [],
    deviceMap: new Map(),
    deviceElements: new Map(),
    typeColours: new Map(),
    locationColours: new Map(),
    selectedDeviceId: null,
    hoveredDeviceId: null,
    defaultLayout: new Map(),
    layoutMeta: null,
    customPositions: new Map(),
    center: { x: 0, y: 0 },
    loadToken: 0,
    resizeScheduled: false,
    boundResize: null,
    loading: false,
    dragState: { active: false, deviceId: null }
  };

  function ensureShared(contextShared) {
    if (state.shared) {
      return state.shared;
    }
    const base = contextShared || PulseOps.shared;
    state.shared = base && typeof base.ensureReady === 'function' ? base.ensureReady() : base;
    return state.shared;
  }

  function cacheElements(section) {
    state.elements = {
      visualiser: section.querySelector('#network-visualiser'),
      links: section.querySelector('#network-visualiser-links'),
      linkLabels: section.querySelector('#network-visualiser-link-labels'),
      nodes: section.querySelector('#network-visualiser-nodes'),
      empty: section.querySelector('#network-visualiser-empty'),
      status: section.querySelector('#network-visualisation-status'),
      refreshBtn: section.querySelector('#network-visualisation-refresh'),
      typeLegend: section.querySelector('#network-visualisation-type-legend'),
      locationLegend: section.querySelector('#network-visualisation-location-legend'),
      linkLegend: section.querySelector('#network-visualisation-link-legend'),
      insight: section.querySelector('#network-visualisation-insight'),
      insightGrid: section.querySelector('#network-visualisation-insight-grid'),
      insightActions: section.querySelector('#network-visualisation-insight-actions'),
      openInsightsBtn: section.querySelector('#network-visualisation-open-insights')
    };
  }

  function setStatus(message, tone = 'muted') {
    const el = state.elements.status;
    if (!el) { return; }
    el.textContent = message || '';
    el.dataset.tone = tone;
  }

  function setLoading(isLoading) {
    state.loading = Boolean(isLoading);
    if (state.elements.refreshBtn) {
      state.elements.refreshBtn.disabled = state.loading;
    }
    if (state.loading) {
      setStatus('Loading topology…', 'info');
    }
  }

  function normaliseKey(value, fallback = 'unknown') {
    const text = (value == null ? '' : String(value)).trim();
    return text ? text.toLowerCase() : fallback;
  }

  function titleCase(value, fallback = 'Unknown') {
    const text = (value == null ? '' : String(value)).trim();
    if (!text) { return fallback; }
    return text.replace(/[_\-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function resolveDeviceId(device, fallbackIndex = null) {
    const raw = device?.id ?? device?.device_id ?? device?.name ?? device?.host;
    if (raw != null && raw !== '') {
      return String(raw);
    }
    if (fallbackIndex != null) {
      return `device-${fallbackIndex}`;
    }
    return `device-${Math.random().toString(36).slice(2, 8)}`;
  }

  function coerceNumber(raw) {
    if (raw == null) { return null; }
    if (typeof raw === 'number') {
      return Number.isFinite(raw) ? raw : null;
    }
    if (typeof raw === 'string') {
      const parsed = Number(raw.replace(/[^0-9.+-Ee]/g, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof raw === 'object') {
      if (raw.Float64 != null) { return coerceNumber(raw.Float64); }
      if (raw.Int64 != null) { return coerceNumber(raw.Int64); }
      if (raw.Value != null) { return coerceNumber(raw.Value); }
      if (raw.value != null) { return coerceNumber(raw.value); }
      if (raw.String != null) { return coerceNumber(raw.String); }
    }
    return null;
  }

  function snapToGrid(value) {
    if (!Number.isFinite(value)) { return value; }
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  }

  function clampPosition(position, bounds) {
    const inset = GRID_SIZE * 2;
    const minX = inset;
    const maxX = Math.max(inset, bounds.width - inset);
    const minY = inset;
    const maxY = Math.max(inset, bounds.height - inset);
    return {
      x: Math.min(maxX, Math.max(minX, position.x)),
      y: Math.min(maxY, Math.max(minY, position.y))
    };
  }

  function formatMetric(value, unit) {
    if (!Number.isFinite(value)) { return '—'; }
    const rounded = value >= 100 ? Math.round(value) : Number(value.toFixed(1));
    return `${rounded} ${unit}`;
  }

  function classifyLink({ pingMs, bandwidthMbps }) {
    const hasPing = Number.isFinite(pingMs);
    const hasBandwidth = Number.isFinite(bandwidthMbps);
    if (!hasPing && !hasBandwidth) {
      return { id: 'unknown', label: 'Telemetry unavailable', color: '#6b7280' };
    }
    if (hasPing && hasBandwidth) {
      if (pingMs <= 40 && bandwidthMbps >= 500) {
        return { id: 'fast', label: 'Fast link', color: '#22c55e' };
      }
      if (pingMs <= 120 && bandwidthMbps >= 120) {
        return { id: 'healthy', label: 'Healthy link', color: '#0ea5e9' };
      }
      if (pingMs <= 180 && bandwidthMbps >= 40) {
        return { id: 'steady', label: 'Steady link', color: '#f59e0b' };
      }
      if (pingMs <= 250 && bandwidthMbps >= 20) {
        return { id: 'constrained', label: 'Constrained link', color: '#f97316' };
      }
      return { id: 'critical', label: 'Critical link', color: '#ef4444' };
    }
    if (hasPing) {
      if (pingMs <= 80) { return { id: 'healthy', label: 'Latency in range', color: '#0ea5e9' }; }
      if (pingMs <= 160) { return { id: 'steady', label: 'Latency elevated', color: '#f59e0b' }; }
      if (pingMs <= 250) { return { id: 'constrained', label: 'Latency high', color: '#f97316' }; }
      return { id: 'critical', label: 'Latency critical', color: '#ef4444' };
    }
    if (hasBandwidth) {
      if (bandwidthMbps >= 500) { return { id: 'fast', label: 'Throughput excellent', color: '#22c55e' }; }
      if (bandwidthMbps >= 120) { return { id: 'healthy', label: 'Throughput healthy', color: '#0ea5e9' }; }
      if (bandwidthMbps >= 40) { return { id: 'steady', label: 'Throughput moderate', color: '#f59e0b' }; }
      if (bandwidthMbps >= 20) { return { id: 'constrained', label: 'Throughput constrained', color: '#f97316' }; }
      return { id: 'critical', label: 'Throughput minimal', color: '#ef4444' };
    }
    return { id: 'unknown', label: 'Telemetry unavailable', color: '#6b7280' };
  }

  function renderLinkLegend() {
    const container = state.elements.linkLegend;
    if (!container) { return; }
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    LINK_BANDS.forEach((band) => {
      const item = document.createElement('li');
      item.className = 'network-visualisation-legend-item';
      item.style.setProperty('--legend-colour', band.color);
      item.textContent = band.label;
      frag.appendChild(item);
    });
    container.appendChild(frag);
  }

  function assignColours(map, palette) {
    const colours = new Map();
    const keys = Array.from(map.keys()).sort((a, b) => {
      const nameA = map.get(a).label.toLowerCase();
      const nameB = map.get(b).label.toLowerCase();
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });
    keys.forEach((key, index) => {
      const colour = palette[index % palette.length];
      colours.set(key, colour);
    });
    return colours;
  }

  function renderLegend(container, collection, colourMap) {
    if (!container) { return; }
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    collection.forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'network-visualisation-legend-item';
      item.style.setProperty('--legend-colour', colourMap.get(entry.key));
      item.textContent = `${entry.label} (${entry.count})`;
      frag.appendChild(item);
    });
    container.appendChild(frag);
  }

  function resolveLocation(device) {
    const shared = ensureShared();
    const site = (device.site || '').toString().trim();
    if (site) {
      return site;
    }
    const resolver = shared?.utils?.resolveNetworkLocation;
    if (typeof resolver === 'function') {
      const detail = resolver(device);
      if (detail?.label) {
        return detail.label;
      }
    }
    return 'Unassigned';
  }

  async function fetchMetric(deviceId, metricKey) {
    const shared = ensureShared();
    if (!shared?.utils?.jsonFetch) {
      return null;
    }
    const params = new URLSearchParams({ device_id: String(deviceId), metric: metricKey });
    try {
      const payload = await shared.utils.jsonFetch(`/api/metrics/latest?${params.toString()}`);
      if (!payload) { return null; }
      const value = coerceNumber(payload.value);
      if (!Number.isFinite(value)) {
        return null;
      }
      const unit = payload.unit && typeof payload.unit === 'object' ? (payload.unit.String || payload.unit.value || payload.unit.Unit || '') : payload.unit;
      const timestamp = payload.ts || payload.timestamp || payload.time || null;
      return { value, unit: unit || '', timestamp };
    } catch (error) {
      console.warn('[Network visualisation] metric fetch failed', metricKey, error);
      return null;
    }
  }

  async function fetchTelemetryForDevice(device) {
    const id = device?.id ?? device?.device_id ?? device?.name;
    if (id == null) { return { pingMs: null, bandwidthMbps: null, updatedAt: null }; }
    const pingMetrics = ['ping_ms', 'latency_ms'];
    const bandwidthMetrics = ['bandwidth_mbps', 'throughput_mbps', 'iperf_mbps', 'bandwidth'];
    let ping = null;
    for (let i = 0; i < pingMetrics.length && !ping; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      ping = await fetchMetric(id, pingMetrics[i]);
    }
    let bandwidth = null;
    for (let i = 0; i < bandwidthMetrics.length && !bandwidth; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      bandwidth = await fetchMetric(id, bandwidthMetrics[i]);
    }
    const pingMs = ping ? ping.value : null;
    let bandwidthMbps = bandwidth ? bandwidth.value : null;
    if (bandwidth && (!bandwidth.unit || /bps$/i.test(bandwidth.unit))) {
      const unit = bandwidth.unit.toLowerCase();
      if (unit.includes('gbps')) {
        bandwidthMbps *= 1000;
      } else if (unit.includes('kbps')) {
        bandwidthMbps /= 1000;
      }
    }
    const timestamps = [ping?.timestamp, bandwidth?.timestamp].filter(Boolean);
    const updatedAt = timestamps.length ? new Date(Math.max(...timestamps.map((value) => Date.parse(value)))) : null;
    return {
      pingMs: Number.isFinite(pingMs) ? pingMs : null,
      bandwidthMbps: Number.isFinite(bandwidthMbps) ? bandwidthMbps : null,
      updatedAt
    };
  }

  async function fetchTelemetry(devices, token, ids = []) {
    const results = new Map();
    const queue = devices.map((device, index) => ({ device, index }));
    const workers = Math.min(6, queue.length || 1);
    async function worker() {
      while (queue.length) {
        if (token !== state.loadToken) { return; }
        const item = queue.shift();
        if (!item) { continue; }
        const { device, index } = item;
        // eslint-disable-next-line no-await-in-loop
        const metrics = await fetchTelemetryForDevice(device);
        const key = ids[index] != null ? ids[index] : resolveDeviceId(device, index);
        results.set(key, metrics);
      }
    }
    const jobs = [];
    for (let i = 0; i < workers; i += 1) {
      jobs.push(worker());
    }
    await Promise.all(jobs);
    return results;
  }

  async function buildDevices(list, telemetry, ids = []) {
    const shared = ensureShared();
    const entries = [];
    state.deviceMap.clear();

    const statusModule = window.PulseOps?.deviceStatus;
    let statusResults = [];
    if (statusModule?.getStatus) {
      const statusPromises = list.map(async (device) => {
        try {
          return await statusModule.getStatus(device);
        } catch (error) {
          console.warn('[Network visualisation] Unable to resolve device status', { deviceId: device?.id, error });
          return null;
        }
      });
      statusResults = await Promise.all(statusPromises);
    }

    list.forEach((device, index) => {
      const id = ids[index] != null ? ids[index] : resolveDeviceId(device, index);
      const metrics = telemetry.get(id) || { pingMs: null, bandwidthMbps: null, updatedAt: null };
      const kindKey = normaliseKey(device.kind, 'unclassified');
      const kindLabel = titleCase(device.kind, 'Unclassified');
      const locationLabel = resolveLocation(device);
      const locationKey = normaliseKey(locationLabel, 'unassigned');
      const statusResult = Array.isArray(statusResults) ? statusResults[index] : null;
      const link = classifyLink(metrics);

      let statusKey = normaliseKey(statusResult?.status || device.status, 'unknown');
      let statusLabel = statusResult?.label || statusResult?.info?.label || titleCase(statusKey, 'Unknown');
      let statusClass = statusResult?.info?.className || statusResult?.className || `status-${statusKey}`;

      if (!statusClass || !statusClass.includes('status-')) {
        statusClass = `status-${statusKey}`;
      }

      const metricsSummary = [];
      if (Number.isFinite(metrics.pingMs)) {
        metricsSummary.push(`${formatMetric(metrics.pingMs, 'ms')} latency`);
      }
      if (Number.isFinite(metrics.bandwidthMbps)) {
        metricsSummary.push(`${formatMetric(metrics.bandwidthMbps, 'Mbps')} bandwidth`);
      }
      const linkText = metricsSummary.length ? metricsSummary.join(' • ') : 'No live metrics';
      const updatedLabel = metrics.updatedAt && !Number.isNaN(metrics.updatedAt.valueOf())
        ? shared?.utils?.formatDateTime?.(metrics.updatedAt) || metrics.updatedAt.toLocaleString()
        : null;
      const entry = {
        id,
        name: device.name || device.host || `Device ${id}`,
        host: device.host || null,
        kindKey,
        kindLabel,
        locationKey,
        locationLabel,
        status: statusKey,
        statusClass,
        statusLabel,
        metrics,
        metricsText: linkText,
        link,
        updatedLabel,
        insightsUrl: shared?.utils?.withDebug ? shared.utils.withDebug(`/insights.html?deviceId=${encodeURIComponent(id)}`) : `/insights.html?deviceId=${encodeURIComponent(id)}`
      };
      entries.push(entry);
      state.deviceMap.set(id, entry);
    });

    entries.sort((a, b) => {
      const loc = a.locationLabel.localeCompare(b.locationLabel, undefined, { sensitivity: 'base' });
      if (loc !== 0) { return loc; }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return entries;
  }

  function groupByKey(entries, keyProp, labelProp) {
    const map = new Map();
    entries.forEach((entry) => {
      const key = entry[keyProp];
      if (!map.has(key)) {
        map.set(key, { key, label: entry[labelProp], entries: [], count: 0 });
      }
      const group = map.get(key);
      group.entries.push(entry);
      group.count += 1;
    });
    return map;
  }

  function computeLayout(devices, width, height) {
    const center = { x: snapToGrid(width / 2), y: snapToGrid(height / 2) };
    const layout = new Map();
    const marginX = GRID_SIZE * 5;
    const marginY = GRID_SIZE * 4;
    const usableHeight = Math.max(height - marginY * 2, GRID_SIZE * 8);
    const usableWidth = Math.max(width - marginX * 2, GRID_SIZE * 12);

    if (!devices.length) {
      return { center, layout, meta: { marginX, marginY, usableWidth, usableHeight, rowSpacing: MIN_ROW_SPACING } };
    }

    const locations = groupByKey(devices, 'locationKey', 'locationLabel');
    const locationList = Array.from(locations.values());
    locationList.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

    const rowSpacing = Math.max(MIN_ROW_SPACING, usableHeight / Math.max(locationList.length, 1));
    const rowGap = Math.max(GRID_SIZE * 2, rowSpacing / 2);
    const minX = marginX;
    const maxX = width - marginX;
    const minY = marginY;
    const maxY = height - marginY;

    locationList.forEach((group, rowIndex) => {
      const count = Math.max(group.entries.length, 1);
      const columnSpacing = Math.max(MIN_COLUMN_SPACING, usableWidth / Math.max(count + 1, 2));
      const halfSpacing = columnSpacing / 2;
      const rowOffset = rowIndex % 2 === 0 ? 0 : halfSpacing;
      const baseRowY = marginY + rowSpacing * (rowIndex + 0.5);
      const rowY = snapToGrid(Math.min(maxY, Math.max(minY, baseRowY)));
      let corridorY = rowY >= center.y ? rowY - rowGap : rowY + rowGap;
      corridorY = snapToGrid(Math.min(maxY, Math.max(minY, corridorY)));

      group.entries.forEach((device, index) => {
        const baseX = marginX + columnSpacing * (index + 1);
        let x = snapToGrid(Math.min(maxX, Math.max(minX, baseX + rowOffset)));
        const leftGap = x - halfSpacing;
        const rightGap = x + halfSpacing;
        const preferredGap = Math.abs((leftGap) - center.x) <= Math.abs((rightGap) - center.x) ? leftGap : rightGap;
        let corridorX = preferredGap;
        if (corridorX < minX) {
          corridorX = rightGap;
        } else if (corridorX > maxX) {
          corridorX = leftGap;
        }
        corridorX = snapToGrid(Math.min(maxX, Math.max(minX, corridorX)));

        layout.set(device.id, {
          position: { x, y: rowY },
          corridor: { x: corridorX, y: corridorY }
        });
      });
    });

    return { center, layout, meta: { marginX, marginY, usableWidth, usableHeight, rowSpacing } };
  }

  function createRootNode(center) {
    const el = document.createElement('div');
    el.className = 'network-visualiser-node network-visualiser-node--root';
    el.style.left = `${center.x}px`;
    el.style.top = `${center.y}px`;
    el.innerHTML = '<span class="node-title">PulseOps</span><span class="node-meta">Controller</span>';
    return el;
  }

  function createDeviceNode(device, position, locationColour, typeColour) {
    const el = document.createElement('a');
    el.className = 'network-visualiser-node network-visualiser-node--device';
    el.href = device.insightsUrl;
    el.dataset.deviceId = device.id;
    el.style.left = `${position.x}px`;
    el.style.top = `${position.y}px`;
    el.style.setProperty('--location-colour', locationColour);
    el.style.setProperty('--type-colour', typeColour);
    el.setAttribute('aria-label', `${device.name} — ${device.metricsText}. Select to open insights.`);
    el.innerHTML = `
      <span class="node-title">${device.name}</span>
      <span class="node-subtitle">${device.kindLabel}</span>
      <span class="node-meta">${device.locationLabel}</span>
      <span class="node-status ${device.statusClass || ''}">
        <span class="node-status-dot" aria-hidden="true"></span>
        <span>${device.statusLabel}</span>
      </span>
    `;
    el.addEventListener('pointerenter', () => {
      setHoveredDevice(device.id);
      selectDevice(device.id);
    });
    el.addEventListener('pointerleave', () => setHoveredDevice(null));
    el.addEventListener('focus', () => {
      setHoveredDevice(device.id);
      selectDevice(device.id);
    });
    el.addEventListener('blur', () => {
      if (state.hoveredDeviceId === device.id) {
        setHoveredDevice(null);
      }
    });
    el.addEventListener('mouseenter', () => selectDevice(device.id));
    return el;
  }

  function roundedPathFromPoints(points, cornerRatio = 0.25) {
    if (!Array.isArray(points) || points.length < 2) {
      return '';
    }
    // Remove consecutive duplicate points
    const deduped = [points[0]];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i];
      const b = deduped[deduped.length - 1];
      if (a.x !== b.x || a.y !== b.y) {
        deduped.push({ x: a.x, y: a.y });
      }
    }
    if (deduped.length === 1) {
      return `M ${deduped[0].x} ${deduped[0].y}`;
    }

    let path = `M ${deduped[0].x} ${deduped[0].y}`;

    for (let i = 1; i < deduped.length; i += 1) {
      const prev = deduped[i - 1];
      const curr = deduped[i];
      const next = deduped[i + 1];

      // If this is the last point, draw a straight segment and finish
      if (!next) {
        path += ` L ${curr.x} ${curr.y}`;
        break;
      }

      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;

      const len1 = Math.abs(dx1) + Math.abs(dy1);
      const len2 = Math.abs(dx2) + Math.abs(dy2);

      if (len1 === 0 || len2 === 0) {
        // Degenerate, skip rounding and continue
        continue;
      }

      // Radius is 25% of the shorter adjoining orthogonal segment by default
      const r = Math.max(0, Math.min(len1, len2) * cornerRatio);

      // Direction of travel for each segment (axis-aligned, so sign is enough)
      const dir1 = { x: Math.sign(dx1), y: Math.sign(dy1) };
      const dir2 = { x: Math.sign(dx2), y: Math.sign(dy2) };

      // Point where the straight segment stops before the corner
      const cornerStart = {
        x: curr.x - dir1.x * r,
        y: curr.y - dir1.y * r
      };

      // Point where the next straight segment starts after the corner
      const cornerEnd = {
        x: curr.x + dir2.x * r,
        y: curr.y + dir2.y * r
      };

      // Draw up to the start of the corner, then a quadratic curve through the corner point
      path += ` L ${cornerStart.x} ${cornerStart.y}`;
      path += ` Q ${curr.x} ${curr.y} ${cornerEnd.x} ${cornerEnd.y}`;
    }

    return path;
  }

  function buildPath(center, position, corridor) {
    const start = { x: snapToGrid(center.x), y: snapToGrid(center.y) };
    const corridorPoint = {
      x: snapToGrid(corridor.x),
      y: snapToGrid(corridor.y)
    };
    const target = { x: snapToGrid(position.x), y: snapToGrid(position.y) };

    // Add a subtle terminal up-turn so the link finishes with a 90° kink upwards
    const TURN_UP = 15; // ~15px as requested, not snapped to grid

    // Orthogonal polyline:
    // centre -> vertical to corridor Y -> corridor -> horizontal to target Y -> target -> short up-turn
    const points = [
      start,
      { x: start.x, y: corridorPoint.y },
      corridorPoint,
      { x: corridorPoint.x, y: target.y },
      target,
      { x: target.x, y: target.y - TURN_UP }
    ];

    // 25% corner radius at every 90° turn, including the terminal kink
    return roundedPathFromPoints(points, 0.25);
  }

  function computeLabelPosition(position, corridor) {
    const visualiser = state.elements.visualiser;
    const width = visualiser ? visualiser.clientWidth : 0;
    const height = visualiser ? visualiser.clientHeight : 0;
    const margin = GRID_SIZE;
    const midX = snapToGrid((corridor.x + position.x) / 2);
    const midY = snapToGrid((corridor.y + position.y) / 2);
    const clampedX = width > margin * 2 ? Math.min(width - margin, Math.max(margin, midX)) : midX;
    const clampedY = height > margin * 2 ? Math.min(height - margin, Math.max(margin, midY)) : midY;
    return {
      x: snapToGrid(clampedX),
      y: snapToGrid(clampedY)
    };
  }

  function resolveCorridor(position, offset = { x: 0, y: 0 }) {
    const visualiser = state.elements.visualiser;
    const width = visualiser ? visualiser.clientWidth : 0;
    const height = visualiser ? visualiser.clientHeight : 0;
    const margin = GRID_SIZE;
    const candidate = {
      x: snapToGrid(position.x + (offset.x || 0)),
      y: snapToGrid(position.y + (offset.y || 0))
    };
    const clampedX = width > margin * 2 ? Math.min(width - margin, Math.max(margin, candidate.x)) : candidate.x;
    const clampedY = height > margin * 2 ? Math.min(height - margin, Math.max(margin, candidate.y)) : candidate.y;
    return {
      x: snapToGrid(clampedX),
      y: snapToGrid(clampedY)
    };
  }

  function getNodePosition(deviceId) {
    if (state.customPositions.has(deviceId)) {
      return state.customPositions.get(deviceId);
    }
    const layoutEntry = state.defaultLayout.get(deviceId);
    return layoutEntry ? layoutEntry.position : null;
  }

  function updateNodeGraphics(deviceId, position) {
    const entry = state.deviceElements.get(deviceId);
    if (!entry) { return; }
    const bounds = {
      width: state.elements.visualiser?.clientWidth || 0,
      height: state.elements.visualiser?.clientHeight || 0
    };
    const clamped = clampPosition(position, bounds);
    const snapped = { x: snapToGrid(clamped.x), y: snapToGrid(clamped.y) };
    const corridor = resolveCorridor(snapped, entry.corridorOffset || { x: 0, y: 0 });
    entry.node.style.left = `${snapped.x}px`;
    entry.node.style.top = `${snapped.y}px`;
    const path = buildPath(state.center, snapped, corridor);
    entry.link.setAttribute('d', path);
    const labelPos = computeLabelPosition(snapped, corridor);
    entry.label.style.left = `${labelPos.x}px`;
    entry.label.style.top = `${labelPos.y}px`;
    entry.label.dataset.position = `${labelPos.x},${labelPos.y}`;
    entry.position = snapped;
    entry.corridorOffset = {
      x: corridor.x - snapped.x,
      y: corridor.y - snapped.y
    };
  }

  function selectDevice(deviceId) {
    if (!deviceId || !state.deviceMap.has(deviceId)) {
      state.selectedDeviceId = null;
      updateInsightPanel(null);
      applyHighlight();
      return;
    }
    state.selectedDeviceId = deviceId;
    updateInsightPanel(state.deviceMap.get(deviceId));
    applyHighlight();
  }

  function setHoveredDevice(deviceId) {
    state.hoveredDeviceId = deviceId;
    applyHighlight();
  }

  function applyHighlight() {
    const visualiser = state.elements.visualiser;
    const activeId = state.hoveredDeviceId || state.selectedDeviceId || null;
    if (visualiser) {
      visualiser.classList.toggle('has-focus', Boolean(state.hoveredDeviceId));
    }
    state.deviceElements.forEach((entry, id) => {
      const isActive = activeId && id === activeId;
      entry.node.classList.toggle('is-active', isActive);
      entry.link.classList.toggle('is-active', isActive);
      entry.label.classList.toggle('is-active', isActive);
    });
  }

  function updateInsightPanel(device) {
    const grid = state.elements.insightGrid;
    const actions = state.elements.insightActions;
    const button = state.elements.openInsightsBtn;
    if (!grid || !actions) { return; }
    grid.innerHTML = '';
    if (!device) {
      actions.classList.add('hidden');
      if (button) {
        button.onclick = null;
      }
      return;
    }
    const rows = [
      ['Name', device.name],
      ['Type', device.kindLabel],
      ['Location', device.locationLabel],
      ['Status', device.statusLabel],
      ['Latency', Number.isFinite(device.metrics.pingMs) ? formatMetric(device.metrics.pingMs, 'ms') : '—'],
      ['Bandwidth', Number.isFinite(device.metrics.bandwidthMbps) ? formatMetric(device.metrics.bandwidthMbps, 'Mbps') : '—']
    ];
    if (device.updatedLabel) {
      rows.push(['Last telemetry', device.updatedLabel]);
    }
    rows.push(['Link profile', device.metricsText]);
    const frag = document.createDocumentFragment();
    rows.forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value || '—';
      frag.append(dt, dd);
    });
    grid.appendChild(frag);
    actions.classList.remove('hidden');
    if (button) {
      button.onclick = () => {
        window.location.href = device.insightsUrl;
      };
    }
  }

  function renderTopology() {
    if (!state.elements.visualiser || !state.elements.links || !state.elements.nodes || !state.elements.linkLabels) {
      return;
    }
    const width = state.elements.visualiser.clientWidth;
    const height = state.elements.visualiser.clientHeight;
    if (!width || !height) {
      return;
    }
    const { center, layout, meta } = computeLayout(state.devices, width, height);
    state.center = center;
    state.defaultLayout = layout;
    state.layoutMeta = meta;
    state.elements.links.innerHTML = '';
    state.elements.linkLabels.innerHTML = '';
    state.elements.nodes.innerHTML = '';
    state.deviceElements.clear();

    if (!state.devices.length) {
      if (state.elements.empty) {
        state.elements.empty.classList.remove('hidden');
      }
      state.elements.links.setAttribute('viewBox', `0 0 ${width} ${height}`);
      state.elements.links.setAttribute('width', width);
      state.elements.links.setAttribute('height', height);
      state.elements.nodes.appendChild(createRootNode(center));
      return;
    }
    if (state.elements.empty) {
      state.elements.empty.classList.add('hidden');
    }

    state.elements.links.setAttribute('viewBox', `0 0 ${width} ${height}`);
    state.elements.links.setAttribute('width', width);
    state.elements.links.setAttribute('height', height);

    const root = createRootNode(center);
    state.elements.nodes.appendChild(root);

    const linksFragment = document.createDocumentFragment();
    const labelsFragment = document.createDocumentFragment();
    const nodesFragment = document.createDocumentFragment();

    state.devices.forEach((device) => {
      const baseLayout = layout.get(device.id);
      if (!baseLayout) { return; }
      const basePosition = baseLayout.position;
      const position = state.customPositions.get(device.id) || basePosition;
      const snappedPosition = {
        x: snapToGrid(position.x),
        y: snapToGrid(position.y)
      };
      const baseOffset = {
        x: baseLayout.corridor.x - basePosition.x,
        y: baseLayout.corridor.y - basePosition.y
      };
      const corridor = resolveCorridor(snappedPosition, baseOffset);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', buildPath(center, snappedPosition, corridor));
      path.setAttribute('class', `network-visualiser-link link-${device.link.id}`);
      path.setAttribute('stroke', device.link.color);
      path.dataset.deviceId = device.id;
      linksFragment.appendChild(path);

      const label = document.createElement('div');
      label.className = `network-visualiser-link-label link-${device.link.id}`;
      const labelPosition = computeLabelPosition(snappedPosition, corridor);
      label.style.left = `${labelPosition.x}px`;
      label.style.top = `${labelPosition.y}px`;
      label.textContent = `${device.link.label} • ${device.metricsText}`;
      label.dataset.position = `${labelPosition.x},${labelPosition.y}`;
      labelsFragment.appendChild(label);

      const node = createDeviceNode(device, snappedPosition, state.locationColours.get(device.locationKey), state.typeColours.get(device.kindKey));
      nodesFragment.appendChild(node);

      state.deviceElements.set(device.id, {
        node,
        link: path,
        label,
        position: snappedPosition,
        corridorOffset: {
          x: corridor.x - snappedPosition.x,
          y: corridor.y - snappedPosition.y
        }
      });
      enableDragging(node, device.id);
    });

    state.elements.links.appendChild(linksFragment);
    state.elements.linkLabels.appendChild(labelsFragment);
    state.elements.nodes.appendChild(nodesFragment);

    if (state.devices.length && (!state.selectedDeviceId || !state.deviceMap.has(state.selectedDeviceId))) {
      selectDevice(state.devices[0].id);
    } else {
      applyHighlight();
    }
  }

  function enableDragging(node, deviceId) {
    let pointerId = null;
    let startPointer = null;
    let lastPosition = null;
    let suppressClick = false;

    node.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) { return; }
      event.preventDefault();
      pointerId = event.pointerId;
      node.setPointerCapture(pointerId);
      const current = getNodePosition(deviceId) || { x: event.offsetX, y: event.offsetY };
      startPointer = {
        x: event.clientX,
        y: event.clientY,
        nodeX: current.x,
        nodeY: current.y
      };
      state.dragState = { active: false, deviceId };
      document.body.classList.add('cursor-dragging');
      suppressClick = false;
    });

    node.addEventListener('pointermove', (event) => {
      if (pointerId == null || event.pointerId !== pointerId || !startPointer) { return; }
      const deltaX = event.clientX - startPointer.x;
      const deltaY = event.clientY - startPointer.y;
      const visualiser = state.elements.visualiser;
      const bounds = {
        width: visualiser ? visualiser.clientWidth : 0,
        height: visualiser ? visualiser.clientHeight : 0
      };
      const next = clampPosition({
        x: startPointer.nodeX + deltaX,
        y: startPointer.nodeY + deltaY
      }, bounds);
      lastPosition = { x: snapToGrid(next.x), y: snapToGrid(next.y) };
      updateNodeGraphics(deviceId, lastPosition);
      state.customPositions.set(deviceId, lastPosition);
      state.dragState = { active: true, deviceId };
      suppressClick = true;
    });

    function endDrag(event) {
      if (pointerId == null || event.pointerId !== pointerId) { return; }
      node.releasePointerCapture(pointerId);
      pointerId = null;
      startPointer = null;
      document.body.classList.remove('cursor-dragging');
      if (state.dragState.active && !lastPosition) {
        const current = getNodePosition(deviceId);
        if (current) {
          state.customPositions.set(deviceId, current);
        }
      }
      state.dragState = { active: false, deviceId: null };
      lastPosition = null;
    }

    node.addEventListener('pointerup', endDrag);
    node.addEventListener('pointercancel', endDrag);
    node.addEventListener('click', (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
      }
    }, true);
  }

  function scheduleRender() {
    if (state.resizeScheduled) { return; }
    state.resizeScheduled = true;
    window.requestAnimationFrame(() => {
      state.resizeScheduled = false;
      renderTopology();
    });
  }

  async function loadTopology(force = false) {
    const shared = ensureShared();
    if (!shared?.stores?.devices) {
      setStatus('Device store unavailable.', 'error');
      return;
    }
    const token = ++state.loadToken;
    const loadingService = shared?.loading;
    const manualHandle = typeof loadingService?.begin === 'function'
      ? loadingService.begin({ id: `network-visualisation-${token}`, label: 'Loading topology' })
      : null;
    if (manualHandle && typeof loadingService?.update === 'function') {
      loadingService.update(manualHandle, 0.1);
    }
    setLoading(true);
    try {
      const rawDevices = await shared.stores.devices.load(force);
      if (token !== state.loadToken) { return; }
      if (manualHandle && typeof loadingService?.update === 'function') {
        loadingService.update(manualHandle, 0.35);
      }
      const list = Array.isArray(rawDevices) ? rawDevices.slice() : [];
      const deviceIds = list.map((device, index) => resolveDeviceId(device, index));
      const telemetry = await fetchTelemetry(list, token, deviceIds);
      if (token !== state.loadToken) { return; }
      if (manualHandle && typeof loadingService?.update === 'function') {
        loadingService.update(manualHandle, 0.6);
      }
      state.devices = await buildDevices(list, telemetry, deviceIds);
      if (token !== state.loadToken) { return; }
      if (manualHandle && typeof loadingService?.update === 'function') {
        loadingService.update(manualHandle, 0.85);
      }
      const typeGroups = groupByKey(state.devices, 'kindKey', 'kindLabel');
      const locationGroups = groupByKey(state.devices, 'locationKey', 'locationLabel');
      state.typeColours = assignColours(typeGroups, DEVICE_TYPE_PALETTE);
      state.locationColours = assignColours(locationGroups, LOCATION_PALETTE);
      renderLegend(state.elements.typeLegend, Array.from(typeGroups.values()), state.typeColours);
      renderLegend(state.elements.locationLegend, Array.from(locationGroups.values()), state.locationColours);
      renderLinkLegend();
      const validIds = new Set(state.devices.map((device) => device.id));
      Array.from(state.customPositions.keys()).forEach((id) => {
        if (!validIds.has(id)) {
          state.customPositions.delete(id);
        }
      });
      renderTopology();
      if (manualHandle && typeof loadingService?.update === 'function') {
        loadingService.update(manualHandle, 0.95);
      }
      const timeLabel = new Date().toLocaleTimeString();
      setStatus(`Updated ${timeLabel}`);
    } catch (error) {
      console.error('Failed to load network visualisation', error);
      state.devices = [];
      renderTopology();
      setStatus(`Unable to load topology: ${error.message || error}`, 'error');
    } finally {
      if (token === state.loadToken) {
        setLoading(false);
      }
      if (manualHandle && typeof loadingService?.done === 'function') {
        loadingService.done(manualHandle);
      }
    }
  }

  function bindEvents() {
    if (state.elements.refreshBtn) {
      state.elements.refreshBtn.addEventListener('click', () => loadTopology(true));
    }
    if (!state.boundResize) {
      state.boundResize = () => scheduleRender();
      window.addEventListener('resize', state.boundResize, { passive: true });
    }
  }

  const controller = {
    async init(context) {
      state.section = context.section;
      ensureShared(context.shared);
      cacheElements(state.section);
      bindEvents();
      setStatus('Preparing topology…', 'info');
      updateInsightPanel(null);
      await loadTopology(false);
    }
  };

  views['network-visualisation'] = controller;
})(window, document);
