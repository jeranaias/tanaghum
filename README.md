<p align="center">
  <h1 align="center">تناغم</h1>
  <h3 align="center">Tanaghum</h3>
  <p align="center">
    <strong>Arabic Multimodal Learning Material Generator</strong>
  </p>
  <p align="center">
    Generate professional Arabic comprehension lessons with synchronized audio and text.<br>
    ILR-calibrated • AI-powered • 100% Free
  </p>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#demo">Demo</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#deployment">Deployment</a>
</p>

---

## Why Tanaghum?

Current Arabic listening materials either:
- Cost hundreds of dollars (Rosetta Stone, ArabicPod101)
- Lack pedagogical rigor (random YouTube videos)
- Require technical expertise to create (GLOSS materials)
- Don't support multimodal learning (audio OR text, not both)

**Tanaghum solves all of these problems** — for free, in your browser.

### The Science

Research shows that **presenting audio and text simultaneously** increases comprehension by 40-60% for L2 learners (Vandergrift & Goh, 2012). Tanaghum implements Paivio's Dual Coding Theory:

```
Audio plays → Waveform visualizes → Transcript scrolls → Word highlights
     ↓              ↓                     ↓                   ↓
  Ears hear    Eyes track           Brain reads         Memory encodes
```

Students can choose their entry point based on their strengths — using text as scaffolding for listening, or audio to improve reading fluency.

---

## Features

| Feature | Description |
|---------|-------------|
| **Multimodal Sync** | Audio and text perfectly synchronized — highlighted words follow playback |
| **ILR Calibrated** | Automatic difficulty assessment using official ILR criteria (1.0 - 3.5) |
| **AI Questions** | Pre, while, and post-listening comprehension exercises |
| **Question Types** | Multiple choice, true/false, fill-in-blank, open-ended |
| **Any Source** | YouTube videos, uploaded audio, or direct text input |
| **Dialect Detection** | MSA, Egyptian, Levantine, Gulf, Maghrebi |
| **Mobile Ready** | Responsive design for desktop, tablet, and mobile |
| **Offline Export** | Download standalone HTML lessons that work anywhere |
| **Zero Cost** | No account, no subscription, no tracking |

---

## Demo

🚧 **Coming Soon** — Live demo at [tanaghum.github.io](https://tanaghum.github.io)

### Screenshots

<details>
<summary>Landing Page</summary>

![Landing Page](docs/screenshots/landing.png)
</details>

<details>
<summary>Lesson Generator</summary>

![Generator](docs/screenshots/generator.png)
</details>

<details>
<summary>Lesson Player</summary>

![Player](docs/screenshots/player.png)
</details>

---

## Quick Start

### Option 1: Use Online (Recommended)

Visit [tanaghum.github.io](https://tanaghum.github.io) — no installation required.

### Option 2: Run Locally

```bash
# Clone the repository
git clone https://github.com/jeranaias/tanaghum.git
cd tanaghum

# Serve with any static server
npx serve .
# or
python -m http.server 8000

# Open http://localhost:8000
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. INPUT          2. PROCESS         3. GENERATE              │
│   ┌──────────┐      ┌──────────┐      ┌──────────┐             │
│   │ YouTube  │      │ Whisper  │      │   LLM    │             │
│   │ Upload   │ ───► │ Transcr. │ ───► │Questions │             │
│   │ Text     │      │ Analysis │      │ Assembly │             │
│   └──────────┘      └──────────┘      └──────────┘             │
│                                                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKER (Free)                     │
├─────────────────────────────────────────────────────────────────┤
│  • YouTube caption extraction (InnerTube API)                   │
│  • LLM API proxying (Google, Groq, OpenRouter)                  │
│  • CORS handling for cross-origin requests                      │
└─────────────────────────────────────────────────────────────────┘
```

### Processing Pipeline

1. **Content Acquisition**
   - YouTube: Extract existing captions via InnerTube API
   - Upload: Transcribe with Whisper-small ONNX in browser
   - Text: Use provided transcript directly

2. **Analysis**
   - Calculate ILR level based on vocabulary, syntax, discourse
   - Detect dialect (MSA, Egyptian, Levantine, Gulf, Maghrebi)
   - Extract key vocabulary and collocations

3. **Question Generation**
   - Pre-listening: Prediction, schema activation, vocabulary preview
   - While-listening: Main idea, details, sequence, inference
   - Post-listening: Vocabulary in context, synthesis, evaluation

4. **Lesson Assembly**
   - Generate synchronized VTT captions
   - Build interactive HTML with embedded audio
   - Create standalone exportable file

---

## Tech Stack

| Layer | Technology | Why |
|-------|------------|-----|
| **Frontend** | Vanilla JS (ES2022+) | Zero dependencies, maximum control |
| **Styling** | CSS Custom Properties | Native theming, no build step |
| **Transcription** | Transformers.js + Whisper | Best browser-feasible Arabic quality |
| **LLM** | Gemini Flash / Llama 3.3 | Free tiers, Arabic support |
| **Serverless** | Cloudflare Worker | 100K req/day free, global edge |
| **Hosting** | GitHub Pages | Free, reliable, zero config |

### LLM Provider Fallback Chain

```
Google AI Studio (250/day) → Groq (1,000/day) → OpenRouter (50/day)
```

All providers offer free tiers. The app automatically falls back if one is unavailable.

---

## Deployment

### 1. Fork & Clone

```bash
git clone https://github.com/YOUR_USERNAME/tanaghum.git
cd tanaghum
```

### 2. Deploy Cloudflare Worker

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Navigate to worker directory
cd worker

# Set API keys as secrets
wrangler secret put GOOGLE_API_KEY    # Get from aistudio.google.com
wrangler secret put GROQ_API_KEY      # Get from console.groq.com
wrangler secret put OPENROUTER_API_KEY # Get from openrouter.ai/keys

# Deploy
wrangler deploy
```

### 3. Update Config

Edit `js/core/config.js` with your Worker URL:

```javascript
WORKER_URL: 'https://tanaghum-worker.YOUR_SUBDOMAIN.workers.dev'
```

### 4. Enable GitHub Pages

1. Go to repo Settings → Pages
2. Set source to "Deploy from a branch"
3. Select `main` branch, `/ (root)` folder
4. Save

Your site will be live at `https://YOUR_USERNAME.github.io/tanaghum`

---

## API Keys (All Free)

| Provider | Daily Limit | Get Key |
|----------|-------------|---------|
| Google AI Studio | 250 requests | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| Groq | 1,000 requests | [console.groq.com](https://console.groq.com/keys) |
| OpenRouter | 50 requests | [openrouter.ai/keys](https://openrouter.ai/keys) |

**Total: 1,300 free LLM requests per day** — enough for ~100+ lessons.

---

## Project Structure

```
tanaghum/
├── index.html                 # Landing page
├── generator.html             # Main application
├── gallery.html               # Community lessons
├── lesson-template.html       # Generated lesson template
│
├── css/
│   ├── main.css              # Design system + components
│   ├── generator.css         # Generator page styles
│   └── lesson.css            # Lesson player styles
│
├── js/
│   ├── core/                 # Foundation
│   │   ├── config.js         # API endpoints, settings
│   │   ├── state-manager.js  # Reactive state
│   │   ├── event-bus.js      # Pub/sub messaging
│   │   └── utils.js          # Helpers (Arabic, YouTube, etc.)
│   │
│   ├── content/              # Content acquisition
│   │   ├── youtube-fetcher.js
│   │   ├── audio-processor.js
│   │   └── file-uploader.js
│   │
│   ├── transcription/        # Speech-to-text
│   │   ├── whisper-engine.js
│   │   ├── arabic-normalizer.js
│   │   └── vtt-generator.js
│   │
│   ├── analysis/             # Content analysis
│   │   ├── ilr-assessor.js
│   │   ├── vocabulary-analyzer.js
│   │   └── dialect-detector.js
│   │
│   ├── generation/           # Question generation
│   │   ├── llm-client.js
│   │   ├── prompt-builder.js
│   │   └── question-validator.js
│   │
│   ├── lesson/               # Lesson playback
│   │   ├── audio-player.js
│   │   ├── transcript-sync.js
│   │   └── quiz-handler.js
│   │
│   └── ui/                   # UI components
│       ├── toast.js
│       ├── modal.js
│       └── progress-bar.js
│
├── assets/
│   ├── data/
│   │   ├── frequency-10k.json    # Arabic word frequencies
│   │   ├── ilr-descriptors.json  # ILR level criteria
│   │   └── question-templates.json
│   └── fonts/
│       └── NotoNaskhArabic.woff2
│
├── worker/                   # Cloudflare Worker
│   ├── src/
│   │   ├── index.js         # Router + CORS
│   │   └── handlers/
│   │       ├── youtube.js   # Caption extraction
│   │       ├── llm.js       # API proxying
│   │       └── proxy.js     # Generic CORS proxy
│   ├── wrangler.toml
│   └── package.json
│
└── docs/
    ├── user-guide.md
    ├── api-reference.md
    └── pedagogy.md
```

---

## Part of the Arabic Learning Toolkit

| Tool | Purpose | Status |
|------|---------|--------|
| **Harakat** | Arabic diacritizer | ✅ Active |
| **Nahawi** | Arabic grammar analyzer | ✅ Active |
| **Tanaghum** | Multimodal lesson generator | 🚧 Building |

---

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](docs/CONTRIBUTING.md) first.

### Development

```bash
# Clone
git clone https://github.com/jeranaias/tanaghum.git

# Serve locally
npx serve .

# Run worker locally
cd worker && wrangler dev
```

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Author

**SSgt Jesse Morgan, USMC**

---

<p align="center">
  <sub>
    تناغم (Tanaghum) means "harmony" in Arabic —<br>
    reflecting the synergy of audio and text working together for enhanced comprehension.
  </sub>
</p>
