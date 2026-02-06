/**
 * Rating System
 * Simple client-side rating system using localStorage
 * Allows users to rate lessons (1-5 stars) and see their ratings
 */

class RatingSystem {
  static STORAGE_KEY = 'tanaghum_ratings';

  /**
   * Get all ratings from localStorage
   */
  static getAllRatings() {
    try {
      const ratings = localStorage.getItem(this.STORAGE_KEY);
      return ratings ? JSON.parse(ratings) : {};
    } catch (error) {
      console.error('Failed to load ratings:', error);
      return {};
    }
  }

  /**
   * Save ratings to localStorage
   */
  static saveRatings(ratings) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(ratings));
      return true;
    } catch (error) {
      console.error('Failed to save ratings:', error);
      return false;
    }
  }

  /**
   * Get user's rating for a specific lesson
   */
  static getUserRating(lessonId) {
    const ratings = this.getAllRatings();
    return ratings[lessonId] || null;
  }

  /**
   * Set user's rating for a lesson
   */
  static setUserRating(lessonId, rating) {
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const ratings = this.getAllRatings();
    ratings[lessonId] = {
      rating,
      timestamp: new Date().toISOString()
    };

    return this.saveRatings(ratings);
  }

  /**
   * Remove user's rating for a lesson
   */
  static removeUserRating(lessonId) {
    const ratings = this.getAllRatings();
    delete ratings[lessonId];
    return this.saveRatings(ratings);
  }

  /**
   * Calculate average rating from multiple user ratings
   * (In a real app, this would be server-side)
   */
  static calculateAverageRating(lessonId, allUserRatings = []) {
    if (!allUserRatings.length) return 0;

    const sum = allUserRatings.reduce((acc, r) => acc + r.rating, 0);
    return Math.round((sum / allUserRatings.length) * 10) / 10;
  }

  /**
   * Render a star rating display (read-only)
   */
  static renderStars(rating, maxStars = 5) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    let html = '<div class="stars-display">';

    for (let i = 0; i < maxStars; i++) {
      if (i < fullStars) {
        html += '<span class="star filled">★</span>';
      } else if (i === fullStars && hasHalfStar) {
        html += '<span class="star half">★</span>';
      } else {
        html += '<span class="star empty">☆</span>';
      }
    }

    html += '</div>';
    return html;
  }

  /**
   * Render an interactive star rating widget
   */
  static renderRatingWidget(container, lessonId, currentAverage = 0, ratingCount = 0) {
    const userRating = this.getUserRating(lessonId);
    const hasRated = userRating !== null;

    container.innerHTML = `
      <div class="rating-widget">
        <div class="rating-average">
          <div class="rating-stars-large">
            ${this.renderStars(currentAverage)}
          </div>
          <div class="rating-info">
            <span class="rating-value">${currentAverage.toFixed(1)}</span>
            <span class="rating-count">${ratingCount} rating${ratingCount !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div class="rating-user">
          ${hasRated ? `
            <p class="rating-user-status">
              You rated this lesson: <strong>${userRating.rating} stars</strong>
            </p>
            <button class="btn btn-sm btn-secondary rating-change-btn" data-lesson-id="${lessonId}">
              Change Rating
            </button>
          ` : `
            <p class="rating-prompt">Rate this lesson:</p>
            <div class="rating-stars-interactive" data-lesson-id="${lessonId}">
              ${this.renderInteractiveStars(lessonId, 0)}
            </div>
          `}
        </div>
      </div>
    `;

    // Attach event listeners
    this.attachRatingListeners(container, lessonId);
  }

  /**
   * Render interactive stars for rating
   */
  static renderInteractiveStars(lessonId, hoveredStar = 0) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const filled = i <= hoveredStar;
      html += `
        <button
          class="star-btn ${filled ? 'filled' : ''}"
          data-rating="${i}"
          aria-label="Rate ${i} star${i !== 1 ? 's' : ''}"
        >
          ${filled ? '★' : '☆'}
        </button>
      `;
    }
    return html;
  }

  /**
   * Attach event listeners to rating widget
   */
  static attachRatingListeners(container, lessonId) {
    // Interactive stars hover effect
    const starsContainer = container.querySelector('.rating-stars-interactive');
    if (starsContainer) {
      const starButtons = starsContainer.querySelectorAll('.star-btn');

      starButtons.forEach((btn, index) => {
        // Hover effect
        btn.addEventListener('mouseenter', () => {
          starButtons.forEach((b, i) => {
            if (i <= index) {
              b.classList.add('filled');
              b.textContent = '★';
            } else {
              b.classList.remove('filled');
              b.textContent = '☆';
            }
          });
        });

        // Click to rate
        btn.addEventListener('click', () => {
          const rating = parseInt(btn.dataset.rating);
          this.handleRatingSubmit(lessonId, rating, container);
        });
      });

      // Reset on mouse leave
      starsContainer.addEventListener('mouseleave', () => {
        starButtons.forEach(b => {
          b.classList.remove('filled');
          b.textContent = '☆';
        });
      });
    }

    // Change rating button
    const changeBtn = container.querySelector('.rating-change-btn');
    if (changeBtn) {
      changeBtn.addEventListener('click', () => {
        this.showChangeRatingDialog(lessonId, container);
      });
    }
  }

  /**
   * Handle rating submission
   */
  static handleRatingSubmit(lessonId, rating, container) {
    // Save the rating
    const success = this.setUserRating(lessonId, rating);

    if (success) {
      // Show success message
      this.showToast(`You rated this lesson ${rating} star${rating !== 1 ? 's' : ''}!`, 'success');

      // Update the widget to show user's rating
      const userRating = this.getUserRating(lessonId);
      container.querySelector('.rating-user').innerHTML = `
        <p class="rating-user-status">
          You rated this lesson: <strong>${userRating.rating} stars</strong>
        </p>
        <button class="btn btn-sm btn-secondary rating-change-btn" data-lesson-id="${lessonId}">
          Change Rating
        </button>
      `;

      // Re-attach listeners
      this.attachRatingListeners(container, lessonId);

      // Dispatch event for other components to update
      window.dispatchEvent(new CustomEvent('lessonRated', {
        detail: { lessonId, rating }
      }));
    } else {
      this.showToast('Failed to save rating. Please try again.', 'error');
    }
  }

  /**
   * Show dialog to change existing rating
   */
  static showChangeRatingDialog(lessonId, container) {
    const userRating = this.getUserRating(lessonId);
    const currentRating = userRating ? userRating.rating : 0;

    container.querySelector('.rating-user').innerHTML = `
      <p class="rating-prompt">Change your rating:</p>
      <div class="rating-stars-interactive" data-lesson-id="${lessonId}">
        ${this.renderInteractiveStars(lessonId, currentRating)}
      </div>
      <button class="btn btn-sm btn-ghost rating-cancel-btn">Cancel</button>
    `;

    // Re-attach listeners
    this.attachRatingListeners(container, lessonId);

    // Cancel button
    const cancelBtn = container.querySelector('.rating-cancel-btn');
    cancelBtn.addEventListener('click', () => {
      // Restore original display
      container.querySelector('.rating-user').innerHTML = `
        <p class="rating-user-status">
          You rated this lesson: <strong>${userRating.rating} stars</strong>
        </p>
        <button class="btn btn-sm btn-secondary rating-change-btn" data-lesson-id="${lessonId}">
          Change Rating
        </button>
      `;
      this.attachRatingListeners(container, lessonId);
    });
  }

  /**
   * Get rating statistics
   */
  static getRatingStats() {
    const ratings = this.getAllRatings();
    const ratingIds = Object.keys(ratings);

    if (ratingIds.length === 0) {
      return {
        totalRatings: 0,
        averageRating: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      };
    }

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;

    ratingIds.forEach(id => {
      const rating = ratings[id].rating;
      distribution[rating]++;
      sum += rating;
    });

    return {
      totalRatings: ratingIds.length,
      averageRating: sum / ratingIds.length,
      distribution
    };
  }

  /**
   * Get user's rating history
   */
  static getRatingHistory() {
    const ratings = this.getAllRatings();
    return Object.entries(ratings)
      .map(([lessonId, data]) => ({
        lessonId,
        rating: data.rating,
        timestamp: data.timestamp,
        date: new Date(data.timestamp)
      }))
      .sort((a, b) => b.date - a.date);
  }

  /**
   * Export ratings as JSON
   */
  static exportRatings() {
    const ratings = this.getAllRatings();
    const jsonStr = JSON.stringify(ratings, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `tanaghum-ratings-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import ratings from JSON
   */
  static importRatings(jsonData) {
    try {
      const ratings = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

      // Merge with existing ratings
      const existing = this.getAllRatings();
      const merged = { ...existing, ...ratings };

      return this.saveRatings(merged);
    } catch (error) {
      console.error('Failed to import ratings:', error);
      return false;
    }
  }

  /**
   * Clear all ratings
   */
  static clearAllRatings() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Failed to clear ratings:', error);
      return false;
    }
  }

  /**
   * Show toast notification
   */
  static showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');

    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${message}</span>
    `;

    container.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      toast.style.animation = 'toast-out 0.3s ease';
      setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) {
          container.remove();
        }
      }, 300);
    }, 3000);
  }
}

// CSS for rating widget (inject into page if not already present)
if (typeof window !== 'undefined') {
  window.RatingSystem = RatingSystem;

  // Add CSS for rating widget
  const style = document.createElement('style');
  style.textContent = `
    .rating-widget {
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
      padding: var(--space-6);
      background: var(--color-bg-alt);
      border-radius: var(--radius-lg);
    }

    .rating-average {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding-bottom: var(--space-4);
      border-bottom: 1px solid var(--color-border);
    }

    .rating-stars-large .stars-display {
      display: flex;
      gap: 4px;
      font-size: var(--text-2xl);
      color: var(--color-accent);
    }

    .rating-info {
      display: flex;
      flex-direction: column;
    }

    .rating-value {
      font-size: var(--text-2xl);
      font-weight: 700;
      color: var(--color-text);
    }

    .rating-count {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .rating-user {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      align-items: flex-start;
    }

    .rating-prompt {
      font-size: var(--text-base);
      font-weight: 500;
      color: var(--color-text);
      margin: 0;
    }

    .rating-user-status {
      font-size: var(--text-base);
      color: var(--color-text-secondary);
      margin: 0;
    }

    .rating-stars-interactive {
      display: flex;
      gap: var(--space-2);
    }

    .star-btn {
      background: none;
      border: none;
      font-size: var(--text-3xl);
      color: var(--color-text-muted);
      cursor: pointer;
      transition: all var(--transition-fast);
      padding: var(--space-1);
    }

    .star-btn:hover,
    .star-btn.filled {
      color: var(--color-accent);
      transform: scale(1.1);
    }

    .star-btn:active {
      transform: scale(0.95);
    }

    @keyframes toast-out {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(-20px);
      }
    }
  `;

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('rating-system-styles')) {
      style.id = 'rating-system-styles';
      document.head.appendChild(style);
    }
  });
}
