/**
 * PO Token Generator
 * Generates YouTube Proof of Origin tokens using BotGuard in the browser.
 * Based on bgutils-js (https://github.com/LuanRT/BgUtils).
 *
 * Flow:
 * 1. Worker fetches challenge from Google WAA API (avoids CORS)
 * 2. Browser loads & runs BotGuard VM (needs real browser env)
 * 3. Worker fetches integrity token using BotGuard response (avoids CORS)
 * 4. Browser mints PO token using integrity token + visitor data
 */

import { Config } from '../core/config.js';
import { createLogger } from '../core/utils.js';

const log = createLogger('PoToken');

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

// Cache
let cachedMinter = null;
let cachedVisitorData = null;
let cacheExpiry = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// --- Helpers from bgutils-js ---

function base64ToU8(base64) {
  const base64Mod = base64.replace(/[-_.]/g, m => ({ '-': '+', '_': '/', '.': '=' })[m] || m);
  const bin = atob(base64Mod);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

function u8ToBase64(u8, urlSafe = false) {
  const result = btoa(String.fromCharCode(...u8));
  if (urlSafe) return result.replace(/\+/g, '-').replace(/\//g, '_');
  return result;
}

function descramble(scrambledChallenge) {
  const buffer = base64ToU8(scrambledChallenge);
  if (buffer.length) return new TextDecoder().decode(buffer.map(b => b + 97));
  return null;
}

function parseChallengeData(rawData) {
  let challengeData = [];
  if (rawData.length > 1 && typeof rawData[1] === 'string') {
    const descrambled = descramble(rawData[1]);
    challengeData = JSON.parse(descrambled || '[]');
  } else if (rawData.length && typeof rawData[0] === 'object') {
    challengeData = rawData[0];
  }

  const [messageId, wrappedScript, wrappedUrl, interpreterHash, program, globalName, , clientExperimentsStateBlob] = challengeData;

  const scriptValue = Array.isArray(wrappedScript)
    ? wrappedScript.find(v => v && typeof v === 'string')
    : null;

  const urlValue = Array.isArray(wrappedUrl)
    ? wrappedUrl.find(v => v && typeof v === 'string')
    : null;

  return { messageId, scriptValue, urlValue, interpreterHash, program, globalName, clientExperimentsStateBlob };
}

// --- Cold start token (no BotGuard needed, works for initial playback) ---

function generateColdStartToken(identifier) {
  const encoded = new TextEncoder().encode(identifier);
  const timestamp = Math.floor(Date.now() / 1000);
  const keys = [Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)];
  const header = [...keys, 0, 1,
    (timestamp >> 24) & 0xFF, (timestamp >> 16) & 0xFF,
    (timestamp >> 8) & 0xFF, timestamp & 0xFF
  ];

  const packet = new Uint8Array(2 + header.length + encoded.length);
  packet[0] = 34;
  packet[1] = header.length + encoded.length;
  packet.set(header, 2);
  packet.set(encoded, 2 + header.length);

  const payload = packet.subarray(2);
  for (let i = keys.length; i < payload.length; i++) {
    payload[i] ^= payload[i % keys.length];
  }

  return u8ToBase64(packet, true);
}

// --- Main API ---

/**
 * Generate a PO token. Tries full BotGuard flow, falls back to cold-start token.
 * Returns { poToken, visitorData } or null.
 */
export async function generatePoToken(identifier) {
  try {
    // Use cached minter if available
    if (cachedMinter && Date.now() < cacheExpiry) {
      try {
        const poToken = await cachedMinter.mintAsWebsafeString(identifier || cachedVisitorData);
        if (poToken) return { poToken, visitorData: cachedVisitorData };
      } catch (e) {
        log.warn('Cached minter failed, reinitializing:', e.message);
        cachedMinter = null;
      }
    }

    // Get visitor data first (needed for both flows)
    const visitorData = await fetchVisitorData();
    if (!visitorData) {
      log.warn('No visitor data');
      return null;
    }

    log.log('Attempting full BotGuard flow...');

    // Try full BotGuard flow
    const fullResult = await tryFullBotGuardFlow(visitorData, identifier);
    if (fullResult) return fullResult;

    // Fall back to cold-start token
    log.log('Full BotGuard failed, using cold-start token');
    const coldToken = generateColdStartToken(identifier || visitorData);
    return { poToken: coldToken, visitorData };

  } catch (e) {
    log.error('PO token generation failed:', e);
    // Last resort: cold-start token
    try {
      const visitorData = cachedVisitorData || await fetchVisitorData();
      if (visitorData) {
        const coldToken = generateColdStartToken(identifier || visitorData);
        return { poToken: coldToken, visitorData };
      }
    } catch (e2) {
      log.error('Cold-start token also failed:', e2);
    }
    return null;
  }
}

async function tryFullBotGuardFlow(visitorData, identifier) {
  const workerUrl = Config.WORKER_URL;

  try {
    // Step 1: Fetch challenge via worker
    log.log('Fetching BotGuard challenge...');
    const chResp = await fetch(`${workerUrl}/api/youtube/waa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', requestKey: REQUEST_KEY })
    });

    if (!chResp.ok) { log.warn('Challenge fetch failed:', chResp.status); return null; }
    const chData = await chResp.json();
    if (chData.error) { log.warn('Challenge error:', chData.error); return null; }

    // Parse the challenge
    const challenge = parseChallengeData(chData.result);
    if (!challenge.program || !challenge.globalName) {
      log.warn('Challenge missing program or globalName');
      return null;
    }

    log.log('Challenge parsed, globalName:', challenge.globalName);

    // Step 2: Load the interpreter JS
    let interpreterLoaded = false;
    if (challenge.scriptValue) {
      try {
        new Function(challenge.scriptValue)();
        interpreterLoaded = true;
      } catch (e) {
        log.warn('Inline interpreter failed:', e.message);
      }
    }

    if (!interpreterLoaded && challenge.urlValue) {
      try {
        // Fetch the interpreter script via worker proxy to avoid CORS
        const scriptResp = await fetch(`${workerUrl}/api/youtube/waa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'fetchScript', url: challenge.urlValue })
        });
        const scriptData = await scriptResp.json();
        if (scriptData.script) {
          new Function(scriptData.script)();
          interpreterLoaded = true;
        }
      } catch (e) {
        log.warn('Script fetch failed:', e.message);
      }
    }

    if (!interpreterLoaded) {
      log.warn('Could not load BotGuard interpreter');
      return null;
    }

    // Step 3: Execute BotGuard VM
    const vm = window[challenge.globalName];
    if (!vm || typeof vm.a !== 'function') {
      log.warn('BotGuard VM not found on window.' + challenge.globalName);
      return null;
    }

    log.log('Running BotGuard VM...');

    const webPoSignalOutput = [];
    let asyncSnapshotFn = null;

    const vmCallback = (asyncFn) => { asyncSnapshotFn = asyncFn; };

    try {
      vm.a(challenge.program, vmCallback, true, undefined, () => {}, [[], []]);
    } catch (e) {
      log.warn('BotGuard VM load error:', e.message);
      return null;
    }

    if (!asyncSnapshotFn) {
      log.warn('No async snapshot function');
      return null;
    }

    // Take snapshot
    const bgResponse = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('BotGuard timeout')), 10000);
      asyncSnapshotFn((response) => {
        clearTimeout(timeout);
        resolve(response);
      }, [null, null, webPoSignalOutput, null]);
    });

    log.log('BotGuard snapshot complete, getting integrity token...');

    // Step 4: Get integrity token via worker
    const itResp = await fetch(`${workerUrl}/api/youtube/waa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generateIT', requestKey: REQUEST_KEY, botguardResponse: bgResponse })
    });

    if (!itResp.ok) { log.warn('GenerateIT failed:', itResp.status); return null; }
    const itData = await itResp.json();
    if (itData.error) { log.warn('GenerateIT error:', itData.error); return null; }

    const integrityToken = itData.result[0];
    if (!integrityToken) { log.warn('No integrity token in response'); return null; }

    // Step 5: Create minter from webPoSignalOutput
    const getMinter = webPoSignalOutput[0];
    if (typeof getMinter !== 'function') {
      log.warn('No minter function in webPoSignalOutput');
      return null;
    }

    const mintCallback = await getMinter(base64ToU8(integrityToken));
    if (typeof mintCallback !== 'function') {
      log.warn('Minter did not return a function');
      return null;
    }

    // Create minter wrapper
    const minter = {
      mintAsWebsafeString: async (id) => {
        const result = await mintCallback(new TextEncoder().encode(id));
        if (!(result instanceof Uint8Array)) throw new Error('Invalid mint result');
        return u8ToBase64(result, true);
      }
    };

    // Cache it
    cachedMinter = minter;
    cachedVisitorData = visitorData;
    cacheExpiry = Date.now() + CACHE_TTL;

    // Step 6: Mint the token
    const poToken = await minter.mintAsWebsafeString(identifier || visitorData);
    log.log('PO token minted successfully, length:', poToken.length);
    return { poToken, visitorData };

  } catch (e) {
    log.warn('Full BotGuard flow failed:', e.message);
    return null;
  }
}

async function fetchVisitorData() {
  if (cachedVisitorData) return cachedVisitorData;
  try {
    const workerUrl = Config.WORKER_URL;
    const response = await fetch(`${workerUrl}/api/youtube/waa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'visitorData' })
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.visitorData) cachedVisitorData = data.visitorData;
    return data.visitorData || null;
  } catch (e) {
    log.error('Visitor data fetch error:', e);
    return null;
  }
}
