/**
 * Tanaghum Lesson Exporter
 * Exports lessons as self-contained HTML files
 */

import { createLogger, formatTime } from '../core/utils.js';

const log = createLogger('LessonExporter');

/**
 * Default export options
 */
const DEFAULT_OPTIONS = {
  embedAudio: false,           // Embed audio as base64 (increases file size)
  includeTranslation: true,    // Include translation tab
  includeVocabulary: true,     // Include vocabulary
  includeQuestions: true,      // Include questions
  theme: 'light',              // 'light' or 'dark'
  minifyPlayer: false,         // Minify player JS (future enhancement)
  maxAudioSize: 15 * 1024 * 1024  // 15MB max for audio embedding
};

/**
 * Lesson Exporter class
 */
class LessonExporter {
  constructor() {
    this.template = null;
    this.playerScript = null;
  }

  /**
   * Load template and player script
   */
  async initialize() {
    if (this.template && this.playerScript) {
      return; // Already initialized
    }

    try {
      // Load HTML template
      const templateResponse = await fetch('/templates/lesson-template.html');
      if (!templateResponse.ok) {
        throw new Error('Failed to load lesson template');
      }
      this.template = await templateResponse.text();

      // Load standalone player script
      const playerResponse = await fetch('/js/export/standalone-player.js');
      if (!playerResponse.ok) {
        throw new Error('Failed to load player script');
      }
      this.playerScript = await playerResponse.text();

      log.log('Exporter initialized successfully');
    } catch (error) {
      log.error('Failed to initialize exporter:', error);
      throw error;
    }
  }

  /**
   * Export lesson to self-contained HTML
   * @param {Object} lesson - Lesson object
   * @param {Object} options - Export options
   * @returns {Promise<Blob>} HTML file blob
   */
  async exportLesson(lesson, options = {}) {
    await this.initialize();

    const opts = { ...DEFAULT_OPTIONS, ...options };

    log.log('Exporting lesson:', lesson.metadata?.title);
    const startTime = performance.now();

    try {
      // Generate HTML content
      const html = await this.generateHTML(lesson, opts);

      // Create blob
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });

      const processingTime = (performance.now() - startTime) / 1000;
      const sizeKB = (blob.size / 1024).toFixed(2);

      log.log(`Export completed in ${processingTime.toFixed(2)}s, size: ${sizeKB}KB`);

      return {
        blob,
        filename: this.generateFilename(lesson),
        size: blob.size,
        sizeFormatted: this.formatFileSize(blob.size)
      };

    } catch (error) {
      log.error('Export failed:', error);
      throw error;
    }
  }

  /**
   * Generate complete HTML file
   * @param {Object} lesson - Lesson object
   * @param {Object} options - Export options
   * @returns {Promise<string>} HTML content
   */
  async generateHTML(lesson, options) {
    let html = this.template;

    // Replace template variables
    html = this.replaceMetadata(html, lesson);
    html = await this.replaceMediaElement(html, lesson, options);
    html = this.replaceTheme(html, options);
    html = this.replaceContent(html, lesson, options);
    html = this.replaceLessonData(html, lesson, options);
    html = this.replacePlayerScript(html);

    return html;
  }

  /**
   * Replace metadata placeholders
   * @param {string} html - HTML template
   * @param {Object} lesson - Lesson object
   * @returns {string} Modified HTML
   */
  replaceMetadata(html, lesson) {
    const metadata = lesson.metadata || {};
    const createdDate = lesson.createdAt ?
      new Date(lesson.createdAt).toLocaleDateString() :
      new Date().toLocaleDateString();

    const replacements = {
      '{{LESSON_ID}}': lesson.id || 'unknown',
      '{{LESSON_TITLE}}': metadata.title || 'Untitled Lesson',
      '{{CREATED_DATE}}': createdDate,
      '{{DURATION}}': metadata.durationFormatted || formatTime(metadata.duration || 0),
      '{{ILR_LEVEL}}': metadata.ilr?.name || metadata.ilr?.level || 'N/A',
      '{{TOPIC}}': metadata.topic?.nameEn || 'General',
      '{{WORD_COUNT}}': (metadata.wordCount || 0).toLocaleString(),
      '{{DIALECT}}': metadata.dialect || 'MSA'
    };

    // Additional metadata items
    let metadataItems = '';
    if (metadata.source?.author) {
      metadataItems += `
        <div class="meta-item">
          <span>Author:</span>
          <span>${this.escapeHtml(metadata.source.author)}</span>
        </div>
      `;
    }

    replacements['{{METADATA_ITEMS}}'] = metadataItems;

    // Info rows
    let infoRows = '';
    if (metadata.ilr?.target) {
      infoRows += `
        <div class="info-row">
          <span class="info-label">Target Level:</span>
          <span>${metadata.ilr.target}</span>
        </div>
      `;
    }

    replacements['{{INFO_ROWS}}'] = infoRows;

    // Keyboard shortcuts card
    const keyboardShortcuts = `
      <div class="card" style="margin-top: 20px;">
        <h2 class="card-title">Keyboard Shortcuts</h2>
        <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.8;">
          <div><kbd>Space</kbd> - Play/Pause</div>
          <div><kbd>←</kbd> / <kbd>→</kbd> - Seek 5s</div>
          <div><kbd>↑</kbd> / <kbd>↓</kbd> - Speed ±0.25x</div>
        </div>
      </div>
    `;
    replacements['{{KEYBOARD_SHORTCUTS}}'] = keyboardShortcuts;

    return this.replaceAll(html, replacements);
  }

  /**
   * Replace media element (audio or video)
   * @param {string} html - HTML template
   * @param {Object} lesson - Lesson object
   * @param {Object} options - Export options
   * @returns {Promise<string>} Modified HTML
   */
  async replaceMediaElement(html, lesson, options) {
    const audio = lesson.audio || {};
    let mediaElement = '';

    if (audio.type === 'youtube') {
      // YouTube video - requires internet connection
      mediaElement = `
        <iframe
          id="media-player"
          width="100%"
          height="400"
          src="https://www.youtube.com/embed/${audio.videoId}?enablejsapi=1"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen>
        </iframe>
        <p style="text-align: center; margin-top: 8px; font-size: 13px; color: var(--text-secondary);">
          Note: YouTube video requires internet connection
        </p>
      `;

      log.warn('YouTube video exported - requires internet connection');

    } else if (options.embedAudio && audio.url) {
      // Embed audio as base64
      try {
        const audioData = await this.fetchAndEncodeAudio(audio.url, options.maxAudioSize);
        mediaElement = `
          <audio id="media-player" controls>
            <source src="${audioData.dataUrl}" type="${audioData.mimeType}">
            Your browser does not support the audio element.
          </audio>
        `;
        log.log(`Audio embedded as base64, size: ${this.formatFileSize(audioData.size)}`);

      } catch (error) {
        log.error('Failed to embed audio:', error);
        // Fallback to external URL
        mediaElement = this.createExternalAudioElement(audio.url);
      }

    } else if (audio.url) {
      // External audio URL (requires internet if not local)
      mediaElement = this.createExternalAudioElement(audio.url);

    } else {
      // No audio available
      mediaElement = `
        <div style="padding: 40px; text-align: center; color: var(--text-tertiary);">
          <p>No audio available for this lesson</p>
        </div>
      `;
      log.warn('No audio available for export');
    }

    return html.replace('{{MEDIA_ELEMENT}}', mediaElement);
  }

  /**
   * Create external audio element
   * @param {string} url - Audio URL
   * @returns {string} Audio HTML
   */
  createExternalAudioElement(url) {
    const isExternal = url.startsWith('http://') || url.startsWith('https://');
    const note = isExternal ?
      '<p style="text-align: center; margin-top: 8px; font-size: 13px; color: var(--text-secondary);">Note: Audio requires internet connection</p>' : '';

    return `
      <audio id="media-player" controls>
        <source src="${this.escapeHtml(url)}" type="audio/mpeg">
        Your browser does not support the audio element.
      </audio>
      ${note}
    `;
  }

  /**
   * Fetch and encode audio as base64
   * @param {string} url - Audio URL
   * @param {number} maxSize - Maximum size in bytes
   * @returns {Promise<Object>} Encoded audio data
   */
  async fetchAndEncodeAudio(url, maxSize) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.status}`);
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0');

      if (contentLength > maxSize) {
        throw new Error(`Audio file too large: ${this.formatFileSize(contentLength)} (max: ${this.formatFileSize(maxSize)})`);
      }

      const blob = await response.blob();
      const dataUrl = await this.blobToDataUrl(blob);

      return {
        dataUrl,
        mimeType: blob.type || 'audio/mpeg',
        size: blob.size
      };

    } catch (error) {
      throw new Error(`Failed to encode audio: ${error.message}`);
    }
  }

  /**
   * Convert blob to data URL
   * @param {Blob} blob - Blob to convert
   * @returns {Promise<string>} Data URL
   */
  blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Replace theme variables
   * @param {string} html - HTML template
   * @param {Object} options - Export options
   * @returns {string} Modified HTML
   */
  replaceTheme(html, options) {
    let themeVars = '';

    if (options.theme === 'dark') {
      themeVars = `
        --primary-color: #3b82f6;
        --primary-hover: #2563eb;
        --bg-primary: #1e293b;
        --bg-secondary: #0f172a;
        --bg-tertiary: #334155;
        --text-primary: #f1f5f9;
        --text-secondary: #cbd5e1;
        --text-tertiary: #64748b;
        --border-color: #334155;
      `;
    }

    return html.replace('{{THEME_VARIABLES}}', themeVars);
  }

  /**
   * Replace content sections
   * @param {string} html - HTML template
   * @param {Object} lesson - Lesson object
   * @param {Object} options - Export options
   * @returns {string} Modified HTML
   */
  replaceContent(html, lesson, options) {
    let replacements = {};

    // Translation tab
    if (options.includeTranslation && lesson.content?.translation?.text) {
      replacements['{{TRANSLATION_TAB}}'] = '<button class="tab-btn" data-tab="translation">Translation</button>';
      replacements['{{TRANSLATION_CONTENT}}'] = `
        <div id="translation-tab" class="tab-content">
          <div style="padding: 16px; line-height: 1.8; font-size: 15px;">
            ${this.escapeHtml(lesson.content.translation.text).replace(/\n/g, '<br>')}
          </div>
        </div>
      `;
    } else {
      replacements['{{TRANSLATION_TAB}}'] = '';
      replacements['{{TRANSLATION_CONTENT}}'] = '';
    }

    return this.replaceAll(html, replacements);
  }

  /**
   * Replace lesson data JSON
   * @param {string} html - HTML template
   * @param {Object} lesson - Lesson object
   * @param {Object} options - Export options
   * @returns {string} Modified HTML
   */
  replaceLessonData(html, lesson, options) {
    // Create a simplified lesson object for the standalone player
    const exportedLesson = {
      id: lesson.id,
      createdAt: lesson.createdAt,
      metadata: lesson.metadata,
      content: {
        transcript: lesson.content?.transcript || {},
        translation: options.includeTranslation ? lesson.content?.translation : null,
        vocabulary: options.includeVocabulary ? lesson.content?.vocabulary : null,
        questions: options.includeQuestions ? lesson.content?.questions : null
      }
    };

    // Minify JSON (no pretty printing for smaller file size)
    const lessonDataJson = JSON.stringify(exportedLesson);

    return html.replace('{{LESSON_DATA_JSON}}', lessonDataJson);
  }

  /**
   * Replace player script
   * @param {string} html - HTML template
   * @returns {string} Modified HTML
   */
  replacePlayerScript(html) {
    return html.replace('{{PLAYER_SCRIPT}}', this.playerScript);
  }

  /**
   * Generate filename for export
   * @param {Object} lesson - Lesson object
   * @returns {string} Filename
   */
  generateFilename(lesson) {
    const title = lesson.metadata?.title || 'lesson';
    const sanitized = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);

    const timestamp = new Date().toISOString().split('T')[0];

    return `tanaghum-${sanitized}-${timestamp}.html`;
  }

  /**
   * Format file size
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size
   */
  formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /**
   * Download exported file
   * @param {Blob} blob - File blob
   * @param {string} filename - Filename
   */
  download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    log.log(`Downloaded: ${filename}`);
  }

  /**
   * Export and download lesson
   * @param {Object} lesson - Lesson object
   * @param {Object} options - Export options
   */
  async exportAndDownload(lesson, options = {}) {
    try {
      const result = await this.exportLesson(lesson, options);
      this.download(result.blob, result.filename);

      return {
        success: true,
        filename: result.filename,
        size: result.sizeFormatted
      };

    } catch (error) {
      log.error('Export and download failed:', error);
      throw error;
    }
  }

  /**
   * Helper: Escape HTML
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Helper: Replace all occurrences
   * @param {string} str - String to modify
   * @param {Object} replacements - Map of replacements
   * @returns {string} Modified string
   */
  replaceAll(str, replacements) {
    let result = str;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.split(key).join(value);
    }
    return result;
  }

  /**
   * Preview export (returns HTML string instead of downloading)
   * @param {Object} lesson - Lesson object
   * @param {Object} options - Export options
   * @returns {Promise<string>} HTML content
   */
  async preview(lesson, options = {}) {
    await this.initialize();
    return this.generateHTML(lesson, options);
  }

  /**
   * Get estimated export size
   * @param {Object} lesson - Lesson object
   * @param {Object} options - Export options
   * @returns {Object} Size estimates
   */
  getEstimatedSize(lesson, options = {}) {
    const baseSize = 200; // KB for HTML + CSS + JS

    let audioSize = 0;
    if (options.embedAudio && lesson.audio?.url) {
      // Estimate ~1MB per minute of audio
      const duration = lesson.metadata?.duration || 0;
      audioSize = (duration / 60) * 1000; // KB
    }

    const vocabularySize = (lesson.content?.vocabulary?.items?.length || 0) * 0.5; // ~0.5KB per item
    const transcriptSize = (lesson.content?.transcript?.text?.length || 0) / 1024; // Text size in KB

    const totalKB = baseSize + audioSize + vocabularySize + transcriptSize;

    return {
      base: baseSize,
      audio: audioSize,
      vocabulary: vocabularySize,
      transcript: transcriptSize,
      total: totalKB,
      totalFormatted: this.formatFileSize(totalKB * 1024),
      warning: audioSize > 10000 ? 'Audio file is very large (>10MB)' : null
    };
  }
}

// Singleton instance
const lessonExporter = new LessonExporter();

export { lessonExporter, LessonExporter, DEFAULT_OPTIONS };
