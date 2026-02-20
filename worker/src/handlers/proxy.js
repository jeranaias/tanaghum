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

  // Only allow HTTPS for security
  if (parsedUrl.protocol !== 'https:') {
    return jsonResponse({ error: 'Only HTTPS URLs are allowed' }, 400, origin);
  }

  // Block private/internal network addresses (SSRF protection)
  const hostname = parsedUrl.hostname.toLowerCase();

  // Block localhost variations
  if (hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost')) {
    return jsonResponse({ error: 'Blocked domain' }, 403, origin);
  }

  // Block private IPv4 ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    if (a === 10 ||                             // 10.0.0.0/8
        (a === 172 && b >= 16 && b <= 31) ||    // 172.16.0.0/12
        (a === 192 && b === 168) ||             // 192.168.0.0/16
        (a === 169 && b === 254) ||             // 169.254.0.0/16 (link-local)
        a === 127 ||                            // 127.0.0.0/8 (loopback)
        a === 0) {                              // 0.0.0.0/8
      return jsonResponse({ error: 'Blocked domain' }, 403, origin);
    }
  }

  // Block cloud metadata endpoints
  const blockedHosts = [
    'metadata.google.internal',
    '169.254.169.254',
    'metadata.azure.com',
    '100.100.100.200'  // Alibaba Cloud metadata
  ];
  if (blockedHosts.includes(hostname)) {
    return jsonResponse({ error: 'Blocked domain' }, 403, origin);
  }

  // Whitelist allowed domains for proxy (safer approach)
  const allowedDomains = [
    'youtube.com',
    'www.youtube.com',
    'i.ytimg.com',
    'googlevideo.com',
    'translate.google.com'
  ];
  if (!allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d))) {
    return jsonResponse({ error: 'Domain not in whitelist' }, 403, origin);
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
    // Don't expose internal error details
    return jsonResponse({ error: 'Proxy request failed' }, 502, origin);
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
