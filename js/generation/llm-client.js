/**
 * Tanaghum LLM Client
 * Multi-provider LLM client with automatic fallback and quota tracking
 */

import { Config } from '../core/config.js';
import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { retry, createLogger } from '../core/utils.js';

const log = createLogger('LLM');

/**
 * Provider configurations
 */
/**
 * Provider configurations with accurate free tier limits
 *
 * Google AI Studio: 15 RPM, 1,500 requests/day, 1M tokens/day
 * Groq: 30 RPM, 14,400 requests/day, but token-limited per model
 * OpenRouter: Free models have ~10-20 requests/day typically
 */
const PROVIDERS = {
  google: {
    name: 'Google AI Studio',
    endpoint: '/api/llm/google',
    model: 'gemini-2.0-flash',
    dailyLimit: 1500,      // Actual: 1,500 requests/day free tier
    rateLimit: 15,         // 15 requests per minute
    supportsJson: true,
    priority: 1
  },
  groq: {
    name: 'Groq',
    endpoint: '/api/llm/groq',
    model: 'llama-3.3-70b-versatile',
    dailyLimit: 14400,     // Actual: ~14,400 requests/day (token-limited though)
    rateLimit: 30,         // 30 requests per minute
    supportsJson: true,
    priority: 2
  },
  openrouter: {
    name: 'OpenRouter',
    endpoint: '/api/llm/openrouter',
    model: 'google/gemini-2.0-flash-exp:free',
    dailyLimit: 20,        // Free models: ~10-20 requests/day realistically
    rateLimit: 5,          // Very limited RPM on free tier
    supportsJson: false,
    priority: 3
  }
};

/**
 * Storage key for quota tracking
 */
const QUOTA_STORAGE_KEY = 'tanaghum_llm_quotas';

/**
 * LLM Client class
 */
class LLMClient {
  constructor() {
    this.workerUrl = Config.WORKER_URL;
    this.quotas = this.loadQuotas();
    this.currentProvider = this.selectBestProvider();
  }

  /**
   * Load quotas from localStorage
   */
  loadQuotas() {
    const freshQuotas = {
      google: PROVIDERS.google.dailyLimit,
      groq: PROVIDERS.groq.dailyLimit,
      openrouter: PROVIDERS.openrouter.dailyLimit
    };

    try {
      const stored = localStorage.getItem(QUOTA_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);

        // Check if quotas are from today
        const today = new Date().toDateString();
        if (data.date === today && data.quotas) {
          // Validate and sanitize loaded quotas
          const loadedQuotas = {};
          for (const [provider, limit] of Object.entries(freshQuotas)) {
            const storedValue = data.quotas[provider];
            // Ensure quota is a valid non-negative number
            if (typeof storedValue === 'number' && !isNaN(storedValue) && storedValue >= 0) {
              loadedQuotas[provider] = Math.min(storedValue, limit); // Cap at daily limit
            } else {
              loadedQuotas[provider] = limit;
            }
          }
          return loadedQuotas;
        }
      }
    } catch (e) {
      log.warn('Failed to load quotas:', e);
    }

    // Return fresh quotas
    return freshQuotas;
  }

  /**
   * Save quotas to localStorage
   */
  saveQuotas() {
    try {
      localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify({
        date: new Date().toDateString(),
        quotas: this.quotas
      }));
    } catch (e) {
      log.warn('Failed to save quotas:', e);
    }

    // Update state and emit event
    StateManager.set('llm.quotaRemaining', { ...this.quotas });
    EventBus.emit(Events.LLM_QUOTA_UPDATE, this.quotas);
  }

  /**
   * Select the best available provider based on quota and priority
   */
  selectBestProvider() {
    const available = Object.entries(PROVIDERS)
      .filter(([id]) => this.quotas[id] > 0)
      .sort((a, b) => a[1].priority - b[1].priority);

    if (available.length === 0) {
      log.error('All providers exhausted!');
      return null;
    }

    const [providerId] = available[0];
    StateManager.set('llm.provider', providerId);
    return providerId;
  }

  /**
   * Decrement quota for a provider
   */
  decrementQuota(providerId) {
    const prevQuota = this.quotas[providerId];

    // Guard against invalid quota values
    if (typeof this.quotas[providerId] !== 'number' || isNaN(this.quotas[providerId])) {
      this.quotas[providerId] = 0;
    }

    if (this.quotas[providerId] > 0) {
      this.quotas[providerId]--;
      this.saveQuotas();
      log.log(`Quota decremented for ${providerId}: ${prevQuota} -> ${this.quotas[providerId]}`);
    } else {
      log.warn(`Cannot decrement quota for ${providerId}: already at ${this.quotas[providerId]}`);
    }

    // Switch provider if exhausted
    if (this.quotas[providerId] <= 0 && this.currentProvider === providerId) {
      const newProvider = this.selectBestProvider();
      if (newProvider && newProvider !== providerId) {
        log.log(`Switching from ${providerId} to ${newProvider}`);
        EventBus.emit(Events.LLM_PROVIDER_SWITCH, {
          from: providerId,
          to: newProvider
        });
      }
    }
  }

  /**
   * Get current quota status
   */
  getQuotaStatus() {
    return {
      current: this.currentProvider,
      quotas: { ...this.quotas },
      providers: Object.fromEntries(
        Object.entries(PROVIDERS).map(([id, config]) => [
          id,
          {
            name: config.name,
            remaining: this.quotas[id],
            limit: config.dailyLimit,
            percent: Math.round((this.quotas[id] / config.dailyLimit) * 100)
          }
        ])
      )
    };
  }

  /**
   * Check if error is a rate limit (429) or quota error
   * @param {Error} error - The error to check
   * @returns {boolean}
   */
  isRateLimitError(error) {
    const message = error.message?.toLowerCase() || '';
    return message.includes('429') ||
           message.includes('rate limit') ||
           message.includes('quota exceeded') ||
           message.includes('too many requests');
  }

  /**
   * Check if error is temporary/retryable
   * @param {Error} error - The error to check
   * @returns {boolean}
   */
  isTemporaryError(error) {
    const message = error.message?.toLowerCase() || '';
    return message.includes('timeout') ||
           message.includes('network') ||
           message.includes('503') ||
           message.includes('502') ||
           message.includes('504');
  }

  /**
   * Make a request to the LLM API
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Response data
   */
  async request(options) {
    const {
      prompt,
      systemPrompt,
      temperature = 0.7,
      maxTokens = 2048,
      jsonMode = false,
      provider = null, // Force specific provider
      retries = 2,
      _fallbackAttempt = 0 // Internal: track fallback depth to prevent infinite recursion
    } = options;

    // Prevent infinite fallback recursion (max 3 providers)
    const MAX_FALLBACK_ATTEMPTS = Object.keys(PROVIDERS).length;
    if (_fallbackAttempt >= MAX_FALLBACK_ATTEMPTS) {
      throw new Error('All LLM providers failed after fallback attempts.');
    }

    // Select provider
    let providerId = provider || this.currentProvider;
    if (!providerId || !this.quotas[providerId] || this.quotas[providerId] <= 0) {
      providerId = this.selectBestProvider();
    }

    if (!providerId) {
      throw new Error('No LLM providers available. Daily quotas exhausted.');
    }

    const providerConfig = PROVIDERS[providerId];

    // Build request body
    const body = {
      prompt,
      model: providerConfig.model,
      temperature,
      maxTokens,
      jsonMode: jsonMode && providerConfig.supportsJson
    };

    if (systemPrompt) {
      body.systemPrompt = systemPrompt;
    }

    log.log(`Making LLM request to ${providerConfig.name} (${providerConfig.model})`);

    // Make request with retry
    const makeRequest = async () => {
      const response = await fetch(`${this.workerUrl}${providerConfig.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        const errorMessage = error.error || `HTTP ${response.status}`;
        const err = new Error(errorMessage);
        err.status = response.status;
        throw err;
      }

      return response.json();
    };

    try {
      const result = await retry(makeRequest, retries, 1000);

      // Decrement quota on success
      this.decrementQuota(providerId);

      log.debug(`${providerConfig.name} response:`, result);

      return {
        text: result.text,
        provider: providerId,
        model: result.model,
        usage: result.usage
      };

    } catch (error) {
      log.error(`${providerConfig.name} failed:`, error.message);

      // Determine if we should try fallback
      const shouldFallback = !provider; // Only fallback if not forcing a specific provider

      if (shouldFallback) {
        // Only mark as exhausted for rate limit errors, not temporary failures
        if (this.isRateLimitError(error)) {
          this.quotas[providerId] = 0; // Mark as exhausted for this session
          this.saveQuotas();
          log.warn(`Provider ${providerId} rate limited, marking as exhausted`);
        } else if (!this.isTemporaryError(error)) {
          // For non-temporary errors (auth, bad request), also mark exhausted
          this.quotas[providerId] = 0;
          this.saveQuotas();
          log.warn(`Provider ${providerId} failed with permanent error, marking as exhausted`);
        }
        // For temporary errors, don't exhaust the provider

        const fallbackProvider = this.selectBestProvider();
        if (fallbackProvider && fallbackProvider !== providerId) {
          log.log(`Falling back to ${fallbackProvider}`);
          return this.request({
            ...options,
            provider: fallbackProvider,
            _fallbackAttempt: _fallbackAttempt + 1
          });
        }
      }

      throw error;
    }
  }

  /**
   * Generate text completion
   */
  async complete(prompt, options = {}) {
    return this.request({ prompt, ...options });
  }

  /**
   * Generate with JSON output
   * @param {string|Object} promptOrOptions - Prompt string or options object with prompt
   * @param {Object} options - Additional options (if first arg is string)
   */
  async json(promptOrOptions, options = {}) {
    // Support both json(prompt, options) and json({prompt, ...options})
    let finalOptions;
    if (typeof promptOrOptions === 'string') {
      finalOptions = { prompt: promptOrOptions, ...options };
    } else {
      finalOptions = promptOrOptions;
    }

    const result = await this.request({
      ...finalOptions,
      jsonMode: true
    });

    // Parse JSON from response
    try {
      // Try to extract JSON from the response
      let jsonText = result.text || '';

      log.log('Raw LLM response length:', jsonText.length);

      // Handle markdown code blocks
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
        log.log('Extracted from code block, length:', jsonText.length);
      }

      // Try to find JSON array or object if not cleanly formatted
      const trimmed = jsonText.trim();
      if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
        // Look for array pattern
        const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          jsonText = arrayMatch[0];
          log.log('Extracted array pattern, length:', jsonText.length);
        } else {
          // Look for object pattern
          const objMatch = trimmed.match(/\{[\s\S]*\}/);
          if (objMatch) {
            jsonText = objMatch[0];
            log.log('Extracted object pattern, length:', jsonText.length);
          }
        }
      }

      result.data = JSON.parse(jsonText.trim());
      log.log('JSON parsed successfully, type:', Array.isArray(result.data) ? 'array' : typeof result.data);
    } catch (e) {
      log.warn('Failed to parse JSON response:', e.message);
      log.warn('Raw text (first 500 chars):', result.text?.substring(0, 500));
      result.data = null;
    }

    return result;
  }

  /**
   * Correct Arabic transcript using LLM
   */
  async correctTranscript(transcript, options = {}) {
    const systemPrompt = `You are an expert Arabic linguist. Your task is to correct transcription errors in Arabic text.

Rules:
- Fix spelling errors and typos
- Add missing diacritics where essential for meaning
- Correct word boundaries
- Preserve the original meaning exactly
- Do not add or remove content
- Return ONLY the corrected Arabic text, nothing else`;

    const prompt = `Correct this Arabic transcript:\n\n${transcript}`;

    const result = await this.request({
      prompt,
      systemPrompt,
      temperature: 0.1, // Low temperature for accuracy
      ...options
    });

    return result.text;
  }

  /**
   * Translate Arabic to English
   */
  async translate(arabicText, options = {}) {
    const systemPrompt = `You are an expert Arabic-English translator. Translate the Arabic text to natural, fluent English.

Rules:
- Preserve the meaning and tone
- Use appropriate English idioms where applicable
- Return ONLY the English translation, nothing else`;

    const prompt = `Translate to English:\n\n${arabicText}`;

    const result = await this.request({
      prompt,
      systemPrompt,
      temperature: 0.3,
      ...options
    });

    return result.text;
  }

  /**
   * Analyze content for ILR level
   */
  async analyzeILR(transcript, options = {}) {
    const systemPrompt = `You are an expert in Arabic language proficiency assessment using the ILR (Interagency Language Roundtable) scale.

Analyze the given Arabic text and provide:
1. ILR level (1.0, 1.5, 2.0, 2.5, 3.0, or 3.5)
2. Confidence score (0.0 to 1.0)
3. Key factors that determined the level

Consider:
- Vocabulary complexity and frequency
- Sentence structure complexity
- Topic abstraction level
- Discourse markers and cohesion`;

    const prompt = `Analyze this Arabic text for ILR proficiency level. Return JSON with keys: level (number), confidence (number), factors (array of strings).

Text:
${transcript}`;

    const result = await this.json({
      prompt,
      systemPrompt,
      temperature: 0.2,
      ...options
    });

    return result.data || {
      level: 2.0,
      confidence: 0.5,
      factors: ['Unable to parse analysis']
    };
  }

  /**
   * Detect Arabic dialect
   */
  async detectDialect(transcript, options = {}) {
    const systemPrompt = `You are an expert in Arabic dialectology.
Identify the primary dialect or variety of Arabic used in the text.

Dialects to consider:
- msa: Modern Standard Arabic (formal, news, academic)
- egyptian: Egyptian Arabic (مصري)
- levantine: Levantine Arabic (شامي - Syrian, Lebanese, Palestinian, Jordanian)
- gulf: Gulf Arabic (خليجي - Saudi, Emirati, Kuwaiti, Qatari)
- maghrebi: Maghrebi Arabic (مغاربي - Moroccan, Algerian, Tunisian)

Look for distinctive vocabulary, grammar, and expressions.`;

    const prompt = `Identify the Arabic dialect/variety in this text.

Return JSON:
{
  "dialect": "<msa|egyptian|levantine|gulf|maghrebi>",
  "confidence": <0.0 to 1.0>,
  "features": [<strings: specific dialectal features observed>],
  "mixed": <boolean: true if multiple dialects present>
}

Text:
${transcript.substring(0, 3000)}`;

    const result = await this.json({
      prompt,
      systemPrompt,
      temperature: 0.2,
      ...options
    });

    return result.data || {
      dialect: 'msa',
      confidence: 0.5,
      features: ['Unable to analyze'],
      mixed: false
    };
  }

  /**
   * Generate comprehension questions
   */
  async generateQuestions(transcript, options = {}) {
    const {
      phase = 'while', // 'pre' | 'while' | 'post'
      count = 5,
      ilrLevel = 2.0,
      topic = 'general',
      existingQuestions = []
    } = options;

    const phaseDescriptions = {
      pre: 'Pre-listening questions activate prior knowledge and set expectations. Focus on prediction and schema activation.',
      while: 'While-listening questions test comprehension during the audio. Focus on main ideas, details, sequence, and inference.',
      post: 'Post-listening questions assess deeper understanding. Focus on vocabulary in context, speaker attitude, synthesis, and evaluation.'
    };

    const questionTypes = {
      pre: ['prediction', 'schema_activation', 'vocabulary_preview'],
      while: ['main_idea', 'details', 'sequence', 'inference'],
      post: ['vocabulary_in_context', 'speaker_attitude', 'synthesis', 'evaluation']
    };

    const systemPrompt = `You are an expert Arabic language teacher creating HIGH-QUALITY comprehension questions for ILR level ${ilrLevel} learners.

${phaseDescriptions[phase]}

Question types for this phase: ${questionTypes[phase].join(', ')}

CRITICAL Rules for QUALITY questions:
- Questions must be directly answerable from the text
- Include both Arabic and English versions
- QUALITY over QUANTITY - fewer excellent questions are better than many mediocre ones
- Match difficulty to ILR ${ilrLevel}

MULTIPLE CHOICE FORMAT (4 options):
- Option A: THE CORRECT ANSWER - definitively correct based on the text
- Option B: PLAUSIBLE ANSWER - close/almost right, tests nuanced understanding (partially true but not the best answer)
- Option C: WRONG ANSWER - incorrect but somewhat related to the topic
- Option D: CLEARLY WRONG - obviously incorrect distractor

This structure tests true comprehension, not just recognition. The learner must understand WHY the correct answer is better than the plausible one.`;

    const prompt = `Create ${count} HIGH-QUALITY ${phase}-listening comprehension questions for this Arabic text about "${topic}".

PRIORITIZE QUALITY. Each question should test genuine understanding, not trivial facts.

${existingQuestions.length > 0 ? `Avoid these topics already covered: ${existingQuestions.map(q => q.skill).join(', ')}\n` : ''}

Return JSON array where each question has:
- type: "multiple_choice" | "true_false"
- skill: one of ${JSON.stringify(questionTypes[phase])}
- question_ar: Arabic question text
- question_en: English translation
- options: array of 4 items: [{id: "a", text_ar, text_en, is_correct: true}, {id: "b", text_ar, text_en, is_correct: false, distractor_type: "plausible"}, {id: "c", text_ar, text_en, is_correct: false, distractor_type: "wrong"}, {id: "d", text_ar, text_en, is_correct: false, distractor_type: "clearly_wrong"}]
- correct_answer: boolean (for true_false)
- explanation_ar, explanation_en: explain why correct answer is right AND why the plausible answer is not the best choice
${phase === 'while' ? '- timestamp_percent: number 0-1 indicating when in audio this appears' : ''}

Text:
${transcript}`;

    log.log(`Generating ${count} ${phase}-listening questions`);

    const result = await this.json({
      prompt,
      systemPrompt,
      temperature: 0.7,
      maxTokens: 4096,
      ...options
    });

    log.log('LLM response received, parsing questions...');

    // Validate and clean up questions
    let questions = result.data || [];

    log.log('Initial questions type:', Array.isArray(questions) ? 'array' : typeof questions,
            'keys:', questions && typeof questions === 'object' ? Object.keys(questions).slice(0, 5) : 'N/A');

    // Handle case where LLM wraps array in an object like {"questions": [...]}
    if (!Array.isArray(questions) && questions && typeof questions === 'object') {
      // Try common wrapper keys in priority order
      const wrapperKeys = [
        'questions',
        'items',
        'data',
        // Phase-specific keys the LLM sometimes uses
        'pre_listening_questions',
        'while_listening_questions',
        'post_listening_questions',
        'preListeningQuestions',
        'whileListeningQuestions',
        'postListeningQuestions',
        // Generic variations
        'comprehension_questions',
        'quiz_questions',
        'quiz',
        'results'
      ];

      let extracted = false;
      for (const key of wrapperKeys) {
        if (Array.isArray(questions[key])) {
          log.log(`Extracted questions from "${key}" key, count:`, questions[key].length);
          questions = questions[key];
          extracted = true;
          break;
        }
      }

      // If no known key found, try to find any array in the object
      if (!extracted) {
        const arrayKey = Object.keys(questions).find(k => Array.isArray(questions[k]));
        if (arrayKey) {
          log.log(`Extracted questions from unknown key "${arrayKey}", count:`, questions[arrayKey].length);
          questions = questions[arrayKey];
          extracted = true;
        }
      }

      if (!extracted) {
        log.warn('Could not find questions array in object. Keys:', Object.keys(questions));
        questions = [];
      }
    } else if (!Array.isArray(questions)) {
      log.warn('LLM response was not usable, type:', typeof questions, 'value:', questions);
      questions = [];
    }

    if (questions.length === 0) {
      log.warn(`No questions generated for phase: ${phase}. Response:`, result.text?.substring(0, 200));
    } else {
      log.log(`Generated ${questions.length} questions for phase: ${phase}`);
    }

    // Add IDs and ensure required fields
    questions = questions.map((q, i) => ({
      id: `${phase}-${i + 1}`,
      type: q.type || 'multiple_choice',
      timing: phase,
      skill: q.skill || questionTypes[phase][0],
      question_text: {
        ar: q.question_ar || q.question_text?.ar || '',
        en: q.question_en || q.question_text?.en || ''
      },
      options: q.options || [],
      correct_answer: q.correct_answer,
      explanation: {
        ar: q.explanation_ar || q.explanation?.ar || '',
        en: q.explanation_en || q.explanation?.en || ''
      },
      timestamp_percent: q.timestamp_percent,
      ...q
    }));

    return questions;
  }

  /**
   * Extract key vocabulary from text
   */
  async extractVocabulary(transcript, options = {}) {
    const { count = 10, ilrLevel = 2.0 } = options;

    const systemPrompt = `You are an expert Arabic vocabulary instructor. Extract key vocabulary items that are:
1. Important for understanding the text
2. Appropriate for ILR ${ilrLevel} learners
3. Likely to be new or challenging`;

    const prompt = `Extract ${count} key vocabulary items from this Arabic text.

Return JSON array where each item has:
- word_ar: the Arabic word
- word_en: English translation
- root: Arabic root (e.g., "ك-ت-ب")
- pos: part of speech
- definition_ar: brief Arabic definition
- definition_en: brief English definition
- example_ar: example sentence from the text
- example_en: English translation of example

Text:
${transcript}`;

    const result = await this.json({
      prompt,
      systemPrompt,
      temperature: 0.3,
      ...options
    });

    const vocabulary = result.data || [];
    log.log('extractVocabulary result:', {
      hasData: !!result.data,
      isArray: Array.isArray(vocabulary),
      length: vocabulary.length,
      firstItem: vocabulary[0] || 'EMPTY'
    });
    return vocabulary;
  }

  /**
   * Evaluate search results for language learning quality
   * @param {Array} videos - Video metadata array
   * @param {Object} options - Evaluation options
   * @returns {Promise<Array>} Ranked and evaluated videos
   */
  async evaluateSearchResults(videos, options = {}) {
    const {
      targetIlr = 2.0,
      topic = 'general',
      maxResults = 6
    } = options;

    if (!videos || videos.length === 0) {
      return [];
    }

    // Prepare video summaries for LLM evaluation
    const videoSummaries = videos.slice(0, 12).map((v, i) => ({
      index: i,
      title: v.title,
      channel: v.channel,
      duration: v.duration,
      description: v.description?.substring(0, 200) || ''
    }));

    const systemPrompt = `You are an expert Arabic language instructor selecting content for learners at ILR level ${targetIlr}.

Evaluate YouTube videos for Arabic language learning suitability. Consider:
- Clear audio quality (news channels, educational content = good)
- Appropriate complexity for ILR ${targetIlr}
- Useful for topic: ${topic}
- Avoid: music videos, very short clips, non-educational entertainment

Rate each video 1-10 for language learning value and estimate ILR level.`;

    const prompt = `Evaluate these Arabic YouTube videos for language learning:

${JSON.stringify(videoSummaries, null, 2)}

Return JSON array with objects containing:
- index: original video index
- score: 1-10 learning value
- estimatedIlr: estimated ILR level (1.0-3.5)
- suitable: boolean - good for ILR ${targetIlr} learners
- reason: brief explanation (20 words max)

Order by score descending. Include only videos scoring 5+.`;

    try {
      const result = await this.json({
        prompt,
        systemPrompt,
        temperature: 0.3
      });

      if (!result.data || !Array.isArray(result.data)) {
        log.warn('Invalid evaluation response, returning original videos');
        return videos.slice(0, maxResults);
      }

      // Merge evaluation data with original videos
      const evaluated = result.data
        .filter(e => e.suitable !== false && e.score >= 5)
        .slice(0, maxResults)
        .map(e => {
          const original = videos[e.index];
          if (!original) return null;

          return {
            ...original,
            evaluation: {
              score: e.score,
              estimatedIlr: e.estimatedIlr,
              suitable: e.suitable,
              reason: e.reason
            }
          };
        })
        .filter(Boolean);

      log.log(`Evaluated ${videos.length} videos, ${evaluated.length} suitable`);
      return evaluated;

    } catch (error) {
      log.warn('Evaluation failed, returning original videos:', error.message);
      return videos.slice(0, maxResults);
    }
  }

  /**
   * Generate optimal search queries for content discovery
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Suggested search queries
   */
  async generateSearchQueries(options = {}) {
    const {
      targetIlr = 2.0,
      topic = 'general',
      count = 5
    } = options;

    const topicDescriptions = {
      economy: 'economic news, financial reports, business discussions',
      politics: 'political analysis, government news, international relations',
      culture: 'arts, literature, traditions, social customs',
      science: 'scientific discoveries, technology, research',
      society: 'social issues, daily life, community',
      health: 'medical news, wellness, healthcare',
      education: 'learning, schools, academic topics',
      general: 'news, interviews, documentaries'
    };

    const systemPrompt = `You are an expert in finding Arabic learning content on YouTube.
Generate search queries that will find high-quality Arabic content suitable for ILR ${targetIlr} learners.`;

    const prompt = `Generate ${count} YouTube search queries in Arabic to find content about: ${topicDescriptions[topic] || topicDescriptions.general}

Requirements:
- Queries should be in Arabic
- Target content appropriate for ILR level ${targetIlr}
- Focus on clear spoken Arabic (news, interviews, educational)
- Avoid music, entertainment, children's content

Return JSON array of objects with:
- query: the Arabic search query
- description: what type of content it will find (English)
- expectedIlr: expected ILR range`;

    try {
      const result = await this.json({
        prompt,
        systemPrompt,
        temperature: 0.7
      });

      return result.data || [];
    } catch (error) {
      log.warn('Query generation failed:', error.message);
      return [];
    }
  }
}

// Singleton instance
const llmClient = new LLMClient();

export { llmClient, LLMClient, PROVIDERS };
