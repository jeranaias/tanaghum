# Tanaghum yt-dlp Service

YouTube audio extraction API using yt-dlp. Deployed on Render.com free tier.

## Endpoints

### `GET /` or `GET /health`
Health check endpoint.

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

## Deploy to Render

1. Fork this repo or push to your GitHub
2. Go to [render.com](https://render.com) and sign up
3. Click "New" → "Web Service"
4. Connect your GitHub repo
5. Select the `ytdlp-service` directory as root
6. Render will auto-detect Python and deploy

**Settings:**
- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn app:app`
- Health Check Path: `/health`

## Local Development

```bash
cd ytdlp-service
pip install -r requirements.txt
python app.py
```

## Environment Variables

- `PORT` - Server port (default: 5000)

## Notes

- Free tier spins down after 15 minutes of inactivity
- First request after spin-down takes ~30 seconds
- Audio URLs expire quickly, use them immediately
