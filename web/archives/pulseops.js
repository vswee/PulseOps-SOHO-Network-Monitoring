'use strict';

(function () {
  // Theme manager consolidates existing theme logic so other modules can reuse it.
  class ThemeManager {
    constructor() {
      this.themes = {
        light: 'Light',
        dark: 'Dark',
        retro: 'Retro Terminal',
        sophisticated: 'Sophisticated Blue',
        system: 'Match System'
      };
      this.currentTheme = this.getStoredTheme() || 'system';
      this.init();
    }

    init() {
      this.applyTheme(this.currentTheme);
      this.setupSystemThemeListener();
    }

    getStoredTheme() {
      try {
        return localStorage.getItem('pulseops-theme');
      } catch (err) {
        console.warn('Unable to read stored theme preference', err);
        return null;
      }
    }

    setStoredTheme(theme) {
      try {
        localStorage.setItem('pulseops-theme', theme);
      } catch (err) {
        console.warn('Unable to persist theme preference', err);
      }
    }

    getSystemTheme() {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      return 'light';
    }

    applyTheme(theme) {
      const root = document.documentElement;
      root.removeAttribute('data-theme');
      if (theme === 'system') {
        this.currentTheme = 'system';
      } else {
        root.setAttribute('data-theme', theme);
        this.currentTheme = theme;
      }
      this.setStoredTheme(theme);
      window.dispatchEvent(new CustomEvent('themechange', {
        detail: { theme, effectiveTheme: this.getEffectiveTheme() }
      }));
    }

    getEffectiveTheme() {
      if (this.currentTheme === 'system') {
        return this.getSystemTheme();
      }
      return this.currentTheme;
    }

    setTheme(theme) {
      if (Object.prototype.hasOwnProperty.call(this.themes, theme)) {
        this.applyTheme(theme);
      }
    }

    getTheme() {
      return this.currentTheme;
    }

    getAvailableThemes() {
      return { ...this.themes };
    }

    setupSystemThemeListener() {
      if (!window.matchMedia) {
        return;
      }
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        if (this.currentTheme === 'system') {
          this.applyTheme('system');
        }
      };
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handler);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handler);
      }
    }

    getThemeColors() {
      const root = document.documentElement;
      const computedStyle = getComputedStyle(root);
      return {
        bgPrimary: computedStyle.getPropertyValue('--bg-primary').trim(),
        bgSecondary: computedStyle.getPropertyValue('--bg-secondary').trim(),
        textPrimary: computedStyle.getPropertyValue('--text-primary').trim(),
        textSecondary: computedStyle.getPropertyValue('--text-secondary').trim(),
        accentPrimary: computedStyle.getPropertyValue('--accent-primary').trim(),
        borderPrimary: computedStyle.getPropertyValue('--border-primary').trim()
      };
    }

    isDarkTheme() {
      const effectiveTheme = this.getEffectiveTheme();
      return effectiveTheme === 'dark' || effectiveTheme === 'retro';
    }

    getContrastColor(backgroundColor) {
      const rgb = backgroundColor.match(/\d+/g);
      if (!rgb) {
        return this.isDarkTheme() ? '#ffffff' : '#000000';
      }
      const brightness = (parseInt(rgb[0], 10) * 299 + parseInt(rgb[1], 10) * 587 + parseInt(rgb[2], 10) * 114) / 1000;
      return brightness > 128 ? '#000000' : '#ffffff';
    }
  }

  window.themeManager = new ThemeManager();

  const pageInitializers = {
    dashboard: initDashboard,
    wizard: initWizard,
    login: initLogin,
    setup: initSetup
  };

  const DASHBOARD_TEMPLATE_URL = '/templates/dashboard-shell.html';
  const DASHBOARD_ROUTES = {
    overview: {
      viewKey: 'overview',
      elementId: 'view-overview',
      href: '/',
      paths: ['/', '/index.html', '/overview.html']
    },
    map: {
      viewKey: 'overview-map',
      elementId: 'view-overview-map',
      href: '/map.html',
      paths: ['/map.html']
    },
    logs: {
      viewKey: 'logs',
      elementId: 'view-logs',
      href: '/logs.html',
      paths: ['/logs.html']
    },
    devices: {
      viewKey: 'devices',
      elementId: 'view-devices',
      href: '/devices.html',
      paths: ['/devices.html']
    },
    keys: {
      viewKey: 'keys',
      elementId: 'view-keys',
      href: '/keys.html',
      paths: ['/keys.html']
    },
    settings: {
      viewKey: 'settings',
      elementId: 'view-settings',
      href: '/settings.html',
      paths: ['/settings.html']
    },
    insights: {
      viewKey: 'insights',
      elementId: 'view-insights',
      href: '/insights.html',
      paths: ['/insights.html']
    }
  };

  let dashboardTemplateCache = null;

  async function applyDashboardTemplateIfNeeded() {
    if (document.body.dataset.templateApplied === 'true') {
      return;
    }
    const contentContainer = document.querySelector('[data-page-content]');
    if (!contentContainer) {
      document.body.dataset.templateApplied = 'true';
      return;
    }
    const pageContent = contentContainer.innerHTML;
    contentContainer.remove();

    if (!dashboardTemplateCache) {
      const response = await fetch(DASHBOARD_TEMPLATE_URL, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`Failed to load dashboard template (${response.status})`);
      }
      dashboardTemplateCache = await response.text();
    }

    const templateMarkup = dashboardTemplateCache.includes('{{PAGE_CONTENT}}') ?
      dashboardTemplateCache.replace('{{PAGE_CONTENT}}', pageContent) :
      `${dashboardTemplateCache}\n${pageContent}`;

    const templateEl = document.createElement('template');
    templateEl.innerHTML = templateMarkup;
    const fragment = templateEl.content;
    const scriptEl = document.querySelector('script[src="/js/pulseops.js"]');
    if (scriptEl && scriptEl.parentElement === document.body) {
      document.body.insertBefore(fragment, scriptEl);
    } else {
      document.body.appendChild(fragment);
    }
    document.body.dataset.templateApplied = 'true';
  }

  function resolveActiveRoute() {
    const explicit = document.body?.dataset?.route;
    if (explicit && Object.prototype.hasOwnProperty.call(DASHBOARD_ROUTES, explicit)) {
      return explicit;
    }
    const path = window.location.pathname || '/';
    for (const [routeKey, config] of Object.entries(DASHBOARD_ROUTES)) {
      if (config.paths && config.paths.includes(path)) {
        return routeKey;
      }
    }
    return 'overview';
  }

  function getRouteByViewId(viewId) {
    return Object.entries(DASHBOARD_ROUTES).find(([, config]) => config.viewKey === viewId);
  }

  function buildRouteUrl(routeKey, params = {}) {
    const config = DASHBOARD_ROUTES[routeKey];
    if (!config || !config.href) {
      return '/';
    }
    try {
      const url = new URL(config.href, window.location.origin);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, value);
        }
      });
      const search = url.search ? url.search : '';
      const hash = params.hash ? `#${params.hash}` : '';
      return `${url.pathname}${search}${hash}`;
    } catch (error) {
      console.warn('Failed to construct route URL, falling back to raw path.', error);
      return config.href;
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body?.dataset?.page;
    if (page === 'dashboard') {
      try {
        await applyDashboardTemplateIfNeeded();
      } catch (error) {
        console.error('Failed to prepare dashboard template:', error);
      }
    }
    const initializer = pageInitializers[page];
    if (typeof initializer === 'function') {
      initializer();
    }
  });

  function initDashboard() {
        // --- TEMP INSIGHTS DEBUGGING ---
        const __dbgParams = new URLSearchParams(window.location.search);
        const __insightsDebug = (__dbgParams.get('debugInsights') === '1') || (localStorage.getItem('pulseops-debug-insights') === '1');
        function ilog(...args) { if (__insightsDebug) { console.log('[Insights]', ...args); } }
        function iwarn(...args) { if (__insightsDebug) { console.warn('[Insights]', ...args); } }
        function ierr(...args) { if (__insightsDebug) { console.error('[Insights]', ...args); } }
        window.PULSEOPS_INSIGHTS_DEBUG = {
          enable() { localStorage.setItem('pulseops-debug-insights', '1'); },
          disable() { localStorage.removeItem('pulseops-debug-insights'); },
          state: () => ({ route: document.body?.dataset?.route, url: window.location.href })
        };
        window.addEventListener('error', (e) => { ierr('window error', e?.message, e?.error); });
        window.addEventListener('unhandledrejection', (e) => { ierr('unhandled rejection', e?.reason); });
        // --- END TEMP INSIGHTS DEBUGGING ---
        async function json(url, opts = {}) { const r = await fetch(url, opts); if (!r.ok) { throw new Error(await r.text()) }; return r.json(); }
        function escapeHTML(value) {
          return String(value ?? '').replace(/[&<>"']/g, (match) => {
            switch (match) {
              case '&': return '&amp;';
              case '<': return '&lt;';
              case '>': return '&gt;';
              case '"': return '&quot;';
              case "'": return '&#39;';
              default: return match;
            }
          });
        }

        // Authentication state
        let authState = { setup_completed: false, authenticated: false, user: null };
        const userMenuTrigger = document.getElementById('user-menu-trigger');
        const userMenu = document.getElementById('user-menu');
        const usernameDisplay = document.getElementById('username-display');
        const logoutBtn = document.getElementById('logout-btn');

        // Check authentication status
        async function checkAuthStatus() {
          try {
            const response = await fetch('/api/auth/status');
            authState = await response.json();

            if (!authState.setup_completed) {
              window.location.href = '/setup.html';
              return;
            }

            if (!authState.authenticated) {
              window.location.href = '/login.html';
              return;
            }

            // Update UI with user info
            if (authState.user) {
              usernameDisplay.textContent = authState.user.username;
            }
          } catch (error) {
            console.error('Failed to check auth status:', error);
            window.location.href = '/login.html';
          }
        }

        // Handle logout
        async function handleLogout() {
          try {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/login.html';
          } catch (error) {
            console.error('Logout failed:', error);
            window.location.href = '/login.html';
          }
        }

        // User menu toggle
        function toggleUserMenu() {
          userMenu.classList.toggle('hidden');
        }

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
          if (!userMenuTrigger.contains(e.target) && !userMenu.contains(e.target)) {
            userMenu.classList.add('hidden');
          }
        });

        // Event listeners
        if (userMenuTrigger) userMenuTrigger.addEventListener('click', toggleUserMenu);
        if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
        function formatTimestamp(value) {
          if (!value) { return '—'; }
          let date = new Date(value);
          if (Number.isNaN(date.getTime())) {
            const isoCandidate = String(value).replace(' ', 'T') + 'Z';
            date = new Date(isoCandidate);
          }
          if (Number.isNaN(date.getTime())) { return String(value); }
          return date.toLocaleString();
        }
        function formatFileSize(bytes) {
          const value = Number(bytes);
          if (!Number.isFinite(value) || value < 0) { return '—'; }
          if (value < 1024) { return `${Math.round(value)} B`; }
          const units = ['KB', 'MB', 'GB', 'TB'];
          let current = value;
          let unitIndex = 0;
          while (current >= 1024 && unitIndex < units.length - 1) {
            current /= 1024;
            unitIndex += 1;
          }
          const digits = current >= 10 ? 0 : 1;
          return `${current.toFixed(digits)} ${units[unitIndex]}`;
        }
        function formatDuration(seconds) {
          const total = Number(seconds);
          if (!Number.isFinite(total) || total <= 0) { return '0s'; }
          let remaining = Math.floor(total);
          const days = Math.floor(remaining / 86400);
          remaining -= days * 86400;
          const hours = Math.floor(remaining / 3600);
          remaining -= hours * 3600;
          const minutes = Math.floor(remaining / 60);
          remaining -= minutes * 60;
          const parts = [];
          if (days) { parts.push(`${days}d`); }
          if (hours) { parts.push(`${hours}h`); }
          if (minutes) { parts.push(`${minutes}m`); }
          if (parts.length === 0) {
            parts.push(`${remaining}s`);
          }
          return parts.join(' ');
        }
        function truncateText(value, max) {
          const str = String(value ?? '');
          if (str.length <= max) { return str; }
          return str.slice(0, Math.max(0, max - 1)) + '…';
        }
        function formatLogTime(value) {
          if (!value) { return '--'; }
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) { return '--'; }
          const now = new Date();
          const diff = now - date;
          const opts = { hour: '2-digit', minute: '2-digit' };
          if (diff < 3600_000) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }
          if (diff < 24 * 3600_000) {
            return date.toLocaleTimeString([], opts);
          }
          return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString([], opts);
        }
        function el(tag, attrs = {}, ...kids) {
          const e = document.createElement(tag);
          for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') {
              e.className = v;
            } else if (k.startsWith('on') && typeof v === 'function') {
              e.addEventListener(k.slice(2).toLowerCase(), v);
            } else {
              e.setAttribute(k, v);
            }
          }
          kids.flat().forEach(k => {
            if (typeof k === 'string') e.appendChild(document.createTextNode(k));
            else if (k) e.appendChild(k);
          });
          return e;
        }

        function normalizeDeviceContext(context) {
          const key = (context || 'grid').toString().trim();
          return key && key !== 'grid' ? key : 'grid';
        }

        function deviceContextKey(deviceId, context) {
          return `${normalizeDeviceContext(context)}:${deviceId}`;
        }

        function deviceContextId(deviceId, context, ...parts) {
          const ctx = normalizeDeviceContext(context);
          const segments = [...parts.filter(Boolean)];
          if (ctx !== 'grid') {
            segments.push(ctx);
          }
          segments.push(deviceId);
          return segments.join('-');
        }

        function clearContextEntries(map, context) {
          const ctx = normalizeDeviceContext(context);
          const prefix = `${ctx}:`;
          for (const key of Array.from(map.keys())) {
            if (key.startsWith(prefix)) {
              map.delete(key);
            }
          }
        }

        function clearContextSet(set, context) {
          const ctx = normalizeDeviceContext(context);
          const prefix = `${ctx}:`;
          for (const value of Array.from(set.values())) {
            if (typeof value === 'string' && value.startsWith(prefix)) {
              set.delete(value);
            }
          }
        }

        const countdownIntervals = new Map();
        const hardwareCache = new Map();
        let devices = [];
        let filteredDevices = [];
        let networkMapActiveDevices = [];
        let networkMapResizeTimer = null;
        let deviceStatusCache = new Map();
        let latestInterval;
        let openMenuState = null;
        let deviceHiddenMetricsVisible = new Map(); // deviceId -> boolean
        let metricVisibilityState = new Map(); // deviceId -> Set of hidden metric keys
        let deviceHardwareVisible = new Map(); // deviceId -> {interfaces: boolean, section: boolean}
        let hardwareAvailabilityState = new Map(); // deviceId -> {hasInterfaces: boolean, hasHardwareInfo: boolean}
        const confirmOverlay = document.getElementById('confirm-modal');
        const confirmTitleEl = document.getElementById('confirm-modal-title');
        const confirmMessageEl = document.getElementById('confirm-modal-message');
        const confirmCancelBtn = document.getElementById('confirm-modal-cancel');
        const confirmConfirmBtn = document.getElementById('confirm-modal-confirm');
        const confirmExtraContainer = document.getElementById('confirm-modal-extra');
        const backupModal = document.getElementById('backup-modal');
        const backupModalTitle = document.getElementById('backup-modal-title');
        const backupModalStatus = document.getElementById('backup-modal-status');
        const backupModalList = document.getElementById('backup-modal-list');
        const backupModalClose = document.getElementById('backup-modal-close');
        const confirmState = { onConfirm: null, extraButtons: [] };
        const toastContainer = document.getElementById('toast-container');
        const EDIT_STEPS = { CONFIG: 1, VALIDATION: 2 };
        const SSH_KEY_REFERENCE_PREFIX = 'sshkey:';
        const SSH_KEY_PATH_OPTION = '__path__';
        let templatesCache = null;
        let sshKeysCache = [];
        let sshKeysLoadErrorNotified = false;
        const editState = {
          open: false,
          step: EDIT_STEPS.CONFIG,
          deviceId: null,
          template: null,
          deviceConfig: { meta: {} },
          validation: null,
          isValidating: false,
          isSaving: false
        };
        const editOverlay = document.getElementById('edit-device-overlay');
        const editForm = document.getElementById('edit-device-form');
        const editLoadingState = document.getElementById('edit-loading-state');
        const editContent = document.getElementById('edit-content');
        const editValidationLoading = document.getElementById('edit-validation-loading');
        const editValidationResults = document.getElementById('edit-validation-results');
        const editSummary = document.getElementById('edit-summary');
        const editBackBtn = document.getElementById('edit-back-btn');
        const editValidateBtn = document.getElementById('edit-validate-btn');
        const editSaveBtn = document.getElementById('edit-save-btn');
        const editCloseBtn = document.getElementById('edit-close-btn');
        const editTitle = document.getElementById('edit-device-title');
        const editSubtitle = document.getElementById('edit-device-subtitle');
        const editSSHModal = document.getElementById('edit-ssh-key-modal');
        const editSSHList = document.getElementById('edit-ssh-key-list');
        const editSSHViewer = document.getElementById('edit-ssh-key-viewer');
        const editSSHCloseBtn = document.getElementById('edit-ssh-key-close');
        const editSaveSSHKeyBtn = document.getElementById('edit-save-ssh-key-btn');
        const editNewSSHKeyName = document.getElementById('edit-new-ssh-key-name');
        const editNewSSHKeyContent = document.getElementById('edit-new-ssh-key-content');
        if (editSSHList) {
          editSSHList.addEventListener('click', (event) => {
            const actionBtn = event.target.closest('button[data-action]');
            if (!actionBtn) { return; }
            const action = actionBtn.dataset.action;
            const keyContainer = actionBtn.closest('[data-key-id]');
            const keyId = keyContainer?.dataset?.keyId;
            if (!keyId) { return; }
            if (action === 'view') {
              event.preventDefault();
              viewEditSSHKey(keyId);
            } else if (action === 'use') {
              event.preventDefault();
              selectEditSSHKeyFromManager(keyId);
            } else if (action === 'delete') {
              event.preventDefault();
              deleteEditSSHKey(keyId);
            }
          });
        }
        const deviceTasks = new Map();
        const taskRefreshTimers = new Map();
        const expandedTaskPanels = new Set();
        const logExpansionState = new Map();
        const TASK_PREVIEW_LIMIT = 1;
        const TASK_EXPANDED_LIMIT = 15;
        const TASK_LABELS = {
          reboot: 'Reboot',
          refresh_firewall: 'Refresh firewall',
          refresh_wireless: 'Refresh wireless'
        };
        const METRIC_SERIES = [
          { key: 'ping_ms', label: 'Ping', unit: 'ms', color: '#2563eb' },
          { key: 'iperf_mbps', label: 'Bandwidth', unit: 'Mbps', color: '#1d7a46' },
          { key: 'cpu_usage_percent', label: 'CPU Usage', unit: '%', color: '#b91c1c' },
          { key: 'cpu_load_1m', label: 'CPU Load (1m)', unit: '', color: '#0ea5e9' },
          { key: 'memory_used_percent', label: 'Memory Used', unit: '%', color: '#7c3aed' },
          { key: 'disk_used_percent', label: 'Disk Used', unit: '%', color: '#f97316' }
        ];
        const SUMMARY_METRICS = [
          {
            key: 'ping_ms',
            label: 'Ping (24h avg)',
            aggregation: 'avg',
            lookbackHours: 24,
            formatter: (value) => value != null ? `${value.toFixed(1)} ms` : 'n/a'
          },
          {
            key: 'iperf_mbps',
            label: 'Bandwidth (24h avg)',
            aggregation: 'avg',
            lookbackHours: 24,
            formatter: (value) => value != null ? `${value.toFixed(1)} Mbps` : 'n/a'
          },
          {
            key: 'cpu_usage_percent',
            label: 'CPU Usage',
            aggregation: 'latest',
            formatter: (value) => value != null ? `${value.toFixed(1)}%` : 'n/a'
          },
          {
            key: 'cpu_load_1m',
            label: 'CPU Load (1m)',
            aggregation: 'latest',
            formatter: (value) => value != null ? value.toFixed(2) : 'n/a'
          },
          {
            key: 'memory_used_percent',
            label: 'Memory Used',
            aggregation: 'latest',
            formatter: (value) => value != null ? `${value.toFixed(1)}%` : 'n/a'
          },
          {
            key: 'disk_used_percent',
            label: 'Disk Used',
            aggregation: 'latest',
            formatter: (value) => value != null ? `${value.toFixed(1)}%` : 'n/a'
          },
          {
            key: 'uptime_seconds',
            label: 'Uptime',
            aggregation: 'latest',
            formatter: (value) => value != null ? formatDuration(value) : 'n/a'
          }
        ];
        const CLASSIFICATION_LABELS = {
          lan: 'LAN',
          local_vlan: 'Local VLAN',
          remote: 'Remote',
          unknown: 'Unknown'
        };
        const CLASSIFICATION_REASON_TEXT = {
          matched_local: 'Same subnet as controller',
          private_nonlocal: 'Private network reachability',
          public_network: 'Public network reachability',
          non_ipv4_address: 'Non-IPv4 address',
          unparseable_host: 'Unparseable host',
          empty_host: 'No host configured',
          unspecified: ''
        };
        const DEVICE_KIND_ALIASES = {
          ap: 'access_point',
          accesspoint: 'access_point',
          wifi: 'access_point',
          wireless: 'access_point',
          wap: 'access_point',
          routerboard: 'router',
          firewall_appliance: 'firewall',
          utm: 'firewall',
          switchgear: 'switch',
          edge_switch: 'switch'
        };
        const DEVICE_KIND_META = {
          router: { icon: '🛣️', className: 'badge-router', label: 'Router' },
          switch: { icon: '🔀', className: 'badge-switch', label: 'Switch' },
          access_point: { icon: '📡', className: 'badge-ap', label: 'Access Point' },
          firewall: { icon: '🛡️', className: 'badge-firewall', label: 'Firewall' },
          server: { icon: '🖥️', className: 'badge-server', label: 'Server' },
          gateway: { icon: '🚪', className: 'badge-gateway', label: 'Gateway' },
          modem: { icon: '📶', className: 'badge-modem', label: 'Modem' },
          default: { icon: '⚙️', className: 'badge-default', label: 'Device' }
        };
        const DEVICE_TASKS = {
          router: ['reboot', 'refresh_firewall'],
          firewall: ['reboot', 'refresh_firewall'],
          gateway: ['reboot', 'refresh_firewall'],
          access_point: ['reboot', 'refresh_wireless'],
          switch: ['reboot'],
          server: ['reboot'],
          modem: ['reboot'],
          openwrt: ['reboot', 'refresh_firewall', 'refresh_wireless'],
          edgeos: ['reboot', 'refresh_firewall'],
          huawei: ['reboot'],
          default: ['reboot']
        };
        const overviewEmptyState = document.getElementById('overview-empty');
        const viewSections = {
          overview: document.getElementById('view-overview'),
          'overview-map': document.getElementById('view-overview-map'),
          logs: document.getElementById('view-logs'),
          devices: document.getElementById('view-devices'),
          keys: document.getElementById('view-keys'),
          settings: document.getElementById('view-settings'),
          insights: document.getElementById('view-insights')
        };
        const navTabs = Array.from(document.querySelectorAll('.nav-tab'));
        const activeRoute = resolveActiveRoute();
        ilog('initDashboard', { activeRoute, path: window.location.pathname, search: window.location.search });
        if (document.body) {
          document.body.dataset.route = activeRoute;
        }
        const activeRouteConfig = DASHBOARD_ROUTES[activeRoute] || DASHBOARD_ROUTES.overview;
        const initialViewKey = activeRouteConfig?.viewKey || 'overview';
        // Route guard utility for Insights
        const onInsightsRoute = activeRoute === 'insights' || initialViewKey === 'insights';
        const networkMapPanel = document.getElementById('network-map-panel');
        const networkMapEl = document.getElementById('network-map');
        const networkMapNodes = document.getElementById('network-map-nodes');
        const networkMapLinks = document.getElementById('network-map-links');
        const networkMapEmpty = document.getElementById('network-map-empty');
        const viewState = { current: initialViewKey };

        const logsForm = document.getElementById('logs-filter-form');
        const logsResults = document.getElementById('logs-results');
        const logsStatus = document.getElementById('logs-status');
        const logsSourceSelect = document.getElementById('logs-source');
        const logsDeviceKindSelect = document.getElementById('logs-device-kind');
        const logsDeviceSelect = document.getElementById('logs-device-id');
        const logsLevelSelect = document.getElementById('logs-level');
        const logsIPInput = document.getElementById('logs-ip-range');
        const logsSearchInput = document.getElementById('logs-search');
        const logsResetBtn = document.getElementById('logs-reset');

        // Device filtering controls
        const deviceTypeFilter = document.getElementById('device-type-filter');
        const deviceStatusFilter = document.getElementById('device-status-filter');
        const deviceSearchFilter = document.getElementById('device-search-filter');
        const deviceFiltersReset = document.getElementById('device-filters-reset');

        const deviceTableBody = document.getElementById('device-table-body');
        const deviceTableMaster = document.getElementById('device-table-master');
        const deviceSelectAllBtn = document.getElementById('device-select-all');
        const deviceExportSelectedBtn = document.getElementById('device-export-selected');
        const deviceExportAllBtn = document.getElementById('device-export-all');
        const deviceImportBtn = document.getElementById('device-import-btn');
        const deviceImportInput = document.getElementById('device-import-input');
        const BACKUP_SUPPORTED_PLATFORMS = new Set(['openwrt', 'edgeos']);
        const deviceSelection = new Set();

        const settingsForm = document.getElementById('settings-form');
        const settingsThemeSelect = document.getElementById('settings-theme');
        const settingsAccountNameInput = document.getElementById('settings-account-name');
        const settingsAccountEmailInput = document.getElementById('settings-account-email');
        const settingsEmailEnabled = document.getElementById('settings-email-enabled');
        const settingsEmailHost = document.getElementById('settings-email-host');
        const settingsEmailPort = document.getElementById('settings-email-port');
        const settingsEmailUsername = document.getElementById('settings-email-username');
        const settingsEmailPassword = document.getElementById('settings-email-password');
        const settingsEmailClear = document.getElementById('settings-email-clear');
        const settingsEmailPasswordNote = document.getElementById('settings-email-password-note');
        const settingsWebEnabled = document.getElementById('settings-web-enabled');
        const settingsStatus = document.getElementById('settings-status');

        const insightsSelect = document.getElementById('insights-device-select');
        const insightsRefreshBtn = document.getElementById('insights-refresh');
        const insightsEmpty = document.getElementById('insights-empty');
        const insightsContent = document.getElementById('insights-content');
        const insightsDeviceContainer = document.getElementById('insights-device-container');
        const insightsMeta = document.getElementById('insights-meta');
        const insightsChartCanvas = document.getElementById('insights-chart-canvas');
        const insightsLogsContainer = document.getElementById('insights-logs');
        // Ensure insights state exists before using URL params
        const insightsState = {
          deviceId: null,
          data: null,
          chart: null,
          logs: null,
          isLoading: false,
          suppressSelectEvents: false
        };
        // Patch fetch for noisy /api/device-logs calls that accidentally pass objects instead of IDs
        (function patchDeviceLogsFetch() {
          if (!window.__pulseopsFetchPatched) {
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
                    // Try to parse JSON first
                    try {
                      const parsed = JSON.parse(raw);
                      if (Array.isArray(parsed)) {
                        const ids = parsed
                          .map((v) => (typeof v === 'object' && v !== null ? (v.id ?? v.device_id ?? v.value ?? null) : v))
                          .filter((v) => v != null)
                          .map((v) => String(v).match(/\d+/g))
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
                      // Fallback: scrape all numbers out of the string
                      const nums = String(raw).match(/\d+/g);
                      if (nums && nums.length) { toValue = [...new Set(nums)].join(','); }
                    }
                    if (!toValue) {
                      // Last resort: use currently selected insights device
                      toValue = insightsState && insightsState.deviceId ? String(insightsState.deviceId) : '';
                    }
                    u.searchParams.set('device_id', toValue);
                    console.warn('[Insights] fetch patch: sanitised device_id for /api/device-logs', { from: raw, to: toValue });
                    input = u.toString();
                  }
                }
              } catch (_) { /* ignore parse issues */ }
              return __origFetch(input, init);
            };
            window.__pulseopsFetchPatched = true;
          }
        })();
        const insightsUrlParams = new URLSearchParams(window.location.search);
        const requestedInsightsDevice = insightsUrlParams.get('deviceId');
        ilog('URL param deviceId =', requestedInsightsDevice);
        if (requestedInsightsDevice) {
          const numericId = Number(requestedInsightsDevice);
          if (Number.isFinite(numericId)) {
            insightsState.deviceId = numericId;
            ilog('Parsed numeric deviceId →', insightsState.deviceId);
          }
        }
        // If we are on Insights and have a deviceId in the URL, ensure the view is visible immediately
        if (onInsightsRoute && insightsState.deviceId) {
          const section = document.getElementById('view-insights');
          section && section.classList.remove('hidden');
          insightsEmpty && insightsEmpty.classList.add('hidden');
          insightsContent && insightsContent.classList.remove('hidden');
        }

        // Ensure the device dropdown is populated; fall back to API if needed
        async function ensureInsightsDeviceOptions() {
          ilog('ensureInsightsDeviceOptions: start');
          if (!insightsSelect) { return; }
          // If options already exist beyond the placeholder, keep them
          const hasRealOptions = insightsSelect.options && insightsSelect.options.length > 1;
          if (hasRealOptions) {
            ilog('ensureInsightsDeviceOptions: existing options detected (count=', insightsSelect.options.length, ')');
            return;
          }
          insightsState.suppressSelectEvents = true; ilog('ensureInsightsDeviceOptions: suppressing select events');
          try {
            const res = await fetch('/api/devices');
            ilog('ensureInsightsDeviceOptions: /api/devices status', res.status);
            if (!res.ok) { throw new Error('devices fetch failed'); }
            const list = await res.json();
            ilog('ensureInsightsDeviceOptions: got list length', Array.isArray(list) ? list.length : 'non-array');
            if (Array.isArray(list)) {
              // Clear existing options and repopulate
              insightsSelect.innerHTML = '';
              const placeholder = document.createElement('option');
              placeholder.value = '';
              placeholder.textContent = 'Select a device…';
              insightsSelect.appendChild(placeholder);
              list.forEach(d => {
                const opt = document.createElement('option');
                // Support both id and device_id fields just in case
                const id = d.id != null ? d.id : d.device_id;
                opt.value = String(id);
                const name = d.name || d.hostname || `Device #${id}`;
                const ip = d.ip || d.address || '';
                opt.textContent = ip ? `${name} (${ip})` : name;
                insightsSelect.appendChild(opt);
              });
            }
          } catch (e) {
            ierr('ensureInsightsDeviceOptions failed', e);
            console.debug('Could not auto-populate insights devices:', e);
          }
          insightsState.suppressSelectEvents = false; ilog('ensureInsightsDeviceOptions: re-enabled select events');
        }

        // Hard-initialise Insights view from URL param without relying on timing of option population
        async function initInsightsFromURLParam() {
          ilog('initInsightsFromURLParam: start with', insightsState.deviceId);
          if (!insightsState.deviceId) { return; }
          const desiredId = insightsState.deviceId; ilog('initInsightsFromURLParam: desiredId snapshot', desiredId);
          await ensureInsightsDeviceOptions();
          const target = String(desiredId);
          // If the option still does not exist (API may not list it), create a temporary option so UI reflects selection
          const exists = Array.from(insightsSelect.options || []).some(o => o.value === target);
          if (!exists && insightsSelect) {
            const opt = document.createElement('option');
            opt.value = target;
            opt.textContent = `Device #${target}`;
            insightsSelect.appendChild(opt);
          }
          if (insightsSelect) {
            insightsSelect.value = target;
            ilog('initInsightsFromURLParam: set select value to', target);
          }
          // Load immediately instead of waiting for change handlers
          insightsState.deviceId = desiredId;
          ilog('initInsightsFromURLParam: calling loadInsightsForDevice(', desiredId, ')');
          loadInsightsForDevice(desiredId);
        }

        // If a deviceId is provided via URL, auto-select it once the picker is populated
        function autoSelectInsightsDeviceFromURL() {
          ilog('autoSelectInsightsDeviceFromURL: start');
          if (!insightsSelect || !insightsState.deviceId) { return; }
          const targetValue = String(insightsState.deviceId);
          const trySelect = () => {
            if (insightsState.suppressSelectEvents) { ilog('autoSelectInsightsDeviceFromURL: events suppressed'); return false; }
            const hasOption = Array.from(insightsSelect.options).some(o => o.value === targetValue);
            if (!hasOption) { return false; }
            insightsSelect.value = targetValue;
            // Trigger existing change handler to load UI/data
            ilog('autoSelectInsightsDeviceFromURL: matched option, dispatching change');
            insightsSelect.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          };
          // Try now in case options are already present
          if (trySelect()) { return; }
          // Observe for options being added, then select once available
          const observer = new MutationObserver(() => {
            if (trySelect()) { observer.disconnect(); }
          });
          observer.observe(insightsSelect, { childList: true });
          // Safety: stop observing after 10s to avoid leaks
          setTimeout(() => observer.disconnect(), 10000);
        }

        // Kick off URL initialisation robustly (populate options if needed, then load)
        if (insightsState.deviceId) {
          initInsightsFromURLParam();
        }

        // ---- Insights view helpers & wiring ----
        function showInsightsView() {
          ilog('showInsightsView');
          try {
            if (viewSections && viewSections.insights) {
              Object.values(viewSections).forEach(v => v && v.classList && v.classList.add('hidden'));
              viewSections.insights.classList.remove('hidden');
            } else {
              // Fallback: ensure the section itself is visible
              const section = document.getElementById('view-insights');
              section && section.classList.remove('hidden');
            }
          } catch (e) { /* ignore */ }
        }

        function updateInsightsRoute(deviceId) {
          ilog('updateInsightsRoute →', deviceId);
          try {
            const url = new URL(window.location.href);
            if (deviceId) {
              url.searchParams.set('deviceId', String(deviceId));
            } else {
              url.searchParams.delete('deviceId');
            }
            // Keep user on insights route
            const routeUrl = buildRouteUrl('insights', Object.fromEntries(url.searchParams));
            window.history.replaceState({}, '', routeUrl);
          } catch (err) {
            // graceful no-op
          }
        }

        function renderInsightsMeta(meta) {
          if (!insightsMeta) { return; }
          const parts = [];
          if (meta?.name) parts.push(`<strong>${escapeHTML(meta.name)}</strong>`);
          if (meta?.kind) parts.push(`<span class="badge">${escapeHTML(meta.kind)}</span>`);
          if (meta?.ip) parts.push(`<span class="muted">${escapeHTML(meta.ip)}</span>`);
          if (meta?.lastSeen) parts.push(`<span class="muted">Last seen: ${escapeHTML(formatTimestamp(meta.lastSeen))}</span>`);
          insightsMeta.innerHTML = parts.join(' · ') || '<span class="muted">No device metadata</span>';
        }

        function renderInsightsLogs(logs) {
          if (!insightsLogsContainer) { return; }
          insightsLogsContainer.innerHTML = '';
          const list = Array.isArray(logs) ? logs : [];
          if (!list.length) {
            insightsLogsContainer.appendChild(el('div', { class: 'muted' }, 'No recent activity.'));
            return;
          }
          const frag = document.createDocumentFragment();
          list.forEach(item => {
            const row = el('div', { class: 'log-row' },
              el('span', { class: 'log-time' }, formatLogTime(item.timestamp)),
              el('span', { class: 'log-level' }, (item.level || 'info').toUpperCase()),
              el('span', { class: 'log-msg' }, truncateText(item.message || '', 160))
            );
            frag.appendChild(row);
          });
          insightsLogsContainer.appendChild(frag);
        }

        function buildInsightsChart(points) {
          if (!insightsChartCanvas) { return null; }
          const ctx = insightsChartCanvas.getContext && insightsChartCanvas.getContext('2d');
          if (!ctx || typeof Chart === 'undefined') { return null; }
          // Tear down any existing chart
          if (insightsState.chart && typeof insightsState.chart.destroy === 'function') {
            try { insightsState.chart.destroy(); } catch (_) {}
          }
          const data = Array.isArray(points) ? points : [];
          const chart = new Chart(ctx, {
            type: 'line',
            data: {
              datasets: [
                {
                  label: 'Ping (ms)',
                  parsing: false,
                  data: data.map(p => ({ x: new Date(p.timestamp), y: p.ping_ms })),
                  tension: 0.2,
                  pointRadius: 0
                },
                {
                  label: 'Bandwidth (Mbps)',
                  parsing: false,
                  data: data.map(p => ({ x: new Date(p.timestamp), y: p.iperf_mbps })),
                  yAxisID: 'y1',
                  tension: 0.2,
                  pointRadius: 0
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { type: 'time', time: { unit: 'hour' } },
                y: { type: 'linear', position: 'left' },
                y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } }
              },
              plugins: { legend: { display: true } }
            }
          });
          return chart;
        }

        // Helper: probe endpoints and return first OK JSON + which URL matched
        async function fetchFirstOkJson(candidates, label) {
          for (const url of candidates) {
            try {
              const res = await fetch(url);
              if (res.ok) {
                ilog('fetchFirstOkJson matched', label, url, res.status);
                const data = await res.json();
                return { url, data };
              } else {
                ilog('fetchFirstOkJson miss', label, url, res.status);
              }
            } catch (e) {
              ilog('fetchFirstOkJson error', label, url, e?.message || e);
            }
          }
          return { url: null, data: null };
        }

        async function loadInsightsForDevice(deviceId) {
          ilog('loadInsightsForDevice: start', { deviceId });
          if (!deviceId) { return; }
          // Force the view visible regardless of backend responses
          try {
            const section = document.getElementById('view-insights');
            section && section.classList.remove('hidden');
          } catch (_) {}
          showInsightsView();
          insightsState.deviceId = Number(deviceId);
          updateInsightsRoute(insightsState.deviceId);
          if (insightsRefreshBtn) insightsRefreshBtn.disabled = true;
          insightsEmpty && insightsEmpty.classList.add('hidden');
          insightsContent && insightsContent.classList.remove('hidden');
          let meta = null, series = [], logs = [];
          try {
            const id = encodeURIComponent(deviceId);
            const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
            // Probe multiple backend shapes
            const metaCandidates = [
              `/api/devices/${id}`,
              `/api/device/${id}`,
              `/api/device?id=${id}`
            ];
            const seriesCandidates = [
              `/api/metrics?device_id=${id}&metric=all&since=${encodeURIComponent(since24h)}`,
              `/api/metrics?deviceId=${id}&metric=all&since=${encodeURIComponent(since24h)}`,
              `/api/device-metrics?device_id=${id}&hours=24`,
              `/api/devices/${id}/metrics?hours=24`
            ];
            const logsCandidates = [
              `/api/device-logs?device_id=${id}&limit=50`,
              `/api/logs?device_id=${id}&limit=50`,
              `/api/logs?deviceId=${id}&limit=50`,
              `/api/devices/${id}/logs?limit=50`
            ];

            const [metaHit, seriesHit, logsHit] = await Promise.all([
              fetchFirstOkJson(metaCandidates, 'meta'),
              fetchFirstOkJson(seriesCandidates, 'series'),
              fetchFirstOkJson(logsCandidates, 'logs')
            ]);

            meta = metaHit.data;
            series = Array.isArray(seriesHit.data) ? seriesHit.data : [];
            logs = Array.isArray(logsHit.data) ? logsHit.data : [];

            ilog('loadInsightsForDevice: chosen endpoints', { meta: metaHit.url, series: seriesHit.url, logs: logsHit.url });
            ilog('loadInsightsForDevice: meta?', !!meta, 'series length', Array.isArray(series) ? series.length : 'n/a', 'logs length', Array.isArray(logs) ? logs.length : 'n/a');
          } catch (err) {
            ierr('loadInsightsForDevice error', err);
          }

          // Render meta
          renderInsightsMeta(meta || { name: `Device #${deviceId}` });
          ilog('rendered meta');

          // Render chart
          try {
            insightsState.chart = buildInsightsChart(series);
            ilog('chart built?', !!insightsState.chart);
          } catch (err) {
            console.warn('Chart render failed', err);
          }

          // Render logs
          try { renderInsightsLogs(logs); ilog('rendered logs'); } catch (_) {}

          if (insightsRefreshBtn) insightsRefreshBtn.disabled = false;
        }

        // Bind select + refresh for insights
        if (insightsSelect) {
          insightsSelect.addEventListener('change', (event) => {
            if (insightsState.suppressSelectEvents) { ilog('insightsSelect change ignored due to suppression'); return; }
            const value = String(event.target.value || '').trim();
            const id = value ? Number(value) : null;
            if (!id || !Number.isFinite(id)) {
              insightsState.deviceId = null;
              updateInsightsRoute(null);
              insightsContent && insightsContent.classList.add('hidden');
              insightsEmpty && insightsEmpty.classList.remove('hidden');
              return;
            }
            loadInsightsForDevice(id);
          });
        }
        if (insightsRefreshBtn) {
          insightsRefreshBtn.addEventListener('click', () => {
            if (insightsState.deviceId) { loadInsightsForDevice(insightsState.deviceId); }
          });
        }

        // Final bootstrap for Insights: if the route is insights and a deviceId param exists, initialise once more
        try {
          const hasDeviceParam = !!(new URLSearchParams(window.location.search).get('deviceId'));
          if (onInsightsRoute && hasDeviceParam && insightsState.deviceId) {
            initInsightsFromURLParam();
          }
        } catch (_) {}

        ilog('initDashboard: insights bootstrap complete');
        // ===== Overview Map state & helpers =====
        // Saved maps UI state will be initialised below.
        const savedMapsElements = {
          layout: document.getElementById('saved-maps-layout'),
          groupsPanel: document.getElementById('map-groups-panel'),
          groupsTree: document.getElementById('map-groups-tree'),
          groupFilter: document.getElementById('map-group-filter'),
          addButton: document.getElementById('map-add-btn'),
          filterInput: document.getElementById('saved-maps-filter'),
          timeRange: document.getElementById('saved-maps-time-range'),
          refreshBtn: document.getElementById('saved-maps-refresh'),
          tableSettingsBtn: document.getElementById('saved-maps-table-settings'),
          tableSettingsMenu: document.getElementById('saved-maps-table-settings-menu'),
          tableHeaderRow: document.getElementById('saved-maps-header-row'),
          tableBody: document.getElementById('saved-maps-table-body'),
          status: document.getElementById('saved-maps-status'),
          landing: document.getElementById('saved-maps-landing'),
          canvasWrapper: document.getElementById('map-canvas-wrapper'),
          toolbarMeta: document.getElementById('map-toolbar-meta'),
          toolbarSave: document.getElementById('map-toolbar-save'),
          toolbarSettings: document.getElementById('map-toolbar-settings'),
          toolbarMore: document.getElementById('map-toolbar-more'),
          toolbarMoreMenu: document.getElementById('map-toolbar-more-menu'),
          canvasStage: document.getElementById('map-canvas-stage'),
          canvasSurface: document.getElementById('map-canvas-surface'),
          canvasInner: document.getElementById('map-canvas-inner'),
          canvasEdges: document.getElementById('map-canvas-edges'),
          canvasNodes: document.getElementById('map-canvas-nodes'),
          canvasEmpty: document.getElementById('map-canvas-empty'),
          inspector: document.getElementById('map-inspector'),
          inspectorContent: document.getElementById('map-inspector-content'),
          inspectorClose: document.getElementById('map-inspector-close'),
          edgeStatusToggle: document.getElementById('map-toggle-edge-status'),
          footerMeta: document.getElementById('map-canvas-footer-meta'),
          connectionDetails: document.getElementById('map-connection-details'),
          connectionDetailsBody: document.getElementById('connection-details-body'),
          connectionDetailsClose: document.getElementById('connection-details-close'),
          edgeTooltip: document.getElementById('map-edge-tooltip'),
          mapSettingsModal: document.getElementById('map-settings-modal'),
          mapSettingsForm: document.getElementById('map-settings-form'),
          mapSettingsName: document.getElementById('map-settings-name'),
          mapSettingsDescription: document.getElementById('map-settings-description'),
          mapSettingsGroup: document.getElementById('map-settings-group'),
          mapSettingsLayout: document.getElementById('map-settings-layout'),
          mapSettingsShowAlerts: document.getElementById('map-settings-show-alerts'),
          mapSettingsAllEdges: document.getElementById('map-settings-all-edges'),
          mapSettingsShowUndiscovered: document.getElementById('map-settings-show-undiscovered'),
          mapSettingsStatus: document.getElementById('map-settings-status'),
          mapSettingsCancel: document.getElementById('map-settings-cancel')
        };

        const CANVAS_SIZE = { width: 1000, height: 700 };
        const MAP_CONTEXT_KEY = 'pulseops.savedMapsContext';

        const SAVED_MAP_COLUMNS = [
          { key: 'group', label: 'Map Group', render: (map) => getGroupName(map.groupId) },
          { key: 'name', label: 'Map Name', render: (map) => map.name },
          { key: 'description', label: 'Description', render: (map) => map.description || '—' },
          { key: 'pinned', label: 'Pinned Nodes', render: (map) => String(map.pinnedNodeCount || 0) },
          { key: 'alerts', label: 'Alerts', render: (map) => createAlertSummary(map.alertCounts) },
          { key: 'author', label: 'Author', render: (map) => map.author || '—' },
          { key: 'updated', label: 'Updated', render: (map) => formatMapUpdated(map.updatedAt) }
        ];
        const SAVED_MAP_COLUMN_MAP = new Map(SAVED_MAP_COLUMNS.map(column => [column.key, column]));
        const DEFAULT_SAVED_MAP_COLUMN_ORDER = SAVED_MAP_COLUMNS.map(column => column.key);

        const SAMPLE_MAP_GROUPS = [
          { id: 'core', name: 'Core Network', parentId: null, children: ['distribution'], mapIds: ['core-backbone', 'core-security'] },
          { id: 'distribution', name: 'Distribution & Access', parentId: 'core', children: ['branch'], mapIds: ['campus-access'] },
          { id: 'branch', name: 'Branch Sites', parentId: 'distribution', children: [], mapIds: ['branch-topology', 'retail-overlay'] },
          { id: 'cloud', name: 'Cloud Edge', parentId: null, children: [], mapIds: ['cloud-services'] }
        ];

        const SAMPLE_SAVED_MAPS = [
          {
            id: 'core-backbone',
            name: 'Core Backbone',
            description: 'Layer-3 backbone across primary data centres.',
            groupId: 'core',
            pinnedNodeCount: 4,
            alertCounts: { critical: 2, warning: 1, info: 5 },
            author: 'M. Ortega',
            updatedAt: '2024-05-14T09:30:00Z',
            timeRange: '24h',
            layout: 'hierarchical',
            toggles: { showAlerts: true, allEdges: false, showUndiscovered: false },
            filters: { origin: 'Resources → Core Routers', applied: ['Region: Primary', 'Service: MPLS'] }
          },
          {
            id: 'core-security',
            name: 'Edge Security Overlay',
            description: 'Firewalls and IDS between the WAN core and DMZ.',
            groupId: 'core',
            pinnedNodeCount: 3,
            alertCounts: { critical: 0, warning: 2, info: 3 },
            author: 'S. Min',
            updatedAt: '2024-05-15T13:12:00Z',
            timeRange: '6h',
            layout: 'radial',
            toggles: { showAlerts: true, allEdges: true, showUndiscovered: false },
            filters: { origin: 'Alerts → Security', applied: ['Severity: Warning', 'Tag: Perimeter'] }
          },
          {
            id: 'campus-access',
            name: 'Campus Access',
            description: 'Switching layers for HQ and lab spaces.',
            groupId: 'distribution',
            pinnedNodeCount: 5,
            alertCounts: { critical: 1, warning: 3, info: 6 },
            author: 'A. Garner',
            updatedAt: '2024-05-12T21:02:00Z',
            timeRange: '24h',
            layout: 'horizontal',
            toggles: { showAlerts: true, allEdges: false, showUndiscovered: true },
            filters: { origin: 'Resources → Saved filter', applied: ['Floor: 1F', 'PoE: Enabled'] }
          },
          {
            id: 'branch-topology',
            name: 'Branch SD-WAN',
            description: 'Overlay of branch routers and tunnels.',
            groupId: 'branch',
            pinnedNodeCount: 2,
            alertCounts: { critical: 0, warning: 1, info: 2 },
            author: 'Network Team',
            updatedAt: '2024-05-16T07:48:00Z',
            timeRange: '7d',
            layout: 'dynamic',
            toggles: { showAlerts: true, allEdges: false, showUndiscovered: false },
            filters: { origin: 'Alerts → Critical WAN', applied: ['Region: APAC'] }
          },
          {
            id: 'retail-overlay',
            name: 'Retail Overlay',
            description: 'Undiscovered handhelds and PoS adjacency.',
            groupId: 'branch',
            pinnedNodeCount: 1,
            alertCounts: { critical: 0, warning: 0, info: 4 },
            author: 'Retail Ops',
            updatedAt: '2024-05-10T18:20:00Z',
            timeRange: '24h',
            layout: 'radial',
            toggles: { showAlerts: false, allEdges: false, showUndiscovered: true },
            filters: { origin: 'Resources → Retail', applied: ['Store tier: Flagship'] }
          },
          {
            id: 'cloud-services',
            name: 'Cloud Edge Services',
            description: 'Connectivity from data centre to cloud gateways.',
            groupId: 'cloud',
            pinnedNodeCount: 2,
            alertCounts: { critical: 0, warning: 0, info: 1 },
            author: 'Cloud Guild',
            updatedAt: '2024-05-11T11:40:00Z',
            timeRange: '6h',
            layout: 'hierarchical',
            toggles: { showAlerts: true, allEdges: false, showUndiscovered: false },
            filters: { origin: 'Alerts → Cloud', applied: ['Provider: AWS'] }
          }
        ];

        const SAMPLE_MAP_CANVASES = {
          'core-backbone': {
            nodes: [
              { id: 'cr1', label: 'CR-1', type: 'router', status: 'healthy', pinned: true, position: { x: 420, y: 140 }, layer: 0, alerts: { critical: 1, warning: 0, info: 1 }, props: { site: 'DC West', ip: '10.0.0.1', platform: 'Juniper MX480' } },
              { id: 'cr2', label: 'CR-2', type: 'router', status: 'critical', pinned: true, position: { x: 580, y: 140 }, layer: 0, alerts: { critical: 1, warning: 0, info: 2 }, props: { site: 'DC East', ip: '10.0.0.2', platform: 'Cisco ASR 9906' } },
              { id: 'agg1', label: 'Aggregation West', type: 'switch', status: 'warning', layer: 1, alerts: { critical: 0, warning: 1, info: 2 }, props: { site: 'DC West', ip: '10.0.10.10', platform: 'Arista 7280' } },
              { id: 'agg2', label: 'Aggregation East', type: 'switch', status: 'healthy', layer: 1, alerts: { critical: 0, warning: 0, info: 1 }, props: { site: 'DC East', ip: '10.0.20.10', platform: 'Arista 7280' } },
              { id: 'edge-fw', label: 'Perimeter FW', type: 'firewall', status: 'warning', layer: 2, alerts: { critical: 0, warning: 1, info: 1 }, props: { site: 'DMZ', ip: '172.16.0.5', platform: 'Palo Alto 5220' } },
              { id: 'noc', label: 'NOC Systems', type: 'server', status: 'info', layer: 2, alerts: { critical: 0, warning: 0, info: 1 }, props: { site: 'HQ', ip: '10.10.0.12', platform: 'VM Cluster' } }
            ],
            edges: [
              { id: 'e-core-link', from: 'cr1', to: 'cr2', kind: 'Routing', status: 'healthy', metrics: { latencyMs: 3.2, utilisation: 0.42 }, collapsed: false, interfaces: { from: { deviceId: 'cr1', interfaceName: 'xe-0/0/0', interfaceProps: { speed: '40 Gbps' } }, to: { deviceId: 'cr2', interfaceName: 'xe-0/0/1', interfaceProps: { speed: '40 Gbps' } } } },
              { id: 'e-core-west', from: 'cr1', to: 'agg1', kind: 'Network', status: 'degraded', metrics: { latencyMs: 7.4, utilisation: 0.61 }, collapsed: false, interfaces: { from: { deviceId: 'cr1', interfaceName: 'xe-0/0/2', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'agg1', interfaceName: 'Ethernet2', interfaceProps: { speed: '10 Gbps' } } } },
              { id: 'e-core-east', from: 'cr2', to: 'agg2', kind: 'Network', status: 'healthy', metrics: { latencyMs: 4.1, utilisation: 0.33 }, collapsed: false, interfaces: { from: { deviceId: 'cr2', interfaceName: 'xe-0/0/3', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'agg2', interfaceName: 'Ethernet1', interfaceProps: { speed: '10 Gbps' } } } },
              { id: 'e-fw', from: 'agg2', to: 'edge-fw', kind: 'Routing', status: 'degraded', metrics: { latencyMs: 8.6, utilisation: 0.54 }, collapsed: true, interfaces: { from: { deviceId: 'agg2', interfaceName: 'Ethernet6', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'edge-fw', interfaceName: 'ae1', interfaceProps: { speed: '10 Gbps' } } } },
              { id: 'e-noc', from: 'agg1', to: 'noc', kind: 'Network', status: 'healthy', metrics: { latencyMs: 2.1, utilisation: 0.21 }, collapsed: false, interfaces: { from: { deviceId: 'agg1', interfaceName: 'Ethernet10', interfaceProps: { speed: '1 Gbps' } }, to: { deviceId: 'noc', interfaceName: 'eth0', interfaceProps: { speed: '1 Gbps' } } } }
            ],
            filters: { focus: 'Core routers and aggregation', preservedFrom: 'Resources view' }
          },
          'core-security': {
            nodes: [
              { id: 'dmz-fw', label: 'DMZ Firewall', type: 'firewall', status: 'warning', layer: 0, alerts: { critical: 0, warning: 1, info: 0 }, props: { site: 'DMZ', ip: '172.20.0.2', platform: 'Fortinet 1800F' } },
              { id: 'ids', label: 'IDS Cluster', type: 'server', status: 'healthy', layer: 1, alerts: { critical: 0, warning: 0, info: 1 }, props: { site: 'DMZ', ip: '172.20.0.10', platform: 'Suricata' } },
              { id: 'soc', label: 'SOC Platform', type: 'server', status: 'info', layer: 2, alerts: { critical: 0, warning: 0, info: 2 }, props: { site: 'HQ SOC', ip: '10.30.0.5', platform: 'Elastic' } },
              { id: 'internet', label: 'Internet Exchange', type: 'network', status: 'healthy', layer: 0, alerts: { critical: 0, warning: 0, info: 0 }, props: { site: 'Carrier POP', ip: '203.0.113.1', platform: 'Transit' } }
            ],
            edges: [
              { id: 'sec-fw-ids', from: 'dmz-fw', to: 'ids', kind: 'Network', status: 'degraded', metrics: { latencyMs: 5.1, utilisation: 0.72 }, collapsed: false, interfaces: { from: { deviceId: 'dmz-fw', interfaceName: 'port1', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'ids', interfaceName: 'ens3', interfaceProps: { speed: '10 Gbps' } } } },
              { id: 'sec-ids-soc', from: 'ids', to: 'soc', kind: 'Routing', status: 'healthy', metrics: { latencyMs: 3.8, utilisation: 0.28 }, collapsed: false, interfaces: { from: { deviceId: 'ids', interfaceName: 'ens4', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'soc', interfaceName: 'eth1', interfaceProps: { speed: '10 Gbps' } } } },
              { id: 'sec-fw-internet', from: 'dmz-fw', to: 'internet', kind: 'Network', status: 'healthy', metrics: { latencyMs: 11.2, utilisation: 0.38 }, collapsed: false, interfaces: { from: { deviceId: 'dmz-fw', interfaceName: 'port9', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'internet', interfaceName: 'uplink-a', interfaceProps: { speed: '10 Gbps' } } } }
            ],
            filters: { focus: 'Security edge', preservedFrom: 'Alerts list' }
          },
          'campus-access': {
            nodes: [
              { id: 'core-a', label: 'Core-A', type: 'switch', status: 'warning', pinned: true, position: { x: 180, y: 200 }, layer: 0, alerts: { critical: 0, warning: 1, info: 0 }, props: { site: 'HQ Core', ip: '10.1.0.1', platform: 'Catalyst 9500' } },
              { id: 'core-b', label: 'Core-B', type: 'switch', status: 'healthy', pinned: true, position: { x: 820, y: 200 }, layer: 0, alerts: { critical: 0, warning: 0, info: 0 }, props: { site: 'HQ Core', ip: '10.1.0.2', platform: 'Catalyst 9500' } },
              { id: 'dist-1', label: 'Dist-1', type: 'switch', status: 'warning', layer: 1, alerts: { critical: 0, warning: 1, info: 2 }, props: { site: 'HQ Floor 1', ip: '10.1.10.1', platform: 'Catalyst 9300' } },
              { id: 'dist-2', label: 'Dist-2', type: 'switch', status: 'healthy', layer: 1, alerts: { critical: 0, warning: 0, info: 3 }, props: { site: 'HQ Lab', ip: '10.1.20.1', platform: 'Catalyst 9300' } },
              { id: 'ap-ghost', label: 'Inferred AP', type: 'access_point', status: 'undiscovered', layer: 2, alerts: { critical: 0, warning: 0, info: 0 }, discovered: false, props: { site: 'HQ Floor 1', ip: '10.1.10.240', platform: 'Telemetry' } }
            ],
            edges: [
              { id: 'campus-core-ring', from: 'core-a', to: 'core-b', kind: 'Network', status: 'healthy', metrics: { latencyMs: 1.4, utilisation: 0.22 }, collapsed: false, interfaces: { from: { deviceId: 'core-a', interfaceName: 'Te1/1/1', interfaceProps: { speed: '40 Gbps' } }, to: { deviceId: 'core-b', interfaceName: 'Te1/1/1', interfaceProps: { speed: '40 Gbps' } } } },
              { id: 'campus-dist1', from: 'core-a', to: 'dist-1', kind: 'Network', status: 'degraded', metrics: { latencyMs: 2.4, utilisation: 0.58 }, collapsed: false, interfaces: { from: { deviceId: 'core-a', interfaceName: 'Te1/1/3', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'dist-1', interfaceName: 'Te1/0/1', interfaceProps: { speed: '10 Gbps' } } } },
              { id: 'campus-dist2', from: 'core-b', to: 'dist-2', kind: 'Network', status: 'healthy', metrics: { latencyMs: 2.1, utilisation: 0.41 }, collapsed: false, interfaces: { from: { deviceId: 'core-b', interfaceName: 'Te1/1/4', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'dist-2', interfaceName: 'Te1/0/2', interfaceProps: { speed: '10 Gbps' } } } },
              { id: 'campus-wireless', from: 'dist-1', to: 'ap-ghost', kind: 'Wireless', status: 'info', metrics: { latencyMs: 6.8, utilisation: 0.12 }, collapsed: true, interfaces: { from: { deviceId: 'dist-1', interfaceName: 'Gi1/0/24', interfaceProps: { power: '30W PoE' } }, to: { deviceId: 'ap-ghost', interfaceName: 'Radio', interfaceProps: { inferred: true } } } }
            ],
            filters: { focus: 'Campus floor 1', preservedFrom: 'Device list' }
          },
          'branch-topology': {
            nodes: [
              { id: 'sdwan-hub', label: 'SD-WAN Hub', type: 'router', status: 'healthy', layer: 0, alerts: { critical: 0, warning: 0, info: 1 }, props: { site: 'Singapore', ip: '172.31.0.1', platform: 'Viptela vEdge' } },
              { id: 'branch-hk', label: 'HK Branch', type: 'router', status: 'warning', layer: 1, alerts: { critical: 0, warning: 1, info: 0 }, props: { site: 'Hong Kong', ip: '172.31.10.1', platform: 'Viptela vEdge' } },
              { id: 'branch-syd', label: 'Sydney Branch', type: 'router', status: 'healthy', layer: 1, alerts: { critical: 0, warning: 0, info: 1 }, props: { site: 'Sydney', ip: '172.31.20.1', platform: 'Viptela vEdge' } },
              { id: 'branch-tokyo', label: 'Tokyo Branch', type: 'router', status: 'healthy', layer: 1, alerts: { critical: 0, warning: 0, info: 0 }, props: { site: 'Tokyo', ip: '172.31.30.1', platform: 'Viptela vEdge' } }
            ],
            edges: [
              { id: 'sdwan-hk', from: 'sdwan-hub', to: 'branch-hk', kind: 'Routing', status: 'degraded', metrics: { latencyMs: 42.5, utilisation: 0.63 }, collapsed: false, interfaces: { from: { deviceId: 'sdwan-hub', interfaceName: 'ge0/0', interfaceProps: { vpn: '10' } }, to: { deviceId: 'branch-hk', interfaceName: 'ge0/0', interfaceProps: { vpn: '10' } } } },
              { id: 'sdwan-syd', from: 'sdwan-hub', to: 'branch-syd', kind: 'Routing', status: 'healthy', metrics: { latencyMs: 31.2, utilisation: 0.29 }, collapsed: false, interfaces: { from: { deviceId: 'sdwan-hub', interfaceName: 'ge0/1', interfaceProps: { vpn: '10' } }, to: { deviceId: 'branch-syd', interfaceName: 'ge0/0', interfaceProps: { vpn: '10' } } } },
              { id: 'sdwan-tokyo', from: 'sdwan-hub', to: 'branch-tokyo', kind: 'Routing', status: 'healthy', metrics: { latencyMs: 27.6, utilisation: 0.32 }, collapsed: false, interfaces: { from: { deviceId: 'sdwan-hub', interfaceName: 'ge0/2', interfaceProps: { vpn: '10' } }, to: { deviceId: 'branch-tokyo', interfaceName: 'ge0/0', interfaceProps: { vpn: '10' } } } }
            ],
            filters: { focus: 'APAC SD-WAN edges', preservedFrom: 'Alerts view' }
          },
          'retail-overlay': {
            nodes: [
              { id: 'retail-router', label: 'Store Router', type: 'router', status: 'info', layer: 0, alerts: { critical: 0, warning: 0, info: 1 }, props: { site: 'London Flagship', ip: '10.50.0.1', platform: 'Meraki MX' } },
              { id: 'retail-switch', label: 'Store Switch', type: 'switch', status: 'healthy', layer: 1, alerts: { critical: 0, warning: 0, info: 1 }, props: { site: 'London Flagship', ip: '10.50.0.2', platform: 'Meraki MS' } },
              { id: 'retail-pos', label: 'Point-of-sale', type: 'server', status: 'info', layer: 2, alerts: { critical: 0, warning: 0, info: 2 }, props: { site: 'London Flagship', ip: '10.50.0.25', platform: 'POS Cluster' } },
              { id: 'retail-ghost', label: 'Undiscovered IoT', type: 'device', status: 'undiscovered', layer: 2, alerts: { critical: 0, warning: 0, info: 0 }, discovered: false, props: { site: 'London Flagship', ip: '10.50.0.240', platform: 'Telemetry' } }
            ],
            edges: [
              { id: 'retail-uplink', from: 'retail-router', to: 'retail-switch', kind: 'Network', status: 'healthy', metrics: { latencyMs: 1.2, utilisation: 0.18 }, collapsed: false, interfaces: { from: { deviceId: 'retail-router', interfaceName: 'ge1', interfaceProps: { speed: '1 Gbps' } }, to: { deviceId: 'retail-switch', interfaceName: 'port48', interfaceProps: { speed: '1 Gbps' } } } },
              { id: 'retail-pos-link', from: 'retail-switch', to: 'retail-pos', kind: 'Network', status: 'healthy', metrics: { latencyMs: 0.9, utilisation: 0.22 }, collapsed: false, interfaces: { from: { deviceId: 'retail-switch', interfaceName: 'port5', interfaceProps: { speed: '1 Gbps' } }, to: { deviceId: 'retail-pos', interfaceName: 'eth0', interfaceProps: { speed: '1 Gbps' } } } },
              { id: 'retail-ghost-link', from: 'retail-switch', to: 'retail-ghost', kind: 'Network', status: 'info', metrics: { latencyMs: 2.3, utilisation: 0.04 }, collapsed: true, interfaces: { from: { deviceId: 'retail-switch', interfaceName: 'port12', interfaceProps: { speed: '100 Mbps' } }, to: { deviceId: 'retail-ghost', interfaceName: 'inferred', interfaceProps: { inferred: true } } } }
            ],
            filters: { focus: 'Retail flagship store', preservedFrom: 'Dashboard widget' }
          },
          'cloud-services': {
            nodes: [
              { id: 'cloud-gateway', label: 'AWS TGW', type: 'gateway', status: 'healthy', layer: 0, alerts: { critical: 0, warning: 0, info: 1 }, props: { site: 'us-east-1', ip: '54.241.12.10', platform: 'AWS Transit GW' } },
              { id: 'dc-edge', label: 'DC Edge Router', type: 'router', status: 'healthy', layer: 0, alerts: { critical: 0, warning: 0, info: 0 }, props: { site: 'Primary DC', ip: '10.100.0.1', platform: 'Cisco ASR' } },
              { id: 'direct-connect', label: 'Direct Connect', type: 'network', status: 'healthy', layer: 1, alerts: { critical: 0, warning: 0, info: 0 }, props: { site: 'Carrier POP', ip: '198.51.100.2', platform: 'Direct Connect' } },
              { id: 'azure-edge', label: 'Azure vWAN', type: 'gateway', status: 'info', layer: 1, alerts: { critical: 0, warning: 0, info: 1 }, props: { site: 'westeurope', ip: '40.40.40.1', platform: 'Azure vWAN' } }
            ],
            edges: [
              { id: 'cloud-aws', from: 'dc-edge', to: 'cloud-gateway', kind: 'Routing', status: 'healthy', metrics: { latencyMs: 14.1, utilisation: 0.37 }, collapsed: false, interfaces: { from: { deviceId: 'dc-edge', interfaceName: 'xe-0/0/1', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'cloud-gateway', interfaceName: 'Attachment-A', interfaceProps: { speed: '10 Gbps' } } } },
              { id: 'cloud-direct', from: 'dc-edge', to: 'direct-connect', kind: 'Network', status: 'healthy', metrics: { latencyMs: 10.7, utilisation: 0.24 }, collapsed: false, interfaces: { from: { deviceId: 'dc-edge', interfaceName: 'xe-0/0/2', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'direct-connect', interfaceName: 'uplink-1', interfaceProps: { speed: '10 Gbps' } } } },
              { id: 'cloud-azure', from: 'dc-edge', to: 'azure-edge', kind: 'Routing', status: 'healthy', metrics: { latencyMs: 18.5, utilisation: 0.18 }, collapsed: true, interfaces: { from: { deviceId: 'dc-edge', interfaceName: 'xe-0/0/3', interfaceProps: { speed: '10 Gbps' } }, to: { deviceId: 'azure-edge', interfaceName: 'Connection-1', interfaceProps: { speed: '10 Gbps' } } } }
            ],
            filters: { focus: 'Cloud interconnect', preservedFrom: 'Alerts filter' }
          }
        };

        const savedMapsState = {
          groups: SAMPLE_MAP_GROUPS.map(group => ({ ...group, mapIds: [...group.mapIds] })),
          maps: SAMPLE_SAVED_MAPS.map(map => ({ ...map })),
          filterText: '',
          groupFilter: null,
          groupSearch: '',
          timeRange: '24h',
          expandedGroups: new Set(),
          visibleColumns: new Set(SAVED_MAP_COLUMNS.map(column => column.key)),
          columnOrder: [...DEFAULT_SAVED_MAP_COLUMN_ORDER],
          selectedMapId: null,
          lastRefreshed: null,
          initialised: false
        };

        const mapCanvasState = {
          data: new Map(Object.entries(SAMPLE_MAP_CANVASES)),
          activeMeta: null,
          currentData: null,
          activeMapId: null,
          transform: { x: 80, y: 60, scale: 0.9 },
          panning: false,
          pointerId: null,
          pointerOrigin: { x: 0, y: 0 },
          panStart: { x: 0, y: 0 },
          selectedNodeId: null,
          selectedEdgeId: null,
          edgeStatus: false,
          toggles: { showAlerts: true, allEdges: false, showUndiscovered: false, layout: 'hierarchical' },
          isDirty: false,
          isDraft: false
        };

        function ensureOverviewMapReady() {
          if (!savedMapsElements.layout) { return; }
          if (!savedMapsState.initialised) {
            initSavedMapsView();
          } else {
            refreshSavedMapsUI();
          }
        }

        async function initSavedMapsView() {
          restoreSavedMapsContext();
          buildTableSettingsMenu();
          bindSavedMapsEvents();
          await refreshSavedMapsUI();
          if (savedMapsState.selectedMapId && getMapById(savedMapsState.selectedMapId)) {
            openSavedMap(savedMapsState.selectedMapId, { silent: true });
          }
          savedMapsState.initialised = true;
        }

        function bindSavedMapsEvents() {
          savedMapsElements.filterInput?.addEventListener('input', (event) => {
            savedMapsState.filterText = event.target.value.trim().toLowerCase();
            refreshSavedMapsUI();
            persistSavedMapsContext();
          });
          savedMapsElements.timeRange?.addEventListener('change', (event) => {
            savedMapsState.timeRange = event.target.value;
            updateSavedMapsStatus();
            persistSavedMapsContext();
          });
          savedMapsElements.refreshBtn?.addEventListener('click', () => {
            savedMapsState.lastRefreshed = new Date();
            updateSavedMapsStatus();
            showToast({ message: 'Saved maps refreshed with the latest alert window.', duration: 3000 });
          });
          savedMapsElements.groupFilter?.addEventListener('input', (event) => {
            savedMapsState.groupSearch = event.target.value.trim().toLowerCase();
            renderMapGroupsTree();
          });
          savedMapsElements.addButton?.addEventListener('click', () => {
            createNewMapDraft();
            showMapCanvas();
            renderMapCanvas();
            showToast({ message: 'Opened a blank canvas. Use Save to capture it to a group.', duration: 4000 });
          });
          savedMapsElements.tableSettingsBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleMenu(savedMapsElements.tableSettingsBtn, savedMapsElements.tableSettingsMenu);
          });
          savedMapsElements.toolbarMore?.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleMenu(savedMapsElements.toolbarMore, savedMapsElements.toolbarMoreMenu);
          });
          savedMapsElements.toolbarMoreMenu?.addEventListener('click', (event) => {
            const action = event.target?.dataset?.mapAction;
            if (!action) { return; }
            event.stopPropagation();
            closeOpenMenu();
            handleToolbarMoreAction(action);
          });
          savedMapsElements.toolbarSave?.addEventListener('click', handleToolbarSave);
          savedMapsElements.toolbarSettings?.addEventListener('click', openMapSettingsModal);
          savedMapsElements.edgeStatusToggle?.addEventListener('change', (event) => {
            mapCanvasState.edgeStatus = Boolean(event.target.checked);
            persistSavedMapsContext();
            renderMapCanvas();
          });
          savedMapsElements.connectionDetailsClose?.addEventListener('click', clearConnectionDetails);
          savedMapsElements.inspectorClose?.addEventListener('click', () => {
            mapCanvasState.selectedNodeId = null;
            renderInspector();
            renderMapCanvas();
          });
          savedMapsElements.mapSettingsCancel?.addEventListener('click', closeMapSettingsModal);
          savedMapsElements.mapSettingsModal?.addEventListener('click', (event) => {
            if (event.target === savedMapsElements.mapSettingsModal) {
              closeMapSettingsModal();
            }
          });
          savedMapsElements.mapSettingsForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            applyMapSettings();
          });
          if (savedMapsElements.canvasSurface) {
            savedMapsElements.canvasSurface.addEventListener('pointerdown', beginCanvasPan);
            savedMapsElements.canvasSurface.addEventListener('pointermove', moveCanvasPan);
            savedMapsElements.canvasSurface.addEventListener('pointerup', endCanvasPan);
            savedMapsElements.canvasSurface.addEventListener('pointerleave', endCanvasPan);
            savedMapsElements.canvasSurface.addEventListener('pointercancel', endCanvasPan);
            savedMapsElements.canvasSurface.addEventListener('wheel', handleCanvasWheel, { passive: false });
          }
        }

        async function refreshSavedMapsUI() {
          await Promise.all([
            loadMapGroupsFromAPI(),
            loadSavedMapsFromAPI()
          ]);
          updateSavedMapsStatus();
          renderMapCanvas();
        }

        // API functions for topology mapping
        async function loadMapGroupsFromAPI() {
          try {
            const response = await fetch('/api/map-groups');
            if (response.ok) {
              const groups = await response.json();
              savedMapsState.groups = groups || [];
            } else {
              console.error('Failed to load map groups:', response.statusText);
              savedMapsState.groups = SAMPLE_MAP_GROUPS; // Fallback to sample data
            }
          } catch (error) {
            console.error('Error loading map groups:', error);
            savedMapsState.groups = SAMPLE_MAP_GROUPS; // Fallback to sample data
          }
          renderMapGroupsTree();
        }

        async function loadSavedMapsFromAPI() {
          try {
            const response = await fetch('/api/saved-maps');
            if (response.ok) {
              const maps = await response.json();
              savedMapsState.maps = maps || [];
            } else {
              console.error('Failed to load saved maps:', response.statusText);
              savedMapsState.maps = SAMPLE_SAVED_MAPS; // Fallback to sample data
            }
          } catch (error) {
            console.error('Error loading saved maps:', error);
            savedMapsState.maps = SAMPLE_SAVED_MAPS; // Fallback to sample data
          }
          renderSavedMapsTable();
        }

        async function saveMapGroup(group) {
          try {
            const response = await fetch('/api/map-groups', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(group)
            });
            if (response.ok) {
              await loadMapGroupsFromAPI(); // Refresh groups
              return true;
            } else {
              console.error('Failed to save map group:', response.statusText);
              return false;
            }
          } catch (error) {
            console.error('Error saving map group:', error);
            return false;
          }
        }

        async function saveSavedMap(map) {
          try {
            const response = await fetch('/api/saved-maps', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(map)
            });
            if (response.ok) {
              await loadSavedMapsFromAPI(); // Refresh maps
              return true;
            } else {
              console.error('Failed to save map:', response.statusText);
              return false;
            }
          } catch (error) {
            console.error('Error saving map:', error);
            return false;
          }
        }

        async function updateSavedMap(mapId, map) {
          try {
            const response = await fetch(`/api/saved-maps/${mapId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(map)
            });
            if (response.ok) {
              await loadSavedMapsFromAPI(); // Refresh maps
              return true;
            } else {
              console.error('Failed to update map:', response.statusText);
              return false;
            }
          } catch (error) {
            console.error('Error updating map:', error);
            return false;
          }
        }

        async function saveMapCanvasData(mapId, canvasData) {
          try {
            const response = await fetch(`/api/map-canvas/${mapId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(canvasData)
            });
            if (response.ok) {
              return true;
            } else {
              console.error('Failed to save canvas data:', response.statusText);
              return false;
            }
          } catch (error) {
            console.error('Error saving canvas data:', error);
            return false;
          }
        }

        async function loadMapCanvasData(mapId) {
          try {
            const response = await fetch(`/api/map-canvas/${mapId}`);
            if (response.ok) {
              return await response.json();
            } else if (response.status === 404) {
              return null; // No canvas data exists yet
            } else {
              console.error('Failed to load canvas data:', response.statusText);
              return null;
            }
          } catch (error) {
            console.error('Error loading canvas data:', error);
            return null;
          }
        }

        function restoreSavedMapsContext() {
          try {
            const stored = sessionStorage.getItem(MAP_CONTEXT_KEY);
            if (!stored) { return; }
            const parsed = JSON.parse(stored);
            if (parsed.filterText) {
              savedMapsState.filterText = parsed.filterText;
              if (savedMapsElements.filterInput) { savedMapsElements.filterInput.value = parsed.filterText; }
            }
            if (parsed.timeRange) {
              savedMapsState.timeRange = parsed.timeRange;
              if (savedMapsElements.timeRange) { savedMapsElements.timeRange.value = parsed.timeRange; }
            }
            if (parsed.groupFilter) {
              savedMapsState.groupFilter = parsed.groupFilter;
            }
            if (Array.isArray(parsed.visibleColumns) && parsed.visibleColumns.length) {
              const restored = parsed.visibleColumns.filter(key => SAVED_MAP_COLUMN_MAP.has(key));
              if (restored.length) {
                savedMapsState.visibleColumns = new Set(restored);
              }
            }
            if (Array.isArray(parsed.columnOrder) && parsed.columnOrder.length) {
              savedMapsState.columnOrder = normaliseColumnOrder(parsed.columnOrder);
            }
            if (parsed.selectedMapId) {
              savedMapsState.selectedMapId = parsed.selectedMapId;
            }
            if (typeof parsed.edgeStatus === 'boolean') {
              mapCanvasState.edgeStatus = parsed.edgeStatus;
              if (savedMapsElements.edgeStatusToggle) { savedMapsElements.edgeStatusToggle.checked = parsed.edgeStatus; }
            }
          } catch (err) {
            console.warn('Failed to restore map context', err);
          }
        }

        function persistSavedMapsContext() {
          try {
            const payload = {
              filterText: savedMapsState.filterText,
              timeRange: savedMapsState.timeRange,
              groupFilter: savedMapsState.groupFilter,
              selectedMapId: savedMapsState.selectedMapId,
              visibleColumns: Array.from(savedMapsState.visibleColumns),
              columnOrder: [...savedMapsState.columnOrder],
              edgeStatus: mapCanvasState.edgeStatus
            };
            sessionStorage.setItem(MAP_CONTEXT_KEY, JSON.stringify(payload));
          } catch (err) {
            console.debug('Unable to persist map context', err);
          }
        }

        function getGroupById(id) {
          if (!id) { return null; }
          return savedMapsState.groups.find(group => group.id === id) || null;
        }

        function getMapById(id) {
          if (!id) { return null; }
          return savedMapsState.maps.find(map => map.id === id) || null;
        }

        function getGroupName(id) {
          const group = getGroupById(id);
          return group ? group.name : 'Unassigned';
        }

        function collectGroupDescendants(id, acc = new Set()) {
          const group = getGroupById(id);
          if (!group) { return acc; }
          acc.add(group.id);
          (group.children || []).forEach(childId => {
            if (!acc.has(childId)) {
              collectGroupDescendants(childId, acc);
            }
          });
          return acc;
        }

        function collectMapsForGroup(groupId) {
          if (!groupId) { return new Set(); }
          const groups = collectGroupDescendants(groupId);
          const ids = new Set();
          savedMapsState.groups.forEach(group => {
            if (groups.has(group.id)) {
              group.mapIds.forEach(id => ids.add(id));
            }
          });
          return ids;
        }

        function matchesGroupSearch(group) {
          const query = savedMapsState.groupSearch;
          if (!query) { return true; }
          if (group.name.toLowerCase().includes(query)) { return true; }
          return group.mapIds.map(getMapById).filter(Boolean).some(map => map.name.toLowerCase().includes(query));
        }

        function createAlertSummary(counts = {}) {
          const fragment = document.createDocumentFragment();
          const entries = [
            { key: 'critical', className: 'map-alert-critical', icon: '⛔' },
            { key: 'warning', className: 'map-alert-warning', icon: '⚠️' },
            { key: 'info', className: 'map-alert-info', icon: 'ℹ️' }
          ];
          entries.forEach(({ key, className, icon }) => {
            const value = Number(counts[key] || 0);
            if (value <= 0) { return; }
            fragment.appendChild(el('span', { class: `map-alert-badge ${className}` }, icon, ` ${value}`));
          });
          if (!fragment.childNodes.length) {
            fragment.appendChild(el('span', { class: 'muted-xs' }, 'No alerts'));
          }
          return fragment;
        }

        function formatMapUpdated(timestamp) {
          if (!timestamp) { return 'Unknown'; }
          try {
            const date = new Date(timestamp);
            if (Number.isNaN(date.getTime())) { return 'Unknown'; }
            const diff = Date.now() - date.getTime();
            if (diff < 60000) { return 'Just now'; }
            if (diff < 3600000) {
              const minutes = Math.floor(diff / 60000);
              return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
            }
            if (diff < 86400000) {
              const hours = Math.floor(diff / 3600000);
              return `${hours} hr${hours === 1 ? '' : 's'} ago`;
            }
            const days = Math.floor(diff / 86400000);
            if (days < 7) {
              return `${days} day${days === 1 ? '' : 's'} ago`;
            }
            return formatTimestamp(date.toISOString());
          } catch (err) {
            return 'Unknown';
          }
        }

        function summariseAlerts(counts) {
          return {
            critical: Number(counts?.critical || 0),
            warning: Number(counts?.warning || 0),
            info: Number(counts?.info || 0)
          };
        }

        function addAlertCounts(target, counts) {
          target.critical += counts.critical;
          target.warning += counts.warning;
          target.info += counts.info;
        }

        function summariseGroup(groupId) {
          const ids = collectMapsForGroup(groupId);
          const summary = { maps: ids.size, alerts: { critical: 0, warning: 0, info: 0 } };
          ids.forEach(mapId => {
            const map = getMapById(mapId);
            if (!map) { return; }
            addAlertCounts(summary.alerts, summariseAlerts(map.alertCounts));
          });
          return summary;
        }

        function renderMapGroupsTree() {
          const container = savedMapsElements.groupsTree;
          if (!container) { return; }
          container.innerHTML = '';
          const roots = savedMapsState.groups.filter(group => !group.parentId);
          const fragment = document.createDocumentFragment();
          roots.forEach(group => {
            const branch = createGroupBranch(group, 1);
            if (branch) { fragment.appendChild(branch); }
          });
          if (!fragment.childNodes.length) {
            container.appendChild(el('div', { class: 'empty-state' }, 'No saved map groups yet.'));
            return;
          }
          container.appendChild(fragment);
        }

        function createGroupBranch(group, level) {
          if (!group || !matchesGroupSearch(group)) { return null; }
          const summary = summariseGroup(group.id);
          const item = el('div', { class: 'map-group-item', role: 'treeitem', 'aria-level': level, 'aria-selected': savedMapsState.groupFilter === group.id ? 'true' : 'false' });
          const header = el('div', { class: 'map-group-header' });
          header.appendChild(el('div', { class: 'map-group-title' }, group.name));
          header.appendChild(el('div', { class: 'map-group-counts' },
            el('span', {}, `${summary.maps} map${summary.maps === 1 ? '' : 's'}`),
            el('span', {}, `⚠️ ${summary.alerts.critical + summary.alerts.warning}`)
          ));
          header.addEventListener('click', () => {
            savedMapsState.groupFilter = savedMapsState.groupFilter === group.id ? null : group.id;
            renderSavedMapsTable();
            renderMapGroupsTree();
            updateSavedMapsStatus();
            persistSavedMapsContext();
          });
          item.appendChild(header);

          if (group.mapIds.length > 0) {
            const mapsContainer = el('div', { class: 'map-group-maps' });
            group.mapIds.map(getMapById).filter(Boolean).forEach(map => {
              const alerts = summariseAlerts(map.alertCounts);
              const indicatorColour = alerts.critical > 0 ? '#b3261e' : alerts.warning > 0 ? '#b78216' : alerts.info > 0 ? '#1967d2' : 'var(--border-primary)';
              const entry = el('button', {
                type: 'button',
                class: 'map-group-map',
                'data-active': savedMapsState.selectedMapId === map.id ? 'true' : 'false'
              },
              el('span', {}, map.name),
              el('span', { class: 'alert-dot', style: `background:${indicatorColour}` })
              );
              entry.addEventListener('click', (event) => {
                event.stopPropagation();
                openSavedMap(map.id);
              });
              mapsContainer.appendChild(entry);
            });
            item.appendChild(mapsContainer);
          }

          (group.children || []).forEach(childId => {
            const child = getGroupById(childId);
            const branch = createGroupBranch(child, level + 1);
            if (branch) { item.appendChild(branch); }
          });
          return item;
        }

        function buildTableSettingsMenu() {
          const menu = savedMapsElements.tableSettingsMenu;
          if (!menu) { return; }
          menu.innerHTML = '';
          savedMapsState.columnOrder.forEach((key, index) => {
            const column = getSavedMapColumn(key);
            if (!column) { return; }
            const inputId = `table-column-${column.key}`;
            const checkbox = el('input', {
              type: 'checkbox',
              id: inputId,
              checked: savedMapsState.visibleColumns.has(column.key),
              onchange: (event) => {
                event.stopPropagation();
                if (event.target.checked) {
                  savedMapsState.visibleColumns.add(column.key);
                } else if (savedMapsState.visibleColumns.size > 1) {
                  savedMapsState.visibleColumns.delete(column.key);
                } else {
                  event.target.checked = true;
                  return;
                }
                renderSavedMapsTable();
                updateSavedMapsStatus();
                persistSavedMapsContext();
              }
            });
            const controls = el('div', { class: 'menu-column-controls' },
              el('button', {
                type: 'button',
                class: 'menu-icon-btn',
                'aria-label': `Move ${column.label} earlier`,
                disabled: index === 0,
                onclick: (event) => {
                  event.stopPropagation();
                  reorderSavedMapColumn(column.key, -1);
                }
              }, '▲'),
              el('button', {
                type: 'button',
                class: 'menu-icon-btn',
                'aria-label': `Move ${column.label} later`,
                disabled: index === savedMapsState.columnOrder.length - 1,
                onclick: (event) => {
                  event.stopPropagation();
                  reorderSavedMapColumn(column.key, 1);
                }
              }, '▼')
            );
            menu.appendChild(el('div', { class: 'menu-column-item' },
              el('label', { class: 'menu-column-label' }, checkbox, column.label),
              controls
            ));
          });
        }

        function renderSavedMapsTable() {
          const headerRow = savedMapsElements.tableHeaderRow;
          const tbody = savedMapsElements.tableBody;
          if (!headerRow || !tbody) { return; }
          headerRow.innerHTML = '';
          tbody.innerHTML = '';
          const activeColumns = savedMapsState.columnOrder
            .map(key => getSavedMapColumn(key))
            .filter(Boolean)
            .filter(column => savedMapsState.visibleColumns.has(column.key));
          activeColumns.forEach(column => headerRow.appendChild(el('th', {}, column.label)));
          headerRow.appendChild(el('th', {}, 'Actions'));

          const filtered = savedMapsState.maps.filter(map => {
            if (savedMapsState.groupFilter) {
              const allowed = collectMapsForGroup(savedMapsState.groupFilter);
              if (!allowed.has(map.id)) { return false; }
            }
            if (!savedMapsState.filterText) { return true; }
            const text = savedMapsState.filterText;
            const groupName = getGroupName(map.groupId).toLowerCase();
            return map.name.toLowerCase().includes(text) ||
              (map.description || '').toLowerCase().includes(text) ||
              groupName.includes(text);
          });

          if (!filtered.length) {
            tbody.appendChild(el('tr', {}, el('td', { colspan: String(activeColumns.length + 1) }, el('div', { class: 'empty-state' }, 'No maps match the current filters.'))));
            return;
          }

          const fragment = document.createDocumentFragment();
          filtered.forEach(map => {
            const row = document.createElement('tr');
            row.dataset.mapId = map.id;
            row.addEventListener('click', () => openSavedMap(map.id));
            activeColumns.forEach(column => {
              const cell = document.createElement('td');
              const value = column.render(map);
              if (value instanceof Node) {
                cell.appendChild(value);
              } else {
                cell.textContent = value;
              }
              row.appendChild(cell);
            });
            const actionsCell = el('td', { class: 'map-row-actions' });
            const exploreBtn = el('button', { type: 'button' }, 'Explore');
            exploreBtn.addEventListener('click', (event) => {
              event.stopPropagation();
              openSavedMap(map.id);
            });
            const editBtn = el('button', { type: 'button' }, 'Edit');
            editBtn.addEventListener('click', (event) => {
              event.stopPropagation();
              openSavedMap(map.id, { openSettings: true });
            });
            const deleteBtn = el('button', { type: 'button' }, 'Delete');
            deleteBtn.addEventListener('click', (event) => {
              event.stopPropagation();
              promptDeleteMap(map.id);
            });
            const exportBtn = el('button', { type: 'button' }, 'Export PDF');
            exportBtn.addEventListener('click', (event) => {
              event.stopPropagation();
              showToast({ message: `Exporting “${map.name}” to PDF…`, duration: 3500 });
            });
            const dashboardBtn = el('button', { type: 'button' }, 'Add to Dashboard');
            dashboardBtn.addEventListener('click', (event) => {
              event.stopPropagation();
              showToast({ message: `Added “${map.name}” as a topology widget.`, duration: 3500 });
            });
            actionsCell.append(exploreBtn, editBtn, deleteBtn, exportBtn, dashboardBtn);
            row.appendChild(actionsCell);
            row.classList.toggle('table-row-active', savedMapsState.selectedMapId === map.id);
            fragment.appendChild(row);
          });
          tbody.appendChild(fragment);
        }

        function getSavedMapColumn(key) {
          return SAVED_MAP_COLUMN_MAP.get(key) || null;
        }

        function normaliseColumnOrder(order) {
          const defaults = [...DEFAULT_SAVED_MAP_COLUMN_ORDER];
          const result = [];
          if (Array.isArray(order)) {
            order.forEach(key => {
              if (SAVED_MAP_COLUMN_MAP.has(key) && !result.includes(key)) {
                result.push(key);
              }
            });
          }
          defaults.forEach(key => {
            if (!result.includes(key)) {
              result.push(key);
            }
          });
          return result;
        }

        function reorderSavedMapColumn(key, direction) {
          const order = savedMapsState.columnOrder;
          const currentIndex = order.indexOf(key);
          if (currentIndex === -1) { return; }
          const targetIndex = currentIndex + direction;
          if (targetIndex < 0 || targetIndex >= order.length) { return; }
          order.splice(currentIndex, 1);
          order.splice(targetIndex, 0, key);
          renderSavedMapsTable();
          updateSavedMapsStatus();
          buildTableSettingsMenu();
          persistSavedMapsContext();
        }

        function updateSavedMapsStatus() {
          const status = savedMapsElements.status;
          if (!status) { return; }
          const total = savedMapsState.maps.length;
          const renderedRows = savedMapsElements.tableBody?.querySelectorAll('tr') || [];
          const filteredCount = renderedRows.length && renderedRows[0].querySelector('.empty-state') ? 0 : renderedRows.length;
          const parts = [`Showing ${filteredCount || total ? filteredCount : 0} of ${total} maps`];
          if (savedMapsState.timeRange) {
            parts.push(`Alert window: ${savedMapsElements.timeRange?.selectedOptions?.[0]?.text || savedMapsState.timeRange}`);
          }
          if (savedMapsState.groupFilter) {
            parts.push(`Filtered by group: ${getGroupName(savedMapsState.groupFilter)}`);
          }
          if (savedMapsState.lastRefreshed) {
            parts.push(`Last refreshed ${formatMapUpdated(savedMapsState.lastRefreshed)}`);
          }
          status.textContent = parts.join(' • ');
        }

        function toggleMenu(button, menu) {
          if (!button || !menu) { return; }
          if (openMenuState && openMenuState.menu === menu) {
            closeOpenMenu();
            return;
          }
          closeOpenMenu();
          menu.classList.remove('hidden');
          button.setAttribute('aria-expanded', 'true');
          openMenuState = { menu, button };
        }

        function showMapCanvas() {
          savedMapsElements.canvasWrapper?.classList.remove('hidden');
        }

        function openSavedMap(mapId, options = {}) {
          const map = getMapById(mapId);
          if (!map) { return; }
          savedMapsState.selectedMapId = mapId;
          showMapCanvas();
          mapCanvasState.activeMapId = mapId;
          mapCanvasState.activeMeta = { ...map };
          mapCanvasState.toggles = { ...map.toggles };
          mapCanvasState.toggles.layout = map.layout || 'hierarchical';
          // Load canvas data from API - will be replaced with async call
          mapCanvasState.currentData = mapCanvasState.data.get(mapId) || { nodes: [], edges: [], filters: {} };
          mapCanvasState.isDraft = false;
          mapCanvasState.transform = { x: 80, y: 60, scale: 0.9 };
          mapCanvasState.selectedNodeId = null;
          mapCanvasState.selectedEdgeId = null;
          renderSavedMapsTable();
          updateSavedMapsStatus();
          renderMapCanvas();
          persistSavedMapsContext();
          if (options.openSettings) {
            openMapSettingsModal();
          } else if (!options.silent) {
            showToast({ message: `Opened “${map.name}” in the canvas.`, duration: 2600 });
          }
        }

        function createNewMapDraft() {
          savedMapsState.selectedMapId = null;
          mapCanvasState.activeMapId = null;
          mapCanvasState.activeMeta = {
            id: null,
            name: 'Untitled map',
            description: '',
            groupId: savedMapsState.groups[0]?.id || null,
            pinnedNodeCount: 0,
            alertCounts: { critical: 0, warning: 0, info: 0 },
            author: 'You',
            updatedAt: new Date().toISOString(),
            timeRange: savedMapsState.timeRange,
            layout: 'hierarchical',
            toggles: { showAlerts: true, allEdges: false, showUndiscovered: false },
            filters: { origin: 'Manual build', applied: [] }
          };
          mapCanvasState.toggles = { ...mapCanvasState.activeMeta.toggles };
          mapCanvasState.toggles.layout = mapCanvasState.activeMeta.layout || 'hierarchical';
          mapCanvasState.currentData = { nodes: [], edges: [], filters: { focus: 'Empty canvas', preservedFrom: 'Manual build' } };
          mapCanvasState.isDraft = true;
          mapCanvasState.transform = { x: 80, y: 60, scale: 1 };
          mapCanvasState.selectedNodeId = null;
          mapCanvasState.selectedEdgeId = null;
          populateMapSettingsGroups();
          renderSavedMapsTable();
          updateSavedMapsStatus();
          persistSavedMapsContext();
        }

        function renderMapCanvas() {
          if (!savedMapsElements.canvasInner || !savedMapsElements.canvasEdges || !savedMapsElements.canvasNodes) { return; }
          const meta = mapCanvasState.activeMeta;
          const data = mapCanvasState.currentData;
          const empty = !meta || !data;
          savedMapsElements.canvasEmpty?.classList.toggle('hidden', !empty ? true : false);
          if (empty) {
            updateToolbarMeta();
            updateFooterMeta();
            savedMapsElements.canvasNodes.innerHTML = '';
            savedMapsElements.canvasEdges.innerHTML = '';
            renderInspector();
            clearConnectionDetails();
            hideEdgeTooltip();
            return;
          }
          savedMapsElements.canvasNodes.innerHTML = '';
          savedMapsElements.canvasEdges.innerHTML = '';
          const visibleEdges = (data.edges || []).filter(edge => {
            if (!edge) { return false; }
            if (!mapCanvasState.toggles.allEdges && edge.collapsed) { return false; }
            return true;
          });
          if (!visibleEdges.some(edge => edge.id === mapCanvasState.selectedEdgeId)) {
            clearConnectionDetails();
          }
          const layout = computeLayoutPositions(meta, data);
          renderCanvasEdges(visibleEdges, layout.positions);
          renderCanvasNodes(data.nodes || [], layout.positions);
          applyCanvasTransform();
          renderInspector();
          updateToolbarMeta();
          updateFooterMeta();
        }

        function updateToolbarMeta() {
          const target = savedMapsElements.toolbarMeta;
          if (!target) { return; }
          const meta = mapCanvasState.activeMeta;
          if (!meta) {
            target.textContent = 'Select or create a map to begin.';
            return;
          }
          const bits = [`Layout: ${formatKindLabel(mapCanvasState.toggles?.layout || meta.layout || 'hierarchical')}`];
          bits.push(`Alerts: ${mapCanvasState.toggles.showAlerts ? 'On' : 'Off'}`);
          bits.push(`All edges: ${mapCanvasState.toggles.allEdges ? 'On' : 'Collapsed'}`);
          bits.push(`Undiscovered: ${mapCanvasState.toggles.showUndiscovered ? 'Visible' : 'Hidden'}`);
          bits.push(`Last saved ${formatMapUpdated(meta.updatedAt)}`);
          target.textContent = bits.join(' • ');
        }

        function updateFooterMeta() {
          const target = savedMapsElements.footerMeta;
          if (!target) { return; }
          const meta = mapCanvasState.activeMeta;
          if (!meta) {
            target.textContent = '';
            return;
          }
          const filters = meta.filters || {};
          const origin = filters.origin ? `Context: ${filters.origin}` : 'Context preserved';
          const applied = Array.isArray(filters.applied) && filters.applied.length ? `Filters • ${filters.applied.join(', ')}` : 'No additional filters';
          target.textContent = `${origin} • ${applied}`;
        }

        function populateMapSettingsGroups() {
          const select = savedMapsElements.mapSettingsGroup;
          if (!select) { return; }
          const previous = select.value;
          select.innerHTML = '';
          savedMapsState.groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.name;
            select.appendChild(option);
          });
          if (previous && select.querySelector(`option[value="${previous}"]`)) {
            select.value = previous;
          }
        }

        function openMapSettingsModal() {
          const modal = savedMapsElements.mapSettingsModal;
          if (!modal) { return; }
          populateMapSettingsGroups();
          const meta = mapCanvasState.activeMeta;
          if (savedMapsElements.mapSettingsName) {
            savedMapsElements.mapSettingsName.value = meta?.name || '';
          }
          if (savedMapsElements.mapSettingsDescription) {
            savedMapsElements.mapSettingsDescription.value = meta?.description || '';
          }
          if (savedMapsElements.mapSettingsGroup) {
            savedMapsElements.mapSettingsGroup.value = meta?.groupId || savedMapsState.groups[0]?.id || '';
          }
          if (savedMapsElements.mapSettingsLayout) {
            savedMapsElements.mapSettingsLayout.value = mapCanvasState.toggles.layout || meta?.layout || 'hierarchical';
          }
          if (savedMapsElements.mapSettingsShowAlerts) {
            savedMapsElements.mapSettingsShowAlerts.checked = mapCanvasState.toggles.showAlerts !== false;
          }
          if (savedMapsElements.mapSettingsAllEdges) {
            savedMapsElements.mapSettingsAllEdges.checked = mapCanvasState.toggles.allEdges === true;
          }
          if (savedMapsElements.mapSettingsShowUndiscovered) {
            savedMapsElements.mapSettingsShowUndiscovered.checked = mapCanvasState.toggles.showUndiscovered === true;
          }
          if (savedMapsElements.mapSettingsStatus) {
            savedMapsElements.mapSettingsStatus.textContent = '';
          }
          modal.classList.remove('hidden');
          savedMapsElements.mapSettingsName?.focus();
        }

        function closeMapSettingsModal() {
          savedMapsElements.mapSettingsModal?.classList.add('hidden');
        }

        function applyMapSettings() {
          const meta = mapCanvasState.activeMeta || {};
          const name = savedMapsElements.mapSettingsName?.value.trim();
          if (!name) {
            if (savedMapsElements.mapSettingsStatus) {
              savedMapsElements.mapSettingsStatus.textContent = 'Name is required to save a map.';
            }
            return;
          }
          const description = savedMapsElements.mapSettingsDescription?.value.trim() || '';
          const groupId = savedMapsElements.mapSettingsGroup?.value || null;
          const layout = savedMapsElements.mapSettingsLayout?.value || 'hierarchical';
          const showAlerts = savedMapsElements.mapSettingsShowAlerts?.checked ?? true;
          const allEdges = savedMapsElements.mapSettingsAllEdges?.checked ?? false;
          const showUndiscovered = savedMapsElements.mapSettingsShowUndiscovered?.checked ?? false;

          const isNew = !meta.id;
          const mapId = isNew ? `map-${Date.now().toString(36)}` : meta.id;
          const updatedMeta = {
            ...meta,
            id: mapId,
            name,
            description,
            groupId,
            layout,
            toggles: { showAlerts, allEdges, showUndiscovered },
            updatedAt: new Date().toISOString()
          };
          mapCanvasState.activeMeta = updatedMeta;
          mapCanvasState.activeMapId = mapId;
          mapCanvasState.toggles = { showAlerts, allEdges, showUndiscovered, layout };
          mapCanvasState.isDraft = false;

          if (isNew) {
            savedMapsState.maps.push({ ...updatedMeta });
            const group = getGroupById(groupId);
            if (group && !group.mapIds.includes(mapId)) {
              group.mapIds.push(mapId);
            }
            if (!mapCanvasState.data.has(mapId)) {
              mapCanvasState.data.set(mapId, mapCanvasState.currentData || { nodes: [], edges: [], filters: {} });
            }
          } else {
            savedMapsState.maps = savedMapsState.maps.map(map => map.id === mapId ? { ...map, ...updatedMeta } : map);
            savedMapsState.groups.forEach(group => {
              const index = group.mapIds.indexOf(mapId);
              if (group.id === groupId) {
                if (index === -1) { group.mapIds.push(mapId); }
              } else if (index !== -1) {
                group.mapIds.splice(index, 1);
              }
            });
          }

          closeMapSettingsModal();
          renderSavedMapsTable();
          renderMapGroupsTree();
          updateSavedMapsStatus();
          updateToolbarMeta();
          updateFooterMeta();
          persistSavedMapsContext();
          renderMapCanvas();
          showToast({ message: `Saved map “${name}”.`, duration: 3200 });
        }

        async function handleToolbarSave() {
          if (mapCanvasState.isDraft || !mapCanvasState.activeMeta?.id) {
            openMapSettingsModal();
            return;
          }

          try {
            // Update the map metadata
            const success = await updateSavedMap(mapCanvasState.activeMeta.id, mapCanvasState.activeMeta);
            if (!success) {
              showToast({ message: 'Failed to save map changes.', duration: 3000, type: 'error' });
              return;
            }

            // Save canvas data
            const canvasData = {
              mapId: mapCanvasState.activeMeta.id,
              nodes: mapCanvasState.currentData?.nodes || [],
              edges: mapCanvasState.currentData?.edges || [],
              transform: mapCanvasState.transform
            };

            const canvasSuccess = await saveMapCanvasData(mapCanvasState.activeMeta.id, canvasData);
            if (!canvasSuccess) {
              showToast({ message: 'Map saved but canvas data failed to save.', duration: 3000, type: 'warning' });
            } else {
              showToast({ message: 'Map changes saved.', duration: 2500 });
            }

            updateToolbarMeta();
          } catch (error) {
            console.error('Error saving map:', error);
            showToast({ message: 'Failed to save map changes.', duration: 3000, type: 'error' });
          }
        }

        function handleToolbarMoreAction(action) {
          const meta = mapCanvasState.activeMeta;
          if (!meta) {
            showToast({ message: 'Open a map to use this action.', duration: 2500 });
            return;
          }
          switch (action) {
            case 'clone': {
              const cloneId = `map-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
              const cloneMeta = {
                ...meta,
                id: cloneId,
                name: `${meta.name} (Clone)`,
                updatedAt: new Date().toISOString()
              };
              savedMapsState.maps.push({ ...cloneMeta });
              const group = getGroupById(cloneMeta.groupId);
              if (group && !group.mapIds.includes(cloneId)) {
                group.mapIds.push(cloneId);
              }
              const cloneData = mapCanvasState.data.get(meta.id) ? JSON.parse(JSON.stringify(mapCanvasState.data.get(meta.id))) : { nodes: [], edges: [], filters: {} };
              mapCanvasState.data.set(cloneId, cloneData);
              showToast({ message: `Cloned map to “${cloneMeta.name}”.`, duration: 3200 });
              renderMapGroupsTree();
              renderSavedMapsTable();
              openSavedMap(cloneId);
              break;
            }
            case 'export':
              showToast({ message: `Preparing PDF export for “${meta.name}”…`, duration: 3500 });
              break;
            case 'dashboard':
              showToast({ message: `Added “${meta.name}” to the dashboard.`, duration: 3200 });
              break;
            default:
              break;
          }
        }

        function promptDeleteMap(mapId) {
          const map = getMapById(mapId);
          if (!map) { return; }
          showConfirm(
            'Delete saved map',
            `Are you sure you want to delete “${map.name}”? This action cannot be undone.`,
            'Delete',
            () => {
              savedMapsState.maps = savedMapsState.maps.filter(item => item.id !== mapId);
              savedMapsState.groups.forEach(group => {
                const index = group.mapIds.indexOf(mapId);
                if (index !== -1) { group.mapIds.splice(index, 1); }
              });
              mapCanvasState.data.delete(mapId);
              if (mapCanvasState.activeMapId === mapId) {
                mapCanvasState.activeMapId = null;
                mapCanvasState.activeMeta = null;
                mapCanvasState.currentData = null;
                renderMapCanvas();
              }
              savedMapsState.selectedMapId = savedMapsState.selectedMapId === mapId ? null : savedMapsState.selectedMapId;
              renderMapGroupsTree();
              renderSavedMapsTable();
              updateSavedMapsStatus();
              showToast({ message: 'Map deleted.', duration: 2800, type: 'success' });
            }
          );
        }

        function renderCanvasEdges(edges, positions) {
          const svg = savedMapsElements.canvasEdges;
          if (!svg) { return; }
          svg.innerHTML = '';
          const fragment = document.createDocumentFragment();
          (edges || []).forEach(edge => {
            if (!edge) { return; }
            if (!mapCanvasState.toggles.allEdges && edge.collapsed) { return; }
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) { return; }
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', `M ${from.x} ${from.y} L ${to.x} ${to.y}`);
            path.setAttribute('class', 'map-edge-path');
            const status = mapCanvasState.edgeStatus ? (edge.status || 'healthy') : 'default';
            path.dataset.status = status;
            path.dataset.edgeId = edge.id;
            path.dataset.highlight = mapCanvasState.selectedEdgeId === edge.id ? 'true' : 'false';
            path.addEventListener('click', (event) => {
              event.stopPropagation();
              selectEdge(edge.id);
            });
            path.addEventListener('pointerenter', (event) => showEdgeTooltip(event, edge));
            path.addEventListener('pointermove', (event) => showEdgeTooltip(event, edge));
            path.addEventListener('pointerleave', hideEdgeTooltip);
            fragment.appendChild(path);
          });
          svg.appendChild(fragment);
        }

        function renderCanvasNodes(nodes, positions) {
          const container = savedMapsElements.canvasNodes;
          if (!container) { return; }
          container.innerHTML = '';
          const fragment = document.createDocumentFragment();
          (nodes || []).forEach(node => {
            if (!node) { return; }
            if (!mapCanvasState.toggles.showUndiscovered && node.discovered === false) { return; }
            const pos = positions.get(node.id);
            if (!pos) { return; }
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'map-node';
            button.dataset.nodeId = node.id;
            button.dataset.status = node.status || '';
            button.dataset.selected = mapCanvasState.selectedNodeId === node.id ? 'true' : 'false';
            button.style.left = `${pos.x}px`;
            button.style.top = `${pos.y}px`;
            button.appendChild(el('h4', {}, node.label || node.id));
            const metaList = el('div', { class: 'node-meta' }, formatKindLabel(node.type || 'Resource'));
            if (node.props?.site) {
              metaList.appendChild(el('div', { class: 'muted-xs' }, node.props.site));
            }
            if (node.props?.ip) {
              metaList.appendChild(el('div', { class: 'muted-xs mono' }, node.props.ip));
            }
            button.appendChild(metaList);
            if (mapCanvasState.toggles.showAlerts) {
              const alerts = node.alerts || {};
              const dots = el('div', { class: 'node-alerts' });
              if (alerts.critical > 0) { dots.appendChild(el('span', { class: 'node-alert-dot', 'data-count': alerts.critical })); }
              if (alerts.warning > 0) { dots.appendChild(el('span', { class: 'node-alert-dot warning', 'data-count': alerts.warning })); }
              if (alerts.info > 0) { dots.appendChild(el('span', { class: 'node-alert-dot info', 'data-count': alerts.info })); }
              if (dots.childNodes.length) { button.appendChild(dots); }
            }
            button.addEventListener('click', (event) => {
              event.stopPropagation();
              selectNode(node.id);
            });
            button.addEventListener('dblclick', (event) => {
              event.stopPropagation();
              const targetUrl = `/#resource-${encodeURIComponent(node.id)}`;
              window.open(targetUrl, '_blank');
            });
            fragment.appendChild(button);
          });
          container.appendChild(fragment);
        }

        function renderInspector() {
          const container = savedMapsElements.inspectorContent;
          if (!container) { return; }
          const data = mapCanvasState.currentData || { nodes: [] };
          const node = (data.nodes || []).find(item => item.id === mapCanvasState.selectedNodeId);
          container.innerHTML = '';
          if (!node) {
            container.appendChild(el('p', { class: 'muted' }, 'Select a node to see interface, status, and alert details.'));
            return;
          }
          container.appendChild(el('h4', {}, node.label || node.id));
          const details = el('dl');
          details.appendChild(el('dt', {}, 'Type'));
          details.appendChild(el('dd', {}, formatKindLabel(node.type || 'Resource')));
          details.appendChild(el('dt', {}, 'Status'));
          details.appendChild(el('dd', {}, node.status ? formatKindLabel(node.status) : 'Unknown'));
          if (node.props?.site) {
            details.appendChild(el('dt', {}, 'Site'));
            details.appendChild(el('dd', {}, node.props.site));
          }
          if (node.props?.platform) {
            details.appendChild(el('dt', {}, 'Platform'));
            details.appendChild(el('dd', {}, node.props.platform));
          }
          if (node.props?.ip) {
            details.appendChild(el('dt', {}, 'IP Address'));
            details.appendChild(el('dd', { class: 'mono' }, node.props.ip));
          }
          details.appendChild(el('dt', {}, 'Pinned'));
          details.appendChild(el('dd', {}, node.pinned ? 'Yes' : 'No'));
          const alerts = node.alerts || {};
          details.appendChild(el('dt', {}, 'Alerts'));
          details.appendChild(el('dd', {}, `${alerts.critical || 0} critical, ${alerts.warning || 0} warning, ${alerts.info || 0} info`));
          container.appendChild(details);
        }

        function selectNode(nodeId) {
          mapCanvasState.selectedNodeId = nodeId === mapCanvasState.selectedNodeId ? null : nodeId;
          renderMapCanvas();
        }

        function selectEdge(edgeId) {
          mapCanvasState.selectedEdgeId = edgeId;
          renderConnectionDetails(edgeId);
          renderMapCanvas();
          hideEdgeTooltip();
        }

        function renderConnectionDetails(edgeId) {
          const panel = savedMapsElements.connectionDetails;
          const body = savedMapsElements.connectionDetailsBody;
          if (!panel || !body) { return; }
          const data = mapCanvasState.currentData || { edges: [] };
          const edge = (data.edges || []).find(item => item.id === edgeId);
          if (!edge) {
            clearConnectionDetails();
            return;
          }
          panel.classList.remove('hidden');
          body.innerHTML = '';
          body.appendChild(el('div', { class: 'connection-summary' }, `${edge.kind || 'Connection'} • ${formatKindLabel(edge.status || 'Unknown')}`));
          const endpoints = el('div', { class: 'connection-endpoints' },
            el('div', { class: 'connection-endpoint' },
              el('div', { class: 'muted-xs' }, 'From'),
              el('div', {}, edge.interfaces?.from?.deviceId || edge.from),
              edge.interfaces?.from?.interfaceName ? el('div', { class: 'muted-xs' }, edge.interfaces.from.interfaceName) : null
            ),
            el('div', { class: 'connection-endpoint' },
              el('div', { class: 'muted-xs' }, 'To'),
              el('div', {}, edge.interfaces?.to?.deviceId || edge.to),
              edge.interfaces?.to?.interfaceName ? el('div', { class: 'muted-xs' }, edge.interfaces.to.interfaceName) : null
            )
          );
          body.appendChild(endpoints);
          const metrics = edge.metrics || {};
          const metricsRow = el('div', { class: 'connection-metrics' });
          if (metrics.latencyMs != null) {
            metricsRow.appendChild(el('span', {}, `Latency: ${metrics.latencyMs.toFixed ? metrics.latencyMs.toFixed(1) : metrics.latencyMs} ms`));
          }
          if (metrics.utilisation != null) {
            const util = typeof metrics.utilisation === 'number' ? Math.round(metrics.utilisation * 100) : metrics.utilisation;
            metricsRow.appendChild(el('span', {}, `Utilisation: ${util}%`));
          }
          if (metricsRow.childNodes.length) {
            body.appendChild(metricsRow);
          }
        }

        function clearConnectionDetails() {
          savedMapsElements.connectionDetails?.classList.add('hidden');
          if (savedMapsElements.connectionDetailsBody) {
            savedMapsElements.connectionDetailsBody.innerHTML = '';
          }
          mapCanvasState.selectedEdgeId = null;
        }

        function showEdgeTooltip(event, edge) {
          const tooltip = savedMapsElements.edgeTooltip;
          if (!tooltip) { return; }
          const rect = savedMapsElements.canvasSurface?.getBoundingClientRect();
          if (!rect) { return; }
          const metrics = edge.metrics || {};
          const parts = [];
          if (metrics.latencyMs != null) { parts.push(`Latency ${metrics.latencyMs} ms`); }
          if (metrics.utilisation != null) {
            const util = typeof metrics.utilisation === 'number' ? Math.round(metrics.utilisation * 100) : metrics.utilisation;
            parts.push(`Util ${util}%`);
          }
          tooltip.textContent = parts.length ? parts.join(' • ') : 'No live metrics';
          tooltip.style.left = `${event.clientX - rect.left + 12}px`;
          tooltip.style.top = `${event.clientY - rect.top + 12}px`;
          tooltip.classList.remove('hidden');
        }

        function hideEdgeTooltip() {
          savedMapsElements.edgeTooltip?.classList.add('hidden');
        }

        function computeLayoutPositions(meta, data) {
          const layoutKey = mapCanvasState.toggles.layout || meta.layout || 'hierarchical';
          const width = CANVAS_SIZE.width;
          const height = CANVAS_SIZE.height;
          const positions = new Map();
          const nodes = data.nodes || [];
          nodes.forEach(node => {
            if (node.pinned && node.position) {
              positions.set(node.id, { x: node.position.x, y: node.position.y });
            }
          });
          const remaining = nodes.filter(node => !positions.has(node.id));
          if (layoutKey === 'hierarchical' || layoutKey === 'horizontal') {
            const layers = new Map();
            remaining.forEach(node => {
              const layer = Number.isFinite(node.layer) ? Number(node.layer) : 1;
              if (!layers.has(layer)) { layers.set(layer, []); }
              layers.get(layer).push(node);
            });
            const sortedLayers = Array.from(layers.keys()).sort((a, b) => a - b);
            sortedLayers.forEach((layerValue, index) => {
              const group = layers.get(layerValue);
              group.forEach((node, nodeIndex) => {
                const ratio = (nodeIndex + 1) / (group.length + 1);
                if (layoutKey === 'hierarchical') {
                  positions.set(node.id, { x: ratio * width, y: ((index + 1) / (sortedLayers.length + 1)) * height });
                } else {
                  positions.set(node.id, { x: ((index + 1) / (sortedLayers.length + 1)) * width, y: ratio * height });
                }
              });
            });
          } else if (layoutKey === 'radial') {
            const center = { x: width / 2, y: height / 2 };
            const radius = Math.min(width, height) / 2.6;
            remaining.forEach((node, index) => {
              const angle = (index / Math.max(1, remaining.length)) * Math.PI * 2;
              positions.set(node.id, {
                x: center.x + Math.cos(angle) * radius,
                y: center.y + Math.sin(angle) * radius
              });
            });
          } else {
            const center = { x: width / 2, y: height / 2 };
            remaining.forEach((node, index) => {
              const angle = ((index * 37) % 360) * (Math.PI / 180);
              const radius = (Math.min(width, height) / 3) * (0.4 + ((index % 7) / 10));
              positions.set(node.id, {
                x: center.x + Math.cos(angle) * radius,
                y: center.y + Math.sin(angle) * radius
              });
            });
          }
          return { layout: layoutKey, positions };
        }

        function applyCanvasTransform() {
          const inner = savedMapsElements.canvasInner;
          if (!inner) { return; }
          const { x, y, scale } = mapCanvasState.transform;
          inner.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        }

        function beginCanvasPan(event) {
          if (event.button !== 0) { return; }
          mapCanvasState.panning = true;
          mapCanvasState.pointerId = event.pointerId;
          mapCanvasState.pointerOrigin = { x: event.clientX, y: event.clientY };
          mapCanvasState.panStart = { ...mapCanvasState.transform };
          event.currentTarget.setPointerCapture(event.pointerId);
        }

        function moveCanvasPan(event) {
          if (!mapCanvasState.panning || event.pointerId !== mapCanvasState.pointerId) { return; }
          const dx = event.clientX - mapCanvasState.pointerOrigin.x;
          const dy = event.clientY - mapCanvasState.pointerOrigin.y;
          mapCanvasState.transform.x = mapCanvasState.panStart.x + dx;
          mapCanvasState.transform.y = mapCanvasState.panStart.y + dy;
          applyCanvasTransform();
        }

        function endCanvasPan(event) {
          if (event.pointerId !== mapCanvasState.pointerId) { return; }
          mapCanvasState.panning = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }

        function handleCanvasWheel(event) {
          event.preventDefault();
          const delta = event.deltaY > 0 ? -0.1 : 0.1;
          const newScale = clamp(mapCanvasState.transform.scale + delta, 0.5, 1.8);
          mapCanvasState.transform.scale = newScale;
          applyCanvasTransform();
        }

        function clamp(value, min, max) {
          return Math.min(max, Math.max(min, value));
        }

        const logsState = { initialized: false };
        const settingsState = { loaded: false, isLoading: false, passwordSet: false };
        // const insightsState = { deviceId: null, isLoading: false };
        const backupState = { deviceId: null, deviceName: '', isOpen: false };
        const backupCache = new Map();

        function normaliseKindValue(value) {
          return (value || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        }
        function resolveKindKey(value) {
          const norm = normaliseKindValue(value);
          if (!norm) { return ''; }
          if (Object.prototype.hasOwnProperty.call(DEVICE_KIND_ALIASES, norm)) {
            return DEVICE_KIND_ALIASES[norm];
          }
          return norm;
        }
        function formatKindLabel(value) {
          if (!value) { return 'Device'; }
          return value.toString().replace(/[_\s]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
        }
        function getDeviceBadgeInfo(kind, platform) {
          const candidates = [kind, platform].map(resolveKindKey).filter(Boolean);
          for (const key of candidates) {
            if (Object.prototype.hasOwnProperty.call(DEVICE_KIND_META, key)) {
              const base = DEVICE_KIND_META[key];
              return { ...base, label: base.label || formatKindLabel(kind || platform || base.label) };
            }
          }
          const fallbackLabel = formatKindLabel(kind || platform || DEVICE_KIND_META.default.label);
          return { ...DEVICE_KIND_META.default, label: fallbackLabel };
        }
        function createDeviceBadge(kind, platform) {
          const info = getDeviceBadgeInfo(kind, platform);
          const badge = el('span', { class: `badge ${info.className}` });
          if (info.icon) {
            badge.appendChild(el('span', { class: 'badge-icon' }, info.icon));
          }
          badge.appendChild(el('span', { class: 'badge-label' }, info.label));
          return badge;
        }

        function getDeviceTasks(device) {
          const keys = [resolveKindKey(device?.kind), resolveKindKey(device?.platform)];
          const taskSet = new Set();
          keys.forEach(key => {
            if (key && Object.prototype.hasOwnProperty.call(DEVICE_TASKS, key)) {
              DEVICE_TASKS[key].forEach(task => taskSet.add(task));
            }
          });
          if (taskSet.size === 0) {
            DEVICE_TASKS.default.forEach(task => taskSet.add(task));
          }
          return Array.from(taskSet);
        }

        function setView(viewId) {
          if (!viewId || !Object.prototype.hasOwnProperty.call(viewSections, viewId)) { return; }
          const target = viewSections[viewId];
          if (!target) {
            const routeEntry = getRouteByViewId(viewId);
            if (routeEntry) {
              const [, config] = routeEntry;
              const destination = config?.href;
              if (destination && window.location.pathname !== destination) {
                const search = window.location.search || '';
                const hash = window.location.hash || '';
                window.location.href = `${destination}${search}${hash}`;
              }
            }
            return;
          }
          Object.entries(viewSections).forEach(([key, section]) => {
            if (section) { section.classList.toggle('hidden', key !== viewId); }
          });
          navTabs.forEach(tab => {
            const isActive = tab.dataset.view === viewId;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            if (isActive) {
              tab.setAttribute('aria-current', 'page');
            } else {
              tab.removeAttribute('aria-current');
            }
          });
          viewState.current = viewId;
          switch (viewId) {
            case 'overview-map':
              ensureOverviewMapReady();
              break;
            case 'logs':
              ensureLogsInitialised();
              break;
            case 'devices':
              renderDeviceTable();
              break;
            case 'keys':
              ensureKeysLoaded();
              break;
            case 'settings':
              ensureSettingsLoaded();
              break;
            case 'insights':
              ensureInsightsReady();
              break;
            case 'overview':
              requestAnimationFrame(() => renderNetworkMap(networkMapActiveDevices));
              break;
            default:
              break;
          }
          if (location.hash === '#map' && viewId !== 'overview-map') {
            const [, mapConfig] = getRouteByViewId('overview-map') || [];
            const destination = mapConfig?.href;
            if (destination && window.location.pathname !== destination) {
              window.location.href = `${destination}${window.location.search}${location.hash}`;
            } else {
              setView('overview-map');
            }
          }
        }

        function ensureLogsInitialised() {
          if (logsState.initialized) { return; }
          logsState.initialized = true;
          refreshDeviceFilters();
          loadActivityLogs();
        }

        function refreshDeviceFilters() {
          if (!Array.isArray(devices) || devices.length === 0) {
            if (logsDeviceKindSelect) {
              logsDeviceKindSelect.innerHTML = '<option value="">All types</option>';
            }
            if (logsDeviceSelect) {
              logsDeviceSelect.innerHTML = '<option value="">All devices</option>';
            }
            if (deviceTypeFilter) {
              deviceTypeFilter.innerHTML = '<option value="">All types</option>';
            }
            return;
          }
          if (logsDeviceKindSelect) {
            const previous = logsDeviceKindSelect.value;
            const kinds = Array.from(new Set(devices
              .map(d => (d.kind || '').trim())
              .filter(Boolean)))
              .sort((a, b) => a.localeCompare(b));
            logsDeviceKindSelect.innerHTML = '<option value="">All types</option>';
            kinds.forEach(kind => {
              const option = document.createElement('option');
              option.value = kind;
              option.textContent = formatKindLabel(kind);
              logsDeviceKindSelect.appendChild(option);
            });
            if (previous && logsDeviceKindSelect.querySelector(`option[value="${previous}"]`)) {
              logsDeviceKindSelect.value = previous;
            }
          }
          if (logsDeviceSelect) {
            const previous = logsDeviceSelect.value;
            logsDeviceSelect.innerHTML = '<option value="">All devices</option>';
            devices.forEach(device => {
              const option = document.createElement('option');
              option.value = String(device.id);
              option.textContent = device.name || device.host || `Device #${device.id}`;
              logsDeviceSelect.appendChild(option);
            });
            if (previous && logsDeviceSelect.querySelector(`option[value="${previous}"]`)) {
              logsDeviceSelect.value = previous;
            }
          }

          // Update device type filter
          if (deviceTypeFilter) {
            const previous = deviceTypeFilter.value;
            const kinds = Array.from(new Set(devices
              .map(d => (d.kind || '').trim())
              .filter(Boolean)))
              .sort((a, b) => a.localeCompare(b));
            deviceTypeFilter.innerHTML = '<option value="">All types</option>';
            kinds.forEach(kind => {
              const option = document.createElement('option');
              option.value = kind;
              option.textContent = formatKindLabel(kind);
              deviceTypeFilter.appendChild(option);
            });
            if (previous && deviceTypeFilter.querySelector(`option[value="${previous}"]`)) {
              deviceTypeFilter.value = previous;
            }
          }
        }

        function applyDeviceFilters() {
          if (!Array.isArray(devices)) {
            filteredDevices = [];
            return;
          }

          const typeFilter = deviceTypeFilter?.value?.trim() || '';
          const statusFilter = deviceStatusFilter?.value?.trim() || '';
          const searchFilter = deviceSearchFilter?.value?.trim().toLowerCase() || '';

          filteredDevices = devices.filter(device => {
            // Type filter
            if (typeFilter && device.kind !== typeFilter) {
              return false;
            }

            // Status filter
            if (statusFilter) {
              const deviceStatus = getDeviceStatus(device);
              if (statusFilter !== deviceStatus) {
                return false;
              }
            }

            // Search filter
            if (searchFilter) {
              const searchableText = [
                device.name || '',
                device.host || '',
                device.kind || '',
                device.platform || ''
              ].join(' ').toLowerCase();

              if (!searchableText.includes(searchFilter)) {
                return false;
              }
            }

            return true;
          });
        }

        async function loadActivityLogs() {
          if (!logsResults) { return; }
          const params = new URLSearchParams();
          params.set('limit', '200');
          const source = logsSourceSelect?.value || 'all';
          if (source && source !== 'all') { params.set('source', source); }
          const deviceKind = logsDeviceKindSelect?.value?.trim();
          if (deviceKind) { params.set('device_kind', deviceKind); }
          const deviceId = logsDeviceSelect?.value?.trim();
          if (deviceId) { params.set('device_id', deviceId); }
          const level = logsLevelSelect?.value?.trim();
          if (level) { params.set('log_level', level); }
          const ipRange = logsIPInput?.value?.trim();
          if (ipRange) { params.set('ip_range', ipRange); }
          const search = logsSearchInput?.value?.trim();
          if (search) { params.set('q', search); }
          logsStatus.textContent = 'Loading activity…';
          logsResults.innerHTML = '';
          try {
            const data = await json(`/api/logs?${params.toString()}`);
            renderActivityLogList(Array.isArray(data) ? data : []);
          } catch (err) {
            logsStatus.textContent = 'Failed to load activity: ' + err.message;
            logsResults.innerHTML = '<div class="empty-state">Unable to load logs.</div>';
          }
        }

        function renderActivityLogList(entries) {
          if (!logsResults) { return; }
          if (!entries || entries.length === 0) {
            logsResults.innerHTML = '<div class="empty-state">No events match the current filters.</div>';
            logsStatus.textContent = 'Showing 0 events.';
            return;
          }
          const fragment = document.createDocumentFragment();
          entries.forEach(entry => {
            const level = (entry.level || '').toString().toLowerCase();
            const levelPill = level ? el('span', { class: `log-level ${level}` }, level) : null;
            const source = (entry.source || '').toString().toLowerCase();
            const sourcePill = source ? el('span', { class: `log-source-pill ${source}` }, source === 'system' ? 'PulseOps' : 'Device') : null;
            const deviceBits = [];
            if (entry.device_name) { deviceBits.push(el('span', { class: 'log-device' }, entry.device_name)); }
            if (entry.device_host) { deviceBits.push(el('span', { class: 'muted' }, entry.device_host)); }
            const meta = el('div', { class: 'log-meta' },
              el('span', {}, formatTimestamp(entry.timestamp || entry.ts)),
              sourcePill,
              levelPill,
              entry.category ? el('span', { class: 'muted' }, entry.category) : null,
              ...deviceBits
            );
            const message = el('div', { class: 'log-message' }, entry.message || '');
            const entryEl = el('div', { class: 'log-entry' }, meta, message);
            if (entry.context && typeof entry.context === 'object') {
              const contextRow = el('div', { class: 'log-context' });
              Object.entries(entry.context).forEach(([key, value]) => {
                contextRow.appendChild(el('span', {}, `${key}: ${value}`));
              });
              entryEl.appendChild(contextRow);
            }
            fragment.appendChild(entryEl);
          });
          logsResults.innerHTML = '';
          logsResults.appendChild(fragment);
          logsStatus.textContent = `Showing ${entries.length} event${entries.length === 1 ? '' : 's'}.`;
        }

        function renderDeviceTable() {
          if (!deviceTableBody) { return; }
          if (Array.isArray(devices)) {
            const validIds = new Set(devices.map(d => d.id));
            Array.from(deviceSelection).forEach(id => {
              if (!validIds.has(id)) { deviceSelection.delete(id); }
            });
          }
          if (!Array.isArray(devices) || devices.length === 0) {
            deviceTableBody.innerHTML = '<tr><td colspan="6" class="muted">No devices available.</td></tr>';
            updateDeviceSelectionUI();
            return;
          }
          const fragment = document.createDocumentFragment();
          devices.forEach(device => {
            const row = document.createElement('tr');
            const idStr = String(device.id);

            const selectCell = document.createElement('td');
            selectCell.style.width = '42px';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.deviceId = idStr;
            checkbox.checked = deviceSelection.has(device.id);
            checkbox.addEventListener('change', () => {
              if (checkbox.checked) {
                deviceSelection.add(device.id);
              } else {
                deviceSelection.delete(device.id);
              }
              updateDeviceSelectionUI();
            });
            selectCell.appendChild(checkbox);

            const nameCell = document.createElement('td');
            nameCell.textContent = device.name || `Device #${device.id}`;

            const hostCell = document.createElement('td');
            hostCell.textContent = device.host || '—';

            const kindCell = document.createElement('td');
            kindCell.textContent = formatKindLabel(device.kind || '');

            const platformCell = document.createElement('td');
            platformCell.textContent = device.platform || '—';

            const userCell = document.createElement('td');
            userCell.textContent = device.user || '—';

            row.append(selectCell, nameCell, hostCell, kindCell, platformCell, userCell);
            fragment.appendChild(row);
          });
          deviceTableBody.innerHTML = '';
          deviceTableBody.appendChild(fragment);
          updateDeviceSelectionUI();
        }

        function updateDeviceSelectionUI() {
          if (deviceExportSelectedBtn) {
            deviceExportSelectedBtn.disabled = deviceSelection.size === 0;
          }
          if (deviceTableMaster) {
            if (!Array.isArray(devices) || devices.length === 0) {
              deviceTableMaster.checked = false;
              deviceTableMaster.indeterminate = false;
            } else {
              let selectedCount = 0;
              devices.forEach(device => {
                if (deviceSelection.has(device.id)) { selectedCount += 1; }
              });
              deviceTableMaster.checked = selectedCount > 0 && selectedCount === devices.length;
              deviceTableMaster.indeterminate = selectedCount > 0 && selectedCount < devices.length;
            }
          }
        }

        function exportDevicesAsJSON(list, filename) {
          if (!list || list.length === 0) {
            showToast({ message: 'Select one or more devices to export.', duration: 4000, type: 'info' });
            return;
          }
          const timestamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
          const candidate = filename || `pulseops-devices-${timestamp}.json`;
          const safeName = candidate.replace(/[:]/g, '-');
          const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = safeName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          showToast({ message: `Exported ${list.length} device${list.length === 1 ? '' : 's'}.`, duration: 4000, type: 'success' });
        }

        async function handleDeviceImportSelection(evt) {
          const input = evt?.target;
          if (!input || !input.files || input.files.length === 0) { return; }
          const file = input.files[0];
          try {
            const contents = await file.text();
            let payload;
            try {
              payload = JSON.parse(contents);
            } catch (parseErr) {
              showToast({ message: 'Import file is not valid JSON.', duration: 6000, type: 'error' });
              return;
            }
            const result = await json('/api/devices/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const importedCount = Number(result?.imported || 0);
            const updatedCount = Number(result?.updated || 0);
            const skippedCount = Number(result?.skipped || 0);
            const summaryParts = [
              `${importedCount} added`,
              `${updatedCount} updated`,
              skippedCount ? `${skippedCount} skipped` : null
            ].filter(Boolean);
            showToast({ message: `Import complete: ${summaryParts.join(', ')}.`, duration: 6000, type: 'success' });
            if (Array.isArray(result?.errors) && result.errors.length > 0) {
              console.warn('Device import warnings', result.errors);
              showToast({ message: `${result.errors.length} entr${result.errors.length === 1 ? 'y' : 'ies'} could not be imported. Check logs for details.`, duration: 6000, type: 'warning' });
            }
            backupCache.clear();
            await loadDevices();
          } catch (err) {
            console.error('Device import failed', err);
            showToast({ message: 'Failed to import devices: ' + err.message, duration: 6000, type: 'error' });
          } finally {
            if (input) { input.value = ''; }
          }
        }

        async function ensureSettingsLoaded() {
          if (!settingsForm || settingsState.loaded || settingsState.isLoading) { return; }
          settingsState.isLoading = true;
          try {
            const data = await json('/api/settings');
            applySettingsToForm(data || {});
            settingsState.loaded = true;
          } catch (err) {
            showToast({ message: 'Failed to load settings: ' + err.message, duration: 6000, type: 'error' });
          } finally {
            settingsState.isLoading = false;
          }
        }

        function applySettingsToForm(data) {
          if (!settingsForm) { return; }
          if (settingsThemeSelect) {
            const theme = data.theme || 'light';
            settingsThemeSelect.value = theme;
            // Apply theme immediately
            if (window.themeManager) {
              window.themeManager.setTheme(theme);
            }
          }
          if (settingsAccountNameInput) { settingsAccountNameInput.value = data.account_name || ''; }
          if (settingsAccountEmailInput) { settingsAccountEmailInput.value = data.account_email || ''; }
          if (settingsEmailEnabled) { settingsEmailEnabled.checked = Boolean(data.email_notifications_enabled); }
          if (settingsEmailHost) { settingsEmailHost.value = data.email_server_host || ''; }
          if (settingsEmailPort) { settingsEmailPort.value = data.email_server_port || 587; }
          if (settingsEmailUsername) { settingsEmailUsername.value = data.email_server_username || ''; }
          if (settingsEmailPassword) { settingsEmailPassword.value = ''; }
          if (settingsEmailClear) { settingsEmailClear.checked = false; }
          if (settingsEmailPasswordNote) {
            const hasPassword = Boolean(data.email_server_password_set);
            settingsEmailPasswordNote.textContent = hasPassword ? 'A password is stored. Provide a new one to replace or tick "Clear".' : 'No password is currently stored.';
            settingsState.passwordSet = hasPassword;
          }
          if (settingsWebEnabled) { settingsWebEnabled.checked = Boolean(data.web_notifications_enabled); }
          updateEmailFieldState();
          if (settingsStatus) { settingsStatus.textContent = ''; }
        }

        function collectSettingsPayload() {
          const payload = {
            theme: settingsThemeSelect?.value || 'light',
            account_name: settingsAccountNameInput?.value?.trim() || '',
            account_email: settingsAccountEmailInput?.value?.trim() || '',
            email_notifications_enabled: !!settingsEmailEnabled?.checked,
            email_server_host: settingsEmailHost?.value?.trim() || '',
            email_server_port: Number(settingsEmailPort?.value) || 587,
            email_server_username: settingsEmailUsername?.value?.trim() || '',
            web_notifications_enabled: !!settingsWebEnabled?.checked
          };
          if (settingsEmailClear?.checked) {
            payload.email_server_password = '';
          } else if (settingsEmailPassword) {
            const pwd = settingsEmailPassword.value.trim();
            if (pwd) { payload.email_server_password = pwd; }
          }
          return payload;
        }

        function updateEmailFieldState() {
          const disabled = !settingsEmailEnabled?.checked;
          [settingsEmailHost, settingsEmailPort, settingsEmailUsername, settingsEmailPassword, settingsEmailClear]
            .filter(Boolean)
            .forEach(input => {
              input.disabled = disabled;
            });
          if (settingsEmailPasswordNote) {
            settingsEmailPasswordNote.classList.toggle('muted', !settingsEmailEnabled?.checked);
          }
        }

        function ensureInsightsReady() {
          refreshInsightsSelector();
          if (insightsState.deviceId) {
            renderInsightsForDevice(insightsState.deviceId);
          } else {
            showInsightsEmpty();
          }
        }

        function refreshInsightsSelector() {
          if (!insightsSelect) { return; }
          const previous = insightsSelect.value;
          const requested = Number.isFinite(insightsState.deviceId) ? String(insightsState.deviceId) : '';
          insightsSelect.innerHTML = '';
          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = 'Select a device…';
          insightsSelect.appendChild(placeholder);
          devices.forEach(device => {
            const option = document.createElement('option');
            option.value = String(device.id);
            option.textContent = device.name || device.host || `Device #${device.id}`;
            insightsSelect.appendChild(option);
          });
          if (previous && insightsSelect.querySelector(`option[value="${previous}"]`)) {
            insightsSelect.value = previous;
            insightsState.deviceId = Number(previous);
          } else if (requested && insightsSelect.querySelector(`option[value="${requested}"]`)) {
            insightsSelect.value = requested;
            insightsState.deviceId = Number(requested);
          } else if (!insightsSelect.value) {
            insightsState.deviceId = null;
          }
          if (insightsRefreshBtn) { insightsRefreshBtn.disabled = !insightsSelect.value; }
        }

        function showInsightsEmpty(message) {
          if (insightsEmpty) {
            insightsEmpty.textContent = message || 'Pick a device to inspect historical metrics and activity.';
            insightsEmpty.classList.remove('hidden');
          }
          if (insightsContent) { insightsContent.classList.add('hidden'); }
          if (insightsDeviceContainer) { insightsDeviceContainer.innerHTML = ''; }
          clearCountdowns('insights');
          if (insightsState.deviceId) {
            clearTaskPoller(insightsState.deviceId, 'insights');
          }
        }

        async function renderInsightsForDevice(deviceId) {
          const previousDeviceId = insightsState.deviceId;
          if (!deviceId || !insightsMeta || !insightsChartCanvas) {
            if (previousDeviceId) {
              destroyDeviceChart(previousDeviceId, 'insights');
              clearTaskPoller(previousDeviceId, 'insights');
            }
            insightsState.deviceId = null;
            showInsightsEmpty();
            return;
          }
          const device = devices.find(d => d.id === deviceId);
          if (!device) {
            insightsState.deviceId = null;
            showInsightsEmpty('Device not found.');
            return;
          }
          if (previousDeviceId && previousDeviceId !== deviceId) {
            destroyDeviceChart(previousDeviceId, 'insights');
            clearTaskPoller(previousDeviceId, 'insights');
            clearContextEntries(deviceHiddenMetricsVisible, 'insights');
            clearContextEntries(metricVisibilityState, 'insights');
            clearContextEntries(deviceHardwareVisible, 'insights');
            clearContextEntries(hardwareAvailabilityState, 'insights');
            clearContextEntries(logExpansionState, 'insights');
            clearContextSet(expandedTaskPanels, 'insights');
          }
          clearCountdowns('insights');
          insightsState.deviceId = deviceId;
          if (insightsRefreshBtn) { insightsRefreshBtn.disabled = false; }
          if (insightsEmpty) {
            insightsEmpty.textContent = 'Loading device insights…';
            insightsEmpty.classList.remove('hidden');
          }
          insightsContent?.classList.add('hidden');
          try {
            if (insightsDeviceContainer) {
              insightsDeviceContainer.innerHTML = '';
              const card = deviceCard(device, 'insights');
              insightsDeviceContainer.appendChild(card);
              const toggle = card.querySelector(`#${deviceContextId(device.id, 'insights', 'logs-toggle')}`);
              if (toggle) {
                toggle.addEventListener('click', () => {
                  const key = deviceContextKey(device.id, 'insights');
                  const current = logExpansionState.get(key) || false;
                  logExpansionState.set(key, !current);
                  loadDeviceLogs(device.id, 'insights');
                });
              }
              if (!device.pending_delete_at) {
                await refreshLatest(device, 'insights');
                await drawDeviceMetrics(device, 'insights');
                await loadDeviceLogs(device.id, 'insights');
              } else {
                loadDeviceLogs(device.id, 'insights');
              }
              loadDeviceTasks(device.id, 'insights');
            }
            insightsMeta.innerHTML = '';
            const metaBits = [
              `Host: ${device.host || 'n/a'}`,
              `Kind: ${formatKindLabel(device.kind || '')}`,
              `Platform: ${device.platform || 'n/a'}`,
              `User: ${device.user || 'n/a'}`
            ];
            metaBits.forEach(text => {
              insightsMeta.appendChild(el('span', {}, text));
            });
            await Promise.all([
              renderInsightsChart(deviceId),
              renderInsightsLogs(deviceId)
            ]);
            insightsContent?.classList.remove('hidden');
            insightsEmpty?.classList.add('hidden');
            insightsEmpty.textContent = 'Pick a device to inspect historical metrics and activity.';
          } catch (err) {
            showInsightsEmpty('Failed to load device insights: ' + err.message);
          }
        }

        let insightsChart = null;

        async function renderInsightsChart(deviceId) {
          if (!insightsChartCanvas) { return; }

          // Destroy any existing Chart.js instance bound to this canvas (handles legacy and module views)
          const chartsToTearDown = new Set();
          if (insightsChart) {
            chartsToTearDown.add(insightsChart);
          }
          if (window.Chart) {
            const addCandidate = (candidate) => {
              if (candidate && typeof candidate.destroy === 'function') {
                chartsToTearDown.add(candidate);
              }
            };
            if (typeof Chart.getChart === 'function') {
              addCandidate(Chart.getChart(insightsChartCanvas));
              if (insightsChartCanvas.id) {
                addCandidate(Chart.getChart(insightsChartCanvas.id));
              }
              const ctx = insightsChartCanvas.getContext?.('2d');
              if (ctx) { addCandidate(Chart.getChart(ctx)); }
            }
            const registry = Chart.instances;
            if (registry) {
              if (registry instanceof Map) {
                registry.forEach((chart) => { if (chart?.canvas === insightsChartCanvas) { addCandidate(chart); } });
              } else if (Array.isArray(registry)) {
                registry.forEach((chart) => { if (chart?.canvas === insightsChartCanvas) { addCandidate(chart); } });
              } else if (typeof registry === 'object') {
                Object.values(registry).forEach((chart) => { if (chart?.canvas === insightsChartCanvas) { addCandidate(chart); } });
              }
            }
          }
          chartsToTearDown.forEach((chart) => {
            try {
              chart.destroy();
            } catch (err) {
              console.debug('Failed to destroy insights chart instance', err?.message || err);
            }
          });
          insightsChart = null;

          const since = new Date(Date.now() - 24 * 3600e3).toISOString();
          const series = await Promise.all(METRIC_SERIES.map(async def => {
            try {
              const rows = await json(`/api/metrics?device_id=${deviceId}&metric=${def.key}&since=${encodeURIComponent(since)}&limit=1440`);
              const points = (rows || []).map(row => {
                const tsRaw = row.ts || row.TS || row.timestamp;
                const value = extractMetricValue(row);
                const ts = tsRaw ? new Date(tsRaw).getTime() : NaN;
                return { ts, value };
              }).filter(point => Number.isFinite(point.ts) && typeof point.value === 'number' && Number.isFinite(point.value));
              return { ...def, points };
            } catch (err) {
              return { ...def, points: [] };
            }
          }));

          insightsChart = createChart(insightsChartCanvas, series);
        }

        async function renderInsightsLogs(deviceId) {
          if (!insightsLogsContainer) { return; }
          insightsLogsContainer.innerHTML = '<div class="muted">Loading activity…</div>';
          try {
            const logs = await json(`/api/device-logs?device_id=${deviceId}&limit=25`);
            if (!Array.isArray(logs) || logs.length === 0) {
              insightsLogsContainer.innerHTML = '<div class="muted">No recent activity.</div>';
              return;
            }
            const fragment = document.createDocumentFragment();
            logs.forEach(entry => {
              const level = (entry.level || '').toString().toLowerCase();
              const meta = el('div', { class: 'log-meta' },
                el('span', {}, formatTimestamp(entry.ts)),
                el('span', { class: `log-level ${level}` }, level || 'info')
              );
              const body = el('div', { class: 'log-message' }, entry.message || '');
              fragment.appendChild(el('div', { class: 'log-entry' }, meta, body));
            });
            insightsLogsContainer.innerHTML = '';
            insightsLogsContainer.appendChild(fragment);
          } catch (err) {
            insightsLogsContainer.innerHTML = `<div class="muted">Failed to load activity: ${escapeHTML(err.message)}</div>`;
          }
        }

        function clearCountdowns(context) {
          if (!context) {
            for (const handle of countdownIntervals.values()) {
              clearInterval(handle);
            }
            countdownIntervals.clear();
            return;
          }
          const ctx = normalizeDeviceContext(context);
          const prefix = `${ctx}:`;
          for (const [key, handle] of Array.from(countdownIntervals.entries())) {
            if (key.startsWith(prefix)) {
              clearInterval(handle);
              countdownIntervals.delete(key);
            }
          }
        }

        function setupCountdown(id, target, statusEl, context = 'grid') {
          if (!target) { return; }
          const deadline = new Date(target).getTime();
          const contextKey = deviceContextKey(id, context);
          const update = () => {
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
              statusEl.textContent = 'Deleting...';
              const handle = countdownIntervals.get(contextKey);
              if (handle) { clearInterval(handle); countdownIntervals.delete(contextKey); }
              return;
            }
            const seconds = Math.ceil(remaining / 1000);
            statusEl.textContent = `Deleting in ${seconds}s`;
          };
          update();
          const interval = setInterval(update, 1000);
          countdownIntervals.set(contextKey, interval);
        }

        function goToInsights(deviceId) {
          const numericId = Number(deviceId);
          const insightsRoute = DASHBOARD_ROUTES.insights;
          if (insightsRoute?.href && window.location.pathname !== insightsRoute.href) {
            const params = {};
            if (Number.isFinite(numericId)) {
              params.deviceId = numericId;
            }
            const destination = buildRouteUrl('insights', params);
            window.location.href = destination;
            return;
          }

          setView('insights');
          if (insightsSelect) {
            insightsSelect.value = Number.isFinite(numericId) ? String(numericId) : '';
          }
          insightsState.deviceId = Number.isFinite(numericId) ? numericId : null;
          if (insightsRefreshBtn) { insightsRefreshBtn.disabled = !Number.isFinite(numericId); }
          if (Number.isFinite(numericId)) {
            renderInsightsForDevice(numericId);
            try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { }
          } else {
            showInsightsEmpty();
          }
        }

        function createDeviceBackupSection(device) {
          const section = el('div', { class: 'device-backup-section' });
          const supportsBackup = BACKUP_SUPPORTED_PLATFORMS.has((device.platform || '').toString().trim().toLowerCase());
          const baseSummary = device.latest_backup_at ? `Last backup ${formatTimestamp(device.latest_backup_at)}` : 'No backups captured yet.';
          const status = el('div', { class: 'backup-status' }, baseSummary);
          const actions = [];
          let runBtn = null;
          if (supportsBackup) {
            runBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Run backup');
            runBtn.addEventListener('click', () => {
              triggerDeviceBackup(device, status, runBtn);
            });
            actions.push(runBtn);
          } else {
            status.textContent = device.latest_backup_at ? `${baseSummary}. Automated backups are not supported for this platform.` : 'Backups not supported for this platform.';
          }
          if (device.latest_backup_id) {
            actions.push(el('a', { class: 'btn btn-link', href: `/api/device-backups/${device.latest_backup_id}`, download: '' }, 'Download latest'));
          }
          const historyBtn = el('button', { type: 'button', class: 'btn btn-outline' }, 'View history');
          historyBtn.addEventListener('click', () => { openBackupModal(device); });
          actions.push(historyBtn);
          section.append(status, el('div', { class: 'backup-action-row' }, ...actions));
          section.supportsBackup = supportsBackup;
          section.statusEl = status;
          section.runButton = runBtn;
          return section;
        }

        function createMetricsSummary(device, context = 'grid') {
          const container = el('div', { class: 'metrics-compact' });
          SUMMARY_METRICS.forEach(def => {
            const item = el('div', { class: 'metric-compact-item', 'data-metric-key': def.key });
            const label = el('div', { class: 'metric-compact-label' }, def.label.replace(' (24h avg)', ''));
            const valueContainer = el('div', { class: 'metric-compact-value', id: deviceContextId(device.id, context, 'metric', def.key) }, '--');
            item.appendChild(label);
            item.appendChild(valueContainer);
            container.appendChild(item);
          });

          // Create toggle container for hidden metrics
          const toggleContainer = el('div', { class: 'metrics-toggle-container', id: deviceContextId(device.id, context, 'metrics-toggle'), style: 'display: none;' });
          const tooltipWrapper = el('div', { class: 'metrics-toggle-tooltip' });
          const toggleBtn = el('button', {
            type: 'button',
            class: 'metrics-toggle-btn',
            id: deviceContextId(device.id, context, 'metrics-toggle-btn')
          }, 'Show hidden metrics');

          const tooltipText = el('div', { class: 'tooltip-text' }, 'Metrics without data are automatically hidden');
          tooltipWrapper.appendChild(toggleBtn);
          tooltipWrapper.appendChild(tooltipText);
          toggleContainer.appendChild(tooltipWrapper);

          toggleBtn.addEventListener('click', () => toggleHiddenMetrics(device.id, context));

          const wrapper = el('div', { class: 'latest-metrics' });
          wrapper.appendChild(container);
          wrapper.appendChild(toggleContainer);
          return wrapper;
        }

        function getDeviceStatus(device) {
          const cached = deviceStatusCache.get(device.id);
          if (cached && Date.now() - cached.timestamp < 30000) {
            return cached.status;
          }

          // Default to unknown
          let status = 'unknown';

          // Check if we have recent ping data
          const pingMetric = hardwareCache.get(device.id)?.metrics?.ping_ms;
          if (pingMetric && pingMetric.value !== null && pingMetric.value !== undefined) {
            const pingAge = Date.now() - new Date(pingMetric.ts).getTime();
            if (pingAge < 5 * 60 * 1000) { // 5 minutes
              status = pingMetric.value < 1000 ? 'online' : 'offline';
            }
          }

          deviceStatusCache.set(device.id, { status, timestamp: Date.now() });
          return status;
        }

        function createDeviceStatusIndicator(device) {
          const status = getDeviceStatus(device);
          const statusText = status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Unknown';
          const indicator = el('div', { class: `device-status-indicator device-status-${status}` });
          const dot = el('div', { class: `device-status-dot ${status}` });
          const text = el('span', {}, statusText);
          indicator.appendChild(dot);
          indicator.appendChild(text);
          return indicator;
        }

        function createHardwareSection(device, context = 'grid') {
          const hardwareSection = el('div', { class: 'hardware-section', id: deviceContextId(device.id, context, 'hardware-section') },
            el('div', { class: 'hardware-header' }, el('h4', {}, 'Hardware Overview')),
            el('div', { class: 'hardware-summary', id: deviceContextId(device.id, context, 'hardware-summary') }, 'Gathering hardware data…'),
            el('div', { class: 'interface-table-wrapper', id: deviceContextId(device.id, context, 'interface-table-wrapper') },
              el('table', { class: 'interface-table', id: deviceContextId(device.id, context, 'interface-table') },
                el('thead', {},
                  el('tr', {},
                    el('th', {}, 'Interface'),
                    el('th', {}, 'Status'),
                    el('th', {}, 'Speed'),
                    el('th', {}, 'RX'),
                    el('th', {}, 'TX'),
                    el('th', {}, 'MAC')
                  )
                ),
                el('tbody', {},
                  el('tr', {},
                    el('td', { colspan: '6', class: 'muted' }, 'Loading interfaces…')
                  )
                )
              )
            )
          );

          // Create toggle container for interfaces
          const interfaceToggleContainer = el('div', {
            class: 'hardware-toggle-container',
            id: deviceContextId(device.id, context, 'interface-toggle'),
            style: 'display: none;'
          });
          const interfaceTooltipWrapper = el('div', { class: 'hardware-toggle-tooltip' });
          const interfaceToggleBtn = el('button', {
            type: 'button',
            class: 'hardware-toggle-btn',
            id: deviceContextId(device.id, context, 'interface-toggle-btn')
          }, 'Show interface table');

          const interfaceTooltipText = el('div', { class: 'tooltip-text' }, 'Interface data is automatically hidden when unavailable');
          interfaceTooltipWrapper.appendChild(interfaceToggleBtn);
          interfaceTooltipWrapper.appendChild(interfaceTooltipText);
          interfaceToggleContainer.appendChild(interfaceTooltipWrapper);

          interfaceToggleBtn.addEventListener('click', () => toggleHardwareInterfaces(device.id, context));

          // Create toggle container for entire hardware section
          const sectionToggleContainer = el('div', {
            class: 'hardware-toggle-container',
            id: deviceContextId(device.id, context, 'hardware-section-toggle'),
            style: 'display: none;'
          });
          const sectionTooltipWrapper = el('div', { class: 'hardware-toggle-tooltip' });
          const sectionToggleBtn = el('button', {
            type: 'button',
            class: 'hardware-toggle-btn',
            id: deviceContextId(device.id, context, 'hardware-section-toggle-btn')
          }, 'Show hardware overview');

          const sectionTooltipText = el('div', { class: 'tooltip-text' }, 'Hardware overview is automatically hidden when no data is available');
          sectionTooltipWrapper.appendChild(sectionToggleBtn);
          sectionTooltipWrapper.appendChild(sectionTooltipText);
          sectionToggleContainer.appendChild(sectionTooltipWrapper);

          sectionToggleBtn.addEventListener('click', () => toggleHardwareSection(device.id, context));

          const wrapper = el('div', { class: 'hardware-wrapper' });
          wrapper.appendChild(hardwareSection);
          wrapper.appendChild(interfaceToggleContainer);
          wrapper.appendChild(sectionToggleContainer);

          return wrapper;
        }

        function deviceCard(d, context = 'grid') {
          const badge = createDeviceBadge(d.kind, d.platform);
          const nameLabel = el('strong', { class: 'device-name' }, d.name || 'Unnamed device');
          const statusIndicator = createDeviceStatusIndicator(d);
          const titleRow = el('div', { class: 'device-title-row' }, badge, nameLabel, statusIndicator);
          const subtitleText = `${d.kind || 'Unknown'} / ${d.platform || 'Unknown'}`;
          const headerInfo = el('div', { class: 'device-header-info' },
            titleRow,
            el('div', { class: 'muted device-subtitle' }, subtitleText)
          );
          const networkLocation = el('div', { class: 'device-network-location', id: deviceContextId(d.id, context, 'network-location') },
            el('span', { class: 'network-location-label' }, 'Network location:'),
            el('span', { class: 'network-location-badge network-location-unknown' }, CLASSIFICATION_LABELS.unknown),
            el('span', { class: 'network-location-detail' }, 'Awaiting classification')
          );
          const btnReboot = el('button', { onClick: () => promptTaskConfirmation(d, 'reboot') }, 'Reboot');
          const btnFW = el('button', { onClick: () => promptTaskConfirmation(d, 'refresh_firewall') }, 'Refresh firewall');
          const btnWi = el('button', { onClick: () => promptTaskConfirmation(d, 'refresh_wireless') }, 'Refresh wireless');
          const btnUndo = el('button', { onClick: () => restoreDevice(d.id) }, 'Undo delete');
          const menu = createDeviceMenu(d, context);
          const includeInsightsButton = normalizeDeviceContext(context) === 'grid';
          const btnInsights = includeInsightsButton ? el('button', { onClick: () => goToInsights(d.id) }, 'View insights') : null;

          const latest = createMetricsSummary(d, context);
          const hardware = createHardwareSection(d, context);
          const logs = el('div', { class: 'device-logs' },
            el('div', { class: 'device-log-header' },
              el('span', {}, 'Activity'),
              el('button', { class: 'device-log-toggle', type: 'button', id: deviceContextId(d.id, context, 'logs-toggle') }, 'See more')
            ),
            el('div', { class: 'device-log-list', id: deviceContextId(d.id, context, 'logs') },
              el('div', { class: 'muted' }, d.pending_delete_at ? 'Logs unavailable while deletion is pending.' : 'Loading activity...')
            )
          );
          const status = el('div', { class: 'muted', id: deviceContextId(d.id, context, 'status') });

          const buttonByTask = {
            reboot: btnReboot,
            refresh_firewall: btnFW,
            refresh_wireless: btnWi
          };
          const availableTasks = getDeviceTasks(d);
          const actionButtons = [];
          let runBackupBtn = null;
          const backupSection = createDeviceBackupSection(d);
          availableTasks.forEach(task => {
            const btn = buttonByTask[task];
            if (btn) { actionButtons.push(btn); }
          });
          if (btnInsights) {
            actionButtons.push(btnInsights);
          }
          if (backupSection.supportsBackup) {
            runBackupBtn = el('button', { type: 'button' }, 'Run backup');
            runBackupBtn.addEventListener('click', () => {
              triggerDeviceBackup(d, backupSection.statusEl, runBackupBtn);
            });
            actionButtons.push(runBackupBtn);
          }
          if (d.pending_delete_at) {
            actionButtons.forEach(btn => { btn.disabled = true; });
            actionButtons.push(btnUndo);
          }
          const actions = el('div', { class: 'row action-flex' }, actionButtons);

          const chartContainer = el('div', { class: 'chart-container' });
          const chart = el('canvas', { id: deviceContextId(d.id, context, 'c') });
          const chartLoading = el('div', { class: 'chart-loading' }, 'Loading chart...');
          chartContainer.appendChild(chart);
          chartContainer.appendChild(chartLoading);
          const chartSection = el('div', { class: 'metric-chart' }, chartContainer);

          const taskSection = el('div', { class: 'task-section' },
            el('h4', {}, 'Recent tasks'),
            el('div', { class: 'task-list', id: deviceContextId(d.id, context, 'tasks') }, el('div', { class: 'muted' }, 'Loading tasks...'))
          );

          const cardClasses = ['card'];
          if (normalizeDeviceContext(context) !== 'grid') {
            cardClasses.push('card-insights');
          }
          const card = el('div', { class: cardClasses.join(' '), id: deviceContextId(d.id, context, 'device') },
            el('div', { class: 'row device-header' }, headerInfo, menu),
            el('div', { class: 'mono' }, d.host),
            networkLocation,
            el('div', { style: 'height:.4rem' }),
            backupSection,
            latest,
            hardware,
            logs,
            status,
            chartSection,
            el('div', { style: 'height:.6rem' }),
            actions,
            taskSection
          );

          if (d.pending_delete_at) {
            setupCountdown(d.id, d.pending_delete_at, status, context);
          } else {
            status.textContent = '';
          }

          return card;
        }

        async function triggerDeviceBackup(device, statusEl, runBtn) {
          if (!device || !device.id) { return; }
          if (runBtn) {
            runBtn.disabled = true;
            runBtn.textContent = 'Running…';
          }
          if (statusEl) { statusEl.textContent = 'Requesting backup…'; }
          try {
            const payload = { device_id: device.id };
            const result = await json('/api/device-backups', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const deviceLabel = device.name || device.host || `Device #${device.id}`;
            showToast({ message: `Backup stored for ${deviceLabel}.`, duration: 6000, type: 'success' });
            if (statusEl) { statusEl.textContent = 'Backup stored. Refreshing…'; }
            backupCache.delete(device.id);
            devices = Array.isArray(devices) ? devices.map(entry => {
              if (entry.id === device.id) {
                return { ...entry, latest_backup_at: result?.created_at, latest_backup_id: result?.id };
              }
              return entry;
            }) : devices;
            renderDevices();
            renderDeviceTable();
            if (backupState.isOpen && backupState.deviceId === device.id) {
              loadBackupHistory(device.id, true);
            }
            if (viewState.current === 'insights' && insightsState.deviceId === device.id) {
              renderInsightsForDevice(device.id);
            }
          } catch (err) {
            console.error('Backup request failed', err);
            if (statusEl) { statusEl.textContent = 'Backup failed: ' + err.message; }
            showToast({ message: 'Failed to capture backup: ' + err.message, duration: 6000, type: 'error' });
          } finally {
            if (runBtn) {
              runBtn.disabled = false;
              runBtn.textContent = 'Run backup';
            }
          }
        }

        function openBackupModal(device) {
          if (!backupModal) { return; }
          backupState.deviceId = device?.id || null;
          backupState.deviceName = device?.name || device?.host || (device?.id ? `Device #${device.id}` : 'device');
          backupState.isOpen = true;
          if (backupModalTitle) { backupModalTitle.textContent = `Backups for ${backupState.deviceName}`; }
          if (backupModalStatus) { backupModalStatus.textContent = 'Loading backups…'; }
          if (backupModalList) { backupModalList.innerHTML = ''; }
          backupModal.classList.remove('hidden');
          if (device?.id) {
            loadBackupHistory(device.id);
          }
        }

        function closeBackupModal() {
          if (!backupModal) { return; }
          backupModal.classList.add('hidden');
          backupState.isOpen = false;
        }

        async function loadBackupHistory(deviceId, forceReload = false) {
          if (!deviceId) { return; }
          if (backupModalStatus) { backupModalStatus.textContent = 'Loading backups…'; }
          if (backupModalList) { backupModalList.innerHTML = ''; }
          let cache = backupCache.get(deviceId);
          if (!cache || forceReload) {
            try {
              const items = await json(`/api/device-backups?device_id=${deviceId}`);
              cache = { items: Array.isArray(items) ? items : [] };
              backupCache.set(deviceId, cache);
            } catch (err) {
              console.error('Failed to load backup history', err);
              if (backupModalStatus) { backupModalStatus.textContent = 'Failed to load backups: ' + err.message; }
              return;
            }
          }
          renderBackupHistory(cache.items || []);
        }

        function renderBackupHistory(items) {
          if (!backupModalList) { return; }
          backupModalList.innerHTML = '';
          if (!Array.isArray(items) || items.length === 0) {
            if (backupModalStatus) { backupModalStatus.textContent = 'No backups available yet.'; }
            backupModalList.appendChild(el('div', { class: 'backup-empty' }, 'Run a backup to capture the current configuration.'));
            return;
          }
          if (backupModalStatus) { backupModalStatus.textContent = `Showing ${items.length} backup${items.length === 1 ? '' : 's'}.`; }
          const fragment = document.createDocumentFragment();
          items.forEach((entry, index) => {
            const created = formatTimestamp(entry.created_at || entry.createdAt || entry.created || '');
            const size = formatFileSize(entry.size_bytes ?? entry.size ?? 0);
            const meta = el('div', { class: 'backup-history-meta' },
              el('strong', {}, created),
              el('span', { class: 'muted-sm' }, `Size: ${size}`),
              el('span', { class: 'muted-xs' }, `Backup #${entry.id}`)
            );
            if (index === 0) {
              meta.appendChild(el('span', { class: 'badge badge-latest' }, 'Latest'));
            }
            const download = el('a', { class: 'btn btn-link', href: `/api/device-backups/${entry.id}`, download: '' }, 'Download');
            const row = el('div', { class: 'backup-history-row' }, meta, el('div', { class: 'backup-history-actions' }, download));
            fragment.appendChild(row);
          });
          backupModalList.appendChild(fragment);
        }

        function createDeviceMenu(device, context = 'grid') {
          const menuList = el('div', { class: 'menu-list hidden', role: 'menu' });
          if (normalizeDeviceContext(context) === 'grid') {
            const insightsItem = el('button', {
              type: 'button', class: 'menu-item', onClick: (evt) => {
                evt.stopPropagation();
                closeOpenMenu();
                goToInsights(device.id);
              }
            }, 'Insights');
            menuList.appendChild(insightsItem);
          }
          const editItem = el('button', {
            type: 'button', class: 'menu-item', onClick: (evt) => {
              evt.stopPropagation();
              closeOpenMenu();
              editDevice(device.id);
            }
          }, 'Edit');
          menuList.appendChild(editItem);
          if (!device.pending_delete_at) {
            const deleteItem = el('button', {
              type: 'button', class: 'menu-item danger', onClick: (evt) => {
                evt.stopPropagation();
                closeOpenMenu();
                promptDeleteDevice(device.id);
              }
            }, 'Delete');
            menuList.appendChild(deleteItem);
          }
          const trigger = el('button', { class: 'menu-trigger', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': 'Device options' }, '⋯');
          trigger.addEventListener('click', (evt) => {
            evt.stopPropagation();
            toggleDeviceMenu(trigger, menuList);
          });
          const wrapper = el('div', { class: 'menu-wrapper' }, trigger, menuList);
          return wrapper;
        }

        async function refreshLatest(device, context = 'grid') {
          if (device.pending_delete_at) { return; }
          const sinceISO = new Date(Date.now() - 24 * 3600e3).toISOString();
          const hardwareState = ensureHardwareState(device.id);
          const tasks = SUMMARY_METRICS.map(async (def) => {
            const cell = document.getElementById(deviceContextId(device.id, context, 'metric', def.key));
            if (!cell) { return; }
            try {
              if (def.aggregation === 'avg') {
                const hours = Number(def.lookbackHours) > 0 ? Number(def.lookbackHours) : 24;
                const limit = Math.max(60, Math.round(hours * 60));
                const [avg, latestEntry] = await Promise.all([
                  fetchMetricAverage(device.id, def.key, sinceISO, limit),
                  fetchLatestMetricEntry(device.id, def.key)
                ]);
                hardwareState.metrics[def.key] = latestEntry || null;
                const formattedValue = def.formatter(avg, null);
                const parts = formattedValue.split(' ');
                if (parts.length > 1) {
                  const value = parts[0];
                  const unit = parts.slice(1).join(' ');
                  cell.innerHTML = `${value}<span class="metric-compact-unit">${unit}</span>`;
                } else {
                  cell.textContent = formattedValue;
                }
              } else {
                const entry = await fetchLatestMetricEntry(device.id, def.key);
                hardwareState.metrics[def.key] = entry || null;
                const value = entry ? entry.value : null;
                const formattedValue = def.formatter(value, entry);
                const parts = formattedValue.split(' ');
                if (parts.length > 1) {
                  const valueText = parts[0];
                  const unit = parts.slice(1).join(' ');
                  cell.innerHTML = `${valueText}<span class="metric-compact-unit">${unit}</span>`;
                } else {
                  cell.textContent = formattedValue;
                }
              }
            } catch (err) {
              cell.textContent = 'n/a';
            }
          });
          tasks.push(updateNetworkClassification(device, context));
          await Promise.allSettled(tasks);
          await updateHardwareSnapshot(device.id, context);

          // Update metric visibility after refreshing values (with small delay to ensure DOM is updated)
          setTimeout(() => updateMetricVisibility(device.id, context), 50);
        }

        async function updateNetworkClassification(device, context = 'grid') {
          if (!device || !device.id) { return; }
          const containerId = deviceContextId(device.id, context, 'network-location');
          const container = document.getElementById(containerId);
          if (!container) { return; }
          const state = ensureHardwareState(device.id);
          try {
            const entry = await fetchLatestMetricEntry(device.id, 'network_classification');
            state.metrics['network_classification'] = entry || null;
            renderNetworkClassification(device.id, entry, undefined, context);
          } catch (err) {
            renderNetworkClassification(device.id, null, err, context);
          }
        }

        function renderNetworkClassification(deviceId, entry, error, context = 'grid') {
          const container = document.getElementById(deviceContextId(deviceId, context, 'network-location'));
          if (!container) { return; }
          container.innerHTML = '';
          container.appendChild(el('span', { class: 'network-location-label' }, 'Network location:'));
          if (error) {
            container.appendChild(el('span', { class: 'network-location-badge network-location-unknown' }, CLASSIFICATION_LABELS.unknown));
            container.appendChild(el('span', { class: 'network-location-detail' }, 'Unable to load network location'));
            return;
          }
          const info = describeNetworkClassification(entry);
          container.appendChild(el('span', { class: `network-location-badge network-location-${info.category}` }, info.label));
          const detailText = info.detail || (info.category === 'unknown' ? 'Awaiting classification' : '');
          if (detailText) {
            container.appendChild(el('span', { class: 'network-location-detail' }, detailText));
          }
        }

        function describeNetworkClassification(entry) {
          const raw = entry ? (parseMetricRaw(entry) || {}) : {};
          const category = normalizeClassification(raw.classification || raw.Classification || entry?.classification || entry?.value);
          const label = CLASSIFICATION_LABELS[category] || CLASSIFICATION_LABELS.unknown;
          const detailParts = [];
          const matchedSubnet = raw.matched_subnet || raw.MatchedSubnet;
          if (matchedSubnet) {
            detailParts.push(`Subnet ${matchedSubnet}`);
          }
          const ip = raw.ip || raw.IP;
          if (ip) {
            const isPrivate = raw.private ?? raw.Private;
            const prefix = isPrivate ? 'Private IP' : 'IP';
            detailParts.push(`${prefix} ${ip}`);
          }
          const reasonKey = normalizeReason(raw.reason || raw.Reason);
          const reasonText = reasonKey && CLASSIFICATION_REASON_TEXT[reasonKey] ? CLASSIFICATION_REASON_TEXT[reasonKey] : '';
          if (reasonText) {
            detailParts.push(reasonText);
          }
          return {
            category,
            label,
            detail: detailParts.filter(Boolean).join(' · ')
          };
        }

        function normalizeClassification(value) {
          if (value == null) {
            return 'unknown';
          }
          const normalized = value.toString().trim().toLowerCase();
          if (normalized === 'lan' || normalized === 'local_vlan' || normalized === 'remote') {
            return normalized;
          }
          return 'unknown';
        }

        function normalizeReason(value) {
          if (value == null) {
            return 'unspecified';
          }
          return value.toString().trim().toLowerCase();
        }

        function updateMetricVisibility(deviceId, context = 'grid') {
          const card = document.getElementById(deviceContextId(deviceId, context, 'device'));
          const metricsContainer = card?.querySelector('.metrics-compact');
          const toggleContainer = document.getElementById(deviceContextId(deviceId, context, 'metrics-toggle'));
          const toggleBtn = document.getElementById(deviceContextId(deviceId, context, 'metrics-toggle-btn'));

          if (!metricsContainer || !toggleContainer || !toggleBtn) return;

          const hiddenMetrics = new Set();
          const contextKey = deviceContextKey(deviceId, context);
          const isDeviceHiddenVisible = deviceHiddenMetricsVisible.get(contextKey) || false;

          // Check each metric to see if it only shows "n/a"
          SUMMARY_METRICS.forEach(def => {
            const cell = document.getElementById(deviceContextId(deviceId, context, 'metric', def.key));
            const metricItem = metricsContainer.querySelector(`[data-metric-key="${def.key}"]`);

            if (cell && metricItem) {
              const isNa = cell.textContent.trim() === 'n/a' || cell.textContent.trim() === '--';

              if (isNa) {
                hiddenMetrics.add(def.key);
                // Hide/show based on this device's toggle state
                if (isDeviceHiddenVisible) {
                  metricItem.classList.remove('metric-hidden');
                } else {
                  metricItem.classList.add('metric-hidden');
                }
              } else {
                metricItem.classList.remove('metric-hidden');
              }
            }
          });

          // Store the hidden metrics for this device
          metricVisibilityState.set(contextKey, hiddenMetrics);

          // Show/hide the toggle button
          if (hiddenMetrics.size > 0) {
            toggleContainer.style.display = 'block';
            if (isDeviceHiddenVisible) {
              toggleBtn.textContent = 'Hide metrics without data';
            } else {
              const hiddenCount = hiddenMetrics.size;
              toggleBtn.textContent = `Show ${hiddenCount} hidden metric${hiddenCount > 1 ? 's' : ''}`;
            }
          } else {
            toggleContainer.style.display = 'none';
          }
        }

        function toggleHiddenMetrics(deviceId, context = 'grid') {
          // Toggle the visibility state for this specific device
          const contextKey = deviceContextKey(deviceId, context);
          const currentState = deviceHiddenMetricsVisible.get(contextKey) || false;
          deviceHiddenMetricsVisible.set(contextKey, !currentState);

          // Update only this device
          updateMetricVisibility(deviceId, context);
        }

        function updateHardwareVisibility(deviceId, context = 'grid') {
          const hardwareSection = document.getElementById(deviceContextId(deviceId, context, 'hardware-section'));
          const interfaceWrapper = document.getElementById(deviceContextId(deviceId, context, 'interface-table-wrapper'));
          const interfaceToggleContainer = document.getElementById(deviceContextId(deviceId, context, 'interface-toggle'));
          const interfaceToggleBtn = document.getElementById(deviceContextId(deviceId, context, 'interface-toggle-btn'));
          const sectionToggleContainer = document.getElementById(deviceContextId(deviceId, context, 'hardware-section-toggle'));
          const sectionToggleBtn = document.getElementById(deviceContextId(deviceId, context, 'hardware-section-toggle-btn'));

          if (!hardwareSection || !interfaceWrapper || !interfaceToggleContainer || !sectionToggleContainer) return;

          const contextKey = deviceContextKey(deviceId, context);
          const availability = hardwareAvailabilityState.get(contextKey) || { hasInterfaces: false, hasHardwareInfo: false };
          const visibility = deviceHardwareVisible.get(contextKey) || { interfaces: false, section: false };

          // Handle interface table visibility
          if (availability.hasInterfaces) {
            // Interfaces are available - show them and hide toggle
            interfaceWrapper.classList.remove('interface-hidden');
            interfaceToggleContainer.style.display = 'none';
          } else {
            // No interfaces available
            if (visibility.interfaces) {
              // User wants to see the empty table
              interfaceWrapper.classList.remove('interface-hidden');
              interfaceToggleContainer.style.display = 'block';
              interfaceToggleBtn.textContent = 'Hide interface table';
            } else {
              // Hide the empty table
              interfaceWrapper.classList.add('interface-hidden');
              interfaceToggleContainer.style.display = 'block';
              interfaceToggleBtn.textContent = 'Show interface table';
            }
          }

          // Handle entire hardware section visibility
          if (availability.hasHardwareInfo || availability.hasInterfaces) {
            // Some hardware data is available - show section and hide section toggle
            hardwareSection.classList.remove('hardware-hidden');
            sectionToggleContainer.style.display = 'none';
          } else {
            // No hardware data available
            if (visibility.section) {
              // User wants to see the empty section
              hardwareSection.classList.remove('hardware-hidden');
              sectionToggleContainer.style.display = 'block';
              sectionToggleBtn.textContent = 'Hide hardware overview';
            } else {
              // Hide the empty section
              hardwareSection.classList.add('hardware-hidden');
              sectionToggleContainer.style.display = 'block';
              sectionToggleBtn.textContent = 'Show hardware overview';
            }
          }
        }

        function toggleHardwareInterfaces(deviceId, context = 'grid') {
          const contextKey = deviceContextKey(deviceId, context);
          const currentVisibility = deviceHardwareVisible.get(contextKey) || { interfaces: false, section: false };
          currentVisibility.interfaces = !currentVisibility.interfaces;
          deviceHardwareVisible.set(contextKey, currentVisibility);
          updateHardwareVisibility(deviceId, context);
        }

        function toggleHardwareSection(deviceId, context = 'grid') {
          const contextKey = deviceContextKey(deviceId, context);
          const currentVisibility = deviceHardwareVisible.get(contextKey) || { interfaces: false, section: false };
          currentVisibility.section = !currentVisibility.section;
          deviceHardwareVisible.set(contextKey, currentVisibility);
          updateHardwareVisibility(deviceId, context);
        }

        function ensureHardwareState(deviceId) {
          let state = hardwareCache.get(deviceId);
          if (!state) {
            state = { metrics: {}, info: null, interfaces: null, fetchedAt: 0, loading: null, error: null };
            hardwareCache.set(deviceId, state);
          }
          return state;
        }

        async function updateHardwareSnapshot(deviceId, context = 'grid') {
          const state = ensureHardwareState(deviceId);
          const now = Date.now();
          if (state.loading) {
            try { await state.loading; } catch (_) { }
          }
          const shouldRefresh = !state.info || !state.interfaces || (now - state.fetchedAt) > 60000;
          if (shouldRefresh) {
            state.loading = (async () => {
              try {
                const [info, interfaces] = await Promise.all([
                  fetchLatestMetricEntry(deviceId, 'hardware_info'),
                  fetchLatestMetricEntry(deviceId, 'interface_stats')
                ]);
                if (info) { state.info = info; }
                if (interfaces) { state.interfaces = interfaces; }
                state.error = null;
              } catch (err) {
                state.error = err;
              } finally {
                state.fetchedAt = Date.now();
              }
            })();
            try { await state.loading; } catch (_) { }
            state.loading = null;
          }
          renderHardwareSection(deviceId, state, context);
        }

        function parseMetricRaw(entry) {
          if (!entry) { return null; }
          const raw = entry.raw ?? entry.Raw;
          if (typeof raw === 'string' && raw.trim()) {
            try { return JSON.parse(raw); }
            catch (_) { return null; }
          }
          return null;
        }

        function renderHardwareSection(deviceId, state, context = 'grid') {
          const summaryEl = document.getElementById(deviceContextId(deviceId, context, 'hardware-summary'));
          let hasHardwareInfo = false;

          if (summaryEl) {
            summaryEl.innerHTML = '';
            const info = parseMetricRaw(state.info) || {};
            const memory = parseMetricRaw(state.metrics['memory_used_percent']);
            const disk = parseMetricRaw(state.metrics['disk_used_percent']);
            const uptimeValue = state.metrics['uptime_seconds']?.value ?? null;
            const bits = [];
            if (info.hostname) { bits.push(`Hostname: ${info.hostname}`); }
            if (info.model) { bits.push(`Model: ${info.model}`); }
            if (info.cpu_model) {
              const cores = info.cpu_cores ? ` (${info.cpu_cores} cores)` : '';
              bits.push(`CPU: ${info.cpu_model}${cores}`);
            }
            if (info.os) { bits.push(info.os); }
            if (info.kernel) { bits.push(info.kernel); }
            if (uptimeValue != null) { bits.push(`Uptime: ${formatDuration(uptimeValue)}`); }
            if (memory && Number.isFinite(Number(memory.total_bytes))) {
              const freeMem = Number(memory.available_bytes ?? memory.free_bytes ?? 0);
              bits.push(`Memory: ${formatFileSize(memory.total_bytes)} total, ${formatFileSize(freeMem)} free`);
            }
            if (disk && Number.isFinite(Number(disk.total_bytes))) {
              const freeDisk = Number(disk.free_bytes ?? 0);
              bits.push(`Storage: ${formatFileSize(disk.total_bytes)} total, ${formatFileSize(freeDisk)} free`);
            }

            hasHardwareInfo = bits.length > 0;

            if (bits.length === 0) {
              if (state.error) {
                summaryEl.textContent = `Hardware data unavailable: ${state.error?.message || state.error}`;
              } else {
                summaryEl.textContent = 'Hardware details unavailable.';
              }
            } else {
              bits.forEach(text => {
                summaryEl.appendChild(el('span', { class: 'hardware-pill' }, text));
              });
            }
          }

          const table = document.getElementById(deviceContextId(deviceId, context, 'interface-table'));
          let hasInterfaces = false;

          if (table) {
            const tbody = table.querySelector('tbody');
            if (tbody) {
              const data = parseMetricRaw(state.interfaces);
              hasInterfaces = Array.isArray(data) && data.length > 0;

              if (!hasInterfaces) {
                tbody.innerHTML = '<tr><td colspan="6" class="muted">No interface data available.</td></tr>';
              } else {
                const fragment = document.createDocumentFragment();
                data.forEach((iface) => {
                  const status = formatInterfaceStatus(iface.oper_state || iface.operState || '');
                  const speedValue = Number(iface.speed_mbps ?? iface.speedMbps);
                  const speedText = Number.isFinite(speedValue) ? `${speedValue} Mbps` : 'n/a';
                  const rxBytes = Number(iface.rx_bytes ?? iface.rxBytes ?? 0);
                  const txBytes = Number(iface.tx_bytes ?? iface.txBytes ?? 0);
                  const rxPackets = Number(iface.rx_packets ?? iface.rxPackets ?? 0);
                  const txPackets = Number(iface.tx_packets ?? iface.txPackets ?? 0);
                  const rxPacketText = Number.isFinite(rxPackets) && rxPackets > 0 ? ` (${rxPackets} pkts)` : '';
                  const txPacketText = Number.isFinite(txPackets) && txPackets > 0 ? ` (${txPackets} pkts)` : '';
                  fragment.appendChild(el('tr', {},
                    el('td', {}, iface.name || iface.Name || '--'),
                    el('td', { class: `status-pill ${status.className}` }, status.label),
                    el('td', {}, speedText),
                    el('td', {}, `${formatFileSize(rxBytes)}${rxPacketText}`),
                    el('td', {}, `${formatFileSize(txBytes)}${txPacketText}`),
                    el('td', {}, iface.mac_address || iface.macAddress || '--')
                  ));
                });
                tbody.innerHTML = '';
                tbody.appendChild(fragment);
              }
            }
          }

          // Update hardware availability state
          hardwareAvailabilityState.set(deviceContextKey(deviceId, context), {
            hasInterfaces: hasInterfaces,
            hasHardwareInfo: hasHardwareInfo
          });

          // Update hardware visibility with a small delay to ensure DOM is updated
          setTimeout(() => updateHardwareVisibility(deviceId, context), 50);
        }

        function formatInterfaceStatus(value) {
          const normalized = String(value || '').toLowerCase();
          switch (normalized) {
            case 'up':
              return { label: 'Up', className: 'up' };
            case 'down':
              return { label: 'Down', className: 'down' };
            case 'unknown':
              return { label: 'Unknown', className: 'unknown' };
            default:
              if (!normalized) { return { label: 'Unknown', className: 'unknown' }; }
              return { label: normalized.charAt(0).toUpperCase() + normalized.slice(1), className: 'unknown' };
          }
        }

        async function runTask(device_id, kind) {
          const label = TASK_LABELS[kind] || kind;
          try {
            const res = await json('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id, kind, by: 'web' }) });
            showToast({ message: `${label} queued (#${res.enqueued}).`, duration: 5000, type: 'success' });
            await loadDeviceTasks(device_id, 'grid');
            if (insightsState.deviceId === device_id) {
              await loadDeviceTasks(device_id, 'insights');
            }
          } catch (e) {
            console.error('Failed to enqueue task', e);
            showToast({ message: `Failed to enqueue ${label}: ${e.message}`, duration: 6000, type: 'error' });
          }
        }

        function renderDeviceLogs(container, logs, expanded) {
          if (!logs || logs.length === 0) {
            container.innerHTML = '<div class="muted">No recent activity.</div>';
            return;
          }
          const fragment = document.createDocumentFragment();
          const limit = expanded ? logs.length : 1;
          logs.slice(0, limit).forEach(entry => {
            const timeText = formatLogTime(entry.ts);
            const level = (entry.level || 'info').slice(0, 12);
            const message = truncateText(entry.message || '', 160);
            const levelSpan = el('span', { class: 'device-log-level' }, level);
            const messageSpan = el('span', { class: 'device-log-message' }, message);
            const row = el('div', { class: 'device-log-entry' },
              el('div', { class: 'device-log-time' }, timeText),
              el('div', { class: 'device-log-body' }, levelSpan, messageSpan)
            );
            fragment.appendChild(row);
          });
          container.innerHTML = '';
          container.appendChild(fragment);
        }

        async function loadDeviceLogs(deviceId, context = 'grid') {
          const container = document.getElementById(deviceContextId(deviceId, context, 'logs'));
          const toggle = document.getElementById(deviceContextId(deviceId, context, 'logs-toggle'));
          if (!container) { return; }
          try {
            const logs = await json(`/api/device-logs?device_id=${deviceId}&limit=5`);
            if (Array.isArray(logs)) {
              const contextKey = deviceContextKey(deviceId, context);
              const expanded = logExpansionState.get(contextKey) || false;
              renderDeviceLogs(container, logs, expanded);
              if (toggle) {
                toggle.textContent = expanded ? 'See less' : 'See more';
              }
            } else {
              renderDeviceLogs(container, [], false);
              if (toggle) { toggle.textContent = 'See more'; }
            }
          } catch (err) {
            container.innerHTML = '<div class="muted">Unable to load activity.</div>';
            if (toggle) { toggle.textContent = 'See more'; }
          }
        }

        function showToast(options) {
          if (!toastContainer) { return { dismiss: () => { } }; }
          const { message, actionText, onAction, dismissText = 'Dismiss', countdownSeconds, type } = options;
          const hasCountdown = typeof countdownSeconds === 'number' && countdownSeconds > 0;
          const duration = options.duration ?? (hasCountdown ? countdownSeconds * 1000 : 5000);
          const toast = el('div', { class: 'toast' });
          if (type) { toast.classList.add(type); }
          const messageSpan = el('span', {});
          toast.appendChild(messageSpan);
          let remainingSeconds = hasCountdown ? Math.round(countdownSeconds) : 0;
          const isMessageFn = typeof message === 'function';
          function renderMessage() {
            if (isMessageFn) {
              messageSpan.textContent = message(Math.max(0, remainingSeconds));
            } else if (hasCountdown) {
              messageSpan.textContent = `${message} (${Math.max(0, remainingSeconds)}s)`;
            } else {
              messageSpan.textContent = message;
            }
          }
          renderMessage();
          let countdownInterval;
          if (hasCountdown) {
            countdownInterval = setInterval(() => {
              remainingSeconds -= 1;
              if (remainingSeconds <= 0) {
                remainingSeconds = 0;
                renderMessage();
                clearInterval(countdownInterval);
                countdownInterval = undefined;
              } else {
                renderMessage();
              }
            }, 1000);
          }
          let dismissed = false;
          function dismiss() {
            if (dismissed) { return; }
            dismissed = true;
            clearTimeout(timeoutId);
            if (countdownInterval) { clearInterval(countdownInterval); }
            toast.remove();
          }
          if (actionText && typeof onAction === 'function') {
            const actionBtn = el('button', { type: 'button' }, actionText);
            actionBtn.addEventListener('click', async (evt) => {
              evt.stopPropagation();
              try {
                const result = await onAction(dismiss);
                if (result !== false) { dismiss(); }
              } catch (err) {
                console.error('Toast action failed', err);
              }
            });
            toast.appendChild(actionBtn);
          }
          const dismissBtn = el('button', { type: 'button' }, dismissText);
          dismissBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            dismiss();
          });
          toast.appendChild(dismissBtn);
          toastContainer.appendChild(toast);
          const timeoutId = setTimeout(dismiss, duration);
          return { dismiss, renderMessage };
        }

        function getTaskStatusClass(status) {
          switch ((status || '').toLowerCase()) {
            case 'queued': return 'status-queued';
            case 'running': return 'status-running';
            case 'done': return 'status-done';
            case 'error': return 'status-error';
            default: return 'status-queued';
          }
        }

        function formatTaskStatus(status) {
          switch ((status || '').toLowerCase()) {
            case 'queued': return 'Queued';
            case 'running': return 'Running';
            case 'done': return 'Completed';
            case 'error': return 'Error';
            default: return status || 'Unknown';
          }
        }

        function formatTaskOutput(output) {
          if (!output) { return ''; }
          const trimmed = output.trim();
          if (!trimmed) { return ''; }
          const lines = trimmed.split(/\r?\n/).filter(Boolean);
          if (lines.length > 3) {
            return lines.slice(-3).join('\n');
          }
          return lines.join('\n');
        }

        function clearTaskPoller(deviceId, context = 'grid') {
          const existing = taskRefreshTimers.get(deviceContextKey(deviceId, context));
          if (existing) {
            clearTimeout(existing);
            taskRefreshTimers.delete(deviceContextKey(deviceId, context));
          }
        }

        function scheduleTaskRefresh(deviceId, tasks, context = 'grid') {
          clearTaskPoller(deviceId, context);
          if (Array.isArray(tasks) && tasks.some(t => {
            const status = (t.status || '').toLowerCase();
            return status === 'queued' || status === 'running';
          })) {
            const timer = setTimeout(() => {
              loadDeviceTasks(deviceId, context);
            }, 5000);
            taskRefreshTimers.set(deviceContextKey(deviceId, context), timer);
          }
        }

        const taskLoadErrors = new Set();

        async function loadDeviceTasks(deviceId, context = 'grid') {
          try {
            const list = await json(`/api/tasks?device_id=${deviceId}`);
            deviceTasks.set(deviceId, list);
            taskLoadErrors.delete(deviceId);
            renderTaskList(deviceId, context);
            scheduleTaskRefresh(deviceId, list, context);
          } catch (err) {
            console.error(`Failed to load tasks for ${deviceId}`, err);
            const container = document.getElementById(deviceContextId(deviceId, context, 'tasks'));
            if (container) { container.innerHTML = '<div class="muted">Failed to load tasks.</div>'; }
            if (!taskLoadErrors.has(deviceId)) {
              taskLoadErrors.add(deviceId);
              showToast({ message: `Failed to load tasks: ${err.message}`, duration: 6000, type: 'error' });
            }
          }
        }

        function renderTaskList(deviceId, context = 'grid') {
          const container = document.getElementById(deviceContextId(deviceId, context, 'tasks'));
          if (!container) { return; }
          const tasks = deviceTasks.get(deviceId) || [];
          if (tasks.length === 0) {
            container.innerHTML = '<div class="muted">No tasks yet.</div>';
            return;
          }
          const contextKey = deviceContextKey(deviceId, context);
          if (tasks.length <= TASK_PREVIEW_LIMIT && expandedTaskPanels.has(contextKey)) {
            expandedTaskPanels.delete(contextKey);
          }
          const isExpanded = expandedTaskPanels.has(contextKey);
          const limit = isExpanded ? TASK_EXPANDED_LIMIT : TASK_PREVIEW_LIMIT;
          const visible = tasks.slice(0, limit);
          container.innerHTML = '';
          visible.forEach(task => {
            const statusClass = getTaskStatusClass(task.status);
            const statusLabel = formatTaskStatus(task.status);
            const title = `${TASK_LABELS[task.kind] || task.kind}`;
            const requestedAt = formatTimestamp(task.requested_at);
            const item = document.createElement('div');
            item.className = 'task-item';
            const meta = document.createElement('div');
            meta.className = 'task-meta';
            const metaText = document.createElement('div');
            metaText.innerHTML = `<strong>${escapeHTML(title)}</strong><div class="muted muted-xs">${escapeHTML(requestedAt)}</div>`;
            const statusPill = document.createElement('span');
            statusPill.className = `status-pill ${statusClass}`;
            statusPill.textContent = statusLabel;
            meta.appendChild(metaText);
            meta.appendChild(statusPill);
            item.appendChild(meta);
            const snippet = formatTaskOutput(task.output);
            if (snippet) {
              const outputEl = document.createElement('div');
              outputEl.className = 'task-output';
              outputEl.textContent = snippet;
              item.appendChild(outputEl);
            }
            container.appendChild(item);
          });
          if (tasks.length > visible.length) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'task-toggle';
            toggle.textContent = isExpanded ? 'Show less' : `Show more (${tasks.length - visible.length} more)`;
            toggle.addEventListener('click', () => toggleTaskList(deviceId, context));
            container.appendChild(toggle);
          } else if (isExpanded && tasks.length > TASK_PREVIEW_LIMIT) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'task-toggle';
            toggle.textContent = 'Show less';
            toggle.addEventListener('click', () => toggleTaskList(deviceId, context));
            container.appendChild(toggle);
          }
        }

        function toggleTaskList(deviceId, context = 'grid') {
          const contextKey = deviceContextKey(deviceId, context);
          if (expandedTaskPanels.has(contextKey)) {
            expandedTaskPanels.delete(contextKey);
          } else {
            expandedTaskPanels.add(contextKey);
          }
          renderTaskList(deviceId, context);
        }

        function setButtonVariant(button, variant) {
          if (!button) { return; }
          button.className = 'btn';
          switch (variant) {
            case 'danger':
              button.classList.add('btn-danger');
              break;
            case 'secondary':
              button.classList.add('btn-secondary');
              break;
            case 'outline':
              button.classList.add('btn-outline');
              break;
            default:
              button.classList.add('btn-primary');
          }
        }

        function clearConfirmExtraButtons() {
          if (confirmExtraContainer) { confirmExtraContainer.innerHTML = ''; }
          confirmState.extraButtons = [];
        }

        function addConfirmExtraAction(action) {
          if (!confirmExtraContainer) { return; }
          const btn = document.createElement('button');
          btn.type = 'button';
          setButtonVariant(btn, action?.variant || 'outline');
          btn.textContent = action?.label || 'Confirm';
          btn.addEventListener('click', async () => {
            if (action?.close !== false) { closeConfirmDialog(); }
            if (typeof action?.onConfirm === 'function') {
              try {
                await action.onConfirm();
              } catch (err) {
                console.error('Confirm action failed', err);
              }
            }
          });
          confirmExtraContainer.appendChild(btn);
          confirmState.extraButtons.push(btn);
        }

        function openConfirmDialog({ title, message, confirmText, variant = 'primary', onConfirm, extraActions = [], renderExtra }) {
          if (!confirmOverlay) {
            if (typeof onConfirm === 'function') { onConfirm(); }
            return;
          }
          confirmTitleEl.textContent = title || 'Confirm action';
          confirmMessageEl.textContent = message || 'Are you sure you want to continue?';
          confirmConfirmBtn.textContent = confirmText || 'Confirm';
          setButtonVariant(confirmConfirmBtn, variant);
          confirmState.onConfirm = typeof onConfirm === 'function' ? onConfirm : null;
          clearConfirmExtraButtons();
          if (typeof renderExtra === 'function') {
            renderExtra(confirmExtraContainer);
          } else if (Array.isArray(extraActions)) {
            extraActions.forEach(addConfirmExtraAction);
          }
          confirmOverlay.classList.remove('hidden');
          document.body.style.overflow = 'hidden';
          if (confirmConfirmBtn && typeof confirmConfirmBtn.focus === 'function') {
            try { confirmConfirmBtn.focus({ preventScroll: true }); } catch (_) { confirmConfirmBtn.focus(); }
          }
        }

        function closeConfirmDialog() {
          if (!confirmOverlay || confirmOverlay.classList.contains('hidden')) { return; }
          confirmOverlay.classList.add('hidden');
          confirmState.onConfirm = null;
          clearConfirmExtraButtons();
          if (!(editOverlay && editState.open) && !(editSSHModal && editSSHModal.classList.contains('active'))) {
            document.body.style.overflow = '';
          }
        }

        function resetEditState() {
          editState.step = EDIT_STEPS.CONFIG;
          editState.deviceId = null;
          editState.template = null;
          editState.deviceConfig = { meta: {} };
          editState.validation = null;
          editState.isValidating = false;
          editState.isSaving = false;
        }

        function setEditLoading(isLoading, message) {
          if (!editOverlay) { return; }
          if (isLoading) {
            editLoadingState?.classList.remove('hidden');
            editContent?.classList.add('hidden');
          } else {
            editLoadingState?.classList.add('hidden');
            editContent?.classList.remove('hidden');
          }
          if (message && editLoadingState) {
            const text = editLoadingState.querySelector('p');
            if (text) { text.textContent = message; }
          }
        }

        function closeEditOverlay() {
          if (!editOverlay) { return; }
          editOverlay.classList.remove('active');
          editState.open = false;
          closeEditSSHKeyManager();
          if (!(confirmOverlay && !confirmOverlay.classList.contains('hidden')) && !(editSSHModal && editSSHModal.classList.contains('active'))) {
            document.body.style.overflow = '';
          }
          resetEditState();
          if (editForm) { editForm.innerHTML = ''; }
          editValidationResults?.classList.add('hidden');
          editSummary?.classList.add('hidden');
          editValidationResults.innerHTML = '';
          editSummary.innerHTML = '';
          setEditLoading(true);
        }

        function openEditOverlay() {
          if (!editOverlay) { return; }
          editOverlay.classList.add('active');
          document.body.style.overflow = 'hidden';
          editState.open = true;
          setEditStep(EDIT_STEPS.CONFIG);
        }

        function setEditStep(step) {
          editState.step = step;
          if (!editOverlay) { return; }
          const stepElems = editOverlay.querySelectorAll('.edit-step');
          stepElems.forEach((el, idx) => {
            el.classList.toggle('active', idx === step - 1);
          });
          const stepperItems = editOverlay.querySelectorAll('.stepper-item');
          stepperItems.forEach(item => {
            const itemStep = Number(item.getAttribute('data-edit-step'));
            item.classList.toggle('active', itemStep === step);
            item.classList.toggle('completed', itemStep < step);
          });
          if (editBackBtn) { editBackBtn.textContent = step === EDIT_STEPS.CONFIG ? 'Cancel' : 'Back'; }
          if (editValidationResults) { editValidationResults.classList.toggle('hidden', step === EDIT_STEPS.CONFIG); }
          if (editSummary) { editSummary.classList.toggle('hidden', step === EDIT_STEPS.CONFIG); }
          setEditActionState();
        }

        function setEditActionState() {
          const disabled = editState.isValidating || editState.isSaving;
          if (editValidateBtn) { editValidateBtn.disabled = disabled; }
          if (editSaveBtn) { editSaveBtn.disabled = disabled; }
          if (editBackBtn) { editBackBtn.disabled = editState.isValidating; }
        }

        async function ensureTemplatesLoaded() {
          if (templatesCache) { return templatesCache; }
          templatesCache = await json('/api/templates');
          return templatesCache;
        }

        async function ensureSSHKeysLoaded(forceReload = false) {
          if (!forceReload && sshKeysCache.length) { return sshKeysCache; }
          try {
            sshKeysCache = await json('/api/ssh-keys');
          } catch (err) {
            console.error('Failed to load SSH keys', err);
            sshKeysCache = [];
            if (!sshKeysLoadErrorNotified) {
              showToast({ message: 'SSH key manager unavailable. Provide a filesystem path manually.', duration: 6000 });
              sshKeysLoadErrorNotified = true;
            }
          }
          return sshKeysCache;
        }

        function renderEditForm() {
          if (!editForm || !editState.template) { return; }
          const template = editState.template;
          const cfg = editState.deviceConfig || { meta: {} };
          editForm.innerHTML = template.fields.map(field => {
            const currentValue = cfg[field.name] !== undefined ? cfg[field.name] : (field.default ?? '');
            if (field.name === 'ssh_key') {
              return `
                <div class="form-group" id="edit-ssh-key-group">
                  <label>${escapeHTML(field.label)}${field.required ? ' *' : ''}</label>
                  <div class="ssh-key-field-controls">
                    <select id="edit-ssh-key-select" ${field.required ? 'required' : ''}></select>
                    <button type="button" class="btn btn-secondary" id="edit-manage-ssh-btn">Manage Keys</button>
                  </div>
                  <input type="text" id="edit-ssh-key-path" class="hidden" placeholder="${escapeHTML(field.placeholder || '')}">
                  <input type="hidden" name="${escapeHTML(field.name)}" id="edit-ssh-key-hidden" value="${escapeHTML(currentValue)}">
                  ${field.help ? `<div class="help">${escapeHTML(field.help)}</div>` : ''}
                </div>
              `;
            }
            let input = '';
            const escapedValue = escapeHTML(currentValue);
            switch (field.type) {
              case 'select':
                input = `
                  <select name="${escapeHTML(field.name)}" ${field.required ? 'required' : ''}>
                    <option value="">Choose...</option>
                    ${field.options.map(opt => `<option value="${escapeHTML(opt)}" ${currentValue === opt ? 'selected' : ''}>${escapeHTML(opt)}</option>`).join('')}
                  </select>
                `;
                break;
              case 'textarea':
                input = `<textarea name="${escapeHTML(field.name)}" placeholder="${escapeHTML(field.placeholder || '')}" ${field.required ? 'required' : ''}>${escapedValue}</textarea>`;
                break;
              case 'password':
                input = `<input type="password" name="${escapeHTML(field.name)}" placeholder="${escapeHTML(field.placeholder || '')}" value="${escapedValue}" ${field.required ? 'required' : ''}>`;
                break;
              case 'number':
                input = `<input type="number" name="${escapeHTML(field.name)}" placeholder="${escapeHTML(field.placeholder || '')}" value="${escapedValue}" ${field.required ? 'required' : ''}>`;
                break;
              default:
                input = `<input type="text" name="${escapeHTML(field.name)}" placeholder="${escapeHTML(field.placeholder || '')}" value="${escapedValue}" ${field.required ? 'required' : ''}>`;
            }
            return `
              <div class="form-group" data-field="${escapeHTML(field.name)}">
                <label>${escapeHTML(field.label)}${field.required ? ' *' : ''}</label>
                ${input}
                ${field.help ? `<div class="help">${escapeHTML(field.help)}</div>` : ''}
              </div>
            `;
          }).join('');

          const sshField = template.fields.find(field => field.name === 'ssh_key');
          if (sshField) {
            initializeEditSSHField(cfg['ssh_key'] ?? sshField.default ?? '', sshField.placeholder);
          }
        }

        function showEditFieldError(fieldName, message) {
          if (!editForm) { return; }
          const field = editForm.querySelector(`[name="${CSS.escape(fieldName)}"]`);
          if (field) {
            const error = document.createElement('div');
            error.className = 'error';
            error.textContent = message;
            field.parentNode.appendChild(error);
          }
        }

        function validateEditForm() {
          if (!editForm || !editState.template) { return false; }
          const formData = new FormData(editForm);
          editForm.querySelectorAll('.error').forEach(el => el.remove());
          let isValid = true;
          const cfg = editState.deviceConfig;
          cfg.meta = cfg.meta || {};

          editState.template.fields.forEach(field => {
            const rawValue = formData.get(field.name);
            const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
            if (field.required && (!value || value === '')) {
              showEditFieldError(field.name, `${field.label} is required`);
              isValid = false;
            }

            if (field.name === 'ssh_port') {
              if (value === '' || value === undefined) {
                delete cfg.meta.ssh_port;
                cfg.ssh_port = '';
              } else {
                const port = parseInt(value, 10);
                if (Number.isNaN(port) || port <= 0 || port > 65535) {
                  showEditFieldError(field.name, 'Enter a valid SSH port between 1 and 65535');
                  isValid = false;
                } else {
                  cfg.meta.ssh_port = String(port);
                  cfg.ssh_port = String(port);
                }
              }
            } else if (field.name === 'ssh_key') {
              cfg[field.name] = value || '';
            } else if (field.name in cfg || value !== null) {
              cfg[field.name] = value ?? '';
            }
          });

          cfg.kind = editState.template.kind;
          cfg.platform = editState.template.platform;

          return isValid;
        }

        function buildEditPayload() {
          const payload = { ...editState.deviceConfig };
          const meta = { ...(payload.meta || {}) };
          if (meta.ssh_port === '' || meta.ssh_port === undefined) {
            delete meta.ssh_port;
          }
          if (Object.keys(meta).length > 0) {
            payload.meta = meta;
          } else {
            delete payload.meta;
          }
          if (Object.prototype.hasOwnProperty.call(payload, 'ssh_port')) {
            delete payload.ssh_port;
          }
          return payload;
        }

        function refreshEditSSHKeySelect(preservedValue) {
          const select = document.getElementById('edit-ssh-key-select');
          const hidden = document.getElementById('edit-ssh-key-hidden');
          if (!select || !hidden) { return; }
          const currentValue = preservedValue !== undefined ? preservedValue : hidden.value;
          const existing = new Set();
          select.innerHTML = '';

          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = sshKeysCache.length ? 'Select a saved key' : 'No saved keys available';
          select.appendChild(placeholder);
          existing.add('');

          sshKeysCache.forEach(key => {
            const reference = `${SSH_KEY_REFERENCE_PREFIX}${key.id}`;
            const option = document.createElement('option');
            option.value = reference;
            option.textContent = `${key.name} (${key.fingerprint})`;
            if (reference === currentValue) { option.selected = true; }
            select.appendChild(option);
            existing.add(reference);
          });

          const pathOption = document.createElement('option');
          pathOption.value = SSH_KEY_PATH_OPTION;
          pathOption.textContent = 'Use filesystem path';
          select.appendChild(pathOption);
          existing.add(SSH_KEY_PATH_OPTION);

          if (currentValue && currentValue.startsWith(SSH_KEY_REFERENCE_PREFIX) && !existing.has(currentValue)) {
            const missing = document.createElement('option');
            missing.value = currentValue;
            missing.textContent = `Stored key ${currentValue.replace(SSH_KEY_REFERENCE_PREFIX, '#')}`;
            missing.selected = true;
            select.appendChild(missing);
          }

          setEditSSHKeySelection(currentValue);
        }

        function setEditSSHKeySelection(value) {
          const select = document.getElementById('edit-ssh-key-select');
          const hidden = document.getElementById('edit-ssh-key-hidden');
          const pathInput = document.getElementById('edit-ssh-key-path');
          if (!select || !hidden || !pathInput) { return; }

          if (value && value.startsWith(SSH_KEY_REFERENCE_PREFIX)) {
            select.value = value;
            hidden.value = value;
            pathInput.classList.add('hidden');
            pathInput.value = '';
          } else if (value) {
            select.value = SSH_KEY_PATH_OPTION;
            hidden.value = value;
            pathInput.classList.remove('hidden');
            pathInput.value = value;
          } else {
            select.value = '';
            hidden.value = '';
            pathInput.classList.add('hidden');
            pathInput.value = '';
          }
        }

        function initializeEditSSHField(initialValue, placeholder) {
          const select = document.getElementById('edit-ssh-key-select');
          const hidden = document.getElementById('edit-ssh-key-hidden');
          const pathInput = document.getElementById('edit-ssh-key-path');
          const managerBtn = document.getElementById('edit-manage-ssh-btn');
          if (!select || !hidden || !pathInput) { return; }
          if (placeholder) { pathInput.placeholder = placeholder; }
          refreshEditSSHKeySelect(initialValue);
          select.addEventListener('change', () => {
            const value = select.value;
            if (value === SSH_KEY_PATH_OPTION) {
              pathInput.classList.remove('hidden');
              if (!hidden.value || hidden.value.startsWith(SSH_KEY_REFERENCE_PREFIX)) {
                hidden.value = pathInput.value.trim();
              }
              pathInput.focus();
            } else if (value) {
              pathInput.classList.add('hidden');
              pathInput.value = '';
              hidden.value = value;
            } else {
              pathInput.classList.add('hidden');
              pathInput.value = '';
              hidden.value = '';
            }
          });
          pathInput.addEventListener('input', () => {
            hidden.value = pathInput.value.trim();
          });
          if (managerBtn) {
            managerBtn.addEventListener('click', async (evt) => {
              evt.preventDefault();
              await openEditSSHKeyManager();
            });
          }
        }

        async function openEditSSHKeyManager() {
          if (!editSSHModal) { return; }
          await ensureSSHKeysLoaded(true);
          renderEditSSHKeyList();
          if (editSSHViewer) {
            editSSHViewer.classList.add('hidden');
            editSSHViewer.textContent = '';
          }
          editSSHModal.classList.add('active');
        }

        function closeEditSSHKeyManager() {
          if (!editSSHModal) { return; }
          editSSHModal.classList.remove('active');
          if (editSSHViewer) {
            editSSHViewer.classList.add('hidden');
            editSSHViewer.textContent = '';
          }
        }

        function renderEditSSHKeyList() {
          if (!editSSHList) { return; }
          if (sshKeysCache.length === 0) {
            editSSHList.innerHTML = '<div class="muted">No SSH keys saved yet. Add one below.</div>';
            return;
          }
          editSSHList.innerHTML = sshKeysCache.map(key => {
            const added = formatTimestamp(key.created_at);
            return `
              <div class="key-card" data-key-id="${key.id}">
                <div class="key-detail-list">
                  <strong>${escapeHTML(key.name)}</strong>
                  <span class="muted muted-sm">Fingerprint: ${escapeHTML(key.fingerprint)}</span>
                  <span class="muted muted-sm">Added: ${escapeHTML(added)}</span>
                </div>
                <div class="key-card-actions">
                  <button type="button" class="btn btn-outline" data-action="view">View</button>
                  <button type="button" class="btn btn-outline" data-action="use">Use</button>
                  <button type="button" class="btn btn-secondary" data-action="delete">Delete</button>
                </div>
              </div>
            `;
          }).join('');
        }

        async function addEditSSHKey() {
          if (!editNewSSHKeyName || !editNewSSHKeyContent) { return; }
          const name = editNewSSHKeyName.value.trim();
          const content = editNewSSHKeyContent.value.trim();
          if (!name || !content) {
            showToast({ message: 'Provide both a name and key content.', duration: 4000 });
            return;
          }
          try {
            const response = await json('/api/ssh-keys', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, private_key: content })
            });
            editNewSSHKeyName.value = '';
            editNewSSHKeyContent.value = '';
            await ensureSSHKeysLoaded(true);
            renderEditSSHKeyList();
            refreshEditSSHKeySelect(response.reference || `${SSH_KEY_REFERENCE_PREFIX}${response.id}`);
            showToast({ message: 'SSH key saved and selected.', duration: 4000 });
            closeEditSSHKeyManager();
          } catch (err) {
            showToast({ message: 'Failed to save SSH key: ' + err.message, duration: 6000 });
          }
        }

        async function deleteEditSSHKey(id) {
          if (!confirm('Delete this SSH key? This cannot be undone.')) { return; }
          try {
            await json(`/api/ssh-keys/${id}`, { method: 'DELETE' });
            sshKeysCache = sshKeysCache.filter(key => key.id !== id);
            renderEditSSHKeyList();
            refreshEditSSHKeySelect();
            const hidden = document.getElementById('edit-ssh-key-hidden');
            if (hidden && hidden.value === `${SSH_KEY_REFERENCE_PREFIX}${id}`) {
              setEditSSHKeySelection('');
            }
            showToast({ message: 'SSH key deleted.', duration: 4000 });
          } catch (err) {
            showToast({ message: 'Failed to delete SSH key: ' + err.message, duration: 6000 });
          }
        }

        async function viewEditSSHKey(id) {
          if (!editSSHViewer) { return; }
          try {
            const detail = await json(`/api/ssh-keys/${id}`);
            editSSHViewer.textContent = detail.private_key || 'Key unavailable';
            editSSHViewer.classList.remove('hidden');
          } catch (err) {
            showToast({ message: 'Failed to load SSH key: ' + err.message, duration: 6000 });
          }
        }

        function selectEditSSHKeyFromManager(id) {
          setEditSSHKeySelection(`${SSH_KEY_REFERENCE_PREFIX}${id}`);
          closeEditSSHKeyManager();
        }

        function renderEditValidationResults(result) {
          if (!editValidationResults) { return; }
          let html = '';
          const errors = Array.isArray(result.errors) ? result.errors : [];
          const warnings = Array.isArray(result.warnings) ? result.warnings : [];
          const tests = result.tests || {};

          if (errors.length) {
            html += '<h4>Errors</h4>';
            errors.forEach(err => { html += `<div class="validation-item validation-error">❌ ${escapeHTML(err)}</div>`; });
          }
          if (warnings.length) {
            html += '<h4>Warnings</h4>';
            warnings.forEach(warn => { html += `<div class="validation-item validation-warning">⚠️ ${escapeHTML(warn)}</div>`; });
          }
          if (tests) {
            html += '<h4>Connectivity Tests</h4>';
            if (tests.ping) {
              const ping = tests.ping;
              const timeDisplay = typeof ping.time_ms === 'number' ? ping.time_ms.toFixed(1) + 'ms' : (ping.time_ms || '--');
              if (ping.success) {
                html += `<div class="validation-item validation-success">✅ Ping test passed (${escapeHTML(timeDisplay)})</div>`;
              } else {
                html += `<div class="validation-item validation-error">❌ Ping test failed: ${escapeHTML(ping.error || 'Unknown error')}</div>`;
              }
            }
            if (tests.ssh_port) {
              const sshTest = tests.ssh_port;
              if (sshTest.success) {
                html += `<div class="validation-item validation-success">✅ SSH port ${(sshTest.port || '22')} accepted</div>`;
              } else {
                html += `<div class="validation-item validation-error">❌ ${escapeHTML(sshTest.error || 'SSH port failed validation')}</div>`;
              }
            }
            if (tests.ports) {
              Object.entries(tests.ports).forEach(([port, data]) => {
                if (data.success) {
                  html += `<div class="validation-item validation-success">✅ ${escapeHTML(port)} is accessible</div>`;
                } else {
                  html += `<div class="validation-item validation-warning">⚠️ ${escapeHTML(port)} is not accessible</div>`;
                }
              });
            }
            if (tests.ssh_key) {
              html += '<div class="validation-item validation-success">✅ SSH key file exists</div>';
            }
          }
          if (result.valid) {
            html += '<div class="validation-item validation-success">✅ Device configuration is valid</div>';
          }
          editValidationResults.innerHTML = html;
          editValidationResults.classList.remove('hidden');
        }

        function renderEditSummary() {
          if (!editSummary || !editState.template) { return; }
          const cfg = editState.deviceConfig;
          const portValue = cfg.meta?.ssh_port || '22';
          const portLabel = portValue === '22' ? '22 (default)' : portValue;
          editSummary.innerHTML = `
            <div>
              <strong>${escapeHTML(cfg.name || '')}</strong>
            </div>
            <div><strong>Host:</strong> ${escapeHTML(cfg.host || '')}</div>
            <div><strong>Type:</strong> ${escapeHTML(editState.template.name)} (${escapeHTML(cfg.platform || '')})</div>
            <div><strong>SSH Port:</strong> ${escapeHTML(portLabel)}</div>
            <div><strong>User:</strong> ${escapeHTML(cfg.user || 'Not specified')}</div>
            ${cfg.ssh_key ? `<div><strong>SSH Key:</strong> ${escapeHTML(cfg.ssh_key)}</div>` : ''}
          `;
          editSummary.classList.remove('hidden');
        }

        async function handleEditValidate() {
          if (editState.isValidating) { return; }
          if (!validateEditForm()) {
            setEditStep(EDIT_STEPS.CONFIG);
            return;
          }
          editState.isValidating = true;
          setEditActionState();
          setEditStep(EDIT_STEPS.VALIDATION);
          editValidationLoading?.classList.remove('hidden');
          editValidationResults?.classList.add('hidden');
          editSummary?.classList.add('hidden');
          try {
            const payload = buildEditPayload();
            const result = await json('/api/devices/validate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            editState.validation = result;
            renderEditValidationResults(result);
            renderEditSummary();
          } catch (err) {
            console.error('Validation failed', err);
            showToast({ message: 'Validation failed: ' + err.message, duration: 6000 });
          } finally {
            editState.isValidating = false;
            editValidationLoading?.classList.add('hidden');
            setEditActionState();
          }
        }

        async function handleEditSave() {
          if (editState.isSaving) { return; }
          if (!validateEditForm()) {
            setEditStep(EDIT_STEPS.CONFIG);
            return;
          }
          editState.isSaving = true;
          setEditActionState();
          try {
            const payload = buildEditPayload();
            await json(`/api/devices/${editState.deviceId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            showToast({ message: 'Device updated successfully.', duration: 4000 });
            closeEditOverlay();
            await loadDevices();
          } catch (err) {
            console.error('Failed to save device', err);
            showToast({ message: 'Failed to save device: ' + err.message, duration: 6000 });
          } finally {
            editState.isSaving = false;
            setEditActionState();
          }
        }

        function closeOpenMenu() {
          if (!openMenuState) { return; }
          const { menu, button } = openMenuState;
          menu.classList.add('hidden');
          button.setAttribute('aria-expanded', 'false');
          openMenuState = null;
        }

        function toggleDeviceMenu(button, menu) {
          if (openMenuState && openMenuState.menu === menu) {
            closeOpenMenu();
            return;
          }
          closeOpenMenu();
          menu.classList.remove('hidden');
          button.setAttribute('aria-expanded', 'true');
          openMenuState = { menu, button };
        }

        async function editDevice(id) {
          closeOpenMenu();
          openEditOverlay();
          setEditLoading(true, 'Loading device...');
          try {
            const [templates] = await Promise.all([
              ensureTemplatesLoaded()
            ]);
            const device = await json(`/api/devices/${id}`);
            let metaObj = {};
            if (device.meta) {
              if (typeof device.meta === 'string') {
                try { metaObj = device.meta ? JSON.parse(device.meta) : {}; }
                catch { metaObj = {}; }
              } else if (typeof device.meta === 'object' && device.meta !== null) {
                metaObj = device.meta;
              }
            }
            const template = templates.find(t => t.kind === device.kind && t.platform === device.platform);
            if (!template) {
              showToast({ message: 'No template matches this device type. Unable to edit.', duration: 6000 });
              closeEditOverlay();
              return;
            }
            await ensureSSHKeysLoaded();

            const cfg = { meta: { ...(metaObj || {}) } };
            template.fields.forEach(field => {
              if (Object.prototype.hasOwnProperty.call(device, field.name)) {
                cfg[field.name] = device[field.name] ?? '';
              } else if (Object.prototype.hasOwnProperty.call(cfg.meta, field.name)) {
                cfg[field.name] = cfg.meta[field.name];
              }
            });
            cfg.name = device.name || cfg.name || '';
            cfg.host = device.host || cfg.host || '';
            cfg.user = device.user || cfg.user || '';
            cfg.ssh_key = device.ssh_key || cfg.ssh_key || '';
            if (cfg.meta?.ssh_port) {
              cfg.ssh_port = cfg.meta.ssh_port;
            }
            cfg.kind = template.kind;
            cfg.platform = template.platform;

            editState.deviceId = id;
            editState.template = template;
            editState.deviceConfig = cfg;
            editTitle.textContent = `Edit ${device.name || 'Device'}`;
            editSubtitle.textContent = `${template.name} • ${template.platform}`;
            renderEditForm();
            editValidationResults.innerHTML = '';
            editSummary.innerHTML = '';
            editValidationResults.classList.add('hidden');
            editSummary.classList.add('hidden');
            setEditLoading(false);
            setEditStep(EDIT_STEPS.CONFIG);
          } catch (err) {
            console.error('Failed to load device for editing', err);
            showToast({ message: 'Failed to load device: ' + err.message, duration: 6000 });
            closeEditOverlay();
          }
        }

        const deviceCharts = new Map();

        function destroyDeviceChart(deviceId, context = 'grid') {
          const contextKey = deviceContextKey(deviceId, context);
          if (!deviceCharts.has(contextKey)) { return; }
          try {
            deviceCharts.get(contextKey)?.destroy();
          } catch (err) {
            console.warn('Failed to destroy chart for device', deviceId, err);
          }
          deviceCharts.delete(contextKey);
        }

        function createChart(canvas, seriesList) {
          const ctx = canvas.getContext('2d');
          const activeSeries = (seriesList || []).filter(s => s && Array.isArray(s.points) && s.points.length > 0);

          if (activeSeries.length === 0) {
            return null;
          }

          const datasets = activeSeries.map(series => {
            const points = series.points.slice().sort((a, b) => a.ts - b.ts);
            return {
              label: series.label || series.key,
              data: points.map(p => ({
                x: new Date(p.ts).getTime(),
                y: p.value
              })),
              borderColor: series.color || '#2563eb',
              backgroundColor: series.color ? series.color + '20' : '#2563eb20',
              borderWidth: 2,
              fill: false,
              tension: 0.1,
              pointRadius: 0,
              pointHoverRadius: 4
            };
          });

          const config = {
            type: 'line',
            data: { datasets },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: {
                intersect: false,
                mode: 'index'
              },
              plugins: {
                legend: {
                  display: true,
                  position: 'bottom',
                  labels: {
                    usePointStyle: true,
                    padding: 15,
                    font: { size: 11 }
                  }
                },
                tooltip: {
                  callbacks: {
                    title: function (context) {
                      return new Date(context[0].parsed.x).toLocaleString();
                    },
                    label: function (context) {
                      const series = activeSeries[context.datasetIndex];
                      const unit = series.unit || '';
                      return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}${unit}`;
                    }
                  }
                }
              },
              scales: {
                x: {
                  type: 'time',
                  time: {
                    displayFormats: {
                      hour: 'HH:mm',
                      minute: 'HH:mm'
                    }
                  },
                  grid: { display: false },
                  ticks: { font: { size: 10 } }
                },
                y: {
                  beginAtZero: false,
                  grid: { color: 'rgba(0,0,0,0.1)' },
                  ticks: { font: { size: 10 } }
                }
              }
            }
          };

          return new Chart(ctx, config);
        }

        function updateChart(deviceId, seriesList, context = 'grid') {
          const canvas = document.getElementById(deviceContextId(deviceId, context, 'c'));
          const loadingEl = canvas?.parentElement?.querySelector('.chart-loading');

          if (!canvas) return;

          if (loadingEl) {
            loadingEl.style.display = 'none';
          }

          // Destroy existing chart
          destroyDeviceChart(deviceId, context);

          const chart = createChart(canvas, seriesList);
          if (chart) {
            deviceCharts.set(deviceContextKey(deviceId, context), chart);
          } else {
            // Show no data message
            if (loadingEl) {
              loadingEl.textContent = 'No data available';
              loadingEl.style.display = 'block';
            }
          }
        }

        function extractMetricValue(entry) {
          if (entry == null) { return null; }
          const v = entry.value;
          if (typeof v === 'number') { return v; }
          if (v && typeof v === 'object') {
            if ('Valid' in v && !v.Valid) { return null; }
            if (typeof v.Float64 === 'number') { return v.Float64; }
            if (typeof v.value === 'number') { return v.value; }
          }
          if (typeof entry.Value === 'number') { return entry.Value; }
          return null;
        }

        async function fetchMetricAverage(deviceId, metric, sinceISO, limit = 1440) {
          const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.round(Number(limit))) : 1440;
          const params = new URLSearchParams({
            device_id: `${deviceId}`,
            metric: metric,
            since: sinceISO,
            limit: `${safeLimit}`
          });
          try {
            const result = await json(`/api/metrics/average?${params.toString()}`);
            if (result && typeof result === 'object') {
              if (typeof result.value === 'number' && isFinite(result.value)) {
                return result.value;
              }
              if (result.value == null) {
                return null;
              }
            }
          } catch (err) {
            console.warn('Falling back to client-side average for', metric, err);
          }
          const rows = await json(`/api/metrics?device_id=${deviceId}&metric=${metric}&since=${encodeURIComponent(sinceISO)}&limit=${safeLimit}`);
          const values = (rows || [])
            .map(extractMetricValue)
            .filter(v => typeof v === 'number' && isFinite(v));
          if (values.length === 0) {
            return null;
          }
          const sum = values.reduce((acc, value) => acc + value, 0);
          return sum / values.length;
        }

        async function fetchLatestMetricEntry(deviceId, metric) {
          const entry = await json(`/api/metrics/latest?device_id=${deviceId}&metric=${encodeURIComponent(metric)}`);
          if (!entry || typeof entry !== 'object') { return null; }
          return { ...entry, value: extractMetricValue(entry) };
        }

        async function drawDeviceMetrics(device, context = 'grid') {
          if (device.pending_delete_at) { return; }
          const since = new Date(Date.now() - 24 * 3600e3).toISOString();

          const series = await Promise.all(METRIC_SERIES.map(async def => {
            try {
              const rows = await json(`/api/metrics?device_id=${device.id}&metric=${def.key}&since=${encodeURIComponent(since)}&limit=1440`);
              const points = (rows || []).map(row => {
                const tsRaw = row.ts || row.TS || row.timestamp;
                const value = extractMetricValue(row);
                const ts = tsRaw ? new Date(tsRaw).getTime() : NaN;
                return { ts, value };
              }).filter(p => isFinite(p.ts) && typeof p.value === 'number' && isFinite(p.value));
              return { ...def, points };
            } catch (err) {
              return { ...def, points: [] };
            }
          }));

          updateChart(device.id, series, context);
        }

        function promptDeleteDevice(id) {
          const device = devices.find(dev => dev.id === id);
          const deviceName = device?.name || '';
          const labelName = deviceName ? `"${deviceName}"` : 'this device';
          openConfirmDialog({
            title: 'Delete device',
            message: `Schedule deletion to allow a 20-second undo window. Delete now removes ${labelName} immediately with no undo.`,
            confirmText: 'Schedule deletion',
            variant: 'secondary',
            onConfirm: () => performDeleteDevice(id, deviceName),
            renderExtra: (container) => {
              const expected = deviceName || device?.host || '';
              if (!expected) { return; }
              const block = document.createElement('div');
              block.className = 'confirm-extra-block';
              const label = document.createElement('label');
              label.textContent = `Type ${expected} to delete immediately (no undo).`;
              const input = document.createElement('input');
              input.type = 'text';
              input.placeholder = expected;
              const button = document.createElement('button');
              button.type = 'button';
              setButtonVariant(button, 'danger');
              button.textContent = 'Delete now';
              button.disabled = true;
              input.addEventListener('input', () => {
                button.disabled = input.value.trim() !== expected;
              });
              button.addEventListener('click', () => {
                if (button.disabled) { return; }
                closeConfirmDialog();
                performDeleteDeviceImmediate(id, deviceName);
              });
              block.appendChild(label);
              block.appendChild(input);
              block.appendChild(button);
              container.appendChild(block);
            }
          });
        }

        async function performDeleteDevice(id, name) {
          const currentDevice = devices.find(dev => dev.id === id);
          const displayName = name || currentDevice?.name || '';
          try {
            const res = await json(`/api/devices/${id}`, { method: 'DELETE' });
            await loadDevices();
            if (res.pending_delete_at) {
              const deadline = new Date(res.pending_delete_at).getTime();
              const remaining = deadline - Date.now();
              if (remaining > 0) { setTimeout(loadDevices, remaining + 1500); }
            }
            const baseMessage = displayName ? `Device "${displayName}" scheduled for deletion.` : 'Device scheduled for deletion.';
            const undoSeconds = 20;
            const countdownMessage = (seconds) => {
              const windowText = seconds > 0 ? `Undo within ${seconds}s.` : 'Undo window expired.';
              return `${baseMessage} ${windowText}`;
            };
            showToast({
              message: countdownMessage, countdownSeconds: undoSeconds, duration: undoSeconds * 1000, actionText: 'Undo', onAction: async () => {
                const restored = await restoreDevice(id);
                if (restored) {
                  const successMessage = displayName ? `Deletion cancelled for "${displayName}".` : 'Deletion cancelled.';
                  showToast({ message: successMessage, duration: 4000 });
                }
                return restored;
              }
            });
          } catch (e) {
            console.error('Failed to schedule device deletion', e);
            showToast({ message: `Failed to delete device: ${e.message}`, duration: 6000, type: 'error' });
          }
        }

        async function performDeleteDeviceImmediate(id, name) {
          const currentDevice = devices.find(dev => dev.id === id);
          const displayName = name || currentDevice?.name || '';
          try {
            await json(`/api/devices/${id}?immediate=true`, { method: 'DELETE' });
            await loadDevices();
            showToast({ message: displayName ? `Device "${displayName}" deleted.` : 'Device deleted.', duration: 5000, type: 'success' });
          } catch (e) {
            console.error('Failed to delete device immediately', e);
            showToast({ message: `Failed to delete device: ${e.message}`, duration: 6000, type: 'error' });
          }
        }

        async function restoreDevice(id) {
          try {
            await json('/api/devices/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id: id }) });
            await loadDevices();
            return true;
          } catch (e) {
            console.error('Failed to restore device', e);
            showToast({ message: `Failed to restore device: ${e.message}`, duration: 6000, type: 'error' });
            return false;
          }
        }

        const TASK_CONFIRM_COPY = {
          reboot: {
            title: 'Reboot device',
            confirmText: 'Reboot',
            variant: 'danger',
            message: (label) => `Rebooting ${label} will interrupt active sessions and temporarily disconnect it. Continue?`
          },
          refresh_firewall: {
            title: 'Refresh firewall rules',
            confirmText: 'Refresh firewall',
            variant: 'primary',
            message: (label) => `Push the latest firewall configuration to ${label}?`
          },
          refresh_wireless: {
            title: 'Refresh wireless settings',
            confirmText: 'Refresh wireless',
            variant: 'primary',
            message: (label) => `Apply the latest wireless settings to ${label}?`
          }
        };

        function promptTaskConfirmation(device, kind) {
          const copy = TASK_CONFIRM_COPY[kind] || {
            title: 'Run task',
            confirmText: 'Run task',
            variant: 'primary',
            message: (label) => `Run this task for ${label}?`
          };
          const labelName = device?.name ? `"${device.name}"` : 'this device';
          openConfirmDialog({
            title: copy.title,
            message: typeof copy.message === 'function' ? copy.message(labelName) : (copy.message || `Run this task for ${labelName}?`),
            confirmText: copy.confirmText,
            variant: copy.variant,
            onConfirm: () => runTask(device.id, kind)
          });
        }

        navTabs.forEach(tab => {
          const targetRoute = tab.dataset.route;
          const tabView = tab.dataset.view;
          const routeConfig = targetRoute ? DASHBOARD_ROUTES[targetRoute] : null;

          if (routeConfig && tab.tagName === 'A' && !tab.getAttribute('href')) {
            tab.setAttribute('href', routeConfig.href);
          }

          tab.addEventListener('click', (event) => {
            if (targetRoute && targetRoute !== activeRoute) {
              if (!tab.getAttribute('href') && routeConfig?.href) {
                event.preventDefault();
                window.location.href = routeConfig.href;
              }
              return;
            }
            if (tabView) {
              event.preventDefault();
              setView(tabView);
            }
          });
        });

        setView(initialViewKey);

        if (logsForm) {
          logsForm.addEventListener('submit', (evt) => {
            evt.preventDefault();
            loadActivityLogs();
          });
        }
        if (logsResetBtn) {
          logsResetBtn.addEventListener('click', () => {
            if (logsForm) { logsForm.reset(); }
            loadActivityLogs();
          });
        }

        // Device filtering event listeners
        if (deviceTypeFilter) {
          deviceTypeFilter.addEventListener('change', renderDevices);
        }
        if (deviceStatusFilter) {
          deviceStatusFilter.addEventListener('change', renderDevices);
        }
        if (deviceSearchFilter) {
          deviceSearchFilter.addEventListener('input', renderDevices);
        }
        if (deviceFiltersReset) {
          deviceFiltersReset.addEventListener('click', () => {
            if (deviceTypeFilter) deviceTypeFilter.value = '';
            if (deviceStatusFilter) deviceStatusFilter.value = '';
            if (deviceSearchFilter) deviceSearchFilter.value = '';
            renderDevices();
          });
        }

        if (deviceSelectAllBtn) {
          deviceSelectAllBtn.addEventListener('click', () => {
            if (!Array.isArray(devices) || devices.length === 0) { return; }
            if (deviceSelection.size === devices.length) {
              deviceSelection.clear();
            } else {
              devices.forEach(device => deviceSelection.add(device.id));
            }
            renderDeviceTable();
          });
        }
        if (deviceTableMaster) {
          deviceTableMaster.addEventListener('change', () => {
            if (!Array.isArray(devices)) { return; }
            if (deviceTableMaster.checked) {
              devices.forEach(device => deviceSelection.add(device.id));
            } else {
              deviceSelection.clear();
            }
            renderDeviceTable();
          });
        }
        if (deviceExportSelectedBtn) {
          deviceExportSelectedBtn.addEventListener('click', () => {
            if (!Array.isArray(devices) || devices.length === 0) {
              showToast({ message: 'No devices available to export.', duration: 4000, type: 'info' });
              return;
            }
            const selected = devices.filter(device => deviceSelection.has(device.id));
            const stamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
            exportDevicesAsJSON(selected, `pulseops-devices-selected-${stamp}.json`);
          });
        }
        if (deviceExportAllBtn) {
          deviceExportAllBtn.addEventListener('click', () => {
            if (!Array.isArray(devices) || devices.length === 0) {
              showToast({ message: 'No devices available to export.', duration: 4000, type: 'info' });
              return;
            }
            const stamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
            exportDevicesAsJSON(devices, `pulseops-devices-${stamp}.json`);
          });
        }
        if (deviceImportBtn && deviceImportInput) {
          deviceImportBtn.addEventListener('click', () => {
            deviceImportInput.value = '';
            deviceImportInput.click();
          });
          deviceImportInput.addEventListener('change', handleDeviceImportSelection);
        }

        if (settingsEmailEnabled) { settingsEmailEnabled.addEventListener('change', updateEmailFieldState); }
        if (settingsThemeSelect) {
          settingsThemeSelect.addEventListener('change', () => {
            if (window.themeManager) {
              window.themeManager.setTheme(settingsThemeSelect.value);
            }
          });
        }
        if (settingsEmailClear) {
          settingsEmailClear.addEventListener('change', () => {
            if (settingsEmailClear.checked && settingsEmailPassword) {
              settingsEmailPassword.value = '';
            }
          });
        }
        if (settingsEmailPassword) {
          settingsEmailPassword.addEventListener('input', () => {
            if (settingsEmailPassword.value && settingsEmailClear) {
              settingsEmailClear.checked = false;
            }
          });
        }
        if (settingsForm) {
          settingsForm.addEventListener('submit', async (evt) => {
            evt.preventDefault();
            try {
              if (settingsStatus) { settingsStatus.textContent = 'Saving…'; }
              const payload = collectSettingsPayload();
              const response = await json('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              applySettingsToForm(response || {});
              if (settingsStatus) {
                settingsStatus.textContent = 'Settings saved.';
                setTimeout(() => { if (settingsStatus?.textContent === 'Settings saved.') { settingsStatus.textContent = ''; } }, 4000);
              }
              showToast({ message: 'Settings saved.', duration: 4000, type: 'success' });
            } catch (err) {
              console.error('Settings save failed', err);
              if (settingsStatus) { settingsStatus.textContent = ''; }
              showToast({ message: 'Failed to save settings: ' + err.message, duration: 6000, type: 'error' });
            }
          });
        }

        if (insightsSelect) {
          insightsSelect.addEventListener('change', () => {
            const value = Number(insightsSelect.value);
            if (Number.isFinite(value) && value > 0) {
              insightsState.deviceId = value;
              renderInsightsForDevice(value);
            } else {
              insightsState.deviceId = null;
              if (insightsRefreshBtn) { insightsRefreshBtn.disabled = true; }
              showInsightsEmpty();
            }
          });
        }
        if (insightsRefreshBtn) {
          insightsRefreshBtn.addEventListener('click', () => {
            if (insightsState.deviceId) {
              renderInsightsForDevice(insightsState.deviceId);
            }
          });
        }

        if (insightsRefreshBtn) { insightsRefreshBtn.disabled = true; }
        if (logsStatus) { logsStatus.textContent = 'Apply filters to explore device and system logs.'; }
        if (settingsForm) { updateEmailFieldState(); }

        if (confirmCancelBtn) { confirmCancelBtn.addEventListener('click', closeConfirmDialog); }
        if (confirmConfirmBtn) {
          confirmConfirmBtn.addEventListener('click', async () => {
            const handler = confirmState.onConfirm;
            closeConfirmDialog();
            if (typeof handler === 'function') {
              try {
                await handler();
              } catch (err) {
                console.error('Confirmed action failed', err);
                showToast({ message: 'Action failed: ' + err.message, duration: 6000, type: 'error' });
              }
            }
          });
        }
        if (confirmOverlay) { confirmOverlay.addEventListener('click', (evt) => { if (evt.target === confirmOverlay) { closeConfirmDialog(); } }); }
        if (editBackBtn) {
          editBackBtn.addEventListener('click', () => {
            if (editState.step === EDIT_STEPS.CONFIG) {
              closeEditOverlay();
            } else {
              setEditStep(EDIT_STEPS.CONFIG);
            }
          });
        }
        if (editValidateBtn) { editValidateBtn.addEventListener('click', () => { handleEditValidate(); }); }
        if (editSaveBtn) { editSaveBtn.addEventListener('click', () => { handleEditSave(); }); }
        if (editCloseBtn) { editCloseBtn.addEventListener('click', () => { closeEditOverlay(); }); }
        if (editOverlay) { editOverlay.addEventListener('click', (evt) => { if (evt.target === editOverlay) { closeEditOverlay(); } }); }
        if (editSSHCloseBtn) { editSSHCloseBtn.addEventListener('click', () => { closeEditSSHKeyManager(); }); }
        if (editSaveSSHKeyBtn) { editSaveSSHKeyBtn.addEventListener('click', () => { addEditSSHKey(); }); }
        if (editSSHModal) { editSSHModal.addEventListener('click', (evt) => { if (evt.target === editSSHModal) { closeEditSSHKeyManager(); } }); }
        document.addEventListener('click', (evt) => {
          if (!openMenuState) { return; }
          const { menu, button } = openMenuState;
          if (menu.contains(evt.target) || button.contains(evt.target)) { return; }
          closeOpenMenu();
        });
        document.addEventListener('keydown', (evt) => {
          if (evt.key !== 'Escape') { return; }
          if (confirmOverlay && !confirmOverlay.classList.contains('hidden')) {
            closeConfirmDialog();
            evt.preventDefault();
            evt.stopPropagation();
            return;
          }
          if (editSSHModal && editSSHModal.classList.contains('active')) {
            closeEditSSHKeyManager();
            evt.preventDefault();
            evt.stopPropagation();
            return;
          }
          if (editOverlay && editState.open) {
            closeEditOverlay();
            evt.preventDefault();
            evt.stopPropagation();
            return;
          }
          if (openMenuState) {
            closeOpenMenu();
            evt.preventDefault();
            evt.stopPropagation();
          }
        });

        window.addEventListener('resize', () => {
          if (viewState.current !== 'overview') { return; }
          if (networkMapResizeTimer) { clearTimeout(networkMapResizeTimer); }
          networkMapResizeTimer = setTimeout(() => {
            renderNetworkMap(networkMapActiveDevices);
            networkMapResizeTimer = null;
          }, 150);
        });

        async function loadDevices() {
          try {
            const data = await json('/api/devices');
            devices = data;
            backupCache.clear();
            renderDevices();
            refreshDeviceFilters();
            renderDeviceTable();
            refreshInsightsSelector();
          } catch (e) {
            console.error('Failed to load devices', e);
          }
        }

        function focusDeviceCard(deviceId) {
          if (!deviceId) { return; }
          const card = document.getElementById(deviceContextId(deviceId, 'grid', 'device'));
          if (!card) { return; }
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('card-highlight');
          setTimeout(() => { card.classList.remove('card-highlight'); }, 1600);
        }

        function renderNetworkMap(devicesList) {
          if (!networkMapEl || !networkMapNodes || !networkMapLinks) { return; }

          networkMapActiveDevices = Array.isArray(devicesList) ? devicesList.slice() : [];
          const hasDevices = networkMapActiveDevices.length > 0;

          if (!hasDevices) {
            networkMapNodes.innerHTML = '';
            while (networkMapLinks.firstChild) { networkMapLinks.removeChild(networkMapLinks.firstChild); }
            networkMapPanel?.classList.add('network-map-panel--empty');
            if (networkMapEmpty) { networkMapEmpty.classList.remove('hidden'); }
            return;
          }

          networkMapPanel?.classList.remove('network-map-panel--empty');
          if (networkMapEmpty) { networkMapEmpty.classList.add('hidden'); }

          const width = networkMapEl.clientWidth || networkMapEl.offsetWidth || networkMapEl.parentElement?.clientWidth || 920;
          const mapHeight = Math.round(Math.max(Math.min(width * 0.6, 620), 420));
          networkMapEl.style.setProperty('--network-map-height', `${mapHeight}px`);

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
          networkMapActiveDevices.forEach(device => {
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
            chip: formatDeviceCount(networkMapActiveDevices.length),
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
                const statusText = status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Unknown';
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

          networkMapNodes.innerHTML = '';
          while (networkMapLinks.firstChild) { networkMapLinks.removeChild(networkMapLinks.firstChild); }

          const svgNS = 'http://www.w3.org/2000/svg';
          networkMapLinks.setAttribute('viewBox', `0 0 ${width} ${height}`);
          networkMapLinks.setAttribute('width', width);
          networkMapLinks.setAttribute('height', height);

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
          networkMapLinks.appendChild(defs);

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
            networkMapLinks.appendChild(path);
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

            networkMapNodes.appendChild(nodeEl);
          });
        }

        function renderDevices() {
          const grid = document.getElementById('devices');
          if (!grid) { return; }
          closeOpenMenu();

          const existingCards = new Map();
          Array.from(grid.querySelectorAll('.card[id^="device-"]')).forEach(card => {
            const id = Number(card.id.replace('device-', ''));
            if (Number.isFinite(id)) {
              existingCards.set(id, card);
            }
          });

          clearCountdowns('grid');

          // Reset hidden metrics and hardware visibility state for the grid context when re-rendering
          clearContextEntries(deviceHiddenMetricsVisible, 'grid');
          clearContextEntries(metricVisibilityState, 'grid');
          clearContextEntries(deviceHardwareVisible, 'grid');
          clearContextEntries(hardwareAvailabilityState, 'grid');

          // Apply filters first
          applyDeviceFilters();

          const seenIds = new Set();
          const activeDevices = [];
          for (const d of filteredDevices) {
            if (d.pending_delete_at) {
              clearTaskPoller(d.id, 'grid');
              deviceTasks.delete(d.id);
              expandedTaskPanels.delete(deviceContextKey(d.id, 'grid'));
              continue;
            }
            activeDevices.push(d);
          }

          renderNetworkMap(activeDevices);

          if (overviewEmptyState) {
            const hasDevices = devices.length > 0;
            const hasFilteredDevices = activeDevices.length > 0;
            if (!hasDevices) {
              overviewEmptyState.textContent = 'No devices yet. Add one to start monitoring.';
              overviewEmptyState.classList.remove('hidden');
            } else if (!hasFilteredDevices) {
              overviewEmptyState.textContent = 'No devices match the current filters.';
              overviewEmptyState.classList.remove('hidden');
            } else {
              overviewEmptyState.classList.add('hidden');
            }
          }

          if (activeDevices.length === 0) {
            existingCards.forEach((card, id) => {
              destroyDeviceChart(id, 'grid');
              card.remove();
            });
            return;
          }

          const orderedCards = [];

          activeDevices.forEach((d, index) => {
            seenIds.add(d.id);
            const newCard = deviceCard(d, 'grid');
            const existingCard = existingCards.get(d.id);
            if (existingCard) {
              existingCard.replaceWith(newCard);
              existingCards.delete(d.id);
            } else {
              const referenceNode = grid.children[index] || null;
              grid.insertBefore(newCard, referenceNode);
            }
            orderedCards.push(newCard);

            const toggle = newCard.querySelector(`#${deviceContextId(d.id, 'grid', 'logs-toggle')}`);
            if (toggle) {
              toggle.addEventListener('click', () => {
                const key = deviceContextKey(d.id, 'grid');
                const current = logExpansionState.get(key) || false;
                logExpansionState.set(key, !current);
                loadDeviceLogs(d.id, 'grid');
              });
            }
            if (!d.pending_delete_at) {
              refreshLatest(d, 'grid');
              drawDeviceMetrics(d, 'grid');
              loadDeviceLogs(d.id, 'grid');
            }
            loadDeviceTasks(d.id, 'grid');
          });

          existingCards.forEach((card, id) => {
            destroyDeviceChart(id, 'grid');
            card.remove();
          });

          orderedCards.forEach((card, index) => {
            const currentNode = grid.children[index];
            if (currentNode !== card) {
              grid.insertBefore(card, currentNode || null);
            }
          });

          taskRefreshTimers.forEach((timer, key) => {
            if (!key.startsWith('grid:')) { return; }
            const [, rawId] = key.split(':');
            const deviceId = Number(rawId);
            if (!seenIds.has(deviceId)) {
              clearTimeout(timer);
              taskRefreshTimers.delete(key);
              deviceTasks.delete(deviceId);
            }
          });
          Array.from(expandedTaskPanels).forEach((key) => {
            if (typeof key !== 'string' || !key.startsWith('grid:')) { return; }
            const [, rawId] = key.split(':');
            const deviceId = Number(rawId);
            if (!seenIds.has(deviceId)) {
              expandedTaskPanels.delete(key);
            }
          });
          hardwareCache.forEach((_, id) => {
            if (!seenIds.has(id)) {
              hardwareCache.delete(id);
            }
          });
        }

        function startRefreshLoop() {
          if (latestInterval) { clearInterval(latestInterval); }
          latestInterval = setInterval(() => {
            devices.filter(d => !d.pending_delete_at).forEach(d => {
              refreshLatest(d, 'grid');
              loadDeviceLogs(d.id, 'grid');
            });
          }, 10000);
        }

        // Key Management Functions
        let keysData = [];
        const keysState = { loaded: false, isLoading: false };
        const keysLoadingEl = document.getElementById('keys-loading');
        const keysEmptyEl = document.getElementById('keys-empty');
        const keysListEl = document.getElementById('keys-list');
        const keysAddBtn = document.getElementById('keys-add-btn');
        const keysRefreshBtn = document.getElementById('keys-refresh-btn');
        const addKeyModal = document.getElementById('add-key-modal');
        const addKeyForm = document.getElementById('add-key-form');
        const addKeyNameInput = document.getElementById('add-key-name');
        const addKeyContentInput = document.getElementById('add-key-content');
        const addKeyCancelBtn = document.getElementById('add-key-cancel');
        const addKeySaveBtn = document.getElementById('add-key-save');

        async function ensureKeysLoaded(forceReload = false) {
          if (!forceReload && keysState.loaded) return;
          if (keysState.isLoading) return;

          keysState.isLoading = true;
          showKeysLoading();

          try {
            keysData = await json('/api/ssh-keys-usage');
            keysState.loaded = true;
            renderKeysList();
          } catch (err) {
            console.error('Failed to load SSH keys:', err);
            showKeysError('Failed to load SSH keys: ' + err.message);
          } finally {
            keysState.isLoading = false;
          }
        }

        function showKeysLoading() {
          if (keysLoadingEl) keysLoadingEl.classList.remove('hidden');
          if (keysEmptyEl) keysEmptyEl.classList.add('hidden');
          if (keysListEl) keysListEl.classList.add('hidden');
        }

        function showKeysEmpty() {
          if (keysLoadingEl) keysLoadingEl.classList.add('hidden');
          if (keysEmptyEl) keysEmptyEl.classList.remove('hidden');
          if (keysListEl) keysListEl.classList.add('hidden');
        }

        function showKeysError(message) {
          if (keysLoadingEl) {
            keysLoadingEl.textContent = message;
            keysLoadingEl.classList.remove('hidden');
          }
          if (keysEmptyEl) keysEmptyEl.classList.add('hidden');
          if (keysListEl) keysListEl.classList.add('hidden');
        }

        function renderKeysList() {
          if (!keysListEl) return;

          if (!keysData || keysData.length === 0) {
            showKeysEmpty();
            return;
          }

          if (keysLoadingEl) keysLoadingEl.classList.add('hidden');
          if (keysEmptyEl) keysEmptyEl.classList.add('hidden');
          keysListEl.classList.remove('hidden');

          const fragment = document.createDocumentFragment();

          keysData.forEach(key => {
            const keyCard = createKeyCard(key);
            fragment.appendChild(keyCard);
          });

          keysListEl.innerHTML = '';
          keysListEl.appendChild(fragment);
        }

        function createKeyCard(key) {
          const name = key.name || 'Unnamed key';
          const fingerprint = key.fingerprint || '—';
          const usageText = key.usage_count === 0 ? 'Not used' :
            key.usage_count === 1 ? '1 device' :
              `${key.usage_count} devices`;

          const card = el('div', { class: 'key-card' },
            el('div', { class: 'key-card-header' },
              el('div', { class: 'key-card-title' },
                el('div', { class: 'key-card-title-top' },
                  el('h3', { class: 'key-name truncate', title: name }, name),
                  el('span', {
                    class: `key-usage-chip ${key.usage_count > 0 ? 'key-usage-chip--active' : 'key-usage-chip--idle'}`,
                    title: usageText
                  }, usageText)
                ),
                el('span', { class: 'key-fingerprint truncate', title: fingerprint }, fingerprint)
              ),
              el('div', { class: 'key-card-actions' },
                el('button', {
                  class: 'btn btn-outline btn-sm',
                  onclick: () => viewKeyDetails(key.id)
                }, '👁️ View'),
                el('button', {
                  class: 'btn danger btn-sm',
                  onclick: () => deleteKey(key.id, key.name)
                }, '🗑️ Delete')
              )
            ),
            el('div', { class: 'key-card-meta' },
              el('div', { class: 'key-meta-item' },
                el('span', { class: 'key-meta-label' }, 'Created'),
                el('span', { class: 'key-meta-value truncate', title: formatTimestamp(key.created_at) }, formatTimestamp(key.created_at))
              ),
              el('div', { class: 'key-meta-item' },
                el('span', { class: 'key-meta-label' }, 'Usage'),
                el('span', {
                  class: `key-meta-value ${key.usage_count > 0 ? 'key-used' : 'key-unused'}`,
                  title: usageText
                }, usageText)
              )
            )
          );

          if (key.usage_count > 0) {
            const usageList = el('div', { class: 'key-usage-list' },
              el('h4', { class: 'key-usage-title' }, 'Used by'),
              ...key.used_by.map(device => {
                const deviceName = device.device_name || '—';
                const deviceHost = device.device_host || '—';
                const deviceKind = formatKindLabel(device.device_kind || device.platform);
                return el('div', { class: 'key-usage-device' },
                  el('div', { class: 'device-name truncate', title: deviceName }, deviceName),
                  el('div', { class: 'device-meta' },
                    el('span', { class: 'device-host muted truncate', title: deviceHost }, deviceHost),
                    el('span', { class: 'device-kind muted truncate', title: deviceKind }, deviceKind)
                  )
                );
              })
            );
            card.appendChild(usageList);
          }

          return card;
        }

        async function viewKeyDetails(keyId) {
          try {
            const keyDetail = await json(`/api/ssh-keys/${keyId}`);
            showConfirm(
              'SSH Key Details',
              `Key: ${keyDetail.name}\nFingerprint: ${keyDetail.fingerprint}\nCreated: ${formatTimestamp(keyDetail.created_at)}`,
              'Close',
              () => { },
              [
                {
                  text: 'Copy Private Key',
                  action: () => {
                    navigator.clipboard.writeText(keyDetail.private_key).then(() => {
                      showToast({ message: 'Private key copied to clipboard', duration: 3000, type: 'success' });
                    }).catch(() => {
                      showToast({ message: 'Failed to copy to clipboard', duration: 3000, type: 'error' });
                    });
                  }
                }
              ]
            );
          } catch (err) {
            showToast({ message: 'Failed to load key details: ' + err.message, duration: 5000, type: 'error' });
          }
        }

        async function deleteKey(keyId, keyName) {
          const key = keysData.find(k => k.id === keyId);
          if (key && key.usage_count > 0) {
            showToast({
              message: `Cannot delete key "${keyName}" - it is used by ${key.usage_count} device(s)`,
              duration: 5000,
              type: 'error'
            });
            return;
          }

          showConfirm(
            'Delete SSH Key',
            `Are you sure you want to delete the SSH key "${keyName}"? This action cannot be undone.`,
            'Delete',
            async () => {
              try {
                await json(`/api/ssh-keys/${keyId}`, { method: 'DELETE' });
                showToast({ message: 'SSH key deleted successfully', duration: 4000, type: 'success' });
                await ensureKeysLoaded(true);
              } catch (err) {
                showToast({ message: 'Failed to delete SSH key: ' + err.message, duration: 5000, type: 'error' });
              }
            }
          );
        }

        function openAddKeyModal() {
          if (addKeyModal) {
            addKeyNameInput.value = '';
            addKeyContentInput.value = '';
            addKeyModal.classList.remove('hidden');
            addKeyNameInput.focus();
          }
        }

        function closeAddKeyModal() {
          if (addKeyModal) {
            addKeyModal.classList.add('hidden');
          }
        }

        async function saveNewKey() {
          const name = addKeyNameInput.value.trim();
          const content = addKeyContentInput.value.trim();

          if (!name) {
            showToast({ message: 'Key name is required', duration: 3000, type: 'error' });
            addKeyNameInput.focus();
            return;
          }

          if (!content) {
            showToast({ message: 'Private key content is required', duration: 3000, type: 'error' });
            addKeyContentInput.focus();
            return;
          }

          try {
            await json('/api/ssh-keys', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, private_key: content })
            });

            showToast({ message: 'SSH key saved successfully', duration: 4000, type: 'success' });
            closeAddKeyModal();
            await ensureKeysLoaded(true);
          } catch (err) {
            showToast({ message: 'Failed to save SSH key: ' + err.message, duration: 5000, type: 'error' });
          }
        }

        // Event listeners for key management
        if (keysAddBtn) keysAddBtn.addEventListener('click', openAddKeyModal);
        if (keysRefreshBtn) keysRefreshBtn.addEventListener('click', () => ensureKeysLoaded(true));
        if (addKeyCancelBtn) addKeyCancelBtn.addEventListener('click', closeAddKeyModal);
        if (addKeySaveBtn) addKeySaveBtn.addEventListener('click', saveNewKey);
        if (addKeyForm) {
          addKeyForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveNewKey();
          });
        }

        // Close modal when clicking outside
        if (addKeyModal) {
          addKeyModal.addEventListener('click', (e) => {
            if (e.target === addKeyModal) {
              closeAddKeyModal();
            }
          });
        }

        if (backupModal) {
          backupModal.addEventListener('click', (e) => {
            if (e.target === backupModal) {
              closeBackupModal();
            }
          });
        }
        if (backupModalClose) {
          backupModalClose.addEventListener('click', closeBackupModal);
        }

        async function init() {
          // Initialize theme from stored preference
          if (window.themeManager) {
            const storedTheme = window.themeManager.getStoredTheme();
            if (storedTheme) {
              window.themeManager.setTheme(storedTheme);
            }
          }

          await checkAuthStatus();
          if (viewState.current === 'keys') {
            await ensureKeysLoaded();
          }
          await loadDevices();
          startRefreshLoop();
          setInterval(loadDevices, 30000);
        }
        init();
  
  }

  function initWizard() {
        // Global state
        const MODE_SCAN = 'scan';
        const MODE_MANUAL = 'manual';

        const SSH_KEY_REFERENCE_PREFIX = 'sshkey:';
        const SSH_KEY_PATH_OPTION = '__path__';
        const DEVICE_KIND_ALIASES = {
          ap: 'access_point',
          accesspoint: 'access_point',
          wifi: 'access_point',
          wireless: 'access_point',
          wap: 'access_point',
          routerboard: 'router',
          firewall_appliance: 'firewall',
          utm: 'firewall',
          switchgear: 'switch',
          edge_switch: 'switch'
        };
        const DEVICE_KIND_META = {
          router: { icon: '🛣️', className: 'badge-router', label: 'Router' },
          switch: { icon: '🔀', className: 'badge-switch', label: 'Switch' },
          access_point: { icon: '📡', className: 'badge-ap', label: 'Access Point' },
          firewall: { icon: '🛡️', className: 'badge-firewall', label: 'Firewall' },
          server: { icon: '🖥️', className: 'badge-server', label: 'Server' },
          gateway: { icon: '🚪', className: 'badge-gateway', label: 'Gateway' },
          modem: { icon: '📶', className: 'badge-modem', label: 'Modem' },
          default: { icon: '⚙️', className: 'badge-default', label: 'Device' }
        };

        let currentStep = 1;
        let selectedTemplate = null;
        let selectedDevice = null;
        let deviceConfig = { meta: {} };
        let templates = [];
        let networkRanges = [];
        let discoveryMode = MODE_SCAN;
        let sshKeys = [];
        let sshKeyLoadErrorNotified = false;

        // Utility functions
        async function json(url, opts={}) { 
          const r = await fetch(url, opts); 
          if (!r.ok) throw new Error(await r.text()); 
          return r.json(); 
        }

        function escapeHTML(value) {
          return (value || '').replace(/[&<>"']/g, match => {
            switch (match) {
              case '&': return '&amp;';
              case '<': return '&lt;';
              case '>': return '&gt;';
              case '"': return '&quot;';
              case "'": return '&#39;';
              default: return match;
            }
          });
        }

        function normaliseKindValue(value) {
          return (value || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        }

        function resolveKindKey(value) {
          const norm = normaliseKindValue(value);
          if (!norm) { return ''; }
          if (Object.prototype.hasOwnProperty.call(DEVICE_KIND_ALIASES, norm)) {
            return DEVICE_KIND_ALIASES[norm];
          }
          return norm;
        }

        function formatKindLabel(value) {
          if (!value) { return 'Device'; }
          return value.toString().replace(/[_\s]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
        }

        function getDeviceBadgeInfo(kind, platform) {
          const candidates = [kind, platform].map(resolveKindKey).filter(Boolean);
          for (const key of candidates) {
            if (Object.prototype.hasOwnProperty.call(DEVICE_KIND_META, key)) {
              const base = DEVICE_KIND_META[key];
              return { ...base, label: base.label || formatKindLabel(kind || platform || base.label) };
            }
          }
          const fallbackLabel = formatKindLabel(kind || platform || DEVICE_KIND_META.default.label);
          return { ...DEVICE_KIND_META.default, label: fallbackLabel };
        }

        function renderBadgeHTML(kind, platform) {
          const info = getDeviceBadgeInfo(kind, platform);
          const iconHTML = info.icon ? `<span class="badge-icon">${info.icon}</span>` : '';
          const labelHTML = `<span class="badge-label">${escapeHTML(info.label)}</span>`;
          return `<span class="badge ${info.className}">${iconHTML}${labelHTML}</span>`;
        }

        function formatTimestamp(value) {
          if (!value) return '—';
          let date = new Date(value);
          if (Number.isNaN(date.getTime())) {
            const isoCandidate = value.replace(' ', 'T') + 'Z';
            date = new Date(isoCandidate);
          }
          if (Number.isNaN(date.getTime())) {
            return value;
          }
          return date.toLocaleString();
        }

        function generateRandomSuffix(length = 5) {
          return Math.random().toString(36).slice(2, 2 + length);
        }

        function deriveDefaultDeviceName(device = selectedDevice) {
          if (device && device.hostname) {
            return device.hostname.split('.')[0];
          }

          const host = device?.ip || deviceConfig.host;
          if (host) {
            return `device-${host.replace(/\./g, '-')}`;
          }

          return `device-${generateRandomSuffix()}`;
        }

        function showStep(step) {
          const currentStepEl = document.querySelector('.step.active');
          const targetStepEl = document.getElementById(`step-${step}`);

          // Add slide out animation to current step
          if (currentStepEl && currentStepEl !== targetStepEl) {
            currentStepEl.classList.add('slide-out-left');

            setTimeout(() => {
              // Hide all steps
              document.querySelectorAll('.step').forEach(s => {
                s.classList.remove('active', 'slide-out-left', 'slide-in-right', 'template-selection-complete');
              });
              document.querySelectorAll('.step-item').forEach(s => s.classList.remove('active'));

              // Show target step with slide in animation
              targetStepEl.classList.add('slide-in-right');
              setTimeout(() => {
                targetStepEl.classList.add('active');
              }, 50);

            }, 200);
          } else {
            // Initial load or same step
            document.querySelectorAll('.step').forEach(s => {
              s.classList.remove('active', 'slide-out-left', 'slide-in-right', 'template-selection-complete');
            });
            document.querySelectorAll('.step-item').forEach(s => s.classList.remove('active'));
            targetStepEl.classList.add('active');
          }

          // Update step indicator
          document.querySelector(`[data-step="${step}"]`).classList.add('active');

          // Mark completed steps
          for (let i = 1; i < step; i++) {
            document.querySelector(`[data-step="${i}"]`).classList.add('completed');
          }

          // Update buttons
          document.getElementById('prev-btn').disabled = step === 1;
          document.getElementById('next-btn').style.display = step === 4 ? 'none' : 'block';
          document.getElementById('finish-btn').style.display = step === 4 ? 'block' : 'none';

          // Reset template cards if going back to step 1
          if (step === 1) {
            setTimeout(() => {
              document.querySelectorAll('.template-card').forEach(card => {
                card.classList.remove('fade-out-others', 'selected');
              });
            }, 300);
          }
        }

        function setDiscoveryMode(mode) {
          discoveryMode = mode;

          const scanSection = document.getElementById('scan-discovery-section');
          const manualSection = document.getElementById('manual-discovery-section');

          if (scanSection) {
            scanSection.classList.toggle('hidden', mode !== MODE_SCAN);
          }

          if (manualSection) {
            manualSection.classList.toggle('hidden', mode !== MODE_MANUAL);
          }

          document.querySelectorAll('.mode-btn').forEach(btn => {
            const btnMode = btn.getAttribute('data-mode');
            btn.classList.remove('btn-primary', 'btn-outline');
            btn.classList.add(btnMode === mode ? 'btn-primary' : 'btn-outline');
          });
        }

        function nextStep() {
          if (currentStep < 4) {
            if (validateCurrentStep()) {
              currentStep++;
              showStep(currentStep);
          
              if (currentStep === 3) {
                generateConfigForm();
              } else if (currentStep === 4) {
                validateDevice();
              }
            }
          }
        }

        function previousStep() {
          if (currentStep > 1) {
            currentStep--;
            showStep(currentStep);
          }
        }

        function validateCurrentStep() {
          switch (currentStep) {
            case 1:
              if (!selectedTemplate) {
                alert('Please select a device template');
                return false;
              }
              return true;
            case 2:
              return true; // Discovery is optional
            case 3:
              return validateForm();
            default:
              return true;
          }
        }

        // Initialize the wizard
        async function init() {
          try {
            // Initialize theme from stored preference
            if(window.themeManager) {
              const storedTheme = window.themeManager.getStoredTheme();
              if(storedTheme) {
                window.themeManager.setTheme(storedTheme);
              }
            }

            // Load templates
            templates = await json('/api/templates');
            renderTemplates();

            // Load network ranges
            networkRanges = await json('/api/discovery/ranges');
            renderNetworkRanges();

            await loadSSHKeys();

            setDiscoveryMode(MODE_SCAN);
          } catch (error) {
            console.error('Failed to initialize wizard:', error);
            alert('Failed to load wizard data. Please refresh the page.');
          }
        }

        // Template rendering and selection
        function renderTemplates() {
          const grid = document.getElementById('template-grid');
          const filterSelect = document.getElementById('template-filter');
          if (!grid || !filterSelect) { return; }

          const filter = filterSelect.value;

          const filteredTemplates = filter ? templates.filter(t => t.kind === filter) : templates;

          grid.innerHTML = filteredTemplates.map(template => {
            const idValue = String(template.id ?? '');
            const badgeHTML = renderBadgeHTML(template.kind, template.platform);
            const nameHTML = escapeHTML(template.name || 'Untitled template');
            const descriptionHTML = escapeHTML(template.description || 'No description provided.');
            const platformHTML = escapeHTML(template.platform || '—');
            const kindHTML = escapeHTML(template.kind || '—');
            return `
              <div class="template-card" tabindex="0" data-template-id="${escapeHTML(idValue)}">
                <div class="template-card-header">
                  <div class="template-title-section">
                    <h3 class="template-name">${nameHTML}</h3>
                    ${badgeHTML}
                  </div>
                  <div class="template-icon">
                    ${getTemplateIcon(template.kind)}
                  </div>
                </div>
                <div class="template-description">
                  <p>${descriptionHTML}</p>
                </div>
                <div class="template-meta">
                  <div class="meta-item">
                    <span class="meta-label">Platform</span>
                    <span class="meta-value">${platformHTML}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">Type</span>
                    <span class="meta-value">${kindHTML}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('');
        }

        function getTemplateIcon(kind) {
          const icons = {
            'router': '🌐',
            'access_point': '📡',
            'printer': '🖨️',
            'server': '🖥️',
            'modem': '📶',
            'firewall': '🛡️',
            'switch': '🔀',
            'gateway': '🚪'
          };
          return icons[kind] || '📱';
        }

        function selectTemplate(templateId, sourceCard) {
          selectedTemplate = templates.find(t => String(t.id) === String(templateId));
          if (!selectedTemplate) { return; }

          const cards = Array.from(document.querySelectorAll('.template-card'));
          const selectedCard = sourceCard || cards.find(card => String(card.dataset.templateId) === String(templateId));
          if (!selectedCard) { return; }

          cards.forEach(card => {
            card.classList.remove('selected');
            if (card !== selectedCard) {
              card.classList.add('fade-out-others');
            } else {
              card.classList.remove('fade-out-others');
            }
          });

          selectedCard.classList.add('selected');

          // Auto-advance to next step after animation
          setTimeout(() => {
            animateToNextStep();
          }, 500);
        }

        function animateToNextStep() {
          if (currentStep === 1 && selectedTemplate) {
            // Add completion class to trigger fade out animation
            const step1 = document.getElementById('step-1');
            step1.classList.add('template-selection-complete');

            // Wait for fade out, then proceed to next step
            setTimeout(() => {
              nextStep();

              // Add entrance animation to discovery section
              setTimeout(() => {
                const discoverySection = document.querySelector('.discovery-section');
                if (discoverySection) {
                  discoverySection.classList.add('animate-in');
                }
              }, 100);
            }, 500);
          }
        }

        // Network discovery
        function renderNetworkRanges() {
          const select = document.getElementById('network-range');
          select.innerHTML = networkRanges.map(range =>
            `<option value="${range.network}">${range.network} (${range.start} - ${range.end})</option>`
          ).join('');
        }

        async function loadSSHKeys() {
          try {
            sshKeys = await json('/api/ssh-keys');
          } catch (error) {
            console.error('Failed to load SSH keys:', error);
            sshKeys = [];
            if (!sshKeyLoadErrorNotified) {
              alert('SSH key manager is unavailable. You can still provide a filesystem path.');
              sshKeyLoadErrorNotified = true;
            }
          }
          refreshSSHKeySelect();
        }

        function refreshSSHKeySelect(preservedValue) {
          const select = document.getElementById('ssh-key-select');
          const hidden = document.getElementById('ssh-key-hidden');
          if (!select || !hidden) {
            return;
          }

          const currentValue = preservedValue !== undefined ? preservedValue : hidden.value;
          const existingValues = new Set();

          select.innerHTML = '';

          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = sshKeys.length ? 'Select a saved key' : 'No saved keys available';
          select.appendChild(placeholder);
          existingValues.add('');

          sshKeys.forEach(key => {
            const option = document.createElement('option');
            const reference = `${SSH_KEY_REFERENCE_PREFIX}${key.id}`;
            option.value = reference;
            option.textContent = `${key.name} (${key.fingerprint})`;
            select.appendChild(option);
            existingValues.add(reference);
          });

          const pathOption = document.createElement('option');
          pathOption.value = SSH_KEY_PATH_OPTION;
          pathOption.textContent = 'Use filesystem path';
          select.appendChild(pathOption);
          existingValues.add(SSH_KEY_PATH_OPTION);

          if (currentValue && currentValue.startsWith(SSH_KEY_REFERENCE_PREFIX) && !existingValues.has(currentValue)) {
            const missingOption = document.createElement('option');
            missingOption.value = currentValue;
            missingOption.textContent = `Stored key ${currentValue.replace(SSH_KEY_REFERENCE_PREFIX, '#')}`;
            select.appendChild(missingOption);
          }

          setSSHKeySelection(currentValue);
        }

        function setSSHKeySelection(value) {
          const select = document.getElementById('ssh-key-select');
          const hidden = document.getElementById('ssh-key-hidden');
          const pathInput = document.getElementById('ssh-key-path-input');
          if (!select || !hidden || !pathInput) {
            return;
          }

          if (value && value.startsWith(SSH_KEY_REFERENCE_PREFIX)) {
            select.value = value;
            hidden.value = value;
            pathInput.value = '';
            pathInput.classList.add('hidden');
          } else if (value) {
            select.value = SSH_KEY_PATH_OPTION;
            hidden.value = value;
            pathInput.value = value;
            pathInput.classList.remove('hidden');
          } else {
            select.value = '';
            hidden.value = '';
            pathInput.value = '';
            pathInput.classList.add('hidden');
          }

          deviceConfig.ssh_key = hidden.value;
        }

        function initializeSSHKeyField(initialValue, placeholder) {
          const select = document.getElementById('ssh-key-select');
          const hidden = document.getElementById('ssh-key-hidden');
          const pathInput = document.getElementById('ssh-key-path-input');
          if (!select || !hidden || !pathInput) {
            return;
          }

          if (placeholder) {
            pathInput.setAttribute('placeholder', placeholder);
          }

          refreshSSHKeySelect(initialValue);

          select.addEventListener('change', () => {
            const selection = select.value;
            if (selection === SSH_KEY_PATH_OPTION) {
              pathInput.classList.remove('hidden');
              hidden.value = pathInput.value.trim();
            } else if (selection === '') {
              hidden.value = '';
              pathInput.value = '';
              pathInput.classList.add('hidden');
            } else {
              hidden.value = selection;
              pathInput.value = '';
              pathInput.classList.add('hidden');
            }
            deviceConfig.ssh_key = hidden.value;
          });

          pathInput.addEventListener('input', () => {
            hidden.value = pathInput.value.trim();
            deviceConfig.ssh_key = hidden.value;
          });
        }

        function openSSHKeyManager() {
          const overlay = document.getElementById('ssh-key-manager');
          if (!overlay) return;
          overlay.classList.add('active');
          const viewer = document.getElementById('ssh-key-viewer');
          if (viewer) {
            viewer.classList.add('hidden');
            viewer.textContent = '';
          }
          renderSSHKeyList();
        }

        function closeSSHKeyManager() {
          const overlay = document.getElementById('ssh-key-manager');
          if (!overlay) return;
          overlay.classList.remove('active');
          const viewer = document.getElementById('ssh-key-viewer');
          if (viewer) {
            viewer.classList.add('hidden');
            viewer.textContent = '';
          }
        }

        function renderSSHKeyList() {
          const list = document.getElementById('ssh-key-list');
          const viewer = document.getElementById('ssh-key-viewer');
          if (!list) return;

          if (sshKeys.length === 0) {
            list.innerHTML = '<div class="key-empty">No SSH keys saved yet. Add one below.</div>';
            if (viewer) {
              viewer.classList.add('hidden');
              viewer.textContent = '';
            }
            return;
          }

          list.innerHTML = sshKeys.map(key => {
            const added = formatTimestamp(key.created_at);
            return `
              <div class="key-item" data-key-id="${escapeHTML(String(key.id))}">
                <div class="key-meta">
                  <strong>${escapeHTML(key.name)}</strong>
                  <span>Fingerprint: ${escapeHTML(key.fingerprint)}</span>
                  <span>Added: ${escapeHTML(added)}</span>
                </div>
                <div class="key-actions">
                  <button type="button" class="btn btn-outline" data-action="view">View</button>
                  <button type="button" class="btn btn-outline" data-action="use">Use</button>
                  <button type="button" class="btn btn-secondary" data-action="delete">Delete</button>
                </div>
              </div>
            `;
          }).join('');
        }

        async function addNewSSHKey() {
          const nameInput = document.getElementById('new-ssh-key-name');
          const contentInput = document.getElementById('new-ssh-key-content');
          if (!nameInput || !contentInput) return;

          const name = nameInput.value.trim();
          const keyMaterial = contentInput.value.trim();

          if (!name || !keyMaterial) {
            alert('Please provide both a name and key content.');
            return;
          }

          try {
            const response = await json('/api/ssh-keys', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, private_key: keyMaterial })
            });

            nameInput.value = '';
            contentInput.value = '';

            await loadSSHKeys();
            renderSSHKeyList();
            setSSHKeySelection(response.reference);
            alert('SSH key saved. It has been selected for the device.');
          } catch (error) {
            alert('Failed to save SSH key: ' + error.message);
          }
        }

        async function deleteSSHKey(id) {
          if (!confirm('Delete this SSH key? This cannot be undone.')) {
            return;
          }

          try {
            await json(`/api/ssh-keys/${id}`, { method: 'DELETE' });
            sshKeys = sshKeys.filter(key => key.id !== id);
            renderSSHKeyList();
            refreshSSHKeySelect();

            const hidden = document.getElementById('ssh-key-hidden');
            if (hidden && hidden.value === `${SSH_KEY_REFERENCE_PREFIX}${id}`) {
              setSSHKeySelection('');
            }
          } catch (error) {
            alert('Failed to delete SSH key: ' + error.message);
          }
        }

        async function viewSSHKey(id) {
          try {
            const detail = await json(`/api/ssh-keys/${id}`);
            const viewer = document.getElementById('ssh-key-viewer');
            if (viewer) {
              viewer.classList.remove('hidden');
              viewer.textContent = detail.private_key;
            }
          } catch (error) {
            alert('Failed to load SSH key: ' + error.message);
          }
        }

        function selectSSHKeyFromManager(id) {
          setSSHKeySelection(`${SSH_KEY_REFERENCE_PREFIX}${id}`);
          closeSSHKeyManager();
        }

        async function startDiscovery() {
          const networkRange = document.getElementById('network-range').value;
          const selectedRange = networkRanges.find(r => r.network === networkRange);

          if (!selectedRange) {
            alert('Please select a network range to scan.');
            return;
          }

          await performDiscovery(selectedRange);
        }

        async function performDiscovery(range) {
          const portScanCheckbox = document.getElementById('port-scan');
          const portScan = portScanCheckbox ? portScanCheckbox.checked : true;

          document.getElementById('discovery-loading').classList.remove('hidden');
          document.getElementById('discovery-results').classList.add('hidden');

          try {
            const response = await json('/api/discovery/scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                network: range.network || '',
                start: range.start || '',
                end: range.end || '',
                options: {
                  port_scan: portScan,
                  timeout: 3000000000, // 3 seconds in nanoseconds
                  max_concurrent: 50
                }
              })
            });

            const devices = Array.isArray(response.devices) ? response.devices : [];

            sessionStorage.setItem('discoveredDevices', JSON.stringify(devices));

            renderDiscoveredDevices(devices);
            document.getElementById('discovery-results').classList.remove('hidden');
          } catch (error) {
            console.error('Discovery failed:', error);
            alert('Network discovery failed: ' + error.message);
          } finally {
            document.getElementById('discovery-loading').classList.add('hidden');
          }
        }

        function isValidIPv4(ip) {
          const parts = ip.split('.');
          if (parts.length !== 4) return false;
          return parts.every(part => {
            if (!/^\d+$/.test(part)) return false;
            const value = Number(part);
            return value >= 0 && value <= 255;
          });
        }

        function isValidCIDR(value) {
          const match = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/);
          if (!match) return false;
          for (let i = 1; i <= 4; i++) {
            const octet = Number(match[i]);
            if (octet < 0 || octet > 255) {
              return false;
            }
          }
          return true;
        }

        function ipToNumber(ip) {
          return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0);
        }

        function parseManualInput(value) {
          const trimmed = value.trim();
          if (!trimmed) return null;

          if (trimmed.includes('/')) {
            if (isValidCIDR(trimmed)) {
              return { type: 'cidr', network: trimmed };
            }
            return null;
          }

          if (trimmed.includes('-')) {
            const parts = trimmed.split('-');
            if (parts.length !== 2) return null;
            const start = parts[0].trim();
            const end = parts[1].trim();
            if (!isValidIPv4(start) || !isValidIPv4(end)) return null;
            if (ipToNumber(start) > ipToNumber(end)) return null;
            return { type: 'range', start, end };
          }

          if (isValidIPv4(trimmed)) {
            return { type: 'single', ip: trimmed };
          }

          return null;
        }

        async function useManualDevice() {
          const input = document.getElementById('manual-device-ip');
          if (!input) return;

          const value = (input.value || '').trim();
          if (!value) {
            alert('Please enter a device address.');
            return;
          }

          const parsed = parseManualInput(value);
          if (!parsed) {
            alert('Enter a valid IPv4 address, range (start-end), or CIDR block.');
            return;
          }

          if (parsed.type === 'single') {
            const manualDevice = {
              ip: parsed.ip,
              hostname: '',
              open_ports: [],
              suggestions: [],
              ping_time: null,
              manual: true
            };

            const stored = sessionStorage.getItem('discoveredDevices');
            let devices = [];

            if (stored) {
              try {
                const existing = JSON.parse(stored);
                if (Array.isArray(existing)) {
                  devices = existing;
                }
              } catch (error) {
                console.error('Failed to parse stored devices', error);
              }
            }

            if (!devices.some(d => d.ip === parsed.ip)) {
              devices.push(manualDevice);
            }

            sessionStorage.setItem('discoveredDevices', JSON.stringify(devices));
            renderDiscoveredDevices(devices);
            document.getElementById('discovery-results').classList.remove('hidden');
            document.getElementById('discovery-loading').classList.add('hidden');

            deviceConfig.host = parsed.ip;
            selectedDevice = manualDevice;

            if (!deviceConfig.name) {
              deviceConfig.name = deriveDefaultDeviceName(manualDevice);
            }

            selectDiscoveredDevice(parsed.ip);
            input.value = '';
            return;
          }

          if (parsed.type === 'range') {
            await performDiscovery({ network: '', start: parsed.start, end: parsed.end });
            input.value = '';
            return;
          }

          if (parsed.type === 'cidr') {
            await performDiscovery({ network: parsed.network, start: '', end: '' });
            input.value = '';
          }
        }

        function renderDiscoveredDevices(devices) {
          const grid = document.getElementById('device-grid');

          if (!Array.isArray(devices)) {
            console.warn('renderDiscoveredDevices expected an array. Got:', devices);
            devices = [];
          }

          if (devices.length === 0) {
            grid.innerHTML = '<p>No devices found. Try a different network range or skip discovery.</p>';
            return;
          }

          grid.innerHTML = devices.map(device => {
            const openPorts = Array.isArray(device.open_ports) ? device.open_ports : [];
            const suggestions = Array.isArray(device.suggestions) ? device.suggestions : [];
            const pingTime = typeof device.ping_time === 'number' ? `${device.ping_time.toFixed(1)}ms` : '--';

            return `
            <div class="device-card" data-device-ip="${device.ip}">
              <div class="device-info">
                <span class="device-ip">${device.ip}</span>
                <span class="device-ping">${pingTime}</span>
              </div>
              ${device.hostname ? `<div class="device-hostname">${device.hostname}</div>` : ''}
              <div class="device-services">
                ${openPorts.map(port => `<span class="service-tag">Port ${port}</span>`).join('')}
              </div>
              ${suggestions.length > 0 ? `
                <div class="suggestions">
                  ${suggestions.map(s => `<span class="suggestion-tag">${s}</span>`).join('')}
                </div>
              ` : ''}
            </div>
          `;
          }).join('');
        }

        function selectDiscoveredDevice(ip, cardElement) {
          const stored = sessionStorage.getItem('discoveredDevices');
          let devices = [];

          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              if (Array.isArray(parsed)) {
                devices = parsed;
              }
            } catch (error) {
              console.error('Failed to parse stored devices', error);
            }
          }

          selectedDevice = devices.find(d => d.ip === ip);

          // Update UI
          document.querySelectorAll('.device-card').forEach(card => {
            card.classList.remove('selected');
          });
          const card = cardElement ? cardElement.closest('.device-card') : document.querySelector(`[data-device-ip="${ip}"]`);
          if (card) {
            card.classList.add('selected');
          }

          // Pre-fill device config
          if (selectedDevice) {
            deviceConfig.host = selectedDevice.ip;
            if (selectedDevice.hostname) {
              deviceConfig.name = selectedDevice.hostname.split('.')[0];
            }

            if (!deviceConfig.name) {
              deviceConfig.name = deriveDefaultDeviceName(selectedDevice);
            }

            // Auto-select template based on suggestions
            const suggestions = Array.isArray(selectedDevice.suggestions) ? selectedDevice.suggestions : [];
            if (suggestions.length > 0 && !selectedTemplate) {
              const suggestedTemplate = templates.find(t => t.id === suggestions[0]);
              if (suggestedTemplate) {
                selectedTemplate = suggestedTemplate;
              }
            }
          }
        }

        function skipDiscovery() {
          // Just proceed to next step
          nextStep();
        }

        // Form generation and validation
        function generateConfigForm() {
          if (!selectedTemplate) return;

          const form = document.getElementById('device-form');

          const nameField = selectedTemplate.fields.find(field => field.name === 'name');
          if (nameField && !deviceConfig[nameField.name]) {
            deviceConfig[nameField.name] = deriveDefaultDeviceName();
          }

          form.innerHTML = selectedTemplate.fields.map(field => {
            const value = deviceConfig[field.name] || field.default || '';

            if (field.name === 'ssh_key') {
              return `
                <div class="form-group" id="ssh-key-form-group">
                  <label>${field.label}${field.required ? ' *' : ''}</label>
                  <div class="ssh-key-field-controls">
                    <select id="ssh-key-select" ${field.required ? 'required' : ''}></select>
                    <button type="button" class="btn btn-secondary" data-wizard-action="open-ssh-key-manager">Manage Keys</button>
                  </div>
                  <input type="text" id="ssh-key-path-input" class="hidden" placeholder="${field.placeholder || ''}">
                  <input type="hidden" name="${field.name}" id="ssh-key-hidden" value="${value}">
                  ${field.help ? `<div class="help">${field.help}</div>` : ''}
                </div>
              `;
            }

            let input = '';
            switch (field.type) {
              case 'select':
                input = `
                  <select name="${field.name}" ${field.required ? 'required' : ''}>
                    <option value="">Choose...</option>
                    ${field.options.map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                  </select>
                `;
                break;
              case 'textarea':
                input = `<textarea name="${field.name}" placeholder="${field.placeholder}" ${field.required ? 'required' : ''}>${value}</textarea>`;
                break;
              case 'password':
                input = `<input type="password" name="${field.name}" placeholder="${field.placeholder}" value="${value}" ${field.required ? 'required' : ''}>`;
                break;
              case 'number':
                input = `<input type="number" name="${field.name}" placeholder="${field.placeholder}" value="${value}" ${field.required ? 'required' : ''}>`;
                break;
              case 'file':
                input = `<input type="text" name="${field.name}" placeholder="${field.placeholder}" value="${value}" ${field.required ? 'required' : ''}>`;
                break;
              default:
                input = `<input type="text" name="${field.name}" placeholder="${field.placeholder}" value="${value}" ${field.required ? 'required' : ''}>`;
            }

            return `
              <div class="form-group">
                <label>${field.label}${field.required ? ' *' : ''}</label>
                ${input}
                ${field.help ? `<div class="help">${field.help}</div>` : ''}
              </div>
            `;
          }).join('');

          updateGuidancePanel(selectedTemplate);

          const sshField = selectedTemplate.fields.find(field => field.name === 'ssh_key');
          if (sshField) {
            const initialValue = deviceConfig['ssh_key'] || sshField.default || '';
            initializeSSHKeyField(initialValue, sshField.placeholder);
          }
        }

        function updateGuidancePanel(template) {
          const panel = document.getElementById('device-guidance');
          if (!panel) return;

          panel.classList.add('hidden');
          panel.innerHTML = '';

          if (!template) {
            return;
          }

          const messages = [];

          if ((template.platform || '').toLowerCase() === 'netgear') {
            messages.push('<strong>Netgear reboot fallback:</strong> Netgear devices cannot be rebooted over SSH. Store the web interface username and password so PulseOps can trigger a reboot if SSH access fails.');
            messages.push('Credentials saved here are only used for fallback automation tasks, such as web-based reboot operations.');
          } else if (template.requires_password) {
            messages.push('Store the web interface credentials so PulseOps can fall back to web automation whenever SSH access is unavailable.');
          }

          if (messages.length > 0) {
            panel.innerHTML = messages.map(msg => `<p>${msg}</p>`).join('');
            panel.classList.remove('hidden');
          }
        }

        function validateForm() {
          const form = document.getElementById('device-form');
          const formData = new FormData(form);

          // Clear previous errors
          document.querySelectorAll('.error').forEach(el => el.remove());

          let isValid = true;

          deviceConfig.meta = deviceConfig.meta || {};

          // Validate required fields
          selectedTemplate.fields.forEach(field => {
            const rawValue = formData.get(field.name);
            const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;

            if (field.required && (!value || value === '')) {
              showFieldError(field.name, `${field.label} is required`);
              isValid = false;
            }

            // Store in device config
            deviceConfig[field.name] = value;

            if (field.name === 'ssh_port') {
              if (value === '') {
                delete deviceConfig.meta.ssh_port;
                deviceConfig.ssh_port = '';
              } else {
                const port = parseInt(value, 10);
                if (Number.isNaN(port) || port <= 0 || port > 65535) {
                  showFieldError(field.name, 'Enter a valid SSH port between 1 and 65535');
                  isValid = false;
                } else {
                  deviceConfig.meta.ssh_port = String(port);
                  deviceConfig.ssh_port = String(port);
                }
              }
            }
          });

          // Set template-specific fields
          deviceConfig.kind = selectedTemplate.kind;
          deviceConfig.platform = selectedTemplate.platform;

          return isValid;
        }

        function showFieldError(fieldName, message) {
          const field = document.querySelector(`[name="${fieldName}"]`);
          if (field) {
            const error = document.createElement('div');
            error.className = 'error';
            error.textContent = message;
            field.parentNode.appendChild(error);
          }
        }

        // Device validation
        async function validateDevice() {
          document.getElementById('validation-loading').classList.remove('hidden');
          document.getElementById('validation-results').classList.add('hidden');

          try {
            const payload = buildDevicePayload();
            const result = await json('/api/devices/validate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });

            renderValidationResults(result);
            document.getElementById('validation-results').classList.remove('hidden');

            if (result.valid) {
              renderDeviceSummary();
              document.getElementById('final-summary').classList.remove('hidden');
            }
          } catch (error) {
            console.error('Validation failed:', error);
            alert('Device validation failed: ' + error.message);
          } finally {
            document.getElementById('validation-loading').classList.add('hidden');
          }
        }

        function renderValidationResults(result) {
          const container = document.getElementById('validation-results');

          let html = '';

          const errors = Array.isArray(result.errors) ? result.errors : [];
          const warnings = Array.isArray(result.warnings) ? result.warnings : [];
          const tests = result.tests || {};

          if (errors.length > 0) {
            html += '<h4>Errors</h4>';
            errors.forEach(error => {
              html += `<div class="validation-item validation-error">❌ ${error}</div>`;
            });
          }

          if (warnings.length > 0) {
            html += '<h4>Warnings</h4>';
            warnings.forEach(warning => {
              html += `<div class="validation-item validation-warning">⚠️ ${warning}</div>`;
            });
          }

          if (tests) {
            html += '<h4>Connectivity Tests</h4>';

            if (tests.ping) {
              const ping = tests.ping;
              const timeDisplay = typeof ping.time_ms === 'number' ? ping.time_ms.toFixed(1) + 'ms' : (ping.time_ms || '--');
              if (ping.success) {
                html += `<div class="validation-item validation-success">✅ Ping test passed (${timeDisplay})</div>`;
              } else {
                html += `<div class="validation-item validation-error">❌ Ping test failed: ${ping.error}</div>`;
              }
            }

            if (tests.ssh_port) {
              const portTest = tests.ssh_port;
              if (portTest.success) {
                html += `<div class="validation-item validation-success">✅ SSH port ${portTest.port || '22'} accepted</div>`;
              } else {
                const message = portTest.error || 'SSH port is invalid';
                html += `<div class="validation-item validation-error">❌ ${message}</div>`;
              }
            }

            if (tests.ports) {
              Object.entries(tests.ports).forEach(([port, test]) => {
                if (test.success) {
                  html += `<div class="validation-item validation-success">✅ ${port} is accessible</div>`;
                } else {
                  html += `<div class="validation-item validation-warning">⚠️ ${port} is not accessible</div>`;
                }
              });
            }

            if (tests.ssh_key) {
              html += `<div class="validation-item validation-success">✅ SSH key file exists</div>`;
            }
          }

          if (result.valid) {
            html += '<div class="validation-item validation-success">✅ Device configuration is valid and ready to be added</div>';
          }

          container.innerHTML = html;
        }

        function renderDeviceSummary() {
          const container = document.getElementById('device-summary');
          const portValue = deviceConfig.meta?.ssh_port || '22';
          const portLabel = portValue === '22' ? '22 (default)' : portValue;

          container.innerHTML = `
            <div class="summary-card">
              <h4>${deviceConfig.name}</h4>
              <p><strong>Host:</strong> ${deviceConfig.host}</p>
              <p><strong>Type:</strong> ${selectedTemplate.name} (${deviceConfig.platform})</p>
              <p><strong>SSH Port:</strong> ${portLabel}</p>
              <p><strong>User:</strong> ${deviceConfig.user || 'Not specified'}</p>
              ${deviceConfig.ssh_key ? `<p><strong>SSH Key:</strong> ${deviceConfig.ssh_key}</p>` : ''}
            </div>
          `;
        }

        function buildDevicePayload() {
          const payload = { ...deviceConfig };
          const meta = { ...(deviceConfig.meta || {}) };

          if (meta.ssh_port === '' || meta.ssh_port === undefined) {
            delete meta.ssh_port;
          }

          if (Object.keys(meta).length > 0) {
            payload.meta = meta;
          } else {
            delete payload.meta;
          }

          if (Object.prototype.hasOwnProperty.call(payload, 'ssh_port')) {
            delete payload.ssh_port;
          }

          return payload;
        }

        // Finish wizard
        async function finishWizard() {
          try {
            const payload = buildDevicePayload();
            const response = await json('/api/devices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });

            alert('Device added successfully!');
            window.location.href = '/';
          } catch (error) {
            console.error('Failed to create device:', error);
            alert('Failed to create device: ' + error.message);
          }
        }

        // Keyboard navigation
        let selectedTemplateIndex = -1;
        let selectedDeviceIndex = -1;

        function updateTemplateSelection(index) {
          const cards = document.querySelectorAll('.template-card:not(.fade-out-others)');
          if (cards.length === 0) return;

          // Remove previous selection
          cards.forEach(card => card.classList.remove('keyboard-selected'));

          // Wrap around
          if (index < 0) index = cards.length - 1;
          if (index >= cards.length) index = 0;

          selectedTemplateIndex = index;
          cards[index].classList.add('keyboard-selected');
          cards[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function updateDeviceSelection(index) {
          const cards = document.querySelectorAll('.device-card');
          if (cards.length === 0) return;

          // Remove previous selection
          cards.forEach(card => card.classList.remove('keyboard-selected'));

          // Wrap around
          if (index < 0) index = cards.length - 1;
          if (index >= cards.length) index = 0;

          selectedDeviceIndex = index;
          cards[index].classList.add('keyboard-selected');
          cards[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function handleKeyboardNavigation(event) {
          // Don't interfere with form inputs
          if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') {
            return;
          }

          switch (event.key) {
            case 'ArrowUp':
            case 'ArrowLeft':
              event.preventDefault();
              if (currentStep === 1) {
                updateTemplateSelection(selectedTemplateIndex - 1);
              } else if (currentStep === 2) {
                updateDeviceSelection(selectedDeviceIndex - 1);
              }
              break;

            case 'ArrowDown':
            case 'ArrowRight':
              event.preventDefault();
              if (currentStep === 1) {
                updateTemplateSelection(selectedTemplateIndex + 1);
              } else if (currentStep === 2) {
                updateDeviceSelection(selectedDeviceIndex + 1);
              }
              break;

            case 'Enter':
              event.preventDefault();
              if (currentStep === 1 && selectedTemplateIndex >= 0) {
                const cards = document.querySelectorAll('.template-card:not(.fade-out-others)');
                const templateCard = cards[selectedTemplateIndex];
                if (templateCard) {
                  const templateId = templateCard.dataset.templateId;
                  if (templateId) {
                    selectTemplate(templateId, templateCard);
                  }
                }
              } else if (currentStep === 2 && selectedDeviceIndex >= 0) {
                const cards = document.querySelectorAll('.device-card');
                if (cards[selectedDeviceIndex]) {
                  const deviceIp = cards[selectedDeviceIndex].dataset.deviceIp;
                  selectDiscoveredDevice(deviceIp, cards[selectedDeviceIndex]);
                }
              } else {
                // Trigger Next button
                const nextBtn = document.getElementById('next-btn');
                const finishBtn = document.getElementById('finish-btn');
                if (nextBtn && !nextBtn.style.display === 'none' && !nextBtn.disabled) {
                  nextStep();
                } else if (finishBtn && finishBtn.style.display !== 'none') {
                  finishWizard();
                }
              }
              break;

            case 'Escape':
              // Go back or exit
              if (currentStep > 1) {
                previousStep();
              } else {
                window.location.href = '/';
              }
              break;
          }
        }

        // Event listeners
        const templateFilter = document.getElementById('template-filter');
        if (templateFilter) {
          templateFilter.addEventListener('change', renderTemplates);
        }

        const templateGrid = document.getElementById('template-grid');
        if (templateGrid) {
          const handleTemplateActivation = (event) => {
            const card = event.target.closest('.template-card');
            if (!card || !templateGrid.contains(card)) {
              return;
            }
            const templateId = card.dataset.templateId;
            if (!templateId) {
              return;
            }
            selectTemplate(templateId, card);
          };

          templateGrid.addEventListener('click', (event) => {
            event.preventDefault();
            handleTemplateActivation(event);
          });

          templateGrid.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleTemplateActivation(event);
            }
          });
        }

        const sshKeyList = document.getElementById('ssh-key-list');
        if (sshKeyList) {
          sshKeyList.addEventListener('click', (event) => {
            const actionBtn = event.target.closest('button[data-action]');
            if (!actionBtn) { return; }
            const action = actionBtn.dataset.action;
            const keyId = actionBtn.closest('[data-key-id]')?.dataset?.keyId;
            if (!keyId) { return; }
            event.preventDefault();
            if (action === 'view') {
              viewSSHKey(keyId);
            } else if (action === 'use') {
              selectSSHKeyFromManager(keyId);
            } else if (action === 'delete') {
              deleteSSHKey(keyId);
            }
          });
        }

        const deviceGrid = document.getElementById('device-grid');
        if (deviceGrid) {
          deviceGrid.addEventListener('click', (event) => {
            const card = event.target.closest('.device-card');
            if (!card || !deviceGrid.contains(card)) {
              return;
            }
            const ip = card.dataset.deviceIp;
            if (!ip) { return; }
            selectDiscoveredDevice(ip, card);
          });
        }

        const modeToggle = document.querySelector('.mode-toggle');
        if (modeToggle) {
          modeToggle.addEventListener('click', (event) => {
            const button = event.target.closest('.mode-btn');
            if (!button || !modeToggle.contains(button)) {
              return;
            }
            const mode = button.dataset.mode;
            if (!mode) { return; }
            event.preventDefault();
            setDiscoveryMode(mode);
          });
        }

        document.addEventListener('click', (event) => {
          const actionTarget = event.target.closest('[data-wizard-action]');
          if (!actionTarget) { return; }
          const action = actionTarget.dataset.wizardAction;
          switch (action) {
            case 'open-ssh-key-manager':
              event.preventDefault();
              openSSHKeyManager();
              break;
            case 'close-ssh-key-manager':
              event.preventDefault();
              closeSSHKeyManager();
              break;
            case 'start-discovery':
              event.preventDefault();
              startDiscovery();
              break;
            case 'skip-discovery':
              event.preventDefault();
              skipDiscovery();
              break;
            case 'use-manual-device':
              event.preventDefault();
              useManualDevice();
              break;
            case 'prev-step':
              event.preventDefault();
              previousStep();
              break;
            case 'next-step':
              event.preventDefault();
              nextStep();
              break;
            case 'finish-wizard':
              event.preventDefault();
              finishWizard();
              break;
            case 'save-ssh-key':
              event.preventDefault();
              addNewSSHKey();
              break;
            default:
              break;
          }
        });

        document.addEventListener('keydown', handleKeyboardNavigation);

        // Reset keyboard selection when step changes
        const originalShowStep = showStep;
        showStep = function(step) {
          selectedTemplateIndex = -1;
          selectedDeviceIndex = -1;
          originalShowStep(step);
        };

        init();
  
  }

  function initLogin() {
        const loginForm = document.getElementById('login-form');
        const loginButton = document.getElementById('login-button');
        const loading = document.getElementById('loading');
        const errorMessage = document.getElementById('error-message');
        const successMessage = document.getElementById('success-message');

        function showError(message) {
          errorMessage.textContent = message;
          errorMessage.style.display = 'block';
          successMessage.style.display = 'none';
        }

        function showSuccess(message) {
          successMessage.textContent = message;
          successMessage.style.display = 'block';
          errorMessage.style.display = 'none';
        }

        function hideMessages() {
          errorMessage.style.display = 'none';
          successMessage.style.display = 'none';
        }

        function setLoading(isLoading) {
          if (isLoading) {
            loginForm.style.display = 'none';
            loading.style.display = 'flex';
          } else {
            loginForm.style.display = 'flex';
            loading.style.display = 'none';
          }
        }

        // Check authentication status
        async function checkAuthStatus() {
          try {
            const response = await fetch('/api/auth/status');
            const data = await response.json();
        
            if (!data.setup_completed) {
              window.location.href = '/setup.html';
              return;
            }
        
            if (data.authenticated) {
              window.location.href = '/';
              return;
            }
          } catch (error) {
            console.error('Failed to check auth status:', error);
          }
        }

        loginForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          hideMessages();

          const formData = new FormData(loginForm);
          const username = formData.get('username').trim();
          const password = formData.get('password');

          // Validation
          if (!username) {
            showError('Username is required');
            return;
          }

          if (!password) {
            showError('Password is required');
            return;
          }

          setLoading(true);

          try {
            const response = await fetch('/api/auth/login', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                username,
                password,
              }),
            });

            if (response.ok) {
              const data = await response.json();
              showSuccess('Login successful! Redirecting...');
              setTimeout(() => {
                window.location.href = '/';
              }, 1000);
            } else {
              const errorText = await response.text();
              showError(errorText || 'Invalid credentials');
            }
          } catch (error) {
            showError('Network error. Please try again.');
          } finally {
            setLoading(false);
          }
        });

        // Check auth status on page load
        checkAuthStatus();
  
  }

  function initSetup() {
        const setupForm = document.getElementById('setup-form');
        const setupButton = document.getElementById('setup-button');
        const loading = document.getElementById('loading');
        const errorMessage = document.getElementById('error-message');
        const successMessage = document.getElementById('success-message');

        function showError(message) {
          errorMessage.textContent = message;
          errorMessage.style.display = 'block';
          successMessage.style.display = 'none';
        }

        function showSuccess(message) {
          successMessage.textContent = message;
          successMessage.style.display = 'block';
          errorMessage.style.display = 'none';
        }

        function hideMessages() {
          errorMessage.style.display = 'none';
          successMessage.style.display = 'none';
        }

        function setLoading(isLoading) {
          if (isLoading) {
            setupForm.style.display = 'none';
            loading.style.display = 'flex';
          } else {
            setupForm.style.display = 'flex';
            loading.style.display = 'none';
          }
        }

        // Check if setup is already completed
        async function checkSetupStatus() {
          try {
            const response = await fetch('/api/auth/setup');
            const data = await response.json();
            if (data.setup_completed) {
              window.location.href = '/';
            }
          } catch (error) {
            console.error('Failed to check setup status:', error);
          }
        }

        setupForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          hideMessages();

          const formData = new FormData(setupForm);
          const username = formData.get('username').trim();
          const email = formData.get('email').trim();
          const password = formData.get('password');
          const confirmPassword = formData.get('confirm-password');

          // Validation
          if (!username) {
            showError('Username is required');
            return;
          }

          if (password.length < 6) {
            showError('Password must be at least 6 characters long');
            return;
          }

          if (password !== confirmPassword) {
            showError('Passwords do not match');
            return;
          }

          setLoading(true);

          try {
            const response = await fetch('/api/auth/setup', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                username,
                email: email || undefined,
                password,
              }),
            });

            if (response.ok) {
              const data = await response.json();
              showSuccess('Account created successfully! Redirecting...');
              setTimeout(() => {
                window.location.href = '/';
              }, 1500);
            } else {
              const errorText = await response.text();
              showError(errorText || 'Failed to create account');
            }
          } catch (error) {
            showError('Network error. Please try again.');
          } finally {
            setLoading(false);
          }
        });

        // Check setup status on page load
        checkSetupStatus();
  
  }
})();
