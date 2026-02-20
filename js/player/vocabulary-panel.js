/**
 * Tanaghum Vocabulary Panel
 * Displays vocabulary items with definitions, examples, and audio
 */

import { Config } from '../core/config.js';
import { EventBus, Events } from '../core/event-bus.js';
import { createLogger, escapeHtml, debounce } from '../core/utils.js';

const log = createLogger('VocabPanel');

/**
 * Vocabulary Panel class
 */
class VocabularyPanel {
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    this.vocabulary = [];
    this.filter = 'all';
    this.searchTerm = '';
    this.showDetails = options.showDetails ?? true;
    this.onWordClick = options.onWordClick || (() => {});
    this.onPlayAudio = options.onPlayAudio || (() => {});

    // TTS for pronunciation
    this.ttsEnabled = options.ttsEnabled ?? true;
    this.isSpeaking = false;

    // Transliteration display toggle
    this.showTranslit = false;

    // Debounced search to prevent excessive re-renders
    this.debouncedSearch = debounce((term) => {
      this.searchTerm = term;
      this.renderVocabList();
    }, 300);
  }

  /**
   * Load vocabulary items
   * @param {Object} vocabulary - Vocabulary data
   */
  load(vocabulary) {
    console.log('VocabularyPanel.load() called with:', {
      vocabularyType: typeof vocabulary,
      vocabularyValue: vocabulary,
      isArray: Array.isArray(vocabulary),
      hasItems: !!vocabulary?.items
    });
    // Handle both {items: [...]} structure and direct array
    // Ensure we always have an array, even if vocabulary is undefined or empty object
    if (Array.isArray(vocabulary)) {
      this.vocabulary = vocabulary;
    } else if (vocabulary && Array.isArray(vocabulary.items)) {
      this.vocabulary = vocabulary.items;
    } else {
      this.vocabulary = [];
    }
    this.filter = 'all';
    this.searchTerm = '';
    this.render();

    log.log(`Loaded ${this.vocabulary.length} vocabulary items`);
  }

  /**
   * Render the vocabulary panel
   */
  render() {
    if (!this.container) return;

    const filtered = this.getFilteredVocabulary();
    this.showTranslit = this.showTranslit ?? false;

    this.container.innerHTML = `
      <div class="vocab-header">
        <div class="vocab-search">
          <input type="text" class="vocab-search-input"
                 placeholder="Search vocabulary..."
                 value="${this.searchTerm}">
        </div>
        <div class="vocab-filters">
          <button class="vocab-filter-btn${this.filter === 'all' ? ' active' : ''}" data-filter="all">
            All (${this.vocabulary.length})
          </button>
          <button class="vocab-filter-btn${this.filter === 'nouns' ? ' active' : ''}" data-filter="nouns">
            Nouns
          </button>
          <button class="vocab-filter-btn${this.filter === 'verbs' ? ' active' : ''}" data-filter="verbs">
            Verbs
          </button>
          <button class="vocab-filter-btn${this.filter === 'adjectives' ? ' active' : ''}" data-filter="adjectives">
            Adj
          </button>
        </div>
        <div class="vocab-actions">
          <button class="vocab-action-btn${this.showTranslit ? ' active' : ''}" id="toggle-translit" title="Show transliteration">
            Aa
          </button>
          <button class="vocab-action-btn" id="export-anki" title="Export to Anki">
            &#128190;
          </button>
        </div>
      </div>

      <div class="vocab-list">
        ${filtered.length > 0
          ? filtered.map((item, i) => this.renderVocabItem(item, i)).join('')
          : '<div class="vocab-empty">No vocabulary items found</div>'
        }
      </div>
    `;

    this.attachEventListeners();
  }

  /**
   * Render a vocabulary item
   * @param {Object} item - Vocabulary item
   * @param {number} index - Item index
   * @returns {string} HTML
   */
  renderVocabItem(item, index) {
    // Escape all user-provided content to prevent XSS
    const arabic = escapeHtml(item.word_ar || item.arabic || item.word || '');
    const english = escapeHtml(item.word_en || item.english || item.translation || '');
    const root = escapeHtml(item.root || '');
    const pos = escapeHtml(item.pos || item.partOfSpeech || '');
    const definitionAr = escapeHtml(item.definition_ar || item.definitionAr || '');
    const definitionEn = escapeHtml(item.definition_en || item.definitionEn || '');
    const exampleAr = escapeHtml(item.example_ar || item.exampleAr || '');
    const exampleEn = escapeHtml(item.example_en || item.exampleEn || '');
    const frequency = item.frequency || '';

    // Generate transliteration if enabled
    const transliteration = this.showTranslit ? this.transliterate(item.word_ar || item.arabic || item.word || '') : '';

    // Frequency badge
    const freqBadge = frequency ? `<span class="vocab-freq freq-${frequency}" title="${frequency} frequency">${frequency.charAt(0).toUpperCase()}</span>` : '';

    return `
      <div class="vocab-item" data-index="${index}">
        <div class="vocab-item-header">
          <div class="vocab-word">
            <span class="vocab-arabic" dir="rtl">${arabic}</span>
            ${freqBadge}
            ${this.ttsEnabled ? '<button class="vocab-play-btn" title="Listen" aria-label="Listen to pronunciation">&#128266;</button>' : ''}
          </div>
          ${this.showTranslit && transliteration ? `<div class="vocab-translit">${escapeHtml(transliteration)}</div>` : ''}
          <div class="vocab-english">${english}</div>
        </div>

        ${this.showDetails ? `
          <div class="vocab-item-details">
            ${root ? `<div class="vocab-root"><span class="label">Root:</span> ${root}</div>` : ''}
            ${pos ? `<div class="vocab-pos"><span class="label">Type:</span> ${pos}</div>` : ''}

            ${definitionAr || definitionEn ? `
              <div class="vocab-definition">
                ${definitionAr ? `<div class="def-ar" dir="rtl">${definitionAr}</div>` : ''}
                ${definitionEn ? `<div class="def-en">${definitionEn}</div>` : ''}
              </div>
            ` : ''}

            ${exampleAr || exampleEn ? `
              <div class="vocab-example">
                <span class="label">Example:</span>
                ${exampleAr ? `<div class="example-ar" dir="rtl">"${exampleAr}"</div>` : ''}
                ${exampleEn ? `<div class="example-en">"${exampleEn}"</div>` : ''}
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Render just the vocabulary list (for search updates)
   */
  renderVocabList() {
    const listContainer = this.container?.querySelector('.vocab-list');
    if (!listContainer) return;

    const filtered = this.getFilteredVocabulary();
    listContainer.innerHTML = filtered.length > 0
      ? filtered.map((item, i) => this.renderVocabItem(item, i)).join('')
      : '<div class="vocab-empty">No vocabulary items found</div>';

    this.attachListEventListeners();
  }

  /**
   * Attach event listeners for list items only
   */
  attachListEventListeners() {
    // Play buttons
    this.container?.querySelectorAll('.vocab-play-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.vocab-item');
        const index = parseInt(item.dataset.index);
        this.playPronunciation(index);
      });
    });

    // Item click (toggle details or callback)
    this.container?.querySelectorAll('.vocab-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        const vocabItem = this.getFilteredVocabulary()[index];
        this.onWordClick(vocabItem, index);
      });
    });
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Search input with debouncing
    const searchInput = this.container?.querySelector('.vocab-search-input');
    searchInput?.addEventListener('input', (e) => {
      this.debouncedSearch(e.target.value);
    });

    // Filter buttons
    this.container?.querySelectorAll('.vocab-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Update active state visually
        this.container.querySelectorAll('.vocab-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filter = btn.dataset.filter;
        this.renderVocabList();
      });
    });

    // Transliteration toggle
    this.container?.querySelector('#toggle-translit')?.addEventListener('click', () => {
      this.showTranslit = !this.showTranslit;
      this.render();
    });

    // Anki export button
    this.container?.querySelector('#export-anki')?.addEventListener('click', () => {
      if (this.vocabulary.length === 0) {
        log.warn('No vocabulary to export');
        return;
      }
      this.downloadAnkiExport();
    });

    // Attach list item listeners
    this.attachListEventListeners();
  }

  /**
   * Get filtered vocabulary
   * @returns {Array} Filtered items
   */
  getFilteredVocabulary() {
    let items = this.vocabulary;

    // Apply category filter
    if (this.filter !== 'all') {
      items = items.filter(item => {
        const pos = (item.pos || item.partOfSpeech || '').toLowerCase();

        switch (this.filter) {
          case 'nouns':
            return pos.includes('noun') || pos.includes('اسم');
          case 'verbs':
            return pos.includes('verb') || pos.includes('فعل');
          case 'adjectives':
            return pos.includes('adj') || pos.includes('صفة');
          default:
            return true;
        }
      });
    }

    // Apply search filter
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      items = items.filter(item => {
        const arabic = (item.word_ar || item.arabic || '').toLowerCase();
        const english = (item.word_en || item.english || '').toLowerCase();
        const def = (item.definition_en || '').toLowerCase();

        return arabic.includes(term) || english.includes(term) || def.includes(term);
      });
    }

    return items;
  }

  /**
   * Play pronunciation using TTS
   * @param {number} index - Vocabulary item index
   */
  async playPronunciation(index) {
    // Prevent overlapping speech
    if (this.isSpeaking) {
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
      }
    }

    const items = this.getFilteredVocabulary();
    const item = items[index];

    if (!item) return;

    const word = item.word_ar || item.arabic || item.word;

    try {
      this.isSpeaking = true;

      // Use Web Speech API if available
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = 'ar';
        utterance.rate = 0.8;

        // Find Arabic voice if available
        const voices = speechSynthesis.getVoices();
        const arabicVoice = voices.find(v => v.lang.startsWith('ar'));
        if (arabicVoice) {
          utterance.voice = arabicVoice;
        }

        utterance.onend = () => { this.isSpeaking = false; };
        utterance.onerror = () => { this.isSpeaking = false; };

        speechSynthesis.speak(utterance);
      } else {
        // Fallback to worker TTS
        const audio = new Audio(`${Config.WORKER_URL}/api/tts?text=${encodeURIComponent(word)}&lang=ar`);
        audio.onended = () => { this.isSpeaking = false; };
        audio.onerror = () => { this.isSpeaking = false; };
        await audio.play();
      }

      this.onPlayAudio(item, word);
    } catch (error) {
      this.isSpeaking = false;
      log.error('TTS failed:', error);
    }
  }

  /**
   * Highlight word in vocabulary
   * @param {string} word - Word to highlight
   */
  highlightWord(word) {
    if (!word || !this.container) return;

    this.container.querySelectorAll('.vocab-item').forEach(item => {
      const arabic = item.querySelector('.vocab-arabic')?.textContent;
      if (arabic && arabic.includes(word)) {
        item.classList.add('highlighted');
      } else {
        item.classList.remove('highlighted');
      }
    });
  }

  /**
   * Clear highlights
   */
  clearHighlights() {
    this.container?.querySelectorAll('.vocab-item.highlighted').forEach(item => {
      item.classList.remove('highlighted');
    });
  }

  /**
   * Set filter
   * @param {string} filter - Filter type
   */
  setFilter(filter) {
    this.filter = filter;
    this.render();
  }

  /**
   * Toggle details visibility
   * @param {boolean} show - Show details
   */
  toggleDetails(show) {
    this.showDetails = show;
    this.render();
  }

  /**
   * Get statistics
   */
  getStats() {
    const items = this.vocabulary;

    const byType = {
      nouns: 0,
      verbs: 0,
      adjectives: 0,
      other: 0
    };

    items.forEach(item => {
      const pos = (item.pos || item.partOfSpeech || '').toLowerCase();
      if (pos.includes('noun') || pos.includes('اسم')) byType.nouns++;
      else if (pos.includes('verb') || pos.includes('فعل')) byType.verbs++;
      else if (pos.includes('adj') || pos.includes('صفة')) byType.adjectives++;
      else byType.other++;
    });

    return {
      total: items.length,
      byType
    };
  }

  /**
   * Export vocabulary to CSV
   * @returns {string} CSV content
   */
  exportToCSV() {
    const headers = ['Arabic', 'English', 'Root', 'Part of Speech', 'Definition', 'Example'];
    const rows = this.vocabulary.map(item => [
      item.word_ar || item.arabic || '',
      item.word_en || item.english || '',
      item.root || '',
      item.pos || item.partOfSpeech || '',
      item.definition_en || '',
      item.example_ar || ''
    ].map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Export vocabulary to Anki-compatible format
   * Creates a tab-separated file that can be imported directly into Anki
   * @returns {string} Tab-separated content
   */
  exportToAnki() {
    // Anki expects: Front TAB Back
    // We'll put Arabic on front, English + root + definition + example on back
    const cards = this.vocabulary.map(item => {
      const front = item.word_ar || item.arabic || item.word || '';
      const english = item.word_en || item.english || item.translation || '';
      const root = item.root || '';
      const pos = item.pos || item.type || '';
      const definition = item.definition_en || item.definitionEn || '';
      const example = item.example_ar || item.exampleAr || '';
      const exampleEn = item.example_en || item.exampleEn || '';

      // Build back of card with formatting
      let back = `<b>${english}</b>`;
      if (root && root !== '—') {
        back += `<br>Root: ${root}`;
      }
      if (pos) {
        back += ` (${pos})`;
      }
      if (definition) {
        back += `<br><br><i>${definition}</i>`;
      }
      if (example) {
        back += `<br><br><b>Example:</b><br>${example}`;
        if (exampleEn) {
          back += `<br><small>${exampleEn}</small>`;
        }
      }

      // Escape tabs and newlines
      return `${front}\t${back.replace(/\t/g, ' ').replace(/\n/g, '<br>')}`;
    });

    return cards.join('\n');
  }

  /**
   * Download Anki export file
   */
  downloadAnkiExport() {
    const content = this.exportToAnki();
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `tanaghum_vocab_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    log.log(`Exported ${this.vocabulary.length} words to Anki format`);
  }

  /**
   * Transliterate Arabic to Latin script
   * @param {string} arabic - Arabic text
   * @returns {string} Transliterated text
   */
  transliterate(arabic) {
    if (!arabic) return '';

    const map = {
      'ا': 'a', 'أ': 'ʾa', 'إ': 'ʾi', 'آ': 'ʾā', 'ء': 'ʾ',
      'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'ḥ',
      'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z',
      'س': 's', 'ش': 'sh', 'ص': 'ṣ', 'ض': 'ḍ', 'ط': 'ṭ',
      'ظ': 'ẓ', 'ع': 'ʿ', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
      'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
      'و': 'w', 'ي': 'y', 'ى': 'ā', 'ة': 'a', 'ؤ': 'ʾu', 'ئ': 'ʾi',
      // Diacritics
      '\u064E': 'a', '\u064F': 'u', '\u0650': 'i', // fatha, damma, kasra
      '\u064B': 'an', '\u064C': 'un', '\u064D': 'in', // tanwin
      '\u0651': '', // shadda (handled by doubling)
      '\u0652': '' // sukun
    };

    let result = '';
    for (let i = 0; i < arabic.length; i++) {
      const char = arabic[i];
      const nextChar = arabic[i + 1];

      // Handle shadda (double the consonant)
      if (nextChar === '\u0651' && map[char]) {
        result += map[char] + map[char];
        i++; // Skip shadda
      } else {
        result += map[char] || char;
      }
    }

    return result;
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

export { VocabularyPanel };
