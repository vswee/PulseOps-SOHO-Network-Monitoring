/**
 * PulseOps Dashboard - Settings View
 *
 * Displays application settings for theme, account, and notifications
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
      shared.utils.debugLog('SETTINGS', message, data);
    }
  }

  const state = {
      shared: null,
      elements: {},
      currentSettings: null,
      saving: false,
      standaloneInitialised: false
    };

  function bindElements(section) {
    state.elements = {
      form: section.querySelector('#settings-form'),
      theme: section.querySelector('#settings-theme'),
      accountName: section.querySelector('#settings-account-name'),
      accountEmail: section.querySelector('#settings-account-email'),
      emailEnabled: section.querySelector('#settings-email-enabled'),
      emailHost: section.querySelector('#settings-email-host'),
      emailPort: section.querySelector('#settings-email-port'),
      emailUsername: section.querySelector('#settings-email-username'),
      emailPassword: section.querySelector('#settings-email-password'),
      emailClear: section.querySelector('#settings-email-clear'),
      emailPasswordNote: section.querySelector('#settings-email-password-note'),
      webEnabled: section.querySelector('#settings-web-enabled'),
      status: section.querySelector('#settings-status')
    };
  }

  function setStatus(message) {
    if (state.elements.status) {
      state.elements.status.textContent = message || '';
    }
  }

  function populateForm(settings) {
    if (!settings || !state.elements.form) { return; }
    state.elements.theme.value = settings.theme || 'light';
    state.elements.accountName.value = settings.account_name || '';
    state.elements.accountEmail.value = settings.account_email || '';
    state.elements.emailEnabled.checked = Boolean(settings.email_notifications_enabled);
    state.elements.emailHost.value = settings.email_server_host || '';
    state.elements.emailPort.value = settings.email_server_port || '';
    state.elements.emailUsername.value = settings.email_server_username || '';
    state.elements.emailPassword.value = '';
    state.elements.emailClear.checked = false;
    state.elements.webEnabled.checked = Boolean(settings.web_notifications_enabled);
    if (settings.email_server_password_set) {
      state.elements.emailPasswordNote.textContent = 'A password is already configured. Leave blank to keep it.';
    } else {
      state.elements.emailPasswordNote.textContent = 'No password stored. Provide one to enable authenticated SMTP.';
    }
  }

  async function loadSettings() {
    setStatus('Loading settings…');
    debug('loadSettings() started');
    try {
      debug('Fetching settings from /api/settings');
      const response = await state.shared.utils.jsonFetch('/api/settings');
      state.currentSettings = response;
      debug('Settings loaded successfully', { keys: Object.keys(response || {}).length });
      populateForm(mapSettingsResponse(response));
      setStatus('');
    } catch (error) {
      debug('Failed to load settings', { error: error.message });
      console.error('Failed to load settings', error);
      setStatus('Unable to load settings. Using defaults.');
      populateForm(mapSettingsResponse(null));
      state.shared.toasts.show({ message: 'Unable to load current settings. Adjustments will use defaults.', type: 'warning', duration: 5000 });
    }
    debug('loadSettings() completed');
  }

  function mapSettingsResponse(response) {
    if (!response) {
      return {
        theme: 'light',
        account_name: '',
        account_email: '',
        email_notifications_enabled: false,
        email_server_host: '',
        email_server_port: '',
        email_server_username: '',
        email_server_password_set: false,
        web_notifications_enabled: false
      };
    }
    return {
      theme: response.theme,
      account_name: response.account_name,
      account_email: response.account_email,
      email_notifications_enabled: response.email_notifications_enabled,
      email_server_host: response.email_server_host,
      email_server_port: response.email_server_port,
      email_server_username: response.email_server_username,
      email_server_password_set: response.email_server_password_set,
      web_notifications_enabled: response.web_notifications_enabled
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (state.saving) { return; }
    state.saving = true;
    setStatus('Saving changes…');
    try {
      const payload = {
        theme: state.elements.theme.value,
        account_name: state.elements.accountName.value.trim(),
        account_email: state.elements.accountEmail.value.trim(),
        email_notifications_enabled: state.elements.emailEnabled.checked,
        email_server_host: state.elements.emailHost.value.trim(),
        email_server_port: Number(state.elements.emailPort.value) || 587,
        email_server_username: state.elements.emailUsername.value.trim(),
        web_notifications_enabled: state.elements.webEnabled.checked
      };
      const password = state.elements.emailPassword.value.trim();
      if (state.elements.emailClear.checked) {
        payload.email_server_password = '';
      } else if (password) {
        payload.email_server_password = password;
      }

      const response = await state.shared.utils.jsonFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      state.shared.toasts.show({ message: 'Settings updated.', duration: 3000 });
      state.currentSettings = response;
      populateForm(mapSettingsResponse(response));
      setStatus('All changes saved.');
    } catch (error) {
      console.error('Failed to save settings', error);
      state.shared.toasts.show({ message: error.message || 'Failed to save settings.', type: 'error', duration: 5000 });
      setStatus('Failed to save settings.');
    } finally {
      state.saving = false;
    }
  }

    // Initialize for standalone page
    async function initStandalone() {
      if (state.standaloneInitialised) {
        return;
      }
      state.standaloneInitialised = true;
      state.shared = ensureShared();
      bindElements(document);
      if (state.elements.form) {
        state.elements.form.addEventListener('submit', handleSubmit);
      }
      await loadSettings();
    }

    const controller = {
      async init(context) {
        debug('init() called', { route: context.route });
        state.shared = context.shared;
        bindElements(context.section);
        debug('Elements bound');
        if (state.elements.form) {
          state.elements.form.addEventListener('submit', handleSubmit);
        }
        debug('Loading settings...');
        await loadSettings();
        debug('Settings loaded');
      },
      onShow() {},
      onHide() {}
    };

    views.settings = controller;

    PulseOps.whenReady(() => {
      if (document.body.dataset.page === 'dashboard') {
        initStandalone();
      }
    });
})(window, document);
