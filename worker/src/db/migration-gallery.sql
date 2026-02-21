-- Gallery lessons (shared community lessons)
CREATE TABLE IF NOT EXISTS gallery_lessons (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  description TEXT,
  ilr_level TEXT NOT NULL,
  topic_code TEXT,
  topic_name TEXT,
  duration INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  video_id TEXT,
  source_type TEXT,
  transcript_preview TEXT,
  question_count INTEGER DEFAULT 0,
  vocabulary_count INTEGER DEFAULT 0,
  lesson_json TEXT NOT NULL,
  quality_score REAL DEFAULT 0,
  rating_avg REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  use_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gallery_status ON gallery_lessons(status);
CREATE INDEX IF NOT EXISTS idx_gallery_user ON gallery_lessons(user_id);
CREATE INDEX IF NOT EXISTS idx_gallery_topic ON gallery_lessons(topic_code);
CREATE INDEX IF NOT EXISTS idx_gallery_ilr ON gallery_lessons(ilr_level);
CREATE INDEX IF NOT EXISTS idx_gallery_created ON gallery_lessons(created_at);
CREATE INDEX IF NOT EXISTS idx_gallery_rating ON gallery_lessons(rating_avg);
CREATE INDEX IF NOT EXISTS idx_gallery_uses ON gallery_lessons(use_count);

-- Gallery ratings (one rating per user per lesson)
CREATE TABLE IF NOT EXISTS gallery_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lesson_id) REFERENCES gallery_lessons(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(lesson_id, user_id)
);
