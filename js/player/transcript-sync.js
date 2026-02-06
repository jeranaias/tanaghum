/**
 * Tanaghum Transcript Sync
 * Handles synchronized transcript display with word/line highlighting
 */

import { EventBus, Events } from '../core/event-bus.js';
import { createLogger, escapeHtml, debounce } from '../core/utils.js';

const log = createLogger('TranscriptSync');

/**
 * Escape regex special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Transcript Sync class
 */
class TranscriptSync {
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    this.segments = [];
    this.translationSegments = [];
    this.activeIndex = -1;
    this.showTranslation = options.showTranslation ?? true;
    this.autoScroll = options.autoScroll ?? true;
    this.onSegmentClick = options.onSegmentClick || (() => {});
    this.isUserScrolling = false;
    this.userScrollTimeout = null;

    // Debounced scroll to prevent jank during rapid updates
    this.debouncedScrollToActive = debounce(this.scrollToActive.bind(this), 150);

    // Subscribe to events
    this.unsubscribe = EventBus.on(Events.TRANSCRIPT_LINE_ACTIVE, (data) => {
      this.setActiveSegment(data.index);
    });

    // Track user scrolling to temporarily disable auto-scroll
    this.handleUserScroll = this.handleUserScroll.bind(this);
  }

  /**
   * Handle user scroll to temporarily disable auto-scroll
   */
  handleUserScroll() {
    this.isUserScrolling = true;
    if (this.userScrollTimeout) {
      clearTimeout(this.userScrollTimeout);
    }
    // Re-enable auto-scroll after 3 seconds of no user scrolling
    this.userScrollTimeout = setTimeout(() => {
      this.isUserScrolling = false;
    }, 3000);
  }

  /**
   * Load transcript segments
   * @param {Array} segments - Transcript segments
   * @param {Array} translationSegments - Translation segments
   */
  load(segments, translationSegments = []) {
    this.segments = segments || [];
    this.translationSegments = translationSegments;
    this.activeIndex = -1;
    this.render();
  }

  /**
   * Render the transcript
   */
  render() {
    if (!this.container) return;

    this.container.innerHTML = '';

    this.segments.forEach((segment, index) => {
      const line = document.createElement('div');
      line.className = 'transcript-line';
      line.dataset.index = index;
      line.dataset.start = segment.start;
      line.dataset.end = segment.end || segment.start + 5;

      // Time marker
      const time = document.createElement('span');
      time.className = 'transcript-time';
      time.textContent = this.formatTime(segment.start);
      line.appendChild(time);

      // Content container
      const content = document.createElement('div');
      content.className = 'transcript-content';

      // Arabic text
      const arabicText = document.createElement('div');
      arabicText.className = 'transcript-arabic';
      arabicText.dir = 'rtl';
      arabicText.textContent = segment.text;
      content.appendChild(arabicText);

      // Translation (if available and enabled)
      if (this.showTranslation) {
        const translation = this.translationSegments[index];
        if (translation || segment.translation) {
          const transText = document.createElement('div');
          transText.className = 'transcript-translation';
          transText.textContent = translation?.text || segment.translation || '';
          content.appendChild(transText);
        }
      }

      line.appendChild(content);

      // Click handler
      line.addEventListener('click', () => {
        this.onSegmentClick(index, segment);
        EventBus.emit(Events.TRANSCRIPT_CLICK, { index, segment });
      });

      this.container.appendChild(line);
    });

    // Add scroll listener to detect user scrolling
    this.container.addEventListener('scroll', this.handleUserScroll, { passive: true });

    log.log(`Rendered ${this.segments.length} segments`);
  }

  /**
   * Set active segment
   * @param {number} index - Segment index
   */
  setActiveSegment(index) {
    if (index === this.activeIndex) return;

    // Remove active class from previous
    const prev = this.container?.querySelector('.transcript-line.active');
    if (prev) {
      prev.classList.remove('active');
    }

    this.activeIndex = index;

    // Add active class to current
    if (index >= 0) {
      const current = this.container?.querySelector(`[data-index="${index}"]`);
      if (current) {
        current.classList.add('active');

        // Auto-scroll to keep active line visible (debounced, respects user scrolling)
        if (this.autoScroll && !this.isUserScrolling) {
          this.debouncedScrollToActive(current);
        }
      }
    }
  }

  /**
   * Scroll to active element
   * @param {HTMLElement} element - Active element
   */
  scrollToActive(element) {
    if (!element || !this.container) return;

    const containerRect = this.container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Check if element is outside visible area
    if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }

  /**
   * Toggle translation visibility
   * @param {boolean} show - Show translation
   */
  toggleTranslation(show) {
    this.showTranslation = show;
    this.render();
  }

  /**
   * Toggle auto-scroll
   * @param {boolean} enabled - Enable auto-scroll
   */
  toggleAutoScroll(enabled) {
    this.autoScroll = enabled;
  }

  /**
   * Format time in MM:SS
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time
   */
  formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Get segment at index
   * @param {number} index - Segment index
   * @returns {Object|null} Segment
   */
  getSegment(index) {
    return this.segments[index] || null;
  }

  /**
   * Highlight search term
   * @param {string} term - Search term
   */
  highlightTerm(term) {
    if (!term || !this.container) return;

    // Escape regex special characters to prevent injection
    const escapedTerm = escapeRegex(term);
    const regex = new RegExp(`(${escapedTerm})`, 'gi');

    this.container.querySelectorAll('.transcript-arabic').forEach(el => {
      const text = el.textContent;
      if (regex.test(text)) {
        // Reset regex lastIndex after test
        regex.lastIndex = 0;
        // Escape HTML and then apply highlight
        el.innerHTML = escapeHtml(text).replace(regex, '<mark>$1</mark>');
      }
    });
  }

  /**
   * Clear highlights
   */
  clearHighlights() {
    this.container?.querySelectorAll('mark').forEach(mark => {
      mark.replaceWith(mark.textContent);
    });
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.userScrollTimeout) {
      clearTimeout(this.userScrollTimeout);
    }
    if (this.container) {
      this.container.removeEventListener('scroll', this.handleUserScroll);
      this.container.innerHTML = '';
    }
  }
}

export { TranscriptSync };
