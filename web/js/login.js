(function (window, document) {
  'use strict';

  function initLogin() {
    const loginForm = document.getElementById('login-form');
    const loginButton = document.getElementById('login-button');
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const successMessage = document.getElementById('success-message');

    if (!loginForm || !loginButton || !loading || !errorMessage || !successMessage) {
      return;
    }

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
        }
      } catch (error) {
        console.error('Failed to check auth status:', error);
      }
    }

    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideMessages();

      const formData = new FormData(loginForm);
      const username = (formData.get('username') || '').toString().trim();
      const password = formData.get('password');

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
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username, password })
        });

        if (response.ok) {
          await response.json();
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

    checkAuthStatus();
  }

  function ready() {
    if (document.body.dataset.page !== 'login') {
      return;
    }
    initLogin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})(window, document);
