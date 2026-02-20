/**
 * Tanaghum Configuration
 * Central configuration for API endpoints, limits, and feature flags
 */

const Config = {
  // Cloudflare Worker URL (update after deployment)
  WORKER_URL: 'https://tanaghum-worker.jmathdog.workers.dev',

  // API Endpoints (via Worker)
  API: {
    YOUTUBE_CAPTIONS: '/api/youtube/captions',
    YOUTUBE_METADATA: '/api/youtube/metadata',
    YOUTUBE_AUDIO: '/api/youtube/audio',
    LLM_GOOGLE: '/api/llm/google',
    LLM_GROQ: '/api/llm/groq',
    LLM_OPENROUTER: '/api/llm/openrouter',
    TTS: '/api/tts',
    AUTH_GOOGLE: '/api/auth/google',
    AUTH_ME: '/api/auth/me',
    USER_KEYS: '/api/user/keys',
    USER_QUOTA: '/api/user/quota'
  },

  // Google OAuth Client ID
  GOOGLE_CLIENT_ID: '569116254417-6r3dtom9epvhtulmv999dldemgl6gimq.apps.googleusercontent.com',

  // LLM Provider Configuration
  LLM: {
    providers: {
      google: {
        name: 'Google AI Studio',
        model: 'gemini-2.0-flash',
        dailyLimit: 250,
        priority: 1
      },
      groq: {
        name: 'Groq',
        model: 'llama-3.3-70b-versatile',
        dailyLimit: 1000,
        priority: 2
      },
      openrouter: {
        name: 'OpenRouter',
        model: 'google/gemini-2.0-flash-exp:free',
        dailyLimit: 50,
        priority: 3
      }
    },
    // Fallback order
    fallbackOrder: ['google', 'groq', 'openrouter'],
    // Temperature for different tasks
    temperature: {
      transcription_correction: 0.1,
      question_generation: 0.7,
      translation: 0.3
    }
  },

  // Whisper Configuration
  WHISPER: {
    model: 'Xenova/whisper-small',
    task: 'transcribe',
    language: 'ar',
    chunkLengthS: 30,
    strideS: 5,
    // WebGPU preferred, fallback to WASM
    backends: ['webgpu', 'wasm']
  },

  // Audio Limits
  AUDIO: {
    maxDurationSeconds: 600, // 10 minutes hard limit
    recommendedMaxSeconds: 300, // 5 minutes recommended
    minDurationSeconds: 5, // Allow short clips
    maxFileSizeMB: 100,
    supportedFormats: ['mp3', 'wav', 'ogg', 'webm', 'm4a', 'aac'],
    targetSampleRate: 16000
  },

  // ILR Levels
  ILR: {
    levels: [1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
    defaultLevel: 2.0,
    labels: {
      '1.0': 'Elementary',
      '1.5': 'Elementary+',
      '2.0': 'Limited Working',
      '2.5': 'Limited Working+',
      '3.0': 'General Professional',
      '3.5': 'General Professional+'
    }
  },

  // Topic Categories
  TOPICS: [
    { id: 'economy', label_en: 'Economy', label_ar: 'الاقتصاد', icon: 'economy.svg' },
    { id: 'politics', label_en: 'Politics', label_ar: 'السياسة', icon: 'politics.svg' },
    { id: 'culture', label_en: 'Culture', label_ar: 'الثقافة', icon: 'culture.svg' },
    { id: 'science', label_en: 'Science', label_ar: 'العلوم', icon: 'science.svg' },
    { id: 'society', label_en: 'Society', label_ar: 'المجتمع', icon: 'society.svg' },
    { id: 'health', label_en: 'Health', label_ar: 'الصحة', icon: 'health.svg' },
    { id: 'education', label_en: 'Education', label_ar: 'التعليم', icon: 'education.svg' },
    { id: 'environment', label_en: 'Environment', label_ar: 'البيئة', icon: 'environment.svg' },
    { id: 'general', label_en: 'General', label_ar: 'عام', icon: null }
  ],

  // Dialect Detection
  DIALECTS: [
    { id: 'msa', label_en: 'Modern Standard Arabic', label_ar: 'الفصحى الحديثة' },
    { id: 'egyptian', label_en: 'Egyptian', label_ar: 'المصرية' },
    { id: 'levantine', label_en: 'Levantine', label_ar: 'الشامية' },
    { id: 'gulf', label_en: 'Gulf', label_ar: 'الخليجية' },
    { id: 'maghrebi', label_en: 'Maghrebi', label_ar: 'المغاربية' }
  ],

  // Question Configuration
  QUESTIONS: {
    counts: {
      pre: { min: 2, max: 3 },
      while: { min: 8, max: 12 },
      post: { min: 4, max: 6 }
    },
    types: ['multiple_choice', 'true_false', 'fill_blank', 'open_ended'],
    skills: [
      'prediction', 'schema_activation', 'vocabulary_preview',
      'main_idea', 'details', 'sequence', 'inference',
      'vocabulary_in_context', 'speaker_attitude', 'synthesis'
    ]
  },

  // Playback Settings
  PLAYBACK: {
    speeds: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
    defaultSpeed: 1.0,
    loopPaddingMs: 200,
    seekStepSeconds: 5
  },

  // Storage Keys
  STORAGE: {
    lessons: 'tanaghum_lessons',
    settings: 'tanaghum_settings',
    quotas: 'tanaghum_quotas',
    whisperCache: 'tanaghum_whisper',
    auth: 'tanaghum_auth'
  },

  // Feature Flags
  FEATURES: {
    whisperEnabled: true,
    dialectDetection: true,
    communityGallery: true,
    offlineMode: true,
    authEnabled: true,
    debugMode: false
  },

  // UI Settings
  UI: {
    toastDuration: 4000,
    debounceMs: 300,
    animationDuration: 250
  }
};

// Freeze config to prevent accidental modification
Object.freeze(Config);
Object.freeze(Config.API);
Object.freeze(Config.LLM);
Object.freeze(Config.WHISPER);
Object.freeze(Config.AUDIO);
Object.freeze(Config.ILR);
Object.freeze(Config.QUESTIONS);
Object.freeze(Config.PLAYBACK);
Object.freeze(Config.STORAGE);
Object.freeze(Config.FEATURES);
Object.freeze(Config.UI);

export { Config };
