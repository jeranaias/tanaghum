/**
 * Tanaghum Auth UI
 * Handles Google Sign-In button rendering and user menu interactions
 */

import { authManager, AuthEvents } from '../core/auth.js';
import { Config } from '../core/config.js';
import { EventBus } from '../core/event-bus.js';

/**
 * Initialize auth UI on page load
 * Call this after DOM is ready
 */
export async function initAuthUI() {
  const authSection = document.getElementById('auth-section');
  if (!authSection) return;

  // Set loading state
  authSection.dataset.state = 'loading';

  // Initialize auth manager (restores session from localStorage)
  await authManager.init();

  // Update UI based on auth state
  updateAuthUI();

  // Listen for auth events
  EventBus.on(AuthEvents.LOGIN, () => updateAuthUI());
  EventBus.on(AuthEvents.LOGOUT, () => updateAuthUI());
  EventBus.on(AuthEvents.SESSION_EXPIRED, () => updateAuthUI());

  // Set up user dropdown
  setupUserDropdown();

  // Initialize Google Sign-In
  initGoogleSignIn();
}

/**
 * Update the auth UI based on current state
 */
function updateAuthUI() {
  const authSection = document.getElementById('auth-section');
  if (!authSection) return;

  if (authManager.isAuthenticated) {
    authSection.dataset.state = 'logged-in';

    // Update avatar
    const avatar = authSection.querySelector('.user-avatar');
    if (avatar && authManager.user.picture) {
      avatar.src = authManager.user.picture;
      avatar.alt = authManager.user.name || 'User';
    }

    // Update name
    const nameEl = authSection.querySelector('.user-name');
    if (nameEl) {
      nameEl.textContent = authManager.user.name || '';
    }

    // Update email in dropdown
    const emailEl = authSection.querySelector('.user-dropdown-email');
    if (emailEl) {
      emailEl.textContent = authManager.user.email || '';
    }
  } else {
    authSection.dataset.state = 'logged-out';
  }
}

/**
 * Set up user dropdown toggle
 */
function setupUserDropdown() {
  const avatar = document.querySelector('.user-avatar');
  const dropdown = document.querySelector('.user-dropdown');
  if (!avatar || !dropdown) return;

  avatar.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
  });

  // Settings button
  const settingsBtn = document.getElementById('auth-settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      dropdown.classList.remove('open');
      EventBus.emit('settings:open');
    });
  }

  // Logout button
  const logoutBtn = document.getElementById('auth-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      dropdown.classList.remove('open');
      authManager.logout();
    });
  }
}

/**
 * Initialize Google Sign-In
 */
function initGoogleSignIn() {
  const clientId = Config.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.warn('[Auth UI] No Google Client ID configured');
    return;
  }

  // Load Google Identity Services script if not already loaded
  if (!document.getElementById('google-gsi-script')) {
    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => onGsiLoaded();
    document.head.appendChild(script);
  } else if (window.google?.accounts) {
    onGsiLoaded();
  }
}

/**
 * Called when Google Identity Services library is loaded
 */
function onGsiLoaded() {
  if (!window.google?.accounts) return;

  const clientId = Config.GOOGLE_CLIENT_ID;
  if (!clientId) return;

  // Initialize the Google Sign-In library with FedCM support
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: handleGoogleCredential,
    auto_select: true,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
    itp_support: true
  });

  // Render the real Google Sign-In button inside our custom container
  const googleBtnContainer = document.getElementById('google-signin-btn');
  if (googleBtnContainer) {
    window.google.accounts.id.renderButton(googleBtnContainer, {
      type: 'standard',
      shape: 'pill',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      width: 220
    });
  }

  // Auto-prompt for unauthenticated users — shows One Tap / FedCM account chooser
  if (!authManager.isAuthenticated) {
    window.google.accounts.id.prompt((notification) => {
      if (notification.isDisplayed()) {
        console.log('[Auth UI] Sign-in prompt displayed');
      }
      if (notification.isNotDisplayed()) {
        const reason = notification.getNotDisplayedReason();
        console.log('[Auth UI] Prompt not displayed:', reason);
        // If One Tap is suppressed (cooldown, user dismissed before), the rendered button still works
      }
      if (notification.getSkippedReason) {
        console.log('[Auth UI] Prompt skipped:', notification.getSkippedReason());
      }
    });
  }
}

/**
 * Handle Google credential response
 */
async function handleGoogleCredential(response) {
  if (!response.credential) return;

  const authSection = document.getElementById('auth-section');
  if (authSection) authSection.dataset.state = 'loading';

  const user = await authManager.handleGoogleCallback(response.credential);
  if (!user) {
    // Login failed - revert to logged out
    if (authSection) authSection.dataset.state = 'logged-out';
    console.error('[Auth UI] Login failed');
  }
}

// Expose for Google callback (non-module contexts)
window.handleTanaghumGoogleCredential = handleGoogleCredential;
