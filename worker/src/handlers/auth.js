/**
 * Auth Handler
 * Google OAuth ID token validation + JWT session management
 */

// ─── Helpers ────────────────────────────────────────────────

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

// ─── JWT (HMAC-SHA256 via Web Crypto) ───────────────────────

function base64UrlEncode(data) {
  const str = typeof data === 'string' ? data : String.fromCharCode(...new Uint8Array(data));
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - padded.length % 4) % 4));
}

async function getHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };

  payload.iat = Math.floor(Date.now() / 1000);
  payload.exp = payload.iat + (7 * 24 * 60 * 60); // 7 days

  const signingInput = base64UrlEncode(JSON.stringify(header)) + '.' +
                       base64UrlEncode(JSON.stringify(payload));

  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(signingInput)
  );

  return signingInput + '.' + base64UrlEncode(signature);
}

export async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await getHmacKey(secret);
    const sigBytes = Uint8Array.from(base64UrlDecode(encodedSignature), c => c.charCodeAt(0));

    const valid = await crypto.subtle.verify(
      'HMAC', key, sigBytes, new TextEncoder().encode(signingInput)
    );
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));

    // Check expiration
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// ─── Key Encryption (AES-GCM) ──────────────────────────────

async function deriveEncryptionKey(secret, userId) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${secret}:${userId}`),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const salt = new TextEncoder().encode(`tanaghum-key-${userId}`);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptApiKey(plaintext, userId, secret) {
  const key = await deriveEncryptionKey(secret, userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return base64UrlEncode(combined);
}

export async function decryptApiKey(ciphertext, userId, secret) {
  try {
    const key = await deriveEncryptionKey(secret, userId);
    const data = Uint8Array.from(base64UrlDecode(ciphertext), c => c.charCodeAt(0));
    const iv = data.slice(0, 12);
    const encrypted = data.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

// ─── Google Token Validation ────────────────────────────────

async function verifyGoogleToken(idToken, clientId) {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!response.ok) return null;

    const payload = await response.json();

    if (payload.aud !== clientId) {
      console.error('Google token audience mismatch');
      return null;
    }
    if (payload.exp && Date.now() / 1000 > parseInt(payload.exp)) {
      console.error('Google token expired');
      return null;
    }

    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture || null
    };
  } catch (e) {
    console.error('Google token verification failed:', e);
    return null;
  }
}

// ─── Database Operations ────────────────────────────────────

async function upsertUser(db, googleUser) {
  const existing = await db.prepare(
    'SELECT * FROM users WHERE google_id = ?'
  ).bind(googleUser.googleId).first();

  if (existing) {
    await db.prepare(
      'UPDATE users SET last_login = datetime("now"), name = ?, picture = ? WHERE id = ?'
    ).bind(googleUser.name, googleUser.picture, existing.id).run();
    return existing;
  }

  const result = await db.prepare(
    'INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)'
  ).bind(googleUser.googleId, googleUser.email, googleUser.name, googleUser.picture).run();

  return {
    id: result.meta.last_row_id,
    google_id: googleUser.googleId,
    email: googleUser.email,
    name: googleUser.name,
    picture: googleUser.picture
  };
}

// ─── Route Handler ──────────────────────────────────────────

export async function handleAuth(request, env, url, origin) {
  const path = url.pathname.replace('/api/auth/', '');

  switch (path) {
    case 'google':
      return handleGoogleLogin(request, env, origin);
    case 'me':
      return handleGetUser(request, env, origin);
    default:
      return jsonResponse({ error: 'Unknown auth endpoint' }, 404, origin);
  }
}

// ─── POST /api/auth/google ──────────────────────────────────

async function handleGoogleLogin(request, env, origin) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, origin);
  }

  const { credential } = body;
  if (!credential) {
    return jsonResponse({ error: 'Missing credential' }, 400, origin);
  }

  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return jsonResponse({ error: 'Google OAuth not configured' }, 503, origin);
  }

  const googleUser = await verifyGoogleToken(credential, clientId);
  if (!googleUser) {
    return jsonResponse({ error: 'Invalid Google token' }, 401, origin);
  }

  const user = await upsertUser(env.DB, googleUser);

  const jwt = await createJWT({
    sub: String(user.id),
    email: user.email,
    name: user.name,
    picture: user.picture
  }, env.JWT_SECRET);

  return jsonResponse({
    token: jwt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture
    }
  }, 200, origin);
}

// ─── GET /api/auth/me ───────────────────────────────────────

async function handleGetUser(request, env, origin) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ authenticated: false }, 200, origin);
  }

  const payload = await verifyJWT(authHeader.slice(7), env.JWT_SECRET);
  if (!payload) {
    return jsonResponse({ authenticated: false }, 200, origin);
  }

  const user = await env.DB.prepare(
    'SELECT id, email, name, picture, created_at FROM users WHERE id = ?'
  ).bind(parseInt(payload.sub)).first();

  if (!user) {
    return jsonResponse({ authenticated: false }, 200, origin);
  }

  return jsonResponse({ authenticated: true, user }, 200, origin);
}

// ─── User API Key Management ────────────────────────────────

export async function handleUserKeys(request, env, url, origin, user) {
  if (!user) {
    return jsonResponse({ error: 'Authentication required' }, 401, origin);
  }

  const userId = parseInt(user.sub);
  const pathParts = url.pathname.replace('/api/user/keys', '').split('/').filter(Boolean);
  const provider = pathParts[0]; // e.g. 'google'

  const validProviders = ['google'];

  switch (request.method) {
    case 'GET': {
      // List all saved keys (masked)
      const keys = await env.DB.prepare(
        'SELECT provider, created_at, updated_at FROM user_keys WHERE user_id = ?'
      ).bind(userId).all();

      return jsonResponse({
        keys: keys.results.map(k => ({
          provider: k.provider,
          configured: true,
          created_at: k.created_at,
          updated_at: k.updated_at
        }))
      }, 200, origin);
    }

    case 'PUT': {
      if (!provider || !validProviders.includes(provider)) {
        return jsonResponse({ error: 'Invalid provider. Use: google' }, 400, origin);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400, origin);
      }

      const { apiKey } = body;
      if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 200) {
        return jsonResponse({ error: 'Invalid API key' }, 400, origin);
      }

      const encrypted = await encryptApiKey(apiKey, userId, env.JWT_SECRET);

      await env.DB.prepare(`
        INSERT INTO user_keys (user_id, provider, encrypted_key)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, provider) DO UPDATE SET
          encrypted_key = excluded.encrypted_key,
          updated_at = datetime('now')
      `).bind(userId, provider, encrypted).run();

      return jsonResponse({ success: true, provider }, 200, origin);
    }

    case 'DELETE': {
      if (!provider || !validProviders.includes(provider)) {
        return jsonResponse({ error: 'Invalid provider' }, 400, origin);
      }

      await env.DB.prepare(
        'DELETE FROM user_keys WHERE user_id = ? AND provider = ?'
      ).bind(userId, provider).run();

      return jsonResponse({ success: true, provider }, 200, origin);
    }

    default:
      return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }
}

// ─── User Quota ─────────────────────────────────────────────

export async function handleUserQuota(request, env, origin, user) {
  if (!user) {
    return jsonResponse({
      tier: 'anonymous',
      limit: 10,
      used: 0,
      remaining: 10
    }, 200, origin);
  }

  const userId = parseInt(user.sub);
  const today = new Date().toISOString().split('T')[0];

  // Check if user has own keys
  const ownKeys = await env.DB.prepare(
    'SELECT provider FROM user_keys WHERE user_id = ?'
  ).bind(userId).all();

  const ownKeyProviders = new Set(ownKeys.results.map(k => k.provider));

  // Get today's usage
  const usage = await env.DB.prepare(
    'SELECT provider, SUM(request_count) as requests, SUM(tokens_used) as tokens FROM usage_log WHERE user_id = ? AND date = ? GROUP BY provider'
  ).bind(userId, today).all();

  const totalRequests = usage.results.reduce((sum, u) => sum + (u.requests || 0), 0);
  const limit = 50; // authenticated with system keys

  return jsonResponse({
    tier: ownKeyProviders.size > 0 ? 'own_keys' : 'authenticated',
    date: today,
    limit,
    used: totalRequests,
    remaining: Math.max(0, limit - totalRequests),
    ownKeyProviders: [...ownKeyProviders],
    byProvider: usage.results
  }, 200, origin);
}

// ─── Get User's Decrypted API Key ───────────────────────────

export async function getUserApiKey(db, userId, provider, secret) {
  const row = await db.prepare(
    'SELECT encrypted_key FROM user_keys WHERE user_id = ? AND provider = ?'
  ).bind(userId, provider).first();

  if (!row) return null;
  return decryptApiKey(row.encrypted_key, userId, secret);
}
