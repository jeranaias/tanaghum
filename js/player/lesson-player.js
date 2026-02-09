/**
 * Tanaghum Lesson Player
 * Interactive player with synchronized transcript, vocabulary, and questions
 */

import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { createLogger, formatTime, escapeHtml } from '../core/utils.js';

const log = createLogger('LessonPlayer');

// Track if YouTube API is loading to prevent multiple script injections
let youtubeAPILoading = null;

/**
 * Lesson Player class
 */
class LessonPlayer {
  constructor(options = {}) {
    this.lesson = null;
    this.audioElement = null;
    this.videoElement = null;
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
    this.playbackRate = 1.0;
    this.activeSegmentIndex = -1;
    this.completedQuestions = new Set();

    // Callbacks
    this.onTimeUpdate = options.onTimeUpdate || (() => {});
    this.onSegmentChange = options.onSegmentChange || (() => {});
    this.onPlay = options.onPlay || (() => {});
    this.onPause = options.onPause || (() => {});
    this.onEnded = options.onEnded || (() => {});

    // Bind methods
    this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
    this.handlePlay = this.handlePlay.bind(this);
    this.handlePause = this.handlePause.bind(this);
    this.handleEnded = this.handleEnded.bind(this);
  }

  /**
   * Load a lesson
   * @param {Object} lesson - Lesson object
   */
  async load(lesson) {
    if (!lesson) {
      throw new Error('No lesson provided');
    }

    this.lesson = lesson;
    log.log('Loading lesson:', lesson.metadata?.title);

    // Check if player.html already created an audio element - use that first
    const existingAudioEl = document.getElementById('audio-player');

    // Check for captured audio URL first (from browser capture)
    // This takes priority over YouTube iframe for better playback control
    // Ensure capturedUrl is a non-empty string before using it
    const capturedUrl = lesson.audio?.capturedUrl || lesson.audio?.url;
    const hasCapturedUrl = typeof capturedUrl === 'string' && capturedUrl.length > 0;

    // Create appropriate media element
    if (existingAudioEl || hasCapturedUrl) {
      // Use captured audio for playback (works for both YouTube captures and uploads)
      // If existingAudioEl exists, setupAudioPlayer will use it
      log.log('Using captured audio URL for playback');
      await this.setupAudioPlayer(capturedUrl || existingAudioEl.src);
    } else if (lesson.audio?.type === 'youtube' && lesson.audio?.videoId) {
      // Fall back to YouTube iframe if no captured audio
      log.log('Using YouTube iframe for playback');
      await this.setupYouTubePlayer(lesson.audio.videoId);
    } else {
      log.warn('No audio source available for playback');
    }

    // Initialize state
    this.duration = lesson.metadata?.duration || 0;
    this.activeSegmentIndex = -1;
    this.completedQuestions.clear();

    StateManager.set('player', {
      lessonId: lesson.id,
      isPlaying: false,
      currentTime: 0,
      duration: this.duration
    });

    return this;
  }

  /**
   * Setup audio player for local/uploaded files
   * @param {string} url - Audio URL
   */
  async setupAudioPlayer(url) {
    // Clean up any existing YouTube player first
    this.cleanupYouTubePlayer();

    // Try to use existing DOM audio element first (created by player.html)
    const existingAudio = document.getElementById('audio-player');
    if (existingAudio) {
      log.log('Using existing DOM audio element');
      this.audioElement = existingAudio;
      // Update src if needed
      if (!this.audioElement.src || this.audioElement.src !== url) {
        this.audioElement.src = url;
      }
    } else {
      log.log('Creating new Audio element');
      this.audioElement = new Audio();
      this.audioElement.src = url;
      this.audioElement.preload = 'metadata';
    }

    this.audioElement.addEventListener('timeupdate', this.handleTimeUpdate);
    this.audioElement.addEventListener('play', this.handlePlay);
    this.audioElement.addEventListener('pause', this.handlePause);
    this.audioElement.addEventListener('ended', this.handleEnded);

    await new Promise((resolve, reject) => {
      // If already loaded, resolve immediately
      if (this.audioElement.readyState >= 1) {
        this.duration = this.audioElement.duration || 0;
        resolve();
        return;
      }

      const onLoaded = () => {
        this.audioElement.removeEventListener('loadedmetadata', onLoaded);
        this.audioElement.removeEventListener('error', onError);
        this.duration = this.audioElement.duration;
        resolve();
      };
      const onError = (e) => {
        this.audioElement.removeEventListener('loadedmetadata', onLoaded);
        this.audioElement.removeEventListener('error', onError);
        reject(new Error(`Failed to load audio: ${e.message || 'Unknown error'}`));
      };
      this.audioElement.addEventListener('loadedmetadata', onLoaded);
      this.audioElement.addEventListener('error', onError);
    });

    log.log('Audio player ready, duration:', this.duration);
  }

  /**
   * Setup YouTube player
   * @param {string} videoId - YouTube video ID
   */
  async setupYouTubePlayer(videoId) {
    // Clean up any existing audio player first
    this.cleanupAudioPlayer();

    // Check for existing YouTube iframe created by player.html
    const existingIframe = document.getElementById('yt-iframe');
    if (existingIframe) {
      log.log('Found existing YouTube iframe, using postMessage API');
      // Use the existing iframe - we'll control it via postMessage or let it be standalone
      // The iframe already has the video loaded, so we just need to track its state
      this.videoElement = existingIframe;

      // For existing iframes, we can use the YouTube IFrame API to control them
      // but first we need to ensure the API is loaded
      if (!window.YT || !window.YT.Player) {
        await this.loadYouTubeAPI();
      }

      // Get the player from the existing iframe
      return new Promise((resolve) => {
        // Try to initialize YT.Player on the existing iframe
        try {
          this.ytPlayer = new YT.Player('yt-iframe', {
            events: {
              onReady: () => {
                this.duration = this.ytPlayer.getDuration() || 0;
                this.startYouTubeTimeUpdate();
                resolve();
              },
              onStateChange: (event) => {
                if (event.data === YT.PlayerState.PLAYING) {
                  this.handlePlay();
                } else if (event.data === YT.PlayerState.PAUSED) {
                  this.handlePause();
                } else if (event.data === YT.PlayerState.ENDED) {
                  this.handleEnded();
                }
              }
            }
          });
        } catch (e) {
          // If we can't control the iframe, just resolve and let it play standalone
          log.warn('Could not initialize YT.Player on existing iframe:', e);
          resolve();
        }
      });
    }

    // Create container for YouTube iframe if no existing one
    this.videoElement = document.createElement('div');
    this.videoElement.id = 'yt-player-container';

    // Load YouTube IFrame API if not already loaded
    if (!window.YT || !window.YT.Player) {
      await this.loadYouTubeAPI();
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('YouTube player initialization timed out'));
      }, 15000);

      try {
        this.ytPlayer = new YT.Player(this.videoElement, {
          videoId: videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1
          },
          events: {
            onReady: () => {
              clearTimeout(timeoutId);
              this.duration = this.ytPlayer.getDuration();
              // Start time update polling
              this.startYouTubeTimeUpdate();
              resolve();
            },
            onStateChange: (event) => {
              if (event.data === YT.PlayerState.PLAYING) {
                this.handlePlay();
              } else if (event.data === YT.PlayerState.PAUSED) {
                this.handlePause();
              } else if (event.data === YT.PlayerState.ENDED) {
                this.handleEnded();
              }
            },
            onError: (event) => {
              clearTimeout(timeoutId);
              const errorMessages = {
                2: 'Invalid video ID',
                5: 'HTML5 player error',
                100: 'Video not found or removed',
                101: 'Video embedding not allowed',
                150: 'Video embedding not allowed'
              };
              reject(new Error(errorMessages[event.data] || `YouTube error: ${event.data}`));
            }
          }
        });
      } catch (e) {
        clearTimeout(timeoutId);
        reject(e);
      }
    });
  }

  /**
   * Load YouTube IFrame API
   */
  loadYouTubeAPI() {
    // Reuse existing loading promise to prevent multiple script injections
    if (youtubeAPILoading) {
      return youtubeAPILoading;
    }

    // API already loaded
    if (window.YT && window.YT.Player) {
      return Promise.resolve();
    }

    youtubeAPILoading = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';

      // Store original callback if exists
      const originalCallback = window.onYouTubeIframeAPIReady;

      window.onYouTubeIframeAPIReady = () => {
        if (originalCallback) originalCallback();
        resolve();
      };

      tag.onerror = () => {
        youtubeAPILoading = null;
        reject(new Error('Failed to load YouTube IFrame API'));
      };

      const firstScript = document.getElementsByTagName('script')[0];
      if (firstScript && firstScript.parentNode) {
        firstScript.parentNode.insertBefore(tag, firstScript);
      } else {
        document.head.appendChild(tag);
      }
    });

    return youtubeAPILoading;
  }

  /**
   * Start polling for YouTube time updates
   */
  startYouTubeTimeUpdate() {
    this.ytTimeInterval = setInterval(() => {
      if (this.ytPlayer && this.isPlaying) {
        this.currentTime = this.ytPlayer.getCurrentTime();
        this.handleTimeUpdate();
      }
    }, 100);
  }

  /**
   * Handle time update
   */
  handleTimeUpdate() {
    if (this.audioElement) {
      this.currentTime = this.audioElement.currentTime;
    }

    // Find active segment
    const segments = this.lesson?.content?.transcript?.segments || [];
    let newActiveIndex = -1;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (this.currentTime >= seg.start && this.currentTime < (seg.end || seg.start + 5)) {
        newActiveIndex = i;
        break;
      }
    }

    // Emit segment change if changed
    if (newActiveIndex !== this.activeSegmentIndex) {
      this.activeSegmentIndex = newActiveIndex;
      const segment = segments[newActiveIndex];

      this.onSegmentChange(newActiveIndex, segment);
      EventBus.emit(Events.TRANSCRIPT_LINE_ACTIVE, {
        index: newActiveIndex,
        segment
      });
    }

    this.onTimeUpdate(this.currentTime, this.duration);
    EventBus.emit(Events.AUDIO_TIME_UPDATE, {
      currentTime: this.currentTime,
      duration: this.duration,
      progress: this.duration > 0 ? this.currentTime / this.duration : 0
    });
  }

  /**
   * Handle play event
   */
  handlePlay() {
    this.isPlaying = true;
    this.onPlay();
    EventBus.emit(Events.AUDIO_PLAY);
    StateManager.set('player.isPlaying', true);
  }

  /**
   * Handle pause event
   */
  handlePause() {
    this.isPlaying = false;
    this.onPause();
    EventBus.emit(Events.AUDIO_PAUSE);
    StateManager.set('player.isPlaying', false);
  }

  /**
   * Handle ended event
   */
  handleEnded() {
    this.isPlaying = false;
    this.onEnded();
    EventBus.emit(Events.AUDIO_ENDED);
    StateManager.set('player.isPlaying', false);
  }

  /**
   * Play
   */
  play() {
    if (this.audioElement) {
      this.audioElement.play().catch(e => log.warn('Play failed:', e.message));
    } else if (this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
      this.ytPlayer.playVideo();
    } else {
      log.warn('No audio or video player available');
    }
  }

  /**
   * Pause
   */
  pause() {
    if (this.audioElement) {
      this.audioElement.pause();
    } else if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
      this.ytPlayer.pauseVideo();
    } else {
      log.warn('No audio or video player available');
    }
  }

  /**
   * Toggle play/pause
   */
  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Seek to time
   * @param {number} time - Time in seconds
   */
  seek(time) {
    time = Math.max(0, Math.min(time, this.duration));

    if (this.audioElement) {
      this.audioElement.currentTime = time;
    } else if (this.ytPlayer) {
      this.ytPlayer.seekTo(time, true);
    }

    this.currentTime = time;
    this.handleTimeUpdate();

    EventBus.emit(Events.AUDIO_SEEK, { time });
  }

  /**
   * Seek to segment
   * @param {number} index - Segment index
   */
  seekToSegment(index) {
    const segments = this.lesson?.content?.transcript?.segments || [];
    const segment = segments[index];

    if (segment) {
      this.seek(segment.start);
    }
  }

  /**
   * Skip forward/backward
   * @param {number} seconds - Seconds to skip (negative for backward)
   */
  skip(seconds) {
    this.seek(this.currentTime + seconds);
  }

  /**
   * Set playback rate
   * @param {number} rate - Playback rate (0.5 - 2.0)
   */
  setPlaybackRate(rate) {
    rate = Math.max(0.5, Math.min(2.0, rate));
    this.playbackRate = rate;

    if (this.audioElement) {
      this.audioElement.playbackRate = rate;
    } else if (this.ytPlayer) {
      this.ytPlayer.setPlaybackRate(rate);
    }

    EventBus.emit(Events.AUDIO_RATE_CHANGE, { rate });
    StateManager.set('player.playbackRate', rate);
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isPlaying: this.isPlaying,
      currentTime: this.currentTime,
      duration: this.duration,
      playbackRate: this.playbackRate,
      activeSegmentIndex: this.activeSegmentIndex,
      progress: this.duration > 0 ? this.currentTime / this.duration : 0
    };
  }

  /**
   * Get segment at time
   * @param {number} time - Time in seconds
   */
  getSegmentAtTime(time) {
    const segments = this.lesson?.content?.transcript?.segments || [];

    for (const seg of segments) {
      if (time >= seg.start && time < (seg.end || seg.start + 5)) {
        return seg;
      }
    }

    return null;
  }

  /**
   * Mark question as completed
   * @param {string} questionId - Question ID
   * @param {Object} answer - Answer data
   */
  completeQuestion(questionId, answer) {
    this.completedQuestions.add(questionId);

    EventBus.emit(Events.QUIZ_ANSWER_SUBMITTED, {
      questionId,
      answer,
      totalCompleted: this.completedQuestions.size
    });
  }

  /**
   * Get quiz progress
   */
  getQuizProgress() {
    const questions = this.lesson?.content?.questions || {};
    const total = (questions.pre?.length || 0) +
                  (questions.while?.length || 0) +
                  (questions.post?.length || 0);

    return {
      completed: this.completedQuestions.size,
      total,
      percentage: total > 0 ? (this.completedQuestions.size / total) * 100 : 0
    };
  }

  /**
   * Clean up audio player
   */
  cleanupAudioPlayer() {
    if (this.audioElement) {
      this.audioElement.removeEventListener('timeupdate', this.handleTimeUpdate);
      this.audioElement.removeEventListener('play', this.handlePlay);
      this.audioElement.removeEventListener('pause', this.handlePause);
      this.audioElement.removeEventListener('ended', this.handleEnded);
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement = null;
    }
  }

  /**
   * Clean up YouTube player
   */
  cleanupYouTubePlayer() {
    if (this.ytTimeInterval) {
      clearInterval(this.ytTimeInterval);
      this.ytTimeInterval = null;
    }

    if (this.ytPlayer) {
      try {
        this.ytPlayer.destroy();
      } catch (e) {
        log.warn('Error destroying YouTube player:', e);
      }
      this.ytPlayer = null;
    }

    if (this.videoElement) {
      this.videoElement = null;
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this.cleanupAudioPlayer();
    this.cleanupYouTubePlayer();

    this.lesson = null;
    this.isPlaying = false;
  }
}

export { LessonPlayer };
