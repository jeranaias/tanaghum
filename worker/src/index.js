/**
 * Tanaghum Cloudflare Worker
 * Handles YouTube caption extraction, LLM API proxying, auth, and CORS
 */

import { handleYouTube } from './handlers/youtube.js';
import { handleLLM } from './handlers/llm.js';
import { handleProxy } from './handlers/proxy.js';
import { handleAuth, handleUserKeys, handleUserQuota, verifyJWT } from './handlers/auth.js';
import { handleGallery } from './handlers/gallery.js';

// CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

/**
 * Check if origin is allowed
 */
function isAllowedOrigin(origin, env) {
  if (!origin) return false;

  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);

  // Only allow localhost in development mode (explicitly enabled)
  if (env.ALLOW_LOCALHOST === 'true') {
    try {
      const originUrl = new URL(origin);
      if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
        return true;
      }
    } catch {
      // Invalid origin URL
    }
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
 * Extract user from JWT Authorization header (returns null if not authenticated)
 */
async function extractUser(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  if (!env.JWT_SECRET) return null;

  return verifyJWT(authHeader.slice(7), env.JWT_SECRET);
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
          version: '2.0.0',
          auth: !!env.JWT_SECRET,
          db: !!env.DB
        }, 200, origin);
      }

      // Auth endpoints (no user context needed — these create the user context)
      if (path.startsWith('/api/auth/')) {
        return handleAuth(request, env, url, origin);
      }

      // Extract authenticated user for all subsequent routes
      const user = await extractUser(request, env);

      // User key management
      if (path.startsWith('/api/user/keys')) {
        return handleUserKeys(request, env, url, origin, user);
      }

      // User quota
      if (path === '/api/user/quota') {
        return handleUserQuota(request, env, origin, user);
      }

      // Gallery endpoints
      if (path.startsWith('/api/gallery/')) {
        return handleGallery(request, env, url, origin, user);
      }

      // YouTube endpoints
      if (path.startsWith('/api/youtube/')) {
        return handleYouTube(request, env, url, origin);
      }

      // LLM endpoints (pass user for key lookup + quota)
      if (path.startsWith('/api/llm/')) {
        return handleLLM(request, env, url, origin, user);
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

        // Validate text length to prevent abuse
        if (text.length > 500) {
          return errorResponse('Text too long (max 500 characters)', 400, origin);
        }

        // Validate language code format (2-5 letter codes like 'ar', 'en', 'zh-CN')
        if (!/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,3})?$/.test(lang)) {
          return errorResponse('Invalid language code', 400, origin);
        }

        // Proxy to Google Translate TTS
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
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
      // Don't expose internal error details to clients
      const safeMessage = error.name === 'SyntaxError'
        ? 'Invalid request format'
        : 'Internal server error';
      return errorResponse(safeMessage, 500, origin);
    }
  }
};
