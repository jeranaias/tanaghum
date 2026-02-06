/**
 * Tanaghum Audio Processor
 * Handles audio loading, processing, and waveform generation
 */

import { Config } from '../core/config.js';
import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { formatTime, createLogger } from '../core/utils.js';

const log = createLogger('AudioProcessor');

/**
 * Audio Processor class
 */
class AudioProcessor {
  constructor() {
    this.audioContext = null;
    this.audioBuffer = null;
    this.audioUrl = null;
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
   * Load audio from a File object
   * @param {File} file - Audio file
   * @returns {Promise<Object>} Audio data
   */
  async loadFile(file) {
    log.log('Loading audio file:', file.name, file.type);

    // Validate file type
    const validTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
      'audio/ogg', 'audio/webm', 'audio/m4a', 'audio/aac',
      'audio/x-m4a', 'audio/mp4'
    ];

    const isValidType = validTypes.includes(file.type) ||
      /\.(mp3|wav|ogg|webm|m4a|aac)$/i.test(file.name);

    if (!isValidType) {
      throw new Error(`Unsupported audio format: ${file.type || file.name.split('.').pop()}`);
    }

    // Check file size
    const maxSize = Config.AUDIO.maxFileSizeMB * 1024 * 1024;
    if (file.size > maxSize) {
      throw new Error(`File too large. Maximum size is ${Config.AUDIO.maxFileSizeMB}MB`);
    }

    // Create object URL for playback
    this.audioUrl = URL.createObjectURL(file);

    // Get duration using HTMLAudioElement
    const duration = await this.getAudioDuration(this.audioUrl);

    // Check duration limits
    if (duration > Config.AUDIO.maxDurationSeconds) {
      throw new Error(`Audio too long. Maximum duration is ${formatTime(Config.AUDIO.maxDurationSeconds)}`);
    }

    if (duration < Config.AUDIO.minDurationSeconds) {
      throw new Error(`Audio too short. Minimum duration is ${formatTime(Config.AUDIO.minDurationSeconds)}`);
    }

    // Load into AudioContext for processing
    const arrayBuffer = await file.arrayBuffer();
    this.initContext();
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    // Generate waveform
    const waveform = this.generateWaveform(this.audioBuffer);

    const audioData = {
      blob: file,
      url: this.audioUrl,
      duration,
      sampleRate: this.audioBuffer.sampleRate,
      channels: this.audioBuffer.numberOfChannels,
      waveform,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type
    };

    // Update state
    StateManager.set('audio', audioData);
    StateManager.set('source', { type: 'upload', file: file.name });

    EventBus.emit(Events.CONTENT_LOADED, {
      type: 'upload',
      audio: audioData
    });

    return audioData;
  }

  /**
   * Load audio from URL
   * @param {string} url - Audio URL
   * @returns {Promise<Object>} Audio data
   */
  async loadUrl(url) {
    log.log('Loading audio from URL:', url);

    // Fetch audio
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status}`);
    }

    const blob = await response.blob();
    const file = new File([blob], 'audio.mp3', { type: blob.type });

    return this.loadFile(file);
  }

  /**
   * Get audio duration using HTMLAudioElement
   * @param {string} url - Audio URL
   * @returns {Promise<number>} Duration in seconds
   */
  getAudioDuration(url) {
    return new Promise((resolve, reject) => {
      const audio = new Audio();

      audio.addEventListener('loadedmetadata', () => {
        resolve(audio.duration);
      });

      audio.addEventListener('error', () => {
        reject(new Error('Failed to load audio metadata'));
      });

      audio.src = url;
    });
  }

  /**
   * Generate waveform data from audio buffer
   * @param {AudioBuffer} buffer - Audio buffer
   * @param {number} samples - Number of samples in output
   * @returns {number[]} Waveform data (0-255)
   */
  generateWaveform(buffer, samples = 200) {
    const channelData = buffer.getChannelData(0); // Use first channel
    const blockSize = Math.floor(channelData.length / samples);
    const waveform = [];

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      const end = start + blockSize;

      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += Math.abs(channelData[j]);
      }

      const average = sum / blockSize;
      // Normalize to 0-255 range
      waveform.push(Math.min(255, Math.floor(average * 255 * 2)));
    }

    return waveform;
  }

  /**
   * Convert audio to format suitable for Whisper
   * Whisper expects 16kHz mono audio
   * @param {AudioBuffer} buffer - Input audio buffer
   * @returns {Float32Array} Resampled audio data
   */
  async prepareForWhisper(buffer = this.audioBuffer) {
    if (!buffer) {
      throw new Error('No audio buffer loaded');
    }

    const targetSampleRate = Config.AUDIO.targetSampleRate || 16000;

    // If already correct format, just return mono channel
    if (buffer.sampleRate === targetSampleRate && buffer.numberOfChannels === 1) {
      return buffer.getChannelData(0);
    }

    log.log(`Resampling from ${buffer.sampleRate}Hz to ${targetSampleRate}Hz`);

    // Use OfflineAudioContext for resampling
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

    // Render
    const resampledBuffer = await offlineContext.startRendering();

    return resampledBuffer.getChannelData(0);
  }

  /**
   * Extract a segment of audio
   * @param {number} startTime - Start time in seconds
   * @param {number} endTime - End time in seconds
   * @returns {AudioBuffer} Audio segment
   */
  extractSegment(startTime, endTime) {
    if (!this.audioBuffer) {
      throw new Error('No audio loaded');
    }

    const sampleRate = this.audioBuffer.sampleRate;
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.floor(endTime * sampleRate);
    const length = endSample - startSample;

    this.initContext();
    const segment = this.audioContext.createBuffer(
      this.audioBuffer.numberOfChannels,
      length,
      sampleRate
    );

    for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
      const sourceData = this.audioBuffer.getChannelData(channel);
      const targetData = segment.getChannelData(channel);
      targetData.set(sourceData.subarray(startSample, endSample));
    }

    return segment;
  }

  /**
   * Calculate speaking rate from transcript
   * @param {string} text - Transcript text
   * @param {number} duration - Audio duration in seconds
   * @returns {number} Words per minute
   */
  calculateSpeakingRate(text, duration) {
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const minutes = duration / 60;
    return Math.round(wordCount / minutes);
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }

    this.audioBuffer = null;

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Get current audio URL
   */
  getAudioUrl() {
    return this.audioUrl;
  }

  /**
   * Get audio buffer
   */
  getAudioBuffer() {
    return this.audioBuffer;
  }
}

// Singleton instance
const audioProcessor = new AudioProcessor();

export { audioProcessor, AudioProcessor };
