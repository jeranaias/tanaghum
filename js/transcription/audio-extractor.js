/**
 * Tanaghum Audio Extractor
 * Extracts and prepares audio for transcription from various sources
 */

import { Config } from '../core/config.js';
import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { createLogger } from '../core/utils.js';

const log = createLogger('AudioExtractor');

/**
 * Audio Extractor class
 */
class AudioExtractor {
  constructor() {
    this.audioContext = null;
    this.workerUrl = Config.WORKER_URL;
  }

  /**
   * Initialize Web Audio API context
   */
  initContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.audioContext;
  }

  /**
   * Extract audio from YouTube video via worker proxy
   * @param {string} videoId - YouTube video ID
   * @param {Object} options - Extraction options
   * @returns {Promise<AudioBuffer>} Audio buffer
   */
  async extractFromYouTube(videoId, options = {}) {
    const { onProgress } = options;

    log.log('Extracting audio from YouTube:', videoId);

    try {
      // Request audio via worker proxy
      onProgress?.({ stage: 'fetching', percent: 0, message: 'Requesting audio from YouTube...' });

      const response = await fetch(`${this.workerUrl}/api/youtube/audio?v=${videoId}`, {
        method: 'GET'
      });

      if (!response.ok) {
        // If endpoint returns 404 or 501, provide a helpful error
        if (response.status === 404 || response.status === 501) {
          throw new Error(
            'YouTube audio extraction not yet implemented on worker. ' +
            'The /api/youtube/audio endpoint needs to be added to support Whisper transcription. ' +
            'For now, please use videos with existing captions or upload audio files directly.'
          );
        }

        const error = await response.json().catch(() => ({ error: 'Failed to fetch audio' }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      // Get total size for progress tracking
      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      // Read response as array buffer with progress
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        chunks.push(value);
        received += value.length;

        if (total > 0) {
          const percent = Math.round((received / total) * 100);
          onProgress?.({
            stage: 'downloading',
            percent: Math.min(percent, 95),
            message: `Downloading audio... ${Math.round(received / 1024 / 1024)}MB`
          });
        }
      }

      // Concatenate chunks
      const audioData = new Uint8Array(received);
      let position = 0;
      for (const chunk of chunks) {
        audioData.set(chunk, position);
        position += chunk.length;
      }

      onProgress?.({ stage: 'decoding', percent: 96, message: 'Decoding audio...' });

      // Decode audio
      this.initContext();
      const audioBuffer = await this.audioContext.decodeAudioData(audioData.buffer);

      log.log(`Audio extracted: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz`);

      return audioBuffer;

    } catch (error) {
      log.error('Failed to extract audio from YouTube:', error);
      throw new Error(`Audio extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract audio from uploaded file
   * @param {File} file - Audio file
   * @param {Object} options - Extraction options
   * @returns {Promise<AudioBuffer>} Audio buffer
   */
  async extractFromFile(file, options = {}) {
    const { onProgress } = options;

    log.log('Extracting audio from file:', file.name);

    try {
      onProgress?.({ stage: 'reading', percent: 0, message: 'Reading audio file...' });

      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();

      onProgress?.({ stage: 'decoding', percent: 50, message: 'Decoding audio...' });

      // Decode audio - handle potential decoding errors gracefully
      this.initContext();
      let audioBuffer;
      try {
        audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      } catch (decodeError) {
        throw new Error(`Unsupported audio format or corrupted file: ${decodeError.message}`);
      }

      log.log(`Audio extracted: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz`);

      onProgress?.({ stage: 'complete', percent: 100, message: 'Audio ready' });

      return audioBuffer;

    } catch (error) {
      log.error('Failed to extract audio from file:', error);
      throw new Error(`File decoding failed: ${error.message}`);
    }
  }

  /**
   * Resample audio to target sample rate (required for Whisper: 16kHz)
   * @param {AudioBuffer} buffer - Input audio buffer
   * @param {number} targetSampleRate - Target sample rate (default: 16000)
   * @param {Object} options - Resampling options
   * @returns {Promise<Float32Array>} Resampled mono audio data
   */
  async resampleAudio(buffer, targetSampleRate = 16000, options = {}) {
    const { onProgress } = options;

    log.log(`Resampling from ${buffer.sampleRate}Hz to ${targetSampleRate}Hz`);

    onProgress?.({ stage: 'resampling', percent: 0, message: 'Resampling audio to 16kHz...' });

    try {
      // If already at target rate, just extract mono channel
      if (buffer.sampleRate === targetSampleRate) {
        const monoData = this.extractMonoChannel(buffer);
        onProgress?.({ stage: 'resampling', percent: 100, message: 'Audio prepared' });
        return monoData;
      }

      // Use OfflineAudioContext for high-quality resampling
      const duration = buffer.duration;
      const offlineContext = new OfflineAudioContext(
        1, // mono
        Math.ceil(duration * targetSampleRate),
        targetSampleRate
      );

      // Create buffer source
      const source = offlineContext.createBufferSource();
      source.buffer = buffer;
      source.connect(offlineContext.destination);
      source.start();

      // Render with progress updates
      const renderStartTime = performance.now();
      const renderPromise = offlineContext.startRendering();

      // Simulate progress based on estimated processing time
      // OfflineAudioContext typically processes at 10-50x real-time
      const estimatedMs = Math.max(duration * 50, 500); // At least 500ms
      let progressPercent = 0;

      const progressInterval = setInterval(() => {
        const elapsed = performance.now() - renderStartTime;
        progressPercent = Math.min(95, Math.round((elapsed / estimatedMs) * 100));
        onProgress?.({ stage: 'resampling', percent: progressPercent, message: 'Resampling audio...' });
      }, 100);

      const resampledBuffer = await renderPromise;
      clearInterval(progressInterval);

      // Disconnect and cleanup the source node
      source.disconnect();

      onProgress?.({ stage: 'resampling', percent: 100, message: 'Resampling complete' });

      // Extract mono channel - make a copy so the buffer can be released
      const channelData = resampledBuffer.getChannelData(0);
      const monoData = new Float32Array(channelData);

      log.log(`Resampling complete: ${monoData.length} samples at ${targetSampleRate}Hz`);

      return monoData;

    } catch (error) {
      log.error('Resampling failed:', error);
      throw new Error(`Audio resampling failed: ${error.message}`);
    }
  }

  /**
   * Extract mono channel from audio buffer
   * @param {AudioBuffer} buffer - Audio buffer
   * @returns {Float32Array} Mono audio data
   */
  extractMonoChannel(buffer) {
    if (buffer.numberOfChannels === 1) {
      return buffer.getChannelData(0);
    }

    // Mix down stereo/multi-channel to mono
    const channels = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    const length = buffer.length;
    const mono = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (const channel of channels) {
        sum += channel[i];
      }
      mono[i] = sum / channels.length;
    }

    return mono;
  }

  /**
   * Prepare audio for Whisper transcription
   * Extracts from source and resamples to 16kHz mono
   * @param {Object} source - Source information
   * @param {Object} options - Preparation options
   * @returns {Promise<Object>} Prepared audio data
   */
  async prepareForWhisper(source, options = {}) {
    const { onProgress } = options;

    log.log('Preparing audio for Whisper:', source.type);

    try {
      let audioBuffer;

      // Extract audio based on source type
      if (source.type === 'youtube') {
        audioBuffer = await this.extractFromYouTube(source.videoId, {
          onProgress: (progress) => {
            onProgress?.({ ...progress, overall: Math.round(progress.percent * 0.6) });
          }
        });
      } else if (source.type === 'upload') {
        audioBuffer = await this.extractFromFile(source.file, {
          onProgress: (progress) => {
            onProgress?.({ ...progress, overall: Math.round(progress.percent * 0.6) });
          }
        });
      } else {
        throw new Error(`Unsupported source type: ${source.type}`);
      }

      // Validate duration
      if (audioBuffer.duration > Config.AUDIO.maxDurationSeconds) {
        throw new Error(`Audio too long: ${Math.round(audioBuffer.duration)}s (max: ${Config.AUDIO.maxDurationSeconds}s)`);
      }

      if (audioBuffer.duration < Config.AUDIO.minDurationSeconds) {
        throw new Error(`Audio too short: ${Math.round(audioBuffer.duration)}s (min: ${Config.AUDIO.minDurationSeconds}s)`);
      }

      // Resample to 16kHz mono for Whisper
      const audioData = await this.resampleAudio(audioBuffer, 16000, {
        onProgress: (progress) => {
          onProgress?.({ ...progress, overall: 60 + Math.round(progress.percent * 0.3) });
        }
      });

      onProgress?.({ stage: 'complete', percent: 100, overall: 90, message: 'Audio ready for transcription' });

      return {
        audioData,
        sampleRate: 16000,
        duration: audioBuffer.duration,
        originalSampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels
      };

    } catch (error) {
      log.error('Audio preparation failed:', error);
      throw error;
    }
  }

  /**
   * Create object URL for audio playback
   * @param {AudioBuffer} buffer - Audio buffer
   * @param {string} mimeType - MIME type (default: audio/wav)
   * @returns {string} Object URL
   */
  createAudioURL(buffer, mimeType = 'audio/wav') {
    // Convert AudioBuffer to WAV blob
    const wav = this.audioBufferToWav(buffer);
    const blob = new Blob([wav], { type: mimeType });
    return URL.createObjectURL(blob);
  }

  /**
   * Convert AudioBuffer to WAV format
   * @param {AudioBuffer} buffer - Audio buffer
   * @returns {ArrayBuffer} WAV data
   */
  audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const data = new Float32Array(buffer.length * numChannels);
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < buffer.length; i++) {
        data[i * numChannels + channel] = channelData[i];
      }
    }

    const dataLength = data.length * bytesPerSample;
    const arrayBuffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(arrayBuffer);

    // Write WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < data.length; i++) {
      const sample = Math.max(-1, Math.min(1, data[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, int16, true);
      offset += 2;
    }

    return arrayBuffer;
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// Singleton instance
const audioExtractor = new AudioExtractor();

export { audioExtractor, AudioExtractor };
