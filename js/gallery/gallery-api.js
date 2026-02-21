/**
 * Gallery API Client
 * Communicates with the Cloudflare Worker gallery endpoints
 */

const GalleryAPI = {
  _baseUrl: null,
  _galleryPath: null,

  _getBaseUrl() {
    if (!this._baseUrl) {
      if (typeof Config !== 'undefined') {
        this._baseUrl = Config.WORKER_URL;
        this._galleryPath = Config.API.GALLERY_LESSONS;
      } else {
        this._baseUrl = 'https://tanaghum-worker.jmathdog.workers.dev';
        this._galleryPath = '/api/gallery/lessons';
      }
    }
    return this._baseUrl;
  },

  _getUrl(path) {
    return `${this._getBaseUrl()}${this._galleryPath}${path || ''}`;
  },

  _getAuthToken() {
    try {
      const auth = JSON.parse(localStorage.getItem('tanaghum_auth') || '{}');
      return auth.token || null;
    } catch {
      return null;
    }
  },

  _headers(auth = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = this._getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  },

  /**
   * List lessons with pagination and filtering
   */
  async listLessons({ page = 1, limit = 20, ilr, topic, search, sort, duration } = {}) {
    const params = new URLSearchParams();
    params.set('page', page);
    params.set('limit', limit);
    if (ilr) params.set('ilr', ilr);
    if (topic) params.set('topic', topic);
    if (search) params.set('search', search);
    if (sort) params.set('sort', sort);
    if (duration) params.set('duration', duration);

    const response = await fetch(`${this._getUrl()}?${params}`, {
      headers: this._headers()
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to load lessons');
    }

    return response.json();
  },

  /**
   * Get a single lesson with full lesson data
   */
  async getLesson(lessonId) {
    const response = await fetch(this._getUrl(`/${lessonId}`), {
      headers: this._headers()
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Lesson not found');
    }

    return response.json();
  },

  /**
   * Publish a lesson to the gallery
   */
  async publishLesson(lesson) {
    // Strip audio blobs before sending
    const cleanLesson = this._stripAudioBlobs(lesson);

    const response = await fetch(this._getUrl(), {
      method: 'POST',
      headers: this._headers(true),
      body: JSON.stringify({ lesson: cleanLesson })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to publish lesson');
    }

    return response.json();
  },

  /**
   * Delete a lesson (soft delete, owner only)
   */
  async deleteLesson(lessonId) {
    const response = await fetch(this._getUrl(`/${lessonId}`), {
      method: 'DELETE',
      headers: this._headers(true)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete lesson');
    }

    return response.json();
  },

  /**
   * Rate a lesson (1-5)
   */
  async rateLesson(lessonId, rating) {
    const response = await fetch(this._getUrl(`/${lessonId}/rate`), {
      method: 'POST',
      headers: this._headers(true),
      body: JSON.stringify({ rating })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to rate lesson');
    }

    return response.json();
  },

  /**
   * Record a lesson use (fire-and-forget)
   */
  recordUse(lessonId) {
    fetch(this._getUrl(`/${lessonId}/use`), {
      method: 'POST',
      headers: this._headers()
    }).catch(() => {});
  },

  /**
   * Strip audio blob data to keep payload small
   */
  _stripAudioBlobs(lesson) {
    const clean = JSON.parse(JSON.stringify(lesson));

    // Remove audio blob/url data that's too large
    if (clean.audio) {
      delete clean.audio.blob;
      delete clean.audio.arrayBuffer;
      // Keep audio.url only if it's a YouTube URL, not a blob URL
      if (clean.audio.url && clean.audio.url.startsWith('blob:')) {
        delete clean.audio.url;
      }
    }

    // Remove any base64 audio in segments
    if (clean.content?.transcript?.segments) {
      clean.content.transcript.segments.forEach(seg => {
        delete seg.audio;
        delete seg.blob;
      });
    }

    return clean;
  }
};

// Expose globally for non-module scripts
window.GalleryAPI = GalleryAPI;
