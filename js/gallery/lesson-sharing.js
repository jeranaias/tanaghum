/**
 * Lesson Sharing System
 * Handles generating shareable URLs, saving lessons to IndexedDB,
 * and loading shared lessons from URL hash
 */

class LessonSharing {
  static DB_NAME = 'TanaghumLessons';
  static DB_VERSION = 1;
  static STORE_NAME = 'lessons';
  static db = null;

  /**
   * Initialize IndexedDB
   */
  static async initDB() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('author', 'author', { unique: false });
        }
      };
    });
  }

  /**
   * Generate a unique lesson ID based on content hash
   */
  static generateLessonId(lesson) {
    // Create a hash from lesson title and timestamp
    const content = `${lesson.title}_${lesson.titleEn}_${Date.now()}`;
    return this.hashCode(content).toString(36);
  }

  /**
   * Simple hash function
   */
  static hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Save a lesson to IndexedDB
   */
  static async saveLesson(lesson) {
    try {
      await this.initDB();

      // Generate ID if not present
      if (!lesson.id) {
        lesson.id = this.generateLessonId(lesson);
      }

      // Add metadata
      lesson.createdAt = lesson.createdAt || new Date().toISOString();
      lesson.savedAt = new Date().toISOString();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.put(lesson);

        request.onsuccess = () => resolve(lesson.id);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to save lesson:', error);
      throw error;
    }
  }

  /**
   * Load a lesson from IndexedDB by ID
   */
  static async loadLesson(lessonId) {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.get(lessonId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to load lesson:', error);
      return null;
    }
  }

  /**
   * Get all locally stored lessons
   */
  static async getAllLocalLessons() {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to get lessons:', error);
      return [];
    }
  }

  /**
   * Delete a lesson from IndexedDB
   */
  static async deleteLesson(lessonId) {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.delete(lessonId);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to delete lesson:', error);
      throw error;
    }
  }

  /**
   * Generate a shareable URL for a lesson
   */
  static generateShareUrl(lesson) {
    const baseUrl = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${baseUrl}player.html#${lesson.id}`;
  }

  /**
   * Get lesson ID from current URL hash
   */
  static getLessonIdFromUrl() {
    const hash = window.location.hash;
    if (hash && hash.length > 1) {
      return hash.substring(1); // Remove the '#' character
    }
    return null;
  }

  /**
   * Copy shareable link to clipboard
   */
  static async copyShareLink(lesson) {
    const url = this.generateShareUrl(lesson);

    try {
      await navigator.clipboard.writeText(url);
      return { success: true, url };
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return { success: false, error };
    }
  }

  /**
   * Create a shareable lesson package (for export)
   */
  static createLessonPackage(lesson) {
    return {
      id: lesson.id,
      title: lesson.title,
      titleEn: lesson.titleEn,
      ilrLevel: lesson.ilrLevel,
      topic: lesson.topic,
      duration: lesson.duration,
      author: lesson.author || 'Anonymous',
      rating: lesson.rating || 0,
      ratingCount: lesson.ratingCount || 0,
      uses: lesson.uses || 0,
      thumbnail: lesson.thumbnail,
      description: lesson.description,
      transcript: lesson.transcript,
      audioUrl: lesson.audioUrl,
      videoUrl: lesson.videoUrl,
      questions: lesson.questions,
      vocabulary: lesson.vocabulary,
      createdAt: lesson.createdAt || new Date().toISOString(),
      version: '1.0'
    };
  }

  /**
   * Export lesson as JSON file
   */
  static exportLessonAsJson(lesson) {
    const lessonPackage = this.createLessonPackage(lesson);
    const jsonStr = JSON.stringify(lessonPackage, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `tanaghum-lesson-${lesson.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import lesson from JSON file
   */
  static async importLessonFromJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const lesson = JSON.parse(e.target.result);

          // Validate lesson structure
          if (!lesson.title || !lesson.titleEn || !lesson.id) {
            reject(new Error('Invalid lesson format'));
            return;
          }

          // Save to IndexedDB
          await this.saveLesson(lesson);
          resolve(lesson);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  /**
   * Add lesson to gallery (save locally and update gallery view)
   */
  static async addToGallery(lesson) {
    try {
      // Ensure lesson has required fields
      const lessonPackage = this.createLessonPackage(lesson);

      // Generate ID if needed
      if (!lessonPackage.id) {
        lessonPackage.id = this.generateLessonId(lessonPackage);
      }

      // Save to IndexedDB
      const lessonId = await this.saveLesson(lessonPackage);

      // Store reference in localStorage for quick access
      this.updateGalleryIndex(lessonPackage);

      return {
        success: true,
        lessonId,
        shareUrl: this.generateShareUrl(lessonPackage)
      };
    } catch (error) {
      console.error('Failed to add lesson to gallery:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update gallery index in localStorage
   */
  static updateGalleryIndex(lesson) {
    try {
      const index = JSON.parse(localStorage.getItem('tanaghum_gallery_index') || '[]');

      // Check if lesson already exists
      const existingIndex = index.findIndex(l => l.id === lesson.id);

      const lessonSummary = {
        id: lesson.id,
        title: lesson.title,
        titleEn: lesson.titleEn,
        ilrLevel: lesson.ilrLevel,
        topic: lesson.topic,
        author: lesson.author,
        createdAt: lesson.createdAt,
        addedAt: new Date().toISOString()
      };

      if (existingIndex >= 0) {
        index[existingIndex] = lessonSummary;
      } else {
        index.unshift(lessonSummary);
      }

      // Keep only last 100 lessons in index
      if (index.length > 100) {
        index.splice(100);
      }

      localStorage.setItem('tanaghum_gallery_index', JSON.stringify(index));
    } catch (error) {
      console.error('Failed to update gallery index:', error);
    }
  }

  /**
   * Remove lesson from gallery
   */
  static async removeFromGallery(lessonId) {
    try {
      // Remove from IndexedDB
      await this.deleteLesson(lessonId);

      // Remove from index
      const index = JSON.parse(localStorage.getItem('tanaghum_gallery_index') || '[]');
      const filteredIndex = index.filter(l => l.id !== lessonId);
      localStorage.setItem('tanaghum_gallery_index', JSON.stringify(filteredIndex));

      return { success: true };
    } catch (error) {
      console.error('Failed to remove lesson from gallery:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user's lessons (created by them)
   */
  static async getMyLessons(authorName) {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
        const store = transaction.objectStore(this.STORE_NAME);
        const index = store.index('author');
        const request = index.getAll(authorName);

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to get user lessons:', error);
      return [];
    }
  }

  /**
   * Search lessons in IndexedDB
   */
  static async searchLessons(query) {
    const allLessons = await this.getAllLocalLessons();
    const lowerQuery = query.toLowerCase();

    return allLessons.filter(lesson =>
      lesson.title.toLowerCase().includes(lowerQuery) ||
      lesson.titleEn.toLowerCase().includes(lowerQuery) ||
      lesson.topic.toLowerCase().includes(lowerQuery) ||
      (lesson.description && lesson.description.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get storage usage statistics
   */
  static async getStorageStats() {
    try {
      const lessons = await this.getAllLocalLessons();
      const totalSize = new Blob([JSON.stringify(lessons)]).size;

      return {
        lessonCount: lessons.length,
        totalSize,
        formattedSize: this.formatBytes(totalSize),
        lessons: lessons.map(l => ({
          id: l.id,
          title: l.titleEn,
          size: new Blob([JSON.stringify(l)]).size,
          createdAt: l.createdAt
        }))
      };
    } catch (error) {
      console.error('Failed to get storage stats:', error);
      return { lessonCount: 0, totalSize: 0, formattedSize: '0 B' };
    }
  }

  /**
   * Format bytes to human-readable string
   */
  static formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Clear all locally stored lessons (with confirmation)
   */
  static async clearAllLessons() {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
          // Clear index
          localStorage.removeItem('tanaghum_gallery_index');
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to clear lessons:', error);
      throw error;
    }
  }
}

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
  window.LessonSharing = LessonSharing;

  // Initialize DB on page load
  document.addEventListener('DOMContentLoaded', () => {
    LessonSharing.initDB().catch(console.error);
  });
}

// ES Module export for dynamic imports
export { LessonSharing, LessonSharing as lessonSharing };
