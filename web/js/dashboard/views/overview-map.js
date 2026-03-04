/**
 * PulseOps Dashboard - Network Map View
 *
 * Displays network topology and device relationships
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
      shared.utils.debugLog('MAP', message, data);
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

  const SAMPLE_GROUPS = [
    { id: 'core', name: 'Core Network', parentId: null },
    { id: 'distribution', name: 'Distribution & Access', parentId: 'core' },
    { id: 'branch', name: 'Branch Sites', parentId: 'distribution' },
    { id: 'cloud', name: 'Cloud Edge', parentId: null }
  ];

  const SAMPLE_MAPS = [
    {
      id: 'core-backbone',
      name: 'Core Backbone',
      description: 'Layer-3 backbone across data centres.',
      groupId: 'core',
      updatedAt: '2024-05-14T09:30:00Z',
      author: 'M. Ortega',
      alertCounts: { critical: 2, warning: 1, info: 5 },
      pinnedNodeCount: 4,
      timeRange: '24h'
    },
    {
      id: 'campus-access',
      name: 'Campus Access',
      description: 'Switching layers for HQ and lab spaces.',
      groupId: 'distribution',
      updatedAt: '2024-05-12T21:02:00Z',
      author: 'A. Garner',
      alertCounts: { critical: 1, warning: 3, info: 6 },
      pinnedNodeCount: 5,
      timeRange: '6h'
    },
    {
      id: 'branch-topology',
      name: 'Branch SD-WAN',
      description: 'Overlay of branch routers and tunnels.',
      groupId: 'branch',
      updatedAt: '2024-05-16T07:48:00Z',
      author: 'Network Team',
      alertCounts: { critical: 0, warning: 1, info: 2 },
      pinnedNodeCount: 2,
      timeRange: '7d'
    }
  ];

    const state = {
      groups: [],
      maps: [],
      filterText: '',
      timeRange: '24h',
      selectedGroup: '',
      selectedMapId: null,
      elements: {},
      shared: null,
      standaloneInitialised: false
    };

  function findGroup(groupId) {
    return state.groups.find((group) => group.id === groupId) || null;
  }

  function mapMatchesFilters(map) {
    if (state.selectedGroup) {
      const group = findGroup(state.selectedGroup);
      if (group && map.groupId !== group.id) {
        return false;
      }
    }
    if (state.filterText) {
      const value = state.filterText.toLowerCase();
      const text = [map.name, map.description, findGroup(map.groupId)?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!text.includes(value)) {
        return false;
      }
    }
    return true;
  }

  function renderGroupsTree() {
    const tree = state.elements.groupsTree;
    if (!tree) { return; }
    tree.innerHTML = '';
    const buildList = (parentId, level = 0) => {
      const items = state.groups.filter((group) => group.parentId === parentId);
      if (!items.length) { return null; }
      const list = document.createElement('ul');
      list.dataset.level = String(level);
      items.forEach((group) => {
        const item = document.createElement('li');
        item.dataset.groupId = group.id;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = group.name;
        button.className = 'map-group-btn';
        button.dataset.groupId = group.id;
        if (state.selectedGroup === group.id) {
          button.classList.add('active');
        }
        button.addEventListener('click', () => {
          state.selectedGroup = state.selectedGroup === group.id ? '' : group.id;
          renderGroupsTree();
          renderTable();
          updateStatus();
        });
        item.appendChild(button);
        const childList = buildList(group.id, level + 1);
        if (childList) {
          item.appendChild(childList);
        }
        list.appendChild(item);
      });
      return list;
    };
    const rootList = buildList(null);
    if (rootList) {
      tree.appendChild(rootList);
    }
  }

  function formatAlertSummary(alertCounts = {}) {
    const parts = [];
    if (alertCounts.critical) { parts.push(`${alertCounts.critical} critical`); }
    if (alertCounts.warning) { parts.push(`${alertCounts.warning} warning`); }
    if (alertCounts.info) { parts.push(`${alertCounts.info} info`); }
    return parts.length ? parts.join(', ') : 'No alerts';
  }

  function renderTable() {
    const headerRow = state.elements.tableHeader;
    const tbody = state.elements.tableBody;
    if (!headerRow || !tbody) { return; }
    headerRow.innerHTML = '';
    ['Map Name', 'Group', 'Alerts', 'Updated'].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headerRow.appendChild(th);
    });
    tbody.innerHTML = '';
    const filtered = state.maps.filter(mapMatchesFilters);
    if (!filtered.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.innerHTML = '<div class="empty-state">No maps match the selected filters.</div>';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }
    filtered.forEach((map) => {
      const row = document.createElement('tr');
      row.dataset.mapId = map.id;
      if (state.selectedMapId === map.id) {
        row.classList.add('table-row-active');
      }
      const group = findGroup(map.groupId);
      row.appendChild(createCell(map.name));
      row.appendChild(createCell(group ? group.name : '—'));
      row.appendChild(createCell(formatAlertSummary(map.alertCounts)));
      row.appendChild(createCell(state.shared.utils.formatDateTime(map.updatedAt)));
      row.addEventListener('click', () => {
        openMap(map.id);
      });
      tbody.appendChild(row);
    });
  }

  function createCell(content) {
    const cell = document.createElement('td');
    cell.textContent = content;
    return cell;
  }

  function updateStatus() {
    const el = state.elements.status;
    if (!el) { return; }
    const total = state.maps.length;
    const visible = state.maps.filter(mapMatchesFilters).length;
    const parts = [`Showing ${visible} of ${total} maps`];
    if (state.timeRange) {
      const label = state.elements.timeRange?.selectedOptions?.[0]?.text || state.timeRange;
      parts.push(`Alert window: ${label}`);
    }
    if (state.selectedGroup) {
      const group = findGroup(state.selectedGroup);
      if (group) {
        parts.push(`Filtered by group: ${group.name}`);
      }
    }
    el.textContent = parts.join(' • ');
  }

  function openMap(mapId) {
    state.selectedMapId = mapId;
    renderTable();
    const map = state.maps.find((entry) => entry.id === mapId);
    if (!map) {
      showCanvasPlaceholder('Select a saved map to start exploring.');
      return;
    }
    const meta = state.elements.toolbarMeta;
    if (meta) {
      const group = findGroup(map.groupId);
      const groupName = group ? group.name : 'Unassigned';
      meta.textContent = `${groupName} • Updated ${state.shared.utils.formatDateTime(map.updatedAt)} • ${map.author || 'Unknown author'}`;
    }
    const footer = state.elements.footerMeta;
    if (footer) {
      footer.textContent = `Time range ${map.timeRange || state.timeRange} • ${map.pinnedNodeCount || 0} pinned nodes`;
    }
    const empty = state.elements.canvasEmpty;
    if (empty) {
      empty.textContent = `Topology preview for “${map.name}” coming soon. Description: ${map.description || 'No description provided.'}`;
    }
    state.elements.canvasWrapper?.classList.remove('hidden');
  }

  function showCanvasPlaceholder(message) {
    if (state.elements.canvasEmpty) {
      state.elements.canvasEmpty.textContent = message;
    }
    state.elements.canvasWrapper?.classList.add('hidden');
  }

  async function loadGroups(shared) {
    debug('loadGroups() started');
    try {
      debug('Fetching map groups from /api/map-groups');
      const groups = await shared.utils.jsonFetch('/api/map-groups');
      if (Array.isArray(groups) && groups.length) {
        state.groups = groups.map((group) => ({
          id: group.id,
          name: group.name,
          parentId: group.parentId || null
        }));
        debug('Map groups loaded successfully', { count: state.groups.length });
        return;
      }
    } catch (error) {
      debug('Failed to load map groups, using sample data', { error: error.message });
      console.warn('Failed to load map groups, using sample data', error);
    }
    state.groups = cloneDeep(SAMPLE_GROUPS);
  }

  async function loadMaps(shared) {
    debug('loadMaps() started');
    try {
      debug('Fetching saved maps from /api/saved-maps');
      const maps = await shared.utils.jsonFetch('/api/saved-maps');
      if (Array.isArray(maps) && maps.length) {
        state.maps = maps.map((map) => ({
          id: map.id,
          name: map.name,
          description: map.description,
          groupId: map.groupId,
          updatedAt: map.updatedAt,
          author: map.author,
          alertCounts: map.alertCounts || {},
          pinnedNodeCount: map.pinnedNodeCount,
          timeRange: map.timeRange || state.timeRange
        }));
        debug('Saved maps loaded successfully', { count: state.maps.length });
        return;
      }
    } catch (error) {
      debug('Failed to load saved maps, using sample data', { error: error.message });
      console.warn('Failed to load saved maps, using sample data', error);
    }
    state.maps = cloneDeep(SAMPLE_MAPS);
  }

  async function refreshData() {
    debug('refreshData() started');
    await Promise.all([loadGroups(state.shared), loadMaps(state.shared)]);
    debug('Data loaded, rendering UI');
    renderGroupsTree();
    renderTable();
    updateStatus();
    if (state.maps.length) {
      openMap(state.maps[0].id);
    } else {
      showCanvasPlaceholder('No saved maps available yet.');
    }
  }

  // Initialize for standalone page
    async function initStandalone() {
      if (state.standaloneInitialised) {
        return;
      }
      state.standaloneInitialised = true;
      state.shared = ensureShared();
    state.elements = {
      groupsTree: document.querySelector('#map-groups-tree'),
      filterInput: document.querySelector('#saved-maps-filter'),
      timeRange: document.querySelector('#saved-maps-time-range'),
      refreshBtn: document.querySelector('#saved-maps-refresh'),
      status: document.querySelector('#saved-maps-status'),
      tableHeader: document.querySelector('#saved-maps-header-row'),
      tableBody: document.querySelector('#saved-maps-table-body'),
      addBtn: document.querySelector('#map-add-btn'),
      canvasWrapper: document.querySelector('#map-canvas-wrapper'),
      canvasEmpty: document.querySelector('#map-canvas-empty'),
      toolbarMeta: document.querySelector('#map-toolbar-meta'),
      footerMeta: document.querySelector('#map-canvas-footer-meta')
    };

    // Set up event listeners
    setupEventListeners();
    await refreshData();
  }

  function setupEventListeners() {
    if (state.elements.filterInput) {
      state.elements.filterInput.addEventListener('input', () => {
        state.filterText = state.elements.filterInput.value.trim();
        renderTable();
        updateStatus();
      });
    }

    if (state.elements.timeRange) {
      state.timeRange = state.elements.timeRange.value;
      state.elements.timeRange.addEventListener('change', () => {
        state.timeRange = state.elements.timeRange.value;
        updateStatus();
      });
    }

    if (state.elements.refreshBtn) {
      state.elements.refreshBtn.addEventListener('click', () => {
        refreshData();
      });
    }

    if (state.elements.addBtn) {
      state.elements.addBtn.addEventListener('click', () => {
        state.shared.toasts.show({ message: 'Map creation is coming soon.', duration: 4000 });
      });
    }
  }

    const controller = {
      async init(context) {
        debug('init() called', { route: context.route });
        state.shared = context.shared;
        state.elements = {
          groupsTree: context.section.querySelector('#map-groups-tree'),
          filterInput: context.section.querySelector('#saved-maps-filter'),
          timeRange: context.section.querySelector('#saved-maps-time-range'),
          refreshBtn: context.section.querySelector('#saved-maps-refresh'),
          status: context.section.querySelector('#saved-maps-status'),
          tableHeader: context.section.querySelector('#saved-maps-header-row'),
          tableBody: context.section.querySelector('#saved-maps-table-body'),
          addBtn: context.section.querySelector('#map-add-btn'),
          canvasWrapper: context.section.querySelector('#map-canvas-wrapper'),
          canvasEmpty: context.section.querySelector('#map-canvas-empty'),
          toolbarMeta: context.section.querySelector('#map-toolbar-meta'),
          footerMeta: context.section.querySelector('#map-canvas-footer-meta')
        };

        debug('Elements bound', { elementCount: Object.keys(state.elements).length });

        setupEventListeners();

        debug('Loading map data...');
        await refreshData();
        debug('Map data loaded');
      },
      onShow() {
      updateStatus();
      },
      onHide() {}
    };

    views['overview-map'] = controller;

    PulseOps.whenReady(() => {
      if (document.body.dataset.page === 'dashboard') {
        initStandalone();
      }
    });
})(window, document);
