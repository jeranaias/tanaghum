/**
 * Tanaghum Event Bus
 * Lightweight pub/sub system for loose coupling between modules
 */

const EventBus = (() => {
  const listeners = new Map();

  return {
    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(callback);

      // Return unsubscribe function
      return () => this.off(event, callback);
    },

    /**
     * Subscribe to an event once
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     */
    once(event, callback) {
      const wrapper = (...args) => {
        this.off(event, wrapper);
        callback(...args);
      };
      this.on(event, wrapper);
    },

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} callback - Handler to remove
     */
    off(event, callback) {
      if (listeners.has(event)) {
        listeners.get(event).delete(callback);
      }
    },

    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {*} data - Data to pass to handlers
     */
    emit(event, data) {
      if (listeners.has(event)) {
        listeners.get(event).forEach(callback => {
          try {
            callback(data);
          } catch (error) {
            console.error(`Error in event handler for "${event}":`, error);
          }
        });
      }
    },

    /**
     * Clear all listeners for an event (or all events)
     * @param {string} [event] - Optional event name
     */
    clear(event) {
      if (event) {
        listeners.delete(event);
      } else {
        listeners.clear();
      }
    },

    /**
     * Debug: list all registered events
     */
    debug() {
      const events = {};
      listeners.forEach((callbacks, event) => {
        events[event] = callbacks.size;
      });
      console.table(events);
    }
  };
})();

// Event name constants for consistency
const Events = {
  // Content acquisition
  CONTENT_SOURCE_CHANGED: 'content:source:changed',
  CONTENT_LOADED: 'content:loaded',
  CONTENT_ERROR: 'content:error',

  // Transcription
  TRANSCRIPTION_START: 'transcription:start',
  TRANSCRIPTION_PROGRESS: 'transcription:progress',
  TRANSCRIPTION_COMPLETE: 'transcription:complete',
  TRANSCRIPTION_ERROR: 'transcription:error',

  // Analysis
  ANALYSIS_START: 'analysis:start',
  ANALYSIS_COMPLETE: 'analysis:complete',

  // Question generation
  QUESTIONS_START: 'questions:start',
  QUESTIONS_PROGRESS: 'questions:progress',
  QUESTIONS_COMPLETE: 'questions:complete',

  // Lesson
  LESSON_GENERATED: 'lesson:generated',
  LESSON_SAVED: 'lesson:saved',
  LESSON_EXPORTED: 'lesson:exported',

  // Audio playback
  AUDIO_PLAY: 'audio:play',
  AUDIO_PAUSE: 'audio:pause',
  AUDIO_SEEK: 'audio:seek',
  AUDIO_TIME_UPDATE: 'audio:timeupdate',
  AUDIO_ENDED: 'audio:ended',
  AUDIO_RATE_CHANGE: 'audio:ratechange',

  // Transcript sync
  TRANSCRIPT_WORD_ACTIVE: 'transcript:word:active',
  TRANSCRIPT_LINE_ACTIVE: 'transcript:line:active',
  TRANSCRIPT_CLICK: 'transcript:click',

  // Quiz
  QUIZ_ANSWER_SELECTED: 'quiz:answer:selected',
  QUIZ_ANSWER_SUBMITTED: 'quiz:answer:submitted',
  QUIZ_COMPLETED: 'quiz:completed',

  // UI
  TOAST_SHOW: 'toast:show',
  MODAL_OPEN: 'modal:open',
  MODAL_CLOSE: 'modal:close',
  THEME_CHANGED: 'theme:changed',

  // LLM
  LLM_QUOTA_UPDATE: 'llm:quota:update',
  LLM_PROVIDER_SWITCH: 'llm:provider:switch',

  // Model loading (Whisper, etc.)
  MODEL_LOADING: 'model:loading',
  MODEL_READY: 'model:ready',
  MODEL_ERROR: 'model:error',

  // General
  ERROR: 'error',
  LOADING_START: 'loading:start',
  LOADING_END: 'loading:end'
};

export { EventBus, Events };
