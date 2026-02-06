/**
 * Tanaghum File Uploader
 * Handles drag-and-drop and file input for audio uploads
 */

import { Config } from '../core/config.js';
import { EventBus, Events } from '../core/event-bus.js';
import { formatBytes, createLogger } from '../core/utils.js';
import { audioProcessor } from './audio-processor.js';

const log = createLogger('FileUploader');

/**
 * File Uploader class
 */
class FileUploader {
  /**
   * Create a file uploader
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.dropZone = null;
    this.fileInput = null;
    this.onFileSelected = options.onFileSelected || (() => {});
    this.onError = options.onError || ((err) => console.error(err));
    this.onProgress = options.onProgress || (() => {});

    this.acceptedTypes = options.acceptedTypes || [
      '.mp3', '.wav', '.m4a', '.ogg', '.webm', '.aac',
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/m4a'
    ];

    this.maxSize = (options.maxSizeMB || Config.AUDIO.maxFileSizeMB) * 1024 * 1024;
  }

  /**
   * Attach to DOM elements
   * @param {HTMLElement|string} dropZone - Drop zone element or selector
   * @param {HTMLElement|string} fileInput - File input element or selector
   */
  attach(dropZone, fileInput) {
    // Get elements
    this.dropZone = typeof dropZone === 'string'
      ? document.querySelector(dropZone)
      : dropZone;

    this.fileInput = typeof fileInput === 'string'
      ? document.querySelector(fileInput)
      : fileInput;

    if (!this.dropZone) {
      log.warn('Drop zone element not found');
    }

    if (!this.fileInput) {
      log.warn('File input element not found');
    }

    this.setupEventListeners();
    return this;
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    if (this.dropZone) {
      // Click to open file dialog
      this.dropZone.addEventListener('click', (e) => {
        if (e.target === this.dropZone || this.dropZone.contains(e.target)) {
          this.fileInput?.click();
        }
      });

      // Drag events
      this.dropZone.addEventListener('dragenter', this.handleDragEnter.bind(this));
      this.dropZone.addEventListener('dragover', this.handleDragOver.bind(this));
      this.dropZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
      this.dropZone.addEventListener('drop', this.handleDrop.bind(this));
    }

    if (this.fileInput) {
      this.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
    }

    // Prevent default drag behavior on document
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
  }

  /**
   * Handle drag enter
   */
  handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    this.dropZone.classList.add('drag-over');
  }

  /**
   * Handle drag over
   */
  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  /**
   * Handle drag leave
   */
  handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();

    // Only remove class if actually leaving the drop zone
    if (!this.dropZone.contains(e.relatedTarget)) {
      this.dropZone.classList.remove('drag-over');
    }
  }

  /**
   * Handle drop
   */
  async handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    this.dropZone.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await this.processFile(files[0]);
    }
  }

  /**
   * Handle file input selection
   */
  async handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
      await this.processFile(files[0]);
    }
  }

  /**
   * Process selected file
   * @param {File} file - Selected file
   */
  async processFile(file) {
    log.log('Processing file:', file.name);

    try {
      // Validate file type
      const isValidType = this.validateFileType(file);
      if (!isValidType) {
        throw new Error(`Invalid file type. Accepted formats: MP3, WAV, M4A, OGG, WebM, AAC`);
      }

      // Validate file size
      if (file.size > this.maxSize) {
        throw new Error(`File too large. Maximum size is ${formatBytes(this.maxSize)}`);
      }

      // Show processing state
      this.onProgress({ stage: 'loading', percent: 0 });

      // Load and process audio
      const audioData = await audioProcessor.loadFile(file);

      // Success callback
      this.onFileSelected({
        file,
        audioData,
        preview: {
          name: file.name,
          size: formatBytes(file.size),
          duration: audioData.duration,
          sampleRate: audioData.sampleRate,
          channels: audioData.channels
        }
      });

      this.onProgress({ stage: 'complete', percent: 100 });

    } catch (error) {
      log.error('File processing error:', error);
      this.onError(error);
    }
  }

  /**
   * Validate file type
   * @param {File} file - File to validate
   * @returns {boolean} Is valid
   */
  validateFileType(file) {
    // Check MIME type
    if (this.acceptedTypes.includes(file.type)) {
      return true;
    }

    // Check extension
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return this.acceptedTypes.includes(ext);
  }

  /**
   * Open file dialog programmatically
   */
  openFileDialog() {
    this.fileInput?.click();
  }

  /**
   * Reset the uploader
   */
  reset() {
    if (this.fileInput) {
      this.fileInput.value = '';
    }
    this.dropZone?.classList.remove('drag-over');
  }

  /**
   * Destroy the uploader
   */
  destroy() {
    this.reset();
    // Event listeners are automatically cleaned up when elements are removed
  }
}

/**
 * Create a new file uploader instance
 * @param {Object} options - Configuration options
 * @returns {FileUploader}
 */
export function createFileUploader(options) {
  return new FileUploader(options);
}

export { FileUploader };
