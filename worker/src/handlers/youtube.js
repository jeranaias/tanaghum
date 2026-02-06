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

  if (!videoId) {
    return jsonResponse({ error: 'Missing video ID' }, 400, origin);
  }

  // Validate video ID format
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return jsonResponse({ error: 'Invalid video ID format' }, 400, origin);
  }

  try {
    switch (path) {
      case 'metadata':
        return await getVideoMetadata(videoId, origin);

      case 'captions':
        return await getVideoCaptions(videoId, origin);

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

  // Extract caption tracks from the page
  const captionTracksMatch = html.match(/"captionTracks":\s*(\[.*?\])/);

  if (!captionTracksMatch) {
    // Try alternative pattern
    const playerResponseMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
    if (playerResponseMatch) {
      try {
        const playerResponse = JSON.parse(playerResponseMatch[1]);
        const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (tracks && tracks.length > 0) {
          return await fetchCaptionTrack(tracks, videoId, origin);
        }
      } catch (e) {
        console.error('Failed to parse player response:', e);
      }
    }

    return jsonResponse({
      videoId,
      available: false,
      error: 'No captions available for this video'
    }, 200, origin);
  }

  try {
    const captionTracks = JSON.parse(captionTracksMatch[1]);
    return await fetchCaptionTrack(captionTracks, videoId, origin);
  } catch (e) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'Failed to parse caption tracks'
    }, 200, origin);
  }
}

/**
 * Fetch and parse a caption track
 */
async function fetchCaptionTrack(tracks, videoId, origin) {
  if (!tracks || tracks.length === 0) {
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

  // Fetch the caption content
  let captionUrl = track.baseUrl;
  if (!captionUrl.includes('fmt=')) {
    captionUrl += (captionUrl.includes('?') ? '&' : '?') + 'fmt=json3';
  }

  const captionResponse = await fetch(captionUrl, {
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

  const captionData = await captionResponse.json();
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
