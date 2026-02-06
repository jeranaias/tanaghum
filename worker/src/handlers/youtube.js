/**
 * YouTube Handler
 * Extracts captions and metadata from YouTube videos
 */

const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_CLIENT_VERSION = '2.20240101.00.00';

/**
 * Handle YouTube API requests
 */
export async function handleYouTube(request, env, url, origin) {
  const path = url.pathname.replace('/api/youtube/', '');
  const videoId = url.searchParams.get('v') || url.searchParams.get('videoId');

  if (!videoId) {
    return jsonResponse({ error: 'Missing video ID' }, 400, origin);
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
 * Get video metadata using InnerTube API
 */
async function getVideoMetadata(videoId, origin) {
  const response = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': INNERTUBE_CLIENT_VERSION
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: INNERTUBE_CLIENT_VERSION,
          hl: 'en',
          gl: 'US'
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error('Failed to fetch video metadata');
  }

  const data = await response.json();

  if (data.playabilityStatus?.status !== 'OK') {
    throw new Error(data.playabilityStatus?.reason || 'Video unavailable');
  }

  const videoDetails = data.videoDetails || {};
  const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  // Find Arabic captions
  const arabicCaption = captions.find(c =>
    c.languageCode === 'ar' ||
    c.languageCode.startsWith('ar-')
  );

  return jsonResponse({
    videoId,
    title: videoDetails.title,
    author: videoDetails.author,
    channelId: videoDetails.channelId,
    lengthSeconds: parseInt(videoDetails.lengthSeconds, 10),
    viewCount: parseInt(videoDetails.viewCount, 10),
    thumbnail: videoDetails.thumbnail?.thumbnails?.slice(-1)[0]?.url,
    captions: {
      available: captions.length > 0,
      arabic: !!arabicCaption,
      languages: captions.map(c => ({
        code: c.languageCode,
        name: c.name?.simpleText || c.languageCode,
        url: c.baseUrl
      }))
    }
  }, 200, origin);
}

/**
 * Get video captions
 */
async function getVideoCaptions(videoId, origin) {
  // First get metadata to find caption URL
  const metaResponse = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': INNERTUBE_CLIENT_VERSION
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: INNERTUBE_CLIENT_VERSION,
          hl: 'en',
          gl: 'US'
        }
      }
    })
  });

  if (!metaResponse.ok) {
    throw new Error('Failed to fetch video data');
  }

  const data = await metaResponse.json();
  const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  if (captions.length === 0) {
    return jsonResponse({
      videoId,
      available: false,
      error: 'No captions available for this video'
    }, 200, origin);
  }

  // Prefer Arabic captions, fall back to auto-generated, then first available
  let captionTrack = captions.find(c => c.languageCode === 'ar');
  if (!captionTrack) {
    captionTrack = captions.find(c => c.languageCode.startsWith('ar-'));
  }
  if (!captionTrack) {
    captionTrack = captions.find(c => c.kind === 'asr'); // Auto-generated
  }
  if (!captionTrack) {
    captionTrack = captions[0];
  }

  // Fetch the caption content
  const captionUrl = captionTrack.baseUrl + '&fmt=json3';
  const captionResponse = await fetch(captionUrl);

  if (!captionResponse.ok) {
    throw new Error('Failed to fetch captions');
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
        .trim();

      return {
        start: event.tStartMs / 1000,
        duration: (event.dDurationMs || 0) / 1000,
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
    language: captionTrack.languageCode,
    languageName: captionTrack.name?.simpleText,
    isAutoGenerated: captionTrack.kind === 'asr',
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
