(function (window, document) {
  'use strict';

  function initSetup() {
    const setupForm = document.getElementById('setup-form');
    const setupButton = document.getElementById('setup-button');
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const successMessage = document.getElementById('success-message');

    if (!setupForm || !setupButton || !loading || !errorMessage || !successMessage) {
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
        setupForm.style.display = 'none';
        loading.style.display = 'flex';
      } else {
        setupForm.style.display = 'flex';
        loading.style.display = 'none';
      }
    }

    async function checkSetupStatus() {
      try {
        const response = await fetch('/api/auth/setup');
        const data = await response.json();
        if (data.setup_completed) {
          window.location.href = '/';
        }
      } catch (error) {
        console.error('Failed to check setup status:', error);
      }
    }

    setupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideMessages();

      const formData = new FormData(setupForm);
      const username = (formData.get('username') || '').toString().trim();
      const email = (formData.get('email') || '').toString().trim();
      const password = formData.get('password') || '';
      const confirmPassword = formData.get('confirm-password') || '';

      if (!username) {
        showError('Username is required');
        return;
      }

      if (password.length < 6) {
        showError('Password must be at least 6 characters long');
        return;
      }

      if (password !== confirmPassword) {
        showError('Passwords do not match');
        return;
      }

      setLoading(true);

      try {
        const response = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username,
            email: email || undefined,
            password
          })
        });

        if (response.ok) {
          await response.json();
          showSuccess('Account created successfully! Redirecting...');
          setTimeout(() => {
            window.location.href = '/';
          }, 1500);
        } else {
          const errorText = await response.text();
          showError(errorText || 'Failed to create account');
        }
      } catch (error) {
        showError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    });

    checkSetupStatus();
  }

  function ready() {
    if (document.body.dataset.page !== 'setup') {
      return;
    }
    initSetup();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})(window, document);
