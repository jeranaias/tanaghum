/**
 * Tanaghum Lesson Assembler
 * Combines all generated content into a complete lesson package
 */

import { Config } from '../core/config.js';
import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { createLogger, formatTime } from '../core/utils.js';
import { llmClient } from './llm-client.js';
import { ilrAnalyzer, ILR_LEVELS } from '../analysis/ilr-analyzer.js';

const log = createLogger('LessonAssembler');

/**
 * Lesson schema version for compatibility
 */
const LESSON_SCHEMA_VERSION = '1.0.0';

/**
 * Lesson Assembler class
 */
class LessonAssembler {
  constructor() {
    this.currentLesson = null;
  }

  /**
   * Assemble a complete lesson from components
   * @param {Object} components - Lesson components
   * @returns {Promise<Object>} Complete lesson
   */
  async assemble(components) {
    const {
      source,
      transcript,
      analysis,
      targetIlr,
      topic
    } = components;

    log.log('Assembling lesson...');
    const startTime = performance.now();

    try {
      // Generate vocabulary from transcript
      const vocabulary = await this.generateVocabulary(transcript.text, targetIlr);

      // Generate comprehension questions
      const questions = await this.generateQuestions(transcript.text, targetIlr, topic);

      // Generate translation
      const translation = await this.generateTranslation(transcript.text);

      // Create lesson metadata
      const metadata = this.createMetadata(source, transcript, analysis, targetIlr, topic);

      // Assemble the complete lesson
      const lesson = {
        schemaVersion: LESSON_SCHEMA_VERSION,
        id: this.generateLessonId(),
        createdAt: new Date().toISOString(),
        metadata,
        content: {
          transcript: {
            text: transcript.text,
            segments: transcript.segments,
            vtt: transcript.vtt || this.generateVTT(transcript.segments)
          },
          translation: {
            text: translation.text,
            segments: translation.segments || []
          },
          vocabulary,
          questions
        },
        analysis: {
          ilrLevel: analysis.level,
          ilrScore: analysis.score,
          confidence: analysis.confidence,
          statistics: analysis.statistics,
          recommendations: analysis.recommendations
        },
        audio: source.type === 'youtube' ? {
          type: 'youtube',
          videoId: source.videoId,
          url: source.url,
          duration: metadata.duration
        } : source.type === 'upload' ? {
          type: 'local',
          fileName: source.file?.name,
          duration: metadata.duration
        } : null,
        settings: {
          targetIlr,
          topic,
          showTranslation: true,
          showVocabulary: true,
          autoAdvance: false,
          playbackRate: 1.0
        }
      };

      this.currentLesson = lesson;

      // Update state
      StateManager.set('lesson', lesson);

      const processingTime = (performance.now() - startTime) / 1000;
      log.log(`Lesson assembled in ${processingTime.toFixed(2)}s`);

      EventBus.emit(Events.LESSON_GENERATED, {
        lessonId: lesson.id,
        processingTime
      });

      return lesson;

    } catch (error) {
      log.error('Failed to assemble lesson:', error);
      throw error;
    }
  }

  /**
   * Generate vocabulary list
   * @param {string} text - Arabic text
   * @param {string} targetIlr - Target ILR level
   * @returns {Promise<Object>} Vocabulary data
   */
  async generateVocabulary(text, targetIlr) {
    try {
      const result = await llmClient.extractVocabulary(text, targetIlr);

      return {
        items: result.vocabulary || [],
        totalCount: result.vocabulary?.length || 0,
        categories: this.categorizeVocabulary(result.vocabulary || [])
      };
    } catch (error) {
      log.warn('Vocabulary generation failed:', error.message);

      // Return basic vocabulary extraction
      return {
        items: this.extractBasicVocabulary(text),
        totalCount: 0,
        categories: {},
        fallback: true
      };
    }
  }

  /**
   * Extract basic vocabulary without LLM
   * @param {string} text - Arabic text
   * @returns {Array} Basic vocabulary items
   */
  extractBasicVocabulary(text) {
    const words = text.match(/[\u0600-\u06FF]+/g) || [];
    const wordCounts = {};

    words.forEach(word => {
      const normalized = this.normalizeArabic(word);
      if (normalized.length >= 3) {
        wordCounts[normalized] = (wordCounts[normalized] || 0) + 1;
      }
    });

    // Return most frequent words
    return Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({
        arabic: word,
        frequency: count,
        needsDefinition: true
      }));
  }

  /**
   * Normalize Arabic word
   * @param {string} word - Arabic word
   * @returns {string} Normalized
   */
  normalizeArabic(word) {
    return word
      .replace(/[\u064B-\u065F]/g, '')
      .replace(/[إأآا]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه');
  }

  /**
   * Categorize vocabulary items
   * @param {Array} items - Vocabulary items
   * @returns {Object} Categorized vocabulary
   */
  categorizeVocabulary(items) {
    const categories = {
      nouns: [],
      verbs: [],
      adjectives: [],
      other: []
    };

    items.forEach(item => {
      const category = item.partOfSpeech?.toLowerCase() || 'other';
      if (category.includes('noun') || category.includes('اسم')) {
        categories.nouns.push(item);
      } else if (category.includes('verb') || category.includes('فعل')) {
        categories.verbs.push(item);
      } else if (category.includes('adj') || category.includes('صفة')) {
        categories.adjectives.push(item);
      } else {
        categories.other.push(item);
      }
    });

    return categories;
  }

  /**
   * Generate comprehension questions
   * @param {string} text - Arabic text
   * @param {string} targetIlr - Target ILR level
   * @param {string} topic - Topic category
   * @returns {Promise<Object>} Questions data
   */
  async generateQuestions(text, targetIlr, topic) {
    try {
      const result = await llmClient.generateQuestions(text, targetIlr, topic);

      return {
        pre: result.pre || [],
        while: result.while || [],
        post: result.post || [],
        totalCount: (result.pre?.length || 0) + (result.while?.length || 0) + (result.post?.length || 0)
      };
    } catch (error) {
      log.warn('Question generation failed:', error.message);

      // Return placeholder questions
      return {
        pre: this.generatePlaceholderQuestions('pre', targetIlr),
        while: this.generatePlaceholderQuestions('while', targetIlr),
        post: this.generatePlaceholderQuestions('post', targetIlr),
        fallback: true
      };
    }
  }

  /**
   * Generate placeholder questions
   * @param {string} phase - Question phase
   * @param {string} targetIlr - Target ILR level
   * @returns {Array} Placeholder questions
   */
  generatePlaceholderQuestions(phase, targetIlr) {
    const templates = {
      pre: [
        {
          type: 'prediction',
          questionAr: 'ماذا تتوقع أن يناقش هذا التسجيل؟',
          questionEn: 'What do you expect this recording to discuss?',
          format: 'open_ended'
        },
        {
          type: 'background',
          questionAr: 'ماذا تعرف عن هذا الموضوع؟',
          questionEn: 'What do you know about this topic?',
          format: 'open_ended'
        }
      ],
      while: [
        {
          type: 'main_idea',
          questionAr: 'ما الفكرة الرئيسية؟',
          questionEn: 'What is the main idea?',
          format: 'multiple_choice'
        },
        {
          type: 'detail',
          questionAr: 'أكمل المعلومات الناقصة',
          questionEn: 'Fill in the missing information',
          format: 'fill_blank'
        }
      ],
      post: [
        {
          type: 'summary',
          questionAr: 'لخص المحتوى في جملتين',
          questionEn: 'Summarize the content in two sentences',
          format: 'open_ended'
        },
        {
          type: 'opinion',
          questionAr: 'ما رأيك في الموضوع؟',
          questionEn: 'What is your opinion on the topic?',
          format: 'open_ended'
        }
      ]
    };

    return templates[phase] || [];
  }

  /**
   * Generate translation
   * @param {string} text - Arabic text
   * @returns {Promise<Object>} Translation data
   */
  async generateTranslation(text) {
    try {
      const result = await llmClient.translate(text, 'ar', 'en');

      return {
        text: result.translation,
        segments: result.segments || []
      };
    } catch (error) {
      log.warn('Translation failed:', error.message);

      return {
        text: '[Translation unavailable]',
        segments: [],
        fallback: true
      };
    }
  }

  /**
   * Create lesson metadata
   * @param {Object} source - Content source
   * @param {Object} transcript - Transcript data
   * @param {Object} analysis - Analysis data
   * @param {string} targetIlr - Target ILR level
   * @param {string} topic - Topic category
   * @returns {Object} Metadata
   */
  createMetadata(source, transcript, analysis, targetIlr, topic) {
    const ilrInfo = ILR_LEVELS[analysis.level] || ILR_LEVELS['2.0'];

    return {
      title: source.metadata?.title || source.file?.name || 'Untitled Lesson',
      titleAr: source.metadata?.titleAr || '',
      source: {
        type: source.type,
        url: source.url || null,
        videoId: source.videoId || null,
        fileName: source.file?.name || null,
        author: source.metadata?.author || null
      },
      duration: transcript.audioDuration || source.metadata?.duration || 0,
      durationFormatted: formatTime(transcript.audioDuration || source.metadata?.duration || 0),
      wordCount: analysis.statistics?.wordCount || transcript.wordCount || 0,
      ilr: {
        level: analysis.level,
        name: ilrInfo.name,
        nameAr: ilrInfo.nameAr,
        target: targetIlr
      },
      topic: {
        code: topic,
        nameEn: this.getTopicName(topic, 'en'),
        nameAr: this.getTopicName(topic, 'ar')
      },
      language: 'ar',
      dialect: analysis.features?.dialect || 'MSA'
    };
  }

  /**
   * Get topic name
   * @param {string} code - Topic code
   * @param {string} lang - Language
   * @returns {string} Topic name
   */
  getTopicName(code, lang) {
    const topics = {
      economy: { en: 'Economy', ar: 'الاقتصاد' },
      politics: { en: 'Politics', ar: 'السياسة' },
      culture: { en: 'Culture', ar: 'الثقافة' },
      science: { en: 'Science', ar: 'العلوم' },
      society: { en: 'Society', ar: 'المجتمع' },
      health: { en: 'Health', ar: 'الصحة' },
      education: { en: 'Education', ar: 'التعليم' },
      general: { en: 'General', ar: 'عام' }
    };

    return topics[code]?.[lang] || topics.general[lang];
  }

  /**
   * Generate VTT from segments
   * @param {Array} segments - Transcript segments
   * @returns {string} WebVTT content
   */
  generateVTT(segments) {
    if (!segments || segments.length === 0) return '';

    let vtt = 'WEBVTT\n\n';

    segments.forEach((seg, index) => {
      const startTime = this.formatVTTTime(seg.start);
      const endTime = this.formatVTTTime(seg.end || seg.start + 2);

      vtt += `${index + 1}\n`;
      vtt += `${startTime} --> ${endTime}\n`;
      vtt += `${seg.text}\n\n`;
    });

    return vtt;
  }

  /**
   * Format seconds to VTT timestamp
   * @param {number} seconds - Time in seconds
   * @returns {string} VTT formatted time
   */
  formatVTTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  /**
   * Generate unique lesson ID
   * @returns {string} Lesson ID
   */
  generateLessonId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `lesson_${timestamp}_${random}`;
  }

  /**
   * Export lesson to JSON
   * @param {Object} lesson - Lesson object
   * @returns {string} JSON string
   */
  exportToJSON(lesson = this.currentLesson) {
    if (!lesson) {
      throw new Error('No lesson to export');
    }

    return JSON.stringify(lesson, null, 2);
  }

  /**
   * Export lesson to downloadable file
   * @param {Object} lesson - Lesson object
   * @returns {Blob} Downloadable blob
   */
  exportToFile(lesson = this.currentLesson) {
    const json = this.exportToJSON(lesson);
    return new Blob([json], { type: 'application/json' });
  }

  /**
   * Import lesson from JSON
   * @param {string} json - JSON string
   * @returns {Object} Lesson object
   */
  importFromJSON(json) {
    try {
      const lesson = JSON.parse(json);

      // Validate schema version
      if (!lesson.schemaVersion) {
        throw new Error('Invalid lesson format: missing schema version');
      }

      // Validate required fields
      if (!lesson.content?.transcript?.text) {
        throw new Error('Invalid lesson format: missing transcript');
      }

      this.currentLesson = lesson;
      StateManager.set('lesson', lesson);

      return lesson;
    } catch (error) {
      log.error('Failed to import lesson:', error);
      throw error;
    }
  }

  /**
   * Get current lesson
   * @returns {Object|null} Current lesson
   */
  getCurrentLesson() {
    return this.currentLesson;
  }

  /**
   * Clear current lesson
   */
  clear() {
    this.currentLesson = null;
    StateManager.set('lesson', null);
  }
}

// Singleton instance
const lessonAssembler = new LessonAssembler();

export { lessonAssembler, LessonAssembler, LESSON_SCHEMA_VERSION };
