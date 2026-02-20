/**
 * LLM Handler
 * Proxies requests to Google AI Studio, Groq, Cerebras, and OpenRouter
 * System default: Google Gemini (owner key)
 * Users with own keys: unlock all providers for unlimited usage
 */

import { getUserApiKey } from './auth.js';

// Maximum prompt length to prevent abuse
const MAX_PROMPT_LENGTH = 100000;
const MAX_SYSTEM_PROMPT_LENGTH = 10000;

// Quota limits per tier
const QUOTA_LIMITS = {
  anonymous: 10,      // 10 requests/day without login
  authenticated: 50,  // 50 requests/day with login + system keys
  own_keys: Infinity  // Unlimited with own keys
};

// Allowed models per provider (prevent model injection)
const ALLOWED_MODELS = {
  google: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'allam-2-7b', 'qwen-qwq-32b'],
  cerebras: ['llama-3.3-70b', 'qwen-3-32b'],
  openrouter: [
    'google/gemini-2.0-flash-exp:free',
    'google/gemma-3-27b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'deepseek/deepseek-r1-0528:free',
    'qwen/qwen3-32b:free'
  ]
};

/**
 * Handle LLM API requests
 */
export async function handleLLM(request, env, url, origin, user = null) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  const path = url.pathname.replace('/api/llm/', '');

  // Parse body with error handling
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
  }

  // Validate body is an object
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Request body must be an object' }, 400, origin);
  }

  // Resolve API key: user's own key (if authenticated) → system key (fallback)
  let userApiKey = null;
  let usingOwnKey = false;
  if (user && env.DB && env.JWT_SECRET) {
    userApiKey = await getUserApiKey(env.DB, parseInt(user.sub), path, env.JWT_SECRET);
    if (userApiKey) usingOwnKey = true;
  }

  // Non-Google providers require user's own key (no system fallback)
  if (path !== 'google' && !usingOwnKey) {
    return jsonResponse({
      error: `Add your own ${path} API key in Settings to use this provider`,
      code: 'OWN_KEY_REQUIRED'
    }, 403, origin);
  }

  // Enforce server-side quota (skip for own-key users)
  if (env.DB && !usingOwnKey) {
    const quotaCheck = await checkQuota(env.DB, user, path);
    if (!quotaCheck.allowed) {
      return jsonResponse({
        error: 'Daily quota exceeded',
        code: 'QUOTA_EXCEEDED',
        limit: quotaCheck.limit,
        used: quotaCheck.used,
        tier: quotaCheck.tier
      }, 429, origin);
    }
  }

  try {
    let result;
    switch (path) {
      case 'google':
        result = await handleGoogle(body, env, origin, userApiKey);
        break;

      case 'groq':
        result = await handleGroq(body, origin, userApiKey);
        break;

      case 'cerebras':
        result = await handleCerebras(body, origin, userApiKey);
        break;

      case 'openrouter':
        result = await handleOpenRouter(body, origin, userApiKey);
        break;

      default:
        return jsonResponse({ error: 'Unknown LLM provider' }, 404, origin);
    }

    // Record usage on successful requests (2xx status)
    if (env.DB && result.status >= 200 && result.status < 300) {
      const userId = user ? parseInt(user.sub) : null;
      recordUsage(env.DB, userId, path).catch(e => console.error('Usage recording failed:', e));
    }

    return result;
  } catch (error) {
    console.error('LLM handler error:', error);
    return jsonResponse({ error: 'LLM request failed' }, 500, origin);
  }
}

/**
 * Check if user has remaining quota
 */
async function checkQuota(db, user, provider) {
  const today = new Date().toISOString().split('T')[0];
  const userId = user ? parseInt(user.sub) : null;
  const tier = user ? 'authenticated' : 'anonymous';
  const limit = QUOTA_LIMITS[tier];

  try {
    let used = 0;
    if (userId) {
      const row = await db.prepare(
        'SELECT SUM(request_count) as total FROM usage_log WHERE user_id = ? AND date = ?'
      ).bind(userId, today).first();
      used = row?.total || 0;
    }

    return { allowed: used < limit, used, limit, tier };
  } catch (e) {
    console.error('Quota check failed:', e);
    return { allowed: true, used: 0, limit, tier };
  }
}

/**
 * Record usage after a successful LLM request
 */
async function recordUsage(db, userId, provider) {
  if (!userId) return;

  const today = new Date().toISOString().split('T')[0];

  await db.prepare(`
    INSERT INTO usage_log (user_id, provider, request_count, date)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(user_id, date, provider) DO UPDATE SET
      request_count = request_count + 1
  `).bind(userId, provider, today).run();
}

/**
 * Validate prompt inputs
 */
function validatePromptInput(prompt, systemPrompt) {
  if (!prompt || typeof prompt !== 'string') {
    return { valid: false, error: 'Missing or invalid prompt' };
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { valid: false, error: `Prompt too long (max ${MAX_PROMPT_LENGTH} characters)` };
  }

  if (systemPrompt !== undefined) {
    if (typeof systemPrompt !== 'string') {
      return { valid: false, error: 'systemPrompt must be a string' };
    }
    if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
      return { valid: false, error: `System prompt too long (max ${MAX_SYSTEM_PROMPT_LENGTH} characters)` };
    }
  }

  return { valid: true };
}

/**
 * Validate model name against allowed list
 */
function validateModel(model, provider) {
  const allowed = ALLOWED_MODELS[provider];
  if (!allowed) return false;
  return allowed.includes(model);
}

/**
 * Parse rate limit error from API response
 */
function parseRateLimitError(status, errorBody) {
  if (status === 429) {
    let retryAfter = null;
    try {
      const parsed = JSON.parse(errorBody);
      retryAfter = parsed.error?.retry_after || parsed.retry_after || 60;
    } catch {
      retryAfter = 60;
    }
    return { error: 'Rate limit exceeded', retryAfter, code: 'RATE_LIMITED' };
  }
  return null;
}

// ─── Provider Handlers ────────────────────────────────────────

/**
 * Handle Google AI Studio (Gemini) requests
 */
async function handleGoogle(body, env, origin, userApiKey = null) {
  const apiKey = userApiKey || env.GOOGLE_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'Google API key not configured' }, 503, origin);
  }

  const { prompt, model = 'gemini-2.0-flash', temperature = 0.7, maxTokens = 2048 } = body;

  const validation = validatePromptInput(prompt, body.systemPrompt);
  if (!validation.valid) return jsonResponse({ error: validation.error }, 400, origin);

  if (!validateModel(model, 'google')) {
    return jsonResponse({ error: 'Invalid or unsupported model' }, 400, origin);
  }

  const safeTemperature = Math.max(0, Math.min(2, Number(temperature) || 0.7));
  const safeMaxTokens = Math.max(1, Math.min(8192, Math.floor(Number(maxTokens) || 2048)));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(body.systemPrompt ? { systemInstruction: { parts: [{ text: body.systemPrompt }] } } : {}),
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: safeTemperature,
          maxOutputTokens: safeMaxTokens,
          responseMimeType: body.jsonMode ? 'application/json' : 'text/plain'
        }
      })
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Google API error:', errorBody);

    const rateLimitError = parseRateLimitError(response.status, errorBody);
    if (rateLimitError) return jsonResponse(rateLimitError, 429, origin);

    if (response.status === 403 && errorBody.includes('quota')) {
      return jsonResponse({ error: 'API quota exceeded', code: 'QUOTA_EXCEEDED' }, 429, origin);
    }

    return jsonResponse({ error: 'Google API request failed' }, response.status >= 500 ? 502 : response.status, origin);
  }

  const data = await response.json();

  if (data.candidates?.[0]?.finishReason === 'SAFETY') {
    return jsonResponse({ provider: 'google', model, text: '', blocked: true, reason: 'Content blocked by safety filters' }, 200, origin);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  return jsonResponse({
    provider: 'google', model, text,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0
    }
  }, 200, origin);
}

/**
 * Handle Groq requests (user key only)
 */
async function handleGroq(body, origin, userApiKey) {
  const { prompt, model = 'llama-3.3-70b-versatile', temperature = 0.7, maxTokens = 2048, systemPrompt } = body;

  const validation = validatePromptInput(prompt, systemPrompt);
  if (!validation.valid) return jsonResponse({ error: validation.error }, 400, origin);

  if (!validateModel(model, 'groq')) {
    return jsonResponse({ error: 'Invalid or unsupported model' }, 400, origin);
  }

  const safeTemperature = Math.max(0, Math.min(2, Number(temperature) || 0.7));
  const safeMaxTokens = Math.max(1, Math.min(32768, Math.floor(Number(maxTokens) || 2048)));

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userApiKey}`
    },
    body: JSON.stringify({
      model, messages, temperature: safeTemperature, max_tokens: safeMaxTokens,
      response_format: body.jsonMode ? { type: 'json_object' } : undefined
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Groq API error:', errorBody);

    const rateLimitError = parseRateLimitError(response.status, errorBody);
    if (rateLimitError) return jsonResponse(rateLimitError, 429, origin);

    return jsonResponse({ error: 'Groq API request failed' }, response.status >= 500 ? 502 : response.status, origin);
  }

  const data = await response.json();

  return jsonResponse({
    provider: 'groq', model,
    text: data.choices?.[0]?.message?.content || '',
    usage: {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0
    }
  }, 200, origin);
}

/**
 * Handle Cerebras requests (user key only)
 * Cerebras uses OpenAI-compatible API
 */
async function handleCerebras(body, origin, userApiKey) {
  const { prompt, model = 'llama-3.3-70b', temperature = 0.7, maxTokens = 2048, systemPrompt } = body;

  const validation = validatePromptInput(prompt, systemPrompt);
  if (!validation.valid) return jsonResponse({ error: validation.error }, 400, origin);

  if (!validateModel(model, 'cerebras')) {
    return jsonResponse({ error: 'Invalid or unsupported model' }, 400, origin);
  }

  const safeTemperature = Math.max(0, Math.min(2, Number(temperature) || 0.7));
  const safeMaxTokens = Math.max(1, Math.min(8192, Math.floor(Number(maxTokens) || 2048)));

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userApiKey}`
    },
    body: JSON.stringify({
      model, messages, temperature: safeTemperature, max_tokens: safeMaxTokens,
      response_format: body.jsonMode ? { type: 'json_object' } : undefined
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Cerebras API error:', errorBody);

    const rateLimitError = parseRateLimitError(response.status, errorBody);
    if (rateLimitError) return jsonResponse(rateLimitError, 429, origin);

    return jsonResponse({ error: 'Cerebras API request failed' }, response.status >= 500 ? 502 : response.status, origin);
  }

  const data = await response.json();

  return jsonResponse({
    provider: 'cerebras', model,
    text: data.choices?.[0]?.message?.content || '',
    usage: {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0
    }
  }, 200, origin);
}

/**
 * Handle OpenRouter requests (user key only)
 */
async function handleOpenRouter(body, origin, userApiKey) {
  const { prompt, model = 'google/gemini-2.0-flash-exp:free', temperature = 0.7, maxTokens = 2048, systemPrompt } = body;

  const validation = validatePromptInput(prompt, systemPrompt);
  if (!validation.valid) return jsonResponse({ error: validation.error }, 400, origin);

  if (!validateModel(model, 'openrouter')) {
    return jsonResponse({ error: 'Invalid or unsupported model' }, 400, origin);
  }

  const safeTemperature = Math.max(0, Math.min(2, Number(temperature) || 0.7));
  const safeMaxTokens = Math.max(1, Math.min(8192, Math.floor(Number(maxTokens) || 2048)));

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userApiKey}`,
      'HTTP-Referer': 'https://jeranaias.github.io/tanaghum',
      'X-Title': 'Tanaghum'
    },
    body: JSON.stringify({
      model, messages, temperature: safeTemperature, max_tokens: safeMaxTokens
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('OpenRouter API error:', errorBody);

    const rateLimitError = parseRateLimitError(response.status, errorBody);
    if (rateLimitError) return jsonResponse(rateLimitError, 429, origin);

    if (response.status === 402) {
      return jsonResponse({ error: 'API credits exhausted', code: 'CREDITS_EXHAUSTED' }, 429, origin);
    }

    return jsonResponse({ error: 'OpenRouter API request failed' }, response.status >= 500 ? 502 : response.status, origin);
  }

  const data = await response.json();

  return jsonResponse({
    provider: 'openrouter', model,
    text: data.choices?.[0]?.message?.content || '',
    usage: {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0
    }
  }, 200, origin);
}

/**
 * JSON response helper
 */
function jsonResponse(data, status, origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  return new Response(JSON.stringify(data), { status, headers });
}
