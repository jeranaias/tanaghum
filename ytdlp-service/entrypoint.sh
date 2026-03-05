#!/bin/bash
# Tanaghum yt-dlp Service Entrypoint
# Sets up Cloudflare WARP proxy and validates YouTube connectivity before starting

set -e

WARP_DIR="/app/warp"
MAX_IP_ATTEMPTS=10
YOUTUBE_TEST_VIDEO="jNQXAC9IVRw"  # "Me at the zoo" — short, always available

mkdir -p "$WARP_DIR"

# --- Helper: Register WARP and generate wireproxy config ---
setup_warp() {
    cd "$WARP_DIR"
    rm -f wgcf-account.toml wgcf-profile.conf wireproxy.conf

    for attempt in 1 2 3; do
        if wgcf register --accept-tos 2>&1; then
            break
        fi
        echo "[entrypoint] Registration attempt $attempt failed, retrying..."
        sleep 2
    done

    if [ ! -f "$WARP_DIR/wgcf-account.toml" ]; then
        echo "[entrypoint] WARP registration failed"
        return 1
    fi

    wgcf generate 2>&1
    if [ ! -f "$WARP_DIR/wgcf-profile.conf" ]; then
        echo "[entrypoint] Profile generation failed"
        return 1
    fi

    PRIVATE_KEY=$(grep '^PrivateKey' wgcf-profile.conf | head -1 | sed 's/^PrivateKey\s*=\s*//')
    PUBLIC_KEY=$(grep '^PublicKey' wgcf-profile.conf | head -1 | sed 's/^PublicKey\s*=\s*//')
    ADDRESS=$(grep '^Address' wgcf-profile.conf | head -1 | sed 's/^Address\s*=\s*//')

    cat > "$WARP_DIR/wireproxy.conf" << EOF
[Interface]
Address = ${ADDRESS}
PrivateKey = ${PRIVATE_KEY}
DNS = 1.1.1.1, 1.0.0.1
MTU = 1280

[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = 162.159.192.1:2408
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25

[Socks5]
BindAddress = 127.0.0.1:40000
EOF
    return 0
}

# --- Helper: Test YouTube through WARP proxy ---
test_youtube() {
    # Quick connectivity test first
    if ! curl -s --max-time 5 --proxy socks5h://127.0.0.1:40000 https://www.google.com/generate_204 -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q "204"; then
        echo "[entrypoint] WARP tunnel not connected yet"
        return 1
    fi

    # Get WARP exit IP
    WARP_IP=$(curl -s --max-time 5 --proxy socks5h://127.0.0.1:40000 https://api.ipify.org 2>/dev/null || echo "unknown")
    echo "[entrypoint] WARP exit IP: $WARP_IP"

    # Test YouTube extraction (short video, just check if formats are available)
    RESULT=$(yt-dlp --dump-json -f bestaudio/best \
        --js-runtimes node:/usr/local/bin/node \
        --remote-components ejs:github \
        --extractor-args 'youtube:player_client=mweb' \
        --extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416" \
        --proxy socks5h://127.0.0.1:40000 \
        "https://www.youtube.com/watch?v=${YOUTUBE_TEST_VIDEO}" 2>/dev/null | head -c 100)

    if echo "$RESULT" | grep -q '"id"'; then
        echo "[entrypoint] YouTube extraction OK with IP $WARP_IP"
        return 0
    else
        echo "[entrypoint] YouTube blocked on IP $WARP_IP"
        return 1
    fi
}

# --- Main ---
echo "[entrypoint] Setting up Cloudflare WARP proxy..."

if ! setup_warp; then
    echo "[entrypoint] Starting without WARP (registration failed)"
    touch "$WARP_DIR/wireproxy.conf"
    exec supervisord -c /app/supervisord.conf
fi

echo "[entrypoint] Starting wireproxy + POT server for YouTube validation..."

# Start wireproxy in background for testing
wireproxy -c "$WARP_DIR/wireproxy.conf" &
WIREPROXY_PID=$!
sleep 5

# Start POT server in background (needed for PO tokens during YouTube test)
cd /pot-provider/server && node build/main.js &
POT_PID=$!
sleep 3

# Validate YouTube works, rotate WARP IP if blocked
for ip_attempt in $(seq 1 $MAX_IP_ATTEMPTS); do
    echo "[entrypoint] YouTube validation attempt $ip_attempt/$MAX_IP_ATTEMPTS..."

    if test_youtube; then
        echo "[entrypoint] Found working WARP IP on attempt $ip_attempt"
        break
    fi

    if [ $ip_attempt -eq $MAX_IP_ATTEMPTS ]; then
        echo "[entrypoint] WARNING: Could not find working WARP IP after $MAX_IP_ATTEMPTS attempts"
        echo "[entrypoint] Starting anyway — watchdog will keep trying"
        break
    fi

    # Kill wireproxy, re-register WARP, restart
    echo "[entrypoint] Rotating WARP IP..."
    kill $WIREPROXY_PID 2>/dev/null || true
    wait $WIREPROXY_PID 2>/dev/null || true
    sleep 1

    if ! setup_warp; then
        echo "[entrypoint] WARP re-registration failed on attempt $ip_attempt"
        sleep 2
        continue
    fi

    wireproxy -c "$WARP_DIR/wireproxy.conf" &
    WIREPROXY_PID=$!
    sleep 5
done

# Clean up test processes — supervisord will manage them properly
echo "[entrypoint] Cleaning up test processes..."
kill $POT_PID 2>/dev/null || true
kill $WIREPROXY_PID 2>/dev/null || true
# Force kill any lingering node/wireproxy processes
pkill -f "node build/main.js" 2>/dev/null || true
pkill -f wireproxy 2>/dev/null || true
wait $POT_PID 2>/dev/null || true
wait $WIREPROXY_PID 2>/dev/null || true
# Ensure ports are released
sleep 3

echo "[entrypoint] Starting all services via supervisord..."
exec supervisord -c /app/supervisord.conf
