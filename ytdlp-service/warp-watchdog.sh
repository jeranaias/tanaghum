#!/bin/bash
# WARP Watchdog - monitors tunnel health AND YouTube accessibility
# Runs as a supervisord program alongside wireproxy

WARP_DIR="/app/warp"
CHECK_INTERVAL=60
FAIL_THRESHOLD=2
YOUTUBE_TEST_VIDEO="jNQXAC9IVRw"
consecutive_failures=0

echo "[warp-watchdog] Starting WARP + YouTube health monitoring (check every ${CHECK_INTERVAL}s)"

# Wait for all services to start
sleep 30

while true; do
    # Test 1: Basic WARP connectivity
    if ! curl -s --max-time 10 --proxy socks5h://127.0.0.1:40000 https://www.google.com/generate_204 -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q "204"; then
        consecutive_failures=$((consecutive_failures + 1))
        echo "[warp-watchdog] WARP connectivity failed ($consecutive_failures/$FAIL_THRESHOLD)"
    else
        # Test 2: YouTube extraction (only if basic connectivity works)
        YT_RESULT=$(yt-dlp --dump-json -f bestaudio/best \
            --js-runtimes node:/usr/local/bin/node \
            --remote-components ejs:github \
            --extractor-args 'youtube:player_client=mweb' \
            --extractor-args 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416' \
            --proxy socks5h://127.0.0.1:40000 \
            "https://www.youtube.com/watch?v=${YOUTUBE_TEST_VIDEO}" 2>/dev/null | head -c 100)

        if echo "$YT_RESULT" | grep -q '"id"'; then
            if [ $consecutive_failures -gt 0 ]; then
                echo "[warp-watchdog] YouTube access recovered after $consecutive_failures failures"
            fi
            consecutive_failures=0
        else
            consecutive_failures=$((consecutive_failures + 1))
            WARP_IP=$(curl -s --max-time 5 --proxy socks5h://127.0.0.1:40000 https://api.ipify.org 2>/dev/null || echo "unknown")
            echo "[warp-watchdog] YouTube blocked on IP $WARP_IP ($consecutive_failures/$FAIL_THRESHOLD)"
        fi
    fi

    if [ $consecutive_failures -ge $FAIL_THRESHOLD ]; then
        echo "[warp-watchdog] Rotating WARP IP..."

        pkill -f wireproxy || true
        sleep 2

        cd "$WARP_DIR"
        rm -f wgcf-account.toml wgcf-profile.conf

        if wgcf register --accept-tos 2>&1; then
            wgcf generate 2>&1

            if [ -f wgcf-profile.conf ]; then
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
                echo "[warp-watchdog] New WARP credentials generated"
            else
                echo "[warp-watchdog] Failed to generate new profile"
            fi
        else
            echo "[warp-watchdog] WARP re-registration failed"
        fi

        consecutive_failures=0
        sleep 15
    fi

    sleep $CHECK_INTERVAL
done
