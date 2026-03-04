/**
 * PulseOps Dashboard - SSH Keys View
 *
 * Displays SSH keys used for device authentication
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
      shared.utils.debugLog('KEYS', message, data);
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

  const SAMPLE_KEYS = [
    {
      id: 1,
      name: 'core-router-admin',
      fingerprint: 'SHA256:4a:7b:9c:22',
      created_at: '2024-05-10T12:00:00Z',
      updated_at: '2024-05-11T09:30:00Z',
      usage_count: 2,
      used_by: [
        { device_id: 1, device_name: 'Core Router 1', device_host: '10.0.0.1', device_kind: 'router' },
        { device_id: 4, device_name: 'SD-WAN Edge 4', device_host: '203.0.113.4', device_kind: 'router' }
      ]
    },
    {
      id: 2,
      name: 'branch-switch',
      fingerprint: 'SHA256:1f:22:ab:81',
      created_at: '2024-05-09T14:10:00Z',
      updated_at: '2024-05-09T14:10:00Z',
      usage_count: 1,
      used_by: [
        { device_id: 7, device_name: 'Branch Switch 7', device_host: '192.168.50.12', device_kind: 'switch' }
      ]
    }
  ];

    const state = {
    shared: null,
    elements: {},
    keys: [],
    loading: false,
    standaloneInitialised: false
  };

  function setViewState({ loading }) {
    const { loadingEl, emptyEl, listEl } = state.elements;
    if (!loadingEl || !emptyEl || !listEl) { return; }
    loadingEl.classList.toggle('hidden', !loading);
    listEl.classList.toggle('hidden', loading);
    if (!loading && (!state.keys || !state.keys.length)) {
      emptyEl.classList.remove('hidden');
    } else {
      emptyEl.classList.add('hidden');
    }
  }

  function renderKeys() {
    const list = state.elements.listEl;
    if (!list) { return; }
    list.innerHTML = '';
    if (!state.keys.length) {
      return;
    }
    const fragment = document.createDocumentFragment();
    state.keys.forEach((key) => {
      const card = document.createElement('div');
      card.className = 'key-card';
      const header = document.createElement('div');
      header.className = 'key-card-header';
      const title = document.createElement('h3');
      title.textContent = key.name;
      header.appendChild(title);
      const actions = document.createElement('div');
      actions.className = 'key-card-actions';
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn btn-outline';
      viewBtn.textContent = 'View';
      viewBtn.addEventListener('click', () => openViewer(key.id));
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-secondary';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => confirmDeleteKey(key));
      actions.append(viewBtn, deleteBtn);
      header.appendChild(actions);
      card.appendChild(header);

      const meta = document.createElement('div');
      meta.className = 'key-card-meta';
      meta.innerHTML = `Fingerprint: <code>${key.fingerprint}</code>`;
      card.appendChild(meta);

      const details = document.createElement('div');
      details.className = 'key-card-details';
      details.innerHTML = `Created ${state.shared.utils.formatDateTime(key.created_at)} • Updated ${state.shared.utils.formatDateTime(key.updated_at)}`;
      card.appendChild(details);

      const usage = document.createElement('div');
      usage.className = 'key-card-usage';
      const count = document.createElement('span');
      count.className = 'badge';
      count.textContent = `${key.usage_count || 0} device${key.usage_count === 1 ? '' : 's'}`;
      usage.appendChild(count);
      if (Array.isArray(key.used_by) && key.used_by.length) {
        const listEl = document.createElement('ul');
        listEl.className = 'key-usage-list';
        key.used_by.forEach((device) => {
          const item = document.createElement('li');
          item.textContent = `${device.device_name || 'Device'} (${device.device_host || '—'})`;
          listEl.appendChild(item);
        });
        usage.appendChild(listEl);
      } else {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'Not currently assigned to any devices.';
        usage.appendChild(empty);
      }
      card.appendChild(usage);
      fragment.appendChild(card);
    });
    list.appendChild(fragment);
  }

  async function loadKeys() {
    state.loading = true;
    setViewState({ loading: true });
    debug('loadKeys() started');
    try {
      debug('Fetching SSH keys from /api/ssh-keys-usage');
      const response = await state.shared.utils.jsonFetch('/api/ssh-keys-usage');
      if (Array.isArray(response)) {
        state.keys = response;
        debug('SSH keys loaded successfully', { count: state.keys.length });
      } else {
        state.keys = [];
        debug('SSH keys response was not an array');
      }
    } catch (error) {
      debug('Failed to load SSH keys from primary endpoint', { error: error.message });
      console.warn('Failed to load SSH keys', error);
      try {
        debug('Trying fallback endpoint /api/ssh-keys');
        const fallbackResponse = await state.shared.utils.jsonFetch('/api/ssh-keys');
        state.keys = Array.isArray(fallbackResponse) ? fallbackResponse : [];
        debug('Fallback SSH keys loaded', { count: state.keys.length });
      } catch (innerError) {
        debug('Fallback endpoint also failed, using sample data', { error: innerError.message });
        console.warn('Failed to load fallback SSH key list, using samples', innerError);
        state.keys = cloneDeep(SAMPLE_KEYS);
        state.shared.toasts.show({ message: 'Unable to reach SSH key manager. Showing sample data.', type: 'warning', duration: 5000 });
      }
    } finally {
      state.loading = false;
      setViewState({ loading: false });
      debug('loadKeys() completed', { keyCount: state.keys.length });
      renderKeys();
    }
  }

  function openAddModal() {
    const modal = document.getElementById('add-key-modal');
    if (!modal) { return; }
    modal.classList.remove('hidden');
    const nameInput = document.getElementById('add-key-name');
    const contentInput = document.getElementById('add-key-content');
    nameInput.value = '';
    contentInput.value = '';
  }

  function closeAddModal() {
    const modal = document.getElementById('add-key-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  async function saveNewKey() {
    const nameInput = document.getElementById('add-key-name');
    const contentInput = document.getElementById('add-key-content');
    const name = nameInput?.value.trim();
    const content = contentInput?.value.trim();
    if (!name || !content) {
      state.shared.toasts.show({ message: 'Provide a key name and private key.', type: 'error', duration: 4000 });
      return;
    }
    try {
      await state.shared.utils.jsonFetch('/api/ssh-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, private_key: content })
      });
      state.shared.toasts.show({ message: 'SSH key added.', duration: 4000 });
      closeAddModal();
      await loadKeys();
    } catch (error) {
      console.error('Failed to save SSH key', error);
      state.shared.toasts.show({ message: error.message || 'Failed to add SSH key.', type: 'error', duration: 6000 });
    }
  }

  async function openViewer(keyId) {
    const modal = document.getElementById('edit-ssh-key-modal');
    const viewer = document.getElementById('edit-ssh-key-viewer');
    const formSection = modal?.querySelector('.drawer-section');
    if (!modal || !viewer) { return; }
    try {
      const detail = await state.shared.utils.jsonFetch(`/api/ssh-keys/${keyId}`);
      viewer.innerHTML = '';
      const title = document.createElement('h4');
      title.textContent = detail.name;
      const fingerprint = document.createElement('p');
      fingerprint.className = 'muted';
      fingerprint.textContent = `Fingerprint: ${detail.fingerprint}`;
      const textarea = document.createElement('textarea');
      textarea.className = 'mono-input';
      textarea.rows = 10;
      textarea.readOnly = true;
      textarea.value = detail.private_key || '—';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-outline';
      copyBtn.textContent = 'Copy to clipboard';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(textarea.value);
          state.shared.toasts.show({ message: 'Private key copied to clipboard.', duration: 3000 });
        } catch (err) {
          state.shared.toasts.show({ message: 'Unable to copy to clipboard.', type: 'error', duration: 4000 });
        }
      });
      viewer.append(title, fingerprint, textarea, copyBtn);
      viewer.classList.remove('hidden');
      if (formSection) {
        formSection.classList.add('hidden');
      }
      modal.classList.remove('hidden');
    } catch (error) {
      console.error('Failed to load key detail', error);
      state.shared.toasts.show({ message: 'Unable to load private key content.', type: 'error', duration: 5000 });
    }
  }

  function closeViewer() {
    const modal = document.getElementById('edit-ssh-key-modal');
    const viewer = document.getElementById('edit-ssh-key-viewer');
    const formSection = modal?.querySelector('.drawer-section');
    if (modal) {
      modal.classList.add('hidden');
    }
    if (viewer) {
      viewer.classList.add('hidden');
      viewer.innerHTML = '';
    }
    if (formSection) {
      formSection.classList.remove('hidden');
    }
  }

  async function confirmDeleteKey(key) {
    const confirmed = await state.shared.confirm({
      title: 'Delete SSH key',
      message: `Delete SSH key “${key.name}”? Devices using this key will fail to authenticate.`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) { return; }
    try {
      await state.shared.utils.jsonFetch(`/api/ssh-keys/${key.id}`, { method: 'DELETE' });
      state.shared.toasts.show({ message: 'SSH key deleted.', duration: 3000 });
      await loadKeys();
    } catch (error) {
      console.error('Failed to delete key', error);
      state.shared.toasts.show({ message: 'Unable to delete SSH key.', type: 'error', duration: 5000 });
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
      loadingEl: document.querySelector('#keys-loading'),
      emptyEl: document.querySelector('#keys-empty'),
      listEl: document.querySelector('#keys-list'),
      addBtn: document.querySelector('#keys-add-btn'),
      refreshBtn: document.querySelector('#keys-refresh-btn')
    };

    // Set up event listeners
    setupEventListeners();
    await loadKeys();
  }

  function setupEventListeners() {
    const addModal = document.getElementById('add-key-modal');
    const addSave = document.getElementById('add-key-save');
    const addCancel = document.getElementById('add-key-cancel');
    const viewerClose = document.getElementById('edit-ssh-key-close');

    state.elements.addBtn?.addEventListener('click', openAddModal);
    state.elements.refreshBtn?.addEventListener('click', () => loadKeys());
    addSave?.addEventListener('click', saveNewKey);
    addCancel?.addEventListener('click', closeAddModal);
    addModal?.addEventListener('click', (event) => {
      if (event.target === addModal) {
        closeAddModal();
      }
    });
    viewerClose?.addEventListener('click', closeViewer);
    document.getElementById('edit-ssh-key-modal')?.addEventListener('click', (event) => {
      if (event.target?.id === 'edit-ssh-key-modal') {
        closeViewer();
      }
    });
  }

    const controller = {
      async init(context) {
        debug('init() called', { route: context.route });
        state.shared = context.shared;
        state.elements = {
          loadingEl: context.section.querySelector('#keys-loading'),
          emptyEl: context.section.querySelector('#keys-empty'),
          listEl: context.section.querySelector('#keys-list'),
          addBtn: context.section.querySelector('#keys-add-btn'),
          refreshBtn: context.section.querySelector('#keys-refresh-btn')
        };

        debug('Elements bound', { elementCount: Object.keys(state.elements).length });

        setupEventListeners();

        debug('Loading SSH keys...');
        await loadKeys();
        debug('SSH keys loaded');
      },
      onShow() {
      if (!state.loading) {
        loadKeys();
      }
      },
      onHide() {}
    };

    views.keys = controller;

    PulseOps.whenReady(() => {
      if (document.body.dataset.page === 'dashboard') {
        initStandalone();
      }
    });
})(window, document);
