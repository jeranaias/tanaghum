/**
 * Gallery Manager
 * Handles loading, filtering, sorting, and rendering of community lessons
 * Loads from API first, falls back to static gallery.json + IndexedDB
 */

class GalleryManager {
  constructor() {
    this.lessons = [];
    this.filteredLessons = [];
    this.dataSource = 'static'; // 'api' or 'static'
    this.currentPage = 1;
    this.pageSize = 20;
    this.totalLessons = 0;
    this.totalPages = 1;
    this.searchDebounceTimer = null;
    this.currentFilters = {
      search: '',
      ilr: 'all',
      topic: 'all',
      duration: 'all',
      sort: 'newest'
    };

    this.init();
  }

  async init() {
    this.bindElements();
    this.attachEventListeners();
    await this.loadLessons();
  }

  bindElements() {
    // Search
    this.searchInput = document.getElementById('gallery-search');
    this.clearSearchBtn = document.getElementById('clear-search');

    // Filters
    this.ilrFilters = document.getElementById('ilr-filters');
    this.topicFilters = document.getElementById('topic-filters');
    this.durationFilter = document.getElementById('duration-filter');
    this.sortFilter = document.getElementById('sort-filter');

    // Active filters
    this.activeFiltersContainer = document.getElementById('active-filters');
    this.activeFiltersList = document.getElementById('active-filters-list');
    this.clearAllFiltersBtn = document.getElementById('clear-all-filters');
    this.resetFiltersBtn = document.getElementById('reset-filters');

    // Results
    this.resultsCount = document.getElementById('results-count');
    this.loadingSkeleton = document.getElementById('loading-skeleton');
    this.galleryGrid = document.getElementById('gallery-grid');
    this.emptyState = document.getElementById('empty-state');

    // Pagination
    this.paginationContainer = document.getElementById('pagination-container');
    this.paginationPrev = document.getElementById('pagination-prev');
    this.paginationNext = document.getElementById('pagination-next');
    this.paginationCurrent = document.getElementById('pagination-current');
    this.paginationTotal = document.getElementById('pagination-total');

    // Preview modal
    this.previewBackdrop = document.getElementById('preview-backdrop');
    this.previewModal = document.getElementById('preview-modal');
    this.closePreviewBtn = document.getElementById('close-preview');
    this.closePreviewBtn2 = document.getElementById('close-preview-btn');
    this.useLessonBtn = document.getElementById('use-lesson-btn');
    this.previewBody = document.getElementById('preview-body');
    this.previewTitle = document.getElementById('preview-title');
  }

  attachEventListeners() {
    // Search with debounce
    this.searchInput.addEventListener('input', (e) => {
      this.currentFilters.search = e.target.value.trim();
      this.clearSearchBtn.classList.toggle('hidden', !this.currentFilters.search);

      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        this.currentPage = 1;
        this.loadLessons();
      }, 300);
    });

    this.clearSearchBtn.addEventListener('click', () => {
      this.searchInput.value = '';
      this.currentFilters.search = '';
      this.clearSearchBtn.classList.add('hidden');
      this.currentPage = 1;
      this.loadLessons();
    });

    // ILR filters
    this.ilrFilters.addEventListener('click', (e) => {
      if (e.target.classList.contains('filter-pill')) {
        this.ilrFilters.querySelectorAll('.filter-pill').forEach(btn =>
          btn.classList.remove('active')
        );
        e.target.classList.add('active');
        this.currentFilters.ilr = e.target.dataset.ilr;
        this.currentPage = 1;
        this.loadLessons();
      }
    });

    // Topic filters
    this.topicFilters.addEventListener('click', (e) => {
      if (e.target.classList.contains('filter-pill')) {
        this.topicFilters.querySelectorAll('.filter-pill').forEach(btn =>
          btn.classList.remove('active')
        );
        e.target.classList.add('active');
        this.currentFilters.topic = e.target.dataset.topic;
        this.currentPage = 1;
        this.loadLessons();
      }
    });

    // Duration filter
    this.durationFilter.addEventListener('change', (e) => {
      this.currentFilters.duration = e.target.value;
      this.currentPage = 1;
      this.loadLessons();
    });

    // Sort filter
    this.sortFilter.addEventListener('change', (e) => {
      this.currentFilters.sort = e.target.value;
      this.currentPage = 1;
      this.loadLessons();
    });

    // Clear all filters
    this.clearAllFiltersBtn.addEventListener('click', () => this.resetFilters());
    this.resetFiltersBtn.addEventListener('click', () => this.resetFilters());

    // Pagination
    if (this.paginationPrev) {
      this.paginationPrev.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.loadLessons();
        }
      });
    }
    if (this.paginationNext) {
      this.paginationNext.addEventListener('click', () => {
        if (this.currentPage < this.totalPages) {
          this.currentPage++;
          this.loadLessons();
        }
      });
    }

    // Preview modal
    this.closePreviewBtn.addEventListener('click', () => this.closePreview());
    this.closePreviewBtn2.addEventListener('click', () => this.closePreview());
    this.previewBackdrop.addEventListener('click', () => this.closePreview());

    // ESC key to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.previewModal.classList.contains('active')) {
        this.closePreview();
      }
    });
  }

  async loadLessons() {
    // Show loading state
    this.loadingSkeleton.classList.remove('hidden');
    this.galleryGrid.classList.add('hidden');
    this.emptyState.classList.add('hidden');

    // Try API first
    if (window.GalleryAPI) {
      try {
        const params = {
          page: this.currentPage,
          limit: this.pageSize,
          sort: this.currentFilters.sort
        };
        if (this.currentFilters.ilr !== 'all') params.ilr = this.currentFilters.ilr;
        if (this.currentFilters.topic !== 'all') params.topic = this.currentFilters.topic;
        if (this.currentFilters.search) params.search = this.currentFilters.search;
        if (this.currentFilters.duration !== 'all') params.duration = this.currentFilters.duration;

        const data = await GalleryAPI.listLessons(params);
        this.dataSource = 'api';
        this.lessons = (data.lessons || []).map(l => this.normalizeApiLesson(l));
        this.totalLessons = data.pagination?.total || this.lessons.length;
        this.totalPages = data.pagination?.totalPages || 1;
        this.filteredLessons = this.lessons;
        this.updateActiveFilters();
        this.renderLessons();
        this.updatePagination();
        return;
      } catch (err) {
        console.warn('Gallery API unavailable, falling back to static data:', err.message);
      }
    }

    // Fallback: static gallery.json + local IndexedDB lessons
    try {
      const response = await fetch('gallery.json');
      if (!response.ok) throw new Error('Failed to load lessons');

      const data = await response.json();
      this.lessons = data.lessons || [];

      // Merge with locally stored lessons
      if (typeof LessonSharing !== 'undefined') {
        const localLessons = await LessonSharing.getAllLocalLessons();
        if (Array.isArray(localLessons)) {
          this.lessons = [...this.lessons, ...localLessons];
        }
      }

      this.dataSource = 'static';
      this.applyFilters();
      this.renderLessons();
      this.hidePagination();
    } catch (error) {
      console.error('Error loading lessons:', error);
      this.lessons = [];
      this.filteredLessons = [];
      this.renderLessons();
      this.showToast('Failed to load lessons', 'error');
    }
  }

  /**
   * Normalize API lesson fields to the card format expected by createLessonCard
   */
  normalizeApiLesson(apiLesson) {
    return {
      id: apiLesson.id,
      title: apiLesson.title_ar || apiLesson.title_en || '',
      titleEn: apiLesson.title_en || apiLesson.title_ar || '',
      description: apiLesson.description || '',
      ilrLevel: apiLesson.ilr_level || '2',
      topic: apiLesson.topic_code || 'general',
      duration: apiLesson.duration || 0,
      author: apiLesson.author_name || 'Anonymous',
      authorPicture: apiLesson.author_picture || '',
      rating: apiLesson.rating_avg || 0,
      ratingCount: apiLesson.rating_count || 0,
      uses: apiLesson.use_count || 0,
      questionCount: apiLesson.question_count || 0,
      vocabularyCount: apiLesson.vocabulary_count || 0,
      transcript: apiLesson.transcript_preview || '',
      createdAt: apiLesson.created_at,
      videoId: apiLesson.video_id || '',
      sourceType: apiLesson.source_type || '',
      wordCount: apiLesson.word_count || 0,
      thumbnail: null, // API lessons use placeholder
      _fromApi: true
    };
  }

  applyFilters() {
    // Only used for static data source (API does server-side filtering)
    this.filteredLessons = this.lessons.filter(lesson => {
      if (this.currentFilters.search) {
        const search = this.currentFilters.search.toLowerCase();
        const matchesSearch =
          (lesson.title || '').toLowerCase().includes(search) ||
          (lesson.titleEn || '').toLowerCase().includes(search) ||
          (lesson.topic || '').toLowerCase().includes(search) ||
          (lesson.description || '').toLowerCase().includes(search);

        if (!matchesSearch) return false;
      }

      if (this.currentFilters.ilr !== 'all') {
        const targetIlr = parseFloat(this.currentFilters.ilr);
        const lessonIlr = parseFloat(lesson.ilrLevel);
        if (lessonIlr !== targetIlr) return false;
      }

      if (this.currentFilters.topic !== 'all') {
        if (lesson.topic !== this.currentFilters.topic) return false;
      }

      if (this.currentFilters.duration !== 'all') {
        const duration = lesson.duration;
        if (this.currentFilters.duration === 'short' && duration >= 300) return false;
        if (this.currentFilters.duration === 'medium' && (duration < 300 || duration > 900)) return false;
        if (this.currentFilters.duration === 'long' && duration <= 900) return false;
      }

      return true;
    });

    this.sortLessons();
    this.updateActiveFilters();
  }

  sortLessons() {
    const sort = this.currentFilters.sort;

    this.filteredLessons.sort((a, b) => {
      switch (sort) {
        case 'popular':
          return (b.uses || 0) - (a.uses || 0);
        case 'newest':
          return new Date(b.createdAt) - new Date(a.createdAt);
        case 'rating':
          return (b.rating || 0) - (a.rating || 0);
        case 'title':
          return (a.titleEn || '').localeCompare(b.titleEn || '');
        default:
          return 0;
      }
    });
  }

  updateActiveFilters() {
    const hasFilters =
      this.currentFilters.search ||
      this.currentFilters.ilr !== 'all' ||
      this.currentFilters.topic !== 'all' ||
      this.currentFilters.duration !== 'all';

    this.activeFiltersContainer.classList.toggle('hidden', !hasFilters);

    if (hasFilters) {
      this.activeFiltersList.innerHTML = '';

      if (this.currentFilters.search) {
        this.activeFiltersList.appendChild(
          this.createFilterTag('Search', this.currentFilters.search, () => {
            this.searchInput.value = '';
            this.currentFilters.search = '';
            this.clearSearchBtn.classList.add('hidden');
          })
        );
      }

      if (this.currentFilters.ilr !== 'all') {
        this.activeFiltersList.appendChild(
          this.createFilterTag('ILR', this.currentFilters.ilr, () => {
            this.ilrFilters.querySelector('[data-ilr="all"]').click();
          })
        );
      }

      if (this.currentFilters.topic !== 'all') {
        this.activeFiltersList.appendChild(
          this.createFilterTag('Topic', this.currentFilters.topic, () => {
            this.topicFilters.querySelector('[data-topic="all"]').click();
          })
        );
      }

      if (this.currentFilters.duration !== 'all') {
        this.activeFiltersList.appendChild(
          this.createFilterTag('Duration', this.currentFilters.duration, () => {
            this.durationFilter.value = 'all';
            this.currentFilters.duration = 'all';
          })
        );
      }
    }
  }

  createFilterTag(label, value, onRemove) {
    const tag = document.createElement('div');
    tag.className = 'active-filter-tag';
    tag.innerHTML = `
      <span>${label}: ${value}</span>
      <button aria-label="Remove filter">\u00d7</button>
    `;

    tag.querySelector('button').addEventListener('click', () => {
      onRemove();
      this.currentPage = 1;
      this.loadLessons();
    });

    return tag;
  }

  resetFilters() {
    this.searchInput.value = '';
    this.currentFilters = {
      search: '',
      ilr: 'all',
      topic: 'all',
      duration: 'all',
      sort: 'newest'
    };

    this.ilrFilters.querySelector('[data-ilr="all"]').click();
    this.topicFilters.querySelector('[data-topic="all"]').click();
    this.durationFilter.value = 'all';
    this.sortFilter.value = 'newest';
    this.clearSearchBtn.classList.add('hidden');
    this.currentPage = 1;

    this.loadLessons();
  }

  renderLessons() {
    // Hide loading skeleton
    this.loadingSkeleton.classList.add('hidden');

    // Update results count
    const count = this.dataSource === 'api' ? this.totalLessons : this.filteredLessons.length;
    this.resultsCount.textContent = `${count} lesson${count !== 1 ? 's' : ''} found`;

    const displayLessons = this.dataSource === 'api' ? this.lessons : this.filteredLessons;

    // Show empty state if no results
    if (displayLessons.length === 0) {
      this.galleryGrid.classList.add('hidden');
      this.emptyState.classList.remove('hidden');
      this.hidePagination();
      return;
    }

    // Show gallery grid
    this.emptyState.classList.add('hidden');
    this.galleryGrid.classList.remove('hidden');

    // Render lesson cards
    this.galleryGrid.innerHTML = displayLessons
      .map(lesson => this.createLessonCard(lesson))
      .join('');

    // Attach card event listeners
    this.attachCardListeners();
  }

  updatePagination() {
    if (!this.paginationContainer) return;

    if (this.totalPages <= 1) {
      this.hidePagination();
      return;
    }

    this.paginationContainer.classList.remove('hidden');
    if (this.paginationCurrent) this.paginationCurrent.textContent = this.currentPage;
    if (this.paginationTotal) this.paginationTotal.textContent = this.totalPages;
    if (this.paginationPrev) this.paginationPrev.disabled = this.currentPage <= 1;
    if (this.paginationNext) this.paginationNext.disabled = this.currentPage >= this.totalPages;
  }

  hidePagination() {
    if (this.paginationContainer) {
      this.paginationContainer.classList.add('hidden');
    }
  }

  createLessonCard(lesson) {
    const ilrClass = this.getIlrClass(lesson.ilrLevel);
    const duration = this.formatDuration(lesson.duration);
    const rating = this.renderStars(lesson.rating || 0);

    return `
      <div class="lesson-card" data-lesson-id="${lesson.id}">
        <div class="card-thumbnail">
          ${lesson.thumbnail ?
            `<img src="${lesson.thumbnail}" alt="${lesson.titleEn}">` :
            `<div class="card-thumbnail-placeholder">${this.getTopicIcon(lesson.topic)}</div>`
          }
          <div class="card-duration">${duration}</div>
        </div>

        <div class="card-body">
          <div class="card-header">
            <h3 class="card-title">
              <span class="card-title-ar">${lesson.title}</span>
              <span class="card-title-en">${lesson.titleEn}</span>
            </h3>
            <span class="card-ilr-badge ${ilrClass}">ILR ${lesson.ilrLevel}</span>
          </div>

          <div class="card-meta">
            <span class="card-topic">${this.getTopicIcon(lesson.topic)} ${lesson.topic}</span>
            <div class="card-meta-item">
              <span>${lesson.author || 'Anonymous'}</span>
            </div>
          </div>

          <div class="card-meta">
            <div class="card-rating">
              ${rating}
              <span class="rating-count">(${lesson.ratingCount || 0})</span>
            </div>
            <div class="card-meta-item">
              <span>${lesson.uses || 0} uses</span>
            </div>
          </div>
        </div>

        <div class="card-footer">
          <button class="card-btn card-btn-preview" data-action="preview" data-lesson-id="${lesson.id}">
            Preview
          </button>
          <button class="card-btn card-btn-use" data-action="use" data-lesson-id="${lesson.id}">
            Use Lesson
          </button>
        </div>
      </div>
    `;
  }

  attachCardListeners() {
    this.galleryGrid.querySelectorAll('[data-action="preview"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lessonId = btn.dataset.lessonId;
        this.openPreview(lessonId);
      });
    });

    this.galleryGrid.querySelectorAll('[data-action="use"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lessonId = btn.dataset.lessonId;
        this.useLesson(lessonId);
      });
    });

    // Card click opens preview
    this.galleryGrid.querySelectorAll('.lesson-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          const lessonId = card.dataset.lessonId;
          this.openPreview(lessonId);
        }
      });
    });
  }

  openPreview(lessonId) {
    const lesson = this.lessons.find(l => l.id === lessonId);
    if (!lesson) return;

    this.currentPreviewLesson = lesson;

    // Update modal title
    this.previewTitle.textContent = lesson.titleEn;

    // Render preview content
    this.previewBody.innerHTML = `
      <div class="preview-content">
        <div class="preview-header">
          <h2 class="preview-title-ar">${lesson.title}</h2>
          <p class="preview-title-en">${lesson.titleEn}</p>
          <div class="preview-meta">
            <div class="preview-meta-item">
              <span class="card-ilr-badge ${this.getIlrClass(lesson.ilrLevel)}">ILR ${lesson.ilrLevel}</span>
            </div>
            <div class="preview-meta-item">
              <span class="card-topic">${this.getTopicIcon(lesson.topic)} ${lesson.topic}</span>
            </div>
            <div class="preview-meta-item">
              <span>${this.formatDuration(lesson.duration)}</span>
            </div>
            <div class="preview-meta-item">
              <span>${lesson.author || 'Anonymous'}</span>
            </div>
          </div>
        </div>

        ${lesson.description ? `
          <div class="preview-section">
            <h3>About This Lesson</h3>
            <p class="preview-description">${lesson.description}</p>
          </div>
        ` : ''}

        ${lesson.transcript ? `
          <div class="preview-section">
            <h3>Transcript Preview</h3>
            <div class="preview-transcript">${lesson.transcript.substring(0, 300)}${lesson.transcript.length > 300 ? '...' : ''}</div>
          </div>
        ` : ''}

        <div class="preview-stats">
          <div class="preview-stat">
            <span class="preview-stat-value">${lesson.rating || 0}</span>
            <span class="preview-stat-label">Rating</span>
          </div>
          <div class="preview-stat">
            <span class="preview-stat-value">${lesson.uses || 0}</span>
            <span class="preview-stat-label">Times Used</span>
          </div>
          <div class="preview-stat">
            <span class="preview-stat-value">${lesson.questionCount || 0}</span>
            <span class="preview-stat-label">Questions</span>
          </div>
        </div>
      </div>
    `;

    // Setup use lesson button
    this.useLessonBtn.onclick = () => this.useLesson(lessonId);

    // Show modal
    this.previewBackdrop.classList.add('active');
    this.previewModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  closePreview() {
    this.previewBackdrop.classList.remove('active');
    this.previewModal.classList.remove('active');
    document.body.style.overflow = '';
    this.currentPreviewLesson = null;
  }

  async useLesson(lessonId) {
    const lesson = this.lessons.find(l => l.id === lessonId);
    if (!lesson) return;

    // Record use via API
    if (window.GalleryAPI && lesson._fromApi) {
      GalleryAPI.recordUse(lessonId);
    }

    // If lesson is from API, fetch full lesson data and open in player
    if (lesson._fromApi && window.GalleryAPI) {
      try {
        this.showToast('Loading lesson...', 'info');
        const fullLesson = await GalleryAPI.getLesson(lessonId);
        if (fullLesson.lesson) {
          // Store lesson in localStorage for the player to pick up
          localStorage.setItem('tanaghum_play_lesson', JSON.stringify(fullLesson.lesson));
          window.open(`player.html#gallery-${lessonId}`, '_blank');
          this.closePreview();
          return;
        }
      } catch (err) {
        console.error('Failed to load full lesson:', err);
        this.showToast('Failed to load lesson', 'error');
        return;
      }
    }

    // Static/local lesson fallback
    lesson.uses = (lesson.uses || 0) + 1;
    this.saveUsageAnalytics(lessonId);

    if (typeof LessonSharing !== 'undefined') {
      const shareUrl = LessonSharing.generateShareUrl(lesson);
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }

    this.showToast('Opening lesson in player...', 'info');
    window.open(`player.html#${lessonId}`, '_blank');
    this.closePreview();
  }

  saveUsageAnalytics(lessonId) {
    try {
      const analytics = JSON.parse(localStorage.getItem('tanaghum_analytics') || '{}');
      analytics[lessonId] = {
        lastUsed: new Date().toISOString(),
        useCount: (analytics[lessonId]?.useCount || 0) + 1
      };
      localStorage.setItem('tanaghum_analytics', JSON.stringify(analytics));
    } catch (error) {
      console.error('Failed to save analytics:', error);
    }
  }

  // Helper methods
  getIlrClass(level) {
    const ilr = parseFloat(level);
    if (ilr === 1) return 'ilr-1';
    if (ilr === 1.5) return 'ilr-1-plus';
    if (ilr === 2) return 'ilr-2';
    if (ilr === 2.5) return 'ilr-2-plus';
    if (ilr === 3) return 'ilr-3';
    return 'ilr-2';
  }

  formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  renderStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    let stars = '';

    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars += '<span class="star filled"></span>';
      } else if (i === fullStars && hasHalfStar) {
        stars += '<span class="star filled"></span>';
      } else {
        stars += '<span class="star empty"></span>';
      }
    }

    return `<div class="stars">${stars}</div>`;
  }

  getTopicIcon(topic) {
    const icons = {
      economy: '\ud83d\udcb0',
      politics: '\ud83c\udfdb\ufe0f',
      culture: '\ud83c\udfad',
      science: '\ud83d\udd2c',
      education: '\ud83d\udcda',
      sports: '\u26bd',
      news: '\ud83d\udcf0',
      technology: '\ud83d\udcbb',
      health: '\ud83c\udfe5',
      environment: '\ud83c\udf0d'
    };
    return icons[topic] || '\ud83d\udcc4';
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toast-out 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Initialize gallery when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.galleryManager = new GalleryManager();
});
