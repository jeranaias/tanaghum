"""
Tanaghum yt-dlp Audio Extraction Service
Deployed on Fly.io with PO Token support
"""

import os
import json
import subprocess
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

app = Flask(__name__)

# CORS - allow our domains
ALLOWED_ORIGINS = [
    'https://jeranaias.github.io',
    'https://tanaghum.github.io',
    'https://tanaghum-worker.jmathdog.workers.dev',
    'http://localhost:8000',
    'http://localhost:8080',
    'http://localhost:3000',
    'http://127.0.0.1:8000',
    'http://127.0.0.1:8080'
]

CORS(app, origins=ALLOWED_ORIGINS)

# POT Server URL (bgutil-ytdlp-pot-provider runs on port 4416)
POT_SERVER_URL = 'http://127.0.0.1:4416'

def run_ytdlp(video_url, get_url=True):
    """
    Run yt-dlp via subprocess with proper POT provider args.
    This ensures the plugin is loaded correctly.
    """
    # Try multiple player clients including tv_embedded which sometimes bypasses restrictions
    # The bgutil plugin auto-provides POT tokens when needed for web client
    cmd = [
        'yt-dlp',
        '--dump-json',
        '-f', 'bestaudio/best',
        '--verbose',
        # Try tv_embedded first (often bypasses restrictions), then ios, android, web
        '--extractor-args', 'youtube:player_client=tv_embedded,mweb,ios,android,web',
        '--extractor-args', f'youtubepot-bgutilhttp:base_url={POT_SERVER_URL}',
        video_url
    ]

    try:
        # Log the command being run
        import sys
        print(f"Running: {' '.join(cmd)}", file=sys.stderr)

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120
        )

        # Log stderr for debugging
        if result.stderr:
            print(f"yt-dlp stderr: {result.stderr[:2000]}", file=sys.stderr)

        if result.returncode != 0:
            error_msg = result.stderr or result.stdout or 'Unknown error'
            # Check if it's a PO token issue
            if 'pot' in error_msg.lower() or 'provider' in error_msg.lower():
                error_msg = f"POT provider issue: {error_msg}"
            return None, error_msg

        # Parse JSON output
        info = json.loads(result.stdout)
        return info, None

    except subprocess.TimeoutExpired:
        return None, 'Request timed out'
    except json.JSONDecodeError as e:
        return None, f'Failed to parse yt-dlp output: {e}. stdout: {result.stdout[:500] if result.stdout else "empty"}'
    except Exception as e:
        return None, str(e)


@app.route('/')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'service': 'tanaghum-ytdlp',
        'version': '2.0.0',
        'pot_server': POT_SERVER_URL
    })


@app.route('/health')
def health_check():
    """Health check for Fly.io"""
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

    # Run yt-dlp
    info, error = run_ytdlp(video_url)

    if error:
        status_code = 400
        suggestion = None

        if 'Video unavailable' in error:
            status_code = 404
        elif 'Private video' in error:
            status_code = 403
        elif 'not a bot' in error.lower() or 'LOGIN_REQUIRED' in error:
            status_code = 403
            # Provide helpful suggestion for blocked content
            suggestion = 'This video requires authentication. Try using YouTube captions instead, or upload audio directly for Whisper transcription.'

        response = {
            'error': 'Audio extraction blocked by YouTube. Use captions or Whisper transcription.' if suggestion else error,
            'available': False,
            'suggestion': suggestion,
            'blocked': 'LOGIN_REQUIRED' in error or 'not a bot' in error.lower()
        }
        return jsonify(response), status_code

    if not info:
        return jsonify({'error': 'Could not extract video info', 'available': False}), 404

    # Find best audio format
    formats = info.get('formats', [])
    audio_formats = [f for f in formats if f.get('acodec') != 'none' and f.get('vcodec') == 'none']

    if not audio_formats:
        # Fallback to any format with audio
        audio_formats = [f for f in formats if f.get('acodec') != 'none']

    if not audio_formats:
        return jsonify({'error': 'No audio formats available', 'available': False}), 404

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


@app.route('/download', methods=['GET'])
def download_audio():
    """
    Download and stream audio directly (for CORS bypass)
    Warning: This uses more bandwidth
    """
    video_url = request.args.get('url')

    if not video_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    # Normalize URL
    if len(video_url) == 11:
        video_url = f'https://www.youtube.com/watch?v={video_url}'

    info, error = run_ytdlp(video_url)

    if error:
        return jsonify({'error': error}), 500

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


@app.route('/info', methods=['GET'])
def video_info():
    """Get video metadata without audio URL"""
    video_url = request.args.get('url')

    if not video_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    if len(video_url) == 11:
        video_url = f'https://www.youtube.com/watch?v={video_url}'

    info, error = run_ytdlp(video_url)

    if error:
        return jsonify({'error': error}), 500

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


@app.route('/debug', methods=['GET'])
def debug_info():
    """Debug endpoint to check yt-dlp and plugin status"""
    import shutil

    # Check yt-dlp version
    try:
        result = subprocess.run(['yt-dlp', '--version'], capture_output=True, text=True)
        ytdlp_version = result.stdout.strip()
    except:
        ytdlp_version = 'Not found'

    # Check if bgutil plugin is installed
    try:
        result = subprocess.run(['pip', 'list'], capture_output=True, text=True)
        pip_list = result.stdout
        has_bgutil = 'bgutil-ytdlp-pot-provider' in pip_list
    except:
        has_bgutil = False
        pip_list = 'Error checking pip'

    # Check if POT server is reachable
    try:
        import requests
        pot_response = requests.get(f'{POT_SERVER_URL}/ping', timeout=2)
        pot_status = pot_response.status_code
    except Exception as e:
        pot_status = f'Error: {e}'

    return jsonify({
        'ytdlp_version': ytdlp_version,
        'bgutil_installed': has_bgutil,
        'pot_server_url': POT_SERVER_URL,
        'pot_server_status': pot_status
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
