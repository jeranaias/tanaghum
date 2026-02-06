/**
 * YouTube Handler
 * Extracts captions and metadata from YouTube videos
 * Uses Piped API as primary source with multiple fallback instances
 */

// Piped API instances (ordered by reliability)
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.darkness.services',
  'https://piped-api.privacy.com.de'
];

// InnerTube API configuration (fallback)
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_CLIENT = {
  clientName: 'WEB',
  clientVersion: '2.20240101.00.00',
  hl: 'en',
  gl: 'US'
};

/**
 * Parse WebVTT content into segments
 */
function parseVTT(vttContent) {
  const segments = [];
  const lines = vttContent.split('\n');
  let currentStart = 0;
  let currentText = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for timestamp lines (00:00:00.000 --> 00:00:05.000)
    const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
    if (timeMatch) {
      // Parse start time
      const startHours = parseInt(timeMatch[1], 10);
      const startMins = parseInt(timeMatch[2], 10);
      const startSecs = parseInt(timeMatch[3], 10);
      const startMs = parseInt(timeMatch[4], 10);
      currentStart = startHours * 3600 + startMins * 60 + startSecs + startMs / 1000;

      // Parse end time for duration
      const endHours = parseInt(timeMatch[5], 10);
      const endMins = parseInt(timeMatch[6], 10);
      const endSecs = parseInt(timeMatch[7], 10);
      const endMs = parseInt(timeMatch[8], 10);
      const endTime = endHours * 3600 + endMins * 60 + endSecs + endMs / 1000;

      // Collect text until next timestamp or empty line
      currentText = '';
      for (let j = i + 1; j < lines.length; j++) {
        const textLine = lines[j].trim();
        if (!textLine || textLine.includes('-->')) break;
        // Skip cue identifiers (numeric or UUID-like)
        if (/^\d+$/.test(textLine) || /^[a-f0-9-]{36}$/i.test(textLine)) continue;
        currentText += (currentText ? ' ' : '') + textLine;
      }

      // Clean up the text
      currentText = currentText
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();

      if (currentText) {
        segments.push({
          start: currentStart,
          duration: endTime - currentStart,
          text: currentText
        });
      }
    }
  }

  return segments;
}

/**
 * Try fetching from Piped API with fallback instances
 */
async function fetchFromPiped(endpoint, videoId) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${instance}${endpoint}${videoId}`, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        data._pipedInstance = instance;
        return data;
      }
    } catch (e) {
      console.log(`Piped instance ${instance} failed:`, e.message);
      continue;
    }
  }
  return null;
}

/**
 * Fetch captions using InnerTube API
 */
async function fetchCaptionsViaInnerTube(videoId) {
  const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`;

  const response = await fetch(playerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: JSON.stringify({
      context: {
        client: INNERTUBE_CLIENT
      },
      videoId: videoId
    })
  });

  if (!response.ok) {
    throw new Error('InnerTube API request failed');
  }

  const data = await response.json();

  // Check for captions
  const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    return { videoId, available: false };
  }

  // Prefer Arabic, then auto-generated Arabic, then English, then first
  let track = captionTracks.find(t => t.languageCode === 'ar');
  if (!track) track = captionTracks.find(t => t.languageCode?.startsWith('ar'));
  if (!track) track = captionTracks.find(t => t.languageCode === 'en' && t.kind === 'asr');
  if (!track) track = captionTracks.find(t => t.kind === 'asr');
  if (!track) track = captionTracks[0];

  if (!track?.baseUrl) {
    return { videoId, available: false };
  }

  // Fetch the caption content
  const captionUrl = new URL(track.baseUrl);
  captionUrl.searchParams.set('fmt', 'json3');

  const captionResponse = await fetch(captionUrl.toString());
  if (!captionResponse.ok) {
    throw new Error('Failed to fetch caption content');
  }

  const captionData = await captionResponse.json();
  const events = captionData.events || [];

  const segments = events
    .filter(e => e.segs && e.tStartMs !== undefined)
    .map(event => {
      const text = event.segs
        .map(seg => seg.utf8 || '')
        .join('')
        .replace(/\n/g, ' ')
        .trim();

      return {
        start: event.tStartMs / 1000,
        duration: (event.dDurationMs || 2000) / 1000,
        text
      };
    })
    .filter(seg => seg.text.length > 0);

  if (segments.length === 0) {
    return { videoId, available: false };
  }

  const fullText = segments.map(s => s.text).join(' ');

  return {
    videoId,
    available: true,
    language: track.languageCode,
    languageName: track.name?.simpleText || track.name?.runs?.[0]?.text || track.languageCode,
    isAutoGenerated: track.kind === 'asr',
    trackCount: captionTracks.length,
    availableLanguages: captionTracks.map(t => ({
      code: t.languageCode,
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode
    })),
    segments,
    fullText,
    wordCount: fullText.split(/\s+/).filter(w => w.length > 0).length
  };
}

/**
 * Handle YouTube API requests
 */
export async function handleYouTube(request, env, url, origin) {
  const path = url.pathname.replace('/api/youtube/', '');
  const videoId = url.searchParams.get('v') || url.searchParams.get('videoId');

  try {
    // Handle search separately (doesn't require video ID)
    if (path === 'search') {
      const query = url.searchParams.get('q');
      if (!query) {
        return jsonResponse({ error: 'Missing search query' }, 400, origin);
      }
      const options = {
        minDuration: url.searchParams.get('minDuration'),
        maxDuration: url.searchParams.get('maxDuration')
      };
      return await searchVideos(query, origin, options);
    }

    // Other endpoints require video ID
    if (!videoId) {
      return jsonResponse({ error: 'Missing video ID' }, 400, origin);
    }

    // Validate video ID format
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return jsonResponse({ error: 'Invalid video ID format' }, 400, origin);
    }

    switch (path) {
      case 'metadata':
        return await getVideoMetadata(videoId, origin);

      case 'captions':
        return await getVideoCaptions(videoId, origin);

      case 'audio':
        return await getVideoAudio(videoId, origin, env);

      default:
        return jsonResponse({ error: 'Unknown YouTube endpoint' }, 404, origin);
    }
  } catch (error) {
    console.error('YouTube handler error:', error);
    return jsonResponse({ error: error.message }, 500, origin);
  }
}

/**
 * Get video metadata using oEmbed API (more reliable)
 */
async function getVideoMetadata(videoId, origin) {
  // First try oEmbed for basic metadata
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  const oembedResponse = await fetch(oembedUrl);

  if (!oembedResponse.ok) {
    return jsonResponse({ error: 'Video not found or unavailable' }, 404, origin);
  }

  const oembed = await oembedResponse.json();

  // Get additional data from watch page for captions info
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const watchResponse = await fetch(watchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
    }
  });

  let captionsAvailable = false;
  let duration = 0;

  if (watchResponse.ok) {
    const html = await watchResponse.text();

    // Check for captions
    captionsAvailable = html.includes('"captions"') || html.includes('timedtext');

    // Try to extract duration
    const durationMatch = html.match(/"lengthSeconds":"(\d+)"/);
    if (durationMatch) {
      duration = parseInt(durationMatch[1], 10);
    }
  }

  return jsonResponse({
    videoId,
    title: oembed.title,
    author: oembed.author_name,
    authorUrl: oembed.author_url,
    thumbnail: oembed.thumbnail_url,
    thumbnailWidth: oembed.thumbnail_width,
    thumbnailHeight: oembed.thumbnail_height,
    duration,
    captions: {
      available: captionsAvailable
    }
  }, 200, origin);
}

/**
 * Get video captions - tries Piped API first, then falls back to other methods
 */
async function getVideoCaptions(videoId, origin) {
  // Method 1: Try Piped API first (most reliable, doesn't get blocked)
  try {
    const pipedData = await fetchFromPiped('/streams/', videoId);
    if (pipedData && pipedData.subtitles && pipedData.subtitles.length > 0) {
      // Find Arabic subtitles, or fall back to first available
      let subtitle = pipedData.subtitles.find(s => s.code === 'ar' || s.code?.startsWith('ar'));
      if (!subtitle) subtitle = pipedData.subtitles.find(s => s.autoGenerated);
      if (!subtitle) subtitle = pipedData.subtitles[0];

      if (subtitle && subtitle.url) {
        // Fetch the actual subtitle content
        const subResponse = await fetch(subtitle.url);
        if (subResponse.ok) {
          const vttContent = await subResponse.text();
          const segments = parseVTT(vttContent);

          if (segments.length > 0) {
            const fullText = segments.map(s => s.text).join(' ');
            return jsonResponse({
              videoId,
              available: true,
              language: subtitle.code,
              languageName: subtitle.name || subtitle.code,
              isAutoGenerated: subtitle.autoGenerated || false,
              trackCount: pipedData.subtitles.length,
              availableLanguages: pipedData.subtitles.map(s => ({
                code: s.code,
                name: s.name || s.code
              })),
              segments,
              fullText,
              wordCount: fullText.split(/\s+/).filter(w => w.length > 0).length,
              source: 'piped',
              _pipedInstance: pipedData._pipedInstance
            }, 200, origin);
          }
        }
      }
    }
  } catch (e) {
    console.error('Piped caption fetch failed:', e.message);
  }

  // Method 2: Try InnerTube API
  try {
    const innertubeResult = await fetchCaptionsViaInnerTube(videoId);
    if (innertubeResult.available && innertubeResult.segments?.length > 0) {
      innertubeResult.source = 'innertube';
      return jsonResponse(innertubeResult, 200, origin);
    }
  } catch (e) {
    console.error('InnerTube caption fetch failed:', e.message);
  }

  // Method 3: Fallback to watch page parsing
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const watchResponse = await fetch(watchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
    }
  });

  if (!watchResponse.ok) {
    return jsonResponse({ error: 'Failed to fetch video page' }, 500, origin);
  }

  const html = await watchResponse.text();

  // Try multiple methods to extract caption tracks
  let captionTracks = null;

  // Method 1: Direct captionTracks extraction (more reliable with non-greedy match)
  const captionTracksMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])(?=,")/);
  if (captionTracksMatch) {
    try {
      captionTracks = JSON.parse(captionTracksMatch[1]);
    } catch (e) {
      console.error('Failed to parse captionTracks match:', e);
    }
  }

  // Method 2: Extract from ytInitialPlayerResponse
  if (!captionTracks) {
    // Use a more robust regex that handles multiline
    const playerResponseMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});(?:\s*var|\s*<\/script)/);
    if (playerResponseMatch) {
      try {
        const playerResponse = JSON.parse(playerResponseMatch[1]);
        captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      } catch (e) {
        console.error('Failed to parse player response:', e);
      }
    }
  }

  // Method 3: Try to find captions in embedded JSON
  if (!captionTracks) {
    const embeddedMatch = html.match(/ytInitialPlayerResponse\s*=\s*'([^']+)'/);
    if (embeddedMatch) {
      try {
        const decoded = JSON.parse(embeddedMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
        captionTracks = decoded?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      } catch (e) {
        console.error('Failed to parse embedded player response:', e);
      }
    }
  }

  // Method 4: Try timedtext API directly (fallback for auto-captions)
  if (!captionTracks || !Array.isArray(captionTracks) || captionTracks.length === 0) {
    // Try common language codes for auto-generated captions
    const langCodes = ['ar', 'en', 'a.ar', 'a.en'];

    for (const lang of langCodes) {
      try {
        const timedtextUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=srv3`;
        const ttResponse = await fetch(timedtextUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        if (ttResponse.ok) {
          const ttText = await ttResponse.text();
          // Check if we got actual caption data (not empty or error)
          if (ttText.length > 100 && ttText.includes('<p')) {
            // Parse srv3 XML format
            const segments = [];
            const pMatches = ttText.matchAll(/<p[^>]*\st="(\d+)"[^>]*(?:\sd="(\d+)")?[^>]*>([^<]*)<\/p>/g);
            for (const match of pMatches) {
              const startMs = parseInt(match[1], 10);
              const durationMs = parseInt(match[2] || '2000', 10);
              const text = match[3]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/\n/g, ' ')
                .trim();

              if (text) {
                segments.push({
                  start: startMs / 1000,
                  duration: durationMs / 1000,
                  text
                });
              }
            }

            if (segments.length > 0) {
              const vtt = generateVTT(segments);
              const fullText = segments.map(s => s.text).join(' ');

              return jsonResponse({
                videoId,
                available: true,
                language: lang.replace('a.', ''),
                languageName: lang.startsWith('a.') ? 'Auto-generated' : lang,
                isAutoGenerated: lang.startsWith('a.'),
                trackCount: 1,
                segments,
                vtt,
                fullText,
                wordCount: fullText.split(/\s+/).filter(w => w.length > 0).length
              }, 200, origin);
            }
          }
        }
      } catch (e) {
        console.error(`Timedtext API failed for ${lang}:`, e.message);
      }
    }
  }

  if (!captionTracks || !Array.isArray(captionTracks) || captionTracks.length === 0) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'No captions available for this video'
    }, 200, origin);
  }

  return await fetchCaptionTrack(captionTracks, videoId, origin);
}

/**
 * Fetch and parse a caption track
 */
async function fetchCaptionTrack(tracks, videoId, origin) {
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'No caption tracks found'
    }, 200, origin);
  }

  // Prefer Arabic, then auto-generated, then first available
  let track = tracks.find(t => t.languageCode === 'ar');
  if (!track) {
    track = tracks.find(t => t.languageCode?.startsWith('ar-'));
  }
  if (!track) {
    track = tracks.find(t => t.kind === 'asr');
  }
  if (!track) {
    track = tracks[0];
  }

  // Validate track has required baseUrl
  if (!track.baseUrl || typeof track.baseUrl !== 'string') {
    return jsonResponse({
      videoId,
      available: false,
      error: 'Invalid caption track data'
    }, 200, origin);
  }

  // Validate the caption URL is from YouTube
  let captionUrl;
  try {
    captionUrl = new URL(track.baseUrl);
    if (!captionUrl.hostname.endsWith('youtube.com') && !captionUrl.hostname.endsWith('googlevideo.com')) {
      return jsonResponse({
        videoId,
        available: false,
        error: 'Invalid caption source'
      }, 200, origin);
    }
  } catch {
    return jsonResponse({
      videoId,
      available: false,
      error: 'Invalid caption URL'
    }, 200, origin);
  }

  // Try json3 format first, then fall back to srv3 (XML)
  let captionData;
  let segments = [];

  // Try JSON format (json3)
  const json3Url = new URL(captionUrl.toString());
  json3Url.searchParams.set('fmt', 'json3');

  try {
    const captionResponse = await fetch(json3Url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (captionResponse.ok) {
      const contentType = captionResponse.headers.get('content-type') || '';
      const text = await captionResponse.text();

      // Check if it's actually JSON
      if (contentType.includes('json') || text.trim().startsWith('{')) {
        captionData = JSON.parse(text);
        segments = (captionData.events || [])
          .filter(e => e.segs && e.tStartMs !== undefined)
          .map(event => {
            const segText = event.segs
              .map(seg => seg.utf8 || '')
              .join('')
              .replace(/\n/g, ' ')
              .trim();
            return {
              start: event.tStartMs / 1000,
              duration: (event.dDurationMs || 2000) / 1000,
              text: segText
            };
          })
          .filter(seg => seg.text.length > 0);
      }
    }
  } catch (e) {
    console.error('JSON3 caption fetch failed:', e.message);
  }

  // Fallback: Try srv3 (XML) format if JSON failed
  if (segments.length === 0) {
    const srv3Url = new URL(captionUrl.toString());
    srv3Url.searchParams.set('fmt', 'srv3');

    try {
      const xmlResponse = await fetch(srv3Url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (xmlResponse.ok) {
        const xmlText = await xmlResponse.text();
        // Parse simple XML format: <p t="startMs" d="durationMs">text</p>
        const pMatches = xmlText.matchAll(/<p[^>]*\st="(\d+)"[^>]*(?:\sd="(\d+)")?[^>]*>([^<]*)<\/p>/g);
        for (const match of pMatches) {
          const startMs = parseInt(match[1], 10);
          const durationMs = parseInt(match[2] || '2000', 10);
          const text = match[3]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/\n/g, ' ')
            .trim();

          if (text) {
            segments.push({
              start: startMs / 1000,
              duration: durationMs / 1000,
              text
            });
          }
        }
      }
    } catch (e) {
      console.error('SRV3 caption fetch failed:', e.message);
    }
  }

  // Fallback: Try raw timedtext (VTT-like) format
  if (segments.length === 0) {
    try {
      const rawResponse = await fetch(captionUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (rawResponse.ok) {
        const rawText = await rawResponse.text();
        // Try to parse as simple timed text
        const lines = rawText.split('\n');
        let currentStart = 0;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('<') && !trimmed.includes('-->')) {
            segments.push({
              start: currentStart,
              duration: 3,
              text: trimmed
            });
            currentStart += 3;
          }
        }
      }
    } catch (e) {
      console.error('Raw caption fetch failed:', e.message);
    }
  }

  if (segments.length === 0) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'Failed to parse captions in any format'
    }, 200, origin);
  }

  // Generate VTT format
  const vtt = generateVTT(segments);

  // Combine all text
  const fullText = segments.map(s => s.text).join(' ');

  return jsonResponse({
    videoId,
    available: true,
    language: track.languageCode,
    languageName: track.name?.simpleText || track.name?.runs?.[0]?.text || track.languageCode,
    isAutoGenerated: track.kind === 'asr',
    trackCount: tracks.length,
    availableLanguages: tracks.map(t => ({
      code: t.languageCode,
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode
    })),
    segments,
    vtt,
    fullText,
    wordCount: fullText.split(/\s+/).filter(w => w.length > 0).length
  }, 200, origin);
}

/**
 * Generate WebVTT format from segments
 */
function generateVTT(segments) {
  let vtt = 'WEBVTT\n\n';

  segments.forEach((seg, index) => {
    const startTime = formatVTTTime(seg.start);
    const endTime = formatVTTTime(seg.start + seg.duration);

    vtt += `${index + 1}\n`;
    vtt += `${startTime} --> ${endTime}\n`;
    vtt += `${seg.text}\n\n`;
  });

  return vtt;
}

/**
 * Format seconds to VTT timestamp (HH:MM:SS.mmm)
 */
function formatVTTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Search for Arabic YouTube videos
 */
async function searchVideos(query, origin, options = {}) {
  // Validate and sanitize query
  if (typeof query !== 'string' || query.length === 0) {
    return jsonResponse({ error: 'Invalid search query' }, 400, origin);
  }

  // Limit query length to prevent abuse
  const sanitizedQuery = query.slice(0, 200).trim();

  if (sanitizedQuery.length === 0) {
    return jsonResponse({ error: 'Search query cannot be empty' }, 400, origin);
  }

  // Duration filter options
  const minDuration = parseInt(options.minDuration) || 0;
  const maxDuration = parseInt(options.maxDuration) || 0;

  // Add Arabic-focused search modifiers
  const searchQuery = encodeURIComponent(sanitizedQuery + ' arabic');

  // Use YouTube's search results page
  // sp parameter: EgIQAQ = Videos only
  const searchUrl = `https://www.youtube.com/results?search_query=${searchQuery}&sp=EgIQAQ%253D%253D`;

  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
    }
  });

  if (!response.ok) {
    return jsonResponse({ error: 'Failed to search YouTube' }, 500, origin);
  }

  const html = await response.text();

  // Extract initial data
  const dataMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});/);

  if (!dataMatch) {
    return jsonResponse({ error: 'Failed to parse search results' }, 500, origin);
  }

  try {
    const data = JSON.parse(dataMatch[1]);
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;

    if (!contents) {
      return jsonResponse({ videos: [], query }, 200, origin);
    }

    const videos = [];

    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents || [];

      for (const item of items) {
        const video = item?.videoRenderer;
        if (!video) continue;

        // Extract video data
        const videoId = video.videoId;
        const title = video.title?.runs?.[0]?.text || 'Untitled';
        const channel = video.ownerText?.runs?.[0]?.text || 'Unknown';
        const channelUrl = video.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
        const duration = video.lengthText?.simpleText || '';
        const views = video.viewCountText?.simpleText || '';
        const publishedTime = video.publishedTimeText?.simpleText || '';
        const thumbnail = video.thumbnail?.thumbnails?.pop()?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        const description = video.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map(r => r.text).join('') || '';

        // Parse duration to seconds
        let durationSeconds = 0;
        if (duration) {
          const parts = duration.split(':').reverse();
          durationSeconds = (parseInt(parts[0]) || 0) +
                           (parseInt(parts[1]) || 0) * 60 +
                           (parseInt(parts[2]) || 0) * 3600;
        }

        // Apply duration filter if specified
        if (minDuration > 0 && durationSeconds < minDuration) continue;
        if (maxDuration > 0 && durationSeconds > maxDuration) continue;

        videos.push({
          videoId,
          title,
          channel,
          channelUrl,
          duration,
          durationSeconds,
          views,
          publishedTime,
          thumbnail,
          description,
          url: `https://www.youtube.com/watch?v=${videoId}`
        });

        // Limit to 12 results
        if (videos.length >= 12) break;
      }

      if (videos.length >= 12) break;
    }

    return jsonResponse({
      query,
      resultCount: videos.length,
      videos
    }, 200, origin);

  } catch (e) {
    console.error('Search parse error:', e);
    return jsonResponse({ error: 'Failed to parse search results' }, 500, origin);
  }
}

/**
 * Get audio stream URL for a YouTube video
 * Uses Piped API first, then yt-dlp service as fallback
 */
async function getVideoAudio(videoId, origin, env) {
  // Method 1: Try Piped API first (returns direct audio stream URLs)
  try {
    const pipedData = await fetchFromPiped('/streams/', videoId);
    if (pipedData && pipedData.audioStreams && pipedData.audioStreams.length > 0) {
      // Find best audio stream (prefer higher quality, opus/webm format)
      const audioStreams = pipedData.audioStreams
        .filter(s => s.mimeType && s.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      if (audioStreams.length > 0) {
        const bestAudio = audioStreams[0];
        return jsonResponse({
          videoId,
          available: true,
          audioUrl: bestAudio.url,
          mimeType: bestAudio.mimeType,
          bitrate: bestAudio.bitrate,
          quality: bestAudio.quality,
          duration: pipedData.duration,
          title: pipedData.title,
          source: 'piped',
          _pipedInstance: pipedData._pipedInstance
        }, 200, origin);
      }
    }
  } catch (e) {
    console.error('Piped audio fetch failed:', e.message);
  }

  // Method 2: Try yt-dlp service (Fly.io deployment)
  const ytdlpServiceUrl = env?.YTDLP_SERVICE_URL || 'https://tanaghum-ytdlp.fly.dev';

  try {
    const response = await fetch(`${ytdlpServiceUrl}/extract?url=${videoId}&format=info`, {
      headers: { 'Accept': 'application/json' }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.available && data.audioUrl) {
        return jsonResponse({
          videoId,
          available: true,
          audioUrl: data.audioUrl,
          mimeType: data.mimeType || 'audio/webm',
          duration: data.duration,
          title: data.title,
          source: 'ytdlp-service'
        }, 200, origin);
      }
    }
  } catch (e) {
    console.error('yt-dlp service error:', e.message);
  }

  // Fallback: Check if captions are available
  try {
    const captionsResult = await getVideoCaptions(videoId, origin);
    const captionsData = await captionsResult.json();

    if (captionsData.available) {
      return jsonResponse({
        videoId,
        available: false,
        hasCaptions: true,
        message: 'Audio extraction service unavailable, but this video has captions. Using captions for better accuracy.',
        captionsLanguage: captionsData.language
      }, 200, origin);
    }
  } catch (e) {
    console.error('Captions check error:', e.message);
  }

  // Last resort: Try direct extraction
  const directResult = await getVideoAudioDirect(videoId, origin);
  const directData = await directResult.json();

  if (directData.available) {
    return jsonResponse(directData, 200, origin);
  }

  // All methods failed
  return jsonResponse({
    videoId,
    available: false,
    error: 'Audio extraction unavailable. The yt-dlp service may be starting up (wait 30s and retry) or the video is protected.',
    suggestion: 'Try again in 30 seconds, or upload the audio file directly.'
  }, 200, origin);
}

/**
 * Direct YouTube audio extraction (fallback)
 */
async function getVideoAudioDirect(videoId, origin) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const response = await fetch(watchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
    }
  });

  if (!response.ok) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'Failed to fetch video page'
    }, 200, origin);
  }

  const html = await response.text();

  // Extract ytInitialPlayerResponse
  let playerResponse = null;
  const playerMatch = html.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);
  if (playerMatch) {
    try {
      playerResponse = JSON.parse(playerMatch[1]);
    } catch (e) {}
  }

  if (!playerResponse) {
    const altMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
    if (altMatch) {
      try {
        playerResponse = JSON.parse(altMatch[1]);
      } catch (e) {}
    }
  }

  if (!playerResponse) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'Could not extract video data. Try uploading the audio instead.'
    }, 200, origin);
  }

  // Check playability
  const playability = playerResponse.playabilityStatus;
  if (playability?.status !== 'OK') {
    return jsonResponse({
      videoId,
      available: false,
      error: playability?.reason || 'Video not available'
    }, 200, origin);
  }

  // Get streaming data
  const streamingData = playerResponse.streamingData;
  if (!streamingData) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'No streaming data available'
    }, 200, origin);
  }

  // Find audio-only formats
  const adaptiveFormats = streamingData.adaptiveFormats || [];
  const audioFormats = adaptiveFormats.filter(f =>
    f.mimeType?.startsWith('audio/') && f.url
  );

  if (audioFormats.length === 0) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'Audio extraction blocked by YouTube. Try uploading the audio file instead.'
    }, 200, origin);
  }

  // Sort by bitrate
  audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const bestAudio = audioFormats[0];

  return jsonResponse({
    videoId,
    available: true,
    audioUrl: bestAudio.url,
    mimeType: bestAudio.mimeType,
    bitrate: bestAudio.bitrate,
    duration: parseInt(playerResponse.videoDetails?.lengthSeconds || 0),
    source: 'youtube-direct'
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
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  return new Response(JSON.stringify(data), { status, headers });
}
