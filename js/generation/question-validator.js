/**
 * Tanaghum Question Validator
 * Validates and sanitizes generated questions for quality and completeness
 */

import { createLogger } from '../core/utils.js';

const log = createLogger('QuestionValidator');

/**
 * Required fields by question type
 */
const REQUIRED_FIELDS = {
  multiple_choice: ['question_text', 'options', 'explanation'],
  true_false: ['question_text', 'correct_answer', 'explanation'],
  fill_blank: ['question_text', 'sentence_with_blank', 'word_bank', 'correct_word', 'explanation'],
  open_ended: ['question_text', 'rubric', 'explanation']
};

/**
 * Valid skills by phase
 */
const VALID_SKILLS = {
  pre: ['prediction', 'schema_activation', 'vocabulary_preview'],
  while: ['main_idea', 'details', 'sequence', 'inference', 'cause_effect'],
  post: ['vocabulary_in_context', 'speaker_attitude', 'synthesis', 'evaluation', 'comparison']
};

/**
 * Validate a single question
 * @param {Object} question - Question to validate
 * @param {string} phase - Question phase (pre, while, post)
 * @returns {Object} Validation result with isValid, errors, warnings
 */
export function validateQuestion(question, phase = 'while') {
  const errors = [];
  const warnings = [];

  // Check required base fields
  if (!question.id) {
    errors.push('Missing question ID');
  }

  if (!question.type || !REQUIRED_FIELDS[question.type]) {
    errors.push(`Invalid or missing question type: ${question.type}`);
    return { isValid: false, errors, warnings, question };
  }

  // Check type-specific required fields
  const required = REQUIRED_FIELDS[question.type];
  for (const field of required) {
    if (!hasField(question, field)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate question_text has both languages
  if (question.question_text) {
    if (!question.question_text.ar) {
      errors.push('Missing Arabic question text');
    }
    if (!question.question_text.en) {
      warnings.push('Missing English question text');
    }
  }

  // Type-specific validation
  switch (question.type) {
    case 'multiple_choice':
      validateMultipleChoice(question, errors, warnings);
      break;
    case 'true_false':
      validateTrueFalse(question, errors, warnings);
      break;
    case 'fill_blank':
      validateFillBlank(question, errors, warnings);
      break;
    case 'open_ended':
      validateOpenEnded(question, errors, warnings);
      break;
  }

  // Validate skill
  if (question.skill) {
    const validSkills = VALID_SKILLS[phase] || [];
    if (!validSkills.includes(question.skill)) {
      warnings.push(`Skill "${question.skill}" may not be appropriate for ${phase}-listening`);
    }
  } else {
    warnings.push('Missing skill classification');
  }

  // Validate timestamp for while-listening
  if (phase === 'while') {
    if (question.timestamp_percent === undefined) {
      warnings.push('Missing timestamp_percent for while-listening question');
    } else if (question.timestamp_percent < 0 || question.timestamp_percent > 1) {
      errors.push('timestamp_percent must be between 0 and 1');
    }
  }

  // Validate explanation
  if (question.explanation) {
    if (!question.explanation.ar && !question.explanation.en) {
      warnings.push('Explanation is empty');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    question
  };
}

/**
 * Validate multiple choice question
 */
function validateMultipleChoice(question, errors, warnings) {
  const options = question.options;

  if (!Array.isArray(options)) {
    errors.push('Options must be an array');
    return;
  }

  if (options.length < 2) {
    errors.push('Multiple choice must have at least 2 options');
  } else if (options.length !== 4) {
    warnings.push(`Expected 4 options, got ${options.length}`);
  }

  const correctCount = options.filter(o => o.is_correct).length;
  if (correctCount === 0) {
    errors.push('No correct answer marked');
  } else if (correctCount > 1) {
    errors.push('Multiple correct answers marked (should be exactly 1)');
  }

  // Check each option
  options.forEach((opt, i) => {
    if (!opt.id) {
      warnings.push(`Option ${i} missing ID`);
    }
    if (!opt.text?.ar && !opt.text_ar) {
      errors.push(`Option ${i} missing Arabic text`);
    }
  });
}

/**
 * Validate true/false question
 */
function validateTrueFalse(question, errors, warnings) {
  if (typeof question.correct_answer !== 'boolean') {
    errors.push('correct_answer must be true or false');
  }

  if (!question.justification?.ar && !question.justification_ar) {
    warnings.push('Missing justification for true/false answer');
  }
}

/**
 * Validate fill in the blank question
 */
function validateFillBlank(question, errors, warnings) {
  const sentence = question.sentence_with_blank?.ar || question.sentence_ar;

  if (sentence && !sentence.includes('___') && !sentence.includes('____')) {
    warnings.push('Sentence may be missing blank marker (_____)');
  }

  const wordBank = question.word_bank;
  if (!Array.isArray(wordBank)) {
    errors.push('word_bank must be an array');
  } else {
    if (wordBank.length < 2) {
      errors.push('word_bank must have at least 2 options');
    }
    if (!wordBank.includes(question.correct_word)) {
      errors.push('correct_word not found in word_bank');
    }
  }
}

/**
 * Validate open-ended question
 */
function validateOpenEnded(question, errors, warnings) {
  const rubric = question.rubric;

  if (!Array.isArray(rubric)) {
    errors.push('rubric must be an array of criteria');
  } else if (rubric.length === 0) {
    errors.push('rubric cannot be empty');
  }

  if (!question.sample_response?.ar && !question.sample_response_ar) {
    warnings.push('Missing sample response');
  }
}

/**
 * Check if question has a field (handles nested paths)
 */
function hasField(obj, field) {
  if (field.includes('.')) {
    const parts = field.split('.');
    let current = obj;
    for (const part of parts) {
      if (!current || !current[part]) return false;
      current = current[part];
    }
    return true;
  }

  // Check both nested and flat versions
  if (obj[field]) return true;

  // Check for _ar/_en suffixed versions
  if (obj[`${field}_ar`] || obj[`${field}_en`]) return true;

  // Check for nested object with ar/en
  if (obj[field]?.ar || obj[field]?.en) return true;

  return false;
}

/**
 * Validate a set of questions
 * @param {Array} questions - Array of questions
 * @param {string} phase - Question phase
 * @returns {Object} Validation results
 */
export function validateQuestionSet(questions, phase = 'while') {
  if (!Array.isArray(questions)) {
    return {
      isValid: false,
      validQuestions: [],
      invalidQuestions: [],
      errors: ['Questions must be an array'],
      warnings: [],
      stats: { total: 0, valid: 0, invalid: 0 }
    };
  }

  const results = questions.map(q => validateQuestion(q, phase));
  const validQuestions = results.filter(r => r.isValid).map(r => r.question);
  const invalidQuestions = results.filter(r => !r.isValid);

  const allErrors = results.flatMap(r => r.errors);
  const allWarnings = results.flatMap(r => r.warnings);

  return {
    isValid: invalidQuestions.length === 0,
    validQuestions,
    invalidQuestions,
    errors: allErrors,
    warnings: allWarnings,
    stats: {
      total: questions.length,
      valid: validQuestions.length,
      invalid: invalidQuestions.length
    }
  };
}

/**
 * Sanitize and fix common issues in a question
 * @param {Object} question - Question to sanitize
 * @param {string} phase - Question phase
 * @returns {Object} Sanitized question
 */
export function sanitizeQuestion(question, phase = 'while') {
  const sanitized = { ...question };

  // Ensure ID exists
  if (!sanitized.id) {
    sanitized.id = `${phase}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Normalize question_text
  if (!sanitized.question_text) {
    sanitized.question_text = {
      ar: sanitized.question_ar || '',
      en: sanitized.question_en || ''
    };
  }

  // Normalize explanation
  if (!sanitized.explanation) {
    sanitized.explanation = {
      ar: sanitized.explanation_ar || '',
      en: sanitized.explanation_en || ''
    };
  }

  // Set timing
  sanitized.timing = phase;

  // Type-specific sanitization
  switch (sanitized.type) {
    case 'multiple_choice':
      sanitized.options = sanitizeOptions(sanitized.options || []);
      break;

    case 'true_false':
      sanitized.correct_answer = Boolean(sanitized.correct_answer);
      if (!sanitized.justification) {
        sanitized.justification = {
          ar: sanitized.justification_ar || '',
          en: sanitized.justification_en || ''
        };
      }
      break;

    case 'fill_blank':
      if (!sanitized.sentence_with_blank) {
        sanitized.sentence_with_blank = {
          ar: sanitized.sentence_ar || '',
          en: sanitized.sentence_en || ''
        };
      }
      if (!Array.isArray(sanitized.word_bank)) {
        sanitized.word_bank = [];
      }
      break;

    case 'open_ended':
      if (!Array.isArray(sanitized.rubric)) {
        sanitized.rubric = sanitized.rubric ? [sanitized.rubric] : [];
      }
      if (!sanitized.sample_response) {
        sanitized.sample_response = {
          ar: sanitized.sample_response_ar || '',
          en: sanitized.sample_response_en || ''
        };
      }
      break;
  }

  // Default timestamp for while-listening
  if (phase === 'while' && sanitized.timestamp_percent === undefined) {
    sanitized.timestamp_percent = 0.5;
  }

  return sanitized;
}

/**
 * Sanitize multiple choice options
 */
function sanitizeOptions(options) {
  if (!Array.isArray(options)) return [];

  const labels = ['a', 'b', 'c', 'd'];

  return options.map((opt, i) => ({
    id: opt.id || labels[i] || String(i + 1),
    text: {
      ar: opt.text?.ar || opt.text_ar || opt.text || '',
      en: opt.text?.en || opt.text_en || ''
    },
    is_correct: Boolean(opt.is_correct)
  }));
}

/**
 * Validate and sanitize an entire question set
 */
export function processQuestions(questions, phase = 'while') {
  if (!Array.isArray(questions)) {
    log.warn('Questions is not an array, returning empty');
    return [];
  }

  return questions
    .map(q => sanitizeQuestion(q, phase))
    .filter(q => {
      const result = validateQuestion(q, phase);
      if (!result.isValid) {
        log.warn(`Dropping invalid question: ${result.errors.join(', ')}`);
      }
      return result.isValid;
    });
}

export const QuestionValidator = {
  validate: validateQuestion,
  validateSet: validateQuestionSet,
  sanitize: sanitizeQuestion,
  process: processQuestions
};
