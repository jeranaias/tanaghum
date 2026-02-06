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

  // Count correct answers - handle various formats
  const correctCount = options.filter(o => {
    // Handle boolean is_correct
    if (typeof o.is_correct === 'boolean') return o.is_correct;
    // Handle truthy string values like "true"
    if (o.is_correct === 'true' || o.is_correct === 1) return true;
    return false;
  }).length;

  if (correctCount === 0) {
    errors.push('No correct answer marked');
  } else if (correctCount > 1) {
    errors.push('Multiple correct answers marked (should be exactly 1)');
  }

  // Check each option for required content
  options.forEach((opt, i) => {
    if (!opt) {
      errors.push(`Option ${i} is null or undefined`);
      return;
    }

    if (!opt.id) {
      warnings.push(`Option ${i} missing ID`);
    }

    // Check for Arabic text in various formats
    const hasArabicText = hasNonEmptyString(opt.text?.ar) ||
                          hasNonEmptyString(opt.text_ar) ||
                          (typeof opt.text === 'string' && hasNonEmptyString(opt.text));

    if (!hasArabicText) {
      errors.push(`Option ${i} missing Arabic text`);
    }
  });
}

/**
 * Validate true/false question
 */
function validateTrueFalse(question, errors, warnings) {
  // Accept boolean, or string "true"/"false", or numbers 0/1
  const answer = question.correct_answer;
  const isValidAnswer = typeof answer === 'boolean' ||
                        answer === 'true' || answer === 'false' ||
                        answer === 0 || answer === 1;

  if (!isValidAnswer) {
    errors.push('correct_answer must be true or false (got: ' + typeof answer + ')');
  }

  // Check justification in various formats
  const hasJustification = hasNonEmptyString(question.justification?.ar) ||
                           hasNonEmptyString(question.justification?.en) ||
                           hasNonEmptyString(question.justification_ar) ||
                           hasNonEmptyString(question.justification_en);

  if (!hasJustification) {
    warnings.push('Missing justification for true/false answer');
  }
}

/**
 * Validate fill in the blank question
 */
function validateFillBlank(question, errors, warnings) {
  const sentence = question.sentence_with_blank?.ar || question.sentence_ar || '';

  // Check for blank marker - allow various formats
  const hasBlankMarker = sentence.includes('___') ||
                         sentence.includes('____') ||
                         sentence.includes('_____') ||
                         sentence.includes('[blank]') ||
                         sentence.includes('[...]');

  if (sentence && !hasBlankMarker) {
    warnings.push('Sentence may be missing blank marker (___)');
  }

  const wordBank = question.word_bank;
  if (!Array.isArray(wordBank)) {
    errors.push('word_bank must be an array');
  } else {
    // Filter out empty/null values before validation
    const validWords = wordBank.filter(w => w !== null && w !== undefined && w !== '');

    if (validWords.length < 2) {
      errors.push('word_bank must have at least 2 valid options');
    }

    // Check correct_word exists - handle string matching carefully
    const correctWord = question.correct_word;
    if (correctWord) {
      const correctWordStr = String(correctWord).trim();
      const wordBankStrs = validWords.map(w => String(w).trim());

      if (!wordBankStrs.includes(correctWordStr)) {
        errors.push('correct_word not found in word_bank');
      }
    } else {
      errors.push('correct_word is missing');
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
 * Check if question has a field with meaningful content (handles nested paths)
 */
function hasField(obj, field) {
  if (!obj || typeof obj !== 'object') return false;

  if (field.includes('.')) {
    const parts = field.split('.');
    let current = obj;
    for (const part of parts) {
      if (!current || current[part] === undefined || current[part] === null) return false;
      current = current[part];
    }
    // Check if final value is meaningful (not empty string)
    return current !== '' && current !== undefined && current !== null;
  }

  // Check direct field with meaningful value
  if (obj[field] !== undefined && obj[field] !== null && obj[field] !== '') {
    // If it's an object, check if it has meaningful content
    if (typeof obj[field] === 'object' && !Array.isArray(obj[field])) {
      // For bilingual objects, at least one language should have content
      if ('ar' in obj[field] || 'en' in obj[field]) {
        return hasNonEmptyString(obj[field].ar) || hasNonEmptyString(obj[field].en);
      }
      // For other objects, check they're not empty
      return Object.keys(obj[field]).length > 0;
    }
    return true;
  }

  // Check for _ar/_en suffixed versions - at least one must be non-empty
  const hasAr = hasNonEmptyString(obj[`${field}_ar`]);
  const hasEn = hasNonEmptyString(obj[`${field}_en`]);
  if (hasAr || hasEn) return true;

  // Check for nested object with ar/en
  if (obj[field] && typeof obj[field] === 'object') {
    return hasNonEmptyString(obj[field].ar) || hasNonEmptyString(obj[field].en);
  }

  return false;
}

/**
 * Check if value is a non-empty string
 */
function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
