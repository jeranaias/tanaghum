"""
Tanaghum yt-dlp Audio Extraction Service
Deployed on Render.com free tier
"""

import os
import json
import tempfile
import subprocess
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)

# CORS - allow our domains
ALLOWED_ORIGINS = [
    'https://jeranaias.github.io',
    'https://tanaghum.github.io',
    'https://tanaghum-worker.jmathdog.workers.dev',
    'http://localhost:8000',
    'http://localhost:3000',
    'http://127.0.0.1:8000'
]

CORS(app, origins=ALLOWED_ORIGINS)

# yt-dlp options for audio extraction
YDL_OPTS = {
    'format': 'bestaudio/best',
    'quiet': True,
    'no_warnings': True,
    'extract_flat': False,
}

@app.route('/')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'service': 'tanaghum-ytdlp',
        'version': '1.0.0'
    })

@app.route('/health')
def health_check():
    """Health check for Render"""
    return jsonify({'status': 'healthy'})

@app.route('/extract', methods=['GET', 'POST'])
def extract_audio():
    """
    Extract audio URL from YouTube video

    Query params or JSON body:
    - url: YouTube video URL or ID
    - format: 'url' (default) or 'info'
    """
    # Get URL from query params or JSON body
    if request.method == 'POST':
        data = request.get_json() or {}
        video_url = data.get('url')
        output_format = data.get('format', 'url')
    else:
        video_url = request.args.get('url')
        output_format = request.args.get('format', 'url')

    if not video_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    # Normalize URL
    if len(video_url) == 11 and not video_url.startswith('http'):
        video_url = f'https://www.youtube.com/watch?v={video_url}'
    elif not video_url.startswith('http'):
        video_url = f'https://www.youtube.com/watch?v={video_url}'

    try:
        with yt_dlp.YoutubeDL(YDL_OPTS) as ydl:
            info = ydl.extract_info(video_url, download=False)

            if not info:
                return jsonify({'error': 'Could not extract video info'}), 404

            # Find best audio format
            formats = info.get('formats', [])
            audio_formats = [f for f in formats if f.get('acodec') != 'none' and f.get('vcodec') == 'none']

            if not audio_formats:
                # Fallback to any format with audio
                audio_formats = [f for f in formats if f.get('acodec') != 'none']

            if not audio_formats:
                return jsonify({'error': 'No audio formats available'}), 404

            # Sort by quality (bitrate)
            audio_formats.sort(key=lambda x: x.get('abr') or x.get('tbr') or 0, reverse=True)
            best_audio = audio_formats[0]

            if output_format == 'info':
                # Return full info
                return jsonify({
                    'videoId': info.get('id'),
                    'title': info.get('title'),
                    'duration': info.get('duration'),
                    'thumbnail': info.get('thumbnail'),
                    'audioUrl': best_audio.get('url'),
                    'mimeType': best_audio.get('ext'),
                    'bitrate': best_audio.get('abr') or best_audio.get('tbr'),
                    'filesize': best_audio.get('filesize'),
                    'available': True
                })
            else:
                # Return just the URL
                return jsonify({
                    'videoId': info.get('id'),
                    'available': True,
                    'audioUrl': best_audio.get('url'),
                    'mimeType': f"audio/{best_audio.get('ext', 'webm')}",
                    'duration': info.get('duration'),
                    'title': info.get('title')
                })

    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e)
        if 'Video unavailable' in error_msg:
            return jsonify({'error': 'Video unavailable', 'available': False}), 404
        elif 'Private video' in error_msg:
            return jsonify({'error': 'Private video', 'available': False}), 403
        else:
            return jsonify({'error': error_msg, 'available': False}), 400
    except Exception as e:
        return jsonify({'error': str(e), 'available': False}), 500

@app.route('/download', methods=['GET'])
def download_audio():
    """
    Download and stream audio directly (for CORS bypass)
    Warning: This uses more bandwidth and may hit Render limits
    """
    video_url = request.args.get('url')

    if not video_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    # Normalize URL
    if len(video_url) == 11:
        video_url = f'https://www.youtube.com/watch?v={video_url}'

    try:
        with yt_dlp.YoutubeDL(YDL_OPTS) as ydl:
            info = ydl.extract_info(video_url, download=False)

            formats = info.get('formats', [])
            audio_formats = [f for f in formats if f.get('acodec') != 'none' and f.get('vcodec') == 'none']

            if not audio_formats:
                audio_formats = [f for f in formats if f.get('acodec') != 'none']

            if not audio_formats:
                return jsonify({'error': 'No audio formats available'}), 404

            audio_formats.sort(key=lambda x: x.get('abr') or x.get('tbr') or 0, reverse=True)
            best_audio = audio_formats[0]
            audio_url = best_audio.get('url')

            # Stream the audio through our server
            import requests
            r = requests.get(audio_url, stream=True)

            return Response(
                r.iter_content(chunk_size=8192),
                content_type=r.headers.get('content-type', 'audio/webm'),
                headers={
                    'Content-Disposition': f'attachment; filename="{info.get("id")}.webm"'
                }
            )

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/info', methods=['GET'])
def video_info():
    """Get video metadata without audio URL"""
    video_url = request.args.get('url')

    if not video_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    if len(video_url) == 11:
        video_url = f'https://www.youtube.com/watch?v={video_url}'

    try:
        opts = {**YDL_OPTS, 'skip_download': True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(video_url, download=False)

            return jsonify({
                'videoId': info.get('id'),
                'title': info.get('title'),
                'duration': info.get('duration'),
                'thumbnail': info.get('thumbnail'),
                'channel': info.get('uploader'),
                'description': info.get('description', '')[:500],
                'viewCount': info.get('view_count'),
                'uploadDate': info.get('upload_date')
            })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
