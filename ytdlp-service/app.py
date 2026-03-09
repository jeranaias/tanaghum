"""
Tanaghum yt-dlp Audio Extraction Service
Deployed on Fly.io with PO Token support + Cloudflare WARP proxy + cookie auth
"""

import os
import sys
import json
import subprocess
import time
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

# Cloudflare WARP SOCKS5 proxy (wireproxy on port 40000)
WARP_PROXY = 'socks5h://127.0.0.1:40000'

# Cookie file for YouTube authentication (bypasses datacenter IP blocking)
COOKIES_FILE = '/data/cookies.txt'

# Admin key for cookie upload (set via Fly.io secrets)
ADMIN_KEY = os.environ.get('ADMIN_KEY', '')

# Cache WARP connectivity status (avoid checking every request)
_warp_status = {'available': None, 'checked_at': 0}
WARP_CHECK_INTERVAL = 60  # seconds

# Cache extraction results (avoid double extraction for extract→download flow)
_extract_cache = {}
EXTRACT_CACHE_TTL = 120  # seconds

# Track IP blocking state — fast-fail when all IPs are known blocked
_blocked_state = {'blocked': False, 'since': 0}
BLOCKED_CACHE_TTL = 120  # seconds — watchdog/rotation clears this


def has_cookies():
    """Check if YouTube cookies file exists and is non-empty"""
    return os.path.exists(COOKIES_FILE) and os.path.getsize(COOKIES_FILE) > 10


def is_warp_available(force=False):
    """Check if WARP proxy has actual internet connectivity (not just socket open)"""
    now = time.time()
    if not force and _warp_status['available'] is not None and (now - _warp_status['checked_at']) < WARP_CHECK_INTERVAL:
        return _warp_status['available']

    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(('127.0.0.1', 40000))
        sock.close()
        if result != 0:
            _warp_status['available'] = False
            _warp_status['checked_at'] = now
            return False
    except Exception:
        _warp_status['available'] = False
        _warp_status['checked_at'] = now
        return False

    try:
        result = subprocess.run(
            ['curl', '-s', '--max-time', '5', '--proxy', WARP_PROXY,
             'https://www.google.com/generate_204', '-o', '/dev/null', '-w', '%{http_code}'],
            capture_output=True, text=True, timeout=8
        )
        available = result.stdout.strip() == '204'
        _warp_status['available'] = available
        _warp_status['checked_at'] = now
        return available
    except Exception as e:
        _warp_status['available'] = False
        _warp_status['checked_at'] = now
        return False


def run_ytdlp(video_url, use_proxy=True, format_spec='bestaudio/best'):
    """Run yt-dlp with cookies + POT provider + optional WARP proxy."""
    cmd = [
        'yt-dlp',
        '--dump-json',
        '-f', format_spec,
        '--no-warnings',
        '--js-runtimes', 'node:/usr/local/bin/node',
        '--remote-components', 'ejs:github',
        '--extractor-args', 'youtube:player_client=web,mweb,android_vr',
        '--extractor-args', f'youtubepot-bgutilhttp:base_url={POT_SERVER_URL}',
    ]

    # Use cookies if available (bypasses datacenter IP blocking)
    if has_cookies():
        cmd.extend(['--cookies', COOKIES_FILE])

    # Route through Cloudflare WARP if available
    if use_proxy and is_warp_available():
        cmd.extend(['--proxy', WARP_PROXY])
        proxy_used = 'warp'
    else:
        proxy_used = 'direct'

    cmd.append(video_url)

    try:
        auth_mode = 'cookies' if has_cookies() else 'anonymous'
        print(f"Running yt-dlp ({proxy_used}+{auth_mode}): {video_url}", file=sys.stderr)

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.stderr:
            print(f"yt-dlp stderr ({proxy_used}): {result.stderr[:3000]}", file=sys.stderr)

        if result.returncode != 0:
            error_msg = result.stderr or result.stdout or 'Unknown error'
            return None, error_msg, proxy_used

        info = json.loads(result.stdout)
        return info, None, proxy_used

    except subprocess.TimeoutExpired:
        return None, 'Request timed out (120s)', proxy_used
    except json.JSONDecodeError as e:
        stdout_preview = result.stdout[:500] if result.stdout else "empty"
        return None, f'Failed to parse yt-dlp output: {e}. stdout: {stdout_preview}', proxy_used
    except Exception as e:
        return None, str(e), proxy_used


def rotate_warp():
    """Re-register WARP with fresh credentials to get a new exit IP."""
    try:
        print("[WARP] Rotating WARP IP via full re-registration...", file=sys.stderr)

        # Kill wireproxy
        subprocess.run(['pkill', '-f', 'wireproxy'], timeout=5, capture_output=True)
        time.sleep(2)

        # Re-register WARP with fresh credentials
        warp_dir = '/app/warp'
        subprocess.run(['rm', '-f', f'{warp_dir}/wgcf-account.toml', f'{warp_dir}/wgcf-profile.conf'], timeout=5)
        result = subprocess.run(['wgcf', 'register', '--accept-tos'], capture_output=True, text=True, timeout=15, cwd=warp_dir)
        if result.returncode != 0:
            print(f"[WARP] Registration failed: {result.stderr}", file=sys.stderr)
            return

        result = subprocess.run(['wgcf', 'generate'], capture_output=True, text=True, timeout=10, cwd=warp_dir)
        if result.returncode != 0:
            print(f"[WARP] Profile generation failed: {result.stderr}", file=sys.stderr)
            return

        # Read new credentials and write wireproxy config
        with open(f'{warp_dir}/wgcf-profile.conf') as f:
            profile = f.read()

        import re
        private_key = re.search(r'^PrivateKey\s*=\s*(.+)', profile, re.MULTILINE).group(1).strip()
        public_key = re.search(r'^PublicKey\s*=\s*(.+)', profile, re.MULTILINE).group(1).strip()
        address = re.search(r'^Address\s*=\s*(.+)', profile, re.MULTILINE).group(1).strip()

        config = f"""[Interface]
Address = {address}
PrivateKey = {private_key}
DNS = 1.1.1.1, 1.0.0.1
MTU = 1280

[Peer]
PublicKey = {public_key}
Endpoint = 162.159.192.1:2408
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25

[Socks5]
BindAddress = 127.0.0.1:40000
"""
        with open(f'{warp_dir}/wireproxy.conf', 'w') as f:
            f.write(config)

        # supervisord will auto-restart wireproxy
        time.sleep(8)
        _warp_status['available'] = None
        _warp_status['checked_at'] = 0
        _blocked_state['blocked'] = False
        _blocked_state['since'] = 0
        print(f"[WARP] New credentials generated, wireproxy restarting", file=sys.stderr)

    except Exception as e:
        print(f"[WARP] Rotation failed: {e}", file=sys.stderr)


def extract_with_retry(video_url, format_spec='bestaudio/best'):
    """Try extraction with WARP first, fall back to direct.
    Does NOT rotate WARP IP — watchdog handles that in the background.
    Fast-fails if recently blocked (cleared by watchdog/rotation).
    """
    now = time.time()

    # Fast-fail if IP is known blocked (cleared by watchdog/rotate)
    if _blocked_state['blocked'] and (now - _blocked_state['since']) < BLOCKED_CACHE_TTL:
        return None, 'LOGIN_REQUIRED (cached — IP blocked, waiting for rotation)', 'blocked-cache'

    # Try with WARP proxy
    info, error, proxy_used = run_ytdlp(video_url, use_proxy=True, format_spec=format_spec)
    if info:
        _blocked_state['blocked'] = False
        return info, None, proxy_used

    if error and proxy_used == 'warp':
        if 'Host unreachable' in error or 'ProxyError' in error or 'Socks5Error' in error:
            _warp_status['available'] = False
            _warp_status['checked_at'] = now

    # Fallback: try without proxy
    info, error_direct, proxy_used = run_ytdlp(video_url, use_proxy=False, format_spec=format_spec)
    if info:
        _blocked_state['blocked'] = False
        return info, None, proxy_used

    # Mark as blocked if LOGIN_REQUIRED
    combined_error = error or error_direct or ''
    if 'LOGIN_REQUIRED' in combined_error or 'not a bot' in combined_error.lower():
        _blocked_state['blocked'] = True
        _blocked_state['since'] = now

    return None, combined_error, proxy_used


def extract_cached(video_url, format_spec='bestaudio/best'):
    """Cached extraction — avoids double yt-dlp runs for extract→download flow."""
    cache_key = f"{video_url}|{format_spec}"
    now = time.time()
    if cache_key in _extract_cache:
        cached = _extract_cache[cache_key]
        if now - cached['time'] < EXTRACT_CACHE_TTL and cached['info']:
            return cached['info'], None, cached['proxy_used']

    info, error, proxy_used = extract_with_retry(video_url, format_spec=format_spec)
    if info:
        _extract_cache[cache_key] = {'info': info, 'error': None, 'proxy_used': proxy_used, 'time': now}
        # Evict old entries
        for k in list(_extract_cache.keys()):
            if now - _extract_cache[k]['time'] > EXTRACT_CACHE_TTL:
                del _extract_cache[k]
    return info, error, proxy_used


@app.route('/')
def health():
    return jsonify({
        'status': 'ok',
        'service': 'tanaghum-ytdlp',
        'version': '5.0.0',
        'has_cookies': has_cookies(),
        'warp_proxy': is_warp_available()
    })


@app.route('/health')
def health_check():
    return jsonify({'status': 'healthy'})


@app.route('/cookies', methods=['GET', 'POST', 'DELETE'])
def manage_cookies():
    """Upload/check/delete YouTube cookies for authenticated extraction"""
    if request.method == 'GET':
        return jsonify({
            'has_cookies': has_cookies(),
            'cookies_size': os.path.getsize(COOKIES_FILE) if has_cookies() else 0
        })

    # POST and DELETE require admin key
    key = request.headers.get('X-Admin-Key') or request.args.get('key')
    if not ADMIN_KEY or key != ADMIN_KEY:
        return jsonify({'error': 'Invalid or missing admin key'}), 403

    if request.method == 'DELETE':
        if os.path.exists(COOKIES_FILE):
            os.remove(COOKIES_FILE)
        return jsonify({'status': 'deleted'})

    # POST - upload cookies
    cookies_text = None

    if request.content_type and 'multipart/form-data' in request.content_type:
        # File upload
        f = request.files.get('cookies')
        if f:
            cookies_text = f.read().decode('utf-8', errors='replace')
    else:
        # Raw text or JSON body
        data = request.get_json(silent=True)
        if data:
            cookies_text = data.get('cookies')
        else:
            cookies_text = request.get_data(as_text=True)

    if not cookies_text or len(cookies_text) < 10:
        return jsonify({'error': 'No valid cookies provided'}), 400

    # Validate it looks like Netscape cookie format
    lines = cookies_text.strip().split('\n')
    cookie_lines = [l for l in lines if not l.startswith('#') and '\t' in l]
    if len(cookie_lines) < 1:
        return jsonify({'error': 'Invalid cookie format. Use Netscape/Mozilla cookie format (tab-separated).'}), 400

    with open(COOKIES_FILE, 'w') as f:
        f.write(cookies_text)

    return jsonify({
        'status': 'uploaded',
        'cookie_count': len(cookie_lines),
        'size': len(cookies_text)
    })


def _handle_extract_error(error, proxy_used):
    """Shared error handling for extract endpoints."""
    status_code = 400
    suggestion = None

    if 'Video unavailable' in error:
        status_code = 404
    elif 'Private video' in error:
        status_code = 403
    elif 'not a bot' in error.lower() or 'LOGIN_REQUIRED' in error:
        status_code = 403
        if not has_cookies():
            suggestion = 'YouTube blocked this IP. Upload cookies via /cookies to authenticate.'
        else:
            suggestion = 'YouTube cookies may be expired. Re-upload fresh cookies.'

    error_short = error[:2000] if len(error) > 2000 else error

    return jsonify({
        'error': error_short,
        'available': False,
        'suggestion': suggestion,
        'blocked': 'LOGIN_REQUIRED' in error or 'not a bot' in error.lower(),
        'has_cookies': has_cookies(),
        'proxy_used': proxy_used
    }), status_code


@app.route('/extract', methods=['GET', 'POST'])
def extract_audio():
    """Extract audio URL from YouTube video"""
    if request.method == 'POST':
        data = request.get_json() or {}
        video_url = data.get('url')
        output_format = data.get('format', 'url')
    else:
        video_url = request.args.get('url')
        output_format = request.args.get('format', 'url')

    if not video_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    if not video_url.startswith('http'):
        video_url = f'https://www.youtube.com/watch?v={video_url}'

    info, error, proxy_used = extract_cached(video_url)

    if error:
        return _handle_extract_error(error, proxy_used)

    if not info:
        return jsonify({'error': 'Could not extract video info', 'available': False}), 404

    formats = info.get('formats', [])
    audio_formats = [f for f in formats if f.get('acodec') != 'none' and f.get('vcodec') == 'none']
    if not audio_formats:
        audio_formats = [f for f in formats if f.get('acodec') != 'none']
    if not audio_formats:
        return jsonify({'error': 'No audio formats available', 'available': False}), 404

    audio_formats.sort(key=lambda x: x.get('abr') or x.get('tbr') or 0, reverse=True)
    best_audio = audio_formats[0]

    if output_format == 'info':
        return jsonify({
            'videoId': info.get('id'),
            'title': info.get('title'),
            'duration': info.get('duration'),
            'thumbnail': info.get('thumbnail'),
            'audioUrl': best_audio.get('url'),
            'mimeType': best_audio.get('ext'),
            'bitrate': best_audio.get('abr') or best_audio.get('tbr'),
            'filesize': best_audio.get('filesize'),
            'available': True,
            'proxy_used': proxy_used
        })
    else:
        return jsonify({
            'videoId': info.get('id'),
            'available': True,
            'audioUrl': best_audio.get('url'),
            'mimeType': f"audio/{best_audio.get('ext', 'webm')}",
            'duration': info.get('duration'),
            'title': info.get('title'),
            'proxy_used': proxy_used
        })


@app.route('/extract-video', methods=['GET'])
def extract_video():
    """Extract video+audio (mp4) URL from YouTube video"""
    video_url = request.args.get('url')
    if not video_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    if not video_url.startswith('http'):
        video_url = f'https://www.youtube.com/watch?v={video_url}'

    # Request best mp4 video+audio, fallback to best available
    info, error, proxy_used = extract_cached(video_url, format_spec='bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b')

    if error:
        return _handle_extract_error(error, proxy_used)

    if not info:
        return jsonify({'error': 'Could not extract video info', 'available': False}), 404

    # requested_downloads contains the merged/selected format info
    req_dl = info.get('requested_downloads', [{}])[0] if info.get('requested_downloads') else {}
    video_url_result = req_dl.get('url') or info.get('url')
    ext = req_dl.get('ext') or info.get('ext') or 'mp4'
    filesize = req_dl.get('filesize') or info.get('filesize')
    vcodec = req_dl.get('vcodec') or info.get('vcodec')
    acodec = req_dl.get('acodec') or info.get('acodec')

    # If merge is needed (separate video+audio), fall back to formats list
    if not video_url_result:
        formats = info.get('formats', [])
        # Find best mp4 with both video and audio
        combined = [f for f in formats if f.get('vcodec') != 'none' and f.get('acodec') != 'none' and f.get('url')]
        combined.sort(key=lambda x: x.get('tbr') or 0, reverse=True)
        if combined:
            best = combined[0]
            video_url_result = best['url']
            ext = best.get('ext', 'mp4')
            filesize = best.get('filesize')
            vcodec = best.get('vcodec')
            acodec = best.get('acodec')

    if not video_url_result:
        return jsonify({'error': 'No downloadable video format found', 'available': False}), 404

    return jsonify({
        'videoId': info.get('id'),
        'available': True,
        'videoUrl': video_url_result,
        'mimeType': f"video/{ext}",
        'ext': ext,
        'duration': info.get('duration'),
        'title': info.get('title'),
        'filesize': filesize,
        'vcodec': vcodec,
        'acodec': acodec,
        'thumbnail': info.get('thumbnail'),
        'proxy_used': proxy_used
    })


@app.route('/download', methods=['GET'])
def download_audio():
    """Download and stream audio directly through WARP (preserves IP for YouTube URLs)"""
    video_url = request.args.get('url')
    if not video_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    if not video_url.startswith('http'):
        video_url = f'https://www.youtube.com/watch?v={video_url}'

    info, error, proxy_used = extract_cached(video_url)
    if error:
        return jsonify({'error': error[:500], 'available': False}), 500

    formats = info.get('formats', [])
    audio_formats = [f for f in formats if f.get('acodec') != 'none' and f.get('vcodec') == 'none']
    if not audio_formats:
        audio_formats = [f for f in formats if f.get('acodec') != 'none']
    if not audio_formats:
        return jsonify({'error': 'No audio formats available', 'available': False}), 404

    audio_formats.sort(key=lambda x: x.get('abr') or x.get('tbr') or 0, reverse=True)
    best = audio_formats[0]
    audio_url = best.get('url')
    ext = best.get('ext', 'webm')
    content_type = f"audio/{ext}" if ext in ('webm', 'mp4', 'm4a', 'ogg', 'opus') else 'audio/webm'

    # Stream through WARP to match the IP that extracted the URL
    proxy_args = ['--proxy', WARP_PROXY] if proxy_used == 'warp' and is_warp_available() else []
    process = subprocess.Popen(
        ['curl', '-s', '-L', '--max-time', '300'] + proxy_args + [audio_url],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )

    def generate():
        try:
            while True:
                chunk = process.stdout.read(8192)
                if not chunk:
                    break
                yield chunk
        finally:
            process.stdout.close()
            process.wait()

    return Response(
        generate(),
        content_type=content_type,
        headers={
            'X-Audio-Source': 'ytdlp',
            'X-Audio-Duration': str(info.get('duration', 0)),
            'X-Audio-Title': info.get('title', ''),
            'X-Video-Id': info.get('id', ''),
        }
    )


@app.route('/proxy', methods=['POST'])
def proxy_stream():
    """Stream a URL through WARP proxy (for IP-locked YouTube audio URLs)"""
    data = request.get_json() or {}
    target_url = data.get('url')
    content_type = data.get('contentType', 'audio/webm')

    if not target_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    proxy_args = ['--proxy', WARP_PROXY] if is_warp_available() else []
    process = subprocess.Popen(
        ['curl', '-s', '-L', '--max-time', '300'] + proxy_args + [target_url],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )

    def generate():
        try:
            while True:
                chunk = process.stdout.read(8192)
                if not chunk:
                    break
                yield chunk
        finally:
            process.stdout.close()
            process.wait()

    return Response(generate(), content_type=content_type)


@app.route('/info', methods=['GET'])
def video_info():
    """Get video metadata"""
    video_url = request.args.get('url')
    if not video_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    if not video_url.startswith('http'):
        video_url = f'https://www.youtube.com/watch?v={video_url}'

    info, error, proxy_used = extract_with_retry(video_url)
    if error:
        return jsonify({'error': error[:500]}), 500

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


@app.route('/rotate', methods=['POST'])
def rotate_ip():
    """Force WARP IP rotation and test YouTube"""
    key = request.headers.get('X-Admin-Key') or request.args.get('key')
    if not ADMIN_KEY or key != ADMIN_KEY:
        return jsonify({'error': 'Invalid or missing admin key'}), 403

    max_attempts = int(request.args.get('attempts', 5))
    test_video = 'jNQXAC9IVRw'

    for attempt in range(1, max_attempts + 1):
        rotate_warp()

        # Test YouTube extraction
        info, error, proxy_used = run_ytdlp(f'https://www.youtube.com/watch?v={test_video}', use_proxy=True)
        if info:
            # Get the WARP exit IP
            try:
                result = subprocess.run(
                    ['curl', '-s', '--max-time', '5', '--proxy', WARP_PROXY, 'https://api.ipify.org'],
                    capture_output=True, text=True, timeout=10
                )
                warp_ip = result.stdout.strip()
            except Exception:
                warp_ip = 'unknown'

            return jsonify({
                'status': 'ok',
                'attempt': attempt,
                'warp_ip': warp_ip,
                'youtube_works': True,
                'test_title': info.get('title')
            })

    return jsonify({
        'status': 'failed',
        'attempts': max_attempts,
        'youtube_works': False,
        'message': f'Could not find working WARP IP after {max_attempts} attempts'
    }), 503


@app.route('/debug', methods=['GET'])
def debug_info():
    """Debug endpoint"""
    try:
        result = subprocess.run(['yt-dlp', '--version'], capture_output=True, text=True)
        ytdlp_version = result.stdout.strip()
    except Exception:
        ytdlp_version = 'Not found'

    try:
        import requests as req
        pot_response = req.get(f'{POT_SERVER_URL}/ping', timeout=2)
        pot_status = pot_response.status_code
    except Exception as e:
        pot_status = f'Error: {e}'

    try:
        result = subprocess.run(['node', '--version'], capture_output=True, text=True)
        node_version = result.stdout.strip()
    except Exception:
        node_version = 'Not found'

    return jsonify({
        'ytdlp_version': ytdlp_version,
        'pot_server_status': pot_status,
        'warp_available': is_warp_available(force=True),
        'has_cookies': has_cookies(),
        'node_version': node_version,
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
