/**
 * LLM Handler
 * Proxies requests to Google AI Studio, Groq, and OpenRouter
 */

/**
 * Handle LLM API requests
 */
export async function handleLLM(request, env, url, origin) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  const path = url.pathname.replace('/api/llm/', '');
  const body = await request.json();

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
    return jsonResponse({ error: error.message }, 500, origin);
  }
}

/**
 * Handle Google AI Studio (Gemini) requests
 */
async function handleGoogle(body, env, origin) {
  const apiKey = env.GOOGLE_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'Google API key not configured' }, 500, origin);
  }

  const { prompt, model = 'gemini-2.0-flash', temperature = 0.7, maxTokens = 2048 } = body;

  if (!prompt) {
    return jsonResponse({ error: 'Missing prompt' }, 400, origin);
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: body.jsonMode ? 'application/json' : 'text/plain'
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Google API error:', error);
    return jsonResponse({ error: 'Google API request failed', details: error }, response.status, origin);
  }

  const data = await response.json();

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
    return jsonResponse({ error: 'Groq API key not configured' }, 500, origin);
  }

  const {
    prompt,
    model = 'llama-3.3-70b-versatile',
    temperature = 0.7,
    maxTokens = 2048,
    systemPrompt
  } = body;

  if (!prompt) {
    return jsonResponse({ error: 'Missing prompt' }, 400, origin);
  }

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
      temperature,
      max_tokens: maxTokens,
      response_format: body.jsonMode ? { type: 'json_object' } : undefined
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Groq API error:', error);
    return jsonResponse({ error: 'Groq API request failed', details: error }, response.status, origin);
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
    return jsonResponse({ error: 'OpenRouter API key not configured' }, 500, origin);
  }

  const {
    prompt,
    model = 'google/gemini-2.0-flash-exp:free',
    temperature = 0.7,
    maxTokens = 2048,
    systemPrompt
  } = body;

  if (!prompt) {
    return jsonResponse({ error: 'Missing prompt' }, 400, origin);
  }

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
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenRouter API error:', error);
    return jsonResponse({ error: 'OpenRouter API request failed', details: error }, response.status, origin);
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
