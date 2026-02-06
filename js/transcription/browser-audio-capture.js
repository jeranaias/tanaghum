/**
 * Browser Audio Capture
 * Captures audio from YouTube videos playing in the browser
 * This bypasses all server-side blocking because it runs on the user's machine
 */

import { createLogger } from '../core/utils.js';

const log = createLogger('AudioCapture');

/**
 * Capture audio from the current browser tab
 * Uses getDisplayMedia API to capture tab audio
 */
class BrowserAudioCapture {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this.isCapturing = false;
  }

  /**
   * Check if browser supports audio capture
   */
  isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  }

  /**
   * Start capturing audio from the current tab
   * @param {Object} options - Capture options
   * @returns {Promise<void>}
   */
  async startCapture(options = {}) {
    if (!this.isSupported()) {
      throw new Error('Audio capture not supported in this browser. Please use Chrome or Edge.');
    }

    if (this.isCapturing) {
      throw new Error('Capture already in progress');
    }

    log.log('Starting audio capture...');

    try {
      // Request permission to capture tab audio
      // Note: video: true is required by the API even though we only want audio
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser', // Prefer current tab
          width: { ideal: 1 },  // Minimal video (we only want audio)
          height: { ideal: 1 },
          frameRate: { ideal: 1 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000
        },
        preferCurrentTab: true, // Chrome 109+: prefer current tab
        selfBrowserSurface: 'include', // Include current tab option
        systemAudio: 'include' // Include system audio
      });

      // Check if we got audio
      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track available. Make sure to select "Share tab audio" when prompted.');
      }

      log.log('Got audio track:', audioTracks[0].label);

      // Create audio-only stream for recording
      const audioStream = new MediaStream(audioTracks);

      // Set up MediaRecorder
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(audioStream, {
        mimeType,
        audioBitsPerSecond: 128000
      });

      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      // Start recording
      this.mediaRecorder.start(1000); // Collect data every second
      this.isCapturing = true;

      log.log('Audio capture started');

      // Handle track ending (user stops sharing)
      audioTracks[0].onended = () => {
        log.log('Audio track ended');
        this.stopCapture();
      };

    } catch (error) {
      this.cleanup();

      if (error.name === 'NotAllowedError') {
        throw new Error('Permission denied. Please allow audio capture to continue.');
      }
      throw error;
    }
  }

  /**
   * Stop capturing and return the audio blob
   * @returns {Promise<Blob>} Audio blob
   */
  async stopCapture() {
    if (!this.isCapturing) {
      return null;
    }

    log.log('Stopping audio capture...');

    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        this.cleanup();
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });

        log.log(`Captured ${audioBlob.size} bytes of audio`);

        this.cleanup();
        resolve(audioBlob);
      };

      this.mediaRecorder.onerror = (event) => {
        this.cleanup();
        reject(new Error('Recording error: ' + event.error));
      };

      if (this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      } else {
        this.cleanup();
        resolve(null);
      }
    });
  }

  /**
   * Get supported MIME type for recording
   */
  getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'audio/webm'; // Fallback
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isCapturing = false;
  }

  /**
   * Convert audio blob to AudioBuffer for Whisper
   * @param {Blob} blob - Audio blob
   * @returns {Promise<AudioBuffer>}
   */
  async blobToAudioBuffer(blob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    return await audioContext.decodeAudioData(arrayBuffer);
  }
}

/**
 * Capture audio from a YouTube video
 * @param {string} videoId - YouTube video ID
 * @param {Object} options - Options
 * @returns {Promise<AudioBuffer>} Captured audio
 */
async function captureYouTubeAudio(videoId, options = {}) {
  const { onProgress, onPlayerReady, playbackSpeed = 1.5 } = options;

  const capture = new BrowserAudioCapture();

  if (!capture.isSupported()) {
    throw new Error('Browser audio capture not supported. Please use Chrome or Edge.');
  }

  return new Promise((resolve, reject) => {
    // Create a container for the YouTube player
    const container = document.createElement('div');
    container.id = 'yt-capture-container';
    container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10000;
      background: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      text-align: center;
    `;

    container.innerHTML = `
      <div style="margin-bottom: 15px; font-weight: 600;">Extracting Audio...</div>
      <div id="yt-player" style="width: 480px; height: 270px; background: #000;"></div>
      <div id="capture-status" style="margin-top: 15px; color: #666;"></div>
      <div id="capture-progress" style="margin-top: 10px;">
        <div style="background: #e0e0e0; height: 8px; border-radius: 4px; overflow: hidden;">
          <div id="progress-bar" style="width: 0%; height: 100%; background: #4285f4; transition: width 0.3s;"></div>
        </div>
      </div>
      <button id="cancel-capture" style="margin-top: 15px; padding: 8px 20px; cursor: pointer;">Cancel</button>
    `;

    document.body.appendChild(container);

    const statusEl = container.querySelector('#capture-status');
    const progressBar = container.querySelector('#progress-bar');
    const cancelBtn = container.querySelector('#cancel-capture');

    let player = null;
    let captureStarted = false;
    let duration = 0;

    const cleanup = () => {
      if (player) {
        try { player.destroy(); } catch (e) {}
      }
      capture.cleanup();
      container.remove();
    };

    cancelBtn.onclick = () => {
      cleanup();
      reject(new Error('Capture cancelled by user'));
    };

    // Load YouTube IFrame API
    const loadYouTubeAPI = () => {
      return new Promise((resolve) => {
        if (window.YT && window.YT.Player) {
          resolve();
          return;
        }

        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);

        window.onYouTubeIframeAPIReady = resolve;
      });
    };

    const startProcess = async () => {
      try {
        statusEl.textContent = 'Loading video player...';
        await loadYouTubeAPI();

        player = new YT.Player('yt-player', {
          videoId: videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            modestbranding: 1,
            rel: 0
          },
          events: {
            onReady: async (event) => {
              duration = player.getDuration();
              const estimatedTime = Math.round(duration / playbackSpeed);
              statusEl.textContent = `Video loaded (${Math.round(duration)}s). Will extract in ~${estimatedTime}s at ${playbackSpeed}x speed.`;

              onPlayerReady?.();

              // Prompt for audio capture permission
              statusEl.textContent = 'Requesting audio capture permission...';

              try {
                await capture.startCapture();
                captureStarted = true;
                statusEl.textContent = `Audio capture active. Playing at ${playbackSpeed}x speed...`;

                // Set playback speed (1.5x default - faster capture without quality loss)
                // YouTube supports: 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2
                player.setPlaybackRate(playbackSpeed);

                // Start playing
                player.playVideo();

              } catch (e) {
                cleanup();
                reject(new Error('Failed to start audio capture: ' + e.message));
              }
            },
            onStateChange: async (event) => {
              if (event.data === YT.PlayerState.PLAYING) {
                // Update progress
                const updateProgress = setInterval(() => {
                  if (!captureStarted) return;

                  const currentTime = player.getCurrentTime();
                  const progress = (currentTime / duration) * 100;
                  progressBar.style.width = progress + '%';
                  const remainingReal = Math.round((duration - currentTime) / playbackSpeed);
                  statusEl.textContent = `Recording at ${playbackSpeed}x: ${Math.round(currentTime)}s / ${Math.round(duration)}s (~${remainingReal}s remaining)`;

                  onProgress?.({
                    stage: 'capturing',
                    percent: Math.round(progress),
                    currentTime,
                    duration
                  });

                  if (currentTime >= duration - 0.5) {
                    clearInterval(updateProgress);
                  }
                }, 500);

              } else if (event.data === YT.PlayerState.ENDED) {
                // Video finished - stop capture
                statusEl.textContent = 'Processing captured audio...';

                try {
                  const audioBlob = await capture.stopCapture();

                  if (!audioBlob || audioBlob.size === 0) {
                    throw new Error('No audio captured. Make sure tab audio sharing was enabled.');
                  }

                  statusEl.textContent = 'Converting audio...';
                  const audioBuffer = await capture.blobToAudioBuffer(audioBlob);

                  cleanup();
                  resolve(audioBuffer);

                } catch (e) {
                  cleanup();
                  reject(e);
                }
              }
            },
            onError: (event) => {
              cleanup();
              reject(new Error('YouTube player error: ' + event.data));
            }
          }
        });

      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    startProcess();
  });
}

// Singleton instance
const browserAudioCapture = new BrowserAudioCapture();

export { browserAudioCapture, BrowserAudioCapture, captureYouTubeAudio };
