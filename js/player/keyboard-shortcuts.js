/**
 * Tanaghum Keyboard Shortcuts
 * Handles keyboard navigation for the lesson player
 */

import { EventBus, Events } from '../core/event-bus.js';
import { createLogger } from '../core/utils.js';

const log = createLogger('KeyboardShortcuts');

/**
 * Default keyboard shortcut mappings
 */
const DEFAULT_SHORTCUTS = {
  // Playback controls
  'Space': 'togglePlay',
  'KeyK': 'togglePlay',
  'ArrowLeft': 'skipBackward',
  'KeyJ': 'skipBackward',
  'ArrowRight': 'skipForward',
  'KeyL': 'skipForward',
  'ArrowUp': 'volumeUp',
  'ArrowDown': 'volumeDown',
  'KeyM': 'toggleMute',
  'Home': 'seekStart',
  'End': 'seekEnd',

  // Speed controls
  'BracketLeft': 'decreaseSpeed',   // [
  'BracketRight': 'increaseSpeed',  // ]
  'Backspace': 'resetSpeed',

  // Navigation
  'KeyN': 'nextSegment',
  'KeyP': 'previousSegment',
  'KeyR': 'replaySegment',

  // Panels
  'KeyT': 'toggleTranscript',
  'KeyV': 'toggleVocabulary',
  'KeyQ': 'toggleQuiz',

  // Transcript
  'KeyS': 'toggleAutoScroll',
  'KeyC': 'toggleTranslation',

  // Misc
  'Escape': 'closePanel',
  'KeyF': 'toggleFullscreen',
  'Slash': 'showHelp'  // ?
};

/**
 * Keyboard Shortcuts class
 */
class KeyboardShortcuts {
  /**
   * @param {Object} player - LessonPlayer instance
   * @param {Object} options - Configuration options
   */
  constructor(player, options = {}) {
    this.player = player;
    this.enabled = true;
    this.shortcuts = { ...DEFAULT_SHORTCUTS, ...options.shortcuts };
    this.skipAmount = options.skipAmount ?? 5; // seconds
    this.volumeStep = options.volumeStep ?? 0.1;
    this.speedStep = options.speedStep ?? 0.25;

    // Callbacks for panel toggles
    this.onToggleTranscript = options.onToggleTranscript || (() => {});
    this.onToggleVocabulary = options.onToggleVocabulary || (() => {});
    this.onToggleQuiz = options.onToggleQuiz || (() => {});
    this.onToggleAutoScroll = options.onToggleAutoScroll || (() => {});
    this.onToggleTranslation = options.onToggleTranslation || (() => {});
    this.onClosePanel = options.onClosePanel || (() => {});
    this.onShowHelp = options.onShowHelp || (() => {});

    // Track modifier keys
    this.modifiers = {
      ctrl: false,
      alt: false,
      shift: false,
      meta: false
    };

    // Bind handlers
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);

    // Start listening
    this.attach();

    log.log('Keyboard shortcuts initialized');
  }

  /**
   * Attach keyboard event listeners
   */
  attach() {
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
  }

  /**
   * Detach keyboard event listeners
   */
  detach() {
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
  }

  /**
   * Check if the event target is an input element
   * @param {Event} e - Keyboard event
   * @returns {boolean}
   */
  isInputElement(e) {
    const target = e.target;
    const tagName = target.tagName.toLowerCase();
    const isEditable = target.isContentEditable;
    const isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';

    return isEditable || isInput;
  }

  /**
   * Handle keydown events
   * @param {KeyboardEvent} e
   */
  handleKeyDown(e) {
    // Update modifier state
    this.modifiers.ctrl = e.ctrlKey;
    this.modifiers.alt = e.altKey;
    this.modifiers.shift = e.shiftKey;
    this.modifiers.meta = e.metaKey;

    // Skip if disabled or in input element
    if (!this.enabled) return;
    if (this.isInputElement(e)) return;

    // Skip if any modifier is held (except for specific shortcuts)
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const code = e.code;
    const action = this.shortcuts[code];

    if (!action) return;

    // Handle shift variants
    if (e.shiftKey) {
      // Shift+? for help
      if (code === 'Slash') {
        this.executeAction('showHelp');
        e.preventDefault();
        return;
      }
      // Other shift combinations - skip
      return;
    }

    // Prevent default for handled keys
    if (this.executeAction(action)) {
      e.preventDefault();
    }
  }

  /**
   * Handle keyup events
   * @param {KeyboardEvent} e
   */
  handleKeyUp(e) {
    this.modifiers.ctrl = e.ctrlKey;
    this.modifiers.alt = e.altKey;
    this.modifiers.shift = e.shiftKey;
    this.modifiers.meta = e.metaKey;
  }

  /**
   * Execute a shortcut action
   * @param {string} action - Action name
   * @returns {boolean} True if action was handled
   */
  executeAction(action) {
    if (!this.player) return false;

    switch (action) {
      // Playback
      case 'togglePlay':
        this.player.togglePlay();
        return true;

      case 'skipBackward':
        this.player.skip(-this.skipAmount);
        return true;

      case 'skipForward':
        this.player.skip(this.skipAmount);
        return true;

      case 'volumeUp':
        this.adjustVolume(this.volumeStep);
        return true;

      case 'volumeDown':
        this.adjustVolume(-this.volumeStep);
        return true;

      case 'toggleMute':
        this.toggleMute();
        return true;

      case 'seekStart':
        this.player.seek(0);
        return true;

      case 'seekEnd':
        this.player.seek(this.player.duration);
        return true;

      // Speed
      case 'decreaseSpeed':
        this.adjustSpeed(-this.speedStep);
        return true;

      case 'increaseSpeed':
        this.adjustSpeed(this.speedStep);
        return true;

      case 'resetSpeed':
        this.player.setPlaybackRate(1.0);
        EventBus.emit(Events.TOAST_SHOW, { message: 'Speed: 1.0x', type: 'info' });
        return true;

      // Navigation
      case 'nextSegment':
        this.navigateSegment(1);
        return true;

      case 'previousSegment':
        this.navigateSegment(-1);
        return true;

      case 'replaySegment':
        this.replayCurrentSegment();
        return true;

      // Panels
      case 'toggleTranscript':
        this.onToggleTranscript();
        return true;

      case 'toggleVocabulary':
        this.onToggleVocabulary();
        return true;

      case 'toggleQuiz':
        this.onToggleQuiz();
        return true;

      case 'toggleAutoScroll':
        this.onToggleAutoScroll();
        return true;

      case 'toggleTranslation':
        this.onToggleTranslation();
        return true;

      case 'closePanel':
        this.onClosePanel();
        return true;

      case 'toggleFullscreen':
        this.toggleFullscreen();
        return true;

      case 'showHelp':
        this.onShowHelp();
        return true;

      default:
        return false;
    }
  }

  /**
   * Adjust volume
   * @param {number} delta - Volume change
   */
  adjustVolume(delta) {
    const audio = this.player.audioElement;
    if (audio) {
      audio.volume = Math.max(0, Math.min(1, audio.volume + delta));
      EventBus.emit(Events.TOAST_SHOW, {
        message: `Volume: ${Math.round(audio.volume * 100)}%`,
        type: 'info'
      });
    }
  }

  /**
   * Toggle mute
   */
  toggleMute() {
    const audio = this.player.audioElement;
    if (audio) {
      audio.muted = !audio.muted;
      EventBus.emit(Events.TOAST_SHOW, {
        message: audio.muted ? 'Muted' : 'Unmuted',
        type: 'info'
      });
    }
  }

  /**
   * Adjust playback speed
   * @param {number} delta - Speed change
   */
  adjustSpeed(delta) {
    const newRate = Math.max(0.5, Math.min(2.0, this.player.playbackRate + delta));
    this.player.setPlaybackRate(newRate);
    EventBus.emit(Events.TOAST_SHOW, {
      message: `Speed: ${newRate.toFixed(2)}x`,
      type: 'info'
    });
  }

  /**
   * Navigate to next/previous segment
   * @param {number} direction - 1 for next, -1 for previous
   */
  navigateSegment(direction) {
    const newIndex = this.player.activeSegmentIndex + direction;
    const segments = this.player.lesson?.content?.transcript?.segments || [];

    if (newIndex >= 0 && newIndex < segments.length) {
      this.player.seekToSegment(newIndex);
    }
  }

  /**
   * Replay current segment from start
   */
  replayCurrentSegment() {
    const index = this.player.activeSegmentIndex;
    if (index >= 0) {
      this.player.seekToSegment(index);
      if (!this.player.isPlaying) {
        this.player.play();
      }
    }
  }

  /**
   * Toggle fullscreen
   */
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  /**
   * Enable shortcuts
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Disable shortcuts
   */
  disable() {
    this.enabled = false;
  }

  /**
   * Get help text for shortcuts
   * @returns {Object} Shortcuts grouped by category
   */
  getHelpText() {
    return {
      'Playback': {
        'Space / K': 'Play/Pause',
        'J / Left Arrow': 'Skip back 5s',
        'L / Right Arrow': 'Skip forward 5s',
        'Up Arrow': 'Volume up',
        'Down Arrow': 'Volume down',
        'M': 'Toggle mute',
        'Home': 'Go to start',
        'End': 'Go to end'
      },
      'Speed': {
        '[': 'Slow down',
        ']': 'Speed up',
        'Backspace': 'Reset speed'
      },
      'Navigation': {
        'N': 'Next segment',
        'P': 'Previous segment',
        'R': 'Replay current segment'
      },
      'Panels': {
        'T': 'Toggle transcript',
        'V': 'Toggle vocabulary',
        'Q': 'Toggle quiz',
        'S': 'Toggle auto-scroll',
        'C': 'Toggle translation',
        'Esc': 'Close panel'
      },
      'Other': {
        'F': 'Toggle fullscreen',
        '?': 'Show this help'
      }
    };
  }

  /**
   * Cleanup
   */
  destroy() {
    this.detach();
    this.player = null;
  }
}

export { KeyboardShortcuts, DEFAULT_SHORTCUTS };
