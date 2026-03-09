/**
 * Export Dialog UI Component
 * Allows users to configure and export lessons as standalone HTML
 */

import { createLogger } from '../core/utils.js';
import { Config } from '../core/config.js';
import { lessonExporter } from '../export/lesson-exporter.js';

const log = createLogger('ExportDialog');

/**
 * Export Dialog class
 */
class ExportDialog {
  constructor() {
    this.isOpen = false;
    this.currentLesson = null;
    this.options = {
      embedAudio: false,
      embedVideo: false,
      includeTranslation: true,
      includeVocabulary: true,
      includeQuestions: true,
      theme: 'light'
    };
  }

  /**
   * Show the export dialog
   * @param {Object} lesson - Lesson to export
   */
  show(lesson) {
    if (!lesson) {
      throw new Error('No lesson provided');
    }

    this.currentLesson = lesson;
    this._previousFocus = document.activeElement;
    this.createDialog();
    this.updateEstimatedSize();
    this.isOpen = true;

    // Focus the dialog for accessibility
    const dialog = document.getElementById('export-dialog');
    const firstFocusable = dialog?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (firstFocusable) firstFocusable.focus();
  }

  /**
   * Create and inject dialog HTML
   */
  createDialog() {
    // Remove existing dialog if any
    const existing = document.getElementById('export-dialog');
    if (existing) {
      existing.remove();
    }

    const dialog = document.createElement('div');
    dialog.id = 'export-dialog';
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-dialog export-dialog">
        <div class="modal-header">
          <h2 class="modal-title">Export Lesson as HTML</h2>
          <button class="modal-close" id="export-dialog-close">&times;</button>
        </div>

        <div class="modal-body">
          <p class="export-description">
            Export this lesson as a self-contained HTML file that works completely offline.
            Teachers can share this file with students who can open it in any web browser.
          </p>

          ${this._isYouTubeLesson() ? `
          <div class="export-options">
            <h3 class="section-subtitle">Download Media</h3>
            <div class="option-group" style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn btn-secondary" id="download-audio-btn" style="flex: 1; min-width: 120px;">
                <span>&#127925;</span> Download Audio (m4a)
              </button>
              <button class="btn btn-secondary" id="download-video-btn" style="flex: 1; min-width: 120px;">
                <span>&#127916;</span> Download Video (mp4)
              </button>
            </div>
            <div id="download-status" class="export-warning hidden" style="margin-top: 8px;">
              <span class="warning-text"></span>
            </div>
          </div>
          ` : ''}

          <div class="export-options">
            <h3 class="section-subtitle">Export Options</h3>

            ${this._isYouTubeLesson() ? `
            <div class="option-group">
              <label class="select-label">
                <span class="select-title">Media Embed</span>
                <select id="media-embed-select" class="form-select">
                  <option value="youtube" selected>YouTube Embed (requires internet)</option>
                  <option value="audio">Embed Audio (offline, smaller)</option>
                  <option value="video">Embed Video (offline, larger)</option>
                  <option value="none">No media</option>
                </select>
              </label>
            </div>
            ` : `
            <div class="option-group">
              <label class="checkbox-label">
                <input type="checkbox" id="embed-audio-check" ${this.options.embedAudio ? 'checked' : ''}>
                <span class="checkbox-text">
                  <span class="checkbox-title">Embed Audio (Base64)</span>
                  <span class="checkbox-desc">Larger file size but works completely offline</span>
                </span>
              </label>
            </div>
            `}

            <div class="option-group">
              <label class="checkbox-label">
                <input type="checkbox" id="include-translation-check" ${this.options.includeTranslation ? 'checked' : ''}>
                <span class="checkbox-text">
                  <span class="checkbox-title">Include Translation</span>
                  <span class="checkbox-desc">Show English translation tab</span>
                </span>
              </label>
            </div>

            <div class="option-group">
              <label class="checkbox-label">
                <input type="checkbox" id="include-vocabulary-check" ${this.options.includeVocabulary ? 'checked' : ''}>
                <span class="checkbox-text">
                  <span class="checkbox-title">Include Vocabulary</span>
                  <span class="checkbox-desc">Show vocabulary list</span>
                </span>
              </label>
            </div>

            <div class="option-group">
              <label class="checkbox-label">
                <input type="checkbox" id="include-questions-check" ${this.options.includeQuestions ? 'checked' : ''}>
                <span class="checkbox-text">
                  <span class="checkbox-title">Include Questions</span>
                  <span class="checkbox-desc">Show comprehension questions</span>
                </span>
              </label>
            </div>

            <div class="option-group">
              <label class="select-label">
                <span class="select-title">Theme</span>
                <select id="theme-select" class="form-select">
                  <option value="light" ${this.options.theme === 'light' ? 'selected' : ''}>Light</option>
                  <option value="dark" ${this.options.theme === 'dark' ? 'selected' : ''}>Dark</option>
                </select>
              </label>
            </div>
          </div>

          <div class="export-info">
            <div class="info-card">
              <div class="info-icon">&#128230;</div>
              <div class="info-content">
                <div class="info-title">Estimated Size</div>
                <div class="info-value" id="estimated-size">Calculating...</div>
              </div>
            </div>

            <div class="info-card">
              <div class="info-icon">&#128193;</div>
              <div class="info-content">
                <div class="info-title">Format</div>
                <div class="info-value">Single HTML File</div>
              </div>
            </div>

            <div class="info-card">
              <div class="info-icon">&#127760;</div>
              <div class="info-content">
                <div class="info-title">Compatibility</div>
                <div class="info-value">All Modern Browsers</div>
              </div>
            </div>
          </div>

          <div id="export-warning" class="export-warning hidden">
            <span class="warning-icon">&#9888;</span>
            <span class="warning-text"></span>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" id="export-preview-btn">Preview</button>
          <button class="btn btn-primary" id="export-download-btn">
            <span>&#128229;</span> Download HTML
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);
    this.attachEventListeners();
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    const dialog = document.getElementById('export-dialog');

    // Close button
    const closeBtn = document.getElementById('export-dialog-close');
    closeBtn.addEventListener('click', () => this.close());

    // Click outside to close
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        this.close();
      }
    });

    // Option checkboxes
    const embedAudioCheck = document.getElementById('embed-audio-check');
    const mediaEmbedSelect = document.getElementById('media-embed-select');
    const includeTranslationCheck = document.getElementById('include-translation-check');
    const includeVocabularyCheck = document.getElementById('include-vocabulary-check');
    const includeQuestionsCheck = document.getElementById('include-questions-check');
    const themeSelect = document.getElementById('theme-select');

    if (embedAudioCheck) {
      embedAudioCheck.addEventListener('change', () => {
        this.options.embedAudio = embedAudioCheck.checked;
        this.updateEstimatedSize();
      });
    }

    if (mediaEmbedSelect) {
      mediaEmbedSelect.addEventListener('change', () => {
        const val = mediaEmbedSelect.value;
        this.options.embedAudio = val === 'audio';
        this.options.embedVideo = val === 'video';
        this.options.mediaEmbed = val;
        this.updateEstimatedSize();
      });
    }

    includeTranslationCheck.addEventListener('change', () => {
      this.options.includeTranslation = includeTranslationCheck.checked;
      this.updateEstimatedSize();
    });

    includeVocabularyCheck.addEventListener('change', () => {
      this.options.includeVocabulary = includeVocabularyCheck.checked;
      this.updateEstimatedSize();
    });

    includeQuestionsCheck.addEventListener('change', () => {
      this.options.includeQuestions = includeQuestionsCheck.checked;
    });

    themeSelect.addEventListener('change', () => {
      this.options.theme = themeSelect.value;
    });

    // Download media buttons
    const downloadAudioBtn = document.getElementById('download-audio-btn');
    const downloadVideoBtn = document.getElementById('download-video-btn');

    if (downloadAudioBtn) {
      downloadAudioBtn.addEventListener('click', () => this._downloadMedia('audio'));
    }
    if (downloadVideoBtn) {
      downloadVideoBtn.addEventListener('click', () => this._downloadMedia('video'));
    }

    // Action buttons
    const previewBtn = document.getElementById('export-preview-btn');
    const downloadBtn = document.getElementById('export-download-btn');

    previewBtn.addEventListener('click', () => this.preview());
    downloadBtn.addEventListener('click', () => this.download());

    // ESC key to close
    this.escapeHandler = (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    };
    document.addEventListener('keydown', this.escapeHandler);
  }

  /**
   * Update estimated file size
   */
  updateEstimatedSize() {
    const sizeEstimate = lessonExporter.getEstimatedSize(this.currentLesson, this.options);
    const sizeEl = document.getElementById('estimated-size');
    const warningEl = document.getElementById('export-warning');
    const warningText = warningEl.querySelector('.warning-text');

    if (sizeEl) {
      sizeEl.textContent = sizeEstimate.totalFormatted;
    }

    // Show warning if file is very large
    if (sizeEstimate.warning) {
      warningText.textContent = sizeEstimate.warning;
      warningEl.classList.remove('hidden');
    } else {
      warningEl.classList.add('hidden');
    }

    // Update breakdown tooltip or details
    const breakdown = `
      Base HTML/CSS/JS: ${lessonExporter.formatFileSize(sizeEstimate.base * 1024)}
      Transcript: ${lessonExporter.formatFileSize(sizeEstimate.transcript * 1024)}
      Vocabulary: ${lessonExporter.formatFileSize(sizeEstimate.vocabulary * 1024)}
      ${sizeEstimate.audio ? `Audio: ${lessonExporter.formatFileSize(sizeEstimate.audio * 1024)}` : ''}
      ${sizeEstimate.video ? `Video: ${lessonExporter.formatFileSize(sizeEstimate.video * 1024)}` : ''}
    `;

    if (sizeEl) {
      sizeEl.title = breakdown.trim();
    }
  }

  /**
   * Preview the exported HTML
   */
  async preview() {
    const previewBtn = document.getElementById('export-preview-btn');
    const originalText = previewBtn.innerHTML;

    // Open window synchronously to avoid popup blocker (must be in user gesture callstack)
    const previewWindow = window.open('about:blank', '_blank');
    if (!previewWindow) {
      this.showError('Preview blocked by popup blocker. Please allow popups for this site.');
      return;
    }

    try {
      previewBtn.disabled = true;
      previewBtn.innerHTML = '<span class="spinner"></span> Generating...';

      const html = await lessonExporter.preview(this.currentLesson, this.options);

      previewWindow.document.write(html);
      previewWindow.document.close();

      log.log('Preview opened in new window');

    } catch (error) {
      log.error('Preview failed:', error);
      previewWindow.close();
      this.showError('Preview failed: ' + error.message);
    } finally {
      previewBtn.disabled = false;
      previewBtn.innerHTML = originalText;
    }
  }

  /**
   * Download the exported HTML
   */
  async download() {
    const downloadBtn = document.getElementById('export-download-btn');
    const originalText = downloadBtn.innerHTML;

    try {
      downloadBtn.disabled = true;
      downloadBtn.innerHTML = '<span class="spinner"></span> Exporting...';

      const result = await lessonExporter.exportAndDownload(
        this.currentLesson,
        this.options
      );

      log.log('Export completed:', result);
      this.showSuccess(`Downloaded: ${result.filename} (${result.size})`);

    } catch (error) {
      log.error('Export failed:', error);
      this.showError('Export failed: ' + error.message);
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = originalText;
    }
  }

  /**
   * Show success message
   */
  showSuccess(message) {
    this.showToast('success', 'Export Successful', message);
  }

  /**
   * Show error message
   */
  showError(message) {
    this.showToast('error', 'Export Failed', message);
  }

  /**
   * Show toast notification
   */
  showToast(type, title, message) {
    const event = new CustomEvent('show-toast', {
      detail: { type, title, message }
    });
    document.dispatchEvent(event);
  }

  /**
   * Check if current lesson is from YouTube
   */
  _isYouTubeLesson() {
    return this.currentLesson?.audio?.type === 'youtube' && this.currentLesson?.audio?.videoId;
  }

  /**
   * Download media (audio or video) directly from YouTube
   */
  async _downloadMedia(type) {
    const videoId = this.currentLesson?.audio?.videoId;
    if (!videoId) return;

    const btn = document.getElementById(type === 'audio' ? 'download-audio-btn' : 'download-video-btn');
    const statusEl = document.getElementById('download-status');
    const statusText = statusEl?.querySelector('.warning-text');
    const originalText = btn.innerHTML;

    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Fetching...';
      statusEl?.classList.remove('hidden');
      statusText.textContent = `Getting ${type} download link...`;

      // Get download links from worker
      const res = await fetch(`${Config.WORKER_URL}${Config.API.YOUTUBE_DOWNLOAD}?v=${videoId}`);
      const data = await res.json();

      if (!data.available || !data.downloads?.[type]) {
        throw new Error(`No ${type} available for this video`);
      }

      const dl = data.downloads[type];
      statusText.textContent = `Downloading ${type}...`;

      // Stream through the yt-dlp proxy (needed for IP-locked URLs)
      const proxyRes = await fetch(dl.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dl.proxyBody)
      });

      if (!proxyRes.ok) throw new Error(`Download failed: HTTP ${proxyRes.status}`);

      const blob = await proxyRes.blob();
      const ext = dl.ext || (type === 'video' ? 'mp4' : 'm4a');
      const title = dl.title || videoId;
      const safeName = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').substring(0, 80);
      const filename = `${safeName}.${ext}`;

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      statusText.textContent = `Downloaded: ${filename} (${lessonExporter.formatFileSize(blob.size)})`;

    } catch (error) {
      log.error(`${type} download failed:`, error);
      statusText.textContent = `Download failed: ${error.message}`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  /**
   * Close the dialog
   */
  close() {
    const dialog = document.getElementById('export-dialog');
    if (dialog) {
      dialog.remove();
    }

    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
    }

    this.isOpen = false;
    this.currentLesson = null;

    // Restore focus to the element that opened the dialog
    if (this._previousFocus && typeof this._previousFocus.focus === 'function') {
      this._previousFocus.focus();
      this._previousFocus = null;
    }
  }
}

// Singleton instance
const exportDialog = new ExportDialog();

export { exportDialog, ExportDialog };
