/**
 * Tanaghum LLM Client
 * Multi-provider LLM client with automatic fallback and quota tracking
 */

const LLM_CLIENT_VERSION = '2.1.0';

import { Config } from '../core/config.js';
import { EventBus, Events } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import { retry, createLogger, fetchWithRetry, getActionableError } from '../core/utils.js';

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
    dailyLimit: 50,        // Free models have decent limits
    rateLimit: 10,
    supportsJson: false,
    priority: 3
  },
  // Additional free OpenRouter models as fallbacks
  openrouter_llama: {
    name: 'OpenRouter Llama',
    endpoint: '/api/llm/openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    dailyLimit: 50,
    rateLimit: 10,
    supportsJson: false,
    priority: 4
  },
  openrouter_gemma: {
    name: 'OpenRouter Gemma',
    endpoint: '/api/llm/openrouter',
    model: 'google/gemma-2-9b-it:free',
    dailyLimit: 50,
    rateLimit: 10,
    supportsJson: false,
    priority: 5
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
    log.log(`LLM Client v${LLM_CLIENT_VERSION} initialized`);
  }

  /**
   * Load quotas from localStorage
   */
  loadQuotas() {
    const freshQuotas = {
      google: PROVIDERS.google.dailyLimit,
      groq: PROVIDERS.groq.dailyLimit,
      openrouter: PROVIDERS.openrouter.dailyLimit,
      openrouter_llama: PROVIDERS.openrouter_llama.dailyLimit,
      openrouter_gemma: PROVIDERS.openrouter_gemma.dailyLimit
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
   * Reset all quotas to their daily limits
   * Call this to restore quota if you've been rate-limited
   */
  resetQuotas() {
    log.log('Resetting all LLM quotas');
    for (const [id, config] of Object.entries(PROVIDERS)) {
      this.quotas[id] = config.dailyLimit;
    }
    this.saveQuotas();
    this.currentProvider = this.selectBestProvider();
    log.log('Quotas reset:', this.quotas);
    return this.getQuotaStatus();
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
      timeout = 45000, // 45 second timeout per request
      signal = null, // AbortSignal for cancellation
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

    // Make request with retry and timeout
    const makeRequest = async () => {
      const response = await fetchWithRetry(`${this.workerUrl}${providerConfig.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        timeout: timeout,
        maxRetries: retries,
        signal: signal
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
      const result = await makeRequest();

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

      // If user cancelled, don't fallback
      if (error.name === 'AbortError' && signal?.aborted) {
        log.log('Request cancelled by user');
        throw error;
      }

      // Determine if we should try fallback
      const shouldFallback = !provider; // Only fallback if not forcing a specific provider

      if (shouldFallback) {
        // Handle timeout - try next provider
        if (error.name === 'AbortError') {
          log.warn(`Provider ${providerId} timed out, trying next provider...`);
          EventBus.emit(Events.LLM_PROVIDER_SWITCH, {
            from: providerId,
            to: 'next',
            reason: 'timeout'
          });
        }
        // Only mark as exhausted for rate limit errors, not temporary failures
        else if (this.isRateLimitError(error)) {
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

      // Enhance error with actionable information
      const actionable = getActionableError(error);
      error.actionable = actionable;
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
      log.debug('Raw response (first 300):', jsonText.substring(0, 300));

      // Handle markdown code blocks
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
        log.log('Extracted from code block, length:', jsonText.length);
      }

      // Try to find JSON array or object if not cleanly formatted
      const trimmed = jsonText.trim();
      if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
        // Look for array pattern - use greedy match to get the full array
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

      // Clean up common issues before parsing
      jsonText = jsonText
        .replace(/,\s*}/g, '}')  // Remove trailing commas in objects
        .replace(/,\s*\]/g, ']') // Remove trailing commas in arrays
        .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        .trim();

      result.data = JSON.parse(jsonText);
      log.log('JSON parsed successfully, type:', Array.isArray(result.data) ? 'array' : typeof result.data);

      // If it's an object, try to unwrap common wrapper keys
      if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
        const wrapperKeys = ['vocabulary', 'items', 'words', 'data', 'results', 'questions'];
        for (const key of wrapperKeys) {
          if (Array.isArray(result.data[key])) {
            log.log(`Unwrapping array from "${key}" key`);
            result.data = result.data[key];
            break;
          }
        }
      }

    } catch (e) {
      log.warn('Failed to parse JSON response:', e.message);
      log.warn('Raw text (first 500 chars):', result.text?.substring(0, 500));

      // Last resort: try to extract individual JSON objects
      try {
        const objectMatches = result.text.match(/\{[^{}]*\}/g);
        if (objectMatches && objectMatches.length > 0) {
          const parsed = objectMatches.map(m => {
            try { return JSON.parse(m); } catch { return null; }
          }).filter(Boolean);
          if (parsed.length > 0) {
            log.log('Recovered', parsed.length, 'items from individual object matches');
            result.data = parsed;
          }
        }
      } catch (e2) {
        log.warn('Recovery parse also failed');
      }

      if (!result.data) {
        result.data = null;
      }
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

=== ABSOLUTE RULES - VIOLATION = REJECTION ===

RULE 1 - NO HALLUCINATION:
- ONLY ask about facts EXPLICITLY STATED in the text
- If the text does NOT mention something, do NOT ask about it
- BANNED topics (unless explicitly in text): international reaction, future predictions, humanitarian aid, rescue efforts, world response
- Before each question, mentally verify: "Can I point to the exact sentence that answers this?"

RULE 2 - LANGUAGE:
- text_ar: Arabic script ONLY (ا-ي)
- text_en: English/Latin ONLY (a-z)
- NO Chinese, Japanese, Korean, Cyrillic, or other scripts

RULE 3 - TRANSCRIPTION ERRORS:
- The text may have typos from speech-to-text
- Do NOT create vocabulary questions about misspelled words
- Focus on meaning, not spelling

RULE 4 - ANSWER VERIFICATION:
- Correct answer must be directly quotable or closely paraphrased from text
- If you cannot quote the text to justify an answer, DO NOT include that question

FORMAT (4 options):
- Option A: CORRECT - verifiable from text
- Option B: PLAUSIBLE but wrong
- Option C: WRONG but topically related
- Option D: CLEARLY WRONG

Fewer excellent questions > many questionable ones.`;

    const prompt = `Create ${count} HIGH-QUALITY ${phase}-listening comprehension questions for this Arabic text about "${topic}".

CRITICAL REMINDERS:
- ONLY ask about information EXPLICITLY stated in the text below
- Do NOT invent reactions, opinions, or events not mentioned
- Use ONLY Arabic (text_ar) and English (text_en) - NO other languages
- Correct answers must be VERIFIABLE from the text

${existingQuestions.length > 0 ? `Avoid these topics already covered: ${existingQuestions.map(q => q.skill).join(', ')}\n` : ''}

Return JSON array where each question has:
- type: "multiple_choice" | "true_false"
- skill: one of ${JSON.stringify(questionTypes[phase])}
- question_ar: Arabic question text (Arabic script only)
- question_en: English translation (English only)
- options: array of 4 items: [{id: "a", text_ar: "Arabic", text_en: "English", is_correct: true}, {id: "b", text_ar, text_en, is_correct: false, distractor_type: "plausible"}, {id: "c", text_ar, text_en, is_correct: false, distractor_type: "wrong"}, {id: "d", text_ar, text_en, is_correct: false, distractor_type: "clearly_wrong"}]
- correct_answer: boolean (for true_false)
- explanation_ar, explanation_en: explain why correct answer is right AND why the plausible answer is not the best choice
- distractor_explanations: object mapping each wrong option's text_en to a brief English explanation of why it is wrong. Example: {"option B text": "This is wrong because...", "option C text": "This is wrong because..."}
${phase === 'while' ? '- timestamp_percent: number 0-1 indicating when in audio this appears' : ''}

VERIFY: Before including any question, confirm the answer is IN THE TEXT.

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

    // Sanitize text - remove non-Arabic/non-English characters
    const sanitizeText = (text) => {
      if (!text) return '';
      const original = text;
      // Remove Chinese, Japanese, Korean, and other non-Arabic/Latin characters
      // Keep: Arabic (0600-06FF), Latin (0000-007F extended), punctuation, numbers
      const cleaned = text
        .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF]/g, '') // CJK
        .replace(/[\uAC00-\uD7AF]/g, '') // Korean
        .trim();
      if (cleaned !== original) {
        log.warn('Sanitized non-Arabic/Latin characters from text');
      }
      return cleaned;
    };

    // Clean up options - ensure proper structure and sanitize
    const cleanOptions = (options) => {
      if (!Array.isArray(options)) return [];
      return options.map((opt, idx) => {
        // Handle string options
        if (typeof opt === 'string') {
          return {
            id: String.fromCharCode(97 + idx), // a, b, c, d
            text_ar: sanitizeText(opt),
            text_en: sanitizeText(opt),
            is_correct: idx === 0
          };
        }
        // Handle object options
        return {
          id: opt.id || String.fromCharCode(97 + idx),
          text_ar: sanitizeText(opt.text_ar || opt.ar || opt.text || ''),
          text_en: sanitizeText(opt.text_en || opt.en || opt.text || ''),
          is_correct: opt.is_correct || false,
          distractor_type: opt.distractor_type || null
        };
      });
    };

    // Add IDs and ensure required fields
    // NOTE: We explicitly set all fields AFTER ...q spread to ensure our sanitized versions win
    questions = questions.map((q, i) => {
      const cleaned = {
        ...q, // Spread original first
        // Then overwrite with our sanitized/structured versions
        id: `${phase}-${i + 1}`,
        type: q.type || 'multiple_choice',
        timing: phase,
        skill: q.skill || questionTypes[phase][0],
        question_text: {
          ar: sanitizeText(q.question_ar || q.question_text?.ar || ''),
          en: sanitizeText(q.question_en || q.question_text?.en || '')
        },
        options: cleanOptions(q.options),
        correct_answer: q.correct_answer,
        explanation: {
          ar: sanitizeText(q.explanation_ar || q.explanation?.ar || ''),
          en: sanitizeText(q.explanation_en || q.explanation?.en || '')
        },
        distractor_explanations: q.distractor_explanations && typeof q.distractor_explanations === 'object'
          ? Object.fromEntries(
              Object.entries(q.distractor_explanations).map(([k, v]) => [k, sanitizeText(String(v))])
            )
          : null,
        timestamp_percent: q.timestamp_percent
      };
      return cleaned;
    });

    return questions;
  }

  /**
   * Extract key vocabulary from text
   */
  async extractVocabulary(transcript, options = {}) {
    const { count = 12, ilrLevel = 2.0 } = options;

    // Simplified, very explicit prompt
    const systemPrompt = `You extract Arabic vocabulary as JSON. Output ONLY valid JSON array. No explanations. No markdown. Arabic and English only.`;

    const prompt = `Extract ${count} Arabic vocabulary words from this text. Return a JSON array.

EXAMPLE OUTPUT FORMAT:
[
  {"word_ar": "زلزال", "word_en": "earthquake", "root": "ز-ل-ز-ل", "pos": "noun", "definition_en": "a shaking of the ground", "frequency": "medium"},
  {"word_ar": "ضحايا", "word_en": "victims", "root": "ض-ح-ي", "pos": "noun", "definition_en": "people harmed", "frequency": "high"}
]

Required fields for each word:
- word_ar: Arabic word
- word_en: English translation
- root: Arabic root with dashes
- pos: part of speech
- definition_en: brief English definition
- frequency: "high", "medium", or "low"

TEXT:
${transcript.substring(0, 2000)}

OUTPUT (JSON array only, no other text):`;

    log.log(`Starting vocabulary extraction, transcript length: ${transcript.length}`);

    let vocabulary = [];

    try {
      const result = await this.json({
        prompt,
        systemPrompt,
        temperature: 0.2,
        maxTokens: 3000,
        ...options
      });

      vocabulary = result.data || [];

      // Handle case where LLM wraps in object
      if (!Array.isArray(vocabulary) && vocabulary && typeof vocabulary === 'object') {
        log.log('Vocabulary wrapped in object, keys:', Object.keys(vocabulary));
        const keys = ['vocabulary', 'items', 'words', 'data', 'results', 'list'];
        for (const key of keys) {
          if (Array.isArray(vocabulary[key])) {
            log.log(`Unwrapping vocabulary from key: ${key}`);
            vocabulary = vocabulary[key];
            break;
          }
        }
        // If still not array, try first array-valued property
        if (!Array.isArray(vocabulary)) {
          const arrayKey = Object.keys(vocabulary).find(k => Array.isArray(vocabulary[k]));
          if (arrayKey) {
            log.log(`Unwrapping vocabulary from discovered key: ${arrayKey}`);
            vocabulary = vocabulary[arrayKey];
          }
        }
      }

      if (!Array.isArray(vocabulary)) {
        log.warn('Vocabulary still not array after unwrapping, type:', typeof vocabulary);
        vocabulary = [];
      }

    } catch (error) {
      log.error('Vocabulary extraction error:', error.message);
      vocabulary = [];
    }

    log.log(`Vocabulary extraction complete: ${vocabulary.length} items`);
    if (vocabulary.length === 0) {
      log.warn('Empty vocabulary array, using fallback');
      // Provide basic fallback vocabulary extracted from common news words
      // This ensures the vocab panel isn't completely empty when LLM fails
      vocabulary = this.getFallbackVocabulary(transcript);
    }

    return vocabulary;
  }

  /**
   * Get fallback vocabulary when LLM extraction fails
   * Extracts common Arabic words from the transcript using pattern matching
   */
  getFallbackVocabulary(transcript) {
    // Common high-frequency Arabic words with definitions
    const commonWords = {
      'زلزال': { en: 'earthquake', root: 'ز-ل-ز-ل', pos: 'noun', def: 'a shaking of the ground caused by movement of the earth' },
      'ضحايا': { en: 'victims', root: 'ض-ح-ي', pos: 'noun', def: 'people who are harmed or killed' },
      'منطقة': { en: 'area/region', root: 'ن-ط-ق', pos: 'noun', def: 'a particular geographic region' },
      'حكومة': { en: 'government', root: 'ح-ك-م', pos: 'noun', def: 'the governing body of a nation' },
      'الرئيس': { en: 'president', root: 'ر-أ-س', pos: 'noun', def: 'the head of state' },
      'قال': { en: 'said', root: 'ق-و-ل', pos: 'verb', def: 'to speak or utter words' },
      'أعلن': { en: 'announced', root: 'ع-ل-ن', pos: 'verb', def: 'to make a public declaration' },
      'بعد': { en: 'after', root: 'ب-ع-د', pos: 'preposition', def: 'following in time' },
      'خلال': { en: 'during', root: 'خ-ل-ل', pos: 'preposition', def: 'throughout the course of' },
      'أكثر': { en: 'more', root: 'ك-ث-ر', pos: 'adverb', def: 'to a greater degree' },
      'جديد': { en: 'new', root: 'ج-د-د', pos: 'adjective', def: 'recently made or discovered' },
      'كبير': { en: 'big/large', root: 'ك-ب-ر', pos: 'adjective', def: 'of considerable size' },
      'مدينة': { en: 'city', root: 'م-د-ن', pos: 'noun', def: 'a large town' },
      'دولة': { en: 'state/country', root: 'د-و-ل', pos: 'noun', def: 'a nation with its own government' },
      'شخص': { en: 'person', root: 'ش-خ-ص', pos: 'noun', def: 'a human being' },
      'عمل': { en: 'work', root: 'ع-م-ل', pos: 'noun/verb', def: 'activity involving effort' },
      'يوم': { en: 'day', root: 'ي-و-م', pos: 'noun', def: 'a 24-hour period' },
      'وقت': { en: 'time', root: 'و-ق-ت', pos: 'noun', def: 'the indefinite continued progress of existence' },
      'مشكلة': { en: 'problem', root: 'ش-ك-ل', pos: 'noun', def: 'a matter that is difficult to deal with' },
      'قرار': { en: 'decision', root: 'ق-ر-ر', pos: 'noun', def: 'a conclusion reached after consideration' }
    };

    const found = [];

    for (const [arabic, info] of Object.entries(commonWords)) {
      if (transcript.includes(arabic) && found.length < 10) {
        found.push({
          word_ar: arabic,
          word_en: info.en,
          root: info.root,
          pos: info.pos,
          definition_en: info.def,
          frequency: 'high'
        });
      }
    }

    log.log(`Fallback vocabulary: found ${found.length} common words`);
    return found;
  }

}

// Singleton instance
const llmClient = new LLMClient();

export { llmClient, LLMClient, PROVIDERS };
