/**
 * Device Interactions Module
 * Handles device editing, SSH key management, backups, and other device operations
 */

(function (window, document) {
  'use strict';

  const PulseOps = window.PulseOps = window.PulseOps || {};
  let sharedInstance = null;

  function ensureShared() {
    if (!sharedInstance) {
      const shared = PulseOps.shared;
      if (shared && typeof shared.ensureReady === 'function') {
        sharedInstance = shared.ensureReady();
      } else {
        sharedInstance = shared || null;
      }
    }
    return sharedInstance;
  }

  function getUtils() {
    const shared = ensureShared();
    return shared?.utils || {
      async jsonFetch() {
        throw new Error('Shared utilities unavailable');
      },
      escapeHTML(value) {
        return String(value ?? '');
      },
      createElement(tag, attrs = {}, ...children) {
        const element = document.createElement(tag || 'div');
        Object.entries(attrs).forEach(([key, value]) => {
          if (key && value != null) {
            element.setAttribute(key, value);
          }
        });
        children.flat().forEach((child) => {
          if (child == null) { return; }
          if (child instanceof Node) {
            element.appendChild(child);
          } else {
            element.appendChild(document.createTextNode(String(child)));
          }
        });
        return element;
      }
    };
  }

  function jsonFetch(...args) {
    return getUtils().jsonFetch(...args);
  }

  function escapeHTML(value) {
    return getUtils().escapeHTML(value);
  }

  function createElement(tag, attrs = {}, ...children) {
    return getUtils().createElement(tag, attrs, ...children);
  }

  function createPlatformBadge(platformName, options) {
    const shared = ensureShared();
    const factory = shared?.ui?.createPlatformBadge || shared?.utils?.createPlatformBadge;
    if (typeof factory !== 'function') {
      return null;
    }
    try {
      return factory(platformName, options);
    } catch (error) {
      console.warn('Unable to create platform badge', error);
      return null;
    }
  }

  function makePlatformBadgeNode(platformName, options) {
    const label = (platformName || '').toString().trim();
    if (!label) {
      return null;
    }
    const badge = createPlatformBadge(label, options);
    if (badge) {
      return badge;
    }
    return createElement('span', { class: 'platform-badge-fallback' }, label.toUpperCase());
  }

  function renderPlatformBadgeInto(container, platformName, options) {
    if (!container) {
      return;
    }
    container.innerHTML = '';
    const badge = makePlatformBadgeNode(platformName, options);
    if (badge) {
      container.appendChild(badge);
    }
  }

  function getToasts() {
    return ensureShared()?.toasts || null;
  }

  function getConfirm() {
    return ensureShared()?.confirm || null;
  }

    // State management
    const state = {
    editOverlay: null,
    editForm: null,
    editState: {
      open: false,
      step: 1,
      deviceId: null,
      template: null,
      deviceConfig: { meta: {} },
      validation: null,
      isValidating: false,
      isSaving: false
    },
    sshModal: null,
    sshKeysCache: [],
    backupModal: null,
    templatesCache: null,
    initialised: false
  };

  // Constants
  const EDIT_STEPS = { CONFIG: 1, VALIDATION: 2 };
  const SSH_KEY_REFERENCE_PREFIX = 'sshkey:';
  const SSH_KEY_PATH_OPTION = '__path__';

  /**
   * Initialize device interactions
   */
  function initDeviceInteractions() {
    // Get DOM elements
    state.editOverlay = document.getElementById('edit-device-overlay');
    state.editForm = document.getElementById('edit-device-form');
    state.sshModal = document.getElementById('edit-ssh-key-modal');
    state.backupModal = document.getElementById('backup-modal');

    if (!state.editOverlay || !state.editForm) {
      console.warn('Device edit overlay not found - device editing will not work');
      state.initialised = false;
      return;
    }

    if (state.initialised) {
      return;
    }

    state.initialised = true;

    // Initialize edit overlay handlers
    initEditOverlay();
    
    // Initialize SSH key modal handlers
    if (state.sshModal) {
      initSSHKeyModal();
    }

    // Initialize backup modal handlers
    if (state.backupModal) {
      initBackupModal();
    }

    // Load templates and SSH keys
    loadTemplates();
    loadSSHKeys();
  }

  /**
   * Initialize edit overlay functionality
   */
  function initEditOverlay() {
    const closeBtn = document.getElementById('edit-close-btn');
    const backBtn = document.getElementById('edit-back-btn');
    const validateBtn = document.getElementById('edit-validate-btn');
    const saveBtn = document.getElementById('edit-save-btn');
    const reprovisionBtn = document.getElementById('edit-reprovision-btn');

    if (closeBtn) {
      closeBtn.addEventListener('click', closeEditOverlay);
    }

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (state.editState.step === EDIT_STEPS.VALIDATION) {
          setEditStep(EDIT_STEPS.CONFIG);
        }
      });
    }

    if (validateBtn) {
      validateBtn.addEventListener('click', validateDevice);
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', saveDevice);
    }

    if (reprovisionBtn) {
      reprovisionBtn.addEventListener('click', () => {
        if (!state.editState.deviceId) {
          showToast('Device not loaded yet', 'error');
          return;
        }
        reprovisionDevice(state.editState.deviceId);
      });
    }

    // Close on backdrop click
    state.editOverlay.addEventListener('click', (e) => {
      if (e.target === state.editOverlay) {
        closeEditOverlay();
      }
    });
  }

  /**
   * Initialize SSH key modal functionality
   */
  function initSSHKeyModal() {
    const closeBtn = document.getElementById('edit-ssh-key-close');
    const saveBtn = document.getElementById('edit-save-ssh-key-btn');

    if (closeBtn) {
      closeBtn.addEventListener('click', closeSSHKeyModal);
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', saveSSHKey);
    }

    // Close on backdrop click
    state.sshModal.addEventListener('click', (e) => {
      if (e.target === state.sshModal) {
        closeSSHKeyModal();
      }
    });
  }

  /**
   * Initialize backup modal functionality
   */
  function initBackupModal() {
    const closeBtn = document.getElementById('backup-modal-close');

    if (closeBtn) {
      closeBtn.addEventListener('click', closeBackupModal);
    }

    // Close on backdrop click
    state.backupModal.addEventListener('click', (e) => {
      if (e.target === state.backupModal) {
        closeBackupModal();
      }
    });
  }

  /**
   * Open device edit overlay
   */
  function openDeviceEdit(deviceId) {
    if (!state.editOverlay || !state.editForm) {
      initDeviceInteractions();
    }

    if (!state.editOverlay || !state.editForm) {
      console.error('Edit overlay not initialized');
      return;
    }

    state.editState.deviceId = deviceId;
    state.editState.open = true;
    state.editState.step = EDIT_STEPS.CONFIG;
    setEditStep(EDIT_STEPS.CONFIG);

    // Show loading state
    showEditLoading(true);
    state.editOverlay.classList.remove('hidden');
    state.editOverlay.classList.add('active');

    // Load device data
    loadDeviceForEdit(deviceId);
  }

  /**
   * Close device edit overlay
   */
  function closeEditOverlay() {
    if (!state.editOverlay || !state.editForm) {
      initDeviceInteractions();
    }

    if (state.editOverlay) {
      state.editOverlay.classList.remove('active');
      state.editOverlay.classList.add('hidden');
    }
    const titleEl = document.getElementById('edit-device-title');
    if (titleEl) {
      titleEl.textContent = 'Edit Device';
    }
    const subtitleEl = document.getElementById('edit-device-subtitle');
    if (subtitleEl) {
      const defaultText = subtitleEl.dataset.defaultText || 'Adjust configuration and validate before saving.';
      subtitleEl.textContent = defaultText;
      subtitleEl.classList.remove('edit-device-subtitle');
      subtitleEl.classList.add('muted');
    }
    
    state.editState.open = false;
    state.editState.deviceId = null;
    state.editState.template = null;
    state.editState.deviceConfig = { meta: {} };
    state.editState.validation = null;
    setEditStep(EDIT_STEPS.CONFIG);
  }

  /**
   * Show/hide edit loading state
   */
  function showEditLoading(show) {
    const loadingState = document.getElementById('edit-loading-state');
    const content = document.getElementById('edit-content');

    if (loadingState) {
      loadingState.classList.toggle('hidden', !show);
    }
    if (content) {
      content.classList.toggle('hidden', show);
    }
  }

  /**
   * Set edit step
   */
  function setEditStep(step) {
    state.editState.step = step;
    
    // Update stepper UI
    document.querySelectorAll('.stepper-item').forEach((item, index) => {
      const stepNumber = index + 1;
      item.classList.toggle('active', stepNumber === step);
      item.classList.toggle('completed', stepNumber < step);
    });

    // Show/hide step content
    document.querySelectorAll('.edit-step').forEach((stepEl, index) => {
      const stepNumber = index + 1;
      stepEl.classList.toggle('hidden', stepNumber !== step);
    });

    // Update button states
    const backBtn = document.getElementById('edit-back-btn');
    const validateBtn = document.getElementById('edit-validate-btn');
    const saveBtn = document.getElementById('edit-save-btn');

    if (backBtn) {
      backBtn.style.display = step === EDIT_STEPS.CONFIG ? 'none' : 'inline-block';
    }
    if (validateBtn) {
      validateBtn.style.display = step === EDIT_STEPS.CONFIG ? 'inline-block' : 'none';
    }
    if (saveBtn) {
      saveBtn.style.display = step === EDIT_STEPS.VALIDATION ? 'inline-block' : 'none';
    }
  }

  /**
   * Load device data for editing
   */
  async function loadDeviceForEdit(deviceId) {
    try {
      const device = await jsonFetch(`/api/devices/${deviceId}`);
      if (typeof device.connection !== 'string' || !device.connection) {
        device.connection = 'wired';
      }
      if (typeof device.connection_override !== 'boolean') {
        device.connection_override = false;
      }
      state.editState.deviceConfig = device;
      
      // Load template if available
      if (device.template) {
        const template = await jsonFetch(`/api/templates/${device.template}`);
        state.editState.template = template;
      }

      renderEditForm();
      showEditLoading(false);
    } catch (error) {
      console.error('Failed to load device for editing:', error);
      showToast('Failed to load device data', 'error');
      closeEditOverlay();
    }
  }

  function buildPlatformOptions(device) {
    const defaults = [
      { value: 'openwrt', label: 'OpenWrt' },
      { value: 'edgeos', label: 'EdgeOS' },
      { value: 'huawei', label: 'Huawei' }
    ];
    const seen = new Set(defaults.map((option) => option.value?.toLowerCase()));
    const devicePlatform = (device?.platform || '').toString().trim();
    if (devicePlatform && !seen.has(devicePlatform.toLowerCase())) {
      defaults.push({ value: devicePlatform, label: device?.platform_display || devicePlatform });
      seen.add(devicePlatform.toLowerCase());
    }
    return defaults;
  }

  function updateEditSubtitle(device) {
    const subtitle = document.getElementById('edit-device-subtitle');
    if (!subtitle) {
      return;
    }
    if (!subtitle.dataset.defaultText) {
      subtitle.dataset.defaultText = subtitle.textContent || 'Adjust configuration and validate before saving.';
    }
    const defaultText = subtitle.dataset.defaultText;
    subtitle.innerHTML = '';
    subtitle.classList.add('edit-device-subtitle', 'muted');
    const platformLabel = (device?.platform_display || device?.platform || '').toString().trim();
    const hostLabel = (device?.host || device?.ip || '').toString().trim();
    if (platformLabel) {
      const badge = makePlatformBadgeNode(platformLabel, { variant: 'inline' });
      if (badge) {
        subtitle.appendChild(badge);
      }
    }
    if (hostLabel) {
      if (subtitle.childNodes.length) {
        subtitle.appendChild(createElement('span', { class: 'edit-device-subtitle-separator', 'aria-hidden': 'true' }, '•'));
      }
      subtitle.appendChild(createElement('span', { class: 'edit-device-subtitle-text' }, hostLabel));
    }
    if (!subtitle.childNodes.length) {
      subtitle.textContent = defaultText;
      subtitle.classList.remove('edit-device-subtitle');
    }
  }

  /**
   * Render edit form
   */
  function renderEditForm() {
    if (!state.editForm) {
      state.editForm = document.getElementById('edit-device-form');
      if (!state.editForm) {
        console.warn('Edit form container not found, unable to render device editor');
        return;
      }
    }

    const device = state.editState.deviceConfig;

    const titleEl = document.getElementById('edit-device-title');
    if (titleEl) {
      titleEl.textContent = device.name || device.host || 'Edit Device';
    }

    // Basic form structure
    const platformOptions = buildPlatformOptions(device);
    const platformOptionsHTML = platformOptions.map((option) => {
      const valueRaw = option.value || '';
      const value = escapeHTML(valueRaw);
      const label = escapeHTML(option.label || option.value || '—');
      const isSelected = valueRaw.toLowerCase() === (device.platform || '').toString().toLowerCase();
      const selected = isSelected ? ' selected' : '';
      return `<option value="${value}"${selected}>${label}</option>`;
    }).join('');

    const connectionMode = device.connection_override
      ? (device.connection || 'wired').toString().toLowerCase()
      : 'auto';

    state.editForm.innerHTML = `
      <div class="form-group">
        <label for="edit-device-name">Device Name</label>
        <input type="text" id="edit-device-name" value="${escapeHTML(device.name || '')}" required>
      </div>
      <div class="form-group">
        <label for="edit-device-host">Host</label>
        <input type="text" id="edit-device-host" value="${escapeHTML(device.host || '')}" required>
      </div>
      <div class="form-group">
        <label for="edit-device-platform">Platform</label>
        <div class="platform-select-group">
          <select id="edit-device-platform">
            ${platformOptionsHTML}
          </select>
          <div id="edit-platform-badge" class="platform-badge-display"></div>
        </div>
      </div>
      <div class="form-group">
        <label for="edit-device-user">SSH User</label>
        <input type="text" id="edit-device-user" value="${escapeHTML(device.user || 'root')}">
      </div>
      <div class="form-group">
        <label for="edit-device-connection">Link</label>
        <select id="edit-device-connection">
          <option value="auto"${connectionMode === 'auto' ? ' selected' : ''}>Follow network default</option>
          <option value="wired"${connectionMode === 'wired' ? ' selected' : ''}>Wired (LAN)</option>
          <option value="wireless"${connectionMode === 'wireless' ? ' selected' : ''}>Wireless (Wi-Fi)</option>
        </select>
        <p class="muted muted-sm">When following the network, the link is derived from the assigned network group.</p>
      </div>
    `;

    const platformSelect = document.getElementById('edit-device-platform');
    const badgeContainer = document.getElementById('edit-platform-badge');
    const connectionSelect = document.getElementById('edit-device-connection');

    const syncPlatformUI = () => {
      if (!platformSelect) { return; }
      const selectedOption = platformSelect.selectedOptions?.[0];
      const value = platformSelect.value || '';
      const displayLabel = (selectedOption?.text || value || '').trim();
      state.editState.deviceConfig.platform = value;
      if (displayLabel) {
        state.editState.deviceConfig.platform_display = displayLabel;
      } else {
        delete state.editState.deviceConfig.platform_display;
      }
      renderPlatformBadgeInto(badgeContainer, displayLabel || value, { variant: 'inline' });
      updateEditSubtitle(state.editState.deviceConfig);
    };

    const syncConnectionUI = () => {
      if (!connectionSelect) { return; }
      const mode = connectionSelect.value || 'auto';
      if (!state.editState.deviceConfig) {
        state.editState.deviceConfig = {};
      }
      state.editState.deviceConfig.connection = mode;
      state.editState.deviceConfig.connection_override = mode !== 'auto';
    };

    updateEditSubtitle(device);
    syncPlatformUI();
    platformSelect?.addEventListener('change', syncPlatformUI);
    syncConnectionUI();
    connectionSelect?.addEventListener('change', syncConnectionUI);
  }

  /**
   * Validate device configuration
   */
  async function validateDevice() {
    if (state.editState.isValidating) return;

    state.editState.isValidating = true;
    setEditStep(EDIT_STEPS.VALIDATION);

    const validationLoading = document.getElementById('edit-validation-loading');
    const validationResults = document.getElementById('edit-validation-results');

    if (validationLoading) validationLoading.classList.remove('hidden');
    if (validationResults) validationResults.classList.add('hidden');

    try {
      // Collect form data
      const formData = collectFormData();
      
      // Validate with API
      const validation = await jsonFetch(`/api/devices/${state.editState.deviceId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      state.editState.validation = validation;
      renderValidationResults(validation);
    } catch (error) {
      console.error('Validation failed:', error);
      showToast('Device validation failed', 'error');
    } finally {
      state.editState.isValidating = false;
      if (validationLoading) validationLoading.classList.add('hidden');
    }
  }

  /**
   * Save device configuration
   */
  async function saveDevice() {
    if (state.editState.isSaving) return;

    state.editState.isSaving = true;

    try {
      const formData = collectFormData();
      
      await jsonFetch(`/api/devices/${state.editState.deviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      showToast('Device updated successfully', 'success');
      closeEditOverlay();
      
      // Refresh device list
      window.dispatchEvent(new CustomEvent('deviceUpdated', { detail: { deviceId: state.editState.deviceId } }));
    } catch (error) {
      console.error('Failed to save device:', error);
      showToast('Failed to save device', 'error');
    } finally {
      state.editState.isSaving = false;
    }
  }

  /**
   * Collect form data
   */
  function collectFormData() {
    const nameInput = document.getElementById('edit-device-name');
    const hostInput = document.getElementById('edit-device-host');
    const platformSelect = document.getElementById('edit-device-platform');
    const userInput = document.getElementById('edit-device-user');
    const connectionSelect = document.getElementById('edit-device-connection');
    const connectionMode = connectionSelect?.value || 'auto';

    return {
      name: nameInput?.value || '',
      host: hostInput?.value || '',
      platform: platformSelect?.value || '',
      user: userInput?.value || 'root',
      connection: connectionMode,
      connection_override: connectionMode !== 'auto'
    };
  }

  /**
   * Render validation results
   */
  function renderValidationResults(validation) {
    const resultsContainer = document.getElementById('edit-validation-results');
    if (!resultsContainer) return;

    const isValid = validation.success;
    const issues = validation.issues || [];

    resultsContainer.innerHTML = `
      <div class="validation-status ${isValid ? 'success' : 'error'}">
        <h4>${isValid ? '✓ Validation Successful' : '✗ Validation Failed'}</h4>
        <p>${validation.message || (isValid ? 'Device configuration is valid' : 'Please fix the issues below')}</p>
      </div>
      ${issues.length > 0 ? `
        <div class="validation-issues">
          <h5>Issues Found:</h5>
          <ul>
            ${issues.map(issue => `<li class="issue-${issue.level}">${escapeHTML(issue.message)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `;

    resultsContainer.classList.remove('hidden');
  }

  // SSH Key Management Functions
  function closeSSHKeyModal() {
    if (state.sshModal) {
      state.sshModal.classList.add('hidden');
    }
  }

  async function saveSSHKey() {
    const nameInput = document.getElementById('edit-new-ssh-key-name');
    const contentInput = document.getElementById('edit-new-ssh-key-content');

    if (!nameInput?.value || !contentInput?.value) {
      showToast('Please provide both key name and content', 'error');
      return;
    }

    try {
      await jsonFetch('/api/ssh-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nameInput.value,
          content: contentInput.value
        })
      });

      showToast('SSH key saved successfully', 'success');
      nameInput.value = '';
      contentInput.value = '';
      loadSSHKeys(); // Refresh list
    } catch (error) {
      console.error('Failed to save SSH key:', error);
      showToast('Failed to save SSH key', 'error');
    }
  }

  // Backup Modal Functions
  function closeBackupModal() {
    if (state.backupModal) {
      state.backupModal.classList.add('hidden');
    }
  }

  // Utility Functions
  async function loadTemplates() {
    try {
      state.templatesCache = await jsonFetch('/api/templates');
    } catch (error) {
      console.error('Failed to load templates:', error);
      state.templatesCache = [];
    }
  }

  async function loadSSHKeys() {
    try {
      state.sshKeysCache = await jsonFetch('/api/ssh-keys');
    } catch (error) {
      console.error('Failed to load SSH keys:', error);
      state.sshKeysCache = [];
    }
  }

  function showToast(message, type = 'info') {
    const toasts = getToasts();
    if (toasts) {
      toasts.show({ message, type, duration: type === 'error' ? 6000 : 4000 });
    } else if (typeof console !== 'undefined') {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  // Export device action functions for use in device cards
  function editDevice(deviceId) {
    openDeviceEdit(deviceId);
  }

  function deleteDevice(deviceId) {
    const confirmDialog = getConfirm();
    if (confirmDialog && typeof confirmDialog.open === 'function') {
      confirmDialog.open({
        title: 'Delete Device',
        message: 'Are you sure you want to delete this device? This action cannot be undone.',
        onConfirm: async () => {
          try {
            await jsonFetch(`/api/devices/${deviceId}`, { method: 'DELETE' });
            showToast('Device deleted successfully', 'success');
            window.dispatchEvent(new CustomEvent('deviceDeleted', { detail: { deviceId } }));
          } catch (error) {
            console.error('Failed to delete device:', error);
            showToast('Failed to delete device', 'error');
          }
        }
      });
    } else {
      // Fallback to browser confirm
      if (confirm('Are you sure you want to delete this device? This action cannot be undone.')) {
        deleteDeviceConfirmed(deviceId);
      }
    }
  }

  async function deleteDeviceConfirmed(deviceId) {
    try {
      await jsonFetch(`/api/devices/${deviceId}`, { method: 'DELETE' });
      showToast('Device deleted successfully', 'success');
      window.dispatchEvent(new CustomEvent('deviceDeleted', { detail: { deviceId } }));
    } catch (error) {
      console.error('Failed to delete device:', error);
      showToast('Failed to delete device', 'error');
    }
  }

  function rebootDevice(deviceId) {
    const confirmDialog = getConfirm();
    if (confirmDialog && typeof confirmDialog.open === 'function') {
      confirmDialog.open({
        title: 'Reboot Device',
        message: 'Are you sure you want to reboot this device?',
        onConfirm: async () => {
          try {
            await jsonFetch(`/api/devices/${deviceId}/reboot`, { method: 'POST' });
            showToast('Reboot command sent', 'success');
          } catch (error) {
            console.error('Failed to reboot device:', error);
            showToast('Failed to send reboot command', 'error');
          }
        }
      });
    } else {
      // Fallback to browser confirm
      if (confirm('Are you sure you want to reboot this device?')) {
        rebootDeviceConfirmed(deviceId);
      }
    }
  }

  async function rebootDeviceConfirmed(deviceId) {
    try {
      await jsonFetch(`/api/devices/${deviceId}/reboot`, { method: 'POST' });
      showToast('Reboot command sent', 'success');
    } catch (error) {
      console.error('Failed to reboot device:', error);
      showToast('Failed to send reboot command', 'error');
    }
  }

  async function reprovisionDevice(deviceId) {
    if (!deviceId) {
      showToast('Device ID is missing', 'error');
      return;
    }
    try {
      await jsonFetch(`/api/devices/${deviceId}/reprovision`, { method: 'POST' });
      showToast('iPerf reprovision started', 'success');
    } catch (error) {
      console.error('Failed to reprovision device:', error);
      showToast('Failed to reprovision device', 'error');
    }
  }

    const api = PulseOps.deviceInteractions = PulseOps.deviceInteractions || {};
    api.init = initDeviceInteractions;
    api.open = openDeviceEdit;
    api.edit = editDevice;
    api.delete = deleteDevice;
    api.reboot = rebootDevice;
    api.reprovision = reprovisionDevice;

})(window, document);
