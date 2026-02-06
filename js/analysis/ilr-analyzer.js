/**
 * Tanaghum ILR Analyzer
 * Analyzes Arabic text to determine ILR proficiency level
 */

import { Config } from '../core/config.js';
import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { createLogger } from '../core/utils.js';
import { llmClient } from '../generation/llm-client.js';

const log = createLogger('ILRAnalyzer');

// ILR Level definitions
const ILR_LEVELS = {
  '1.0': {
    name: 'Elementary Proficiency',
    nameAr: 'المستوى الابتدائي',
    description: 'Can understand basic phrases, simple questions, and formulaic expressions',
    indicators: [
      'Very simple vocabulary',
      'Present tense only',
      'Short sentences (3-5 words)',
      'Common everyday topics',
      'No idioms or colloquialisms'
    ]
  },
  '1.5': {
    name: 'Elementary Proficiency, Plus',
    nameAr: 'المستوى الابتدائي المتقدم',
    description: 'Can understand sentence-length utterances on familiar topics',
    indicators: [
      'Basic vocabulary with some variation',
      'Simple past and future tenses',
      'Compound sentences',
      'Personal and family topics',
      'Limited colloquial expressions'
    ]
  },
  '2.0': {
    name: 'Limited Working Proficiency',
    nameAr: 'الكفاءة المهنية المحدودة',
    description: 'Can understand main ideas in discourse on familiar topics',
    indicators: [
      'Moderate vocabulary range',
      'Various verb tenses and moods',
      'Complex sentence structures',
      'News, social, and practical topics',
      'Some idioms understood in context'
    ]
  },
  '2.5': {
    name: 'Limited Working Proficiency, Plus',
    nameAr: 'الكفاءة المهنية المحدودة المتقدمة',
    description: 'Can follow extended discourse on concrete topics',
    indicators: [
      'Good vocabulary including technical terms',
      'Subjunctive and conditional moods',
      'Extended arguments and narratives',
      'Professional and current event topics',
      'Idiomatic expressions understood'
    ]
  },
  '3.0': {
    name: 'General Professional Proficiency',
    nameAr: 'الكفاءة المهنية العامة',
    description: 'Can understand discourse on abstract and complex topics',
    indicators: [
      'Extensive vocabulary including specialized terms',
      'All grammatical structures',
      'Nuanced and layered arguments',
      'Political, economic, and cultural analysis',
      'Proverbs and cultural references'
    ]
  },
  '3.5': {
    name: 'General Professional Proficiency, Plus',
    nameAr: 'الكفاءة المهنية العامة المتقدمة',
    description: 'Can follow highly articulated speech with cultural nuances',
    indicators: [
      'Near-native vocabulary range',
      'Sophisticated rhetorical devices',
      'Implicit meanings and allusions',
      'Specialized professional discourse',
      'Full cultural and historical references'
    ]
  }
};

// Linguistic feature weights for scoring
const FEATURE_WEIGHTS = {
  vocabularyComplexity: 0.25,
  sentenceComplexity: 0.20,
  grammarComplexity: 0.20,
  topicAbstraction: 0.15,
  idiomaticUsage: 0.10,
  dialectMixing: 0.10
};

/**
 * ILR Analyzer class
 */
class ILRAnalyzer {
  constructor() {
    this.lastAnalysis = null;
  }

  /**
   * Analyze text for ILR level
   * @param {string} text - Arabic text to analyze
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Analysis results
   */
  async analyze(text, options = {}) {
    if (!text || text.trim().length < 20) {
      throw new Error('Text too short for meaningful analysis');
    }

    log.log('Starting ILR analysis...');
    const startTime = performance.now();

    EventBus.emit(Events.ANALYSIS_START, { textLength: text.length });

    try {
      // Perform local linguistic analysis first
      const linguisticFeatures = this.extractLinguisticFeatures(text);

      // Get LLM-based analysis for deeper insights
      const llmAnalysis = await this.getLLMAnalysis(text, options);

      // Combine analyses
      const combinedScore = this.calculateILRScore(linguisticFeatures, llmAnalysis);
      const ilrLevel = this.scoreToILRLevel(combinedScore);
      const levelInfo = ILR_LEVELS[ilrLevel];

      const result = {
        level: ilrLevel,
        levelName: levelInfo.name,
        levelNameAr: levelInfo.nameAr,
        description: levelInfo.description,
        score: combinedScore,
        confidence: llmAnalysis.confidence || 0.8,
        features: {
          ...linguisticFeatures,
          ...llmAnalysis.features
        },
        recommendations: this.generateRecommendations(ilrLevel, linguisticFeatures),
        statistics: {
          wordCount: linguisticFeatures.wordCount,
          uniqueWords: linguisticFeatures.uniqueWordCount,
          avgSentenceLength: linguisticFeatures.avgSentenceLength,
          vocabularyDiversity: linguisticFeatures.vocabularyDiversity
        },
        processingTime: (performance.now() - startTime) / 1000
      };

      // Cache result
      this.lastAnalysis = result;

      // Update state
      StateManager.set('analysis', result);

      EventBus.emit(Events.ANALYSIS_COMPLETE, result);

      log.log(`Analysis complete: ILR ${ilrLevel} (confidence: ${result.confidence.toFixed(2)})`);

      return result;

    } catch (error) {
      log.error('Analysis failed:', error);

      // Fall back to local-only analysis
      const linguisticFeatures = this.extractLinguisticFeatures(text);
      const score = this.calculateLocalScore(linguisticFeatures);
      const ilrLevel = this.scoreToILRLevel(score);
      const levelInfo = ILR_LEVELS[ilrLevel];

      const fallbackResult = {
        level: ilrLevel,
        levelName: levelInfo.name,
        levelNameAr: levelInfo.nameAr,
        description: levelInfo.description,
        score,
        confidence: 0.6,
        features: linguisticFeatures,
        recommendations: this.generateRecommendations(ilrLevel, linguisticFeatures),
        statistics: {
          wordCount: linguisticFeatures.wordCount,
          uniqueWords: linguisticFeatures.uniqueWordCount,
          avgSentenceLength: linguisticFeatures.avgSentenceLength,
          vocabularyDiversity: linguisticFeatures.vocabularyDiversity
        },
        fallback: true,
        error: error.message
      };

      this.lastAnalysis = fallbackResult;
      StateManager.set('analysis', fallbackResult);
      EventBus.emit(Events.ANALYSIS_COMPLETE, fallbackResult);

      return fallbackResult;
    }
  }

  /**
   * Extract linguistic features from text
   * @param {string} text - Arabic text
   * @returns {Object} Linguistic features
   */
  extractLinguisticFeatures(text) {
    // Guard against invalid input
    if (!text || typeof text !== 'string') {
      return {
        wordCount: 0,
        uniqueWordCount: 0,
        avgWordLength: 0,
        avgSentenceLength: 0,
        vocabularyDiversity: 0,
        vocabularyComplexity: 0,
        sentenceComplexity: 0,
        grammarComplexity: 0,
        hasDiacritics: false,
        hasNumbers: false,
        connectorCount: 0,
        subordinateCount: 0
      };
    }

    // Tokenize into words (Arabic-aware)
    const words = text.match(/[\u0600-\u06FF]+/g) || [];
    const sentences = text.split(/[.!?؟،,]/g).filter(s => s.trim().length > 0);

    const wordCount = words.length;
    const uniqueWords = new Set(words.map(w => this.normalizeArabic(w)));
    const uniqueWordCount = uniqueWords.size;

    // Calculate metrics with safe division
    const avgWordLength = wordCount > 0
      ? words.reduce((sum, w) => sum + w.length, 0) / wordCount
      : 0;
    const avgSentenceLength = sentences.length > 0
      ? wordCount / sentences.length
      : 0;
    const vocabularyDiversity = wordCount > 0
      ? uniqueWordCount / wordCount
      : 0;

    // Detect grammatical features
    const hasVerbForms = this.detectVerbComplexity(words);
    const hasDiacritics = /[\u064B-\u065F]/.test(text);
    const hasNumbers = /[\u0660-\u0669\d]/.test(text);

    // Detect common patterns
    const hasConnectors = this.countConnectors(text);
    const hasSubordinates = this.countSubordinateClauses(text);

    // Vocabulary complexity (longer words, less common patterns)
    const vocabularyComplexity = this.calculateVocabularyComplexity(words);

    // Sentence complexity
    const sentenceComplexity = Math.min(1, avgSentenceLength / 20);

    // Grammar complexity based on detected features
    const grammarComplexity = this.calculateGrammarComplexity(hasVerbForms, hasConnectors, hasSubordinates);

    return {
      wordCount,
      uniqueWordCount,
      avgWordLength,
      avgSentenceLength,
      vocabularyDiversity,
      vocabularyComplexity,
      sentenceComplexity,
      grammarComplexity,
      hasDiacritics,
      hasNumbers,
      connectorCount: hasConnectors,
      subordinateCount: hasSubordinates
    };
  }

  /**
   * Normalize Arabic text for comparison
   * @param {string} word - Arabic word
   * @returns {string} Normalized word
   */
  normalizeArabic(word) {
    return word
      .replace(/[\u064B-\u065F]/g, '') // Remove tashkeel
      .replace(/[إأآا]/g, 'ا')          // Normalize alef
      .replace(/ى/g, 'ي')              // Normalize ya
      .replace(/ة/g, 'ه');             // Normalize ta marbuta
  }

  /**
   * Detect verb complexity
   * @param {string[]} words - Array of words
   * @returns {Object} Verb complexity features
   */
  detectVerbComplexity(words) {
    // Common Arabic verb patterns
    const pastIndicators = /^[وفتأنيس]?[ًٌٍَُِّْ]?[\u0600-\u06FF]+[تناو]$/;
    const presentIndicators = /^[يتنأ][\u0600-\u06FF]+$/;
    const futureIndicators = /^س[يتنأ][\u0600-\u06FF]+$/;

    let past = 0, present = 0, future = 0;

    words.forEach(word => {
      if (pastIndicators.test(word)) past++;
      if (presentIndicators.test(word)) present++;
      if (futureIndicators.test(word)) future++;
    });

    return {
      past,
      present,
      future,
      variety: (past > 0 ? 1 : 0) + (present > 0 ? 1 : 0) + (future > 0 ? 1 : 0)
    };
  }

  /**
   * Count connector words
   * @param {string} text - Arabic text
   * @returns {number} Count of connectors
   */
  countConnectors(text) {
    if (!text || typeof text !== 'string') return 0;

    const connectors = [
      'و', 'ف', 'ثم', 'أو', 'لكن', 'بل', 'حتى', 'إذ', 'إذا', 'لأن',
      'كي', 'حيث', 'مع', 'عند', 'قبل', 'بعد', 'أن', 'إن', 'لعل', 'ليت'
    ];

    let count = 0;
    connectors.forEach(conn => {
      // Use Arabic-aware word boundary: whitespace or start/end of string
      // \b doesn't work correctly with Arabic script
      const regex = new RegExp(`(?:^|\\s)${conn}(?:\\s|$)`, 'g');
      const matches = text.match(regex);
      if (matches) count += matches.length;
    });

    return count;
  }

  /**
   * Count subordinate clause indicators
   * @param {string} text - Arabic text
   * @returns {number} Count
   */
  countSubordinateClauses(text) {
    if (!text || typeof text !== 'string') return 0;

    const subordinates = ['الذي', 'التي', 'الذين', 'اللواتي', 'اللتان', 'اللذان', 'ما', 'من', 'أين', 'متى', 'كيف', 'لماذا'];

    let count = 0;
    subordinates.forEach(sub => {
      // Use Arabic-aware word boundary: whitespace or start/end of string
      const regex = new RegExp(`(?:^|\\s)${sub}(?:\\s|$)`, 'g');
      const matches = text.match(regex);
      if (matches) count += matches.length;
    });

    return count;
  }

  /**
   * Calculate vocabulary complexity
   * @param {string[]} words - Array of words
   * @returns {number} Complexity score 0-1
   */
  calculateVocabularyComplexity(words) {
    if (!Array.isArray(words) || words.length === 0) return 0;

    // Filter out invalid entries
    const validWords = words.filter(w => typeof w === 'string' && w.length > 0);
    if (validWords.length === 0) return 0;

    // Longer words tend to be more complex
    const avgLength = validWords.reduce((sum, w) => sum + w.length, 0) / validWords.length;

    // Guard against NaN
    if (!Number.isFinite(avgLength)) return 0;

    // Normalize to 0-1 scale (words 3-10 chars)
    return Math.min(1, Math.max(0, (avgLength - 3) / 7));
  }

  /**
   * Calculate grammar complexity score
   * @param {Object} verbForms - Verb form counts
   * @param {number} connectors - Connector count
   * @param {number} subordinates - Subordinate clause count
   * @returns {number} Complexity score 0-1
   */
  calculateGrammarComplexity(verbForms, connectors, subordinates) {
    const verbVariety = verbForms.variety / 3;
    const connectorScore = Math.min(1, connectors / 20);
    const subordinateScore = Math.min(1, subordinates / 10);

    return (verbVariety + connectorScore + subordinateScore) / 3;
  }

  /**
   * Get LLM-based analysis
   * @param {string} text - Arabic text
   * @param {Object} options - Options
   * @returns {Promise<Object>} LLM analysis
   */
  async getLLMAnalysis(text, options = {}) {
    try {
      const result = await llmClient.analyzeILR(text);
      return result;
    } catch (error) {
      log.warn('LLM analysis failed, using local only:', error.message);
      return {
        level: null,
        confidence: 0,
        features: {}
      };
    }
  }

  /**
   * Calculate combined ILR score
   * @param {Object} linguistic - Linguistic features
   * @param {Object} llm - LLM analysis
   * @returns {number} Combined score
   */
  calculateILRScore(linguistic, llm) {
    // Weight local linguistic score
    const localScore = this.calculateLocalScore(linguistic);

    // Guard against invalid local score
    if (!Number.isFinite(localScore)) {
      return 2.0; // Default fallback
    }

    // If LLM provided a level, convert to score and blend
    if (llm && llm.level !== null && llm.level !== undefined) {
      const llmScore = this.ilrLevelToScore(llm.level);

      // Validate LLM confidence (0-1 range)
      let llmWeight = llm.confidence;
      if (!Number.isFinite(llmWeight) || llmWeight < 0 || llmWeight > 1) {
        llmWeight = 0.5;
      }

      const combined = (localScore * (1 - llmWeight)) + (llmScore * llmWeight);

      // Clamp result to valid ILR range
      return Math.max(1.0, Math.min(3.5, combined));
    }

    return Math.max(1.0, Math.min(3.5, localScore));
  }

  /**
   * Calculate score from local features only
   * @param {Object} features - Linguistic features
   * @returns {number} Score
   */
  calculateLocalScore(features) {
    // Guard against missing or invalid features
    if (!features || typeof features !== 'object') {
      return 2.0; // Default middle score
    }

    // Safely extract features with defaults
    const getFeature = (name, defaultVal = 0) => {
      const val = features[name];
      return Number.isFinite(val) ? Math.max(0, Math.min(1, val)) : defaultVal;
    };

    const vocabScore = getFeature('vocabularyComplexity') * FEATURE_WEIGHTS.vocabularyComplexity;
    const sentScore = getFeature('sentenceComplexity') * FEATURE_WEIGHTS.sentenceComplexity;
    const grammarScore = getFeature('grammarComplexity') * FEATURE_WEIGHTS.grammarComplexity;
    const diversityScore = getFeature('vocabularyDiversity') * FEATURE_WEIGHTS.topicAbstraction;

    // Base score from weighted features (0.8 is the sum of used weights)
    const weightSum = FEATURE_WEIGHTS.vocabularyComplexity +
                      FEATURE_WEIGHTS.sentenceComplexity +
                      FEATURE_WEIGHTS.grammarComplexity +
                      FEATURE_WEIGHTS.topicAbstraction;
    const baseScore = weightSum > 0 ? (vocabScore + sentScore + grammarScore + diversityScore) / weightSum : 0;

    // Scale to ILR range (1.0 - 3.5)
    const finalScore = 1.0 + (baseScore * 2.5);

    // Guard against NaN and clamp to valid range
    return Number.isFinite(finalScore) ? Math.max(1.0, Math.min(3.5, finalScore)) : 2.0;
  }

  /**
   * Convert numeric score to ILR level
   * @param {number} score - Numeric score
   * @returns {string} ILR level
   */
  scoreToILRLevel(score) {
    // Guard against invalid inputs
    if (!Number.isFinite(score)) return '2.0';

    // Clamp score to valid ILR range
    const clampedScore = Math.max(1.0, Math.min(3.5, score));

    if (clampedScore < 1.25) return '1.0';
    if (clampedScore < 1.75) return '1.5';
    if (clampedScore < 2.25) return '2.0';
    if (clampedScore < 2.75) return '2.5';
    if (clampedScore < 3.25) return '3.0';
    return '3.5';
  }

  /**
   * Convert ILR level to numeric score
   * @param {string|number} level - ILR level (string or number)
   * @returns {number} Numeric score
   */
  ilrLevelToScore(level) {
    // Handle numeric input directly
    if (typeof level === 'number') {
      if (!Number.isFinite(level)) return 2.0;
      // Clamp to valid ILR range and round to nearest 0.5
      const clamped = Math.max(1.0, Math.min(3.5, level));
      return Math.round(clamped * 2) / 2;
    }

    // Handle string input
    const levelStr = String(level).trim();
    const scores = {
      '1.0': 1.0, '1': 1.0, '1.00': 1.0,
      '1.5': 1.5, '1.50': 1.5,
      '2.0': 2.0, '2': 2.0, '2.00': 2.0,
      '2.5': 2.5, '2.50': 2.5,
      '3.0': 3.0, '3': 3.0, '3.00': 3.0,
      '3.5': 3.5, '3.50': 3.5
    };

    if (scores[levelStr] !== undefined) {
      return scores[levelStr];
    }

    // Try parsing as float
    const parsed = parseFloat(levelStr);
    if (Number.isFinite(parsed)) {
      const clamped = Math.max(1.0, Math.min(3.5, parsed));
      return Math.round(clamped * 2) / 2;
    }

    return 2.0; // Default fallback
  }

  /**
   * Generate recommendations based on analysis
   * @param {string} level - ILR level
   * @param {Object} features - Linguistic features
   * @returns {Object} Recommendations
   */
  generateRecommendations(level, features) {
    const recommendations = {
      suitable: true,
      suggestions: [],
      targetAudience: []
    };

    const numLevel = parseFloat(level);

    // Determine target audience
    if (numLevel <= 1.5) {
      recommendations.targetAudience = ['Beginning learners', 'Elementary students'];
    } else if (numLevel <= 2.5) {
      recommendations.targetAudience = ['Intermediate learners', 'University students'];
    } else {
      recommendations.targetAudience = ['Advanced learners', 'Professional linguists'];
    }

    // Add suggestions based on features
    if (features.vocabularyDiversity < 0.3) {
      recommendations.suggestions.push('Consider adding vocabulary glossary for repeated terms');
    }

    if (features.avgSentenceLength > 15) {
      recommendations.suggestions.push('Long sentences may benefit from guided parsing exercises');
    }

    if (features.subordinateCount > 5) {
      recommendations.suggestions.push('Complex sentence structures present - good for advanced grammar practice');
    }

    return recommendations;
  }

  /**
   * Get ILR level information
   * @param {string} level - ILR level
   * @returns {Object} Level info
   */
  getLevelInfo(level) {
    return ILR_LEVELS[level] || ILR_LEVELS['2.0'];
  }

  /**
   * Get all ILR levels
   * @returns {Object} All level definitions
   */
  getAllLevels() {
    return ILR_LEVELS;
  }

  /**
   * Get last analysis result
   * @returns {Object|null} Last analysis
   */
  getLastAnalysis() {
    return this.lastAnalysis;
  }
}

// Singleton instance
const ilrAnalyzer = new ILRAnalyzer();

export { ilrAnalyzer, ILRAnalyzer, ILR_LEVELS };
