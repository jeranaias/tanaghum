/**
 * YouTube Handler
 * Extracts captions and metadata from YouTube videos
 */

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
      return await searchVideos(query, origin);
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
        return await getVideoAudio(videoId, origin);

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
 * Get video captions using timedtext API
 */
async function getVideoCaptions(videoId, origin) {
  // Fetch the watch page to get caption tracks
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

  // Add format parameter
  if (!captionUrl.searchParams.has('fmt')) {
    captionUrl.searchParams.set('fmt', 'json3');
  }

  const captionResponse = await fetch(captionUrl.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!captionResponse.ok) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'Failed to fetch caption content'
    }, 200, origin);
  }

  // Parse with error handling
  let captionData;
  try {
    captionData = await captionResponse.json();
  } catch {
    return jsonResponse({
      videoId,
      available: false,
      error: 'Failed to parse caption data'
    }, 200, origin);
  }

  const events = captionData.events || [];

  // Parse caption events into segments
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
async function searchVideos(query, origin) {
  // Validate and sanitize query
  if (typeof query !== 'string' || query.length === 0) {
    return jsonResponse({ error: 'Invalid search query' }, 400, origin);
  }

  // Limit query length to prevent abuse
  const sanitizedQuery = query.slice(0, 200).trim();

  if (sanitizedQuery.length === 0) {
    return jsonResponse({ error: 'Search query cannot be empty' }, 400, origin);
  }

  // Add Arabic-focused search modifiers
  const searchQuery = encodeURIComponent(sanitizedQuery + ' arabic');

  // Use YouTube's search results page
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
 * Returns the audio URL that can be fetched directly by the client
 */
async function getVideoAudio(videoId, origin) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const response = await fetch(watchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
    }
  });

  if (!response.ok) {
    return jsonResponse({ error: 'Failed to fetch video page' }, 500, origin);
  }

  const html = await response.text();

  // Extract ytInitialPlayerResponse
  let playerResponse = null;

  // Method 1: Direct variable
  const playerMatch = html.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);
  if (playerMatch) {
    try {
      playerResponse = JSON.parse(playerMatch[1]);
    } catch (e) {
      console.error('Failed to parse player response:', e);
    }
  }

  // Method 2: In script with different format
  if (!playerResponse) {
    const altMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
    if (altMatch) {
      try {
        playerResponse = JSON.parse(altMatch[1]);
      } catch (e) {
        console.error('Failed to parse alt player response:', e);
      }
    }
  }

  if (!playerResponse) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'Could not extract player response'
    }, 200, origin);
  }

  // Check playability
  const playability = playerResponse.playabilityStatus;
  if (playability?.status !== 'OK') {
    return jsonResponse({
      videoId,
      available: false,
      error: playability?.reason || 'Video not playable'
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

  // Find audio-only formats (adaptiveFormats)
  const adaptiveFormats = streamingData.adaptiveFormats || [];

  // Audio format itags: 139 (48k m4a), 140 (128k m4a), 249/250/251 (opus)
  // Prefer 140 (m4a 128kbps) or 251 (opus 160kbps)
  const audioFormats = adaptiveFormats.filter(f =>
    f.mimeType?.startsWith('audio/') && f.url
  );

  if (audioFormats.length === 0) {
    // Check if formats require deciphering (signatureCipher)
    const cipheredFormats = adaptiveFormats.filter(f =>
      f.mimeType?.startsWith('audio/') && f.signatureCipher
    );

    if (cipheredFormats.length > 0) {
      return jsonResponse({
        videoId,
        available: false,
        error: 'Audio requires signature decryption (not supported)',
        hint: 'Try a different video or use the upload option'
      }, 200, origin);
    }

    return jsonResponse({
      videoId,
      available: false,
      error: 'No accessible audio formats found'
    }, 200, origin);
  }

  // Sort by bitrate (higher is better)
  audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  // Get best audio format
  const bestAudio = audioFormats[0];

  // Get video duration
  const duration = parseInt(playerResponse.videoDetails?.lengthSeconds || 0);

  return jsonResponse({
    videoId,
    available: true,
    audioUrl: bestAudio.url,
    mimeType: bestAudio.mimeType,
    bitrate: bestAudio.bitrate,
    contentLength: bestAudio.contentLength,
    duration,
    quality: bestAudio.audioQuality || 'UNKNOWN',
    // Include expiry info
    expiresAt: extractExpiryFromUrl(bestAudio.url)
  }, 200, origin);
}

/**
 * Extract expiry timestamp from YouTube URL
 */
function extractExpiryFromUrl(url) {
  try {
    const expireMatch = url.match(/expire=(\d+)/);
    if (expireMatch) {
      return parseInt(expireMatch[1]) * 1000; // Convert to milliseconds
    }
  } catch (e) {}
  return null;
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
