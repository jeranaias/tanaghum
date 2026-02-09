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
    constructor(containerElement, segments, words) {
      super();
      this.container = containerElement;
      this.segments = segments || [];
      this.words = words || []; // Word-level data for per-word confidence coloring
      this.activeIndex = -1;
      this.render();
    }

    /**
     * Get confidence color class based on confidence value
     * Green (high) -> Yellow (medium) -> Red (low)
     */
    getConfidenceClass(confidence) {
      if (confidence >= 0.9) return 'conf-high';
      if (confidence >= 0.7) return 'conf-medium';
      if (confidence >= 0.5) return 'conf-low';
      return 'conf-very-low';
    }

    /**
     * Render words within a segment with per-word confidence coloring
     */
    renderSegmentWords(segment) {
      // If segment has words array, use it for per-word confidence
      if (segment.words && segment.words.length > 0) {
        return segment.words.map(word => {
          const confClass = this.getConfidenceClass(word.confidence);
          const confPercent = Math.round(word.confidence * 100);
          return `<span class="word ${confClass}" title="Confidence: ${confPercent}%" data-start="${word.start}">${word.text}</span>`;
        }).join(' ');
      }

      // Fallback: try to match segment text with global words array
      if (this.words.length > 0) {
        const segmentWords = this.words.filter(w =>
          w.start >= segment.start && w.end <= (segment.end || segment.start + 10)
        );
        if (segmentWords.length > 0) {
          return segmentWords.map(word => {
            const confClass = this.getConfidenceClass(word.confidence);
            const confPercent = Math.round(word.confidence * 100);
            return `<span class="word ${confClass}" title="Confidence: ${confPercent}%" data-start="${word.start}">${word.text}</span>`;
          }).join(' ');
        }
      }

      // Final fallback: just display segment text with segment-level confidence
      const confClass = this.getConfidenceClass(segment.confidence || 0.8);
      return `<span class="word ${confClass}">${segment.text}</span>`;
    }

    render() {
      this.container.innerHTML = '';

      // Add confidence legend
      const legendHtml = `
        <div class="confidence-legend">
          <span class="legend-label">Confidence:</span>
          <span class="legend-item conf-high">High</span>
          <span class="legend-item conf-medium">Medium</span>
          <span class="legend-item conf-low">Low</span>
          <span class="legend-item conf-very-low">Uncertain</span>
        </div>
      `;
      this.container.insertAdjacentHTML('beforeend', legendHtml);

      if (this.segments.length === 0) {
        this.container.innerHTML += '<p class="no-transcript">No transcript available</p>';
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
        // Use per-word confidence coloring
        textEl.innerHTML = this.renderSegmentWords(segment);

        segmentEl.appendChild(timeEl);
        segmentEl.appendChild(textEl);

        segmentEl.addEventListener('click', () => {
          this.emit('seek', parseFloat(segment.start));
        });

        // Make individual words clickable for seeking
        textEl.querySelectorAll('.word[data-start]').forEach(wordEl => {
          wordEl.style.cursor = 'pointer';
          wordEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.emit('seek', parseFloat(wordEl.dataset.start));
          });
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

    getQuestionAtTime(time, duration) {
      const whileQuestions = this.questions.while || [];

      for (let i = 0; i < whileQuestions.length; i++) {
        const q = whileQuestions[i];
        // Support both timestamp (absolute seconds) and timestamp_percent (0-1 ratio)
        let questionTime = q.timestamp;
        if (questionTime === undefined && q.timestamp_percent !== undefined && duration) {
          questionTime = q.timestamp_percent * duration;
        }
        if (questionTime !== undefined && Math.abs(time - questionTime) < 2) {
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

      // Support both old format (correctAnswer) and new format (correct_answer)
      const correctAnswer = question?.correctAnswer || question?.correct_answer;
      if (!question || !correctAnswer) {
        return null; // Cannot verify
      }

      // Support both old format (format) and new format (type)
      const questionType = question.format || question.type;

      if (questionType === 'multiple_choice') {
        // For object options, check if the selected option is correct
        if (question.options && question.options[0] && typeof question.options[0] === 'object') {
          const selectedOption = question.options.find(o => o.id === answer || o.text_ar === answer || o.text_en === answer);
          return selectedOption?.is_correct === true;
        }
        return answer === correctAnswer;
      } else if (questionType === 'true_false') {
        // Handle boolean comparison
        return answer === correctAnswer;
      } else if (questionType === 'fill_blank') {
        const normalized = String(answer).trim().toLowerCase();
        const correct = String(correctAnswer).toLowerCase();
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

        // Arabic word
        const arabicEl = document.createElement('div');
        arabicEl.className = 'vocab-arabic';
        arabicEl.textContent = item.word_ar || item.arabic || item.word || '';

        // Root and part of speech
        const metaEl = document.createElement('div');
        metaEl.className = 'vocab-translit';
        const root = item.root || '';
        const pos = item.pos || item.partOfSpeech || '';
        metaEl.textContent = [root, pos].filter(Boolean).join(' • ') || '';

        // English meaning/translation
        const meaningEl = document.createElement('div');
        meaningEl.className = 'vocab-meaning';
        meaningEl.textContent = item.word_en || item.definition_en || item.meaning || item.definition || '';

        vocabEl.appendChild(arabicEl);
        if (metaEl.textContent) vocabEl.appendChild(metaEl);
        if (meaningEl.textContent) vocabEl.appendChild(meaningEl);

        // Example sentence (if available)
        const exampleAr = item.example_ar || item.exampleAr || '';
        const exampleEn = item.example_en || item.exampleEn || '';
        if (exampleAr || exampleEn) {
          const exampleEl = document.createElement('div');
          exampleEl.className = 'vocab-example';
          exampleEl.style.cssText = 'margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color); font-size: 13px;';
          if (exampleAr) {
            const arEx = document.createElement('div');
            arEx.style.cssText = 'direction: rtl; text-align: right; color: var(--text-secondary);';
            arEx.textContent = '« ' + exampleAr + ' »';
            exampleEl.appendChild(arEx);
          }
          if (exampleEn) {
            const enEx = document.createElement('div');
            enEx.style.cssText = 'color: var(--text-tertiary); font-style: italic; margin-top: 4px;';
            enEx.textContent = exampleEn;
            exampleEl.appendChild(enEx);
          }
          vocabEl.appendChild(exampleEl);
        }

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
      const words = this.lesson.content?.transcript?.words || [];
      this.transcript = new TranscriptViewer(this.transcriptContainer, segments, words);

      this.transcript.on('seek', (time) => {
        this.player.seek(time);
      });
    }

    setupQuestions() {
      const questions = this.lesson.content?.questions || {};
      this.questionManager = new QuestionManager(questions, this.storage);

      this.questionManager.on('answer', (data) => {
        this.updateProgress();
        this.updateQuestionItem(data.questionId);
      });

      // Populate the Questions tab with all questions
      this.renderAllQuestions();
      this.updateProgress();
    }

    /**
     * Render all questions in the Questions tab
     */
    renderAllQuestions() {
      const questions = this.lesson.content?.questions || {};
      const phases = ['pre', 'while', 'post'];

      phases.forEach(phase => {
        const container = document.getElementById(`${phase}-questions-list`);
        const section = document.getElementById(`${phase}-questions-section`);
        const phaseQuestions = questions[phase] || [];

        if (!container) return;

        if (phaseQuestions.length === 0) {
          section.style.display = 'none';
          return;
        }

        container.innerHTML = phaseQuestions.map((q, i) => {
          const questionId = `${phase}_${i}`;
          const answered = this.questionManager.answers[questionId];

          // Get question text - support multiple formats
          const questionAr = q.question_text?.ar || q.question_ar || q.questionAr || '';
          const questionEn = q.question_text?.en || q.question_en || q.questionEn || '';
          const questionType = q.type || q.format || 'open_ended';

          let optionsHtml = '';
          if ((questionType === 'multiple_choice' || questionType === 'true_false') && q.options) {
            const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
            optionsHtml = `
              <div class="question-options">
                ${q.options.map((opt, j) => {
                  const optAr = typeof opt === 'object' ? (opt.text_ar || opt.text || '') : opt;
                  const optEn = typeof opt === 'object' ? (opt.text_en || '') : '';
                  const isCorrect = typeof opt === 'object' ? opt.is_correct : false;
                  const optionId = typeof opt === 'object' ? (opt.id || j) : j;

                  return `
                    <div class="question-option" data-question="${questionId}" data-option="${optionId}">
                      <span class="option-letter">${letters[j]}</span>
                      <div class="option-text">
                        <div class="option-text-ar">${optAr}</div>
                        ${optEn ? `<div class="option-text-en" style="font-size: 12px; color: var(--text-tertiary);">${optEn}</div>` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          } else if (questionType === 'true_false') {
            optionsHtml = `
              <div class="question-options">
                <div class="question-option" data-question="${questionId}" data-option="true">
                  <span class="option-letter">T</span>
                  <div class="option-text">True / صحيح</div>
                </div>
                <div class="question-option" data-question="${questionId}" data-option="false">
                  <span class="option-letter">F</span>
                  <div class="option-text">False / خطأ</div>
                </div>
              </div>
            `;
          }

          return `
            <div class="question-item ${answered ? 'answered' : ''}" data-id="${questionId}" data-type="${questionType}">
              <div class="question-header">
                <span class="question-number">${i + 1}</span>
                <div class="question-content">
                  <div class="question-text-ar">${questionAr}</div>
                  ${questionEn ? `<div class="question-text-en">${questionEn}</div>` : ''}
                </div>
              </div>
              <span class="question-type-badge">${questionType.replace(/_/g, ' ')}</span>
              ${optionsHtml}
            </div>
          `;
        }).join('');

        // Add click handlers for options
        container.querySelectorAll('.question-option').forEach(opt => {
          opt.addEventListener('click', () => {
            const questionId = opt.dataset.question;
            const optionValue = opt.dataset.option;

            // Visual selection
            const parent = opt.closest('.question-item');
            parent.querySelectorAll('.question-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');

            // Submit answer
            const result = this.questionManager.submitAnswer(questionId, optionValue);

            // Show result
            if (result.correct === true) {
              opt.classList.add('correct');
              parent.classList.add('answered');
            } else if (result.correct === false) {
              opt.classList.add('wrong');
              // Show correct answer
              const correctOpt = parent.querySelector('.question-option[data-option="' + this.getCorrectAnswer(questionId) + '"]');
              if (correctOpt) correctOpt.classList.add('correct');
              parent.classList.add('answered', 'incorrect');
            } else {
              parent.classList.add('answered');
            }
          });
        });
      });
    }

    getCorrectAnswer(questionId) {
      const question = this.questionManager.getAllQuestions().find(q => q.id === questionId);
      if (!question) return null;

      // Check if options have is_correct flag
      if (question.options) {
        const correctIdx = question.options.findIndex(o => typeof o === 'object' && o.is_correct);
        if (correctIdx >= 0) return question.options[correctIdx].id || correctIdx;
      }

      return question.correct_answer || question.correctAnswer;
    }

    updateQuestionItem(questionId) {
      const item = document.querySelector(`.question-item[data-id="${questionId}"]`);
      if (item) {
        item.classList.add('answered');
      }
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
            this.renderAllQuestions(); // Re-render questions without answered state
          }
        });
      }

      // Print worksheet button
      const printBtn = document.getElementById('print-worksheet-btn');
      if (printBtn) {
        printBtn.addEventListener('click', () => {
          // Switch to questions tab before printing for better worksheet
          this.switchTab('questions');
          setTimeout(() => window.print(), 100);
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
      const question = this.questionManager.getQuestionAtTime(time, this.player.duration);
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

      // Support both old format (questionAr/questionEn) and new format (question_text.ar/en, question_ar/en)
      const questionAr = question.questionAr || question.question_text?.ar || question.question_ar || '';
      const questionEn = question.questionEn || question.question_text?.en || question.question_en || '';

      const titleEl = document.createElement('h3');
      titleEl.textContent = questionAr || questionEn || 'Question';

      const subtitleEl = document.createElement('p');
      subtitleEl.className = 'question-subtitle';
      subtitleEl.textContent = questionEn || '';

      card.appendChild(titleEl);
      if (subtitleEl.textContent && questionAr) card.appendChild(subtitleEl);

      // Support both old format (format) and new format (type)
      const questionType = question.format || question.type;

      // Render based on question format
      if (questionType === 'multiple_choice' && question.options) {
        question.options.forEach((option, i) => {
          const btn = document.createElement('button');
          btn.className = 'option-btn';
          // Options can be objects with text_ar/text_en or simple strings
          const optionText = typeof option === 'object'
            ? (option.text_ar || option.text_en || option.text || '')
            : option;
          btn.textContent = optionText;
          btn.addEventListener('click', () => {
            // For object options, use the id or the object itself
            const answerValue = typeof option === 'object' ? (option.id || optionText) : option;
            this.handleAnswer(question.id, answerValue, btn);
          });
          card.appendChild(btn);
        });
      } else if (questionType === 'true_false') {
        // True/False buttons
        const trueBtn = document.createElement('button');
        trueBtn.className = 'option-btn';
        trueBtn.textContent = 'True / صحيح';
        trueBtn.addEventListener('click', () => {
          this.handleAnswer(question.id, true, trueBtn);
        });

        const falseBtn = document.createElement('button');
        falseBtn.className = 'option-btn';
        falseBtn.textContent = 'False / خطأ';
        falseBtn.addEventListener('click', () => {
          this.handleAnswer(question.id, false, falseBtn);
        });

        card.appendChild(trueBtn);
        card.appendChild(falseBtn);
      } else if (questionType === 'fill_blank') {
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
          <span>Questions: ${progress.answered}/${progress.total} (${progress.percentage.toFixed(0)}%)</span>
          ${progress.answered > 0 ? `<span>Score: ${progress.correct}/${progress.answered} correct (${progress.score.toFixed(0)}%)</span>` : ''}
        `;
      }

      // Update visual progress bar
      const progressBarFill = document.getElementById('progress-bar-fill');
      if (progressBarFill) {
        progressBarFill.style.width = `${progress.percentage}%`;
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
