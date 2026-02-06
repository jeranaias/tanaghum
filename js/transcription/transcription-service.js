/**
 * Tanaghum Transcription Service
 * Orchestrates transcription from multiple sources with caching and progress tracking
 */

import { Config } from '../core/config.js';
import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { createLogger } from '../core/utils.js';
import { whisperTranscriber } from './whisper-transcriber.js';
import { audioExtractor } from './audio-extractor.js';
import { youtubeFetcher } from '../content/youtube-fetcher.js';

const log = createLogger('TranscriptionService');

/**
 * IndexedDB cache for transcriptions
 */
class TranscriptionCache {
  constructor() {
    this.dbName = 'TanaghumTranscriptions';
    this.storeName = 'transcripts';
    this.db = null;
  }

  /**
   * Initialize IndexedDB
   */
  async init() {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('sourceId', 'sourceId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  /**
   * Get cached transcription
   * @param {string} sourceId - Source identifier (videoId or file hash)
   * @returns {Promise<Object|null>} Cached transcription or null
   */
  async get(sourceId) {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('sourceId');
      const request = index.get(sourceId);

      request.onsuccess = () => {
        const result = request.result;

        // Check if cache is still valid (30 days)
        if (result && Date.now() - result.timestamp < 30 * 24 * 60 * 60 * 1000) {
          log.log('Cache hit for', sourceId);
          resolve(result.data);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save transcription to cache
   * Removes existing entries for same sourceId before saving to prevent duplicates
   * @param {string} sourceId - Source identifier
   * @param {Object} data - Transcription data
   */
  async save(sourceId, data) {
    await this.init();

    // First, delete any existing entries for this sourceId to prevent duplicates
    await this.invalidate(sourceId);

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const record = {
        id: `transcript_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sourceId,
        data,
        timestamp: Date.now()
      };

      const request = store.add(record);
      request.onsuccess = () => {
        log.log('Saved to cache:', sourceId);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Invalidate cache entry for a specific sourceId
   * @param {string} sourceId - Source identifier to invalidate
   */
  async invalidate(sourceId) {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('sourceId');
      const request = index.openCursor(IDBKeyRange.only(sourceId));

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear old cache entries
   */
  async cleanup() {
    await this.init();

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('timestamp');
      const request = index.openCursor(IDBKeyRange.upperBound(cutoff));

      let deletedCount = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const deleteRequest = store.delete(cursor.primaryKey);
          deleteRequest.onsuccess = () => {
            deletedCount++;
          };
          cursor.continue();
        } else {
          log.log(`Cache cleanup: removed ${deletedCount} expired entries`);
          resolve();
        }
      };

      request.onerror = () => reject(request.error);

      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Clear all cache entries
   */
  async clearAll() {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => {
        log.log('All cache entries cleared');
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

/**
 * Transcription Service class
 */
class TranscriptionService {
  constructor() {
    this.cache = new TranscriptionCache();
    this.isTranscribing = false;
  }

  /**
   * Get transcription from any source
   * Tries: 1) Cache, 2) YouTube captions, 3) Whisper transcription
   * @param {Object} source - Source information
   * @param {Object} options - Transcription options
   * @returns {Promise<Object>} Transcription result
   */
  async getTranscription(source, options = {}) {
    const {
      forceTranscribe = false,
      onProgress = () => {},
      language = 'ar'
    } = options;

    log.log('Getting transcription for source:', source.type);

    if (this.isTranscribing) {
      throw new Error('Transcription already in progress');
    }

    this.isTranscribing = true;

    try {
      // Generate source ID for caching
      const sourceId = this.generateSourceId(source);

      // Step 1: Check cache (unless forced)
      if (!forceTranscribe) {
        onProgress({ stage: 'cache', percent: 0, message: 'Checking cache...' });

        const cached = await this.cache.get(sourceId);
        if (cached) {
          log.log('Using cached transcription');
          onProgress({ stage: 'complete', percent: 100, message: 'Loaded from cache' });

          // Update state
          StateManager.set('transcript', cached);
          EventBus.emit(Events.TRANSCRIPTION_COMPLETE, {
            source: 'cache',
            transcript: cached.text,
            segments: cached.segments
          });

          this.isTranscribing = false;
          return cached;
        }
      }

      // Step 2: Try YouTube captions (if applicable)
      if (source.type === 'youtube') {
        onProgress({ stage: 'captions', percent: 5, message: 'Checking for YouTube captions...' });

        try {
          const captions = await youtubeFetcher.getCaptions(source.videoId);

          if (captions.available) {
            log.log('Using YouTube captions');

            const transcription = {
              text: captions.fullText,
              segments: captions.segments,
              language: captions.language,
              confidence: captions.isAutoGenerated ? 0.7 : 0.95,
              source: 'youtube_captions',
              duration: captions.duration
            };

            // Cache the result
            await this.cache.save(sourceId, transcription);

            onProgress({ stage: 'complete', percent: 100, message: 'Captions loaded' });

            // Update state
            StateManager.set('transcript', transcription);
            EventBus.emit(Events.TRANSCRIPTION_COMPLETE, {
              source: 'youtube_captions',
              transcript: transcription.text,
              segments: transcription.segments
            });

            this.isTranscribing = false;
            return transcription;
          }
        } catch (error) {
          log.warn('YouTube captions not available:', error.message);
          // Continue to Whisper transcription
        }
      }

      // Step 3: Use Whisper transcription
      log.log('Starting Whisper transcription');

      onProgress({ stage: 'prepare', percent: 10, message: 'Preparing audio for transcription...' });

      EventBus.emit(Events.TRANSCRIPTION_START, {
        source: source.type,
        timestamp: Date.now()
      });

      // Prepare audio for Whisper
      const audioData = await audioExtractor.prepareForWhisper(source, {
        onProgress: (progress) => {
          const percent = 10 + Math.round(progress.overall * 0.2); // 10-30%
          onProgress({
            stage: 'prepare',
            percent,
            message: progress.message || 'Preparing audio...'
          });
        }
      });

      onProgress({ stage: 'model', percent: 30, message: 'Loading Whisper model...' });

      // Ensure model is loaded
      if (!whisperTranscriber.isModelReady()) {
        await whisperTranscriber.loadModel();
      }

      onProgress({ stage: 'transcribe', percent: 40, message: 'Transcribing audio...' });

      // Transcribe with progress
      const transcription = await whisperTranscriber.transcribeWithProgress(
        audioData.audioData,
        audioData.sampleRate,
        (progress, currentText) => {
          const percent = 40 + Math.round(progress * 0.55); // 40-95%
          onProgress({
            stage: 'transcribe',
            percent,
            message: 'Transcribing...',
            currentText
          });

          EventBus.emit(Events.TRANSCRIPTION_PROGRESS, {
            progress,
            currentText
          });
        }
      );

      transcription.source = 'whisper';
      transcription.language = language;

      onProgress({ stage: 'save', percent: 96, message: 'Saving transcription...' });

      // Cache the result
      await this.cache.save(sourceId, transcription);

      onProgress({ stage: 'complete', percent: 100, message: 'Transcription complete' });

      // Update state
      StateManager.set('transcript', transcription);

      EventBus.emit(Events.TRANSCRIPTION_COMPLETE, {
        source: 'whisper',
        transcript: transcription.text,
        segments: transcription.segments,
        duration: transcription.audioDuration
      });

      log.log('Transcription complete:', {
        words: transcription.wordCount,
        duration: transcription.audioDuration,
        segments: transcription.segments.length
      });

      // Release audio data from memory
      this.releaseAudioMemory(audioData);

      this.isTranscribing = false;
      return transcription;

    } catch (error) {
      log.error('Transcription failed:', error);
      this.isTranscribing = false;

      EventBus.emit(Events.TRANSCRIPTION_ERROR, {
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Generate a unique source ID for caching
   * @param {Object} source - Source information
   * @returns {string} Source ID
   */
  generateSourceId(source) {
    if (source.type === 'youtube') {
      return `yt_${source.videoId}`;
    } else if (source.type === 'upload' && source.file) {
      // Generate hash from file name and size
      return `file_${source.file.name}_${source.file.size}`;
    } else {
      return `unknown_${Date.now()}`;
    }
  }

  /**
   * Check if transcription is available for a source
   * @param {Object} source - Source information
   * @returns {Promise<boolean>} True if available
   */
  async hasTranscription(source) {
    // Check cache
    const sourceId = this.generateSourceId(source);
    const cached = await this.cache.get(sourceId);
    if (cached) return true;

    // Check if YouTube captions available
    if (source.type === 'youtube') {
      try {
        const metadata = await youtubeFetcher.getMetadata(source.videoId);
        return metadata.captions?.available || false;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Get estimated transcription time
   * @param {number} audioDuration - Audio duration in seconds
   * @returns {number} Estimated time in seconds
   */
  estimateTranscriptionTime(audioDuration) {
    // Whisper typically processes at 5-10x real-time on modern hardware
    // Add model load time for first use
    const modelLoadTime = whisperTranscriber.isModelReady() ? 0 : 10;
    const processingTime = audioDuration / 7; // ~7x real-time
    return Math.ceil(modelLoadTime + processingTime);
  }

  /**
   * Release audio buffer memory
   * @param {Object} audioData - Audio data object to release
   */
  releaseAudioMemory(audioData) {
    if (audioData && audioData.audioData) {
      // Null out the reference to allow garbage collection
      audioData.audioData = null;
      log.log('Audio buffer memory released');
    }
  }

  /**
   * Clear expired transcription cache entries
   */
  async clearCache() {
    await this.cache.cleanup();
    log.log('Expired cache entries cleared');
  }

  /**
   * Clear all transcription cache entries
   */
  async clearAllCache() {
    await this.cache.clearAll();
    log.log('All cache cleared');
  }

  /**
   * Invalidate cache for a specific source
   * @param {Object} source - Source information
   */
  async invalidateCache(source) {
    const sourceId = this.generateSourceId(source);
    await this.cache.invalidate(sourceId);
    log.log('Cache invalidated for:', sourceId);
  }

  /**
   * Cancel ongoing transcription
   */
  cancel() {
    if (this.isTranscribing) {
      log.log('Cancelling transcription');
      this.isTranscribing = false;
      // Note: Actual cancellation of Whisper is not supported by Transformers.js
      // But we can at least reset the flag
    }
  }
}

// Singleton instance
const transcriptionService = new TranscriptionService();

export { transcriptionService, TranscriptionService, TranscriptionCache };
