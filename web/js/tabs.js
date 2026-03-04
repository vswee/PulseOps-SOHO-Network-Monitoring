/**
 * Tabs Module - Handles active tab indication based on window location
 * This module can be included in any tab page to automatically highlight
 * the correct tab based on the current URL.
 */

(function() {
  'use strict';

  // Map of page URLs to their corresponding tab data-view values
  const PAGE_TAB_MAP = {
    '/overview.html': 'overview',
    '/index.html': 'overview',
    '/': 'overview',
    '/logs.html': 'logs',
    '/network-visualisation.html': 'network-visualisation',
    '/network-analysis.html': 'network-analysis',
    '/devices.html': 'devices',
    '/keys.html': 'keys',
    '/settings.html': 'settings',
    '/insights.html': 'insights'
  };

  // Also check for filename without path
  const FILENAME_TAB_MAP = {
    'overview.html': 'overview',
    'index.html': 'overview',
    'logs.html': 'logs',
    'network-visualisation.html': 'network-visualisation',
    'network-analysis.html': 'network-analysis',
    'devices.html': 'devices',
    'keys.html': 'keys',
    'settings.html': 'settings',
    'insights.html': 'insights'
  };

  // Alternative mapping for hash-based routing (fallback)
  const HASH_TAB_MAP = {
    '#overview': 'overview',
    '#logs': 'logs',
    '#network-visualisation': 'network-visualisation',
    '#network-analysis': 'network-analysis',
    '#devices': 'devices',
    '#keys': 'keys',
    '#settings': 'settings',
    '#insights': 'insights'
  };

  /**
   * Determines the active tab based on current location
   * @returns {string|null} The data-view value of the active tab
   */
  function getActiveTabFromLocation() {
    const pathname = window.location.pathname;
    const hash = window.location.hash;

    // First try to match by pathname
    if (PAGE_TAB_MAP[pathname]) {
      return PAGE_TAB_MAP[pathname];
    }

    // Try to match by filename only
    const filename = pathname.split('/').pop();
    if (filename && FILENAME_TAB_MAP[filename]) {
      return FILENAME_TAB_MAP[filename];
    }

    // Then try to match by hash (for backward compatibility)
    if (hash && HASH_TAB_MAP[hash]) {
      return HASH_TAB_MAP[hash];
    }

    // Default to overview if no match
    return 'overview';
  }

  /**
   * Updates the active state of navigation tabs
   * @param {string} activeTabView - The data-view value of the active tab
   */
  function updateTabActiveState(activeTabView) {
    const navTabs = document.querySelectorAll('.nav-tab');
    
    navTabs.forEach(tab => {
      const tabView = tab.getAttribute('data-view');
      const isActive = tabView === activeTabView;
      
      // Update active class
      tab.classList.toggle('active', isActive);
      
      // Update aria-current for accessibility
      if (isActive) {
        tab.setAttribute('aria-current', 'page');
      } else {
        tab.removeAttribute('aria-current');
      }
    });
  }

  /**
   * Initializes the tabs module
   */
  function initTabs() {
    // Set initial active state
    const activeTab = getActiveTabFromLocation();
    updateTabActiveState(activeTab);
    
    // Listen for hash changes (for backward compatibility with SPA routing)
    window.addEventListener('hashchange', function() {
      const newActiveTab = getActiveTabFromLocation();
      updateTabActiveState(newActiveTab);
    });
    
    // Add click handlers to tabs for analytics/tracking if needed
    const navTabs = document.querySelectorAll('.nav-tab');
    navTabs.forEach(tab => {
      tab.addEventListener('click', function(e) {
        // Allow normal navigation to proceed
        // This is where you could add analytics tracking
        const tabView = this.getAttribute('data-view');
        console.debug('Tab clicked:', tabView);
      });
    });
  }

  /**
   * Updates page title based on active tab
   * @param {string} tabView - The data-view value of the active tab
   */
  function updatePageTitle(tabView) {
    const TAB_TITLES = {
      'overview': 'Overview',
      'logs': 'Activity Logs',
      'network-visualisation': 'Network Visualisation',
      'network-analysis': 'Network Analysis',
      'devices': 'Devices',
      'keys': 'SSH Keys',
      'settings': 'Settings',
      'insights': 'Device Insights'
    };

    const tabTitle = TAB_TITLES[tabView] || 'Overview';
    document.title = `${tabTitle} - PulseOps`;
  }

  /**
   * Public API for the tabs module
   */
  window.TabsModule = {
    init: initTabs,
    getActiveTab: getActiveTabFromLocation,
    updateActiveState: updateTabActiveState,
    updateTitle: updatePageTitle
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabs);
  } else {
    initTabs();
  }

})();
