(function (window, document) {
  'use strict';

  const PulseOps = window.PulseOps = window.PulseOps || {};
  const views = PulseOps.views = PulseOps.views || {};

  const SCAN_TIMEOUT_NS = 3_000_000_000; // 3 seconds expressed in nanoseconds
  const DEFAULT_MAX_CONCURRENCY = 50;

  const state = {
    shared: null,
    elements: {},
  ranges: [],
  selected: new Set(),
  portScan: true,
  scanning: false,
  savingManual: false,
  results: [],
  lastScanStarted: null,
  lastScanCompleted: null
};

const PING_STATUS_META = {
  ok: { label: 'Reachable', tone: 'success' },
  timeout: { label: 'Timeout', tone: 'warn' },
  permission: { label: 'Permission denied', tone: 'warn' },
  unsupported: { label: 'Ping unavailable', tone: 'muted' },
  error: { label: 'Error', tone: 'error' },
  unconfigured: { label: 'No ping host', tone: 'muted' },
  probing: { label: 'Checking…', tone: 'info' }
};

  function ensureShared(contextShared) {
    if (state.shared) {
      return state.shared;
    }
    const base = contextShared || PulseOps.shared;
    state.shared = base && typeof base.ensureReady === 'function' ? base.ensureReady() : base;
    return state.shared;
  }

  function attachGeoTooltip(element, value) {
    if (!(element instanceof Element)) { return; }
    const shared = ensureShared();
    const utils = shared?.utils;
    if (utils?.attachGeoTooltip) {
      utils.attachGeoTooltip(element, value);
    }
  }

  function buildRangeKey(range) {
    const network = (range.network || '').trim();
    const start = (range.start || '').trim();
    const end = (range.end || '').trim();
    return `${network}|${start}|${end}`;
  }

  function ipToNumber(ip) {
    if (!ip) { return null; }
    const parts = ip.split('.');
    if (parts.length !== 4) { return null; }
    const nums = parts.map((segment) => Number(segment));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return null;
    }
    return ((nums[0] * 256 + nums[1]) * 256 + nums[2]) * 256 + nums[3];
  }

  function computeRangeSize(range) {
    const startNum = ipToNumber(range.start);
    const endNum = ipToNumber(range.end);
    if (startNum == null || endNum == null || endNum < startNum) {
      return null;
    }
    return (endNum - startNum + 1);
  }

  function describeRange(range) {
    if (!range) { return 'range'; }
    if (range.label) {
      const labelText = String(range.label).trim();
      if (labelText) {
        return labelText;
      }
    }
    if (range.network) {
      return range.network;
    }
    if (range.start && range.end) {
      return `${range.start} – ${range.end}`;
    }
    return range.start || range.end || 'range';
  }

  function updateRunButtonState() {
    const { runBtn } = state.elements;
    if (!runBtn) { return; }
    runBtn.disabled = state.scanning || state.selected.size === 0;
  }

  function setStatus(message, tone = 'info') {
    const el = state.elements.status;
    if (!el) { return; }
    el.textContent = message || '';
    el.className = `network-analysis-status${tone ? ` status-${tone}` : ''}`;
  }

  function setLoading(isLoading, message) {
    state.scanning = isLoading;
    updateRunButtonState();
    const { refreshBtn, portScanInput } = state.elements;
    if (refreshBtn) {
      refreshBtn.disabled = isLoading;
    }
    if (portScanInput) {
      portScanInput.disabled = isLoading;
    }
    if (isLoading && message) {
      setStatus(message, 'info');
    }
  }

  function renderRanges() {
    const container = state.elements.rangeList;
    if (!container) { return; }
    container.innerHTML = '';

    if (!Array.isArray(state.ranges) || state.ranges.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state muted';
      empty.textContent = 'No networks available yet. Refresh to retry or add a manual entry.';
      container.appendChild(empty);
      updateRunButtonState();
      return;
    }

    const fragment = document.createDocumentFragment();

    state.ranges.forEach((range) => {
      const key = buildRangeKey(range);
      const card = document.createElement('div');
      card.className = 'network-analysis-range-card';
      if (range && range.manual) {
        card.classList.add('network-analysis-range-card--manual');
      }
      const kind = typeof range?.kind === 'string' ? range.kind.toLowerCase() : '';
      if (kind) {
        card.dataset.kind = kind;
      }
      const rangeId = typeof range?.id === 'string' && range.id ? range.id : key;
      const medium = typeof range?.medium === 'string' && range.medium.toLowerCase() === 'wireless' ? 'wireless' : 'wired';
      card.dataset.medium = medium;

      const header = document.createElement('header');
      header.className = 'network-analysis-range-header';
      const label = document.createElement('label');
      label.className = 'range-label';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.selected.has(key);
      checkbox.addEventListener('change', (event) => {
        if (event.target.checked) {
          state.selected.add(key);
        } else {
          state.selected.delete(key);
        }
        updateRunButtonState();
      });

      const labelText = document.createElement('span');
      labelText.className = 'range-title';
      labelText.textContent = range?.label ? range.label : describeRange(range);

      const hosts = computeRangeSize(range);
      const hostInfo = document.createElement('span');
      hostInfo.className = 'range-network';
      hostInfo.textContent = hosts ? `${hosts.toLocaleString()} addresses` : '';

      label.appendChild(checkbox);
      label.appendChild(labelText);
      header.appendChild(label);
      if (hostInfo.textContent) {
        header.appendChild(hostInfo);
      }

      const badgeWrap = document.createElement('div');
      badgeWrap.className = 'range-badges';
      if (kind && kind !== 'network') {
        const kindBadge = document.createElement('span');
        kindBadge.className = `range-badge range-badge--${kind}`;
        kindBadge.textContent = kind === 'vlan' ? 'VLAN' : kind.replace(/_/g, ' ');
        badgeWrap.appendChild(kindBadge);
      }
      if (range?.manual) {
        const manualBadge = document.createElement('span');
        manualBadge.className = 'range-badge range-badge--manual';
        manualBadge.textContent = 'Manual';
        badgeWrap.appendChild(manualBadge);
      } else if (range?.source) {
        const sourceBadge = document.createElement('span');
        sourceBadge.className = 'range-badge range-badge--detected';
        sourceBadge.textContent = 'Detected';
        badgeWrap.appendChild(sourceBadge);
      }
      const mediumBadge = document.createElement('span');
      mediumBadge.className = `range-badge range-badge--medium-${medium}`;
      mediumBadge.textContent = medium === 'wireless' ? 'Wi-Fi' : 'LAN';
      badgeWrap.appendChild(mediumBadge);
      if (badgeWrap.childElementCount) {
        header.appendChild(badgeWrap);
      }

      if (range?.manual) {
        const actions = document.createElement('div');
        actions.className = 'range-actions';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-link range-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.dataset.action = 'remove-manual-range';
        if (range?.id) {
          removeBtn.dataset.id = range.id;
        }
        actions.appendChild(removeBtn);
        header.appendChild(actions);
      }

      const meta = document.createElement('div');
      meta.className = 'network-analysis-range-meta';
      if (range?.network) {
        const networkLine = document.createElement('span');
        networkLine.className = 'range-meta-item';
        const networkLabel = document.createElement('strong');
        networkLabel.textContent = 'Network';
        const networkCode = document.createElement('code');
        networkCode.textContent = range.network;
        networkLine.appendChild(networkLabel);
        networkLine.appendChild(networkCode);
        meta.appendChild(networkLine);
      }

      const startLine = document.createElement('span');
      startLine.className = 'range-meta-item';
      const startLabel = document.createElement('strong');
      startLabel.textContent = 'Start';
      const startCode = document.createElement('code');
      startCode.textContent = range?.start || '—';
      startLine.appendChild(startLabel);
      startLine.appendChild(startCode);
      meta.appendChild(startLine);

      const endLine = document.createElement('span');
      endLine.className = 'range-meta-item';
      const endLabel = document.createElement('strong');
      endLabel.textContent = 'End';
      const endCode = document.createElement('code');
      endCode.textContent = range?.end || '—';
      endLine.appendChild(endLabel);
      endLine.appendChild(endCode);
      meta.appendChild(endLine);

      const mediumControl = document.createElement('div');
      mediumControl.className = 'network-analysis-range-medium';
      const mediumLabel = document.createElement('span');
      mediumLabel.textContent = 'Primary link';
      const mediumSelect = document.createElement('select');
      mediumSelect.className = 'range-medium-select';
      mediumSelect.innerHTML = `
        <option value="wired">Wired (LAN)</option>
        <option value="wireless">Wireless (Wi-Fi)</option>
      `;
      mediumSelect.value = medium;
      mediumSelect.dataset.rangeId = rangeId;
      mediumSelect.addEventListener('change', (event) => {
        const value = event.target.value;
        updateRangeMedium(range, value, mediumSelect);
      });
      mediumControl.appendChild(mediumLabel);
      mediumControl.appendChild(mediumSelect);

      const pingInfo = document.createElement('div');
      pingInfo.className = 'network-analysis-range-ping';
      const pingMeta = summarisePing(range);
      const pingBadge = document.createElement('span');
      pingBadge.className = `ping-status ping-status--${pingMeta.tone}`;
      pingBadge.textContent = pingMeta.label;
      pingInfo.appendChild(pingBadge);

      if (pingMeta.detail) {
        const detail = document.createElement('span');
        detail.className = 'ping-detail';
        detail.textContent = pingMeta.detail;
        pingInfo.appendChild(detail);
      }

      if (pingMeta.timestamp) {
        const time = document.createElement('span');
        time.className = 'ping-timestamp muted';
        time.textContent = pingMeta.timestamp;
        pingInfo.appendChild(time);
      }

      if (pingMeta.error) {
        const error = document.createElement('span');
        error.className = 'ping-error muted';
        error.textContent = pingMeta.error;
        pingInfo.appendChild(error);
      }

      const hostLine = document.createElement('div');
      hostLine.className = 'network-analysis-range-host muted';
      const pingHost = range?.ping_host || range?.pingHost || '';
      if (pingHost || range?.start) {
        const hostLabel = document.createElement('strong');
        hostLabel.textContent = 'Ping host';
        const hostCode = document.createElement('code');
        hostCode.textContent = pingHost || range?.start || '—';
        hostLine.appendChild(hostLabel);
        hostLine.appendChild(hostCode);
      }

      card.appendChild(header);
      card.appendChild(meta);
      card.appendChild(mediumControl);
      card.appendChild(pingInfo);
      if (hostLine.childElementCount) {
        card.appendChild(hostLine);
      }
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
    updateRunButtonState();
  }

  function summarisePing(range) {
    const statusRaw = range?.ping_status ?? range?.pingStatus ?? '';
    const status = String(statusRaw || '').toLowerCase() || 'unknown';
    const meta = PING_STATUS_META[status] || { label: 'Unknown', tone: 'muted' };
    const latencyRaw = range?.ping_latency_ms ?? range?.pingLatencyMs;
    const latency = Number(latencyRaw);
    const detailParts = [];
    let error = '';

    switch (status) {
      case 'ok':
        if (Number.isFinite(latency)) {
          const rounded = latency >= 100 ? Math.round(latency) : Number(latency.toFixed(1));
          detailParts.push(`${rounded} ms`);
        }
        break;
      case 'timeout':
        detailParts.push('No response');
        break;
      case 'permission':
        detailParts.push('Requires elevated privileges');
        break;
      case 'unsupported':
        detailParts.push('Ping unavailable');
        break;
      case 'unconfigured':
        detailParts.push('Set a ping host');
        break;
      case 'probing':
        detailParts.push('Working…');
        break;
      case 'error':
        error = String(range?.ping_error || range?.pingError || '').trim();
        break;
      default:
        if (Number.isFinite(latency)) {
          const fallback = latency >= 100 ? Math.round(latency) : Number(latency.toFixed(1));
          detailParts.push(`${fallback} ms`);
        }
        break;
    }

    const timestamp = formatPingTimestamp(range?.ping_checked_at ?? range?.pingCheckedAt);

    return {
      label: meta.label,
      tone: meta.tone || 'muted',
      detail: detailParts.join(' • ') || '',
      timestamp,
      error
    };
  }

  function formatPingTimestamp(value) {
    if (!value) {
      return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const shared = ensureShared();
    const formatter = shared?.utils?.formatDateTime;
    if (typeof formatter === 'function') {
      return formatter(date);
    }
    return date.toLocaleString();
  }

  function setManualFormDisabled(disabled) {
    const keys = ['manualForm', 'manualLabel', 'manualKind', 'manualMedium', 'manualNetwork', 'manualPing', 'manualSubmit'];
    keys.forEach((key) => {
      const el = state.elements[key];
      if (!el) { return; }
      if (key === 'manualForm') {
        el.classList.toggle('is-disabled', !!disabled);
      } else {
        el.disabled = !!disabled;
      }
    });
  }

  async function handleManualFormSubmit(event) {
    event.preventDefault();
    if (state.savingManual) {
      return;
    }

    const shared = ensureShared();
    if (!shared?.utils?.jsonFetch) {
      setStatus('Unable to add manual range: HTTP client unavailable.', 'error');
      return;
    }

    const labelInput = state.elements.manualLabel;
    const networkInput = state.elements.manualNetwork;
    const pingInput = state.elements.manualPing;
    const kindSelect = state.elements.manualKind;
    const mediumSelect = state.elements.manualMedium;

    const label = labelInput?.value.trim() || '';
    const network = networkInput?.value.trim() || '';
    const pingHost = pingInput?.value.trim() || '';
    const kind = kindSelect?.value || 'network';
    const medium = mediumSelect?.value || 'wired';

    if (!label) {
      setStatus('Provide a label for the manual entry.', 'warn');
      if (labelInput) { labelInput.focus(); }
      return;
    }
    if (!network) {
      setStatus('Provide a network in CIDR notation (for example 192.168.50.0/24).', 'warn');
      if (networkInput) { networkInput.focus(); }
      return;
    }

    state.savingManual = true;
    setManualFormDisabled(true);
    setStatus(`Adding ${label}…`, 'info');
    try {
      const payload = await shared.utils.jsonFetch('/api/discovery/ranges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, kind, medium, network, ping_host: pingHost })
      });
      const key = buildRangeKey(payload);
      if (key) {
        state.selected.add(key);
      }
      await loadRanges();
      if (state.elements.manualForm) {
        state.elements.manualForm.reset();
      }
      if (state.elements.manualKind) {
        state.elements.manualKind.value = 'network';
      }
      if (state.elements.manualMedium) {
        state.elements.manualMedium.value = 'wired';
      }
      const mediumLabel = (payload?.medium || medium) === 'wireless' ? 'Wi-Fi' : 'wired';
      setStatus(`Added ${payload?.label || label} (${mediumLabel}).`, 'success');
    } catch (error) {
      console.error('Failed to add manual range', error);
      setStatus(`Unable to add manual range: ${error.message}`, 'error');
    } finally {
      state.savingManual = false;
      setManualFormDisabled(false);
    }
  }

  async function deleteManualRange(id, trigger) {
    const range = state.ranges.find((item) => item?.id === id);
    const name = range?.label || range?.network || 'manual range';

    if (!id) {
      return;
    }

    if (!window.confirm(`Remove ${name}?`)) {
      return;
    }

    const shared = ensureShared();
    if (!shared?.utils?.jsonFetch) {
      setStatus('Unable to remove manual range: HTTP client unavailable.', 'error');
      return;
    }

    const key = range ? buildRangeKey(range) : null;
    if (trigger) {
      trigger.disabled = true;
    }
    setStatus(`Removing ${name}…`, 'info');
    try {
      await shared.utils.jsonFetch(`/api/discovery/ranges/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (key) {
        state.selected.delete(key);
      }
      await loadRanges();
      setStatus(`${name} removed.`, 'success');
    } catch (error) {
      console.error('Failed to delete manual range', error);
      setStatus(`Unable to remove manual range: ${error.message}`, 'error');
    } finally {
      if (trigger) {
        trigger.disabled = false;
      }
    }
  }

  async function updateRangeMedium(range, medium, select) {
    const rangeId = (range?.id && String(range.id).trim()) || buildRangeKey(range);
    if (!rangeId) {
      return;
    }

    const shared = ensureShared();
    if (!shared?.utils?.jsonFetch) {
      setStatus('Unable to update link: HTTP client unavailable.', 'error');
      return;
    }

    const mode = medium === 'wireless' ? 'wireless' : 'wired';
    const label = range?.label || describeRange(range);

    if (select) {
      select.disabled = true;
    }
    setStatus(`Updating ${label} link…`, 'info');

    try {
      await shared.utils.jsonFetch(`/api/discovery/ranges/${encodeURIComponent(rangeId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium: mode })
      });

      range.medium = mode;
      const existingIndex = state.ranges.findIndex((item) => {
        const itemId = (item?.id && String(item.id).trim()) || buildRangeKey(item);
        return itemId === rangeId;
      });
      if (existingIndex !== -1) {
        state.ranges[existingIndex].medium = mode;
      }
      if (select) {
        const card = select.closest('.network-analysis-range-card');
        if (card) {
          card.dataset.medium = mode;
        }
      }
      setStatus(`${label} link set to ${mode === 'wireless' ? 'Wi-Fi' : 'wired LAN'}.`, 'success');
    } catch (error) {
      console.error('Failed to update range medium', error);
      if (select) {
        const fallback = typeof range?.medium === 'string' ? range.medium : 'wired';
        select.value = fallback === 'wireless' ? 'wireless' : 'wired';
      }
      setStatus(`Unable to update link: ${error.message}`, 'error');
    } finally {
      if (select) {
        select.disabled = false;
      }
    }
  }

  function handleRangeListClick(event) {
    const target = event.target.closest('[data-action="remove-manual-range"]');
    if (!target) {
      return;
    }
    const id = target.dataset.id;
    if (!id) {
      return;
    }
    deleteManualRange(id, target);
  }

  async function loadRanges() {
    const shared = ensureShared();
    if (!shared?.utils?.jsonFetch) {
      setStatus('Unable to load discovery ranges: HTTP client unavailable.', 'error');
      return;
    }
    setStatus('Loading networks and VLANs…', 'info');
    try {
      const payload = await shared.utils.jsonFetch('/api/discovery/ranges');
      const ranges = Array.isArray(payload) ? payload : [];
      const transformed = ranges.map((item) => {
        const clone = { ...item };
        clone.medium = typeof item?.medium === 'string' && item.medium.toLowerCase() === 'wireless'
          ? 'wireless'
          : 'wired';
        return clone;
      });
      const previousSelection = state.selected.size ? new Set(state.selected) : null;
      state.selected.clear();
      state.ranges = transformed;
      transformed.forEach((range) => {
        const key = buildRangeKey(range);
        if (!previousSelection || previousSelection.has(key)) {
          state.selected.add(key);
        }
      });
      renderRanges();
      if (ranges.length) {
        setStatus('Select one or more network groups to include in the scan.', 'info');
      } else {
        setStatus('No networks detected. Refresh after interfaces change or add devices manually.', 'warn');
      }
    } catch (error) {
      console.error('Failed to load discovery ranges', error);
      state.ranges = [];
      renderRanges();
      setStatus(`Unable to load network ranges: ${error.message}`, 'error');
    }
  }

  function getSelectedRanges() {
    if (!Array.isArray(state.ranges) || state.ranges.length === 0) {
      return [];
    }
    return state.ranges.filter((range) => state.selected.has(buildRangeKey(range)));
  }

  function resolveDeviceLocation(device) {
    const shared = ensureShared();
    const resolver = shared?.utils?.resolveNetworkLocation;
    if (typeof resolver !== 'function') {
      return null;
    }
    return resolver(device);
  }

  function renderResults() {
    const tbody = state.elements.resultsBody;
    const resultsPanel = state.elements.resultsPanel;
    if (!tbody || !resultsPanel) { return; }

    tbody.innerHTML = '';
    if (!Array.isArray(state.results) || state.results.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'muted';
      cell.textContent = 'No devices were discovered during the last scan.';
      row.appendChild(cell);
      tbody.appendChild(row);
      resultsPanel.classList.add('hidden');
      return;
    }

    resultsPanel.classList.remove('hidden');
    const sorted = state.results.slice().sort((a, b) => {
      const aNum = ipToNumber(a.ip || a.IP);
      const bNum = ipToNumber(b.ip || b.IP);
      if (aNum == null && bNum == null) { return 0; }
      if (aNum == null) { return 1; }
      if (bNum == null) { return -1; }
      return aNum - bNum;
    });

    const fragment = document.createDocumentFragment();
    sorted.forEach((device) => {
      const range = device.__range || {};
      const row = document.createElement('tr');

      const ipCell = document.createElement('td');
      ipCell.textContent = device.ip || device.IP || '—';
      attachGeoTooltip(ipCell, device.ip || device.IP);
      row.appendChild(ipCell);

      const hostCell = document.createElement('td');
      hostCell.textContent = device.hostname || device.Hostname || '—';
      row.appendChild(hostCell);

      const locationCell = document.createElement('td');
      const locationDetails = resolveDeviceLocation(device);
      if (locationDetails) {
        const badge = document.createElement('span');
        badge.className = `network-location-badge network-location-badge--${locationDetails.category}`;
        badge.textContent = locationDetails.label;
        if (locationDetails.description || locationDetails.reason) {
          badge.title = locationDetails.description || locationDetails.reason;
        }
        locationCell.appendChild(badge);
      } else {
        locationCell.textContent = 'Unknown';
      }
      row.appendChild(locationCell);

      const latencyCell = document.createElement('td');
      const latency = typeof device.ping_time === 'number' ? device.ping_time : device.PingTime;
      latencyCell.textContent = Number.isFinite(latency) ? latency.toFixed(1) : '—';
      row.appendChild(latencyCell);

      const portsCell = document.createElement('td');
      const ports = Array.isArray(device.open_ports) ? device.open_ports : device.OpenPorts;
      portsCell.textContent = Array.isArray(ports) && ports.length ? ports.join(', ') : '—';
      row.appendChild(portsCell);

      const rangeCell = document.createElement('td');
      rangeCell.textContent = describeRange(range);
      row.appendChild(rangeCell);

      fragment.appendChild(row);
    });

    tbody.appendChild(fragment);
  }

  function updateSummary() {
    const summaryPanel = state.elements.summaryPanel;
    if (!summaryPanel) { return; }
    if (!Array.isArray(state.results) || state.results.length === 0) {
      summaryPanel.classList.add('hidden');
      state.elements.total.textContent = '0';
      state.elements.lan.textContent = '0';
      state.elements.vlan.textContent = '0';
      state.elements.remote.textContent = '0';
      state.elements.latency.textContent = '—';
      state.elements.timestamp.textContent = '—';
      return;
    }

    summaryPanel.classList.remove('hidden');
    let lan = 0;
    let vlan = 0;
    let remote = 0;
    let latencySum = 0;
    let latencyCount = 0;

    state.results.forEach((device) => {
      const location = resolveDeviceLocation(device);
      if (location) {
        switch (location.category) {
          case 'lan':
            lan += 1;
            break;
          case 'local_vlan':
            vlan += 1;
            break;
          case 'remote':
            remote += 1;
            break;
          default:
            break;
        }
      }
      const latency = typeof device.ping_time === 'number' ? device.ping_time : device.PingTime;
      if (Number.isFinite(latency)) {
        latencySum += latency;
        latencyCount += 1;
      }
    });

    const shared = ensureShared();
    state.elements.total.textContent = state.results.length.toLocaleString();
    state.elements.lan.textContent = lan.toLocaleString();
    state.elements.vlan.textContent = vlan.toLocaleString();
    state.elements.remote.textContent = remote.toLocaleString();
    state.elements.latency.textContent = latencyCount ? (latencySum / latencyCount).toFixed(1) : '—';
    if (state.lastScanCompleted) {
      const formatter = shared?.utils?.formatDateTime;
      state.elements.timestamp.textContent = typeof formatter === 'function'
        ? formatter(state.lastScanCompleted)
        : state.lastScanCompleted.toLocaleString();
    } else {
      state.elements.timestamp.textContent = '—';
    }
  }

  function buildScanPayload(range) {
    return {
      network: range.network || '',
      start: range.start || '',
      end: range.end || '',
      options: {
        timeout: SCAN_TIMEOUT_NS,
        max_concurrent: DEFAULT_MAX_CONCURRENCY,
        port_scan: !!state.portScan,
        resolve_names: true
      }
    };
  }

  async function handleRunScan() {
    if (state.scanning) {
      return;
    }
    const ranges = getSelectedRanges();
    if (!ranges.length) {
      setStatus('Select at least one network range to scan.', 'warn');
      return;
    }

    const shared = ensureShared();
    if (!shared?.utils?.jsonFetch) {
      setStatus('Unable to start scan: HTTP client unavailable.', 'error');
      return;
    }

    state.results = [];
    state.lastScanStarted = new Date();
    state.lastScanCompleted = null;
    setLoading(true, 'Starting network scan…');

    const errors = [];

    for (const range of ranges) {
      const label = describeRange(range);
      setStatus(`Scanning ${label}…`, 'info');
      try {
        const payload = await shared.utils.jsonFetch('/api/discovery/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildScanPayload(range))
        });
        const devices = Array.isArray(payload?.devices) ? payload.devices : [];
        devices.forEach((device) => {
          device.__range = range;
          state.results.push(device);
        });
      } catch (error) {
        console.error('Network scan failed for range', range, error);
        errors.push({ range, message: error.message });
      }
    }

    state.lastScanCompleted = new Date();
    setLoading(false);

    renderResults();
    updateSummary();

    if (errors.length && state.results.length) {
      const summary = errors.map((item) => `${describeRange(item.range)} (${item.message})`).join('; ');
      setStatus(`Scan completed with ${errors.length} error${errors.length === 1 ? '' : 's'}: ${summary}`, 'warn');
    } else if (errors.length) {
      setStatus(`Scan failed: ${errors[0].message}`, 'error');
    } else if (!state.results.length) {
      setStatus('Scan completed but no devices responded.', 'warn');
    } else {
      const elapsedMs = state.lastScanCompleted - state.lastScanStarted;
      const seconds = (elapsedMs / 1000).toFixed(1);
      setStatus(`Scan completed in ${seconds}s.`, 'success');
    }
  }

  const controller = {
    async init(context) {
      ensureShared(context.shared);
      state.elements = {
        section: context.section,
        rangeList: context.section.querySelector('#network-analysis-range-list'),
        refreshBtn: context.section.querySelector('#network-analysis-refresh-ranges'),
        portScanInput: context.section.querySelector('#network-analysis-port-scan'),
        runBtn: context.section.querySelector('#network-analysis-run'),
        status: context.section.querySelector('#network-analysis-status'),
        manualForm: context.section.querySelector('#network-analysis-manual-form'),
        manualLabel: context.section.querySelector('#network-analysis-manual-label'),
        manualKind: context.section.querySelector('#network-analysis-manual-kind'),
        manualMedium: context.section.querySelector('#network-analysis-manual-medium'),
        manualNetwork: context.section.querySelector('#network-analysis-manual-network'),
        manualPing: context.section.querySelector('#network-analysis-manual-ping'),
        manualSubmit: context.section.querySelector('#network-analysis-manual-submit'),
        summaryPanel: context.section.querySelector('#network-analysis-summary'),
        resultsPanel: context.section.querySelector('#network-analysis-results'),
        resultsBody: context.section.querySelector('#network-analysis-results-body'),
        total: context.section.querySelector('#network-analysis-total'),
        lan: context.section.querySelector('#network-analysis-lan'),
        vlan: context.section.querySelector('#network-analysis-vlan'),
        remote: context.section.querySelector('#network-analysis-remote'),
        latency: context.section.querySelector('#network-analysis-latency'),
        timestamp: context.section.querySelector('#network-analysis-timestamp')
      };

      if (state.elements.portScanInput) {
        state.elements.portScanInput.checked = state.portScan;
        state.elements.portScanInput.addEventListener('change', (event) => {
          state.portScan = !!event.target.checked;
        });
      }

      if (state.elements.refreshBtn) {
        state.elements.refreshBtn.addEventListener('click', () => {
          if (state.scanning) { return; }
          loadRanges();
        });
      }

      if (state.elements.manualForm) {
        state.elements.manualForm.addEventListener('submit', handleManualFormSubmit);
      }

      if (state.elements.rangeList) {
        state.elements.rangeList.addEventListener('click', handleRangeListClick);
      }

      if (state.elements.runBtn) {
        state.elements.runBtn.addEventListener('click', handleRunScan);
      }

      renderRanges();
      updateRunButtonState();
      await loadRanges();
    },
    destroy() {
      state.results = [];
      state.selected.clear();
    }
  };

  views['network-analysis'] = controller;
})(window, document);
