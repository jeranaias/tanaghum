# Tanaghum yt-dlp Service

YouTube audio extraction API using yt-dlp with Cloudflare WARP proxy and PO Token authentication. Deployed on Fly.io.

## Architecture

This service runs three components managed by supervisord:

1. **wireproxy** - Cloudflare WARP SOCKS5 proxy (port 40000). Routes yt-dlp traffic through Cloudflare's network so YouTube sees residential-appearing IPs instead of datacenter IPs.
2. **POT Provider** - BotGuard PO Token generation server (port 4416). Generates Proof of Origin Tokens required by YouTube's anti-bot system.
3. **Flask App** - HTTP API (port 5000). Runs yt-dlp with the WARP proxy and POT provider.

## Endpoints

### `GET /` or `GET /health`
Health check endpoint. Returns service status including WARP proxy availability.

### `GET /extract?url={youtube_url}`
Extract audio URL from a YouTube video.

**Parameters:**
- `url` - YouTube video URL or video ID
- `format` - `url` (default) or `info` for full details

**Response:**
```json
{
  "videoId": "dQw4w9WgXcQ",
  "available": true,
  "audioUrl": "https://...",
  "mimeType": "audio/webm",
  "duration": 213,
  "title": "Video Title"
}
```

### `GET /info?url={youtube_url}`
Get video metadata without audio URL.

### `GET /download?url={youtube_url}`
Download and stream audio directly (proxied through server).

### `GET /debug`
Debug endpoint showing yt-dlp version, POT provider status, and WARP proxy status.

## Deployment

### Fly.io (Primary)

```bash
cd ytdlp-service
fly deploy
```

The Dockerfile handles everything:
- Python 3.11 + ffmpeg + Node.js 20
- yt-dlp with bgutil POT provider plugin
- wgcf + wireproxy for Cloudflare WARP
- supervisord to manage all services

### Local Development

```bash
cd ytdlp-service
pip install -r requirements.txt
python app.py
```

Note: WARP proxy and POT provider are only available in the Docker container. Local development uses direct connections (may be blocked by YouTube for some videos).

## Environment Variables

- `PORT` - Server port (default: 5000)

## Legal Note

This service extracts audio URLs for educational transcription purposes. It uses YouTube's own APIs and Cloudflare's WARP service (a legitimate VPN product). No content is stored or redistributed. See the project root README for full legal details.
