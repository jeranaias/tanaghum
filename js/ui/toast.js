/**
 * Tanaghum Toast Notifications
 * Lightweight notification system
 */

import { EventBus, Events } from '../core/event-bus.js';
import { Config } from '../core/config.js';

const Toast = (() => {
  let container = null;

  /**
   * Initialize toast container
   */
  function init() {
    if (container) return;

    container = document.createElement('div');
    container.className = 'toast-container';
    container.id = 'toast-container';
    document.body.appendChild(container);

    // Listen for toast events
    EventBus.on(Events.TOAST_SHOW, ({ type, title, message, duration }) => {
      show(type, title, message, duration);
    });
  }

  /**
   * Show a toast notification
   * @param {string} type - 'success' | 'error' | 'warning' | 'info'
   * @param {string} title - Toast title
   * @param {string} message - Toast message
   * @param {number} [duration] - Duration in ms (default from config)
   */
  function show(type, title, message, duration = Config.UI.toastDuration) {
    if (!container) init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      success: '&#10003;',
      error: '&#10007;',
      warning: '&#9888;',
      info: '&#8505;'
    };

    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-content">
        <div class="toast-title">${escapeHtml(title)}</div>
        ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Close">&times;</button>
    `;

    // Add close handler
    toast.querySelector('.toast-close').addEventListener('click', () => {
      removeToast(toast);
    });

    // Add to container
    container.appendChild(toast);

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => removeToast(toast), duration);
    }

    return toast;
  }

  /**
   * Remove a toast with animation
   */
  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;

    toast.style.animation = 'toast-slide-out 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Convenience methods
   */
  function success(title, message, duration) {
    return show('success', title, message, duration);
  }

  function error(title, message, duration) {
    return show('error', title, message, duration);
  }

  function warning(title, message, duration) {
    return show('warning', title, message, duration);
  }

  function info(title, message, duration) {
    return show('info', title, message, duration);
  }

  /**
   * Clear all toasts
   */
  function clear() {
    if (container) {
      container.innerHTML = '';
    }
  }

  return {
    init,
    show,
    success,
    error,
    warning,
    info,
    clear
  };
})();

// Add slide-out animation CSS if not present
if (!document.getElementById('toast-animations')) {
  const style = document.createElement('style');
  style.id = 'toast-animations';
  style.textContent = `
    @keyframes toast-slide-out {
      to {
        opacity: 0;
        transform: translateX(100%);
      }
    }
  `;
  document.head.appendChild(style);
}

export { Toast };
