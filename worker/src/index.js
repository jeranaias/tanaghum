/**
 * Tanaghum Cloudflare Worker
 * Handles YouTube caption extraction, LLM API proxying, and CORS
 */

import { handleYouTube } from './handlers/youtube.js';
import { handleLLM } from './handlers/llm.js';
import { handleProxy } from './handlers/proxy.js';

// CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

/**
 * Check if origin is allowed
 */
function isAllowedOrigin(origin, env) {
  if (!origin) return false;

  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim());

  // Allow localhost in development
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

/**
 * Create CORS response
 */
function corsResponse(response, origin) {
  const headers = new Headers(response.headers);

  headers.set('Access-Control-Allow-Origin', origin || '*');
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Create JSON response
 */
function jsonResponse(data, status = 200, origin = '*') {
  return corsResponse(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    }),
    origin
  );
}

/**
 * Create error response
 */
function errorResponse(message, status = 500, origin = '*') {
  return jsonResponse({ error: message }, status, origin);
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }), origin);
    }

    // Check origin for non-GET requests
    if (request.method !== 'GET' && !isAllowedOrigin(origin, env)) {
      return errorResponse('Origin not allowed', 403, origin);
    }

    try {
      const path = url.pathname;

      // Health check
      if (path === '/' || path === '/health') {
        return jsonResponse({
          status: 'ok',
          service: 'tanaghum-worker',
          version: '1.0.0'
        }, 200, origin);
      }

      // YouTube endpoints
      if (path.startsWith('/api/youtube/')) {
        return handleYouTube(request, env, url, origin);
      }

      // LLM endpoints
      if (path.startsWith('/api/llm/')) {
        return handleLLM(request, env, url, origin);
      }

      // Generic proxy
      if (path.startsWith('/api/proxy')) {
        return handleProxy(request, env, url, origin);
      }

      // TTS endpoint
      if (path === '/api/tts') {
        const text = url.searchParams.get('text');
        const lang = url.searchParams.get('lang') || 'ar';

        if (!text) {
          return errorResponse('Missing text parameter', 400, origin);
        }

        // Proxy to Google Translate TTS
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;
        const response = await fetch(ttsUrl);

        if (!response.ok) {
          return errorResponse('TTS request failed', response.status, origin);
        }

        return corsResponse(new Response(response.body, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' }
        }), origin);
      }

      // 404 for unknown routes
      return errorResponse('Not found', 404, origin);

    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse(error.message || 'Internal server error', 500, origin);
    }
  }
};
