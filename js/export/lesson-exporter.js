/**
 * Tanaghum Lesson Exporter
 * Exports lessons as self-contained HTML files
 */

import { createLogger, formatTime } from '../core/utils.js';
import { Config } from '../core/config.js';

const log = createLogger('LessonExporter');

/**
 * Default export options
 */
const DEFAULT_OPTIONS = {
  embedAudio: false,           // Embed audio as base64 (increases file size)
  embedVideo: false,           // Embed video as base64 (large file size)
  mediaEmbed: 'youtube',       // 'youtube', 'audio', 'video', 'none'
  includeTranslation: true,    // Include translation tab
  includeVocabulary: true,     // Include vocabulary
  includeQuestions: true,      // Include questions
  theme: 'light',              // 'light' or 'dark'
  minifyPlayer: false,         // Minify player JS (future enhancement)
  maxAudioSize: 50 * 1024 * 1024,  // 50MB max for audio embedding
  maxVideoSize: 200 * 1024 * 1024  // 200MB max for video embedding
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

    // Handle title - can be object {ar, en} or string
    let titleText = 'Untitled Lesson';
    if (metadata.title) {
      if (typeof metadata.title === 'object') {
        // Prefer English title, fall back to Arabic, then any value
        titleText = metadata.title.en || metadata.title.ar || Object.values(metadata.title)[0] || 'Untitled Lesson';
      } else {
        titleText = metadata.title;
      }
    }

    // Handle ILR level - can be object {detected, target, confidence} or string
    let ilrText = 'N/A';
    if (metadata.ilr) {
      if (typeof metadata.ilr === 'object') {
        // Use target level if available, or detected level
        const level = metadata.ilr.target || metadata.ilr.detected || metadata.ilr.level;
        if (level !== null && level !== undefined) {
          ilrText = `ILR ${level}`;
        }
      } else {
        ilrText = String(metadata.ilr);
      }
    }

    const replacements = {
      '{{LESSON_ID}}': lesson.id || 'unknown',
      '{{LESSON_TITLE}}': this.escapeHtml(titleText),
      '{{CREATED_DATE}}': createdDate,
      '{{DURATION}}': metadata.durationFormatted || formatTime(metadata.duration || 0),
      '{{ILR_LEVEL}}': ilrText,
      '{{TOPIC}}': metadata.topic?.nameEn || metadata.topic?.code || 'General',
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
    let audio = lesson.audio || {};

    // Try to get audio URL from StateManager if not in lesson
    if (!audio.url && audio.type !== 'youtube') {
      try {
        const { StateManager } = await import('../core/state-manager.js');
        const stateAudio = StateManager.get('audio') || {};
        if (stateAudio.url) {
          audio = { ...audio, url: stateAudio.url };
          log.log('Got audio URL from StateManager');
        }
      } catch (e) {
        // StateManager not available
      }
    }

    let mediaElement = '';
    const mediaEmbed = options.mediaEmbed || (options.embedAudio ? 'audio' : (options.embedVideo ? 'video' : 'youtube'));

    if (audio.type === 'youtube' && audio.videoId) {
      // YouTube source — handle based on embed mode
      if (mediaEmbed === 'video') {
        // Embed video as base64 from yt-dlp
        try {
          log.log('Fetching video for embedding...');
          const mediaData = await this.fetchYouTubeMedia(audio.videoId, 'video', options.maxVideoSize);
          mediaElement = `
            <video id="media-player" controls width="100%" style="max-height: 500px; background: #000;">
              <source src="${mediaData.dataUrl}" type="${mediaData.mimeType}">
              Your browser does not support the video element.
            </video>
          `;
          log.log(`Video embedded as base64, size: ${this.formatFileSize(mediaData.size)}`);
        } catch (error) {
          log.error('Failed to embed video:', error);
          mediaElement = this.createYouTubeEmbed(audio.videoId);
        }

      } else if (mediaEmbed === 'audio') {
        // Embed audio as base64 from yt-dlp
        try {
          log.log('Fetching audio for embedding...');
          const mediaData = await this.fetchYouTubeMedia(audio.videoId, 'audio', options.maxAudioSize);
          mediaElement = `
            <audio id="media-player" controls style="width: 100%;">
              <source src="${mediaData.dataUrl}" type="${mediaData.mimeType}">
              Your browser does not support the audio element.
            </audio>
          `;
          log.log(`Audio embedded as base64, size: ${this.formatFileSize(mediaData.size)}`);
        } catch (error) {
          log.error('Failed to embed audio:', error);
          mediaElement = this.createYouTubeEmbed(audio.videoId);
        }

      } else if (mediaEmbed === 'none') {
        mediaElement = `
          <div style="padding: 40px; text-align: center; color: var(--text-tertiary);">
            <p>Media not included in this export</p>
          </div>
        `;

      } else {
        // Default: YouTube iframe embed
        mediaElement = this.createYouTubeEmbed(audio.videoId);
      }

    } else if (options.embedAudio && audio.url) {
      // Non-YouTube: embed audio as base64
      try {
        const audioData = await this.fetchAndEncodeAudio(audio.url, options.maxAudioSize);
        mediaElement = `
          <audio id="media-player" controls style="width: 100%;">
            <source src="${audioData.dataUrl}" type="${audioData.mimeType}">
            Your browser does not support the audio element.
          </audio>
        `;
        log.log(`Audio embedded as base64, size: ${this.formatFileSize(audioData.size)}`);
      } catch (error) {
        log.error('Failed to embed audio:', error);
        mediaElement = this.createExternalAudioElement(audio.url);
      }

    } else if (audio.url) {
      mediaElement = this.createExternalAudioElement(audio.url);

    } else {
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
   * Create YouTube iframe embed
   */
  createYouTubeEmbed(videoId) {
    return `
      <iframe
        id="media-player"
        width="100%"
        height="400"
        src="https://www.youtube.com/embed/${this.escapeHtml(videoId)}?enablejsapi=1"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen>
      </iframe>
      <p style="text-align: center; margin-top: 8px; font-size: 13px; color: var(--text-secondary);">
        Note: YouTube video requires internet connection
      </p>
    `;
  }

  /**
   * Fetch YouTube media (audio or video) via yt-dlp proxy and encode as base64
   * @param {string} videoId - YouTube video ID
   * @param {string} type - 'audio' or 'video'
   * @param {number} maxSize - Maximum size in bytes
   * @returns {Promise<Object>} Encoded media data
   */
  async fetchYouTubeMedia(videoId, type, maxSize) {
    // Get download links from worker
    const res = await fetch(`${Config.WORKER_URL}${Config.API.YOUTUBE_DOWNLOAD}?v=${videoId}`);
    const data = await res.json();

    if (!data.available || !data.downloads?.[type]) {
      throw new Error(`No ${type} available for this video`);
    }

    const dl = data.downloads[type];

    // Check estimated size
    if (dl.filesize && dl.filesize > maxSize) {
      throw new Error(`${type} too large: ${this.formatFileSize(dl.filesize)} (max: ${this.formatFileSize(maxSize)})`);
    }

    // Stream through yt-dlp proxy
    const proxyRes = await fetch(dl.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dl.proxyBody)
    });

    if (!proxyRes.ok) throw new Error(`Failed to fetch ${type}: HTTP ${proxyRes.status}`);

    const blob = await proxyRes.blob();

    if (blob.size > maxSize) {
      throw new Error(`${type} too large: ${this.formatFileSize(blob.size)} (max: ${this.formatFileSize(maxSize)})`);
    }

    const dataUrl = await this.blobToDataUrl(blob);

    return {
      dataUrl,
      mimeType: dl.mimeType || (type === 'video' ? 'video/mp4' : 'audio/mp4'),
      size: blob.size
    };
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
    let title = 'lesson';
    const metaTitle = lesson.metadata?.title;
    if (metaTitle) {
      if (typeof metaTitle === 'object') {
        // Prefer English for filename, fall back to Arabic
        title = metaTitle.en || metaTitle.ar || Object.values(metaTitle)[0] || 'lesson';
      } else {
        title = metaTitle;
      }
    }
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
    const duration = lesson.metadata?.duration || 0;
    const mediaEmbed = options.mediaEmbed || (options.embedAudio ? 'audio' : (options.embedVideo ? 'video' : 'youtube'));

    let mediaSize = 0;
    if (mediaEmbed === 'audio') {
      // ~1MB per minute of audio (base64 adds ~33%)
      mediaSize = (duration / 60) * 1300;
    } else if (mediaEmbed === 'video') {
      // ~5MB per minute of video (base64 adds ~33%)
      mediaSize = (duration / 60) * 6500;
    }

    const vocabularySize = (lesson.content?.vocabulary?.items?.length || 0) * 0.5;
    const transcriptSize = (lesson.content?.transcript?.text?.length || 0) / 1024;

    const totalKB = baseSize + mediaSize + vocabularySize + transcriptSize;

    let warning = null;
    if (mediaSize > 50000) warning = 'Embedded media will be very large (>50MB). Consider using YouTube embed instead.';
    else if (mediaSize > 10000) warning = 'Embedded media will be large (>10MB). Download may take a while.';

    return {
      base: baseSize,
      audio: mediaEmbed === 'audio' ? mediaSize : 0,
      video: mediaEmbed === 'video' ? mediaSize : 0,
      vocabulary: vocabularySize,
      transcript: transcriptSize,
      total: totalKB,
      totalFormatted: this.formatFileSize(totalKB * 1024),
      warning
    };
  }
}

// Singleton instance
const lessonExporter = new LessonExporter();

export { lessonExporter, LessonExporter, DEFAULT_OPTIONS };
