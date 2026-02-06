/**
 * Tanaghum Standalone Player
 * Self-contained, minimal player for exported lessons
 * No external dependencies - works offline
 * Target: ~50KB minified
 */

(function() {
  'use strict';

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  /**
   * Format seconds to MM:SS or HH:MM:SS
   */
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Debounce function
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Simple event emitter
   */
  class EventEmitter {
    constructor() {
      this.events = {};
    }

    on(event, callback) {
      if (!this.events[event]) {
        this.events[event] = [];
      }
      this.events[event].push(callback);
    }

    emit(event, data) {
      if (this.events[event]) {
        this.events[event].forEach(callback => callback(data));
      }
    }

    off(event, callback) {
      if (this.events[event]) {
        this.events[event] = this.events[event].filter(cb => cb !== callback);
      }
    }
  }

  // ============================================================================
  // STORAGE MANAGER (localStorage wrapper)
  // ============================================================================

  class StorageManager {
    constructor(lessonId) {
      this.prefix = `tanaghum_${lessonId}_`;
    }

    get(key, defaultValue = null) {
      try {
        const value = localStorage.getItem(this.prefix + key);
        return value ? JSON.parse(value) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    }

    set(key, value) {
      try {
        localStorage.setItem(this.prefix + key, JSON.stringify(value));
      } catch (e) {
        console.warn('Failed to save to localStorage:', e);
      }
    }

    remove(key) {
      try {
        localStorage.removeItem(this.prefix + key);
      } catch (e) {
        console.warn('Failed to remove from localStorage:', e);
      }
    }

    clear() {
      try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith(this.prefix)) {
            localStorage.removeItem(key);
          }
        });
      } catch (e) {
        console.warn('Failed to clear localStorage:', e);
      }
    }
  }

  // ============================================================================
  // MEDIA PLAYER
  // ============================================================================

  class MediaPlayer extends EventEmitter {
    constructor(mediaElement) {
      super();
      this.media = mediaElement;
      this.isPlaying = false;
      this.currentTime = 0;
      this.duration = 0;
      this.playbackRate = 1.0;

      this.setupEventListeners();
    }

    setupEventListeners() {
      this.media.addEventListener('timeupdate', () => {
        this.currentTime = this.media.currentTime;
        this.emit('timeupdate', this.currentTime);
      });

      this.media.addEventListener('play', () => {
        this.isPlaying = true;
        this.emit('play');
      });

      this.media.addEventListener('pause', () => {
        this.isPlaying = false;
        this.emit('pause');
      });

      this.media.addEventListener('ended', () => {
        this.isPlaying = false;
        this.emit('ended');
      });

      this.media.addEventListener('loadedmetadata', () => {
        this.duration = this.media.duration;
        this.emit('ready', this.duration);
      });

      this.media.addEventListener('error', (e) => {
        this.emit('error', e);
      });
    }

    play() {
      return this.media.play();
    }

    pause() {
      this.media.pause();
    }

    togglePlay() {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    }

    seek(time) {
      this.media.currentTime = Math.max(0, Math.min(time, this.duration));
    }

    skip(seconds) {
      this.seek(this.currentTime + seconds);
    }

    setPlaybackRate(rate) {
      this.playbackRate = rate;
      this.media.playbackRate = rate;
      this.emit('ratechange', rate);
    }
  }

  // ============================================================================
  // TRANSCRIPT VIEWER
  // ============================================================================

  class TranscriptViewer extends EventEmitter {
    constructor(containerElement, segments) {
      super();
      this.container = containerElement;
      this.segments = segments || [];
      this.activeIndex = -1;
      this.render();
    }

    render() {
      this.container.innerHTML = '';

      if (this.segments.length === 0) {
        this.container.innerHTML = '<p class="no-transcript">No transcript available</p>';
        return;
      }

      this.segments.forEach((segment, index) => {
        const segmentEl = document.createElement('div');
        segmentEl.className = 'transcript-segment';
        segmentEl.dataset.index = index;
        segmentEl.dataset.start = segment.start;

        const timeEl = document.createElement('span');
        timeEl.className = 'segment-time';
        timeEl.textContent = formatTime(segment.start);

        const textEl = document.createElement('span');
        textEl.className = 'segment-text';
        textEl.textContent = segment.text;

        segmentEl.appendChild(timeEl);
        segmentEl.appendChild(textEl);

        segmentEl.addEventListener('click', () => {
          this.emit('seek', parseFloat(segment.start));
        });

        this.container.appendChild(segmentEl);
      });
    }

    setActiveSegment(time) {
      let newIndex = -1;

      for (let i = 0; i < this.segments.length; i++) {
        const seg = this.segments[i];
        const end = seg.end || (this.segments[i + 1]?.start) || (seg.start + 5);

        if (time >= seg.start && time < end) {
          newIndex = i;
          break;
        }
      }

      if (newIndex !== this.activeIndex) {
        // Remove old active class
        if (this.activeIndex >= 0) {
          const oldEl = this.container.querySelector(`[data-index="${this.activeIndex}"]`);
          if (oldEl) oldEl.classList.remove('active');
        }

        // Add new active class
        if (newIndex >= 0) {
          const newEl = this.container.querySelector(`[data-index="${newIndex}"]`);
          if (newEl) {
            newEl.classList.add('active');
            // Scroll into view
            newEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }

        this.activeIndex = newIndex;
        this.emit('segmentchange', newIndex);
      }
    }
  }

  // ============================================================================
  // QUESTION MANAGER
  // ============================================================================

  class QuestionManager extends EventEmitter {
    constructor(questions, storage) {
      super();
      this.questions = questions || { pre: [], while: [], post: [] };
      this.storage = storage;
      this.answers = storage.get('answers', {});
      this.currentQuestion = null;
    }

    getAllQuestions() {
      const all = [];

      if (this.questions.pre) {
        this.questions.pre.forEach((q, i) => {
          all.push({ ...q, phase: 'pre', index: i, id: `pre_${i}` });
        });
      }

      if (this.questions.while) {
        this.questions.while.forEach((q, i) => {
          all.push({ ...q, phase: 'while', index: i, id: `while_${i}` });
        });
      }

      if (this.questions.post) {
        this.questions.post.forEach((q, i) => {
          all.push({ ...q, phase: 'post', index: i, id: `post_${i}` });
        });
      }

      return all;
    }

    getQuestionAtTime(time) {
      const whileQuestions = this.questions.while || [];

      for (let i = 0; i < whileQuestions.length; i++) {
        const q = whileQuestions[i];
        if (q.timestamp && Math.abs(time - q.timestamp) < 2) {
          return { ...q, phase: 'while', index: i, id: `while_${i}` };
        }
      }

      return null;
    }

    submitAnswer(questionId, answer) {
      this.answers[questionId] = {
        answer,
        timestamp: Date.now(),
        correct: this.checkAnswer(questionId, answer)
      };

      this.storage.set('answers', this.answers);
      this.emit('answer', { questionId, ...this.answers[questionId] });

      return this.answers[questionId];
    }

    checkAnswer(questionId, answer) {
      const question = this.getAllQuestions().find(q => q.id === questionId);

      if (!question || !question.correctAnswer) {
        return null; // Cannot verify
      }

      if (question.format === 'multiple_choice') {
        return answer === question.correctAnswer;
      } else if (question.format === 'fill_blank') {
        const normalized = answer.trim().toLowerCase();
        const correct = question.correctAnswer.toLowerCase();
        return normalized === correct;
      }

      return null; // Open-ended or unknown format
    }

    getProgress() {
      const all = this.getAllQuestions();
      const answered = Object.keys(this.answers).length;
      const correct = Object.values(this.answers).filter(a => a.correct === true).length;

      return {
        total: all.length,
        answered,
        correct,
        percentage: all.length > 0 ? (answered / all.length) * 100 : 0,
        score: answered > 0 ? (correct / answered) * 100 : 0
      };
    }

    resetProgress() {
      this.answers = {};
      this.storage.remove('answers');
      this.emit('reset');
    }
  }

  // ============================================================================
  // VOCABULARY VIEWER
  // ============================================================================

  class VocabularyViewer {
    constructor(containerElement, vocabulary) {
      this.container = containerElement;
      this.vocabulary = vocabulary || { items: [] };
      this.render();
    }

    render() {
      this.container.innerHTML = '';

      const items = this.vocabulary.items || [];

      if (items.length === 0) {
        this.container.innerHTML = '<p class="no-vocab">No vocabulary available</p>';
        return;
      }

      items.forEach(item => {
        const vocabEl = document.createElement('div');
        vocabEl.className = 'vocab-item';

        const arabicEl = document.createElement('div');
        arabicEl.className = 'vocab-arabic';
        arabicEl.textContent = item.arabic || item.word;

        const translitEl = document.createElement('div');
        translitEl.className = 'vocab-translit';
        translitEl.textContent = item.transliteration || '';

        const meaningEl = document.createElement('div');
        meaningEl.className = 'vocab-meaning';
        meaningEl.textContent = item.meaning || item.definition || '';

        vocabEl.appendChild(arabicEl);
        if (translitEl.textContent) vocabEl.appendChild(translitEl);
        if (meaningEl.textContent) vocabEl.appendChild(meaningEl);

        this.container.appendChild(vocabEl);
      });
    }
  }

  // ============================================================================
  // MAIN LESSON PLAYER APP
  // ============================================================================

  class LessonPlayerApp {
    constructor(lesson, options = {}) {
      this.lesson = lesson;
      this.options = options;
      this.storage = new StorageManager(lesson.id);

      // Initialize components
      this.initializeDOM();
      this.setupMediaPlayer();
      this.setupTranscript();
      this.setupQuestions();
      this.setupVocabulary();
      this.setupControls();
      this.setupKeyboardShortcuts();

      // Load saved state
      this.loadState();

      console.log('Tanaghum Lesson Player initialized');
    }

    initializeDOM() {
      // Get main elements
      this.mediaElement = document.getElementById('media-player');
      this.playPauseBtn = document.getElementById('play-pause-btn');
      this.progressBar = document.getElementById('progress-bar');
      this.progressFill = document.getElementById('progress-fill');
      this.currentTimeEl = document.getElementById('current-time');
      this.durationEl = document.getElementById('duration');
      this.speedSelect = document.getElementById('speed-select');
      this.transcriptContainer = document.getElementById('transcript-container');
      this.questionContainer = document.getElementById('question-container');
      this.vocabContainer = document.getElementById('vocab-container');
      this.progressDisplay = document.getElementById('progress-display');
    }

    setupMediaPlayer() {
      this.player = new MediaPlayer(this.mediaElement);

      this.player.on('timeupdate', (time) => {
        this.handleTimeUpdate(time);
      });

      this.player.on('play', () => {
        this.playPauseBtn.innerHTML = '&#10074;&#10074;'; // Pause icon
        this.playPauseBtn.setAttribute('aria-label', 'Pause');
      });

      this.player.on('pause', () => {
        this.playPauseBtn.innerHTML = '&#9654;'; // Play icon
        this.playPauseBtn.setAttribute('aria-label', 'Play');
      });

      this.player.on('ready', (duration) => {
        this.durationEl.textContent = formatTime(duration);
      });

      this.player.on('error', (e) => {
        console.error('Media error:', e);
        this.showError('Failed to load media. Please refresh the page.');
      });
    }

    setupTranscript() {
      const segments = this.lesson.content?.transcript?.segments || [];
      this.transcript = new TranscriptViewer(this.transcriptContainer, segments);

      this.transcript.on('seek', (time) => {
        this.player.seek(time);
      });
    }

    setupQuestions() {
      const questions = this.lesson.content?.questions || {};
      this.questionManager = new QuestionManager(questions, this.storage);

      this.questionManager.on('answer', (data) => {
        this.updateProgress();
      });

      // Show pre-questions on load
      this.showPhaseQuestions('pre');
      this.updateProgress();
    }

    setupVocabulary() {
      const vocabulary = this.lesson.content?.vocabulary || {};
      this.vocabulary = new VocabularyViewer(this.vocabContainer, vocabulary);
    }

    setupControls() {
      // Play/Pause button
      this.playPauseBtn.addEventListener('click', () => {
        this.player.togglePlay();
      });

      // Progress bar
      this.progressBar.addEventListener('click', (e) => {
        const rect = this.progressBar.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        this.player.seek(pos * this.player.duration);
      });

      // Speed control
      this.speedSelect.addEventListener('change', (e) => {
        this.player.setPlaybackRate(parseFloat(e.target.value));
        this.storage.set('playbackRate', e.target.value);
      });

      // Skip buttons
      const skipBackBtn = document.getElementById('skip-back-btn');
      const skipForwardBtn = document.getElementById('skip-forward-btn');

      if (skipBackBtn) {
        skipBackBtn.addEventListener('click', () => this.player.skip(-10));
      }

      if (skipForwardBtn) {
        skipForwardBtn.addEventListener('click', () => this.player.skip(10));
      }

      // Reset progress button
      const resetBtn = document.getElementById('reset-progress-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          if (confirm('Reset all progress? This cannot be undone.')) {
            this.questionManager.resetProgress();
            this.storage.clear();
            this.updateProgress();
            this.showPhaseQuestions('pre');
          }
        });
      }

      // Tab switching
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const tab = e.target.dataset.tab;
          this.switchTab(tab);
        });
      });
    }

    setupKeyboardShortcuts() {
      document.addEventListener('keydown', (e) => {
        // Ignore if typing in input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
          return;
        }

        switch(e.key) {
          case ' ':
            e.preventDefault();
            this.player.togglePlay();
            break;
          case 'ArrowLeft':
            e.preventDefault();
            this.player.skip(-5);
            break;
          case 'ArrowRight':
            e.preventDefault();
            this.player.skip(5);
            break;
          case 'ArrowUp':
            e.preventDefault();
            const currentRate = this.player.playbackRate;
            this.player.setPlaybackRate(Math.min(2.0, currentRate + 0.25));
            this.speedSelect.value = this.player.playbackRate;
            break;
          case 'ArrowDown':
            e.preventDefault();
            const rate = this.player.playbackRate;
            this.player.setPlaybackRate(Math.max(0.5, rate - 0.25));
            this.speedSelect.value = this.player.playbackRate;
            break;
        }
      });
    }

    handleTimeUpdate(time) {
      // Update progress bar
      const progress = (time / this.player.duration) * 100;
      this.progressFill.style.width = `${progress}%`;
      this.currentTimeEl.textContent = formatTime(time);

      // Update active transcript segment
      if (this.transcript) {
        this.transcript.setActiveSegment(time);
      }

      // Check for questions at this timestamp
      const question = this.questionManager.getQuestionAtTime(time);
      if (question && !this.questionManager.answers[question.id]) {
        this.player.pause();
        this.showQuestion(question);
      }

      // Save current time periodically
      this.saveStateDebounced();
    }

    showQuestion(question) {
      this.questionContainer.innerHTML = '';
      this.questionContainer.style.display = 'block';

      const card = document.createElement('div');
      card.className = 'question-card';

      const titleEl = document.createElement('h3');
      titleEl.textContent = question.questionAr || question.questionEn || 'Question';

      const subtitleEl = document.createElement('p');
      subtitleEl.className = 'question-subtitle';
      subtitleEl.textContent = question.questionEn || '';

      card.appendChild(titleEl);
      if (subtitleEl.textContent) card.appendChild(subtitleEl);

      // Render based on question format
      if (question.format === 'multiple_choice' && question.options) {
        question.options.forEach((option, i) => {
          const btn = document.createElement('button');
          btn.className = 'option-btn';
          btn.textContent = option;
          btn.addEventListener('click', () => {
            this.handleAnswer(question.id, option, btn);
          });
          card.appendChild(btn);
        });
      } else if (question.format === 'fill_blank') {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'answer-input';
        input.placeholder = 'Type your answer...';

        const submitBtn = document.createElement('button');
        submitBtn.className = 'submit-btn';
        submitBtn.textContent = 'Submit';
        submitBtn.addEventListener('click', () => {
          this.handleAnswer(question.id, input.value, submitBtn);
        });

        card.appendChild(input);
        card.appendChild(submitBtn);

        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            submitBtn.click();
          }
        });
      } else {
        const textarea = document.createElement('textarea');
        textarea.className = 'answer-textarea';
        textarea.placeholder = 'Type your answer...';

        const submitBtn = document.createElement('button');
        submitBtn.className = 'submit-btn';
        submitBtn.textContent = 'Submit';
        submitBtn.addEventListener('click', () => {
          this.handleAnswer(question.id, textarea.value, submitBtn);
        });

        card.appendChild(textarea);
        card.appendChild(submitBtn);
      }

      this.questionContainer.appendChild(card);
    }

    handleAnswer(questionId, answer, buttonEl) {
      const result = this.questionManager.submitAnswer(questionId, answer);

      // Show feedback
      const feedback = document.createElement('div');
      feedback.className = 'answer-feedback';

      if (result.correct === true) {
        feedback.innerHTML = '<span class="correct">✓ Correct!</span>';
        feedback.classList.add('correct');
      } else if (result.correct === false) {
        feedback.innerHTML = '<span class="incorrect">✗ Incorrect</span>';
        feedback.classList.add('incorrect');
      } else {
        feedback.innerHTML = '<span class="submitted">✓ Answer submitted</span>';
      }

      buttonEl.parentElement.appendChild(feedback);

      // Hide question after 2 seconds
      setTimeout(() => {
        this.questionContainer.style.display = 'none';
        this.player.play();
      }, 2000);
    }

    showPhaseQuestions(phase) {
      const questions = this.lesson.content?.questions?.[phase] || [];

      if (questions.length === 0) return;

      this.questionContainer.innerHTML = '';
      this.questionContainer.style.display = 'block';

      const header = document.createElement('h2');
      header.textContent = phase === 'pre' ? 'Pre-Listening Questions' :
                          phase === 'post' ? 'Post-Listening Questions' :
                          'Questions';
      this.questionContainer.appendChild(header);

      questions.forEach((q, i) => {
        const questionId = `${phase}_${i}`;
        const answered = this.questionManager.answers[questionId];

        const card = document.createElement('div');
        card.className = 'question-card';
        if (answered) card.classList.add('answered');

        this.showQuestion({ ...q, phase, index: i, id: questionId });
      });
    }

    updateProgress() {
      const progress = this.questionManager.getProgress();

      if (this.progressDisplay) {
        this.progressDisplay.innerHTML = `
          <div class="progress-stats">
            <span>Progress: ${progress.answered}/${progress.total} (${progress.percentage.toFixed(0)}%)</span>
            ${progress.answered > 0 ? `<span>Score: ${progress.score.toFixed(0)}%</span>` : ''}
          </div>
        `;
      }
    }

    switchTab(tabName) {
      // Update tab buttons
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });

      // Update tab content
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
      });

      this.storage.set('activeTab', tabName);
    }

    loadState() {
      // Load saved playback rate
      const savedRate = this.storage.get('playbackRate', 1.0);
      this.player.setPlaybackRate(parseFloat(savedRate));
      this.speedSelect.value = savedRate;

      // Load saved tab
      const savedTab = this.storage.get('activeTab', 'transcript');
      this.switchTab(savedTab);

      // Load saved time (optional - can be commented out if not desired)
      // const savedTime = this.storage.get('currentTime', 0);
      // if (savedTime > 0) {
      //   this.player.seek(savedTime);
      // }
    }

    saveState() {
      this.storage.set('currentTime', this.player.currentTime);
    }

    saveStateDebounced = debounce(() => this.saveState(), 2000);

    showError(message) {
      const errorEl = document.createElement('div');
      errorEl.className = 'error-message';
      errorEl.textContent = message;
      document.body.appendChild(errorEl);

      setTimeout(() => {
        errorEl.remove();
      }, 5000);
    }
  }

  // ============================================================================
  // INITIALIZE ON LOAD
  // ============================================================================

  window.TanaghumPlayer = LessonPlayerApp;

  // Auto-initialize if lesson data is present
  if (window.LESSON_DATA) {
    document.addEventListener('DOMContentLoaded', () => {
      new LessonPlayerApp(window.LESSON_DATA);
    });
  }

})();
