import { test, expect } from '@playwright/test';

/**
 * State Management Tests
 * These tests verify that application state is correctly managed throughout the workflow
 */

test.describe('State: Initial Load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('page loads with correct initial state', async ({ page }) => {
    // Source dropdown should have 'search' selected by default
    const sourceSelect = page.locator('#source-select');
    await expect(sourceSelect).toHaveValue('search');

    // Search content should be visible
    await expect(page.locator('#source-search')).toBeVisible();

    // Other content panels should not be visible
    await expect(page.locator('#source-youtube')).not.toBeVisible();
    await expect(page.locator('#source-upload')).not.toBeVisible();
  });

  test('ILR slider has default value', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    const value = await slider.inputValue();

    // Default should be 2.0 or similar
    expect(parseFloat(value)).toBeGreaterThanOrEqual(1.0);
    expect(parseFloat(value)).toBeLessThanOrEqual(4.0);
  });

  test('duration buttons have one selected by default', async ({ page }) => {
    const activeCount = await page.evaluate(() =>
      document.querySelectorAll('.duration-btn.active').length
    );

    expect(activeCount).toBe(1);
  });

  test('no video selected initially', async ({ page }) => {
    // Video preview should be hidden
    const preview = page.locator('#video-preview');
    const isHidden = await preview.evaluate(el =>
      el.classList.contains('hidden') || window.getComputedStyle(el).display === 'none'
    );

    expect(isHidden).toBe(true);
  });

  test('processing and review states are hidden initially', async ({ page }) => {
    await expect(page.locator('#processing-state')).not.toBeVisible();
    await expect(page.locator('#review-state')).not.toBeVisible();
  });
});

test.describe('State: Source Selection', () => {
  test.beforeEach(async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('switching sources updates source type state', async ({ page }) => {
    // Initial state - search should be selected
    await expect(page.locator('#source-select')).toHaveValue('search');
    await expect(page.locator('#source-search')).toBeVisible();

    // Switch to YouTube
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(200);

    await expect(page.locator('#source-select')).toHaveValue('youtube');
    await expect(page.locator('#source-youtube')).toBeVisible();

    // Switch to Upload
    await page.selectOption('#source-select', 'upload');
    await page.waitForTimeout(200);

    await expect(page.locator('#source-select')).toHaveValue('upload');
    await expect(page.locator('#source-upload')).toBeVisible();
  });

  test('source content visibility matches selected source', async ({ page }) => {
    // Search source active
    await expect(page.locator('#source-search')).toBeVisible();
    await expect(page.locator('#source-youtube')).not.toBeVisible();
    await expect(page.locator('#source-upload')).not.toBeVisible();

    // Switch to YouTube
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(200);

    await expect(page.locator('#source-search')).not.toBeVisible();
    await expect(page.locator('#source-youtube')).toBeVisible();
    await expect(page.locator('#source-upload')).not.toBeVisible();

    // Switch to Upload
    await page.selectOption('#source-select', 'upload');
    await page.waitForTimeout(200);

    await expect(page.locator('#source-search')).not.toBeVisible();
    await expect(page.locator('#source-youtube')).not.toBeVisible();
    await expect(page.locator('#source-upload')).toBeVisible();
  });
});

test.describe('State: Topic Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('selecting topic updates state', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(200);

    // Verify via UI state - dropdown should have the value
    await expect(page.locator('#topic-select')).toHaveValue('news');
  });

  test('topic dropdown shows selected value', async ({ page }) => {
    const topicSelect = page.locator('#topic-select');

    // No selection initially (or default empty)
    const initialValue = await topicSelect.inputValue();

    // Select and verify
    await page.selectOption('#topic-select', 'politics');
    await page.waitForTimeout(200);

    await expect(topicSelect).toHaveValue('politics');
  });

  test('topic dropdown only has one selected value', async ({ page }) => {
    // Select first topic
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(100);

    // Select second topic
    await page.selectOption('#topic-select', 'politics');
    await page.waitForTimeout(100);

    // Only second should be selected
    await expect(page.locator('#topic-select')).toHaveValue('politics');
    await expect(page.locator('#topic-select')).not.toHaveValue('news');
  });
});

test.describe('State: ILR Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('slider value updates state', async ({ page }) => {
    await page.locator('#ilr-slider').evaluate((el: HTMLInputElement) => {
      el.value = '3.0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.waitForTimeout(100);

    // Verify via UI - display should show 3.0
    await expect(page.locator('#ilr-value')).toHaveText('3.0');
  });

  test('slider updates display text', async ({ page }) => {
    await page.locator('#ilr-slider').evaluate((el: HTMLInputElement) => {
      el.value = '2.5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.locator('#ilr-value')).toHaveText('2.5');
  });

  test('slider updates ILR name and description', async ({ page }) => {
    // Set to level 3
    await page.locator('#ilr-slider').evaluate((el: HTMLInputElement) => {
      el.value = '3.0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.waitForTimeout(100);

    const name = await page.locator('#ilr-name').textContent();
    const desc = await page.locator('#ilr-desc').textContent();

    expect(name).toBeTruthy();
    expect(desc).toBeTruthy();
  });
});

test.describe('State: Duration Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('clicking duration updates state', async ({ page }) => {
    const buttons = page.locator('.duration-btn');
    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
      await buttons.nth(i).click();
      await page.waitForTimeout(100);

      const isActive = await buttons.nth(i).evaluate(el =>
        el.classList.contains('active')
      );
      expect(isActive).toBe(true);
    }
  });

  test('duration selection is mutually exclusive', async ({ page }) => {
    const buttons = page.locator('.duration-btn');

    // Click each button and verify only one is active
    await buttons.nth(0).click();
    await page.waitForTimeout(100);
    let activeCount = await page.evaluate(() =>
      document.querySelectorAll('.duration-btn.active').length
    );
    expect(activeCount).toBe(1);

    await buttons.nth(1).click();
    await page.waitForTimeout(100);
    activeCount = await page.evaluate(() =>
      document.querySelectorAll('.duration-btn.active').length
    );
    expect(activeCount).toBe(1);
  });
});

test.describe('State: Video Selection', () => {
  test.beforeEach(async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');

    await page.route('**/api/youtube/search**', async route => {
      await route.fulfill({
        status: 200,
        json: {
          videos: [
            { id: 'vid1', title: 'Video 1', channel: 'Channel 1', durationSeconds: 120 },
            { id: 'vid2', title: 'Video 2', channel: 'Channel 2', durationSeconds: 180 }
          ]
        }
      });
    });

    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('selecting video updates state', async ({ page }) => {
    // Search using topic dropdown
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('.video-search-card').first()).toBeVisible({ timeout: 5000 });

    // Select
    await page.locator('.video-search-card').first().click();
    await page.waitForTimeout(200);

    // Verify via UI - video preview should be visible
    await expect(page.locator('#video-preview')).toBeVisible();
    await expect(page.locator('.video-search-card.selected')).toBeVisible();
  });

  test('selected video shows visual feedback', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('.video-search-card').first()).toBeVisible({ timeout: 5000 });

    const card = page.locator('.video-search-card').first();
    await card.click();
    await page.waitForTimeout(200);

    await expect(card).toHaveClass(/selected/);
  });

  test('selecting different video updates state', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('.video-search-card').first()).toBeVisible({ timeout: 5000 });

    // Select first
    const firstCard = page.locator('.video-search-card').nth(0);
    await firstCard.click();
    await page.waitForTimeout(200);

    await expect(firstCard).toHaveClass(/selected/);

    // Select second
    const secondCard = page.locator('.video-search-card').nth(1);
    await secondCard.click();
    await page.waitForTimeout(200);

    // First should not be selected, second should be
    await expect(firstCard).not.toHaveClass(/selected/);
    await expect(secondCard).toHaveClass(/selected/);
  });
});

test.describe('State: Video Preview', () => {
  test.beforeEach(async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');

    await page.route('**/api/youtube/search**', async route => {
      await route.fulfill({
        status: 200,
        json: {
          videos: [
            {
              id: 'test123',
              title: 'Test Video Title',
              channel: 'Test Channel',
              thumbnail: 'https://i.ytimg.com/vi/test123/hqdefault.jpg',
              durationSeconds: 180
            }
          ]
        }
      });
    });

    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('video preview shows after selection', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('.video-search-card').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.video-search-card').first().click();

    await expect(page.locator('#video-preview')).toBeVisible({ timeout: 3000 });
  });

  test('video preview shows correct title', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('.video-search-card').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.video-search-card').first().click();

    await expect(page.locator('#video-preview')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#video-title')).toContainText('Test Video Title');
  });

  test('video preview shows channel name', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('.video-search-card').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.video-search-card').first().click();

    await expect(page.locator('#video-preview')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#video-channel')).toContainText('Test Channel');
  });

  test('video preview shows thumbnail', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('.video-search-card').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.video-search-card').first().click();

    await expect(page.locator('#video-preview')).toBeVisible({ timeout: 3000 });

    const thumb = page.locator('#video-thumb');
    await expect(thumb).toBeVisible();

    const src = await thumb.getAttribute('src');
    expect(src).toBeTruthy();
  });

  test('generate button appears in preview', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('.video-search-card').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.video-search-card').first().click();

    await expect(page.locator('#video-preview')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#preview-generate-btn')).toBeVisible();
  });
});

test.describe('State: Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('ILR setting persists through interactions', async ({ page }) => {
    // Set ILR
    await page.locator('#ilr-slider').evaluate((el: HTMLInputElement) => {
      el.value = '3.5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Select topic using dropdown
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(500);

    // ILR should still be 3.5
    const value = await page.locator('#ilr-slider').inputValue();
    expect(value).toBe('3.5');
  });

  test('duration setting persists through interactions', async ({ page }) => {
    // Select duration
    await page.locator('.duration-btn').nth(1).click();
    const initialText = await page.locator('.duration-btn.active').textContent();

    // Select topic using dropdown
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(500);

    // Duration should still be selected
    const finalText = await page.locator('.duration-btn.active').textContent();
    expect(finalText).toBe(initialText);
  });
});
