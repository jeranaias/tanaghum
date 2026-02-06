/**
 * Generic Proxy Handler
 * Proxies requests to external URLs to bypass CORS
 */

/**
 * Handle proxy requests
 */
export async function handleProxy(request, env, url, origin) {
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return jsonResponse({ error: 'Missing url parameter' }, 400, origin);
  }

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return jsonResponse({ error: 'Invalid URL' }, 400, origin);
  }

  // Block certain domains for security
  const blockedDomains = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '10.',
    '172.16.',
    '192.168.'
  ];

  if (blockedDomains.some(d => parsedUrl.hostname.includes(d))) {
    return jsonResponse({ error: 'Blocked domain' }, 403, origin);
  }

  try {
    // Forward the request
    const headers = new Headers();

    // Copy safe headers from original request
    const safeHeaders = ['accept', 'accept-language', 'content-type'];
    safeHeaders.forEach(h => {
      const value = request.headers.get(h);
      if (value) headers.set(h, value);
    });

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' ? await request.text() : undefined
    });

    // Create response with CORS headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', origin || '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return jsonResponse({ error: 'Proxy request failed', details: error.message }, 500, origin);
  }
}

/**
 * JSON response helper
 */
function jsonResponse(data, status, origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  return new Response(JSON.stringify(data), { status, headers });
}
