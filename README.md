# Tanaghum (تناغم)

**Arabic Multimodal Learning Material Generator**

Tanaghum generates professional Arabic comprehension lessons with synchronized audio and text. Create ILR-calibrated lessons from YouTube videos, uploaded audio, or text input — completely free, no account required.

## Features

- **Multimodal Sync**: Audio and text perfectly synchronized for dual-channel learning
- **ILR Calibrated**: Automatic difficulty assessment using official ILR criteria (1.0 - 3.5)
- **AI-Generated Questions**: Pre, while, and post-listening comprehension exercises
- **Multiple Question Types**: Multiple choice, true/false, fill-in-blank, and open-ended
- **Any Arabic Source**: YouTube videos, uploaded audio files, or direct text input
- **Dialect Detection**: MSA, Egyptian, Levantine, Gulf, Maghrebi
- **Mobile Responsive**: Works on desktop, tablet, and mobile
- **Offline Export**: Download standalone HTML lessons

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES2022+), CSS Custom Properties
- **Transcription**: Transformers.js + Whisper-small ONNX (in-browser)
- **LLM Providers**: Google AI Studio, Groq, OpenRouter (free tiers)
- **Serverless**: Cloudflare Worker (100K req/day free)
- **Hosting**: GitHub Pages (static)

## Project Structure

```
tanaghum/
├── index.html              # Landing page
├── generator.html          # Main application
├── css/
│   ├── main.css           # Global styles
│   └── generator.css      # Generator-specific styles
├── js/
│   ├── core/              # State, events, config, utilities
│   └── ui/                # Toast, modal, progress components
├── assets/
│   ├── data/              # Frequency lists, ILR descriptors
│   ├── fonts/             # Arabic + English fonts
│   └── images/            # Icons, placeholders
├── worker/                # Cloudflare Worker
│   ├── src/
│   │   ├── index.js       # Main router
│   │   └── handlers/      # YouTube, LLM, proxy handlers
│   ├── wrangler.toml      # Worker config
│   └── package.json
└── docs/                  # Documentation
```

## Getting Started

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/tanaghum/tanaghum.git
   cd tanaghum
   ```

2. Serve the static files:
   ```bash
   npx serve .
   # or
   python -m http.server 8000
   ```

3. Open http://localhost:8000

### Deploy Cloudflare Worker

1. Install Wrangler:
   ```bash
   npm install -g wrangler
   ```

2. Configure secrets:
   ```bash
   cd worker
   wrangler secret put GOOGLE_API_KEY
   wrangler secret put GROQ_API_KEY
   wrangler secret put OPENROUTER_API_KEY
   ```

3. Deploy:
   ```bash
   wrangler deploy
   ```

4. Update `js/core/config.js` with your Worker URL.

## API Keys (Free Tiers)

| Provider | Daily Limit | Get Key |
|----------|-------------|---------|
| Google AI Studio | 250 requests | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| Groq | 1,000 requests | [console.groq.com](https://console.groq.com/keys) |
| OpenRouter | 50 requests | [openrouter.ai](https://openrouter.ai/keys) |

## Part of the Arabic Learning Toolkit

- **Harakat** — Arabic diacritizer
- **Nahawi** — Arabic grammar tool
- **Tanaghum** — Multimodal lesson generator

## License

MIT License

## Author

SSgt Jesse Morgan, USMC

---

*تناغم (Tanaghum) means "harmony" in Arabic — reflecting the synergy of audio and text working together for enhanced comprehension.*
