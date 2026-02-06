# Tanaghum yt-dlp Service with PO Token Support
FROM python:3.11-slim

# Install system dependencies including Node.js for POT provider
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    gnupg \
    git \
    supervisor \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install bgutil POT provider plugin for yt-dlp
# Also install yt-dlp-ejs for JavaScript challenge solving
RUN pip install --no-cache-dir bgutil-ytdlp-pot-provider yt-dlp-ejs

# Ensure node is accessible and create symlinks
RUN which node && node --version

# Clone and build the POT provider server
RUN git clone --single-branch --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /pot-provider \
    && cd /pot-provider/server \
    && npm install \
    && npx tsc

# Copy application
COPY app.py .
COPY supervisord.conf .

# Expose port
EXPOSE 5000

# Run with supervisor (manages both POT server and Flask app)
CMD ["supervisord", "-c", "/app/supervisord.conf"]
