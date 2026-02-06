/**
 * Tanaghum State Manager
 * Lightweight reactive state management
 */

import { EventBus } from './event-bus.js';

const StateManager = (() => {
  // Private state
  let state = {
    // App status
    isLoading: false,
    currentStep: 'input', // 'input' | 'processing' | 'review' | 'export'

    // Content source
    source: {
      type: null, // 'youtube' | 'upload' | 'text'
      url: null,
      file: null,
      text: null
    },

    // Audio data
    audio: {
      blob: null,
      url: null,
      duration: 0,
      waveform: []
    },

    // Transcription
    transcript: {
      text: '',
      segments: [],
      vtt: '',
      language: 'ar',
      confidence: 0
    },

    // Analysis results
    analysis: {
      ilrLevel: null,
      ilrConfidence: 0,
      dialect: 'msa', // 'msa' | 'egyptian' | 'levantine' | 'gulf' | 'maghrebi'
      vocabulary: {
        total: 0,
        unique: 0,
        keyTerms: []
      },
      speakingRate: 0
    },

    // Lesson parameters
    params: {
      targetIlr: 2.0,
      topic: 'general',
      title: { ar: '', en: '' },
      description: { ar: '', en: '' }
    },

    // Generated questions
    questions: {
      pre: [],
      while: [],
      post: []
    },

    // Complete lesson object
    lesson: null,

    // LLM status
    llm: {
      provider: 'google', // 'google' | 'groq' | 'openrouter'
      quotaRemaining: {
        google: 250,
        groq: 1000,
        openrouter: 50
      }
    },

    // UI state
    ui: {
      theme: 'light',
      sidebarOpen: true,
      activeModal: null
    }
  };

  // Subscribers for state changes
  const subscribers = new Map();

  /**
   * Deep clone an object
   */
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Get value at path (e.g., 'audio.duration')
   */
  function getPath(obj, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
  }

  /**
   * Set value at path
   */
  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((acc, key) => {
      if (!(key in acc)) acc[key] = {};
      return acc[key];
    }, obj);
    target[last] = value;
  }

  return {
    /**
     * Get current state (or a specific path)
     * @param {string} [path] - Optional dot-notation path
     * @returns {*} State value
     */
    get(path) {
      if (path) {
        return clone(getPath(state, path));
      }
      return clone(state);
    },

    /**
     * Update state
     * @param {string|Object} pathOrUpdates - Path string or updates object
     * @param {*} [value] - Value if path is string
     */
    set(pathOrUpdates, value) {
      const prevState = clone(state);

      if (typeof pathOrUpdates === 'string') {
        setPath(state, pathOrUpdates, value);
        this._notify(pathOrUpdates, value, getPath(prevState, pathOrUpdates));
      } else {
        // Merge object
        Object.entries(pathOrUpdates).forEach(([key, val]) => {
          if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            state[key] = { ...state[key], ...val };
          } else {
            state[key] = val;
          }
          this._notify(key, state[key], prevState[key]);
        });
      }
    },

    /**
     * Subscribe to state changes
     * @param {string|Function} pathOrCallback - Path to watch or callback for all changes
     * @param {Function} [callback] - Callback if path provided
     * @returns {Function} Unsubscribe function
     */
    subscribe(pathOrCallback, callback) {
      const path = typeof pathOrCallback === 'string' ? pathOrCallback : '*';
      const cb = callback || pathOrCallback;

      if (!subscribers.has(path)) {
        subscribers.set(path, new Set());
      }
      subscribers.get(path).add(cb);

      return () => subscribers.get(path)?.delete(cb);
    },

    /**
     * Notify subscribers of state change
     * @private
     */
    _notify(path, newValue, oldValue) {
      // Notify specific path subscribers
      if (subscribers.has(path)) {
        subscribers.get(path).forEach(cb => cb(newValue, oldValue, path));
      }

      // Notify wildcard subscribers
      if (subscribers.has('*')) {
        subscribers.get('*').forEach(cb => cb(newValue, oldValue, path));
      }

      // Also emit to EventBus for cross-module communication
      EventBus.emit(`state:${path}`, { newValue, oldValue, path });
    },

    /**
     * Reset state to initial values
     * @param {string} [section] - Optional section to reset
     */
    reset(section) {
      if (section) {
        const initial = this._getInitial(section);
        if (initial !== undefined) {
          state[section] = initial;
          this._notify(section, state[section], null);
        }
      } else {
        state = this._getInitial();
        this._notify('*', state, null);
      }
    },

    /**
     * Get initial state values
     * @private
     */
    _getInitial(section) {
      const initial = {
        isLoading: false,
        currentStep: 'input',
        source: { type: null, url: null, file: null, text: null },
        audio: { blob: null, url: null, duration: 0, waveform: [] },
        transcript: { text: '', segments: [], vtt: '', language: 'ar', confidence: 0 },
        analysis: {
          ilrLevel: null,
          ilrConfidence: 0,
          dialect: 'msa',
          vocabulary: { total: 0, unique: 0, keyTerms: [] },
          speakingRate: 0
        },
        params: {
          targetIlr: 2.0,
          topic: 'general',
          title: { ar: '', en: '' },
          description: { ar: '', en: '' }
        },
        questions: { pre: [], while: [], post: [] },
        lesson: null,
        llm: {
          provider: 'google',
          quotaRemaining: { google: 250, groq: 1000, openrouter: 50 }
        },
        ui: { theme: 'light', sidebarOpen: true, activeModal: null }
      };

      return section ? initial[section] : initial;
    },

    /**
     * Debug: log current state
     */
    debug() {
      console.log('Current State:', clone(state));
    }
  };
})();

export { StateManager };
