/**
 * PO Token Generator
 * Generates YouTube Proof of Origin tokens using BotGuard in the browser.
 * These tokens are required for WEB client InnerTube requests to get streaming URLs.
 */

import { Config } from '../core/config.js';
import { createLogger } from '../core/utils.js';

const log = createLogger('PoToken');

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

// Cache the minter so we don't re-init BotGuard for every request
let cachedMinter = null;
let cachedVisitorData = null;
let cacheExpiry = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Get or create a PO token for the given identifier (visitorData or videoId).
 * Returns { poToken, visitorData } or null on failure.
 */
export async function generatePoToken(identifier) {
  try {
    // Use cached minter if available and not expired
    if (cachedMinter && Date.now() < cacheExpiry) {
      const poToken = await mintToken(cachedMinter, identifier || cachedVisitorData);
      if (poToken) {
        return { poToken, visitorData: cachedVisitorData };
      }
      // Minter failed, clear cache and retry
      cachedMinter = null;
    }

    log.log('Initializing BotGuard...');

    // Step 1: Fetch challenge from Web Anti-Abuse API
    const challenge = await fetchChallenge();
    if (!challenge) {
      log.warn('Failed to fetch BotGuard challenge');
      return null;
    }

    // Step 2: Load and execute the BotGuard VM
    const bgResult = await executeBotGuard(challenge);
    if (!bgResult) {
      log.warn('BotGuard execution failed');
      return null;
    }

    // Step 3: Get integrity token
    const integrityToken = await getIntegrityToken(bgResult.response);
    if (!integrityToken) {
      log.warn('Failed to get integrity token');
      return null;
    }

    // Step 4: Create minter from webPoSignalOutput
    const minter = await createMinter(bgResult.webPoSignalOutput, integrityToken);
    if (!minter) {
      log.warn('Failed to create token minter');
      return null;
    }

    // Step 5: Get visitor data
    const visitorData = await fetchVisitorData();
    if (!visitorData) {
      log.warn('Failed to fetch visitor data');
      return null;
    }

    // Cache the minter
    cachedMinter = minter;
    cachedVisitorData = visitorData;
    cacheExpiry = Date.now() + CACHE_TTL;

    // Step 6: Mint the token
    const poToken = await mintToken(minter, identifier || visitorData);
    if (!poToken) {
      log.warn('Token minting failed');
      return null;
    }

    log.log('PO token generated successfully');
    return { poToken, visitorData };

  } catch (e) {
    log.error('PO token generation failed:', e);
    return null;
  }
}

/**
 * Fetch BotGuard challenge from Google's WAA API
 */
async function fetchChallenge() {
  try {
    // Proxy through our worker to avoid CORS issues with Google's API
    const workerUrl = Config.WORKER_URL;
    const response = await fetch(`${workerUrl}/api/youtube/waa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', requestKey: REQUEST_KEY })
    });

    if (!response.ok) {
      log.warn('WAA Create failed:', response.status);
      return null;
    }

    const data = await response.json();
    if (data.error) {
      log.warn('WAA Create error:', data.error);
      return null;
    }

    // data format: [challengeData, interpreterHash, program, globalName, ...]
    const result = data.result;
    return {
      interpreterJavascript: result[0],
      interpreterHash: result[1],
      program: result[2],
      globalName: result[3],
      clientExperimentsStateBlob: result[4]
    };
  } catch (e) {
    log.error('Challenge fetch error:', e);
    return null;
  }
}

/**
 * Execute the BotGuard VM in the browser
 */
async function executeBotGuard(challenge) {
  try {
    // Load the interpreter script
    if (challenge.interpreterJavascript) {
      // Execute in an isolated scope
      new Function(challenge.interpreterJavascript)();
    }

    // Access the VM from the global scope
    const vm = window[challenge.globalName];
    if (!vm || typeof vm.a !== 'function') {
      log.warn('BotGuard VM not found on window.' + challenge.globalName);
      return null;
    }

    // Execute the program
    const webPoSignalOutput = [];
    let asyncSnapshotFunction = null;

    const vmFunctionsCallback = (asyncFn, shutdownFn, passFn, checkFn) => {
      asyncSnapshotFunction = asyncFn;
    };

    try {
      vm.a(
        challenge.program,
        vmFunctionsCallback,
        true,
        undefined,
        () => {},
        [[], []]
      );
    } catch (e) {
      log.warn('BotGuard program execution error:', e.message);
    }

    // Run the async snapshot to get the BotGuard response
    if (!asyncSnapshotFunction) {
      log.warn('No async snapshot function from BotGuard');
      return null;
    }

    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('BotGuard snapshot timeout')), 10000);
      asyncSnapshotFunction((result) => {
        clearTimeout(timeout);
        resolve(result);
      }, [null, null, webPoSignalOutput, null]);
    });

    return { response, webPoSignalOutput };

  } catch (e) {
    log.error('BotGuard execution error:', e);
    return null;
  }
}

/**
 * Get integrity token from WAA GenerateIT endpoint
 */
async function getIntegrityToken(botguardResponse) {
  try {
    const workerUrl = Config.WORKER_URL;
    const response = await fetch(`${workerUrl}/api/youtube/waa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generateIT', requestKey: REQUEST_KEY, botguardResponse })
    });

    if (!response.ok) {
      log.warn('GenerateIT failed:', response.status);
      return null;
    }

    const data = await response.json();
    if (data.error) {
      log.warn('GenerateIT error:', data.error);
      return null;
    }

    // result format: [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken]
    return data.result[0]; // integrityToken as base64
  } catch (e) {
    log.error('Integrity token error:', e);
    return null;
  }
}

/**
 * Create a minter function from webPoSignalOutput and integrity token
 */
async function createMinter(webPoSignalOutput, integrityTokenBase64) {
  try {
    const getMinter = webPoSignalOutput?.[0];
    if (typeof getMinter !== 'function') {
      log.warn('No minter function in webPoSignalOutput');
      return null;
    }

    // Decode the integrity token from base64
    const binaryString = atob(integrityTokenBase64);
    const integrityTokenBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      integrityTokenBytes[i] = binaryString.charCodeAt(i);
    }

    // Get the mint callback
    const mintCallback = await getMinter(integrityTokenBytes);
    if (typeof mintCallback !== 'function') {
      log.warn('Minter did not return a function');
      return null;
    }

    return mintCallback;
  } catch (e) {
    log.error('Create minter error:', e);
    return null;
  }
}

/**
 * Mint a PO token for a given identifier
 */
async function mintToken(minter, identifier) {
  try {
    const identifierBytes = new TextEncoder().encode(identifier);
    const result = await minter(identifierBytes);

    if (!(result instanceof Uint8Array)) {
      log.warn('Minter returned non-Uint8Array:', typeof result);
      return null;
    }

    // Convert to URL-safe base64
    const binaryString = String.fromCharCode.apply(null, result);
    let base64 = btoa(binaryString);
    base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    return base64;
  } catch (e) {
    log.error('Mint token error:', e);
    return null;
  }
}

/**
 * Fetch visitor data from YouTube
 */
async function fetchVisitorData() {
  try {
    const workerUrl = Config.WORKER_URL;
    const response = await fetch(`${workerUrl}/api/youtube/waa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'visitorData' })
    });

    if (!response.ok) {
      log.warn('Visitor data fetch failed:', response.status);
      return null;
    }

    const data = await response.json();
    return data.visitorData || null;
  } catch (e) {
    log.error('Visitor data fetch error:', e);
    return null;
  }
}
