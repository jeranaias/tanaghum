/**
 * Tanaghum Quiz Panel
 * Handles pre/while/post listening comprehension questions
 */

import { EventBus, Events } from '../core/event-bus.js';
import { createLogger, escapeHtml } from '../core/utils.js';

const log = createLogger('QuizPanel');

/**
 * Quiz Panel class
 */
class QuizPanel {
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    this.questions = { pre: [], while: [], post: [] };
    this.answers = {};
    this.currentPhase = 'pre';
    this.currentIndex = 0;
    this.showFeedback = options.showFeedback ?? true;
    this.onAnswer = options.onAnswer || (() => {});
    this.onComplete = options.onComplete || (() => {});
  }

  /**
   * Load questions
   * @param {Object} questions - Questions by phase
   */
  load(questions) {
    // Ensure we have arrays for each phase, handling undefined/null gracefully
    const q = questions || {};
    this.questions = {
      pre: Array.isArray(q.pre) ? q.pre : [],
      while: Array.isArray(q.while) ? q.while : [],
      post: Array.isArray(q.post) ? q.post : []
    };
    this.answers = {};
    this.currentPhase = 'pre';
    this.currentIndex = 0;

    log.log('Loaded questions:', {
      pre: this.questions.pre.length,
      while: this.questions.while.length,
      post: this.questions.post.length
    });
  }

  /**
   * Show pre-listening questions
   */
  showPreQuestions() {
    this.currentPhase = 'pre';
    this.currentIndex = 0;
    this.renderPhase();
  }

  /**
   * Show while-listening questions
   */
  showWhileQuestions() {
    this.currentPhase = 'while';
    this.currentIndex = 0;
    this.renderPhase();
  }

  /**
   * Show post-listening questions
   */
  showPostQuestions() {
    this.currentPhase = 'post';
    this.currentIndex = 0;
    this.renderPhase();
  }

  /**
   * Render current phase questions
   */
  renderPhase() {
    if (!this.container) return;

    const questions = this.questions[this.currentPhase] || [];

    // Show empty state if no questions
    const questionsHtml = questions.length > 0
      ? questions.map((q, i) => this.renderQuestion(q, i)).join('')
      : '<div class="quiz-empty" style="padding: 2rem; text-align: center; color: #666;">No questions available for this phase.</div>';

    this.container.innerHTML = `
      <div class="quiz-header">
        <h3 class="quiz-phase-title">${this.getPhaseTitle()}</h3>
        <div class="quiz-progress">
          <span>${this.getAnsweredCount()}/${questions.length}</span>
        </div>
      </div>
      <div class="quiz-questions">
        ${questionsHtml}
      </div>
    `;

    // Add event listeners
    this.attachEventListeners();
  }

  /**
   * Render a single question
   * @param {Object} question - Question object
   * @param {number} index - Question index
   * @returns {string} HTML
   */
  renderQuestion(question, index) {
    const questionId = question.id || `${this.currentPhase}-${index}`;
    const answer = this.answers[questionId];
    const isAnswered = answer !== undefined;

    // Escape question text to prevent XSS
    const questionTextAr = escapeHtml(question.question_text?.ar || question.questionAr || '');
    const questionTextEn = escapeHtml(question.question_text?.en || question.questionEn || '');

    let inputHtml = '';

    switch (question.type || question.format) {
      case 'multiple_choice':
        inputHtml = this.renderMultipleChoice(question, questionId, answer);
        break;

      case 'true_false':
        inputHtml = this.renderTrueFalse(question, questionId, answer);
        break;

      case 'fill_blank':
        inputHtml = this.renderFillBlank(question, questionId, answer);
        break;

      case 'open_ended':
      default:
        inputHtml = this.renderOpenEnded(question, questionId, answer);
        break;
    }

    const feedbackHtml = isAnswered && this.showFeedback
      ? this.renderFeedback(question, answer)
      : '';

    return `
      <div class="quiz-question${isAnswered ? ' answered' : ''}" data-question-id="${questionId}">
        <div class="question-number">${index + 1}</div>
        <div class="question-body">
          <div class="question-text">
            <div class="question-arabic" dir="rtl">${questionTextAr}</div>
            <div class="question-english">${questionTextEn}</div>
          </div>
          <div class="question-input">
            ${inputHtml}
          </div>
          ${feedbackHtml}
        </div>
      </div>
    `;
  }

  /**
   * Render multiple choice options
   */
  renderMultipleChoice(question, questionId, answer) {
    const options = question.options || [];

    return `
      <div class="options-list">
        ${options.map((opt, i) => {
          const optValue = typeof opt === 'string' ? opt : (opt.text || opt.ar || opt);
          const escapedOptValue = escapeHtml(optValue);
          const isSelected = answer === i || answer === optValue;
          const isCorrect = question.correct_answer === i || question.correct_answer === optValue;
          const showResult = answer !== undefined && this.showFeedback;

          let optClass = 'option-btn';
          if (isSelected) optClass += ' selected';
          if (showResult && isCorrect) optClass += ' correct';
          if (showResult && isSelected && !isCorrect) optClass += ' incorrect';

          return `
            <button class="${optClass}" data-value="${i}" ${answer !== undefined ? 'disabled' : ''}>
              <span class="option-letter">${String.fromCharCode(65 + i)}</span>
              <span class="option-text">${escapedOptValue}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  /**
   * Render true/false options
   */
  renderTrueFalse(question, questionId, answer) {
    const options = [
      { value: true, labelAr: 'صح', labelEn: 'True' },
      { value: false, labelAr: 'خطأ', labelEn: 'False' }
    ];

    return `
      <div class="options-list true-false">
        ${options.map(opt => {
          const isSelected = answer === opt.value;
          const isCorrect = question.correct_answer === opt.value;
          const showResult = answer !== undefined && this.showFeedback;

          let optClass = 'option-btn';
          if (isSelected) optClass += ' selected';
          if (showResult && isCorrect) optClass += ' correct';
          if (showResult && isSelected && !isCorrect) optClass += ' incorrect';

          return `
            <button class="${optClass}" data-value="${opt.value}" ${answer !== undefined ? 'disabled' : ''}>
              <span class="option-text">${opt.labelAr} / ${opt.labelEn}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  /**
   * Render fill in the blank
   */
  renderFillBlank(question, questionId, answer) {
    const escapedAnswer = answer !== undefined ? escapeHtml(answer) : '';
    return `
      <div class="fill-blank">
        <input type="text" class="fill-blank-input"
               placeholder="اكتب الإجابة..."
               value="${escapedAnswer}"
               ${answer !== undefined ? 'disabled' : ''}
               dir="rtl">
        ${answer === undefined ? '<button class="btn btn-sm btn-primary submit-answer">Submit</button>' : ''}
      </div>
    `;
  }

  /**
   * Render open-ended question
   */
  renderOpenEnded(question, questionId, answer) {
    const escapedAnswer = answer !== undefined ? escapeHtml(answer) : '';
    return `
      <div class="open-ended">
        <textarea class="open-ended-input"
                  placeholder="اكتب إجابتك هنا..."
                  rows="3"
                  dir="rtl"
                  ${answer !== undefined ? 'disabled' : ''}>${escapedAnswer}</textarea>
        ${answer === undefined ? '<button class="btn btn-sm btn-primary submit-answer">Submit</button>' : ''}
      </div>
    `;
  }

  /**
   * Render feedback
   */
  renderFeedback(question, answer) {
    const isCorrect = this.checkAnswer(question, answer);
    const explanationAr = escapeHtml(question.explanation?.ar || question.explanation_ar || '');
    const explanationEn = escapeHtml(question.explanation?.en || question.explanation_en || '');

    return `
      <div class="question-feedback ${isCorrect ? 'correct' : 'incorrect'}">
        <div class="feedback-icon">${isCorrect ? '&#10003;' : '&#10007;'}</div>
        <div class="feedback-text">
          ${explanationAr ? `<div class="feedback-ar" dir="rtl">${explanationAr}</div>` : ''}
          ${explanationEn ? `<div class="feedback-en">${explanationEn}</div>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Check if answer is correct
   */
  checkAnswer(question, answer) {
    if (question.type === 'open_ended' || question.format === 'open_ended') {
      // Open-ended questions are always "correct" (subjective)
      return true;
    }

    // For fill_blank, normalize both answer and correct_answer for comparison
    if (question.type === 'fill_blank' || question.format === 'fill_blank') {
      const normalizedAnswer = String(answer || '').trim().toLowerCase();
      const correctAnswer = question.correct_answer;

      // Support multiple correct answers (array)
      if (Array.isArray(correctAnswer)) {
        return correctAnswer.some(ca =>
          String(ca || '').trim().toLowerCase() === normalizedAnswer
        );
      }
      return String(correctAnswer || '').trim().toLowerCase() === normalizedAnswer;
    }

    return answer === question.correct_answer;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Multiple choice / true-false buttons
    this.container?.querySelectorAll('.option-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const questionEl = btn.closest('.quiz-question');
        const questionId = questionEl.dataset.questionId;
        let value = btn.dataset.value;

        // Parse value
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (!isNaN(value)) value = parseInt(value);

        this.submitAnswer(questionId, value);
      });
    });

    // Submit buttons for fill-blank and open-ended
    this.container?.querySelectorAll('.submit-answer').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const questionEl = btn.closest('.quiz-question');
        const questionId = questionEl.dataset.questionId;
        const input = questionEl.querySelector('input, textarea');
        const value = input?.value?.trim();

        if (value) {
          this.submitAnswer(questionId, value);
        } else {
          // Provide visual feedback for empty submission
          input?.classList.add('error');
          setTimeout(() => input?.classList.remove('error'), 1000);
        }
      });
    });

    // Allow Enter key to submit fill-blank answers
    this.container?.querySelectorAll('.fill-blank-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const questionEl = input.closest('.quiz-question');
          const submitBtn = questionEl?.querySelector('.submit-answer');
          submitBtn?.click();
        }
      });
    });
  }

  /**
   * Submit an answer
   * @param {string} questionId - Question ID
   * @param {*} answer - Answer value
   */
  submitAnswer(questionId, answer) {
    this.answers[questionId] = answer;

    // Find the question - handle both custom IDs and generated phase-index format
    let question = null;

    // First try to find by custom ID
    for (const phase of ['pre', 'while', 'post']) {
      const found = this.questions[phase]?.find(q => q.id === questionId);
      if (found) {
        question = found;
        break;
      }
    }

    // Fall back to phase-index parsing for generated IDs
    if (!question) {
      const parts = questionId.split('-');
      if (parts.length >= 2) {
        const phase = parts.slice(0, -1).join('-'); // Handle phases like "pre", "while", "post"
        const index = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(index) && this.questions[phase]) {
          question = this.questions[phase][index];
        }
      }
    }

    const isCorrect = question ? this.checkAnswer(question, answer) : true;

    log.log(`Answer submitted: ${questionId} = ${answer} (${isCorrect ? 'correct' : 'incorrect'})`);

    // Callback
    this.onAnswer(questionId, answer, isCorrect);

    // Emit event
    EventBus.emit(Events.QUIZ_ANSWER_SUBMITTED, {
      questionId,
      answer,
      isCorrect,
      phase: this.currentPhase
    });

    // Re-render to show feedback
    this.renderPhase();

    // Check if phase is complete
    this.checkPhaseComplete();
  }

  /**
   * Check if current phase is complete
   */
  checkPhaseComplete() {
    const questions = this.questions[this.currentPhase] || [];
    const answeredCount = this.getAnsweredCount();

    if (answeredCount === questions.length && questions.length > 0) {
      log.log(`Phase ${this.currentPhase} complete`);

      EventBus.emit(Events.QUIZ_COMPLETED, {
        phase: this.currentPhase,
        answers: this.getPhaseAnswers()
      });

      this.onComplete(this.currentPhase, this.getPhaseAnswers());
    }
  }

  /**
   * Get answered count for current phase
   */
  getAnsweredCount() {
    return this.questions[this.currentPhase]?.filter((q, i) => {
      const questionId = q.id || `${this.currentPhase}-${i}`;
      return this.answers[questionId] !== undefined;
    }).length || 0;
  }

  /**
   * Get answers for current phase
   */
  getPhaseAnswers() {
    const answers = {};
    this.questions[this.currentPhase]?.forEach((q, i) => {
      const questionId = q.id || `${this.currentPhase}-${i}`;
      if (this.answers[questionId] !== undefined) {
        answers[questionId] = {
          answer: this.answers[questionId],
          correct: this.checkAnswer(q, this.answers[questionId])
        };
      }
    });
    return answers;
  }

  /**
   * Get phase title
   */
  getPhaseTitle() {
    const titles = {
      pre: 'Pre-Listening Questions | أسئلة ما قبل الاستماع',
      while: 'While-Listening Questions | أسئلة أثناء الاستماع',
      post: 'Post-Listening Questions | أسئلة ما بعد الاستماع'
    };
    return titles[this.currentPhase] || '';
  }

  /**
   * Get overall progress
   */
  getProgress() {
    const total = this.questions.pre.length +
                  this.questions.while.length +
                  this.questions.post.length;

    const answered = Object.keys(this.answers).length;

    return {
      answered,
      total,
      percentage: total > 0 ? (answered / total) * 100 : 0,
      byPhase: {
        pre: {
          answered: this.questions.pre.filter((q, i) =>
            this.answers[q.id || `pre-${i}`] !== undefined).length,
          total: this.questions.pre.length
        },
        while: {
          answered: this.questions.while.filter((q, i) =>
            this.answers[q.id || `while-${i}`] !== undefined).length,
          total: this.questions.while.length
        },
        post: {
          answered: this.questions.post.filter((q, i) =>
            this.answers[q.id || `post-${i}`] !== undefined).length,
          total: this.questions.post.length
        }
      }
    };
  }

  /**
   * Reset all answers
   */
  reset() {
    this.answers = {};
    this.currentIndex = 0;
    this.renderPhase();
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

export { QuizPanel };
