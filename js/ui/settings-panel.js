/**
 * Tanaghum Settings Panel
 * Modal for managing user API keys and viewing quota
 */

import { authManager, AuthEvents } from '../core/auth.js';
import { EventBus } from '../core/event-bus.js';

const PROVIDERS = [
  {
    id: 'google',
    name: 'Google AI Studio',
    description: 'Gemini models — free tier: 1,500 requests/day',
    keyUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza...'
  }
];

let modalElement = null;

/**
 * Initialize settings panel
 */
export function initSettingsPanel() {
  // Listen for settings:open event from auth dropdown
  EventBus.on('settings:open', () => openSettings());
}

/**
 * Open the settings modal
 */
async function openSettings() {
  if (!authManager.isAuthenticated) return;

  // Create modal if it doesn't exist
  if (!modalElement) {
    createModal();
  }

  // Show modal
  modalElement.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Load current keys and quota
  await refreshSettings();
}

/**
 * Close the settings modal
 */
function closeSettings() {
  if (modalElement) {
    modalElement.classList.remove('active');
    document.body.style.overflow = '';
  }
}

/**
 * Create the settings modal DOM
 */
function createModal() {
  modalElement = document.createElement('div');
  modalElement.className = 'modal-backdrop';
  modalElement.id = 'settings-modal';
  modalElement.innerHTML = `
    <div class="modal settings-modal" role="dialog" aria-label="API Key Settings">
      <div class="modal-header">
        <h2 class="modal-title">Settings</h2>
        <button class="modal-close" aria-label="Close settings">&times;</button>
      </div>
      <div class="modal-body">
        <section class="settings-section">
          <h3 class="settings-section-title">API Keys</h3>
          <p class="settings-section-desc">
            Add your own API keys for unlimited usage. Keys are encrypted and stored securely.
          </p>
          <div class="settings-keys-list" id="settings-keys-list"></div>
        </section>
        <section class="settings-section">
          <h3 class="settings-section-title">Usage Today</h3>
          <div class="settings-quota" id="settings-quota">
            <p class="settings-quota-loading">Loading...</p>
          </div>
        </section>
      </div>
    </div>
  `;

  document.body.appendChild(modalElement);

  // Close handlers
  modalElement.querySelector('.modal-close').addEventListener('click', closeSettings);
  modalElement.addEventListener('click', (e) => {
    if (e.target === modalElement) closeSettings();
  });

  // Render provider key forms
  renderKeyForms();
}

/**
 * Render API key forms for each provider
 */
function renderKeyForms() {
  const container = document.getElementById('settings-keys-list');
  if (!container) return;

  container.innerHTML = PROVIDERS.map(p => `
    <div class="settings-key-item" data-provider="${p.id}">
      <div class="settings-key-header">
        <div>
          <strong class="settings-key-name">${p.name}</strong>
          <span class="settings-key-desc">${p.description}</span>
        </div>
        <span class="settings-key-status" data-status="none">Not configured</span>
      </div>
      <div class="settings-key-form">
        <input type="password" class="form-input settings-key-input"
               placeholder="${p.placeholder}"
               aria-label="${p.name} API key"
               autocomplete="off">
        <button class="btn btn-sm btn-primary settings-key-save" data-provider="${p.id}">Save</button>
        <button class="btn btn-sm btn-secondary settings-key-delete" data-provider="${p.id}" style="display:none">Remove</button>
      </div>
      <a href="${p.keyUrl}" target="_blank" rel="noopener" class="settings-key-link">
        Get a free key &rarr;
      </a>
    </div>
  `).join('');

  // Bind save/delete handlers
  container.querySelectorAll('.settings-key-save').forEach(btn => {
    btn.addEventListener('click', () => saveKey(btn.dataset.provider));
  });

  container.querySelectorAll('.settings-key-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteKey(btn.dataset.provider));
  });
}

/**
 * Refresh settings data from server
 */
async function refreshSettings() {
  // Load keys
  const keys = await authManager.getKeys();
  const configuredProviders = new Set(keys.map(k => k.provider));

  PROVIDERS.forEach(p => {
    const item = document.querySelector(`.settings-key-item[data-provider="${p.id}"]`);
    if (!item) return;

    const status = item.querySelector('.settings-key-status');
    const input = item.querySelector('.settings-key-input');
    const deleteBtn = item.querySelector('.settings-key-delete');

    if (configuredProviders.has(p.id)) {
      status.textContent = 'Configured';
      status.dataset.status = 'active';
      input.placeholder = '••••••••';
      input.value = '';
      deleteBtn.style.display = '';
    } else {
      status.textContent = 'Not configured';
      status.dataset.status = 'none';
      input.placeholder = p.placeholder;
      deleteBtn.style.display = 'none';
    }
  });

  // Load quota
  const quota = await authManager.getQuota();
  const quotaEl = document.getElementById('settings-quota');
  if (quotaEl && quota) {
    quotaEl.innerHTML = `
      <div class="settings-quota-info">
        <span class="settings-quota-tier">${quota.tier === 'own_keys' ? 'Own Keys (Unlimited)' : quota.tier === 'authenticated' ? 'Free Tier' : 'Anonymous'}</span>
        <span class="settings-quota-usage">${quota.used} / ${quota.tier === 'own_keys' ? '&infin;' : quota.limit} requests today</span>
      </div>
      ${quota.tier !== 'own_keys' ? `
        <div class="settings-quota-bar">
          <div class="settings-quota-fill" style="width: ${Math.min(100, (quota.used / quota.limit) * 100)}%"></div>
        </div>
      ` : ''}
    `;
  }
}

/**
 * Save an API key
 */
async function saveKey(provider) {
  const item = document.querySelector(`.settings-key-item[data-provider="${provider}"]`);
  if (!item) return;

  const input = item.querySelector('.settings-key-input');
  const apiKey = input.value.trim();

  if (!apiKey || apiKey.length < 10) {
    input.classList.add('input-error');
    setTimeout(() => input.classList.remove('input-error'), 2000);
    return;
  }

  const saveBtn = item.querySelector('.settings-key-save');
  saveBtn.textContent = 'Saving...';
  saveBtn.disabled = true;

  const success = await authManager.saveKey(provider, apiKey);

  saveBtn.textContent = 'Save';
  saveBtn.disabled = false;

  if (success) {
    input.value = '';
    await refreshSettings();
  } else {
    input.classList.add('input-error');
    setTimeout(() => input.classList.remove('input-error'), 2000);
  }
}

/**
 * Delete an API key
 */
async function deleteKey(provider) {
  const item = document.querySelector(`.settings-key-item[data-provider="${provider}"]`);
  if (!item) return;

  const deleteBtn = item.querySelector('.settings-key-delete');
  deleteBtn.textContent = 'Removing...';
  deleteBtn.disabled = true;

  const success = await authManager.deleteKey(provider);

  deleteBtn.textContent = 'Remove';
  deleteBtn.disabled = false;

  if (success) {
    await refreshSettings();
  }
}
