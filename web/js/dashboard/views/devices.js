/**
 * PulseOps Dashboard - Devices View
 *
 * Displays a table of network devices with management capabilities
 */
(function (window, document) {
  'use strict';

  const PulseOps = window.PulseOps = window.PulseOps || {};
  const views = PulseOps.views = PulseOps.views || {};

  const state = {
    shared: null,
    elements: {},
    devices: [],
    selected: new Set(),
    unsubscribe: null,
    standaloneInitialised: false
  };

  const statusRefreshTimers = new Map();

  function getShared() {
    const shared = PulseOps.shared;
    return shared && typeof shared.ensureReady === 'function' ? shared.ensureReady() : shared;
  }

  // Debug logging helper
  function debug(message, data) {
    const shared = getShared();
    if (shared?.utils?.debugLog) {
      shared.utils.debugLog('DEVICES', message, data);
    }
  }

  function getDeviceInteractions() {
    return PulseOps.deviceInteractions || {};
  }

  function resolveDeviceLocationDetails(device) {
    const shared = state.shared || getShared();
    const resolver = shared?.utils?.resolveNetworkLocation;
    if (typeof resolver !== 'function') {
      return null;
    }
    return resolver(device);
  }

  function renderTable() {
    const tbody = state.elements.tableBody;
    if (!tbody) { return; }
    clearStatusTimers();
    tbody.innerHTML = '';
    const devices = Array.isArray(state.devices) ? state.devices : [];
    if (!devices.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 10;
      cell.className = 'muted';
      cell.textContent = 'No devices available.';
      row.appendChild(cell);
      tbody.appendChild(row);
      updateSelectionUI();
      return;
    }
    const fragment = document.createDocumentFragment();
    const interactions = getDeviceInteractions();
    const badgeFactory = state.shared?.ui?.createPlatformBadge || state.shared?.utils?.createPlatformBadge;
    devices.forEach((device) => {
      const row = document.createElement('tr');
      const checkboxCell = document.createElement('td');
      checkboxCell.className = 'table-checkbox-column';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.deviceId = device.id;
      checkbox.checked = state.selected.has(device.id);
      checkbox.addEventListener('change', () => toggleDeviceSelection(device.id, checkbox.checked));
      checkboxCell.appendChild(checkbox);
      row.appendChild(checkboxCell);

      row.appendChild(createCell(device.name || `Device ${device.id}`));
      row.appendChild(createCell(device.host || '—'));
      row.appendChild(createLocationCell(device));
      row.appendChild(createCell(formatKind(device.kind)));
      const platformCell = document.createElement('td');
      const platformLabel = device.platform_display || device.platform || '—';
      if (typeof badgeFactory === 'function' && platformLabel && platformLabel !== '—') {
        try {
          platformCell.appendChild(badgeFactory(platformLabel, { variant: 'table' }));
        } catch (error) {
          debug('Unable to render platform badge in table', error);
          platformCell.textContent = platformLabel;
        }
      } else {
        platformCell.textContent = platformLabel;
      }
      row.appendChild(platformCell);
      row.appendChild(createConnectionCell(device));
      row.appendChild(createStatusCell(device));
      row.appendChild(createCell(device.user || '—'));

      const actionsCell = document.createElement('td');
      actionsCell.className = 'table-actions-column';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-outline btn-sm';
      editBtn.textContent = 'Edit';
      editBtn.title = 'Edit device';
      editBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        interactions.edit?.(device.id);
      });
      actionsCell.appendChild(editBtn);

      const rebootBtn = document.createElement('button');
      rebootBtn.type = 'button';
      rebootBtn.className = 'btn btn-outline btn-sm';
      rebootBtn.textContent = 'Reboot';
      rebootBtn.title = 'Reboot device';
      rebootBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        interactions.reboot?.(device.id);
      });
      actionsCell.appendChild(rebootBtn);

      const reprovisionBtn = document.createElement('button');
      reprovisionBtn.type = 'button';
      reprovisionBtn.className = 'btn btn-outline btn-sm';
      reprovisionBtn.textContent = 'Reprovision';
      reprovisionBtn.title = 'Re-run iPerf provisioning';
      reprovisionBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        interactions.reprovision?.(device.id);
      });
      actionsCell.appendChild(reprovisionBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-outline btn-sm btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.title = 'Delete device';
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        interactions.delete?.(device.id);
      });
      actionsCell.appendChild(deleteBtn);

      row.appendChild(actionsCell);
      fragment.appendChild(row);
    });
    tbody.appendChild(fragment);
    updateSelectionUI();
  }

  function createCell(value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    attachGeoTooltip(cell, value);
    return cell;
  }

  function attachGeoTooltip(element, value) {
    if (!(element instanceof Element)) { return; }
    const sharedInstance = state.shared || getShared();
    const utils = sharedInstance?.utils;
    if (utils?.attachGeoTooltip) {
      utils.attachGeoTooltip(element, value);
    }
  }

  function createConnectionCell(device) {
    const cell = document.createElement('td');
    const connection = typeof device.connection === 'string' ? device.connection.toLowerCase() : 'wired';
    const override = Boolean(device.connection_override);
    const label = connection === 'wireless' ? 'Wireless' : 'LAN';
    const detail = override ? 'Manual' : 'Network';
    cell.textContent = `${label} (${detail})`;
    cell.dataset.connection = connection;
    if (!override) {
      cell.classList.add('muted');
    }
    return cell;
  }

  function createLocationCell(device) {
    const cell = document.createElement('td');
    const location = resolveDeviceLocationDetails(device);
    if (!location) {
      cell.textContent = '—';
      return cell;
    }

    const badge = document.createElement('span');
    badge.className = `network-location-badge device-location-chip network-location-badge--${location.category}`;
    badge.textContent = location.label;

    const tooltipParts = [];
    if (location.reason) {
      tooltipParts.push(location.reason);
    }
    if (location.matchedSubnet) {
      tooltipParts.push(`Subnet ${location.matchedSubnet}`);
    }
    if (location.ip) {
      tooltipParts.push(`IP ${location.ip}`);
    }
    if (tooltipParts.length) {
      badge.title = tooltipParts.join(' • ');
    }

    cell.appendChild(badge);
    cell.dataset.locationCategory = location.category;

    const detailText = location.ip || location.matchedSubnet || location.reason;
    if (detailText) {
      const detail = document.createElement('div');
      detail.className = 'device-location-chip-detail';
      detail.textContent = detailText;
      cell.appendChild(detail);
    }

    return cell;
  }

  function createStatusCell(device) {
    const cell = document.createElement('td');
    cell.className = 'device-status-column';
    const statusModule = window.PulseOps?.deviceStatus;
    if (!statusModule || typeof statusModule.createBadge !== 'function') {
      cell.textContent = formatStatusLabel(device?.status);
      return cell;
    }

    const badge = statusModule.createBadge('loading');
    badge.title = 'Checking status…';
    cell.appendChild(badge);
    refreshDeviceStatusBadge(device, badge);
    return cell;
  }

  async function refreshDeviceStatusBadge(device, badge, { forceRefresh = false } = {}) {
    const statusModule = window.PulseOps?.deviceStatus;
    if (!badge || !badge.isConnected) { return; }
    if (!statusModule || typeof statusModule.getStatus !== 'function') {
      badge.textContent = formatStatusLabel(device?.status);
      badge.title = 'Status unavailable';
      return;
    }

    statusModule.updateBadge(badge, 'loading', { label: 'Checking…' });
    badge.title = 'Checking status…';

    try {
      const result = await statusModule.getStatus(device, { forceRefresh });
      if (!badge.isConnected) { return; }
      statusModule.updateBadge(badge, result.status);
      badge.title = buildStatusTooltip(result);
      scheduleStatusRefresh(device, badge);
    } catch (error) {
      console.warn('[Devices] Failed to resolve device status', device?.id, error);
      if (!badge.isConnected) { return; }
      statusModule.updateBadge(badge, 'unknown');
      badge.title = 'Unable to determine status';
      scheduleStatusRefresh(device, badge);
    }
  }

  function scheduleStatusRefresh(device, badge) {
    const statusModule = window.PulseOps?.deviceStatus;
    if (!device || device.id == null || !badge?.isConnected || !statusModule) {
      return;
    }
    const interval = statusModule.REFRESH_INTERVAL_MS || 30000;
    if (statusRefreshTimers.has(device.id)) {
      clearTimeout(statusRefreshTimers.get(device.id));
    }
    const timer = setTimeout(() => {
      if (!badge.isConnected) {
        statusRefreshTimers.delete(device.id);
        return;
      }
      refreshDeviceStatusBadge(device, badge, { forceRefresh: true });
    }, interval);
    statusRefreshTimers.set(device.id, timer);
  }

  function clearStatusTimers() {
    statusRefreshTimers.forEach((timer) => clearTimeout(timer));
    statusRefreshTimers.clear();
  }

  function buildStatusTooltip(result) {
    const statusModule = window.PulseOps?.deviceStatus;
    if (statusModule?.formatStatusTooltip) {
      return statusModule.formatStatusTooltip(result);
    }
    if (!result) { return 'Status unavailable'; }
    const parts = [];
    const label = result.label || formatStatusLabel(result.status);
    if (label) { parts.push(label); }
    if (Number.isFinite(result.pingValue)) {
      const value = result.pingValue >= 100 ? result.pingValue.toFixed(0) : result.pingValue.toFixed(1);
      parts.push(`Ping ${value} ms`);
    }
    if (typeof result.pingAgeMs === 'number') {
      parts.push(`${formatAgeFallback(result.pingAgeMs)} ago`);
    }
    return parts.join(' • ') || 'Status unavailable';
  }

  function formatStatusLabel(status) {
    const statusModule = window.PulseOps?.deviceStatus;
    if (statusModule?.formatStatus) {
      return statusModule.formatStatus(status);
    }
    return formatStatusFallback(status);
  }

  function formatStatusFallback(value) {
    const norm = (value || '').toString().trim().toLowerCase();
    if (!norm) { return 'Unknown'; }
    return norm.replace(/[_\s]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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

  function formatKind(value) {
    const str = (value || '').toString().trim();
    if (!str) { return '—'; }
    return str.replace(/[_\s]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function toggleDeviceSelection(deviceId, checked) {
    if (!deviceId) { return; }
    if (checked) {
      state.selected.add(deviceId);
    } else {
      state.selected.delete(deviceId);
    }
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const devices = Array.isArray(state.devices) ? state.devices : [];
    const total = devices.length;
    const selectedCount = Array.from(state.selected).filter((id) => devices.some((device) => device.id === id)).length;
    const master = state.elements.master;
    if (master) {
      if (!total) {
        master.checked = false;
        master.indeterminate = false;
      } else {
        master.checked = selectedCount === total;
        master.indeterminate = selectedCount > 0 && selectedCount < total;
      }
    }
    if (state.elements.exportSelected) {
      state.elements.exportSelected.disabled = selectedCount === 0;
    }
    if (state.elements.selectAll) {
      state.elements.selectAll.textContent = selectedCount === total && total !== 0 ? 'Clear selection' : 'Select all';
    }
  }

  function handleSelectAll() {
    const devices = Array.isArray(state.devices) ? state.devices : [];
    const total = devices.length;
    const selectedCount = Array.from(state.selected).filter((id) => devices.some((device) => device.id === id)).length;
    if (total && selectedCount < total) {
      devices.forEach((device) => state.selected.add(device.id));
    } else {
      state.selected.clear();
    }
    renderTable();
  }

  function exportDevices(list, filename) {
    if (!Array.isArray(list) || !list.length) {
      state.shared.toasts?.show({ message: 'Select one or more devices to export.', type: 'info', duration: 4000 });
      return;
    }
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `pulseops-devices-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    state.shared.toasts?.show({ message: `Exported ${list.length} device${list.length === 1 ? '' : 's'}.`, duration: 4000 });
  }

  async function handleImport(file) {
    if (!file) { return; }
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await state.shared.utils.jsonFetch('/api/devices/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      state.shared.toasts?.show({ message: 'Import completed successfully.', duration: 4000 });
      await state.shared.stores.devices.load(true);
    } catch (error) {
      console.error('Import failed', error);
      state.shared.toasts?.show({ message: 'Failed to import devices. Check the JSON format.', type: 'error', duration: 6000 });
    } finally {
      if (state.elements.importInput) {
        state.elements.importInput.value = '';
      }
    }
  }

  function setupEventListeners() {
    if (state.elements.master) {
      state.elements.master.addEventListener('change', (event) => {
        const checked = event.target.checked;
        const devices = Array.isArray(state.devices) ? state.devices : [];
        if (checked) {
          devices.forEach((device) => state.selected.add(device.id));
        } else {
          state.selected.clear();
        }
        renderTable();
      });
    }
    if (state.elements.selectAll) {
      state.elements.selectAll.addEventListener('click', handleSelectAll);
    }
    if (state.elements.exportSelected) {
      state.elements.exportSelected.addEventListener('click', () => {
        const selectedDevices = state.devices.filter((device) => state.selected.has(device.id));
        exportDevices(selectedDevices);
      });
    }
    if (state.elements.exportAll) {
      state.elements.exportAll.addEventListener('click', () => {
        exportDevices(state.devices);
      });
    }
    if (state.elements.importBtn && state.elements.importInput) {
      state.elements.importBtn.addEventListener('click', () => state.elements.importInput.click());
      state.elements.importInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (file) {
          handleImport(file);
        }
      });
    }
  }

  async function bootstrapStandalone() {
    if (state.standaloneInitialised) {
      return;
    }
    state.standaloneInitialised = true;
    state.shared = getShared();
    state.elements = {
      tableBody: document.querySelector('#device-table-body'),
      master: document.querySelector('#device-table-master'),
      selectAll: document.querySelector('#device-select-all'),
      exportSelected: document.querySelector('#device-export-selected'),
      exportAll: document.querySelector('#device-export-all'),
      importBtn: document.querySelector('#device-import-btn'),
      importInput: document.querySelector('#device-import-input')
    };

    setupEventListeners();

    getDeviceInteractions().init?.();

    state.unsubscribe = state.shared.stores.devices.subscribe((devices) => {
      state.devices = Array.isArray(devices) ? devices : [];
      renderTable();
    });

    await state.shared.stores.devices.load();
    renderTable();
  }

  const controller = {
    async init(context) {
      debug('init() called', { route: context.route });
      state.shared = context.shared;
      state.elements = {
        tableBody: context.section.querySelector('#device-table-body'),
        master: context.section.querySelector('#device-table-master'),
        selectAll: context.section.querySelector('#device-select-all'),
        exportSelected: context.section.querySelector('#device-export-selected'),
        exportAll: context.section.querySelector('#device-export-all'),
        importBtn: context.section.querySelector('#device-import-btn'),
        importInput: context.section.querySelector('#device-import-input')
      };

      debug('Elements bound', { elementCount: Object.keys(state.elements).length });

      setupEventListeners();
      getDeviceInteractions().init?.();

      state.unsubscribe = context.shared.stores.devices.subscribe((devices) => {
        debug('Device subscription triggered', { deviceCount: Array.isArray(devices) ? devices.length : 0 });
        state.devices = Array.isArray(devices) ? devices : [];
        renderTable();
      });

      debug('Loading devices store...');
      await context.shared.stores.devices.load();
      debug('Devices loaded, rendering table');
      renderTable();
      debug('Table rendered');
    },
    onShow(context) {
      context.shared.stores.devices.load();
    },
    onHide() {},
    destroy() {
      clearStatusTimers();
      if (typeof state.unsubscribe === 'function') {
        state.unsubscribe();
        state.unsubscribe = null;
      }
    }
  };

  views.devices = controller;

  PulseOps.whenReady(() => {
    if (document.body.dataset.page === 'dashboard') {
      bootstrapStandalone();
    }
  });
})(window, document);
