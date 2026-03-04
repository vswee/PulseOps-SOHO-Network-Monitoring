/**
 * Shared utility functions for PulseOps
 */

(function() {
  'use strict';

  /**
   * Make a JSON fetch request
   */
  async function jsonFetch(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json();
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (match) => {
      switch (match) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return match;
      }
    });
  }

  /**
   * Format timestamp for display
   */
  function formatTimestamp(value) {
    if (!value) { return '—'; }
    let date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      const isoCandidate = String(value).replace(' ', 'T') + 'Z';
      date = new Date(isoCandidate);
    }
    if (Number.isNaN(date.getTime())) { return String(value); }
    return date.toLocaleString();
  }

  /**
   * Format file size in human readable format
   */
  function formatFileSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) { return '—'; }
    if (value < 1024) { return `${Math.round(value)} B`; }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let current = value;
    let unitIndex = 0;
    while (current >= 1024 && unitIndex < units.length - 1) {
      current /= 1024;
      unitIndex += 1;
    }
    const digits = current >= 10 ? 0 : 1;
    return `${current.toFixed(digits)} ${units[unitIndex]}`;
  }

  /**
   * Format duration in seconds to human readable format
   */
  function formatDuration(seconds) {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) { return '0s'; }
    let remaining = Math.floor(total);
    const days = Math.floor(remaining / 86400);
    remaining -= days * 86400;
    const hours = Math.floor(remaining / 3600);
    remaining -= hours * 3600;
    const minutes = Math.floor(remaining / 60);
    remaining -= minutes * 60;
    const parts = [];
    if (days) { parts.push(`${days}d`); }
    if (hours) { parts.push(`${hours}h`); }
    if (minutes) { parts.push(`${minutes}m`); }
    if (parts.length === 0) {
      parts.push(`${remaining}s`);
    }
    return parts.join(' ');
  }

  /**
   * Truncate text to specified length
   */
  function truncateText(value, max) {
    const str = String(value ?? '');
    if (str.length <= max) { return str; }
    return str.slice(0, Math.max(0, max - 1)) + '…';
  }

  /**
   * Format log time for display
   */
  function formatLogTime(value) {
    if (!value) { return '--'; }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) { return '--'; }
    const now = new Date();
    const diff = now - date;
    const opts = { hour: '2-digit', minute: '2-digit' };
    if (diff < 3600_000) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (diff < 24 * 3600_000) {
      return date.toLocaleTimeString([], opts);
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString([], opts);
  }

  /**
   * Create DOM element with attributes and children
   */
  function createElement(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') {
        element.className = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        element.setAttribute(key, value);
      }
    }
    children.flat().forEach(child => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child) {
        element.appendChild(child);
      }
    });
    return element;
  }

  /**
   * Show toast notification
   */
  function showToast(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = createElement('div', {
      class: `toast toast-${type}`,
      role: 'alert',
      'aria-live': 'polite'
    }, message);

    container.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, duration);

    // Allow manual dismissal
    toast.addEventListener('click', () => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    });
  }

  // Public API
  window.Utils = {
    jsonFetch,
    escapeHTML,
    formatTimestamp,
    formatFileSize,
    formatDuration,
    truncateText,
    formatLogTime,
    createElement,
    showToast
  };

})();
