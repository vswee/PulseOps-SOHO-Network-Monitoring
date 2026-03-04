/**
 * PulseOps Dashboard - Activity Logs View
 *
 * Displays system and device activity logs with filtering capabilities
 */
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

  // Debug logging helper
  function debug(message, data) {
    const shared = ensureShared();
    if (shared?.utils?.debugLog) {
      shared.utils.debugLog('LOGS', message, data);
    }
  }

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

  const SAMPLE_LOGS = [
    {
      id: 1,
      source: 'device',
      level: 'info',
      deviceName: 'Core Router 1',
      deviceKind: 'router',
      deviceHost: '10.0.0.1',
      message: 'Configuration validated successfully.',
      timestamp: new Date(Date.now() - 1000 * 60 * 8).toISOString()
    },
    {
      id: 2,
      source: 'system',
      level: 'warn',
      category: 'device.delete',
      message: 'Device Edge Firewall 2 scheduled for deletion.',
      timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      context: { device_id: 42, user: 'admin' }
    },
    {
      id: 3,
      source: 'device',
      level: 'error',
      deviceName: 'Branch Switch 7',
      deviceKind: 'switch',
      deviceHost: '192.168.50.12',
      message: 'Backup failed: SSH authentication error.',
      timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString()
    }
  ];

  const state = {
    entries: [],
    loading: false,
    filters: {},
    elements: {},
    shared: null,
    unsubscribeDevices: null,
    standaloneInitialised: false
  };

  function escapeLogSelector(value) {
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

  function buildLogSelector(value) {
    const escaped = escapeLogSelector(value);
    return `[data-log-id="${escaped}"]`;
  }

  function formatLogTimestamp(timestamp) {
    if (!timestamp) { return 'recently'; }
    try {
      return state.shared?.utils?.formatDateTime(timestamp) || new Date(timestamp).toLocaleString();
    } catch (_) {
      return 'recently';
    }
  }

  function publishAgentContext(context) {
    if (!context) { return; }
    const sharedCtx = state.shared || ensureShared();
    const events = sharedCtx?.events;
    if (events && typeof events.emit === 'function') {
      events.emit('agent:context', context);
    }
  }

  function buildLogsAgentContext(entries) {
    const highlights = [];
    let errorCount = 0;
    let warnCount = 0;

    entries.slice(0, 20).forEach((entry, index) => {
      if (!entry) { return; }
      const level = String(entry.level || '').toLowerCase();
      const id = entry.id != null ? entry.id : `log-${index}`;
      const selector = buildLogSelector(id);
      const deviceLabel = entry.deviceName || entry.deviceHost || (entry.source === 'system' ? 'PulseOps' : 'device');
      const detailTime = formatLogTimestamp(entry.timestamp);
      const baseHighlight = {
        id: `logs-${id}`,
        title: `${(level || 'info').toUpperCase()} log from ${deviceLabel}`,
        detail: `'${entry.message || 'Log entry'}' ${detailTime}.`,
        severity: 'info',
        category: 'log',
        selector,
        logId: id,
        actions: [
          entry.source === 'system'
            ? 'Review orchestration workflows in PulseOps for correlated automation events.'
            : 'Open the device card to run diagnostics and review recent configuration changes.',
          'Correlate with timeline events or alerts to determine blast radius.'
        ],
        deviceName: deviceLabel
      };
      if (level === 'error' || level === 'critical') {
        errorCount += 1;
        baseHighlight.severity = 'critical';
      } else if (level === 'warn' || level === 'warning') {
        warnCount += 1;
        baseHighlight.severity = 'warning';
      } else {
        return;
      }
      highlights.push(baseHighlight);
    });

    const summaryParts = [];
    if (!entries.length) {
      summaryParts.push('No logs match the current filters. Adjust the criteria or time window.');
    } else {
      summaryParts.push(`Showing ${entries.length} log ${entries.length === 1 ? 'entry' : 'entries'}.`);
      if (errorCount) {
        summaryParts.push(`${errorCount} critical log${errorCount === 1 ? '' : 's'} need immediate attention.`);
      }
      if (warnCount) {
        summaryParts.push(`${warnCount} warning${warnCount === 1 ? '' : 's'} flagged for follow-up.`);
      }
      if (!errorCount && !warnCount) {
        summaryParts.push('No high-severity activity detected in this view.');
      }
    }

    const signature = [
      entries.length,
      errorCount,
      warnCount,
      highlights.map((item) => item.id).join('|')
    ].join('::');

    return {
      route: 'logs',
      summary: summaryParts.join(' '),
      highlights,
      meta: { total: entries.length, errorCount, warnCount },
      signature,
      generatedAt: Date.now()
    };
  }

  function buildQuery() {
    const params = new URLSearchParams();
    const source = state.elements.source?.value;
    if (source && source !== 'all') {
      params.set('source', source);
    }
    const level = state.elements.level?.value;
    if (level) {
      params.set('log_level', level);
    }
    const deviceKind = state.elements.deviceKind?.value;
    if (deviceKind) {
      params.set('device_kind', deviceKind);
    }
    const deviceId = state.elements.deviceId?.value;
    if (deviceId) {
      params.set('device_id', deviceId);
    }
    const range = state.elements.ipRange?.value.trim();
    if (range) {
      params.set('ip_range', range);
    }
    const search = state.elements.search?.value.trim();
    if (search) {
      params.set('q', search);
    }
    return params;
  }

  function setStatus(message) {
    if (state.elements.status) {
      state.elements.status.textContent = message || '';
    }
  }

  function renderEntries() {
    const container = state.elements.results;
    if (!container) {
      publishAgentContext(buildLogsAgentContext(state.entries));
      return;
    }
    container.innerHTML = '';
    if (state.loading) {
      container.innerHTML = '<div class="muted">Loading logs…</div>';
      publishAgentContext(buildLogsAgentContext(state.entries));
      return;
    }
    if (!state.entries.length) {
      container.innerHTML = '<div class="empty-state">No logs match the selected filters.</div>';
      publishAgentContext(buildLogsAgentContext(state.entries));
      return;
    }
    const fragment = document.createDocumentFragment();
    state.entries.forEach((entry, index) => {
      const article = document.createElement('article');
      article.className = 'log-entry';
      const logId = entry?.id != null ? entry.id : `row-${index}`;
      article.setAttribute('data-log-id', String(logId));

      const title = document.createElement('div');
      title.className = 'log-message';
      title.textContent = entry.message || 'Log entry';

      const meta = document.createElement('div');
      meta.className = 'log-meta';
      const level = document.createElement('span');
      level.className = `log-level ${entry.level || ''}`.trim();
      level.textContent = (entry.level || 'info').toUpperCase();
      meta.appendChild(level);

      const time = document.createElement('span');
      time.textContent = state.shared.utils.formatDateTime(entry.timestamp);
      meta.appendChild(time);

      const source = document.createElement('span');
      source.textContent = entry.source === 'device' ? 'Device log' : 'PulseOps';
      meta.appendChild(source);

      if (entry.deviceName || entry.deviceHost) {
        const device = document.createElement('span');
        const name = entry.deviceName || entry.deviceHost;
        device.textContent = `${name}${entry.deviceHost && entry.deviceHost !== name ? ` (${entry.deviceHost})` : ''}`;
        meta.appendChild(device);
      }

      if (entry.category) {
        const category = document.createElement('span');
        category.textContent = entry.category;
        meta.appendChild(category);
      }

      article.appendChild(meta);
      article.appendChild(title);

      if (entry.context && typeof entry.context === 'object') {
        const contextList = document.createElement('div');
        contextList.className = 'log-context';
        Object.entries(entry.context).forEach(([key, value]) => {
          const line = document.createElement('div');
          line.className = 'log-context-line';
          line.textContent = `${key}: ${value}`;
          contextList.appendChild(line);
        });
        article.appendChild(contextList);
      }

      fragment.appendChild(article);
    });
    container.appendChild(fragment);

    publishAgentContext(buildLogsAgentContext(state.entries));
  }

  async function loadLogs() {
    state.loading = true;
    setStatus('Loading recent activity…');
    debug('loadLogs() started');
    renderEntries();
    try {
      const params = buildQuery();
      params.set('limit', '200');
      const url = `/api/logs?${params.toString()}`;
      debug('Fetching logs from API', { url });
      const response = await state.shared.utils.jsonFetch(url);
      state.entries = Array.isArray(response) ? response : [];
      debug('Logs fetched successfully', { count: state.entries.length });
      if (!state.entries.length) {
        setStatus('No recent logs were returned.');
      } else {
        setStatus(`Showing ${state.entries.length} recent log entries.`);
      }
    } catch (error) {
      debug('Failed to load logs from API', { error: error.message });
      console.warn('Failed to load logs, using sample data', error);
      state.shared.toasts.show({ message: 'Unable to load activity logs. Showing demo data.', type: 'warning', duration: 5000 });
      state.entries = cloneDeep(SAMPLE_LOGS);
      setStatus('Showing sample log data.');
    } finally {
      state.loading = false;
      debug('loadLogs() completed', { entryCount: state.entries.length });
      renderEntries();
    }
  }

  function populateDeviceFilters(devices) {
    if (!state.elements.deviceKind || !state.elements.deviceId) { return; }
    const types = new Set();
    state.elements.deviceKind.innerHTML = '<option value="">All types</option>';
    state.elements.deviceId.innerHTML = '<option value="">All devices</option>';
    devices.forEach((device) => {
      const kind = (device.kind || '').toString().toLowerCase();
      if (kind) {
        types.add(kind);
      }
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.name || device.host || `Device ${device.id}`;
      state.elements.deviceId.appendChild(option);
    });
    Array.from(types).sort().forEach((kind) => {
      const option = document.createElement('option');
      option.value = kind;
      option.textContent = kind.replace(/\b\w/g, (char) => char.toUpperCase());
      state.elements.deviceKind.appendChild(option);
    });
  }

  // Initialize for standalone page
    async function initStandalone() {
      if (state.standaloneInitialised) {
        return;
      }
      state.standaloneInitialised = true;
      state.shared = ensureShared();
    state.elements = {
      form: document.querySelector('#logs-filter-form'),
      source: document.querySelector('#logs-source'),
      deviceKind: document.querySelector('#logs-device-kind'),
      deviceId: document.querySelector('#logs-device-id'),
      level: document.querySelector('#logs-level'),
      ipRange: document.querySelector('#logs-ip-range'),
      search: document.querySelector('#logs-search'),
      reset: document.querySelector('#logs-reset'),
      status: document.querySelector('#logs-status'),
      results: document.querySelector('#logs-results')
    };

    // Set up event listeners
    setupEventListeners();

    // Subscribe to device updates for filters
    state.unsubscribeDevices = state.shared.stores.devices.subscribe((devices) => {
      populateDeviceFilters(Array.isArray(devices) ? devices : []);
    });

    await state.shared.stores.devices.load();
    await loadLogs();
  }

  function setupEventListeners() {
    if (state.elements.form) {
      state.elements.form.addEventListener('submit', (event) => {
        event.preventDefault();
        loadLogs();
      });
    }
    if (state.elements.reset) {
      state.elements.reset.addEventListener('click', () => {
        state.elements.form?.reset();
        loadLogs();
      });
    }
  }

    const controller = {
      async init(context) {
        debug('init() called', { route: context.route });
        state.shared = context.shared;
        state.elements = {
          form: context.section.querySelector('#logs-filter-form'),
          source: context.section.querySelector('#logs-source'),
          deviceKind: context.section.querySelector('#logs-device-kind'),
          deviceId: context.section.querySelector('#logs-device-id'),
          level: context.section.querySelector('#logs-level'),
          ipRange: context.section.querySelector('#logs-ip-range'),
          search: context.section.querySelector('#logs-search'),
          reset: context.section.querySelector('#logs-reset'),
          status: context.section.querySelector('#logs-status'),
          results: context.section.querySelector('#logs-results')
        };

        debug('Elements bound', { elementCount: Object.keys(state.elements).length });

        setupEventListeners();

        state.unsubscribeDevices = context.shared.stores.devices.subscribe((devices) => {
          debug('Device subscription triggered', { deviceCount: Array.isArray(devices) ? devices.length : 0 });
          populateDeviceFilters(Array.isArray(devices) ? devices : []);
        });

        debug('Loading devices store...');
        await context.shared.stores.devices.load();
        debug('Devices loaded, loading logs...');

        // Show loading state
        setStatus('Loading activity logs...');

        await loadLogs();
        debug('Logs loaded');
      },
      onShow() {
        if (!state.loading && !state.entries.length) {
          loadLogs();
        }
      },
      onHide() {},
      destroy() {
        if (typeof state.unsubscribeDevices === 'function') {
          state.unsubscribeDevices();
          state.unsubscribeDevices = null;
        }
      }
    };

    views.logs = controller;

    PulseOps.whenReady(() => {
      if (document.body.dataset.page === 'dashboard') {
        initStandalone();
      }
    });
})(window, document);
