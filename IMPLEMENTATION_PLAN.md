# Tanaghum Master Implementation Plan
## The World's Best Arabic Listening Lesson Generator

This document details all 50 improvements across 4 phases, with exact file locations, code changes, and testing criteria.

---

# PHASE 1: Foundation & Quality (15 Improvements)
**Goal**: Rock-solid reliability, professional error handling, better quiz flow

## 1.1 LLM Timeout & Retry (R5)
**Priority**: Critical | **Files**: `js/generation/llm-client.js`

### Changes Required:
```javascript
// Add to generateContent method around line 85
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

try {
  const response = await fetch(url, {
    ...options,
    signal: controller.signal
  });
  clearTimeout(timeoutId);
  // ... existing logic
} catch (error) {
  clearTimeout(timeoutId);
  if (error.name === 'AbortError') {
    log.warn(`Provider ${provider} timed out, trying next...`);
    return this.tryNextProvider(prompt, options);
  }
  throw error;
}
```

### Testing:
- [ ] Simulate slow network - should timeout after 30s
- [ ] Should automatically try next provider on timeout
- [ ] User sees "Retrying with backup provider..." message

---

## 1.2 Progressive Lesson Saving (R6)
**Priority**: Critical | **Files**: `generator.html`, `js/generation/lesson-generator.js`

### Changes Required:
Add auto-save after each generation step:

```javascript
// In generator.html, after each step completes
async function saveProgressToIDB(step, data) {
  const db = await openProgressDB();
  const tx = db.transaction('progress', 'readwrite');
  const existing = await tx.store.get('current') || {};
  existing[step] = data;
  existing.timestamp = Date.now();
  await tx.store.put(existing, 'current');
}

// Save points:
// 1. After transcription completes
// 2. After vocabulary extraction
// 3. After questions generation
// 4. After full lesson assembly
```

### Recovery UI:
```html
<!-- Add to generator.html after line 50 -->
<div id="recovery-banner" class="recovery-banner hidden">
  <span>Found incomplete lesson from earlier. </span>
  <button id="resume-btn">Resume</button>
  <button id="discard-btn">Start Fresh</button>
</div>
```

### Testing:
- [ ] Start generation, close tab mid-way
- [ ] Reopen - should show recovery banner
- [ ] "Resume" should continue from last step
- [ ] "Start Fresh" should clear and restart

---

## 1.3 Network Retry with Backoff (R3)
**Priority**: High | **Files**: `js/core/utils.js`, `js/generation/llm-client.js`

### Add utility function:
```javascript
// In utils.js
export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status >= 500) throw new Error(`Server error: ${response.status}`);
      return response; // 4xx errors don't retry
    } catch (error) {
      lastError = error;
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}
```

### Testing:
- [ ] Throttle network to Slow 3G
- [ ] Generation should retry on failures
- [ ] Should show "Retrying..." toast

---

## 1.4 Cancellable Transcription (R1)
**Priority**: High | **Files**: `generator.html`

### Changes Required:
```javascript
// Add AbortController for transcription
let transcriptionController = null;

async function startTranscription() {
  transcriptionController = new AbortController();

  // Show cancel button
  $('#cancel-transcription-btn').classList.remove('hidden');

  try {
    // Pass signal to worker
    const result = await whisperWorker.transcribe(audio, {
      signal: transcriptionController.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      showToast('info', 'Cancelled', 'Transcription cancelled');
      return;
    }
    throw error;
  }
}

$('#cancel-transcription-btn').addEventListener('click', () => {
  transcriptionController?.abort();
});
```

### Testing:
- [ ] Start transcription of long audio
- [ ] Cancel button should appear
- [ ] Clicking cancel should stop immediately
- [ ] UI should reset to ready state

---

## 1.5 Quiz Answer Persistence (P7)
**Priority**: High | **Files**: `js/player/quiz-panel.js`

### Changes Required:
```javascript
// Add to QuizPanel class
saveAnswerState() {
  const state = {
    answers: this.userAnswers,
    currentIndex: this.currentQuestionIndex,
    timestamp: Date.now()
  };
  sessionStorage.setItem(`quiz_${this.lessonId}`, JSON.stringify(state));
}

loadAnswerState() {
  const saved = sessionStorage.getItem(`quiz_${this.lessonId}`);
  if (saved) {
    const state = JSON.parse(saved);
    // Only restore if less than 1 hour old
    if (Date.now() - state.timestamp < 3600000) {
      this.userAnswers = state.answers;
      this.currentQuestionIndex = state.currentIndex;
      return true;
    }
  }
  return false;
}

// Call saveAnswerState() after each answer submission
```

### Testing:
- [ ] Answer 3 questions, refresh page
- [ ] Answers should be preserved
- [ ] Progress indicator should show correct state

---

## 1.6 Time Estimates (U2)
**Priority**: Medium | **Files**: `generator.html`

### Add time tracking:
```javascript
const TIME_ESTIMATES = {
  transcription: { base: 30, perMinute: 15 }, // 30s + 15s per minute of audio
  vocabulary: { base: 10, perWord: 0.5 },
  questions: { base: 15, perQuestion: 3 },
  total: { min: 60, max: 300 }
};

function estimateTime(audioDuration, targetQuestions = 10) {
  const transcriptTime = TIME_ESTIMATES.transcription.base +
    (audioDuration / 60) * TIME_ESTIMATES.transcription.perMinute;
  const vocabTime = TIME_ESTIMATES.vocabulary.base;
  const questionTime = TIME_ESTIMATES.questions.base +
    targetQuestions * TIME_ESTIMATES.questions.perQuestion;

  return Math.round(transcriptTime + vocabTime + questionTime);
}

// Update UI to show: "Estimated time: ~2 minutes"
```

### Testing:
- [ ] Select 5-minute video - should show ~2-3 min estimate
- [ ] Select 15-minute video - should show ~5-6 min estimate
- [ ] Actual time should be within 50% of estimate

---

## 1.7 Actionable Error Messages (U3)
**Priority**: Medium | **Files**: `js/core/utils.js`, `generator.html`

### Error message mapping:
```javascript
const ERROR_MESSAGES = {
  'Failed to fetch': {
    title: 'Network Error',
    message: 'Cannot connect to server.',
    action: 'Check your internet connection and try again.',
    retry: true
  },
  'quota exceeded': {
    title: 'Usage Limit Reached',
    message: 'Daily LLM quota exhausted.',
    action: 'Click "Reset Quota" or wait until tomorrow.',
    retry: false
  },
  'video unavailable': {
    title: 'Video Not Found',
    message: 'This video is private or deleted.',
    action: 'Try a different video URL.',
    retry: false
  },
  'no speech detected': {
    title: 'No Speech Found',
    message: 'The audio contains no recognizable speech.',
    action: 'Choose a video with spoken Arabic content.',
    retry: false
  }
};

function getActionableError(error) {
  const msg = error.message?.toLowerCase() || '';
  for (const [key, config] of Object.entries(ERROR_MESSAGES)) {
    if (msg.includes(key.toLowerCase())) return config;
  }
  return {
    title: 'Unexpected Error',
    message: error.message,
    action: 'Please try again or contact support.',
    retry: true
  };
}
```

### Testing:
- [ ] Disconnect network - should show connection error with retry
- [ ] Use invalid URL - should show video error
- [ ] Each error should have clear action

---

## 1.8 Difficulty Ordering (Q7)
**Priority**: Medium | **Files**: `js/player/quiz-panel.js`

### Changes Required:
```javascript
// Add to load() method
sortByDifficulty(questions) {
  const difficultyOrder = {
    'literal': 1,
    'inference': 2,
    'critical': 3,
    'vocabulary': 1.5,
    'grammar': 2
  };

  return [...questions].sort((a, b) => {
    const aDiff = difficultyOrder[a.type?.toLowerCase()] || 2;
    const bDiff = difficultyOrder[b.type?.toLowerCase()] || 2;
    return aDiff - bDiff;
  });
}

// In load():
this.questions = this.sortByDifficulty(questions);
```

### Testing:
- [ ] Generate lesson - literal questions should appear first
- [ ] Critical thinking questions should appear last
- [ ] Vocabulary questions should appear early

---

## 1.9 "Why Not Others" Explanations (Q5)
**Priority**: Medium | **Files**: `js/generation/prompts.js`, `js/player/quiz-panel.js`

### Update prompt:
```javascript
// In prompts.js, add to question generation prompt
For each question, provide:
- correct_answer: the right answer
- explanation: why it's correct
- distractor_explanations: {
    "wrong_option_1": "why this is wrong",
    "wrong_option_2": "why this is wrong",
    "wrong_option_3": "why this is wrong"
  }
```

### Update quiz display:
```javascript
// In quiz-panel.js, showFeedback method
if (question.distractor_explanations && !isCorrect) {
  const wrongExplanation = question.distractor_explanations[selectedAnswer];
  feedbackHtml += `<div class="why-wrong">
    <strong>Why not:</strong> ${wrongExplanation}
  </div>`;
}
```

### Testing:
- [ ] Answer incorrectly - should see explanation for wrong choice
- [ ] Explanation should be educational, not just "wrong"

---

## 1.10 Distractor Taxonomy (Q1)
**Priority**: Medium | **Files**: `js/generation/prompts.js`

### Enhanced prompt:
```javascript
// Add to question generation prompt
Create distractors using these strategies:
1. Phonetic similarity (words that sound alike)
2. Semantic proximity (related but wrong meaning)
3. Partial truth (partly correct but incomplete)
4. Common misconception (typical learner errors)

Each distractor should be:
- Plausible enough to require careful reading
- Educational when explained
- Appropriate for ILR level ${level}
```

### Testing:
- [ ] Distractors should be challenging but fair
- [ ] No obviously wrong answers
- [ ] Each distractor tests different understanding

---

## 1.11 Progress Drag/Seek (P1)
**Priority**: Medium | **Files**: `player.html`, `css/player.css`

### Changes Required:
```javascript
// In player.html, update progress bar
const progressBar = $('#progress-bar');
let isDragging = false;

progressBar.addEventListener('mousedown', (e) => {
  isDragging = true;
  seekToPosition(e);
});

document.addEventListener('mousemove', (e) => {
  if (isDragging) seekToPosition(e);
});

document.addEventListener('mouseup', () => {
  isDragging = false;
});

function seekToPosition(e) {
  const rect = progressBar.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audioPlayer.currentTime = percent * audioPlayer.duration;
}
```

### CSS:
```css
.progress-bar {
  cursor: pointer;
}
.progress-bar:hover .progress-handle {
  opacity: 1;
  transform: scale(1.2);
}
```

### Testing:
- [ ] Click anywhere on progress bar - should jump to that time
- [ ] Drag handle - should scrub audio smoothly
- [ ] Transcript should sync after seeking

---

## 1.12 Segment Navigation (P2)
**Priority**: Medium | **Files**: `js/player/transcript-panel.js`, `player.html`

### Add segment buttons:
```html
<div class="segment-controls">
  <button id="prev-segment" title="Previous segment">⏮</button>
  <button id="replay-segment" title="Replay segment">🔄</button>
  <button id="next-segment" title="Next segment">⏭</button>
</div>
```

### Logic:
```javascript
$('#prev-segment').addEventListener('click', () => {
  const current = transcriptPanel.getCurrentSegmentIndex();
  if (current > 0) {
    transcriptPanel.jumpToSegment(current - 1);
  }
});

$('#next-segment').addEventListener('click', () => {
  const current = transcriptPanel.getCurrentSegmentIndex();
  transcriptPanel.jumpToSegment(current + 1);
});

$('#replay-segment').addEventListener('click', () => {
  const current = transcriptPanel.getCurrentSegmentIndex();
  transcriptPanel.jumpToSegment(current);
});
```

### Testing:
- [ ] Next/Prev buttons should jump between segments
- [ ] Replay should restart current segment
- [ ] Keyboard shortcuts (← →) should also work

---

## 1.13 Anki Export (V10)
**Priority**: Medium | **Files**: `js/player/vocabulary-panel.js`

### Add export button:
```javascript
exportToAnki() {
  const cards = this.vocabulary.map(item => ({
    front: item.word_ar || item.arabic,
    back: `${item.word_en || item.english}\n\n${item.definition_en || ''}\n\nExample: ${item.example_ar || ''}`
  }));

  // Create Anki-compatible text file
  const content = cards.map(c => `${c.front}\t${c.back}`).join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tanaghum_vocab_${Date.now()}.txt`;
  a.click();
}
```

### UI:
```html
<button class="export-btn" id="export-anki">
  📤 Export to Anki
</button>
```

### Testing:
- [ ] Click export - should download .txt file
- [ ] Import into Anki - cards should appear correctly
- [ ] Arabic text should display properly

---

## 1.14 Transliteration Toggle (V8)
**Priority**: Low | **Files**: `js/player/vocabulary-panel.js`

### Add transliteration:
```javascript
// Simple transliteration map
const TRANSLIT_MAP = {
  'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j',
  'ح': 'ḥ', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r',
  'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 'ṣ', 'ض': 'ḍ',
  'ط': 'ṭ', 'ظ': 'ẓ', 'ع': 'ʿ', 'غ': 'gh', 'ف': 'f',
  'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ي': 'y', 'ء': 'ʾ',
  'ى': 'ā', 'ة': 'a', 'أ': 'ʾa', 'إ': 'ʾi', 'آ': 'ʾā',
  'ؤ': 'ʾu', 'ئ': 'ʾi'
};

transliterate(arabic) {
  return arabic.split('').map(c => TRANSLIT_MAP[c] || c).join('');
}
```

### Testing:
- [ ] Toggle should show/hide transliteration
- [ ] Transliteration should be reasonably accurate
- [ ] Should work for all vocabulary items

---

## 1.15 Frequency Ranking (V1)
**Priority**: Low | **Files**: `js/generation/prompts.js`, `js/player/vocabulary-panel.js`

### Update prompt:
```javascript
// Add to vocabulary extraction prompt
For each word, estimate its frequency:
- "high": Top 1000 most common Arabic words
- "medium": Common but not essential
- "low": Specialized or rare vocabulary

Include: frequency: "high" | "medium" | "low"
```

### Display:
```javascript
// In renderVocabItem
const freqBadge = item.frequency ?
  `<span class="freq-badge freq-${item.frequency}">${item.frequency}</span>` : '';
```

### CSS:
```css
.freq-high { background: #22c55e; }
.freq-medium { background: #eab308; }
.freq-low { background: #ef4444; }
```

### Testing:
- [ ] Common words should show green "high" badge
- [ ] Rare words should show red "low" badge

---

# PHASE 1 TESTING CHECKLIST

After implementing all Phase 1 improvements, verify:

## Reliability Tests
- [ ] Start generation, kill tab → Resume works
- [ ] Slow network → Retries with backoff
- [ ] LLM timeout → Falls back to next provider
- [ ] Cancel button → Stops transcription cleanly

## Quiz Tests
- [ ] Questions ordered easy → hard
- [ ] Wrong answer shows "why not" explanation
- [ ] Refresh page → Answers preserved
- [ ] Distractors are challenging but fair

## Player Tests
- [ ] Click progress bar → Seeks correctly
- [ ] Segment buttons → Navigate properly
- [ ] Anki export → Valid import file

## Vocabulary Tests
- [ ] Frequency badges display
- [ ] Transliteration toggle works
- [ ] Export includes all data

---

# PHASE 2: Delight & Engagement (15 Improvements)

## 2.1 Lesson Templates (U1)
**Files**: `generator.html`, `js/generation/templates.js` (new)

### Create template system:
```javascript
// New file: js/generation/templates.js
export const LESSON_TEMPLATES = {
  'news-analysis': {
    name: 'News Analysis',
    description: 'Current events with formal MSA',
    questionTypes: ['main-idea', 'inference', 'vocabulary'],
    vocabFocus: 'formal',
    questionCount: 10
  },
  'dialect-intro': {
    name: 'Dialect Introduction',
    description: 'Learn regional spoken Arabic',
    questionTypes: ['vocabulary', 'cultural', 'pronunciation'],
    vocabFocus: 'colloquial',
    questionCount: 8
  },
  'grammar-deep-dive': {
    name: 'Grammar Focus',
    description: 'Detailed grammatical analysis',
    questionTypes: ['grammar', 'structure', 'application'],
    vocabFocus: 'roots',
    questionCount: 12
  }
};
```

### UI: Template selector dropdown before generation

---

## 2.2 Keyboard Shortcuts (P5)
**Files**: `player.html`

### Add shortcuts:
```javascript
const SHORTCUTS = {
  'Space': () => togglePlayPause(),
  'ArrowLeft': () => seekRelative(-5),
  'ArrowRight': () => seekRelative(5),
  'ArrowUp': () => adjustSpeed(0.1),
  'ArrowDown': () => adjustSpeed(-0.1),
  'r': () => replaySegment(),
  's': () => toggleSlowMode(),
  '1-9': (n) => jumpToPercent(n * 10)
};

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const handler = SHORTCUTS[e.key] || SHORTCUTS[e.code];
  if (handler) {
    e.preventDefault();
    handler(e.key);
  }
});
```

### Shortcut help overlay (? key)

---

## 2.3 Slow Playback Mode (P4)
**Files**: `player.html`

### Add slow mode toggle:
```javascript
let slowMode = false;

function toggleSlowMode() {
  slowMode = !slowMode;
  audioPlayer.playbackRate = slowMode ? 0.75 : 1.0;
  $('#slow-mode-btn').classList.toggle('active', slowMode);
}
```

### Visual indicator when slow mode active

---

## 2.4 Repeat Segment A-B Loop (P3)
**Files**: `player.html`

### A-B loop logic:
```javascript
let loopStart = null, loopEnd = null;

function setLoopPoint() {
  if (loopStart === null) {
    loopStart = audioPlayer.currentTime;
    showToast('info', 'Loop Start Set', 'Press again to set end point');
  } else if (loopEnd === null) {
    loopEnd = audioPlayer.currentTime;
    showToast('success', 'Loop Active', 'Press again to clear');
  } else {
    loopStart = loopEnd = null;
    showToast('info', 'Loop Cleared', '');
  }
}

audioPlayer.addEventListener('timeupdate', () => {
  if (loopEnd && audioPlayer.currentTime >= loopEnd) {
    audioPlayer.currentTime = loopStart;
  }
});
```

---

## 2.5 Spaced Repetition (V2)
**Files**: `js/player/vocabulary-panel.js`, IndexedDB

### SM-2 algorithm:
```javascript
function calculateNextReview(quality, repetitions, easeFactor, interval) {
  if (quality < 3) {
    return { repetitions: 0, interval: 1, easeFactor };
  }

  const newEF = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  const newInterval = repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.round(interval * newEF);

  return {
    repetitions: repetitions + 1,
    interval: newInterval,
    easeFactor: newEF,
    nextReview: Date.now() + newInterval * 86400000
  };
}
```

---

## 2.6 Vocabulary Quiz Mode (V3)
**Files**: `player.html`, `js/player/vocab-quiz.js` (new)

### Flashcard-style quiz:
- Show Arabic → guess English
- Show English → guess Arabic
- 4 multiple choice options
- Tracks mastery per word

---

## 2.7 Root Explorer (V5)
**Files**: `js/player/root-explorer.js` (new)

### Root analysis panel:
```javascript
// Show all words sharing a root
function exploreRoot(root) {
  const related = vocabulary.filter(v => v.root === root);
  showRootPanel({
    root,
    meaning: getRootMeaning(root),
    words: related,
    patterns: getPatterns(related)
  });
}
```

---

## 2.8 Audio Slow Segments (P9)
**Files**: `player.html`

### Detect fast speech:
```javascript
// Mark segments where speech is faster than average
function markFastSegments(segments) {
  const avgWordsPerSec = calculateAverageSpeed(segments);
  return segments.map(s => ({
    ...s,
    isFast: s.wordsPerSecond > avgWordsPerSec * 1.3
  }));
}

// Show warning icon on fast segments
```

---

## 2.9 Transcript Click-to-Play (P6)
**Files**: `js/player/transcript-panel.js`

Already partially implemented, enhance:
```javascript
// On word click:
// 1. Jump to timestamp
// 2. Highlight word
// 3. Show vocabulary popup if word exists
// 4. Auto-play segment
```

---

## 2.10 Mastery Tracking (Q2)
**Files**: IndexedDB, `player.html`

### Track performance:
```javascript
const masteryData = {
  lessonId: '',
  questionsAttempted: 0,
  correctFirstTry: 0,
  hintsUsed: 0,
  timeSpent: 0,
  masteryScore: 0 // 0-100
};

function calculateMastery() {
  return Math.round(
    (correctFirstTry / questionsAttempted) * 70 +
    (1 - hintsUsed / questionsAttempted) * 30
  );
}
```

---

## 2.11 Hint System (Q3)
**Files**: `js/player/quiz-panel.js`

### Progressive hints:
```javascript
getHint(question, hintLevel) {
  switch (hintLevel) {
    case 1: return `Listen again from ${question.timestamp}`;
    case 2: return `The answer relates to: ${question.topic}`;
    case 3: return `First letter: ${question.answer[0]}`;
  }
}
```

---

## 2.12 Review Mode (Q4)
**Files**: `js/player/quiz-panel.js`

### After quiz complete:
```javascript
function enterReviewMode() {
  // Show all questions with:
  // - User's answer vs correct
  // - Explanation
  // - Link to transcript timestamp
  // - "Practice again" button for wrong ones
}
```

---

## 2.13 Script Highlighting (T1)
**Files**: `js/player/transcript-panel.js`, CSS

### Enhanced highlighting:
```javascript
// Vocabulary words get special highlighting
function highlightVocab(segment) {
  const vocabWords = vocabulary.map(v => v.word_ar);
  let html = segment.text;

  vocabWords.forEach(word => {
    html = html.replace(
      new RegExp(word, 'g'),
      `<span class="vocab-word" data-word="${word}">${word}</span>`
    );
  });

  return html;
}
```

---

## 2.14 Segment Bookmarks (T2)
**Files**: `js/player/transcript-panel.js`, IndexedDB

### Save favorite segments:
```javascript
function bookmarkSegment(segmentIndex) {
  const bookmarks = getBookmarks();
  bookmarks.push({
    lessonId: currentLessonId,
    segmentIndex,
    timestamp: segments[segmentIndex].start,
    note: ''
  });
  saveBookmarks(bookmarks);
}
```

---

## 2.15 Dialect Labels (T4)
**Files**: `js/generation/prompts.js`, `js/player/transcript-panel.js`

### Identify dialect words:
```javascript
// In generation prompt:
// Mark dialect-specific words with: [EGY], [LEV], [GULF], [MAG]

// In display:
function renderDialectBadge(dialectCode) {
  const labels = {
    'EGY': 'Egyptian',
    'LEV': 'Levantine',
    'GULF': 'Gulf',
    'MAG': 'Maghrebi'
  };
  return `<span class="dialect-badge">${labels[dialectCode]}</span>`;
}
```

---

# PHASE 2 TESTING CHECKLIST

## Engagement Tests
- [ ] Templates change question types
- [ ] Keyboard shortcuts all work
- [ ] Slow mode adjusts speed
- [ ] A-B loop repeats correctly

## Vocabulary Tests
- [ ] Flashcard quiz works
- [ ] Spaced repetition schedules reviews
- [ ] Root explorer shows related words

## Quiz Tests
- [ ] Hints progressively reveal
- [ ] Review mode shows all explanations
- [ ] Mastery score calculates correctly

## Transcript Tests
- [ ] Click word → plays audio
- [ ] Vocab words highlighted
- [ ] Bookmarks save/load

---

# PHASE 3: Polish & Differentiation (12 Improvements)

## 3.1 Difficulty Auto-Adjustment (U4)
Adjust based on performance history

## 3.2 Dialect Detection (U5)
Show detected dialect before generation

## 3.3 Custom Vocabulary (U6)
Add personal vocabulary lists

## 3.4 Multi-Lesson Courses (U7)
Group lessons into learning paths

## 3.5 Transcript Notes (T3)
Add personal annotations

## 3.6 Export Options (T5)
PDF, SRT, Word export

## 3.7 Cultural Notes (V6)
Auto-generate context

## 3.8 Word Etymology (V7)
Show word origins

## 3.9 Morphological Breakdown (V9)
Pattern analysis (فَعَلَ etc.)

## 3.10 Question Explanations (Q6)
Deep-dive explanations

## 3.11 Visual Timeline (P8)
Interactive waveform

## 3.12 Progress Dashboard (P10)
Overall learning stats

---

# PHASE 4: Refinement (8 Improvements)

## 4.1 Memory Optimization (R2)
Web Worker for heavy processing

## 4.2 Bandwidth Optimization (R4)
Compress/cache intelligently

## 4.3 Error Analytics (R7)
Track and improve

## 4.4 Batch Generation (R8)
Multiple lessons at once

## 4.5 Reading Passages (V4)
Generate practice text

## 4.6 Timed Mode (Q8)
Speed challenge

## 4.7 Theme Customization
Dark mode, font sizes

## 4.8 PWA Support
Offline capability

---

# Implementation Order

```
Week 1-2: Phase 1 (Foundation)
├─ Day 1-2: R5, R6, R3 (reliability)
├─ Day 3-4: R1, P7, U2, U3 (UX basics)
├─ Day 5-7: Q7, Q5, Q1 (quiz quality)
└─ Day 8-10: P1, P2, V10, V8, V1 (player/vocab)

Week 3-4: Phase 2 (Engagement)
├─ Day 1-3: U1, P5, P4, P3 (templates/playback)
├─ Day 4-6: V2, V3, V5 (vocab features)
├─ Day 7-9: Q2, Q3, Q4 (quiz features)
└─ Day 10-12: T1, T2, T4, P6, P9 (transcript)

Week 5-6: Phase 3 (Polish)
└─ All 12 improvements

Week 7-8: Phase 4 (Refinement)
└─ All 8 improvements
```

---

# Success Metrics

After all phases:
- [ ] 0 crashes during generation
- [ ] <3% question rendering errors
- [ ] <2 minute generation for 5-min video
- [ ] 90%+ quiz completion rate
- [ ] Vocabulary retention tracking active
- [ ] Works offline (PWA)
- [ ] Dark mode available
- [ ] Export to 3+ formats

---

*This plan transforms Tanaghum into the world's best Arabic listening lesson generator.*
