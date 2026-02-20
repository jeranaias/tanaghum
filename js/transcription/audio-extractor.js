/**
 * Tanaghum Audio Extractor
 * Extracts and prepares audio for transcription from various sources
 */

import { Config } from '../core/config.js';
import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { createLogger } from '../core/utils.js';
import { captureYouTubeAudio } from './browser-audio-capture.js';

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
      // Step 1: Try to get audio URL from worker (tries multiple methods)
      onProgress?.({ stage: 'fetching', percent: 0, message: 'Requesting audio URL...' });

      let audioMeta = null;
      let lastError = null;

      // Method 1: Try worker endpoint (uses yt-dlp service)
      try {
        const metaResponse = await fetch(`${this.workerUrl}/api/youtube/audio?v=${videoId}`, {
          method: 'GET'
        });

        if (metaResponse.ok) {
          audioMeta = await metaResponse.json();
          if (audioMeta.available && audioMeta.audioUrl) {
            log.log('Got audio URL from worker');
          } else if (audioMeta.hasCaptions) {
            // Worker says: use captions instead of audio
            throw new Error(
              'CAPTIONS_AVAILABLE:' + (audioMeta.message || 'Video has captions. Use caption-based transcription.')
            );
          } else {
            lastError = audioMeta.error || audioMeta.suggestion;
            audioMeta = null;
          }
        } else if (metaResponse.status === 404 || metaResponse.status === 501) {
          lastError = 'Audio extraction service not available';
        } else {
          const err = await metaResponse.json().catch(() => ({}));
          lastError = err.error || `HTTP ${metaResponse.status}`;
        }
      } catch (e) {
        if (e.message.startsWith('CAPTIONS_AVAILABLE:')) {
          throw e; // Re-throw to trigger caption fallback
        }
        log.warn('Worker audio fetch failed:', e.message);
        lastError = e.message;
      }

      // Method 2: If server-side failed, use browser audio capture
      // This plays the video and captures the audio in real-time
      if (!audioMeta || !audioMeta.available || !audioMeta.audioUrl) {
        log.log('Server-side extraction failed, attempting browser audio capture');
        onProgress?.({ stage: 'browser-capture', percent: 5, message: 'Preparing browser audio capture...' });

        try {
          // Use 2x speed - halves capture time; YouTube supports up to 2x
          const captureResult = await captureYouTubeAudio(videoId, {
            playbackSpeed: 2.0,
            onProgress: (progress) => {
              onProgress?.({
                stage: 'browser-capture',
                percent: 5 + Math.round(progress.percent * 0.9),
                message: `Capturing audio at 2x: ${Math.round(progress.currentTime || 0)}s / ${Math.round(progress.duration || 0)}s`
              });
            }
          });

          log.log('Browser audio capture successful');

          // captureYouTubeAudio returns object with audio, realDuration, playbackSpeed
          // We need to pass through the real duration for accurate lesson metadata
          if (captureResult && typeof captureResult === 'object' && captureResult.audio !== undefined) {
            // Return object with audio and real duration metadata
            return {
              audio: captureResult.audio,
              realDuration: captureResult.realDuration,
              playbackSpeed: captureResult.playbackSpeed,
              isCaptureResult: true
            };
          }

          // Fallback for older format (shouldn't happen but be safe)
          return captureResult;

        } catch (captureError) {
          log.error('Browser audio capture failed:', captureError);
          throw new Error(
            'Audio extraction failed. Browser capture was cancelled or failed. ' +
            'Please try again and allow audio sharing when prompted.'
          );
        }
      }

      log.log('Got audio URL from', audioMeta.source);
      onProgress?.({ stage: 'fetching', percent: 10, message: `Downloading audio via ${audioMeta.source}...` });

      // Step 2: Fetch actual audio - try direct first, then proxy through worker
      let response;
      try {
        response = await fetch(audioMeta.audioUrl, { method: 'GET' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (directError) {
        log.warn('Direct audio fetch failed (likely CORS), trying worker proxy:', directError.message);
        onProgress?.({ stage: 'fetching', percent: 12, message: 'Downloading audio via proxy...' });
        try {
          response = await fetch(`${this.workerUrl}/api/proxy?url=${encodeURIComponent(audioMeta.audioUrl)}`);
          if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
        } catch (proxyError) {
          log.warn('Proxy audio fetch also failed, falling back to browser capture:', proxyError.message);
          // Fall back to browser audio capture
          onProgress?.({ stage: 'browser-capture', percent: 5, message: 'Preparing browser audio capture...' });
          const captureResult = await captureYouTubeAudio(videoId, {
            playbackSpeed: 2.0,
            onProgress: (progress) => {
              onProgress?.({
                stage: 'browser-capture',
                percent: 5 + Math.round(progress.percent * 0.9),
                message: `Capturing audio at 2x: ${Math.round(progress.currentTime || 0)}s / ${Math.round(progress.duration || 0)}s`
              });
            }
          });
          if (captureResult && typeof captureResult === 'object' && captureResult.audio !== undefined) {
            return { audio: captureResult.audio, realDuration: captureResult.realDuration, playbackSpeed: captureResult.playbackSpeed, isCaptureResult: true };
          }
          return captureResult;
        }
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
          const percent = 10 + Math.round((received / total) * 85); // 10-95%
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
      let audioResult;

      // Extract audio based on source type
      if (source.type === 'youtube') {
        audioResult = await this.extractFromYouTube(source.videoId, {
          onProgress: (progress) => {
            onProgress?.({ ...progress, overall: Math.round(progress.percent * 0.6) });
          }
        });
      } else if (source.type === 'upload') {
        audioResult = await this.extractFromFile(source.file, {
          onProgress: (progress) => {
            onProgress?.({ ...progress, overall: Math.round(progress.percent * 0.6) });
          }
        });
      } else {
        throw new Error(`Unsupported source type: ${source.type}`);
      }

      // Handle browser capture result which includes real duration
      let audioBuffer = audioResult;
      let realDuration = null;

      if (audioResult && typeof audioResult === 'object' && audioResult.isCaptureResult) {
        log.log('Got browser capture result with realDuration:', audioResult.realDuration);
        realDuration = audioResult.realDuration;
        audioBuffer = audioResult.audio;
      }

      // If we got a string URL (from browser capture fallback), pass it directly to Whisper
      if (typeof audioBuffer === 'string') {
        log.log('Got blob URL, passing directly to Whisper');
        onProgress?.({ stage: 'complete', percent: 100, overall: 90, message: 'Audio ready for transcription' });

        return {
          audioData: audioBuffer, // URL string - Whisper can handle this
          sampleRate: 16000,
          duration: realDuration || 0, // Use real duration if available
          realDuration: realDuration, // Pass through for lesson metadata
          isUrl: true
        };
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
        duration: realDuration || audioBuffer.duration, // Prefer real duration if available
        realDuration: realDuration, // Pass through for lesson metadata
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
