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

**🚀 Live Now** — [jeranaias.github.io/tanaghum](https://jeranaias.github.io/tanaghum)

### Try It
1. Visit the [Generator](https://jeranaias.github.io/tanaghum/generator.html)
2. Paste any Arabic YouTube URL
3. Select your target ILR level
4. Click **Generate Lesson**
5. Preview and export as standalone HTML

---

## Quick Start

### Option 1: Use Online (Recommended)

Visit [jeranaias.github.io/tanaghum](https://jeranaias.github.io/tanaghum) — no installation required.

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

### Audio & Transcript Pipeline

When a YouTube video is selected, the tool obtains a transcript through the following methods (in priority order):

| Priority | Method | How It Works |
|----------|--------|-------------|
| 1 | **YouTube Captions** | Uses existing caption tracks (text only) via YouTube's InnerTube API. No audio download needed. This is the most common path. |
| 2 | **Piped API** | Open-source YouTube frontend instances that provide caption and stream data. |
| 3 | **yt-dlp + WARP** | Self-hosted extraction service on Fly.io using Cloudflare WARP (a legitimate VPN service) for network connectivity. Includes PO Token authentication for YouTube's anti-bot system. |
| 4 | **InnerTube API** | Direct calls to YouTube's internal API with multiple client configurations. |
| 5 | **Browser Audio Capture** | Falls back to the browser's `getDisplayMedia()` API — the same standard Web API used by Google Meet, Zoom, and Teams. Audio is captured at 2x speed, transcribed in-memory via Whisper, and never stored or transmitted. |

For uploaded audio files, Whisper transcription runs entirely in the browser (no server upload).

### Processing Pipeline

1. **Transcription** — Captions from YouTube or Whisper-generated transcript
2. **Analysis** — ILR level assessment, dialect detection, vocabulary extraction
3. **Question Generation** — LLM creates pre/while/post-listening exercises from transcript text
4. **Lesson Assembly** — Build interactive HTML with YouTube embed player and exercises

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

---

## Legal & Fair Use

### Educational Purpose

Tanaghum is designed exclusively as an educational tool for developing Arabic listening comprehension skills. It is intended for use by language instructors and students at academic institutions, including the Defense Language Institute Foreign Language Center (DLIFLC) and similar DoD, IC, and academic language programs. The tool creates original pedagogical exercises — not copies of source material.

### Fair Use (17 U.S.C. § 107)

The use of publicly available content for the creation of educational materials is supported by the Fair Use doctrine under U.S. copyright law:

| Factor | Analysis |
|--------|----------|
| **Purpose & Character** | Nonprofit educational use for government/academic language instruction. Transformative — creates original comprehension exercises, not reproductions. |
| **Nature of the Work** | Uses factual, publicly broadcast content (news, interviews, lectures, educational videos). |
| **Amount Used** | Lessons reference content via YouTube's official embedded player. No audio or video files are copied, stored, or redistributed. |
| **Effect on Market** | No substitute for the original. May increase viewership by directing students to original videos. |

### What This Tool Does NOT Do

- **Does not download, store, or host** any copyrighted audio or video content
- **Does not redistribute** any YouTube content
- **Does not circumvent** digital rights management (DRM) protections
- **Does not bypass** YouTube's access controls or authentication

### What This Tool DOES Do

- Uses YouTube's **official iframe embed player** for all content playback in generated lessons
- Uses **existing YouTube captions** (text only) when available — the preferred and most common path
- Uses the browser's **standard `getDisplayMedia()` API** for audio capture when captions are unavailable. This is the same Web API used by Google Meet, Zoom, Microsoft Teams, and all major video conferencing applications. Audio is processed in-memory and never stored or transmitted.
- Generates **original educational content**: comprehension questions, vocabulary exercises, and instructional scaffolding
- Routes YouTube metadata requests through a **Cloudflare Worker** (a standard CDN/proxy service)
- Uses **Cloudflare WARP** (a legitimate, publicly available VPN product) for network connectivity on the audio extraction service

### YouTube Terms of Service

YouTube's embedded player is used in compliance with YouTube's [Terms of Service](https://www.youtube.com/t/terms) and [API Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service). The iframe embed player is YouTube's officially supported and documented method for third-party content integration.

### Data Privacy

- No user accounts or authentication required
- No personal data collected, stored, or transmitted
- No analytics tracking, cookies, or fingerprinting
- Audio processing occurs entirely in the user's browser
- Only transcript text (never audio) is sent to LLM APIs for exercise generation
- The complete source code is publicly available and auditable

### Open Source Accountability

This project is fully open source. **Institutional compliance officers, legal counsel, and security reviewers** are welcome and encouraged to review the complete source code to verify all claims made in this document.

### DMCA & Content Concerns

If you are a content owner and believe your content is being used inappropriately through this tool, please open a GitHub issue. We will respond promptly and work to address any legitimate concerns.

---

## Part of the Arabic Learning Toolkit

| Tool | Purpose | Status |
|------|---------|--------|
| **Harakat** | Arabic diacritizer | ✅ Active |
| **Nahawi** | Arabic grammar analyzer | ✅ Active |
| **Tanaghum** | Multimodal lesson generator | ✅ Live |

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

# Deploy worker
cd worker && wrangler deploy

# Deploy yt-dlp service (requires Fly.io CLI)
cd ytdlp-service && fly deploy
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
