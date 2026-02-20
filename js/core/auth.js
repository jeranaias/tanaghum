/**
 * Tanaghum Auth Manager
 * Google OAuth login, JWT session management, and auth state
 */

import { Config } from './config.js';
import { EventBus } from './event-bus.js';

const AUTH_STORAGE_KEY = 'tanaghum_auth';

// Auth events
export const AuthEvents = {
  LOGIN: 'auth:login',
  LOGOUT: 'auth:logout',
  SESSION_EXPIRED: 'auth:session:expired'
};

class AuthManager {
  constructor() {
    this.user = null;
    this.token = null;
    this._initialized = false;
  }

  /**
   * Initialize auth state from localStorage
   */
  async init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.token && data.user) {
          this.token = data.token;
          this.user = data.user;

          // Verify session is still valid
          const valid = await this.verifySession();
          if (!valid) {
            this.clearAuth();
            EventBus.emit(AuthEvents.SESSION_EXPIRED);
          }
        }
      }
    } catch (e) {
      console.warn('[Auth] Failed to restore session:', e);
      this.clearAuth();
    }
  }

  /**
   * Handle Google Sign-In credential response
   * @param {string} credential - Google ID token from GSI
   * @returns {Object|null} User object on success
   */
  async handleGoogleCallback(credential) {
    try {
      const response = await fetch(`${Config.WORKER_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Login failed');
      }

      const data = await response.json();
      this.token = data.token;
      this.user = data.user;
      this.saveAuth();

      EventBus.emit(AuthEvents.LOGIN, this.user);
      return this.user;
    } catch (e) {
      console.error('[Auth] Google login failed:', e);
      return null;
    }
  }

  /**
   * Verify current session with the server
   * @returns {boolean} Whether the session is valid
   */
  async verifySession() {
    if (!this.token) return false;

    try {
      const response = await fetch(`${Config.WORKER_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) return false;

      const data = await response.json();
      if (data.authenticated && data.user) {
        this.user = data.user;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Log out the current user
   */
  logout() {
    const wasLoggedIn = !!this.user;
    this.clearAuth();
    if (wasLoggedIn) {
      EventBus.emit(AuthEvents.LOGOUT);
    }
  }

  /**
   * Get Authorization header value for API requests
   * @returns {Object} Headers object with Authorization if authenticated
   */
  getAuthHeaders() {
    if (!this.token) return {};
    return { 'Authorization': `Bearer ${this.token}` };
  }

  /**
   * Check if user is authenticated
   * @returns {boolean}
   */
  get isAuthenticated() {
    return !!(this.token && this.user);
  }

  /**
   * Save auth state to localStorage
   */
  saveAuth() {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
        token: this.token,
        user: this.user
      }));
    } catch (e) {
      console.warn('[Auth] Failed to save auth:', e);
    }
  }

  /**
   * Clear auth state
   */
  clearAuth() {
    this.token = null;
    this.user = null;
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  // --- User API Key Management ---

  /**
   * Get list of configured API key providers
   * @returns {Array} List of configured key info
   */
  async getKeys() {
    if (!this.token) return [];

    try {
      const response = await fetch(`${Config.WORKER_URL}/api/user/keys`, {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.keys || [];
    } catch {
      return [];
    }
  }

  /**
   * Save an API key for a provider
   * @param {string} provider - 'google', 'groq', or 'openrouter'
   * @param {string} apiKey - The API key to save
   * @returns {boolean} Success
   */
  async saveKey(provider, apiKey) {
    if (!this.token) return false;

    try {
      const response = await fetch(`${Config.WORKER_URL}/api/user/keys/${provider}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders()
        },
        body: JSON.stringify({ apiKey })
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Delete an API key for a provider
   * @param {string} provider - 'google', 'groq', or 'openrouter'
   * @returns {boolean} Success
   */
  async deleteKey(provider) {
    if (!this.token) return false;

    try {
      const response = await fetch(`${Config.WORKER_URL}/api/user/keys/${provider}`, {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get quota information from server
   * @returns {Object|null} Quota data
   */
  async getQuota() {
    try {
      const response = await fetch(`${Config.WORKER_URL}/api/user/quota`, {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }
}

// Singleton instance
const authManager = new AuthManager();

export { authManager, AuthManager };
