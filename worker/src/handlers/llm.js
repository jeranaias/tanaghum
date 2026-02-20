/**
 * LLM Handler
 * Proxies requests to Google AI Studio, Groq, and OpenRouter
 */

// Maximum prompt length to prevent abuse
const MAX_PROMPT_LENGTH = 100000;
const MAX_SYSTEM_PROMPT_LENGTH = 10000;

// Allowed models per provider (prevent model injection)
const ALLOWED_MODELS = {
  google: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  openrouter: [
    'google/gemini-2.0-flash-exp:free',
    'google/gemini-2.0-flash-thinking-exp-1219:free',
    'google/gemma-2-9b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-r1:free'
  ]
};

/**
 * Handle LLM API requests
 */
export async function handleLLM(request, env, url, origin) {
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

  try {
    switch (path) {
      case 'google':
        return await handleGoogle(body, env, origin);

      case 'groq':
        return await handleGroq(body, env, origin);

      case 'openrouter':
        return await handleOpenRouter(body, env, origin);

      default:
        return jsonResponse({ error: 'Unknown LLM provider' }, 404, origin);
    }
  } catch (error) {
    console.error('LLM handler error:', error);
    // Don't expose internal error details
    return jsonResponse({ error: 'LLM request failed' }, 500, origin);
  }
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
      // Different APIs return retry info differently
      retryAfter = parsed.error?.retry_after || parsed.retry_after || 60;
    } catch {
      retryAfter = 60;
    }
    return {
      error: 'Rate limit exceeded',
      retryAfter,
      code: 'RATE_LIMITED'
    };
  }
  return null;
}

/**
 * Handle Google AI Studio (Gemini) requests
 */
async function handleGoogle(body, env, origin) {
  const apiKey = env.GOOGLE_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'Google API key not configured' }, 503, origin);
  }

  const { prompt, model = 'gemini-2.0-flash', temperature = 0.7, maxTokens = 2048 } = body;

  // Validate prompt
  const validation = validatePromptInput(prompt, body.systemPrompt);
  if (!validation.valid) {
    return jsonResponse({ error: validation.error }, 400, origin);
  }

  // Validate model
  if (!validateModel(model, 'google')) {
    return jsonResponse({ error: 'Invalid or unsupported model' }, 400, origin);
  }

  // Validate temperature and maxTokens
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

    // Handle rate limiting
    const rateLimitError = parseRateLimitError(response.status, errorBody);
    if (rateLimitError) {
      return jsonResponse(rateLimitError, 429, origin);
    }

    // Handle quota exceeded
    if (response.status === 403 && errorBody.includes('quota')) {
      return jsonResponse({ error: 'API quota exceeded', code: 'QUOTA_EXCEEDED' }, 429, origin);
    }

    // Don't expose raw API error details
    return jsonResponse({ error: 'Google API request failed' }, response.status >= 500 ? 502 : response.status, origin);
  }

  const data = await response.json();

  // Check for blocked content
  if (data.candidates?.[0]?.finishReason === 'SAFETY') {
    return jsonResponse({
      provider: 'google',
      model,
      text: '',
      blocked: true,
      reason: 'Content blocked by safety filters'
    }, 200, origin);
  }

  // Extract text from response
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  return jsonResponse({
    provider: 'google',
    model,
    text,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0
    }
  }, 200, origin);
}

/**
 * Handle Groq requests
 */
async function handleGroq(body, env, origin) {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'Groq API key not configured' }, 503, origin);
  }

  const {
    prompt,
    model = 'llama-3.3-70b-versatile',
    temperature = 0.7,
    maxTokens = 2048,
    systemPrompt
  } = body;

  // Validate prompt
  const validation = validatePromptInput(prompt, systemPrompt);
  if (!validation.valid) {
    return jsonResponse({ error: validation.error }, 400, origin);
  }

  // Validate model
  if (!validateModel(model, 'groq')) {
    return jsonResponse({ error: 'Invalid or unsupported model' }, 400, origin);
  }

  // Validate temperature and maxTokens
  const safeTemperature = Math.max(0, Math.min(2, Number(temperature) || 0.7));
  const safeMaxTokens = Math.max(1, Math.min(32768, Math.floor(Number(maxTokens) || 2048)));

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: safeTemperature,
      max_tokens: safeMaxTokens,
      response_format: body.jsonMode ? { type: 'json_object' } : undefined
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Groq API error:', errorBody);

    // Handle rate limiting
    const rateLimitError = parseRateLimitError(response.status, errorBody);
    if (rateLimitError) {
      return jsonResponse(rateLimitError, 429, origin);
    }

    return jsonResponse({ error: 'Groq API request failed' }, response.status >= 500 ? 502 : response.status, origin);
  }

  const data = await response.json();

  return jsonResponse({
    provider: 'groq',
    model,
    text: data.choices?.[0]?.message?.content || '',
    usage: {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0
    }
  }, 200, origin);
}

/**
 * Handle OpenRouter requests
 */
async function handleOpenRouter(body, env, origin) {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'OpenRouter API key not configured' }, 503, origin);
  }

  const {
    prompt,
    model = 'google/gemini-2.0-flash-exp:free',
    temperature = 0.7,
    maxTokens = 2048,
    systemPrompt
  } = body;

  // Validate prompt
  const validation = validatePromptInput(prompt, systemPrompt);
  if (!validation.valid) {
    return jsonResponse({ error: validation.error }, 400, origin);
  }

  // Validate model
  if (!validateModel(model, 'openrouter')) {
    return jsonResponse({ error: 'Invalid or unsupported model' }, 400, origin);
  }

  // Validate temperature and maxTokens
  const safeTemperature = Math.max(0, Math.min(2, Number(temperature) || 0.7));
  const safeMaxTokens = Math.max(1, Math.min(8192, Math.floor(Number(maxTokens) || 2048)));

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://tanaghum.github.io',
      'X-Title': 'Tanaghum'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: safeTemperature,
      max_tokens: safeMaxTokens
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('OpenRouter API error:', errorBody);

    // Handle rate limiting
    const rateLimitError = parseRateLimitError(response.status, errorBody);
    if (rateLimitError) {
      return jsonResponse(rateLimitError, 429, origin);
    }

    // Handle credits exhausted
    if (response.status === 402) {
      return jsonResponse({ error: 'API credits exhausted', code: 'CREDITS_EXHAUSTED' }, 429, origin);
    }

    return jsonResponse({ error: 'OpenRouter API request failed' }, response.status >= 500 ? 502 : response.status, origin);
  }

  const data = await response.json();

  return jsonResponse({
    provider: 'openrouter',
    model,
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
