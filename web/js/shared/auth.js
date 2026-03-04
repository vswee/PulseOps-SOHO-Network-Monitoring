/**
 * Authentication utilities for PulseOps
 * Handles authentication state and user management
 */

(function() {
  'use strict';

  let authState = { 
    setup_completed: false, 
    authenticated: false, 
    user: null 
  };

  /**
   * Try to auto-login with common credentials
   */
  async function tryAutoLogin() {
    const commonCredentials = [
      { username: 'admin', password: 'admin' },
      { username: 'admin', password: 'password' },
      { username: 'admin', password: 'pulseops' },
      { username: 'pulseops', password: 'admin' },
      { username: 'pulseops', password: 'pulseops' }
    ];

    for (const creds of commonCredentials) {
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(creds)
        });

        if (response.ok) {
          console.log(`[Auth] Auto-login successful with ${creds.username}/${creds.password}`);
          return true;
        }
      } catch (error) {
        // Continue to next credential
      }
    }
    return false;
  }

  /**
   * Check authentication status
   */
  async function checkAuthStatus() {
    // Skip auth checks when using mock data on localhost
    if (window.location.hostname === 'localhost' && window.MockAPI) {
      authState = {
        setup_completed: true,
        authenticated: true,
        user: { username: 'Mock User' }
      };

      // Update UI with mock user info
      const usernameDisplay = document.getElementById('username-display');
      if (usernameDisplay) {
        usernameDisplay.textContent = authState.user.username;
      }

      return true;
    }

    try {
      const response = await fetch('/api/auth/status');
      authState = await response.json();

      if (!authState.setup_completed) {
        window.location.href = '/setup.html';
        return false;
      }

      if (!authState.authenticated) {
        // Try auto-login on localhost for development
        if (window.location.hostname === 'localhost') {
          console.log('[Auth] Not authenticated, trying auto-login...');
          const loginSuccess = await tryAutoLogin();
          if (loginSuccess) {
            // Re-check auth status after login
            const newResponse = await fetch('/api/auth/status');
            authState = await newResponse.json();
            if (authState.authenticated) {
              console.log('[Auth] Auto-login successful, user authenticated');
              // Update UI with user info
              if (authState.user) {
                const usernameDisplay = document.getElementById('username-display');
                if (usernameDisplay) {
                  usernameDisplay.textContent = authState.user.username;
                }
              }
              return true;
            }
          }
        }

        window.location.href = '/login.html';
        return false;
      }

      // Update UI with user info
      if (authState.user) {
        const usernameDisplay = document.getElementById('username-display');
        if (usernameDisplay) {
          usernameDisplay.textContent = authState.user.username;
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to check auth status:', error);
      window.location.href = '/login.html';
      return false;
    }
  }

  /**
   * Handle logout
   */
  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    } catch (error) {
      console.error('Logout failed:', error);
      window.location.href = '/login.html';
    }
  }

  /**
   * Initialize authentication
   */
  function initAuth() {
    // User menu functionality
    const userMenuTrigger = document.getElementById('user-menu-trigger');
    const userMenu = document.getElementById('user-menu');
    const logoutBtn = document.getElementById('logout-btn');

    if (userMenuTrigger && userMenu) {
      // User menu toggle
      userMenuTrigger.addEventListener('click', function() {
        userMenu.classList.toggle('hidden');
      });

      // Close menu when clicking outside
      document.addEventListener('click', function(e) {
        if (!userMenuTrigger.contains(e.target) && !userMenu.contains(e.target)) {
          userMenu.classList.add('hidden');
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }

    // Check auth status on page load
    checkAuthStatus();
  }

  /**
   * Get current authentication state
   */
  function getAuthState() {
    return { ...authState };
  }

  // Public API
  window.AuthModule = {
    init: initAuth,
    checkStatus: checkAuthStatus,
    logout: handleLogout,
    getState: getAuthState
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
  } else {
    initAuth();
  }

})();
