/**
 * PulseOps Dashboard - Main Application Module
 *
 * Responsibilities:
 * - Theme management (light/dark/system modes)
 * - Dashboard template injection and initialization
 * - Route resolution and navigation
 * - View controller initialization
 * - Application readiness coordination
 *
 * The dashboard uses a template-based architecture where individual page HTML files
 * are wrapped with a dashboard shell template that provides navigation and layout.
 */
(function (window, document) {
  'use strict';

  const PulseOps = window.PulseOps = window.PulseOps || {};

  /**
   * Manages application theme selection and persistence
   *
   * Features:
   * - Multiple theme options (light, dark, retro, sophisticated, system)
   * - Persistent theme preference in localStorage
   * - System theme detection and auto-switching
   * - Theme change event broadcasting
   */
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

    /**
     * Initializes theme manager by applying stored theme and setting up listeners
     */
    init() {
      this.applyTheme(this.currentTheme);
      this.setupSystemThemeListener();
    }

    getStoredTheme() {
      try {
        return localStorage.getItem('pulseops-theme');
      } catch (error) {
        console.warn('Unable to read stored theme preference', error);
        return null;
      }
    }

    setStoredTheme(theme) {
      try {
        localStorage.setItem('pulseops-theme', theme);
      } catch (error) {
        console.warn('Unable to persist theme preference', error);
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
      const rgb = backgroundColor?.match(/\d+/g);
      if (!rgb) {
        return this.isDarkTheme() ? '#ffffff' : '#000000';
      }
      const brightness = (parseInt(rgb[0], 10) * 299 + parseInt(rgb[1], 10) * 587 + parseInt(rgb[2], 10) * 114) / 1000;
      return brightness > 128 ? '#000000' : '#ffffff';
    }
  }

  window.themeManager = new ThemeManager();

  // ============================================================================
  // DASHBOARD CONFIGURATION
  // ============================================================================

  const DASHBOARD_TEMPLATE_URL = '/templates/dashboard-shell.html';

  /**
   * Maps route names to their corresponding URL paths
   * Used for route resolution and navigation
   */
  const DASHBOARD_ROUTES = {
    overview: ['/', '/index.html', '/overview.html'],
    'overview-map': ['/map.html'],
    'network-visualisation': ['/network-visualisation.html'],
    'network-analysis': ['/network-analysis.html'],
    logs: ['/logs.html'],
    devices: ['/devices.html'],
    keys: ['/keys.html'],
    settings: ['/settings.html'],
    insights: ['/insights.html']
  };

  // ============================================================================
  // APPLICATION STATE
  // ============================================================================

  let dashboardTemplateCache = null;
  let readyContext = null;
  let ready = false;
  const readyQueue = [];

  /**
   * Registers a callback to be called when the application is ready
   * If already ready, calls immediately
   * @param {Function} callback - Function to call with readyContext
   */
  function whenReady(callback) {
    if (typeof callback !== 'function') {
      return;
    }
    if (ready && readyContext) {
      try {
        callback(readyContext);
      } catch (error) {
        console.error('PulseOps ready callback failed', error);
      }
      return;
    }
    readyQueue.push(callback);
  }

  PulseOps.whenReady = whenReady;

  /**
   * Wraps page content with the dashboard shell template
   *
   * Process:
   * 1. Extracts content from [data-page-content] element
   * 2. Fetches dashboard shell template
   * 3. Replaces {{PAGE_CONTENT}} placeholder with page content
   * 4. Injects the complete template into the DOM
   *
   * This allows individual page HTML files to be simple content fragments
   * that get wrapped with navigation and layout when loaded as dashboard pages.
   *
   * @returns {Promise<void>}
   */
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
    const scriptEl = document.currentScript;
    if (scriptEl && scriptEl.parentElement === document.body) {
      document.body.insertBefore(fragment, scriptEl);
    } else {
      document.body.appendChild(fragment);
    }
    document.body.dataset.templateApplied = 'true';
  }

  /**
   * Resolves the current route from the data-route attribute on body
   * Used for explicit route specification in HTML
   * @returns {string|null} Route name or null if not found
   */
  function resolveRouteFromDataset() {
    const explicit = document.body?.dataset?.route;
    if (explicit && Object.prototype.hasOwnProperty.call(DASHBOARD_ROUTES, explicit)) {
      return explicit;
    }
    return null;
  }

  /**
   * Resolves the current route from the browser location
   * Matches the current pathname against configured routes
   * @returns {string} Route name, defaults to 'overview'
   */
  function resolveRouteFromLocation() {
    const path = window.location.pathname || '/';
    for (const [routeKey, paths] of Object.entries(DASHBOARD_ROUTES)) {
      if (paths.includes(path)) {
        return routeKey;
      }
    }
    return 'overview';
  }

  /**
   * Updates navigation UI to highlight the active route
   * Sets aria-current="page" on the active tab for accessibility
   * @param {string} route - The active route name
   */
  function highlightActiveNav(route) {
    const navTabs = document.querySelectorAll('.nav-tab');
    navTabs.forEach((tab) => {
      const isActive = tab.dataset.route === route || tab.dataset.view === route;
      tab.classList.toggle('active', isActive);
      if (isActive) {
        tab.setAttribute('aria-current', 'page');
      } else {
        tab.removeAttribute('aria-current');
      }
    });
  }

  /**
   * Initializes the view controller for the current route
   *
   * Process:
   * 1. Finds the view section element in the DOM
   * 2. Removes the hidden class to make it visible
   * 3. Looks up the controller for the route
   * 4. Calls controller.init() with section and shared context
   *
   * @param {string} route - The current route name
   * @param {Object} shared - Shared services (stores, utils, etc.)
   * @returns {Promise<void>}
   */
  async function initializeViewController(route, shared) {
    // Find the view section for the current route
    const viewSection = document.querySelector('[data-view-section]');
    if (!viewSection) {
      console.warn(`No view section found for route: ${route}`);
      return;
    }

    // Make the view section visible by removing the hidden class
    viewSection.classList.remove('hidden');

    // Get the controller for this route
    const views = PulseOps.views || {};
    const controller = views[route];
    if (!controller || typeof controller.init !== 'function') {
      console.warn(`No controller found for route: ${route}`);
      return;
    }

    // Initialize the controller with the view section and shared context
    try {
      await controller.init({
        section: viewSection,
        shared: shared,
        route: route
      });
    } catch (error) {
      console.error(`Failed to initialize controller for route ${route}:`, error);
    }
  }

  /**
   * Initializes the dashboard after template is applied
   *
   * Process:
   * 1. Ensures shared services are ready
   * 2. Refreshes authentication status
   * 3. Resolves the current route
   * 4. Initializes the view controller
   * 5. Processes any queued ready callbacks
   *
   * @returns {Promise<void>}
   */
  async function initialiseDashboard() {
    const isDebug = PulseOps.shared?.utils?.isDebugEnabled?.();
    if (isDebug) console.log('[MAIN] initialiseDashboard() started');

    const shared = PulseOps.shared;
    if (shared && typeof shared.ensureReady === 'function') {
      shared.ensureReady();
      if (isDebug) console.log('[MAIN] Shared services ensured ready');
    }
    try {
      if (isDebug) console.log('[MAIN] Refreshing auth state...');
      await shared?.auth?.refresh?.();
      if (isDebug) console.log('[MAIN] Auth state refreshed');
    } catch (error) {
      console.error('Failed to refresh auth state', error);
    }

    const route = resolveRouteFromDataset() || resolveRouteFromLocation();
    if (isDebug) console.log('[MAIN] Route resolved', { route });

    highlightActiveNav(route);

    if (shared?.agent && typeof shared.agent.setActiveRoute === 'function') {
      shared.agent.setActiveRoute(route);
    }

    // Initialize the view controller for the current route
    if (isDebug) console.log('[MAIN] Initializing view controller for route', { route });
    await initializeViewController(route, shared);
    if (isDebug) console.log('[MAIN] View controller initialized');

    readyContext = { shared, route };
    ready = true;
    if (isDebug) console.log('[MAIN] Dashboard ready, processing callbacks', { queueLength: readyQueue.length });

    while (readyQueue.length) {
      const callback = readyQueue.shift();
      try {
        callback(readyContext);
      } catch (error) {
        console.error('PulseOps ready callback failed', error);
      }
    }
    if (isDebug) console.log('[MAIN] initialiseDashboard() completed');
  }

  /**
   * Main application initialization on DOM ready
   *
   * Handles two scenarios:
   * 1. Non-dashboard pages: Just process ready callbacks
   * 2. Dashboard pages: Apply template, initialize dashboard, process callbacks
   */
  document.addEventListener('DOMContentLoaded', async () => {
    if (document.body.dataset.page !== 'dashboard') {
      // Non-dashboard page - just mark as ready
      ready = true;
      readyContext = { shared: PulseOps.shared, route: null };
      if (PulseOps.shared?.agent && typeof PulseOps.shared.agent.setActiveRoute === 'function') {
        PulseOps.shared.agent.setActiveRoute(null);
      }
      while (readyQueue.length) {
        const callback = readyQueue.shift();
        try {
          callback(readyContext);
        } catch (error) {
          console.error('PulseOps ready callback failed', error);
        }
      }
      return;
    }
    // Dashboard page - apply template and initialize
    try {
      await applyDashboardTemplateIfNeeded();
    } catch (error) {
      console.error('Failed to prepare dashboard template:', error);
    }
    await initialiseDashboard();
  });

  /**
   * Public runtime API for checking application state
   */
  PulseOps.runtime = {
    /**
     * Checks if the application is ready
     * @returns {boolean}
     */
    isReady() {
      return ready;
    },
    /**
     * Gets the current application context
     * @returns {Object} Context with shared services and current route
     */
    getContext() {
      return readyContext;
    }
  };
})(window, document);
