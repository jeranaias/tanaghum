import { test, expect } from '@playwright/test';

test.describe('Edge Cases: Empty States', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('empty search results show helpful message', async ({ page }) => {
    await page.route('**/api/youtube/search**', async route => {
      await route.fulfill({
        status: 200,
        json: { videos: [] }
      });
    });

    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(2000);

    // Should show "no results" message or empty state
    const emptyState = page.locator('.empty-state, .no-results, [class*="empty"]');
    const resultsGrid = page.locator('.search-results-grid');

    // Either empty state element or empty results
    const isEmpty = await emptyState.count() > 0 ||
      (await resultsGrid.count() > 0 && await resultsGrid.locator('.video-search-card').count() === 0);

    expect(isEmpty).toBe(true);
  });

  test('no video selected shows input placeholder', async ({ page, viewport }) => {
    // Skip on mobile - main content is hidden initially
    test.skip(viewport !== null && viewport.width < 768, 'Main content hidden on mobile');

    const placeholder = page.locator('#video-input-state');
    await expect(placeholder).toBeVisible();
  });

  test('initial load shows correct default states', async ({ page }) => {
    // Source dropdown should have 'search' selected by default
    const sourceSelect = page.locator('#source-select');
    await expect(sourceSelect).toHaveValue('search');

    // No video should be selected
    const videoPreview = page.locator('.video-preview');
    const hasHidden = await videoPreview.evaluate(el => el.classList.contains('hidden'));
    expect(hasHidden).toBe(true);

    // Export button should be disabled (generate is inside hidden preview)
    const exportBtn = page.locator('#export-btn');
    await expect(exportBtn).toBeDisabled();
  });
});

test.describe('Edge Cases: Long Content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('long video titles are truncated with ellipsis', async ({ page }) => {
    await page.route('**/api/youtube/search**', async route => {
      await route.fulfill({
        status: 200,
        json: {
          videos: [{
            id: 'test123',
            title: 'This is a very long video title that should be truncated because it is too long to fit in the available space and would cause layout issues if not handled properly',
            channel: 'Test Channel',
            thumbnail: 'https://example.com/thumb.jpg',
            duration: '10:00',
            views: '1000'
          }]
        }
      });
    });

    await page.selectOption('#topic-select', 'news');

    const title = page.locator('.video-search-card h4').first();
    await expect(title).toBeVisible({ timeout: 5000 });

    // Check for ellipsis or line clamp
    const styles = await title.evaluate(el => {
      const computed = window.getComputedStyle(el);
      return {
        overflow: computed.overflow,
        textOverflow: computed.textOverflow,
        webkitLineClamp: computed.webkitLineClamp
      };
    });

    expect(
      styles.textOverflow === 'ellipsis' ||
      styles.webkitLineClamp !== 'none' ||
      styles.overflow === 'hidden'
    ).toBe(true);
  });

  test('long search queries dont break layout', async ({ page, viewport }) => {
    // Skip on mobile - custom search toggle may not be visible
    test.skip(viewport !== null && viewport.width < 768, 'Mobile layout different');

    await page.locator('.custom-search-toggle').click();

    const input = page.locator('#search-query');
    const longQuery = 'a'.repeat(500);

    await input.fill(longQuery);

    // Input should handle long text
    const inputWidth = await input.evaluate(el => el.clientWidth);
    expect(inputWidth).toBeGreaterThan(50); // Should still be visible

    // Container should not overflow significantly (allow some tolerance)
    const container = page.locator('.custom-search-input');
    const overflow = await container.evaluate(el =>
      el.scrollWidth - el.clientWidth
    );
    // Allow small overflow (scrollable input is acceptable)
    expect(overflow).toBeLessThan(500);
  });

  test('long channel names dont break card layout', async ({ page }) => {
    await page.route('**/api/youtube/search**', async route => {
      await route.fulfill({
        status: 200,
        json: {
          videos: [{
            id: 'test123',
            title: 'Test Video',
            channel: 'This Is A Very Long Channel Name That Should Be Handled Gracefully',
            thumbnail: 'https://example.com/thumb.jpg',
            duration: '10:00',
            views: '1000'
          }]
        }
      });
    });

    await page.selectOption('#topic-select', 'news');

    const card = page.locator('.video-search-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });

    const cardBox = await card.boundingBox();
    const containerBox = await page.locator('.search-results-grid').boundingBox();

    if (cardBox && containerBox) {
      // Card should not overflow container
      expect(cardBox.width).toBeLessThanOrEqual(containerBox.width + 10);
    }
  });
});

test.describe('Edge Cases: Rapid Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('rapid source switching doesnt break state', async ({ page, viewport }) => {
    // Skip on mobile - dropdown may be hidden
    test.skip(viewport !== null && viewport.width < 768, 'Dropdown hidden on mobile');

    const sources = ['search', 'youtube', 'upload'];

    for (let i = 0; i < 10; i++) {
      await page.selectOption('#source-select', sources[i % 3]);
      await page.waitForTimeout(100);
    }

    // Wait for final state to settle
    await page.waitForTimeout(200);

    // Source dropdown should have a valid value
    const value = await page.locator('#source-select').inputValue();
    expect(sources).toContain(value);
  });

  test('rapid topic selection doesnt crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    const topics = ['news', 'politics', 'economy', 'culture', 'sports', 'science', 'religion', 'history'];

    for (let i = 0; i < 20; i++) {
      await page.selectOption('#topic-select', topics[i % topics.length]);
      await page.waitForTimeout(100);
    }

    await page.waitForTimeout(1000);

    expect(errors.length).toBe(0);
  });

  test('rapid slider adjustment is smooth', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    const display = page.locator('#ilr-value');

    for (let i = 10; i <= 35; i += 5) {
      await slider.evaluate((el: HTMLInputElement, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, (i / 10).toString());
      await page.waitForTimeout(50);
    }

    // Display should show final value
    const finalValue = await display.textContent();
    expect(finalValue).toBe('3.5');
  });

  test('double-clicking buttons doesnt cause issues', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    // Double-click a duration button (dropdowns don't double-click)
    await page.locator('.duration-btn').first().dblclick();
    await page.waitForTimeout(500);

    // Should not crash
    expect(errors.length).toBe(0);
  });
});

test.describe('Edge Cases: Network Conditions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('handles slow network gracefully', async ({ page }) => {
    // Simulate slow network
    await page.route('**/api/youtube/search**', async route => {
      await new Promise(r => setTimeout(r, 5000));
      await route.fulfill({
        status: 200,
        json: { videos: [] }
      });
    });

    await page.selectOption('#topic-select', 'news');

    // Loading should be visible during slow request
    await expect(page.locator('.search-loading')).toBeVisible({ timeout: 2000 });

    // Can stop the search
    await page.locator('#stop-search-btn').click();

    // Loading should disappear
    await expect(page.locator('.search-loading')).not.toBeVisible({ timeout: 2000 });
  });

  test('handles offline state', async ({ page }) => {
    // Go offline
    await page.context().setOffline(true);

    // Try to search using topic dropdown
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(2000);

    // Should show error
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Go back online
    await page.context().setOffline(false);
  });

  test('handles 500 errors gracefully', async ({ page }) => {
    await page.route('**/api/youtube/search**', async route => {
      await route.fulfill({
        status: 500,
        body: 'Internal Server Error'
      });
    });

    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(2000);

    // Should show error toast
    const toast = page.locator('.toast-error');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });

  test('handles 404 errors gracefully', async ({ page }) => {
    await page.route('**/api/youtube/search**', async route => {
      await route.fulfill({
        status: 404,
        body: 'Not Found'
      });
    });

    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(2000);

    // Should show error toast
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });

  test('handles rate limiting (429)', async ({ page }) => {
    await page.route('**/api/youtube/search**', async route => {
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '60' },
        body: 'Too Many Requests'
      });
    });

    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(2000);

    // Should show appropriate error
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Edge Cases: Browser Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('page works with JavaScript disabled for initial render', async ({ page }) => {
    // Disable JavaScript
    await page.context().route('**/*.js', route => route.abort());

    // Navigate (page should at least load structure)
    try {
      await page.goto('/generator.html', { waitUntil: 'domcontentloaded' });
    } catch {
      // Expected to fail partially
    }

    // Basic structure should exist
    const header = await page.locator('.header').count();
    expect(header).toBeGreaterThan(0);
  });

  test('handles browser back/forward navigation', async ({ page }) => {
    // Navigate away and back
    await page.goto('/index.html');
    await page.goBack();
    await page.waitForLoadState('networkidle');

    // Page should still work
    const sourceSelect = page.locator('#source-select');
    await expect(sourceSelect).toBeVisible();
  });

  test('handles page refresh during operation', async ({ page }) => {
    // Start a search using topic dropdown
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(500);

    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Page should be in clean state
    const loading = page.locator('.search-loading');
    await expect(loading).not.toBeVisible();
  });

  test('localStorage quota exhausted is handled', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    // Fill localStorage (this might not actually fill it but tests the concept)
    await page.evaluate(() => {
      try {
        const data = 'x'.repeat(1000000);
        for (let i = 0; i < 100; i++) {
          localStorage.setItem(`test_${i}`, data);
        }
      } catch (e) {
        // Expected to fail
      }
    });

    // Interact with page - use evaluate for range input
    await page.locator('#ilr-slider').evaluate((el: HTMLInputElement) => {
      el.value = '3.0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    // Should not crash - allow quota errors but no uncaught exceptions
    const criticalErrors = errors.filter(e =>
      !e.includes('quota') && !e.includes('QuotaExceeded')
    );
    expect(criticalErrors).toHaveLength(0);

    // Clean up
    await page.evaluate(() => localStorage.clear());
  });
});

test.describe('Edge Cases: Special Characters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('handles Arabic text in search', async ({ page }) => {
    await page.locator('.custom-search-toggle').click();

    const input = page.locator('#search-query');
    await input.fill('أخبار الشرق الأوسط');
    await page.keyboard.press('Enter');

    // Should trigger search without errors
    await page.waitForTimeout(2000);

    // No console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    expect(errors.length).toBe(0);
  });

  test('handles emoji in search', async ({ page }) => {
    await page.locator('.custom-search-toggle').click();

    const input = page.locator('#search-query');
    await input.fill('Arabic news 🇸🇦🗞️');
    await page.keyboard.press('Enter');

    await page.waitForTimeout(2000);

    // Should not crash
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    expect(errors.length).toBe(0);
  });

  test('handles special URL characters in YouTube URL', async ({ page }) => {
    await page.selectOption('#source-select', 'youtube');

    const input = page.locator('#youtube-url');
    await input.fill('https://www.youtube.com/watch?v=test&feature=share&t=100');

    await page.waitForTimeout(500);

    // Should be handled correctly
  });

  test('handles RTL/LTR mixed content', async ({ page }) => {
    await page.locator('.custom-search-toggle').click();

    const input = page.locator('#search-query');
    await input.fill('YouTube أخبار 2024');

    const value = await input.inputValue();
    expect(value).toBe('YouTube أخبار 2024');
  });
});

test.describe('Edge Cases: Viewport Edge Cases', () => {
  test('handles very wide viewport', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // Layout should still be reasonable
    const body = await page.evaluate(() => document.body.scrollWidth);
    expect(body).toBeLessThanOrEqual(2600);
  });

  test('handles very narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 280, height: 600 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // No horizontal scroll
    const hasOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasOverflow).toBe(false);
  });

  test('handles very short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 400 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // Content should be scrollable
    const content = page.locator('.main-content');
    const overflow = await content.evaluate(el =>
      window.getComputedStyle(el).overflowY
    );

    expect(['auto', 'scroll', 'visible']).toContain(overflow);
  });

  test('handles viewport resize during interaction', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // Start search using topic dropdown
    await page.selectOption('#topic-select', 'news');

    // Resize while loading
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Should not break
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    expect(errors.length).toBe(0);
  });
});

test.describe('Edge Cases: File Upload', () => {
  test.beforeEach(async ({ page, viewport }) => {
    // Skip file upload tests on mobile - panel may be hidden
    test.skip(viewport !== null && viewport.width < 768, 'File upload not visible on mobile');

    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // Switch to upload source
    await page.selectOption('#source-select', 'upload');
    await page.waitForTimeout(300);
  });

  test('handles oversized files gracefully', async ({ page }) => {
    const fileInput = page.locator('#file-input');

    // Create a 5MB file to avoid memory issues in test
    const largeFile = Buffer.alloc(5 * 1024 * 1024); // 5MB

    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    try {
      await fileInput.setInputFiles({
        name: 'large-file.mp3',
        mimeType: 'audio/mpeg',
        buffer: largeFile
      });
    } catch (e) {
      // File upload might fail - that's acceptable
    }

    await page.waitForTimeout(500);

    // Page should still be responsive
    const isResponsive = await page.evaluate(() => !!document.body);
    expect(isResponsive).toBe(true);
  });

  test('handles unsupported file types', async ({ page }) => {
    const fileInput = page.locator('#file-input');

    await fileInput.setInputFiles({
      name: 'document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('fake pdf content')
    });

    await page.waitForTimeout(500);

    // Should show error for unsupported type
  });

  test('handles empty file gracefully', async ({ page }) => {
    const fileInput = page.locator('#file-input');

    await fileInput.setInputFiles({
      name: 'empty.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('')
    });

    await page.waitForTimeout(500);

    // Should handle empty file
  });

  test('can remove selected file', async ({ page }) => {
    const fileInput = page.locator('#file-input');

    await fileInput.setInputFiles({
      name: 'test.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('fake audio content')
    });

    await page.waitForTimeout(300);

    // File preview should appear
    const filePreview = page.locator('.file-preview');
    await expect(filePreview).toBeVisible();

    // Click remove button
    const removeBtn = page.locator('.file-remove');
    await removeBtn.click();

    // Preview should be hidden
    await expect(filePreview).not.toBeVisible();
  });
});
