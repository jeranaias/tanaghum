/**
 * Tanaghum Lesson Generator Workflow
 * Orchestrates the complete lesson generation process
 */

import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { createLogger } from '../core/utils.js';
import { youtubeFetcher } from '../content/youtube-fetcher.js';
import { audioProcessor } from '../content/audio-processor.js';
import { transcriptionService } from '../transcription/transcription-service.js';
import { llmClient } from '../generation/llm-client.js';

const log = createLogger('GeneratorWorkflow');

/**
 * Lesson Generator Workflow class
 */
class LessonGeneratorWorkflow {
  constructor() {
    this.isRunning = false;
    this.currentStep = null;
    this.abortController = null;
  }

  /**
   * Detect and clean Whisper hallucinations (repetitive phrase loops).
   * Whisper sometimes gets stuck repeating the same phrase dozens of times.
   * @param {string} text - Segment text
   * @returns {string} Cleaned text
   */
  cleanHallucinations(text) {
    if (!text || text.length < 50) return text;

    let cleaned = text;

    // Detection 1: Repeated words (space-separated, e.g. "ألف ألف ألف ألف...")
    const words = cleaned.split(/\s+/);
    if (words.length > 10) {
      const wordRuns = [];
      let runWord = words[0], runCount = 1;
      for (let i = 1; i < words.length; i++) {
        if (words[i] === runWord) {
          runCount++;
        } else {
          if (runCount > 3) wordRuns.push({ word: runWord, count: runCount, endIdx: i });
          runWord = words[i];
          runCount = 1;
        }
      }
      if (runCount > 3) wordRuns.push({ word: runWord, count: runCount, endIdx: words.length });

      if (wordRuns.length > 0) {
        log.warn(`Detected repeated word hallucination: "${wordRuns[0].word}" repeated ${wordRuns[0].count} times`);
        // Collapse each run to a single occurrence
        const result = [];
        let i = 0;
        while (i < words.length) {
          result.push(words[i]);
          const run = wordRuns.find(r => r.endIdx - r.count === i);
          if (run) {
            i += run.count; // Skip the repeated words
          } else {
            i++;
          }
        }
        cleaned = result.join(' ');
      }
    }

    // Detection 2: Repeated phrases (comma/period-delimited)
    const phrases = cleaned.split(/[،,\.]/);
    if (phrases.length >= 4) {
      const normalize = (s) => s.trim().replace(/\s+/g, ' ');
      const seen = {};
      for (const p of phrases) {
        const n = normalize(p);
        if (n.length < 3) continue;
        seen[n] = (seen[n] || 0) + 1;
      }

      const hallucinated = Object.entries(seen).filter(([, count]) => count > 3);
      if (hallucinated.length > 0) {
        log.warn(`Detected phrase hallucination: "${hallucinated[0][0]}" repeated ${hallucinated[0][1]} times`);
        const kept = [];
        const keptSet = new Set();
        for (const p of phrases) {
          const n = normalize(p);
          if (n.length < 3) continue;
          if (!keptSet.has(n)) {
            keptSet.add(n);
            kept.push(p.trim());
          }
        }
        cleaned = kept.join('، ');
      }
    }

    return cleaned;
  }

  /**
   * Generate a complete lesson from source
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated lesson
   */
  async generate(options = {}) {
    if (this.isRunning) {
      throw new Error('Workflow already running');
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    const {
      source,
      targetIlr = 2.0,
      topic = 'general',
      onProgress = () => {},
      signal
    } = options;

    // Wire external signal to our abort controller
    if (signal) {
      signal.addEventListener('abort', () => this.abortController.abort(), { once: true });
    }

    log.log('Starting lesson generation workflow');

    try {
      // Step 1: Fetch/Load Content
      this.currentStep = 'fetch';
      onProgress({ step: 'fetch', percent: 0, message: 'Loading content...' });

      const contentData = await this.fetchContent(source, (progress) => {
        onProgress({ step: 'fetch', ...progress });
      });
      this.checkAborted();

      // Step 2: Transcribe Audio
      this.currentStep = 'transcribe';
      onProgress({ step: 'transcribe', percent: 20, message: 'Transcribing audio...' });

      const transcription = await this.transcribeContent(source, (progress) => {
        const percent = 20 + Math.round(progress.percent * 0.35); // 20-55%
        onProgress({ step: 'transcribe', percent, ...progress });
      });
      this.checkAborted();

      // Step 3: Analyze Content
      this.currentStep = 'analyze';
      onProgress({ step: 'analyze', percent: 55, message: 'Analyzing content...' });

      const analysis = await this.analyzeContent(transcription, (progress) => {
        const p = typeof progress === 'number' ? progress : (progress.percent || 0);
        const percent = 55 + Math.round(p * 0.1); // 55-65%
        onProgress({ step: 'analyze', percent, message: 'Analyzing content...' });
      });
      this.checkAborted();

      // Step 4: Generate Questions
      this.currentStep = 'questions';
      onProgress({ step: 'questions', percent: 65, message: 'Generating questions...' });

      const questions = await this.generateQuestions(transcription, {
        targetIlr,
        topic,
        analysis,
        signal: this.abortController.signal,
        onProgress: (progress) => {
          const percent = 65 + Math.round(progress * 0.25); // 65-90%
          onProgress({ step: 'questions', percent, message: 'Generating questions...' });
        }
      });

      // Step 5: Assemble Lesson
      this.currentStep = 'assemble';
      onProgress({ step: 'assemble', percent: 90, message: 'Assembling lesson...' });

      const lesson = await this.assembleLesson({
        source,
        contentData,
        transcription,
        analysis,
        questions,
        targetIlr,
        topic
      });

      onProgress({ step: 'complete', percent: 100, message: 'Lesson generated!' });

      log.log('Lesson generation complete');

      // Save to state
      StateManager.set('lesson', lesson);
      EventBus.emit(Events.LESSON_GENERATED, { lesson });

      this.isRunning = false;
      return lesson;

    } catch (error) {
      log.error('Workflow failed at step:', this.currentStep, error);
      this.isRunning = false;

      EventBus.emit(Events.ERROR, {
        step: this.currentStep,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Fetch content from source
   */
  async fetchContent(source, onProgress) {
    if (!source || !source.type) {
      throw new Error('Invalid source: missing type');
    }

    onProgress({ stage: 'loading', percent: 5, message: 'Fetching content...' });

    if (source.type === 'youtube') {
      // Fetch YouTube metadata and check captions
      const videoId = source.videoId || source.url;
      if (!videoId) {
        throw new Error('YouTube source requires videoId or url');
      }

      const data = await youtubeFetcher.fetchVideo(videoId);

      onProgress({ stage: 'loaded', percent: 100, message: 'Content loaded' });

      return {
        type: 'youtube',
        videoId: data.videoId,
        title: data.metadata?.title || 'Untitled',
        author: data.metadata?.author || 'Unknown',
        duration: data.metadata?.duration || 0,
        thumbnail: data.metadata?.thumbnail || null,
        hasCaptions: data.hasCaptions || false,
        needsTranscription: data.needsTranscription !== false
      };

    } else if (source.type === 'upload') {
      // Process uploaded audio file
      if (!source.file) {
        throw new Error('Upload source requires a file');
      }

      onProgress({ stage: 'loading', percent: 30, message: 'Loading audio file...' });

      const audioData = await audioProcessor.loadFile(source.file);

      onProgress({ stage: 'loaded', percent: 100, message: 'Audio loaded' });

      return {
        type: 'upload',
        fileName: source.file.name,
        duration: audioData?.duration || 0,
        needsTranscription: true
      };

    } else if (source.type === 'text') {
      // Direct text input - no transcription needed
      if (!source.text && !StateManager.get('source.text')) {
        throw new Error('Text source requires text content');
      }

      onProgress({ stage: 'loaded', percent: 100, message: 'Text loaded' });

      return {
        type: 'text',
        needsTranscription: false
      };

    } else {
      throw new Error(`Unsupported source type: ${source.type}`);
    }
  }

  /**
   * Transcribe content
   */
  async transcribeContent(source, onProgress) {
    // If text input, no transcription needed
    if (source.type === 'text') {
      onProgress({ stage: 'skip', percent: 100, message: 'Using provided text' });

      const text = source.text || StateManager.get('source.text') || '';
      const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
      return {
        text,
        segments: [{ id: 0, start: 0, end: 0, text }],
        source: 'text_input',
        language: 'ar',
        confidence: 1.0,
        wordCount
      };
    }

    // Use transcription service for audio sources
    const transcription = await transcriptionService.getTranscription(source, {
      language: 'ar',
      onProgress
    });

    // Detect and clean Whisper hallucinations (repetitive phrases)
    if (transcription?.segments) {
      transcription.segments = transcription.segments.map(seg => {
        seg.text = this.cleanHallucinations(seg.text);
        return seg;
      });
      // Rebuild full text from cleaned segments
      transcription.text = transcription.segments.map(s => s.text).join(' ');
    }

    // Ensure wordCount is populated
    if (transcription && !transcription.wordCount && transcription.text) {
      transcription.wordCount = transcription.text.split(/\s+/).filter(w => w.length > 0).length;
    }

    return transcription;
  }

  /**
   * Analyze content for ILR level and extract key information
   */
  async analyzeContent(transcription, onProgress) {
    log.log('Analyzing content');

    onProgress(0);

    try {
      // Analyze ILR level
      onProgress(20);
      const ilrAnalysis = await llmClient.analyzeILR(transcription.text);

      // Detect dialect
      onProgress(40);
      let dialectAnalysis = { dialect: 'msa', confidence: 0.5, features: [], mixed: false };
      try {
        dialectAnalysis = await llmClient.detectDialect(transcription.text);
        log.log('Dialect detected:', dialectAnalysis.dialect, 'confidence:', dialectAnalysis.confidence);
      } catch (e) {
        log.warn('Dialect detection failed:', e.message);
      }

      // Extract vocabulary
      onProgress({ step: 'analyze', percent: 70, message: 'Extracting vocabulary...' });
      let vocabulary = [];
      try {
        vocabulary = await llmClient.extractVocabulary(transcription.text, {
          count: 15,
          ilrLevel: ilrAnalysis.level
        });
        if (!vocabulary || vocabulary.length === 0) {
          log.warn('Vocabulary extraction returned empty, retrying once...');
          vocabulary = await llmClient.extractVocabulary(transcription.text, {
            count: 12,
            ilrLevel: ilrAnalysis.level
          });
        }
      } catch (vocabError) {
        log.error('Vocabulary extraction failed:', vocabError.message);
        vocabulary = [];
      }

      onProgress({ step: 'analyze', percent: 100, message: 'Analysis complete', data: { vocabulary } });

      const analysis = {
        ilrLevel: ilrAnalysis.level,
        ilrConfidence: ilrAnalysis.confidence,
        ilrFactors: ilrAnalysis.factors,
        dialect: dialectAnalysis.dialect,
        dialectConfidence: dialectAnalysis.confidence,
        dialectFeatures: dialectAnalysis.features,
        dialectMixed: dialectAnalysis.mixed,
        vocabulary,
        wordCount: transcription.wordCount,
        duration: transcription.audioDuration || transcription.duration || 0
      };

      // Update state
      StateManager.set('analysis', analysis);
      EventBus.emit(Events.ANALYSIS_COMPLETE, { analysis });

      return analysis;

    } catch (error) {
      log.warn('Analysis failed, using defaults:', error.message);

      // Return default analysis on error
      return {
        ilrLevel: 2.0,
        ilrConfidence: 0.5,
        ilrFactors: ['Unable to analyze'],
        dialect: 'msa',
        dialectConfidence: 0.5,
        dialectFeatures: [],
        dialectMixed: false,
        vocabulary: [],
        wordCount: transcription.wordCount || 0,
        duration: transcription.audioDuration || 0
      };
    }
  }

  /**
   * Generate comprehension questions
   */
  async generateQuestions(transcription, options = {}) {
    const { targetIlr = 2.0, topic = 'general', analysis = {}, onProgress = () => {} } = options;

    log.log('Generating questions');

    EventBus.emit(Events.QUESTIONS_START, {
      targetIlr,
      topic
    });

    // Questions object lives outside try blocks so partial results are preserved
    const questions = {
      pre: [],
      while: [],
      post: []
    };

    // Generate each phase independently — partial failures preserve earlier phases
    // Pre-listening questions
    try {
      onProgress(0.1);
      questions.pre = await llmClient.generateQuestions(transcription.text, {
        phase: 'pre',
        count: 3,
        ilrLevel: targetIlr,
        topic
      });
      EventBus.emit(Events.QUESTIONS_PROGRESS, { phase: 'pre', count: questions.pre.length });
    } catch (error) {
      log.error('Pre-listening question generation failed:', error.message);
    }

    // While-listening questions
    try {
      onProgress(0.4);
      questions.while = await llmClient.generateQuestions(transcription.text, {
        phase: 'while',
        count: 10,
        ilrLevel: targetIlr,
        topic,
        existingQuestions: questions.pre
      });
      EventBus.emit(Events.QUESTIONS_PROGRESS, { phase: 'while', count: questions.while.length });
    } catch (error) {
      log.error('While-listening question generation failed:', error.message);
    }

    // Post-listening questions
    try {
      onProgress(0.7);
      questions.post = await llmClient.generateQuestions(transcription.text, {
        phase: 'post',
        count: 5,
        ilrLevel: targetIlr,
        topic,
        existingQuestions: [...questions.pre, ...questions.while]
      });
      EventBus.emit(Events.QUESTIONS_PROGRESS, { phase: 'post', count: questions.post.length });
    } catch (error) {
      log.error('Post-listening question generation failed:', error.message);
    }

    onProgress(1.0);

    // Validate question counts
    const totalQuestions = questions.pre.length + questions.while.length + questions.post.length;
    if (totalQuestions === 0) {
      log.warn('No questions were generated! LLM may have failed.');
      EventBus.emit(Events.ERROR, {
        step: 'questions',
        error: 'No comprehension questions could be generated. The lesson will be incomplete.',
        recoverable: true
      });
    } else if (totalQuestions < 18) {
      log.warn(`Only ${totalQuestions} questions generated (expected ~18)`);
    }

    // Update state
    StateManager.set('questions', questions);

    EventBus.emit(Events.QUESTIONS_COMPLETE, {
      total: totalQuestions,
      questions,
      incomplete: totalQuestions < 10
    });

    return questions;
  }

  /**
   * Assemble final lesson object
   */
  async assembleLesson(data = {}) {
    const {
      source = {},
      contentData = {},
      transcription = {},
      analysis = {},
      questions = {},
      targetIlr = 2.0,
      topic = 'general'
    } = data;

    log.log('Assembling lesson');

    // Translate title if needed
    let titleEn = contentData.title || 'Untitled Lesson';
    if (source.type !== 'youtube' && transcription.text) {
      try {
        const firstLine = transcription.text.substring(0, 100);
        titleEn = await llmClient.translate(firstLine);
        titleEn = titleEn ? titleEn.substring(0, 60) + '...' : 'Arabic Listening Lesson';
      } catch {
        titleEn = 'Arabic Listening Lesson';
      }
    }

    const lesson = {
      schemaVersion: '1.0.0',
      id: `lesson_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),

      metadata: {
        title: {
          ar: contentData.title || (transcription.text ? transcription.text.substring(0, 60) + '...' : 'Untitled'),
          en: titleEn
        },
        description: {
          ar: '',
          en: ''
        },
        source: {
          type: source.type,
          videoId: contentData.videoId,
          url: source.url,
          fileName: contentData.fileName,
          author: contentData.author
        },
        duration: contentData.duration || transcription.audioDuration || 0,
        wordCount: transcription.wordCount || 0,
        ilr: {
          detected: analysis.ilrLevel ?? null,
          target: targetIlr,
          confidence: analysis.ilrConfidence ?? 0
        },
        topic: {
          code: topic || 'general',
          nameEn: topic ? topic.charAt(0).toUpperCase() + topic.slice(1) : 'General'
        },
        createdWith: {
          app: 'Tanaghum',
          version: '1.0.0',
          transcriptionSource: transcription.source
        }
      },

      content: {
        transcript: {
          text: transcription.text || '',
          segments: transcription.segments || [],
          words: transcription.words || [], // Word-level data for per-word confidence coloring
          language: transcription.language || 'ar'
        },
        dialect: {
          detected: analysis.dialect || 'msa',
          confidence: analysis.dialectConfidence || 0,
          features: analysis.dialectFeatures || [],
          mixed: analysis.dialectMixed || false
        },
        vocabulary: {
          items: analysis.vocabulary || []
        },
        questions: {
          pre: questions.pre || [],
          while: questions.while || [],
          post: questions.post || []
        }
      },

      // Audio source - get from StateManager if available
      audio: (() => {
        const audioState = StateManager.get('audio') || {};
        const duration = contentData.duration || transcription.audioDuration || audioState.duration || 0;

        // For YouTube, include videoId for iframe embedding
        // Also include captured audio URL if available (from browser capture)
        if (source.type === 'youtube') {
          return {
            type: 'youtube',
            videoId: contentData.videoId || source.videoId,
            // Include captured audio URL for offline playback if browser capture was used
            capturedUrl: audioState.url || null,
            duration: duration
          };
        }

        // For uploaded/captured audio, include URL if available
        return {
          type: audioState.type || source.type || 'audio',
          url: audioState.url || null,
          duration: duration
        };
      })()
    };

    log.log(`Lesson assembled: ${lesson.id}, questions: ${(questions.pre?.length || 0) + (questions.while?.length || 0) + (questions.post?.length || 0)}, vocab: ${lesson.content.vocabulary.items?.length || 0}`);

    return lesson;
  }

  /**
   * Throw if the workflow has been aborted
   */
  checkAborted() {
    if (this.abortController?.signal?.aborted) {
      throw new DOMException('Generation cancelled', 'AbortError');
    }
  }

  /**
   * Cancel ongoing generation
   */
  cancel() {
    if (this.isRunning && this.abortController) {
      log.log('Cancelling workflow');
      this.abortController.abort();
      this.isRunning = false;
    }
  }

  /**
   * Get current workflow status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      currentStep: this.currentStep
    };
  }
}

// Singleton instance
const lessonGeneratorWorkflow = new LessonGeneratorWorkflow();

export { lessonGeneratorWorkflow, LessonGeneratorWorkflow };
