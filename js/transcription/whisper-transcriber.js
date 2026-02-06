/**
 * Tanaghum Whisper Transcriber
 * In-browser audio transcription using Transformers.js + Whisper
 */

import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { createLogger } from '../core/utils.js';

const log = createLogger('Whisper');

// Whisper model configuration
const WHISPER_CONFIG = {
  model: 'Xenova/whisper-small',
  task: 'transcribe',
  language: 'arabic',
  chunkLengthS: 30,
  strideS: 5,
  returnTimestamps: true
};

/**
 * Whisper Transcriber class
 */
class WhisperTranscriber {
  constructor() {
    this.pipeline = null;
    this.isLoading = false;
    this.isReady = false;
    this.loadProgress = 0;
  }

  /**
   * Load the Whisper model
   * @returns {Promise<void>}
   */
  async loadModel() {
    if (this.isReady) {
      log.log('Model already loaded');
      return;
    }

    if (this.isLoading) {
      log.log('Model is already loading');
      // Wait for loading to complete with timeout
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          clearInterval(checkReady);
          reject(new Error('Model loading timeout - took longer than 2 minutes'));
        }, 120000);

        const checkReady = setInterval(() => {
          if (this.isReady) {
            clearInterval(checkReady);
            clearTimeout(timeout);
            resolve();
          } else if (!this.isLoading) {
            // Loading failed
            clearInterval(checkReady);
            clearTimeout(timeout);
            reject(new Error('Model loading failed'));
          }
        }, 100);
      });
    }

    this.isLoading = true;
    log.log('Loading Whisper model...');

    EventBus.emit(Events.MODEL_LOADING, {
      model: 'whisper',
      progress: 0
    });

    try {
      // Dynamically import Transformers.js
      const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1');

      // Create the transcription pipeline with progress callback
      this.pipeline = await pipeline('automatic-speech-recognition', WHISPER_CONFIG.model, {
        progress_callback: (progress) => {
          if (progress.status === 'progress' && typeof progress.progress === 'number') {
            this.loadProgress = Math.round(progress.progress) || 0;
            EventBus.emit(Events.MODEL_LOADING, {
              model: 'whisper',
              progress: this.loadProgress,
              file: progress.file
            });
          } else if (progress.status === 'done') {
            this.loadProgress = 100;
          }
        }
      });

      this.isReady = true;
      this.isLoading = false;

      log.log('Whisper model loaded successfully');
      EventBus.emit(Events.MODEL_READY, { model: 'whisper' });

    } catch (error) {
      this.isLoading = false;
      this.isReady = false;
      this.pipeline = null;
      this.loadProgress = 0;
      log.error('Failed to load Whisper model:', error);
      EventBus.emit(Events.MODEL_ERROR, {
        model: 'whisper',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if model is ready
   * @returns {boolean}
   */
  isModelReady() {
    return this.isReady;
  }

  /**
   * Transcribe audio data
   * @param {Float32Array|AudioBuffer|string} audio - Audio data, buffer, or URL
   * @param {Object} options - Transcription options
   * @returns {Promise<Object>} Transcription result
   */
  async transcribe(audio, options = {}) {
    if (!this.isReady) {
      log.log('Model not ready, loading...');
      await this.loadModel();
    }

    const {
      language = WHISPER_CONFIG.language,
      task = WHISPER_CONFIG.task,
      chunkLengthS = WHISPER_CONFIG.chunkLengthS,
      strideS = WHISPER_CONFIG.strideS,
      returnTimestamps = WHISPER_CONFIG.returnTimestamps
    } = options;

    log.log('Starting transcription...');
    const startTime = performance.now();

    EventBus.emit(Events.TRANSCRIPTION_START, {
      language,
      timestamp: Date.now()
    });

    try {
      // Prepare audio input
      let audioInput = audio;

      // If it's an AudioBuffer, extract Float32Array
      if (audio instanceof AudioBuffer) {
        audioInput = this.extractAudioData(audio);
      }

      // Run transcription
      const result = await this.pipeline(audioInput, {
        language,
        task,
        chunk_length_s: chunkLengthS,
        stride_length_s: strideS,
        return_timestamps: returnTimestamps
      });

      const duration = (performance.now() - startTime) / 1000;
      log.log(`Transcription completed in ${duration.toFixed(2)}s`);

      // Process result
      const transcription = this.processResult(result);

      // Update state
      StateManager.set('transcript', {
        text: transcription.text,
        segments: transcription.segments,
        language,
        confidence: transcription.avgConfidence,
        duration: transcription.audioDuration
      });

      EventBus.emit(Events.TRANSCRIPTION_COMPLETE, {
        source: 'whisper',
        transcript: transcription.text,
        segments: transcription.segments,
        processingTime: duration
      });

      return transcription;

    } catch (error) {
      log.error('Transcription failed:', error);
      EventBus.emit(Events.TRANSCRIPTION_ERROR, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Extract audio data from AudioBuffer
   * @param {AudioBuffer} buffer - Audio buffer
   * @returns {Float32Array} Mono audio data (new copy, safe to use after buffer release)
   */
  extractAudioData(buffer) {
    // Convert to mono if stereo
    if (buffer.numberOfChannels === 1) {
      // Return a copy to avoid issues if original buffer is released
      const channelData = buffer.getChannelData(0);
      return new Float32Array(channelData);
    }

    // Mix down to mono - handles stereo and multi-channel
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const mono = new Float32Array(length);

    // Get all channels first
    const channels = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(buffer.getChannelData(c));
    }

    // Mix down
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (let c = 0; c < numChannels; c++) {
        sum += channels[c][i];
      }
      mono[i] = sum / numChannels;
    }

    return mono;
  }

  /**
   * Process transcription result into segments
   * @param {Object} result - Raw Whisper result
   * @returns {Object} Processed transcription
   */
  processResult(result) {
    const text = result.text?.trim() || '';
    const chunks = result.chunks || [];

    // Convert chunks to segments with timestamps
    const segments = chunks.map((chunk, index) => ({
      id: index,
      start: chunk.timestamp?.[0] || 0,
      end: chunk.timestamp?.[1] || 0,
      text: chunk.text?.trim() || '',
      confidence: chunk.confidence || 0.8
    })).filter(seg => seg.text.length > 0);

    // Calculate average confidence
    const avgConfidence = segments.length > 0
      ? segments.reduce((sum, seg) => sum + seg.confidence, 0) / segments.length
      : 0.8;

    // Get total audio duration from last segment
    const audioDuration = segments.length > 0
      ? segments[segments.length - 1].end
      : 0;

    return {
      text,
      segments,
      avgConfidence,
      audioDuration,
      wordCount: text.split(/\s+/).filter(w => w.length > 0).length
    };
  }

  /**
   * Transcribe with progress updates
   * @param {Float32Array} audioData - Audio samples
   * @param {number} sampleRate - Sample rate
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Transcription result
   */
  async transcribeWithProgress(audioData, sampleRate, onProgress) {
    if (!this.isReady) {
      await this.loadModel();
    }

    const totalDuration = audioData.length / sampleRate;
    const chunkSize = WHISPER_CONFIG.chunkLengthS * sampleRate;
    const strideSize = WHISPER_CONFIG.strideS * sampleRate;

    const allSegments = [];
    let fullText = '';
    let processedSamples = 0;

    log.log(`Transcribing ${totalDuration.toFixed(1)}s of audio in chunks`);

    // Process in chunks for progress updates
    for (let start = 0; start < audioData.length; start += (chunkSize - strideSize)) {
      const end = Math.min(start + chunkSize, audioData.length);
      const chunk = audioData.slice(start, end);

      // Transcribe chunk
      const result = await this.pipeline(chunk, {
        language: WHISPER_CONFIG.language,
        task: WHISPER_CONFIG.task,
        return_timestamps: true
      });

      // Adjust timestamps for chunk offset
      const offsetSeconds = start / sampleRate;
      const processed = this.processResult(result);

      processed.segments.forEach(seg => {
        seg.start += offsetSeconds;
        seg.end += offsetSeconds;
        allSegments.push(seg);
      });

      fullText += (fullText ? ' ' : '') + processed.text;
      processedSamples = end;

      // Report progress
      const progress = Math.min(100, Math.round((processedSamples / audioData.length) * 100));
      onProgress?.(progress, processed.text);

      EventBus.emit(Events.TRANSCRIPTION_PROGRESS, {
        progress,
        currentText: processed.text
      });
    }

    // Merge overlapping segments
    const mergedSegments = this.mergeOverlappingSegments(allSegments);

    return {
      text: fullText.trim(),
      segments: mergedSegments,
      avgConfidence: 0.8,
      audioDuration: totalDuration,
      wordCount: fullText.split(/\s+/).filter(w => w.length > 0).length
    };
  }

  /**
   * Merge overlapping segments from chunked processing
   * @param {Array} segments - Array of segments
   * @returns {Array} Merged segments
   */
  mergeOverlappingSegments(segments) {
    if (segments.length === 0) return [];

    // Sort by start time
    segments.sort((a, b) => a.start - b.start);

    const merged = [segments[0]];

    for (let i = 1; i < segments.length; i++) {
      const current = segments[i];
      const last = merged[merged.length - 1];

      // If overlapping, merge
      if (current.start < last.end) {
        // Extend the end time if needed
        last.end = Math.max(last.end, current.end);
        // Skip duplicate text
        if (!last.text.includes(current.text)) {
          last.text += ' ' + current.text;
        }
      } else {
        merged.push(current);
      }
    }

    // Re-index
    return merged.map((seg, i) => ({ ...seg, id: i }));
  }

  /**
   * Generate VTT format from segments
   * @param {Array} segments - Transcription segments
   * @returns {string} WebVTT content
   */
  generateVTT(segments) {
    let vtt = 'WEBVTT\n\n';

    segments.forEach((seg, index) => {
      const startTime = this.formatVTTTime(seg.start);
      const endTime = this.formatVTTTime(seg.end);

      vtt += `${index + 1}\n`;
      vtt += `${startTime} --> ${endTime}\n`;
      vtt += `${seg.text}\n\n`;
    });

    return vtt;
  }

  /**
   * Format seconds to VTT timestamp
   * @param {number} seconds - Time in seconds
   * @returns {string} VTT formatted time
   */
  formatVTTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  /**
   * Cleanup resources
   */
  dispose() {
    if (this.pipeline) {
      this.pipeline = null;
      this.isReady = false;
    }
  }
}

// Singleton instance
const whisperTranscriber = new WhisperTranscriber();

export { whisperTranscriber, WhisperTranscriber };
