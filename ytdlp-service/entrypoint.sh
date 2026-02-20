#!/bin/bash
# Tanaghum yt-dlp Service Entrypoint
# Sets up Cloudflare WARP proxy before starting services

set -e

WARP_DIR="/app/warp"
mkdir -p "$WARP_DIR"

echo "[entrypoint] Setting up Cloudflare WARP proxy..."

# Register with WARP if not already done
if [ ! -f "$WARP_DIR/wgcf-account.toml" ]; then
    echo "[entrypoint] Registering with Cloudflare WARP..."
    cd "$WARP_DIR"
    wgcf register --accept-tos
    echo "[entrypoint] WARP registration complete"
fi

# Generate WireGuard profile if not present
if [ ! -f "$WARP_DIR/wgcf-profile.conf" ]; then
    echo "[entrypoint] Generating WireGuard profile..."
    cd "$WARP_DIR"
    wgcf generate
    echo "[entrypoint] Profile generated"
fi

# Extract keys from wgcf profile and create wireproxy config
cd "$WARP_DIR"
PRIVATE_KEY=$(grep 'PrivateKey' wgcf-profile.conf | cut -d'=' -f2- | tr -d ' ')
PUBLIC_KEY=$(grep 'PublicKey' wgcf-profile.conf | cut -d'=' -f2- | tr -d ' ')
ENDPOINT=$(grep 'Endpoint' wgcf-profile.conf | cut -d'=' -f2- | tr -d ' ')

cat > "$WARP_DIR/wireproxy.conf" << EOF
[Interface]
PrivateKey = ${PRIVATE_KEY}
DNS = 1.1.1.1
MTU = 1280

[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = ${ENDPOINT}

[Socks5]
BindAddress = 127.0.0.1:40000
EOF

echo "[entrypoint] wireproxy config created"
echo "[entrypoint] Starting services via supervisord..."

# Start all services
exec supervisord -c /app/supervisord.conf
