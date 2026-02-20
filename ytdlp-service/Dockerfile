# Tanaghum yt-dlp Service
# Audio extraction with PO Token support + Cloudflare WARP proxy
FROM python:3.11-slim

# Install system dependencies including Node.js for POT provider
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    gnupg \
    git \
    supervisor \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install wgcf (Cloudflare WARP credential generator) and wireproxy (userspace WireGuard SOCKS5 proxy)
# wgcf generates WARP credentials; wireproxy creates a local SOCKS5 proxy through the WARP tunnel
# This makes yt-dlp traffic appear from residential IPs instead of datacenter IPs
ARG WGCF_VERSION=2.2.22
ARG WIREPROXY_VERSION=1.0.9
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then WGCF_ARCH="amd64"; WP_ARCH="amd64"; \
    elif [ "$ARCH" = "arm64" ]; then WGCF_ARCH="arm64"; WP_ARCH="arm64"; \
    else echo "Unsupported arch: $ARCH" && exit 1; fi && \
    curl -fsSL "https://github.com/ViRb3/wgcf/releases/download/v${WGCF_VERSION}/wgcf_${WGCF_VERSION}_linux_${WGCF_ARCH}" -o /usr/local/bin/wgcf && \
    chmod +x /usr/local/bin/wgcf && \
    curl -fsSL "https://github.com/pufferffish/wireproxy/releases/download/v${WIREPROXY_VERSION}/wireproxy_linux_${WP_ARCH}.tar.gz" | tar -xz -C /usr/local/bin wireproxy && \
    chmod +x /usr/local/bin/wireproxy

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install bgutil POT provider plugin for yt-dlp
RUN pip install --no-cache-dir bgutil-ytdlp-pot-provider

# Ensure node is accessible and create symlinks
RUN which node && node --version

# Clone and build the POT provider server
RUN git clone --single-branch --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /pot-provider \
    && cd /pot-provider/server \
    && npm install \
    && npx tsc

# Copy application files
COPY app.py .
COPY supervisord.conf .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Create WARP directory
RUN mkdir -p /app/warp

# Expose port
EXPOSE 5000

# Use entrypoint to set up WARP before starting services
ENTRYPOINT ["/app/entrypoint.sh"]
