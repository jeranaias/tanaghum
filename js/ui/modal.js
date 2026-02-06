/**
 * Tanaghum Modal Dialog System
 */

import { EventBus, Events } from '../core/event-bus.js';

const Modal = (() => {
  let backdrop = null;
  let activeModal = null;

  /**
   * Initialize modal system
   */
  function init() {
    if (backdrop) return;

    // Create backdrop
    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        close();
      }
    });
    document.body.appendChild(backdrop);

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeModal) {
        close();
      }
    });

    // Listen for modal events
    EventBus.on(Events.MODAL_OPEN, ({ content, options }) => {
      open(content, options);
    });

    EventBus.on(Events.MODAL_CLOSE, () => {
      close();
    });
  }

  /**
   * Open a modal
   * @param {string|HTMLElement} content - Modal content
   * @param {Object} options - Modal options
   */
  function open(content, options = {}) {
    if (!backdrop) init();

    const {
      title = '',
      showClose = true,
      width = '500px',
      onClose = null,
      buttons = []
    } = options;

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = width;

    // Build modal HTML
    let html = '';

    // Header
    if (title || showClose) {
      html += `
        <div class="modal-header">
          ${title ? `<h3 class="modal-title">${escapeHtml(title)}</h3>` : '<div></div>'}
          ${showClose ? '<button class="modal-close" aria-label="Close">&times;</button>' : ''}
        </div>
      `;
    }

    // Body
    html += '<div class="modal-body"></div>';

    // Footer with buttons
    if (buttons.length > 0) {
      html += '<div class="modal-footer"></div>';
    }

    modal.innerHTML = html;

    // Add content to body
    const body = modal.querySelector('.modal-body');
    if (typeof content === 'string') {
      body.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      body.appendChild(content);
    }

    // Add buttons to footer
    if (buttons.length > 0) {
      const footer = modal.querySelector('.modal-footer');
      buttons.forEach(btn => {
        const button = document.createElement('button');
        button.className = `btn ${btn.primary ? 'btn-primary' : 'btn-secondary'}`;
        button.textContent = btn.label;
        button.addEventListener('click', () => {
          if (btn.onClick) btn.onClick();
          if (btn.closeOnClick !== false) close();
        });
        footer.appendChild(button);
      });
    }

    // Add close handler
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (onClose) onClose();
        close();
      });
    }

    // Store onClose callback
    modal._onClose = onClose;

    // Close any existing modal
    if (activeModal) {
      activeModal.remove();
    }

    // Add to backdrop and show
    backdrop.appendChild(modal);
    backdrop.classList.add('active');
    modal.classList.add('active');
    activeModal = modal;

    // Focus first focusable element
    const focusable = modal.querySelector('button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
    if (focusable) {
      setTimeout(() => focusable.focus(), 100);
    }

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    return modal;
  }

  /**
   * Close the active modal
   */
  function close() {
    if (!activeModal) return;

    // Call onClose callback
    if (activeModal._onClose) {
      activeModal._onClose();
    }

    // Animate out
    activeModal.classList.remove('active');
    backdrop.classList.remove('active');

    setTimeout(() => {
      if (activeModal) {
        activeModal.remove();
        activeModal = null;
      }
    }, 250);

    // Restore body scroll
    document.body.style.overflow = '';

    EventBus.emit(Events.MODAL_CLOSE);
  }

  /**
   * Confirm dialog
   * @param {string} message - Confirmation message
   * @param {Object} options - Options
   * @returns {Promise<boolean>}
   */
  function confirm(message, options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Confirm',
        confirmText = 'Confirm',
        cancelText = 'Cancel'
      } = options;

      open(message, {
        title,
        buttons: [
          {
            label: cancelText,
            onClick: () => resolve(false)
          },
          {
            label: confirmText,
            primary: true,
            onClick: () => resolve(true)
          }
        ],
        onClose: () => resolve(false)
      });
    });
  }

  /**
   * Alert dialog
   * @param {string} message - Alert message
   * @param {Object} options - Options
   * @returns {Promise<void>}
   */
  function alert(message, options = {}) {
    return new Promise((resolve) => {
      const { title = 'Alert', buttonText = 'OK' } = options;

      open(message, {
        title,
        buttons: [
          {
            label: buttonText,
            primary: true,
            onClick: () => resolve()
          }
        ],
        onClose: () => resolve()
      });
    });
  }

  /**
   * Prompt dialog
   * @param {string} message - Prompt message
   * @param {Object} options - Options
   * @returns {Promise<string|null>}
   */
  function prompt(message, options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Input',
        placeholder = '',
        defaultValue = '',
        confirmText = 'OK',
        cancelText = 'Cancel'
      } = options;

      const content = `
        <p>${escapeHtml(message)}</p>
        <input type="text" class="form-input" id="modal-prompt-input"
               placeholder="${escapeHtml(placeholder)}"
               value="${escapeHtml(defaultValue)}">
      `;

      const modal = open(content, {
        title,
        buttons: [
          {
            label: cancelText,
            onClick: () => resolve(null)
          },
          {
            label: confirmText,
            primary: true,
            closeOnClick: false,
            onClick: () => {
              const input = modal.querySelector('#modal-prompt-input');
              resolve(input ? input.value : null);
              close();
            }
          }
        ],
        onClose: () => resolve(null)
      });

      // Focus input and handle Enter key
      const input = modal.querySelector('#modal-prompt-input');
      if (input) {
        input.focus();
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            resolve(input.value);
            close();
          }
        });
      }
    });
  }

  /**
   * Escape HTML
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Check if a modal is open
   */
  function isOpen() {
    return activeModal !== null;
  }

  return {
    init,
    open,
    close,
    confirm,
    alert,
    prompt,
    isOpen
  };
})();

export { Modal };
