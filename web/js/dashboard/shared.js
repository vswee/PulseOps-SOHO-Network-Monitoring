/**
 * PulseOps Dashboard - Shared Utilities Module
 *
 * This module provides core utilities and services used across all dashboard views:
 * - Event bus for inter-component communication
 * - HTTP utilities for API calls
 * - Store pattern for state management (devices, auth, etc.)
 * - Toast notifications system
 * - Utility functions for common operations
 *
 * All functionality is exposed through the PulseOps.shared namespace.
 */
(function (window, document) {
  'use strict';

  const PulseOps = window.PulseOps = window.PulseOps || {};

  /**
   * Debug utility - checks if debug mode is enabled via ?debug=1 URL parameter
   * Persists across navigation using sessionStorage. Use ?debug=0 to clear.
   * @returns {boolean} True if debug mode is enabled
   */
  function isDebugEnabled() {
    const KEY = 'pulseops_debug_enabled';
    try {
      const url = new URL(window.location.href);
      const raw = (url.searchParams.get('debug') || '').toLowerCase();
      if (raw === '1' || raw === 'true') {
        sessionStorage.setItem(KEY, '1');
        return true;
      }
      if (raw === '0' || raw === 'false') {
        sessionStorage.removeItem(KEY);
        return false;
      }
    } catch (_) {
      // ignore URL parsing errors and fall back to storage
    }
    return sessionStorage.getItem(KEY) === '1';
  }

  /**
   * Debug logging utility - only logs if debug mode is enabled
   * @param {string} module - Module name for context
   * @param {string} message - Log message
   * @param {*} data - Optional data to log
   */
  function debugLog(module, message, data) {
    if (!isDebugEnabled()) return;
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${module}]`;
    if (data !== undefined) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  /** Append or update the debug param on a given URL string */
  function appendDebugParamToUrl(href) {
    try {
      const u = new URL(href, window.location.origin);
      if (isDebugEnabled()) {
        u.searchParams.set('debug', '1');
      }
      return u.pathname + u.search + u.hash;
    } catch (_) {
      return href;
    }
  }

  /** Ensure current URL shows ?debug=1 when enabled so copying the URL preserves it */
  function ensureUrlHasDebugWhenEnabled() {
    try {
      if (!isDebugEnabled()) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get('debug') !== '1') {
        url.searchParams.set('debug', '1');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    } catch (_) { /* noop */ }
  }

  /**
   * Check if the provided value looks like a valid IPv4 address.
   * Accepts dotted decimal notation where each octet is between 0 and 255.
   * @param {string} value
   * @returns {boolean}
   */
  function isValidIPv4(value) {
    const parts = String(value || '').trim().split('.');
    if (parts.length !== 4) { return false; }
    return parts.every((part) => {
      if (!/^[0-9]{1,3}$/.test(part)) { return false; }
      const n = Number(part);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }

  /**
   * Determine if an IPv4 address belongs to a private/reserved range.
   * @param {string} value
   * @returns {boolean}
   */
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

  /**
   * Basic IPv6 validator. Ensures only valid characters are present and colons exist.
   * @param {string} value
   * @returns {boolean}
   */
  function isValidIPv6(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed.includes(':')) { return false; }
    if (!/^[0-9a-f:.]+$/i.test(trimmed)) { return false; }
    return true;
  }

  /**
   * Determine if a value resembles an IP address of either family.
   * @param {string} value
   * @returns {boolean}
   */
  function isLikelyIPAddress(value) {
    if (isValidIPv4(value)) { return true; }
    if (isValidIPv6(value)) { return true; }
    return false;
  }

  /**
   * Intercept in-app link clicks and preserve the debug param on same-origin navigations.
   */
  function enableDebugLinkPropagation() {
    document.addEventListener('click', function (evt) {
      const a = evt.target instanceof Element ? evt.target.closest('a') : null;
      if (!a) return;
      // Don't modify if modified click, download, external, mailto, tel, or target=_blank
      if (evt.defaultPrevented || evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey) return;
      if (a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      // Only same-origin links
      const dest = new URL(href, window.location.origin);
      if (dest.origin !== window.location.origin) return;
      if (!isDebugEnabled()) return;
      const newHref = appendDebugParamToUrl(dest.href);
      if (newHref !== (dest.pathname + dest.search + dest.hash)) {
        a.setAttribute('href', newHref);
      }
    }, true);
  }

  /** Convenience helper for programmatic navigations */
  function withDebug(url) {
    return isDebugEnabled() ? appendDebugParamToUrl(url) : url;
  }

  /**
   * Deep clones a value using structuredClone if available, falling back to JSON methods
   * @param {*} value - The value to clone
   * @returns {*} A deep clone of the value
   */
  function cloneDeep(value) {
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch (_) {
        // Fallback to JSON methods below
      }
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  /**
   * Sample device data for development/testing
   * Contains representative network devices with various statuses and configurations
   */
  const SAMPLE_DEVICES = [
    {
      id: 'core-router-1',
      name: 'Core Router 1',
      host: '10.0.0.1',
      kind: 'router',
      platform: 'Juniper MX480',
      status: 'online',
      user: 'netops',
      site: 'DC West',
      platform_display: 'Juniper MX480',
      tags: ['core', 'edge'],
      updated_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      network_scope: 'lan',
      network_scope_reason: 'matched_local_subnet',
      network_scope_matched_subnet: '10.0.0.0/24',
      network_scope_private: true,
      network_scope_updated_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      network_classification: {
        classification: 'lan',
        ip: '10.0.0.1',
        matched_subnet: '10.0.0.0/24',
        private: true,
        reason: 'matched_local_subnet'
      }
    },
    {
      id: 'edge-firewall-2',
      name: 'Edge Firewall 2',
      host: '172.16.20.5',
      kind: 'firewall',
      platform: 'Palo Alto 5220',
      status: 'warning',
      user: 'secops',
      site: 'DMZ',
      tags: ['security'],
      platform_display: 'Palo Alto 5220',
      updated_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
      network_scope: 'local_vlan',
      network_scope_reason: 'private_nonlocal',
      network_scope_matched_subnet: '172.16.20.0/24',
      network_scope_private: true,
      network_scope_updated_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
      network_classification: {
        classification: 'local_vlan',
        ip: '172.16.20.5',
        matched_subnet: '172.16.20.0/24',
        private: true,
        reason: 'private_nonlocal'
      }
    },
    {
      id: 'branch-switch-7',
      name: 'Branch Switch 7',
      host: '192.168.50.12',
      kind: 'switch',
      platform: 'Arista 7050',
      status: 'offline',
      user: 'field',
      site: 'Retail - Madison',
      tags: ['branch'],
      platform_display: 'Arista 7050X3',
      updated_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
      network_scope: 'lan',
      network_scope_reason: 'matched_local_subnet',
      network_scope_matched_subnet: '192.168.50.0/24',
      network_scope_private: true,
      network_scope_updated_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
      network_classification: {
        classification: 'lan',
        ip: '192.168.50.12',
        matched_subnet: '192.168.50.0/24',
        private: true,
        reason: 'matched_local_subnet'
      }
    },
    {
      id: 'sdwan-edge-4',
      name: 'SD-WAN Edge 4',
      host: '203.0.113.4',
      kind: 'router',
      platform: 'Cisco Catalyst 8200',
      status: 'online',
      user: 'netops',
      site: 'London',
      tags: ['branch', 'sdwan'],
      platform_display: 'Cisco Catalyst 8200',
      updated_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      network_scope: 'remote',
      network_scope_reason: 'public_network',
      network_scope_private: false,
      network_scope_updated_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      network_classification: {
        classification: 'remote',
        ip: '203.0.113.4',
        private: false,
        reason: 'public_network'
      }
    }
  ];

  /**
   * Creates a simple event bus for pub/sub communication between components
   * @returns {Object} Event bus with emit() and on() methods
   */
  function createEventBus() {
    const target = new EventTarget();
    return {
      /**
       * Emits an event with optional detail data
       * @param {string} type - Event type/name
       * @param {*} detail - Event payload data
       */
      emit(type, detail) {
        target.dispatchEvent(new CustomEvent(type, { detail }));
      },
      /**
       * Subscribes to an event
       * @param {string} type - Event type to listen for
       * @param {Function} listener - Callback function
       * @param {Object} options - addEventListener options
       * @returns {Function} Unsubscribe function
       */
      on(type, listener, options) {
        target.addEventListener(type, listener, options);
        return () => target.removeEventListener(type, listener, options);
      }
    };
  }

  function createLoadingIndicator({ minVisibleMs = 420 } = {}) {
    const state = {
      container: null,
      bar: null,
      label: null,
      tasks: new Map(),
      visible: false,
      progress: 0,
      manualTarget: null,
      autoTimer: null,
      hideTimer: null,
      visibleAt: 0,
      minVisibleMs,
      lastLabel: 'Loading data...'
    };

    function clamp01(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        return 0;
      }
      return Math.min(1, Math.max(0, number));
    }

    function applyDomState() {
      if (state.container) {
        if (state.visible) {
          state.container.classList.add('global-loading--visible');
          state.container.setAttribute('aria-hidden', 'false');
        } else {
          state.container.classList.remove('global-loading--visible');
          state.container.setAttribute('aria-hidden', 'true');
        }
      }
      if (state.label) {
        state.label.textContent = state.lastLabel;
      }
      if (state.bar) {
        state.bar.style.setProperty('--loading-progress', `${(state.progress * 100).toFixed(1)}%`);
      }
    }

    function bindDom(dom = {}) {
      if (dom.container) { state.container = dom.container; }
      if (dom.bar) { state.bar = dom.bar; }
      if (dom.label) { state.label = dom.label; }
      applyDomState();
    }

    function setLabel(text) {
      if (typeof text === 'string' && text.trim()) {
        state.lastLabel = text.trim();
      }
      if (state.label) {
        state.label.textContent = state.lastLabel;
      }
    }

    function setProgress(value, { immediate = false } = {}) {
      const clamped = clamp01(value);
      state.progress = clamped;
      if (!state.bar) { return; }
      const percent = `${(clamped * 100).toFixed(1)}%`;
      if (immediate) {
        const previous = state.bar.style.transition;
        state.bar.style.transition = 'none';
        state.bar.style.setProperty('--loading-progress', percent);
        void state.bar.offsetWidth;
        state.bar.style.transition = previous || '';
      } else {
        state.bar.style.setProperty('--loading-progress', percent);
      }
    }

    function updateManualTarget() {
      const manualTasks = Array.from(state.tasks.values()).filter((task) => task.manual);
      if (!manualTasks.length) {
        state.manualTarget = null;
        return;
      }
      const total = manualTasks.reduce((sum, task) => sum + task.progress, 0);
      state.manualTarget = clamp01(total / manualTasks.length);
    }

    function stopAutoLoop() {
      if (state.autoTimer && typeof window !== 'undefined') {
        window.clearInterval(state.autoTimer);
      }
      state.autoTimer = null;
    }

    function startAutoLoop() {
      if (state.autoTimer || typeof window === 'undefined') {
        return;
      }
      state.autoTimer = window.setInterval(() => {
        if (!state.tasks.size) {
          stopAutoLoop();
          return;
        }
        // When we have no manual progress hints, ease toward 90% and pause there until completion.
        const target = state.manualTarget != null ? Math.min(0.95, state.manualTarget) : 0.9;
        if (state.progress >= target) {
          return;
        }
        const distance = Math.max(0, target - state.progress);
        const easedIncrement = Math.max(0.008, distance * 0.18);
        const next = Math.min(target, state.progress + easedIncrement);
        setProgress(next);
      }, 120);
    }

    function ensureVisible() {
      if (state.visible) {
        if (state.hideTimer && typeof window !== 'undefined') {
          window.clearTimeout(state.hideTimer);
          state.hideTimer = null;
        }
        return;
      }
      state.visible = true;
      state.visibleAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (state.hideTimer && typeof window !== 'undefined') {
        window.clearTimeout(state.hideTimer);
        state.hideTimer = null;
      }
      if (state.container) {
        state.container.classList.add('global-loading--visible');
        state.container.setAttribute('aria-hidden', 'false');
      }
      if (state.progress < 0.05) {
        setProgress(0.05);
      }
    }

    function hide() {
      if (state.container) {
        state.container.classList.remove('global-loading--visible');
        state.container.setAttribute('aria-hidden', 'true');
      }
      state.visible = false;
      state.visibleAt = 0;
      state.manualTarget = null;
      setProgress(0, { immediate: true });
      state.lastLabel = 'Loading data...';
      setLabel();
    }

    function complete() {
      stopAutoLoop();
      setProgress(1);
      if (typeof window === 'undefined') {
        hide();
        return;
      }
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = state.visibleAt ? (now - state.visibleAt) : 0;
      const delay = Math.max(220, state.minVisibleMs - elapsed);
      if (state.hideTimer) {
        window.clearTimeout(state.hideTimer);
      }
      state.hideTimer = window.setTimeout(() => {
        state.hideTimer = null;
        hide();
      }, delay);
    }

    function begin(meta = {}) {
      const token = meta.id || `load-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
      if (!state.tasks.has(token)) {
        state.tasks.set(token, { progress: 0, manual: false });
      }
      setLabel(meta.label);
      ensureVisible();
      startAutoLoop();
      updateManualTarget();
      return token;
    }

    function update(token, progress) {
      const clamped = clamp01(progress);
      if (token && state.tasks.has(token)) {
        const task = state.tasks.get(token);
        task.progress = clamped;
        task.manual = true;
      } else if (token == null && state.tasks.size) {
        state.manualTarget = clamp01(clamped);
      }
      updateManualTarget();
      if (state.manualTarget != null) {
        const target = Math.min(0.95, Math.max(state.progress, state.manualTarget));
        setProgress(target);
      } else if (!state.autoTimer) {
        setProgress(Math.min(0.9, Math.max(state.progress, clamped)));
      }
    }

    function done(token) {
      if (token && state.tasks.has(token)) {
        state.tasks.delete(token);
      }
      updateManualTarget();
      if (!state.tasks.size && state.visible) {
        complete();
      } else if (!state.tasks.size) {
        stopAutoLoop();
        setProgress(0, { immediate: true });
      }
    }

    function wrap(promise, meta) {
      const token = begin(meta);
      return Promise.resolve(promise)
        .finally(() => done(token));
    }

    return {
      bindDom,
      begin,
      update,
      done,
      wrap,
      isActive() {
        return state.visible || state.tasks.size > 0;
      }
    };
  }

  /**
   * Fetches JSON from an API endpoint with error handling
   * @param {string} url - The API endpoint URL
   * @param {Object} options - Fetch options (method, headers, body, etc.)
   * @returns {Promise<*>} Parsed JSON response or null for 204 responses
   * @throws {Error} If the request fails or response is not JSON
   */
  async function jsonFetch(url, options = {}) {
    const {
      skipLoading = false,
      loadingLabel = null,
      loadingId = null,
      ...fetchOptions
    } = options || {};

    const loadingService = !skipLoading ? (window.PulseOps?.shared?.loading || null) : null;
    const useLoading = loadingService && typeof loadingService.begin === 'function';
    const token = useLoading ? loadingService.begin({ id: loadingId, label: loadingLabel }) : null;

    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        const message = await response.text().catch(() => '') || response.statusText;
        throw new Error(message || `Request failed with status ${response.status}`);
      }
      if (response.status === 204) {
        return null;
      }
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return response.json();
      }
      return response.text();
    } finally {
      if (token && typeof loadingService?.done === 'function') {
        loadingService.done(token);
      }
    }
  }

  function createGeolocationService(options = {}) {
    const cache = new Map();
    const pending = new Map();
    const CACHE_TTL = 24 * 60 * 60 * 1000;
    const ERROR_TTL = 5 * 60 * 1000;
    const fetcher = typeof options.fetcher === 'function'
      ? options.fetcher
      : (url, opts) => jsonFetch(url, { ...(opts || {}), skipLoading: true });

    function normalise(ip) {
      return String(ip ?? '').trim();
    }

    function entryValid(entry) {
      if (!entry) { return false; }
      const ttl = entry.error ? ERROR_TTL : CACHE_TTL;
      return Date.now() - entry.timestamp < ttl;
    }

    function peek(ip) {
      const key = normalise(ip);
      if (!key) { return null; }
      const entry = cache.get(key);
      if (!entry) { return null; }
      if (!entryValid(entry)) {
        cache.delete(key);
        return null;
      }
      return entry.data;
    }

    function isPending(ip) {
      const key = normalise(ip);
      if (!key) { return false; }
      return pending.has(key);
    }

    async function get(ip, opts = {}) {
      const key = normalise(ip);
      if (!key) { return null; }
      const force = Boolean(opts.force);
      const existing = cache.get(key);
      if (!force && entryValid(existing)) {
        return existing.data;
      }
      if (pending.has(key)) {
        return pending.get(key);
      }
      const promise = (async () => {
        try {
          const data = await fetcher(`/api/ipinfo?ip=${encodeURIComponent(key)}`, { skipLoading: true });
          cache.set(key, {
            data,
            timestamp: Date.now(),
            error: Boolean(data?.error && data?.reason !== 'private_ip')
          });
          return data;
        } catch (error) {
          const errData = {
            ip: key,
            geolocated: false,
            error: 'request_failed',
            message: error?.message || 'Geolocation lookup failed'
          };
          cache.set(key, { data: errData, timestamp: Date.now(), error: true });
          throw errData;
        } finally {
          pending.delete(key);
        }
      })();
      pending.set(key, promise);
      return promise;
    }

    function clearExpired(now = Date.now()) {
      cache.forEach((entry, key) => {
        const ttl = entry.error ? ERROR_TTL : CACHE_TTL;
        if (now - entry.timestamp >= ttl) {
          cache.delete(key);
        }
      });
    }

    return { get, peek, isPending, clearExpired };
  }

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

  function formatDateTime(value) {
    if (!value) { return '—'; }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString();
  }

  const CLASSIFICATION_LABELS = {
    lan: 'Local (LAN)',
    local_vlan: 'Local VLAN',
    remote: 'Remote'
  };

  const CLASSIFICATION_REASON_LABELS = {
    matched_local_subnet: 'Matches a local subnet',
    private_nonlocal: 'Private network outside LAN',
    public_network: 'Public network',
    non_ipv4_address: 'Non-IPv4 address',
    unparseable_host: 'Unrecognised host',
    empty_host: 'No host configured',
    unspecified: 'Reason unavailable'
  };

  function normaliseClassificationValue(value) {
    if (value == null) {
      return null;
    }
    return String(value).toLowerCase();
  }

  function formatClassificationReason(reason) {
    const key = normaliseClassificationValue(reason);
    if (!key) {
      return null;
    }
    return CLASSIFICATION_REASON_LABELS[key] || key.replace(/[_\-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function resolveNetworkLocation(device) {
    if (!device || typeof device !== 'object') {
      return null;
    }

    const classification = device.network_classification && typeof device.network_classification === 'object'
      ? device.network_classification
      : null;
    const category = normaliseClassificationValue(classification?.classification ?? device.network_scope);
    if (!category) {
      return null;
    }

    const label = CLASSIFICATION_LABELS[category] || category.replace(/[_\-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    const reasonCode = classification?.reason ?? device.network_scope_reason ?? null;
    const reason = formatClassificationReason(reasonCode);
    const matchedSubnet = classification?.matched_subnet ?? device.network_scope_matched_subnet ?? null;
    const ip = classification?.ip ?? device.network_scope_ip ?? device.host ?? null;
    const isPrivate = typeof classification?.private === 'boolean'
      ? classification.private
      : typeof device.network_scope_private === 'boolean'
        ? device.network_scope_private
        : null;
    const updatedAtRaw = device.network_scope_updated_at ?? null;
    const updatedAt = updatedAtRaw ? new Date(updatedAtRaw) : null;

    const descriptionParts = [];
    if (reason) {
      descriptionParts.push(reason);
    }
    if (matchedSubnet) {
      descriptionParts.push(`Subnet ${matchedSubnet}`);
    }
    if (ip) {
      descriptionParts.push(`IP ${ip}`);
    }

    return {
      category,
      label,
      reason,
      reasonCode: reasonCode ?? null,
      matchedSubnet,
      ip,
      isPrivate,
      updatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
      updatedAtRaw,
      description: descriptionParts.length ? descriptionParts.join(' • ') : null,
      raw: classification
    };
  }

  function formatDuration(value) {
    const totalSeconds = Number(value);
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return '0s';
    }
    let remaining = Math.floor(totalSeconds);
    const parts = [];
    const hours = Math.floor(remaining / 3600);
    if (hours) {
      parts.push(`${hours}h`);
      remaining -= hours * 3600;
    }
    const minutes = Math.floor(remaining / 60);
    if (minutes) {
      parts.push(`${minutes}m`);
      remaining -= minutes * 60;
    }
    if (!hours && !minutes) {
      parts.push(`${remaining}s`);
    }
    return parts.join(' ');
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value)) {
      return '—';
    }
    if (value < 1024) {
      return `${Math.round(value)} B`;
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let current = value;
    let unit = 0;
    while (current >= 1024 && unit < units.length - 1) {
      current /= 1024;
      unit += 1;
    }
    const digits = current >= 10 ? 0 : 1;
    return `${current.toFixed(digits)} ${units[unit]}`;
  }

  function createElement(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'class') {
        el.className = value;
      } else if (key.startsWith('data-')) {
        el.setAttribute(key, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value != null) {
        el.setAttribute(key, value);
      }
    });
    children.flat().forEach(child => {
      if (child == null) { return; }
      if (child instanceof Node) {
        el.appendChild(child);
      } else {
        el.appendChild(document.createTextNode(String(child)));
      }
    });
    return el;
  }

  const PLATFORM_COLOR_LOOKUP = {
    'cisco': '#1ba0d7',
    'cisco catalyst': '#1ba0d7',
    'ios xe': '#1ba0d7',
    'meraki': '#16a34a',
    'juniper': '#005a8c',
    'juniper mx': '#005a8c',
    'arista': '#003b5c',
    'arista eos': '#003b5c',
    'palo alto': '#0072c6',
    'pan-os': '#0072c6',
    'fortinet': '#c71f2d',
    'fortigate': '#c71f2d',
    'checkpoint': '#005bc6',
    'huawei': '#d8342f',
    'huawei vrp': '#d8342f',
    'openwrt': '#4f46e5',
    'edgeos': '#0ea5e9',
    'vyos': '#0f766e',
    'mikrotik': '#5b21b6',
    'netgear': '#4c1d95',
    'ubiquiti': '#1e3a8a',
    'unifi': '#1e3a8a',
    'sonicwall': '#f97316',
    'silverpeak': '#0891b2',
    'versa': '#0ea5e9',
    'riverbed': '#dc2626',
    'watchguard': '#ef4444',
    'f5': '#b91c1c'
  };

  const PLATFORM_COLOR_PALETTE = [
    '#0ea5e9', '#2563eb', '#16a34a', '#a855f7', '#f97316', '#dc2626', '#0f766e', '#0284c7', '#7c3aed', '#1d4ed8', '#0369a1', '#ef4444'
  ];

  function normalisePlatformName(value) {
    return (value || '').toString().trim().toLowerCase();
  }

  function hexToRgb(hex) {
    const raw = (hex || '').toString().trim().replace(/^#/, '');
    if (raw.length === 3) {
      const r = parseInt(raw[0] + raw[0], 16);
      const g = parseInt(raw[1] + raw[1], 16);
      const b = parseInt(raw[2] + raw[2], 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) { return null; }
      return { r, g, b };
    }
    if (raw.length !== 6) { return null; }
    const value = parseInt(raw, 16);
    if (Number.isNaN(value)) { return null; }
    return {
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff
    };
  }

  function rgbToHex(r, g, b) {
    const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
    return `#${[clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  }

  function relativeLuminance({ r, g, b }) {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function pickContrastingTextColor(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) { return '#0b1120'; }
    const luminance = relativeLuminance(rgb);
    const whiteContrast = (1.05) / (luminance + 0.05);
    const blackContrast = (luminance + 0.05) / 0.05;
    return whiteContrast >= blackContrast ? '#ffffff' : '#0b1120';
  }

  function mixHex(hexA, hexB, weight) {
    const rgbA = hexToRgb(hexA);
    const rgbB = hexToRgb(hexB);
    if (!rgbA || !rgbB) { return hexA; }
    const w = Math.max(0, Math.min(1, Number(weight))); // clamp between 0 and 1
    const inv = 1 - w;
    return rgbToHex(
      rgbA.r * inv + rgbB.r * w,
      rgbA.g * inv + rgbB.g * w,
      rgbA.b * inv + rgbB.b * w
    );
  }

  function resolvePlatformColorKey(name) {
    const normalised = normalisePlatformName(name);
    if (!normalised) {
      return { key: 'unspecified', color: '#1f2937' };
    }
    if (PLATFORM_COLOR_LOOKUP[normalised]) {
      return { key: normalised, color: PLATFORM_COLOR_LOOKUP[normalised] };
    }
    const fragments = normalised.split(/[\s/\-_]+/g).filter(Boolean);
    for (let length = fragments.length; length > 0; length--) {
      const candidate = fragments.slice(0, length).join(' ');
      if (PLATFORM_COLOR_LOOKUP[candidate]) {
        return { key: candidate, color: PLATFORM_COLOR_LOOKUP[candidate] };
      }
    }
    for (const fragment of fragments) {
      if (PLATFORM_COLOR_LOOKUP[fragment]) {
        return { key: fragment, color: PLATFORM_COLOR_LOOKUP[fragment] };
      }
    }
    let hash = 0;
    for (let i = 0; i < normalised.length; i += 1) {
      hash = (hash * 31 + normalised.charCodeAt(i)) >>> 0;
    }
    const color = PLATFORM_COLOR_PALETTE[hash % PLATFORM_COLOR_PALETTE.length] || '#1f2937';
    return { key: normalised, color };
  }

  function resolvePlatformPalette(name) {
    const { key, color } = resolvePlatformColorKey(name);
    const fill = color || '#1f2937';
    const text = pickContrastingTextColor(fill);
    const accentBase = text === '#ffffff' ? '#ffffff' : '#000000';
    const mark = mixHex(fill, accentBase, text === '#ffffff' ? 0.18 : 0.12);
    const markText = text === '#ffffff' ? '#ffffff' : '#0b1120';
    return { key, fill, text, mark, markText };
  }

  function formatPlatformLabel(name) {
    const raw = (name || '').toString().trim();
    if (!raw) { return 'Unknown Platform'; }
    return raw.replace(/\s+/g, ' ');
  }

  function computePlatformInitials(name) {
    const label = formatPlatformLabel(name);
    const words = label.split(/\s+/g).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    const alnum = label.replace(/[^a-z0-9]/ig, '');
    if (alnum.length >= 2) {
      return (alnum[0] + alnum[alnum.length - 1]).toUpperCase();
    }
    if (alnum.length === 1) {
      return alnum[0].toUpperCase();
    }
    return '??';
  }

  function createPlatformBadgeElement(platformName, options = {}) {
    const palette = resolvePlatformPalette(platformName);
    const label = formatPlatformLabel(platformName);
    const badge = createElement('span', { class: 'platform-badge', title: label });
    if (options.variant) {
      badge.classList.add(`platform-badge--${options.variant}`);
    }
    badge.style.setProperty('--platform-badge-bg', palette.fill);
    badge.style.setProperty('--platform-badge-color', palette.text);
    badge.style.setProperty('--platform-badge-mark-bg', palette.mark);
    badge.style.setProperty('--platform-badge-mark-color', palette.markText);
    badge.dataset.platformKey = palette.key;

    const mark = createElement('span', { class: 'platform-badge-mark', 'aria-hidden': 'true' }, computePlatformInitials(label));
    const text = createElement('span', { class: 'platform-badge-label' }, label.toUpperCase());

    badge.appendChild(mark);
    badge.appendChild(text);
    return badge;
  }

  class ToastManager {
    constructor(container) {
      this.container = container || null;
      this.active = new Set();
    }

    show(options = {}) {
      if (!this.container) {
        console.warn('Toast container unavailable.');
        return () => {};
      }
      const toast = createElement('div', { class: 'toast' });
      const message = createElement('div', { class: 'toast-message' }, options.message || '');
      toast.appendChild(message);
      if (options.type) {
        toast.dataset.type = options.type;
      }
      if (options.actionText && typeof options.onAction === 'function') {
        const actionBtn = createElement('button', { class: 'toast-action', type: 'button' }, options.actionText);
        actionBtn.addEventListener('click', () => {
          try { options.onAction(); }
          finally { this.dismiss(toast); }
        });
        toast.appendChild(actionBtn);
      }
      const closeBtn = createElement('button', { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss notification' }, '×');
      closeBtn.addEventListener('click', () => this.dismiss(toast));
      toast.appendChild(closeBtn);
      this.container.appendChild(toast);
      this.active.add(toast);
      const duration = Number(options.duration ?? 4000);
      if (Number.isFinite(duration) && duration > 0) {
        setTimeout(() => this.dismiss(toast), duration);
      }
      return () => this.dismiss(toast);
    }

    dismiss(toast) {
      if (!toast || !this.active.has(toast)) { return; }
      this.active.delete(toast);
      toast.classList.add('toast-leave');
      toast.addEventListener('animationend', () => {
        toast.remove();
      });
    }
  }

  class ConfirmDialog {
    constructor(elements) {
      this.elements = elements;
      this.state = { resolver: null };
      this.handleBackdropClick = this.handleBackdropClick.bind(this);
    }

    open(options = {}) {
      const {
        title = 'Confirm action',
        message = 'Are you sure?',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        variant = 'primary',
        onConfirm,
        extraButtons = []
      } = options;
      this.elements.title.textContent = title;
      this.elements.message.textContent = message;
      this.elements.confirm.textContent = confirmText;
      this.elements.confirm.className = 'btn btn-' + variant;
      this.elements.cancel.textContent = cancelText;
      this.elements.extra.innerHTML = '';
      extraButtons.forEach((btn) => {
        if (!btn) { return; }
        const button = createElement('button', { type: 'button', class: btn.className || 'btn btn-secondary' }, btn.text || '');
        button.addEventListener('click', () => {
          if (typeof btn.onClick === 'function') {
            btn.onClick();
          }
          this.close(false);
        });
        this.elements.extra.appendChild(button);
      });
      this.state.onConfirm = onConfirm;
      this.state.promise = new Promise(resolve => {
        this.state.resolver = resolve;
      });
      this.elements.backdrop.classList.remove('hidden');
      document.addEventListener('keydown', this.handleEsc = (event) => {
        if (event.key === 'Escape') {
          this.close(false);
        }
      }, { once: true });
      this.elements.backdrop.addEventListener('click', this.handleBackdropClick);
      this.elements.confirm.addEventListener('click', this.handleConfirm = () => this.confirm());
      this.elements.cancel.addEventListener('click', this.handleCancel = () => this.close(false));
      return this.state.promise;
    }

    confirm() {
      const callback = this.state.onConfirm;
      const result = typeof callback === 'function' ? callback() : true;
      this.close(result !== false);
    }

    handleBackdropClick(event) {
      if (event.target === this.elements.backdrop) {
        this.close(false);
      }
    }

    close(confirmed) {
      this.elements.backdrop.classList.add('hidden');
      this.elements.extra.innerHTML = '';
      this.elements.confirm.removeEventListener('click', this.handleConfirm);
      this.elements.cancel.removeEventListener('click', this.handleCancel);
      this.elements.backdrop.removeEventListener('click', this.handleBackdropClick);
      if (typeof this.handleEsc === 'function') {
        document.removeEventListener('keydown', this.handleEsc);
        this.handleEsc = null;
      }
      if (this.state.resolver) {
        this.state.resolver(Boolean(confirmed));
        this.state.resolver = null;
      }
      this.state.onConfirm = null;
    }
  }

  /**
   * Creates a reactive store with lazy loading, caching, and subscription support
   *
   * The store implements a pub/sub pattern where:
   * - Data is loaded on-demand via the loader function
   * - Loaded data is cached and reused unless force=true
   * - Subscribers are notified whenever data changes
   * - Multiple concurrent load() calls are deduplicated
   *
   * @param {Function} loader - Async function that fetches the data
   * @param {Object} options - Configuration options
   * @param {*} options.fallback - Fallback data if loader fails
   * @returns {Object} Store with load(), get(), and subscribe() methods
   */
  function createStore(loader, { fallback } = {}) {
    let data = null;
    let loadingPromise = null;
    const subscribers = new Set();

    /**
     * Loads data from the loader function, with caching and deduplication
     * @param {boolean} force - If true, bypass cache and reload from source
     * @returns {Promise<*>} The loaded data
     */
    async function load(force = false) {
      // Return cached data if available and not forcing reload
      if (!force && data && !loadingPromise) {
        return data;
      }
      // Deduplicate concurrent load requests
      if (!loadingPromise) {
        loadingPromise = (async () => {
          try {
            data = await loader();
          } catch (error) {
            // Fall back to sample data on error
            console.warn('Falling back to sample data:', error);
            data = Array.isArray(fallback) ? cloneDeep(fallback) : fallback;
          } finally {
            loadingPromise = null;
          }
          // Notify all subscribers of the new data
          subscribers.forEach(listener => {
            try { listener(data); } catch (err) { console.error(err); }
          });
          return data;
        })();
      }
      return loadingPromise;
    }

    /**
     * Gets the currently cached data without loading
     * @returns {*} The cached data or null if not yet loaded
     */
    function get() {
      return data;
    }

    /**
     * Subscribes to data changes
     * @param {Function} listener - Callback function that receives the data
     * @returns {Function} Unsubscribe function
     */
    function subscribe(listener) {
      if (typeof listener !== 'function') { return () => {}; }
      subscribers.add(listener);
      // Immediately call listener with current data if available
      if (data != null) {
        try { listener(data); } catch (error) { console.error(error); }
      }
      return () => subscribers.delete(listener);
    }

    return { load, get, subscribe };
  }

  /**
   * Creates an authentication manager that handles user session and redirects
   *
   * Responsibilities:
   * - Check authentication status on app startup
   * - Redirect to setup/login if needed
   * - Display current user information
   * - Handle logout
   *
   * @param {Object} options - DOM elements for UI integration
   * @param {HTMLElement} options.userDisplay - Element to display username
   * @param {HTMLElement} options.logoutButton - Logout button element
   * @param {HTMLElement} options.menu - User menu element
   * @param {HTMLElement} options.trigger - Menu trigger button
   * @returns {Object} Auth manager with refresh() and logout() methods
   */
  function createAuthManager({ userDisplay, logoutButton, menu, trigger }) {
    const state = {
      setupCompleted: false,
      authenticated: false,
      user: null,
      checked: false
    };

    /**
     * Refreshes authentication status from the server
     * Redirects to setup/login if needed, updates UI with user info
     * @returns {Promise<Object>} Current auth state
     */
    async function refresh() {
      try {
        const result = await jsonFetch('/api/auth/status');
        Object.assign(state, {
          setupCompleted: Boolean(result?.setup_completed),
          authenticated: Boolean(result?.authenticated),
          user: result?.user || null,
          checked: true
        });
      } catch (error) {
        console.error('Failed to fetch auth status', error);
        state.checked = true;
        state.authenticated = false;
      }
      // Redirect to setup if not completed
      if (!state.setupCompleted) {
        window.location.replace(withDebug('/setup.html'));
        return state;
      }
      // Redirect to login if not authenticated
      if (!state.authenticated) {
        window.location.replace(withDebug('/login.html'));
        return state;
      }
      // Update UI with current user
      if (userDisplay && state.user?.username) {
        userDisplay.textContent = state.user.username;
      }
      return state;
    }

    /**
     * Logs out the current user
     * @returns {Promise<void>}
     */
    async function logout() {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } finally {
        window.location.replace(withDebug('/login.html'));
      }
    }

    function attachMenuHandlers() {
      if (!trigger || !menu) { return; }
      trigger.addEventListener('click', () => {
        menu.classList.toggle('hidden');
      });
      document.addEventListener('click', (event) => {
        if (trigger.contains(event.target) || menu.contains(event.target)) {
          return;
        }
        menu.classList.add('hidden');
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener('click', logout);
    }
    attachMenuHandlers();

    return { state, refresh, logout };
  }

  const AGENT_SEVERITY_RANK = {
    critical: 3,
    warning: 2,
    success: 1,
    info: 0
  };

  class PulseOpsAgent {
    constructor(shared) {
      this.shared = shared;
      this.dom = {
        container: null,
        toggle: null,
        panel: null,
        messageList: null,
        form: null,
        input: null,
        researchButton: null,
        closeButton: null,
        tooltipLayer: null
      };
      this.messages = [];
      this.tooltipEntries = [];
      this.routeContexts = new Map();
      this.routeSignatures = new Map();
      this.activeRoute = null;
      this.currentContext = null;
      this.isOpen = false;
      this.hasUnread = false;
      this.pendingTooltipFrame = null;
      this.deviceInventory = [];
      this.lastDeepResearchQuery = '';
      this.initialised = false;
      this.unsubscribeDevices = null;
      this.boundToggle = () => this.toggle();
      this.boundClose = () => this.close();
      this.boundSubmit = (event) => this.handleSubmit(event);
      this.boundResearch = () => this.handleDeepResearch();
      this.boundWindowPosition = () => {
        if (this.pendingTooltipFrame != null) {
          return;
        }
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
          this.positionTooltips();
          return;
        }
        this.pendingTooltipFrame = window.requestAnimationFrame(() => {
          this.pendingTooltipFrame = null;
          this.positionTooltips();
        });
      };
      this.boundKeydown = null;
    }

    setShared(shared) {
      this.shared = shared;
      this.subscribeToStores();
    }

    init() {
      if (this.initialised) { return; }
      this.initialised = true;
      this.ensureDom();
      this.subscribeToStores();
      this.updateResearchButton();
    }

    ensureDom() {
      if (typeof document === 'undefined') {
        return;
      }
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', () => this.ensureDom(), { once: true });
        return;
      }
      if (this.dom.container) {
        return;
      }
      this.createDom();
      this.renderMessages();
    }

    createDom() {
      if (typeof document === 'undefined') { return; }
      const container = createElement('div', { class: 'agent-assistant', 'data-agent': 'pulseops' });
      const toggle = createElement('button', {
        type: 'button',
        class: 'agent-toggle',
        'aria-label': 'Open PulseOps assistant',
        'aria-expanded': 'false'
      }, '🛰️');
      const panel = createElement('section', {
        class: 'agent-panel',
        role: 'dialog',
        'aria-modal': 'false',
        'aria-label': 'PulseOps network assistant'
      });
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');

      const header = createElement('header', { class: 'agent-panel-header' });
      const heading = createElement('div');
      heading.appendChild(createElement('h2', {}, 'PulseOps Agent'));
      heading.appendChild(createElement('p', {}, 'Synthesising live telemetry locally.'));
      const closeButton = createElement('button', {
        type: 'button',
        class: 'agent-panel-close',
        'aria-label': 'Close assistant'
      }, '×');
      header.appendChild(heading);
      header.appendChild(closeButton);

      const messageList = createElement('div', {
        class: 'agent-message-list',
        role: 'log',
        'aria-live': 'polite'
      });

      const form = createElement('form', { class: 'agent-input-area' });
      const input = createElement('textarea', {
        placeholder: 'Ask about the current view…',
        rows: '2'
      });
      const actionsRow = createElement('div', { class: 'agent-input-actions' });
      const sendButton = createElement('button', { type: 'submit', class: 'btn btn-primary agent-send-btn' }, 'Send');
      const researchButton = createElement('button', { type: 'button', class: 'btn btn-outline agent-research-btn' }, 'Deep research');
      actionsRow.appendChild(sendButton);
      actionsRow.appendChild(researchButton);
      form.appendChild(input);
      form.appendChild(actionsRow);

      panel.appendChild(header);
      panel.appendChild(messageList);
      panel.appendChild(form);

      container.appendChild(panel);
      container.appendChild(toggle);
      document.body.appendChild(container);

      let tooltipLayer = document.querySelector('.agent-tooltip-layer');
      if (!tooltipLayer) {
        tooltipLayer = createElement('div', { class: 'agent-tooltip-layer' });
        document.body.appendChild(tooltipLayer);
      }

      toggle.addEventListener('click', this.boundToggle);
      closeButton.addEventListener('click', this.boundClose);
      form.addEventListener('submit', this.boundSubmit);
      researchButton.addEventListener('click', this.boundResearch);

      if (typeof window !== 'undefined') {
        window.addEventListener('resize', this.boundWindowPosition);
        window.addEventListener('scroll', this.boundWindowPosition, true);
      }

      this.dom = {
        container,
        toggle,
        panel,
        messageList,
        form,
        input,
        researchButton,
        closeButton,
        tooltipLayer
      };
    }

    subscribeToStores() {
      const devicesStore = this.shared?.stores?.devices;
      if (!devicesStore || typeof devicesStore.subscribe !== 'function' || this.unsubscribeDevices) {
        return;
      }
      this.unsubscribeDevices = devicesStore.subscribe((devices) => {
        this.deviceInventory = Array.isArray(devices) ? devices.slice() : [];
      });
    }

    setActiveRoute(route) {
      this.activeRoute = route || null;
      this.updatePlaceholder(route);
      const context = route ? this.routeContexts.get(route) : null;
      if (context) {
        this.applyContext(context, { silent: true });
      }
      if (!this.messages.length) {
        this.addMessage('system', 'PulseOps agent ready. I will surface high-impact events as they arrive.');
      }
    }

    updatePlaceholder(route) {
      if (!this.dom.input) { return; }
      const readable = route ? route.replace(/[-_]/g, ' ') : 'PulseOps';
      this.dom.input.setAttribute('placeholder', `Ask about ${readable.trim() || 'PulseOps'}…`);
    }

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }

    open() {
      this.ensureDom();
      if (!this.dom.container || this.isOpen) {
        this.hasUnread = false;
        this.updateAttention();
        return;
      }
      this.isOpen = true;
      this.dom.container.classList.add('agent-assistant--open');
      this.dom.panel.hidden = false;
      this.dom.panel.setAttribute('aria-hidden', 'false');
      this.dom.toggle.setAttribute('aria-expanded', 'true');
      this.hasUnread = false;
      this.updateAttention();
      this.scrollMessages();
      if (!this.boundKeydown && typeof document !== 'undefined') {
        this.boundKeydown = (event) => {
          if (event.key === 'Escape') {
            this.close();
          }
        };
        document.addEventListener('keydown', this.boundKeydown);
      }
    }

    close() {
      if (!this.dom.container || !this.isOpen) {
        return;
      }
      this.isOpen = false;
      this.dom.container.classList.remove('agent-assistant--open');
      this.dom.panel.hidden = true;
      this.dom.panel.setAttribute('aria-hidden', 'true');
      this.dom.toggle.setAttribute('aria-expanded', 'false');
      if (this.boundKeydown && typeof document !== 'undefined') {
        document.removeEventListener('keydown', this.boundKeydown);
        this.boundKeydown = null;
      }
    }

    updateAttention() {
      if (!this.dom.toggle) { return; }
      this.dom.toggle.classList.toggle('agent-toggle--attention', this.hasUnread && !this.isOpen);
    }

    scrollMessages() {
      if (!this.dom.messageList) { return; }
      this.dom.messageList.scrollTop = this.dom.messageList.scrollHeight;
    }

    addMessage(role, text, options = {}) {
      if (!text && !options.suggestions?.length && !options.actions?.length) {
        return;
      }
      const message = {
        id: `msg-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
        role,
        text,
        severity: options.severity || null,
        suggestions: Array.isArray(options.suggestions) ? options.suggestions.slice(0, 6) : [],
        actions: Array.isArray(options.actions) ? options.actions.slice(0, 6) : [],
        relatedHighlights: Array.isArray(options.relatedHighlights) ? options.relatedHighlights.slice(0, 3) : [],
        deepResearch: options.deepResearch || '',
        highlight: options.highlight || null
      };
      this.messages.push(message);
      if (this.messages.length > 120) {
        this.messages = this.messages.slice(-120);
      }
      this.renderMessages();
    }

    createMessageElement(message) {
      const roleClass = `agent-message--${message.role}`;
      const severityClass = message.severity ? ` agent-message--severity-${message.severity}` : '';
      const wrapper = createElement('div', { class: `agent-message ${roleClass}${severityClass}` });
      const roleLabel = message.role === 'user' ? 'You'
        : message.role === 'system' ? 'PulseOps system'
          : 'PulseOps agent';
      wrapper.appendChild(createElement('div', { class: 'agent-message-role' }, roleLabel));
      if (message.text) {
        wrapper.appendChild(createElement('div', { class: 'agent-message-body' }, message.text));
      }
      if (message.suggestions.length) {
        const list = createElement('ul', { class: 'agent-suggestions' });
        message.suggestions.forEach((item) => list.appendChild(createElement('li', {}, item)));
        wrapper.appendChild(list);
      }
      if (message.actions.length) {
        const list = createElement('ul', { class: 'agent-suggestions' });
        message.actions.forEach((item) => list.appendChild(createElement('li', {}, item)));
        wrapper.appendChild(list);
      }
      const buttons = [];
      const highlights = message.relatedHighlights && message.relatedHighlights.length
        ? message.relatedHighlights
        : (message.highlight ? [message.highlight] : []);
      highlights.forEach((highlight) => {
        if (!highlight || !highlight.selector) { return; }
        const label = highlight.deviceName || highlight.title || 'View item';
        const btn = createElement('button', { type: 'button' }, `Reveal ${label}`);
        btn.addEventListener('click', () => this.showHighlight(highlight));
        buttons.push(btn);
      });
      if (message.deepResearch) {
        const btn = createElement('button', { type: 'button' }, 'Deep research');
        btn.addEventListener('click', () => this.openDeepResearch(message.deepResearch));
        buttons.push(btn);
      }
      if (buttons.length) {
        const container = createElement('div', { class: 'agent-message-actions' });
        buttons.forEach((btn) => container.appendChild(btn));
        wrapper.appendChild(container);
      }
      return wrapper;
    }

    renderMessages() {
      this.ensureDom();
      if (!this.dom.messageList) { return; }
      this.dom.messageList.innerHTML = '';
      const messages = this.messages.slice(-80);
      messages.forEach((message) => {
        const el = this.createMessageElement(message);
        this.dom.messageList.appendChild(el);
      });
      this.scrollMessages();
      this.updateResearchButton();
    }

    updateResearchButton() {
      if (!this.dom.researchButton) { return; }
      const query = this.lastDeepResearchQuery || this.buildFallbackResearchQuery();
      this.dom.researchButton.disabled = !query;
      if (query) {
        this.dom.researchButton.setAttribute('data-query', query);
      } else {
        this.dom.researchButton.removeAttribute('data-query');
      }
    }

    buildFallbackResearchQuery() {
      if (this.currentContext?.summary) {
        return `${this.currentContext.summary} PulseOps network response`;
      }
      const critical = (this.currentContext?.highlights || []).find((highlight) => highlight?.severity === 'critical');
      if (critical) {
        return this.buildHighlightResearchQuery(critical);
      }
      return '';
    }

    handleDeepResearch() {
      const queryAttr = this.dom.researchButton?.getAttribute('data-query');
      const query = queryAttr || this.lastDeepResearchQuery || this.buildFallbackResearchQuery();
      if (query) {
        this.openDeepResearch(query);
      }
    }

    openDeepResearch(query) {
      if (!query || typeof window === 'undefined') { return; }
      const targetUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
      try {
        window.open(targetUrl, '_blank', 'noopener');
      } catch (error) {
        console.warn('Unable to open research window', error);
      }
    }

    buildDeepResearchQuery(query, highlights, context) {
      if (Array.isArray(highlights) && highlights.length) {
        return this.buildHighlightResearchQuery(highlights[0]);
      }
      if (query && query.trim()) {
        return `${query.trim()} PulseOps network guidance`;
      }
      return this.buildContextResearchQuery(context);
    }

    buildContextResearchQuery(context) {
      if (!context) { return ''; }
      const firstHighlight = Array.isArray(context.highlights)
        ? context.highlights.find((highlight) => highlight.severity === 'critical' || highlight.severity === 'warning')
        : null;
      if (firstHighlight) {
        return this.buildHighlightResearchQuery(firstHighlight);
      }
      if (context.summary) {
        return `${context.summary} PulseOps operations response`;
      }
      return '';
    }

    buildHighlightResearchQuery(highlight) {
      if (!highlight) { return ''; }
      const detail = highlight.detail ? ` ${highlight.detail}` : '';
      return `${highlight.title}${detail} PulseOps remediation`;
    }

    handleSubmit(event) {
      if (event) { event.preventDefault(); }
      if (!this.dom.input) { return; }
      const query = this.dom.input.value.trim();
      if (!query) { return; }
      this.dom.input.value = '';
      this.addMessage('user', query);
      this.lastDeepResearchQuery = `${query} PulseOps remediation`;
      this.respondToUser(query);
      this.updateResearchButton();
    }

    respondToUser(query) {
      const context = this.currentContext || this.routeContexts.get(this.activeRoute) || {};
      const highlights = Array.isArray(context?.highlights) ? context.highlights : [];
      const relevant = this.findRelevantHighlights(query, highlights);
      let suggestions = [];
      let recommendations = [];
      let severity = 'info';
      let responseText = '';

      if (relevant.length) {
        suggestions = relevant.slice(0, 3).map((highlight) => this.describeHighlight(highlight));
        recommendations = this.collectRecommendations(relevant);
        severity = this.resolveMaxSeverity(relevant);
        responseText = 'Here is what stands out for that query.';
      } else if (context.summary) {
        suggestions = [context.summary];
        recommendations = this.collectRecommendations(highlights.slice(0, 2));
        severity = this.resolveMaxSeverity(highlights);
        responseText = 'No direct match, but here is the latest overview.';
      } else if (this.deviceInventory.length) {
        const unreachable = this.deviceInventory.filter((device) => device && (device.status === 'offline' || device.status === 'unreachable'));
        if (unreachable.length) {
          const first = unreachable[0];
          suggestions.push(`${unreachable.length} device${unreachable.length === 1 ? ' is' : 's are'} unreachable. Start with ${first.name || first.host || first.id}.`);
          recommendations.push('Verify power, optics and upstream links for unreachable sites.');
          severity = 'warning';
          responseText = 'Telemetry for that query is limited, but there are connectivity issues worth checking.';
        }
      }
      if (!responseText) {
        responseText = 'Telemetry looks steady. Ask me about latency, topology health, or device logs for more detail.';
      }
      const deepResearch = this.buildDeepResearchQuery(query, relevant, context);
      if (deepResearch) {
        this.lastDeepResearchQuery = deepResearch;
      }
      this.addMessage('agent', responseText, {
        severity,
        suggestions,
        actions: recommendations,
        relatedHighlights: relevant.slice(0, 3),
        deepResearch
      });
      this.updateResearchButton();
    }

    findRelevantHighlights(query, highlights) {
      const normalized = (query || '').toLowerCase();
      if (!normalized || !Array.isArray(highlights)) {
        return [];
      }
      const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
      if (!tokens.length) {
        return [];
      }
      return highlights.filter((highlight) => {
        const haystack = [
          highlight?.title,
          highlight?.detail,
          highlight?.category,
          highlight?.deviceId,
          highlight?.deviceName
        ].filter(Boolean).join(' ').toLowerCase();
        return tokens.some((token) => haystack.includes(token));
      });
    }

    describeHighlight(highlight) {
      if (!highlight) { return ''; }
      let detail = highlight.detail || '';
      if (highlight.metric && Number.isFinite(highlight.metric.value)) {
        const value = highlight.metric.value.toFixed(highlight.metric.value >= 10 ? 0 : 1);
        const unit = highlight.metric.unit ? ` ${highlight.metric.unit}` : '';
        detail = detail || `${highlight.metric.name || 'Metric'} at ${value}${unit}.`;
      }
      return `${highlight.title}${detail ? ` — ${detail}` : ''}`;
    }

    collectRecommendations(highlights) {
      const recommendations = [];
      highlights.forEach((highlight) => {
        if (Array.isArray(highlight?.actions)) {
          highlight.actions.forEach((action) => {
            if (action && !recommendations.includes(action)) {
              recommendations.push(action);
            }
          });
        }
      });
      return recommendations.slice(0, 6);
    }

    resolveMaxSeverity(highlights) {
      if (!Array.isArray(highlights) || !highlights.length) {
        return 'info';
      }
      let max = -1;
      let label = 'info';
      highlights.forEach((highlight) => {
        const rank = AGENT_SEVERITY_RANK[highlight?.severity] ?? -1;
        if (rank > max) {
          max = rank;
          label = highlight?.severity || 'info';
        }
      });
      return label || 'info';
    }

    composeSummary(context) {
      if (!context) { return ''; }
      if (context.summary) { return context.summary; }
      const highlight = Array.isArray(context.highlights)
        ? context.highlights.find((item) => item?.severity === 'critical') || context.highlights[0]
        : null;
      if (highlight) {
        return this.describeHighlight(highlight);
      }
      return 'No significant events detected.';
    }

    composeSuggestions(highlights) {
      if (!Array.isArray(highlights) || !highlights.length) {
        return [];
      }
      return highlights.slice(0, 3).map((highlight) => this.describeHighlight(highlight));
    }

    handleContext(context) {
      if (!context || typeof context !== 'object') { return; }
      const route = context.route || this.activeRoute || 'global';
      const payload = { ...context, route };
      this.routeContexts.set(route, payload);
      this.applyContext(payload);
    }

    applyContext(context, { silent = false } = {}) {
      if (!context) { return; }
      this.ensureDom();
      this.currentContext = context;
      const signature = this.buildSignature(context);
      const previous = this.routeSignatures.get(context.route || 'global');
      const changed = signature !== previous;
      this.routeSignatures.set(context.route || 'global', signature);
      this.renderTooltips(context.highlights || []);
      if (silent || !changed) {
        this.updateResearchButton();
        return;
      }
      const summary = this.composeSummary(context);
      const suggestions = this.composeSuggestions(context.highlights);
      const recommendations = this.collectRecommendations(context.highlights);
      const severity = this.resolveMaxSeverity(context.highlights);
      const deepResearch = this.buildContextResearchQuery(context);
      if (deepResearch) {
        this.lastDeepResearchQuery = deepResearch;
      }
      this.addMessage('agent', summary, {
        severity,
        suggestions,
        actions: recommendations,
        relatedHighlights: Array.isArray(context.highlights) ? context.highlights.slice(0, 3) : [],
        deepResearch
      });
      if (!this.isOpen && (severity === 'critical' || severity === 'warning')) {
        this.hasUnread = true;
        this.updateAttention();
      }
      this.updateResearchButton();
    }

    buildSignature(context) {
      const highlights = Array.isArray(context?.highlights) ? context.highlights : [];
      const highlightSignature = highlights.map((highlight) => `${highlight?.id || highlight?.title}:${highlight?.severity}`).join('|');
      return [
        context?.route || 'global',
        context?.summary || '',
        highlightSignature
      ].join('::');
    }

    renderTooltips(highlights) {
      this.ensureDom();
      if (!this.dom.tooltipLayer) { return; }
      this.dom.tooltipLayer.innerHTML = '';
      this.tooltipEntries = [];
      if (!Array.isArray(highlights) || !highlights.length) {
        return;
      }
      const iconBySeverity = {
        critical: '❗',
        warning: '⚠️',
        success: '✅',
        info: '💡'
      };
      highlights.slice(0, 6).forEach((highlight) => {
        if (!highlight?.selector) { return; }
        const target = document.querySelector(highlight.selector);
        if (!target) { return; }
        const icon = iconBySeverity[highlight.severity] || iconBySeverity.info;
        const button = createElement('button', {
          type: 'button',
          class: `agent-tooltip agent-tooltip--${highlight.severity || 'info'}`,
          'aria-label': highlight.title
        }, icon);
        button.appendChild(createElement('span', { class: 'agent-tooltip-label' }, highlight.title));
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.showHighlight(highlight);
        });
        this.dom.tooltipLayer.appendChild(button);
        this.tooltipEntries.push({ highlight, button, target });
      });
      this.positionTooltips();
    }

    positionTooltips() {
      if (!Array.isArray(this.tooltipEntries) || !this.tooltipEntries.length) {
        return;
      }
      if (typeof window === 'undefined') { return; }
      const scrollX = window.scrollX || 0;
      const scrollY = window.scrollY || 0;
      this.tooltipEntries.forEach(({ button, target }) => {
        if (!button || !target) { return; }
        const rect = target.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) {
          button.style.display = 'none';
          return;
        }
        button.style.display = 'flex';
        const top = Math.max(8, rect.top + scrollY + 8);
        const left = Math.min(scrollX + window.innerWidth - 48, rect.right + scrollX - 24);
        button.style.top = `${top}px`;
        button.style.left = `${left}px`;
      });
    }

    showHighlight(highlight) {
      if (!highlight) { return; }
      this.open();
      const description = this.describeHighlight(highlight);
      const recommendations = Array.isArray(highlight.actions) ? highlight.actions : [];
      const deepResearch = this.buildHighlightResearchQuery(highlight);
      if (deepResearch) {
        this.lastDeepResearchQuery = deepResearch;
      }
      this.addMessage('agent', description || highlight.title, {
        severity: highlight.severity,
        suggestions: description ? [description] : [],
        actions: recommendations,
        highlight,
        deepResearch
      });
      this.focusHighlightTarget(highlight);
      this.updateResearchButton();
    }

    focusHighlightTarget(highlight) {
      if (!highlight?.selector) { return; }
      const target = document.querySelector(highlight.selector);
      if (!target) { return; }
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }
      target.classList.add('agent-focus-highlight');
      window.setTimeout(() => target.classList.remove('agent-focus-highlight'), 4000);
    }
  }

  const shared = {
    utils: {
      jsonFetch,
      escapeHTML,
      formatDateTime,
      formatDuration,
      formatBytes,
      createElement,
      isDebugEnabled,
      debugLog,
      appendDebugParamToUrl,
      withDebug,
      ensureUrlHasDebugWhenEnabled,
      enableDebugLinkPropagation,
      resolvePlatformPalette,
      createPlatformBadge: createPlatformBadgeElement,
      formatClassificationReason,
      resolveNetworkLocation,
      isValidIPv4,
      isValidIPv6,
      isPrivateIPv4,
      isLikelyIPAddress,
      formatGeolocationLabel,
      formatGeolocationMeta,
      formatGeolocationTooltip,
      attachGeoTooltip(element, ip) {
        if (!geoTooltipManager || !(element instanceof Element)) { return; }
        const value = ip == null ? '' : String(ip).trim();
        if (!value || !isLikelyIPAddress(value)) {
          geoTooltipManager.decorate(element, '');
          return;
        }
        geoTooltipManager.decorate(element, value);
      }
    },
    ui: {
      createPlatformBadge: createPlatformBadgeElement,
      resolvePlatformPalette
    },
    loading: createLoadingIndicator(),
    events: createEventBus(),
    stores: {
      devices: createStore(async () => {
        const result = await jsonFetch('/api/devices', { loadingLabel: 'Loading devices' });

        if (Array.isArray(result)) {
          return result;
        }

        if (result && typeof result === 'object') {
          if (Array.isArray(result.devices)) {
            return result.devices;
          }
          if (Array.isArray(result.items)) {
            return result.items;
          }
        }

        return [];
      }, { fallback: SAMPLE_DEVICES })
    },
    services: {
      geolocation: createGeolocationService()
    },
    toasts: null,
    confirm: null,
    auth: null,
    agent: null,
    _agentEventUnsub: null,
    ready: false,
    initDomBindings(dom = {}) {
      if (this.ready) {
        return;
      }
      // Persist and surface debug flag across the app
      ensureUrlHasDebugWhenEnabled();
      enableDebugLinkPropagation();
      this.loading.bindDom({
        container: dom.loadingContainer || document.getElementById('global-loading') || null,
        bar: dom.loadingBar || document.getElementById('global-loading-bar') || null,
        label: dom.loadingLabel || document.getElementById('global-loading-label') || null
      });
      const confirmElements = {
        backdrop: dom.confirmBackdrop || document.getElementById('confirm-modal'),
        title: dom.confirmTitle || document.getElementById('confirm-modal-title'),
        message: dom.confirmMessage || document.getElementById('confirm-modal-message'),
        cancel: dom.confirmCancel || document.getElementById('confirm-modal-cancel'),
        confirm: dom.confirmConfirm || document.getElementById('confirm-modal-confirm'),
        extra: dom.confirmExtra || document.getElementById('confirm-modal-extra')
      };

      if (confirmElements.backdrop && confirmElements.title && confirmElements.message && confirmElements.cancel && confirmElements.confirm && confirmElements.extra) {
        this.confirm = new ConfirmDialog(confirmElements);
      } else {
        this.confirm = {
          open() {
            console.warn('Confirm dialog unavailable.');
            return Promise.resolve(false);
          }
        };
      }

      const toastContainer = dom.toastContainer || document.getElementById('toast-container');
      this.toasts = new ToastManager(toastContainer);

      this.auth = createAuthManager({
        userDisplay: dom.userDisplay || document.getElementById('username-display') || null,
        logoutButton: dom.logoutButton || document.getElementById('logout-btn') || null,
        menu: dom.userMenu || document.getElementById('user-menu') || null,
        trigger: dom.userTrigger || document.getElementById('user-menu-trigger') || null
      });

      if (!this.agent) {
        this.agent = new PulseOpsAgent(this);
        PulseOps.agent = this.agent;
      } else {
        this.agent.setShared(this);
      }
      if (this.agent && typeof this.agent.init === 'function') {
        this.agent.init();
      }
      if (!this._agentEventUnsub && this.events) {
        this._agentEventUnsub = this.events.on('agent:context', (event) => {
          if (event?.detail && this.agent) {
            this.agent.handleContext(event.detail);
          }
        });
      }

      if (this.geoTooltips) {
        this.geoTooltips.observe(document.body);
      }

      this.ready = true;
    },
    ensureReady(dom = {}) {
      if (!this.ready) {
        this.initDomBindings(dom);
      }
      if (this.agent) {
        this.agent.setShared(this);
      }
      return this;
    }
  };

  function observeGeoTooltips() {
    geoTooltipManager.observe(document.body);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeGeoTooltips);
  } else {
    observeGeoTooltips();
  }

  PulseOps.shared = shared;
  window.shared = shared;
})(window, document);
