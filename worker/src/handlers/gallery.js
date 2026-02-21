/**
 * Gallery Handler
 * CRUD endpoints for community-shared lessons
 */

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

function errorResponse(message, status, origin) {
  return jsonResponse({ error: message }, status, origin);
}

// ─── Route Handler ──────────────────────────────────────────

export async function handleGallery(request, env, url, origin, user) {
  const path = url.pathname.replace('/api/gallery/', '');
  const parts = path.split('/').filter(Boolean);

  // GET /api/gallery/lessons
  if (parts[0] === 'lessons' && !parts[1] && request.method === 'GET') {
    return listLessons(request, env, url, origin);
  }

  // POST /api/gallery/lessons
  if (parts[0] === 'lessons' && !parts[1] && request.method === 'POST') {
    return publishLesson(request, env, origin, user);
  }

  // GET /api/gallery/lessons/:id
  if (parts[0] === 'lessons' && parts[1] && !parts[2] && request.method === 'GET') {
    return getLesson(env, parts[1], origin);
  }

  // DELETE /api/gallery/lessons/:id
  if (parts[0] === 'lessons' && parts[1] && !parts[2] && request.method === 'DELETE') {
    return deleteLesson(env, parts[1], origin, user);
  }

  // POST /api/gallery/lessons/:id/rate
  if (parts[0] === 'lessons' && parts[1] && parts[2] === 'rate' && request.method === 'POST') {
    return rateLesson(request, env, parts[1], origin, user);
  }

  // POST /api/gallery/lessons/:id/use
  if (parts[0] === 'lessons' && parts[1] && parts[2] === 'use' && request.method === 'POST') {
    return recordUse(env, parts[1], origin);
  }

  return errorResponse('Not found', 404, origin);
}

// ─── GET /api/gallery/lessons ───────────────────────────────

async function listLessons(request, env, url, origin) {
  const params = url.searchParams;
  const page = Math.max(1, parseInt(params.get('page') || '1'));
  const limit = Math.min(50, Math.max(1, parseInt(params.get('limit') || '20')));
  const offset = (page - 1) * limit;

  const ilr = params.get('ilr');
  const topic = params.get('topic');
  const search = params.get('search');
  const sort = params.get('sort') || 'newest';
  const duration = params.get('duration');

  // Build query dynamically
  let where = [`gl.status = 'active'`];
  let bindings = [];

  if (ilr) {
    where.push('gl.ilr_level = ?');
    bindings.push(ilr);
  }

  if (topic) {
    where.push('gl.topic_code = ?');
    bindings.push(topic);
  }

  if (search) {
    where.push('(gl.title_ar LIKE ? OR gl.title_en LIKE ? OR gl.description LIKE ?)');
    const searchPattern = `%${search}%`;
    bindings.push(searchPattern, searchPattern, searchPattern);
  }

  if (duration === 'short') {
    where.push('gl.duration < 300');
  } else if (duration === 'medium') {
    where.push('gl.duration >= 300 AND gl.duration <= 900');
  } else if (duration === 'long') {
    where.push('gl.duration > 900');
  }

  const whereClause = where.join(' AND ');

  let orderBy;
  switch (sort) {
    case 'popular': orderBy = 'gl.use_count DESC'; break;
    case 'rating': orderBy = 'gl.rating_avg DESC'; break;
    case 'oldest': orderBy = 'gl.created_at ASC'; break;
    case 'title': orderBy = 'gl.title_en ASC'; break;
    default: orderBy = 'gl.created_at DESC';
  }

  // Count total
  const countQuery = `SELECT COUNT(*) as total FROM gallery_lessons gl WHERE ${whereClause}`;
  const countResult = await env.DB.prepare(countQuery).bind(...bindings).first();
  const total = countResult?.total || 0;

  // Fetch page (no lesson_json for listing — too large)
  const listQuery = `
    SELECT gl.id, gl.title_ar, gl.title_en, gl.description, gl.ilr_level,
           gl.topic_code, gl.topic_name, gl.duration, gl.word_count,
           gl.video_id, gl.source_type, gl.transcript_preview,
           gl.question_count, gl.vocabulary_count, gl.quality_score,
           gl.rating_avg, gl.rating_count, gl.use_count,
           gl.created_at, gl.updated_at,
           u.name as author_name, u.picture as author_picture
    FROM gallery_lessons gl
    LEFT JOIN users u ON gl.user_id = u.id
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const result = await env.DB.prepare(listQuery)
    .bind(...bindings, limit, offset)
    .all();

  return jsonResponse({
    lessons: result.results || [],
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  }, 200, origin);
}

// ─── GET /api/gallery/lessons/:id ──────────────────────────

async function getLesson(env, lessonId, origin) {
  const row = await env.DB.prepare(`
    SELECT gl.*, u.name as author_name, u.picture as author_picture
    FROM gallery_lessons gl
    LEFT JOIN users u ON gl.user_id = u.id
    WHERE gl.id = ? AND gl.status = 'active'
  `).bind(lessonId).first();

  if (!row) {
    return errorResponse('Lesson not found', 404, origin);
  }

  // Parse lesson_json
  let lessonData;
  try {
    lessonData = JSON.parse(row.lesson_json);
  } catch {
    lessonData = null;
  }

  return jsonResponse({
    ...row,
    lesson_json: undefined,
    lesson: lessonData
  }, 200, origin);
}

// ─── POST /api/gallery/lessons ─────────────────────────────

async function publishLesson(request, env, origin, user) {
  if (!user) {
    return errorResponse('Authentication required', 401, origin);
  }

  const userId = parseInt(user.sub);

  // Rate limit: 10 lessons per user per day
  const today = new Date().toISOString().split('T')[0];
  const countToday = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM gallery_lessons WHERE user_id = ? AND date(created_at) = ?`
  ).bind(userId, today).first();

  if (countToday && countToday.count >= 10) {
    return errorResponse('Daily publish limit reached (10 per day)', 429, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400, origin);
  }

  const { lesson } = body;
  if (!lesson) {
    return errorResponse('Missing lesson data', 400, origin);
  }

  // Validate required fields
  const titleAr = lesson.metadata?.title?.ar;
  const titleEn = lesson.metadata?.title?.en;
  const transcript = lesson.content?.transcript?.text;
  const questions = lesson.content?.questions;

  if (!titleAr && !titleEn) {
    return errorResponse('Lesson must have a title', 400, origin);
  }

  if (!transcript || transcript.length < 50) {
    return errorResponse('Transcript must be at least 50 characters', 400, origin);
  }

  const questionCount =
    (questions?.pre?.length || 0) +
    (questions?.while?.length || 0) +
    (questions?.post?.length || 0);

  if (questionCount < 1) {
    return errorResponse('Lesson must have at least 1 question', 400, origin);
  }

  // Check lesson JSON size (500KB max)
  const lessonJson = JSON.stringify(lesson);
  if (lessonJson.length > 500 * 1024) {
    return errorResponse('Lesson data too large (max 500KB)', 400, origin);
  }

  // Check for duplicate (same lesson ID)
  const lessonId = lesson.id || `lesson_${Date.now().toString(36)}`;
  const existing = await env.DB.prepare(
    'SELECT id FROM gallery_lessons WHERE id = ?'
  ).bind(lessonId).first();

  if (existing) {
    return errorResponse('This lesson has already been published', 409, origin);
  }

  // Extract metadata
  const meta = lesson.metadata || {};
  const transcriptPreview = transcript.substring(0, 500);
  const vocabCount = lesson.content?.vocabulary?.items?.length || 0;

  // Calculate quality score
  const qualityScore = calculateQualityScore(lesson);

  await env.DB.prepare(`
    INSERT INTO gallery_lessons (
      id, user_id, title_ar, title_en, description, ilr_level,
      topic_code, topic_name, duration, word_count, video_id,
      source_type, transcript_preview, question_count, vocabulary_count,
      lesson_json, quality_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    lessonId,
    userId,
    titleAr || '',
    titleEn || '',
    meta.description?.en || meta.description?.ar || '',
    meta.ilr?.target || meta.ilr?.detected || '2',
    meta.topic?.code || '',
    meta.topic?.nameEn || '',
    meta.duration || 0,
    meta.wordCount || 0,
    meta.source?.videoId || '',
    meta.source?.type || '',
    transcriptPreview,
    questionCount,
    vocabCount,
    lessonJson,
    qualityScore
  ).run();

  return jsonResponse({
    success: true,
    id: lessonId,
    qualityScore
  }, 201, origin);
}

// ─── DELETE /api/gallery/lessons/:id ───────────────────────

async function deleteLesson(env, lessonId, origin, user) {
  if (!user) {
    return errorResponse('Authentication required', 401, origin);
  }

  const userId = parseInt(user.sub);

  // Check ownership
  const lesson = await env.DB.prepare(
    'SELECT user_id FROM gallery_lessons WHERE id = ? AND status = ?'
  ).bind(lessonId, 'active').first();

  if (!lesson) {
    return errorResponse('Lesson not found', 404, origin);
  }

  if (lesson.user_id !== userId) {
    return errorResponse('Not authorized to delete this lesson', 403, origin);
  }

  // Soft delete
  await env.DB.prepare(
    `UPDATE gallery_lessons SET status = 'deleted', updated_at = datetime('now') WHERE id = ?`
  ).bind(lessonId).run();

  return jsonResponse({ success: true }, 200, origin);
}

// ─── POST /api/gallery/lessons/:id/rate ────────────────────

async function rateLesson(request, env, lessonId, origin, user) {
  if (!user) {
    return errorResponse('Authentication required', 401, origin);
  }

  const userId = parseInt(user.sub);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400, origin);
  }

  const rating = parseInt(body.rating);
  if (!rating || rating < 1 || rating > 5) {
    return errorResponse('Rating must be between 1 and 5', 400, origin);
  }

  // Check lesson exists
  const lesson = await env.DB.prepare(
    'SELECT id FROM gallery_lessons WHERE id = ? AND status = ?'
  ).bind(lessonId, 'active').first();

  if (!lesson) {
    return errorResponse('Lesson not found', 404, origin);
  }

  // Upsert rating
  await env.DB.prepare(`
    INSERT INTO gallery_ratings (lesson_id, user_id, rating)
    VALUES (?, ?, ?)
    ON CONFLICT(lesson_id, user_id) DO UPDATE SET
      rating = excluded.rating,
      updated_at = datetime('now')
  `).bind(lessonId, userId, rating).run();

  // Recalculate average
  const stats = await env.DB.prepare(
    'SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM gallery_ratings WHERE lesson_id = ?'
  ).bind(lessonId).first();

  const avgRating = Math.round((stats?.avg_rating || 0) * 10) / 10;
  const ratingCount = stats?.count || 0;

  await env.DB.prepare(
    `UPDATE gallery_lessons SET rating_avg = ?, rating_count = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(avgRating, ratingCount, lessonId).run();

  return jsonResponse({
    success: true,
    rating_avg: avgRating,
    rating_count: ratingCount
  }, 200, origin);
}

// ─── POST /api/gallery/lessons/:id/use ─────────────────────

async function recordUse(env, lessonId, origin) {
  await env.DB.prepare(
    `UPDATE gallery_lessons SET use_count = use_count + 1, updated_at = datetime('now') WHERE id = ? AND status = 'active'`
  ).bind(lessonId).run();

  return jsonResponse({ success: true }, 200, origin);
}

// ─── Quality Score Calculator ──────────────────────────────

function calculateQualityScore(lesson) {
  let score = 0;

  const transcript = lesson.content?.transcript?.text || '';
  const questions = lesson.content?.questions || {};
  const vocab = lesson.content?.vocabulary?.items || [];
  const meta = lesson.metadata || {};

  // Transcript length (0-25 points)
  if (transcript.length >= 500) score += 25;
  else if (transcript.length >= 200) score += 15;
  else if (transcript.length >= 50) score += 5;

  // Question count (0-25 points)
  const qCount = (questions.pre?.length || 0) + (questions.while?.length || 0) + (questions.post?.length || 0);
  if (qCount >= 10) score += 25;
  else if (qCount >= 5) score += 15;
  else if (qCount >= 1) score += 5;

  // Vocabulary (0-15 points)
  if (vocab.length >= 10) score += 15;
  else if (vocab.length >= 5) score += 10;
  else if (vocab.length >= 1) score += 5;

  // Has both pre and post questions (10 points)
  if ((questions.pre?.length || 0) > 0 && (questions.post?.length || 0) > 0) score += 10;

  // Has metadata (0-15 points)
  if (meta.title?.ar) score += 5;
  if (meta.title?.en) score += 5;
  if (meta.topic?.code) score += 5;

  // ILR level set (10 points)
  if (meta.ilr?.target || meta.ilr?.detected) score += 10;

  return Math.min(100, score);
}
