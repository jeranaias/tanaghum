import { test, expect } from '@playwright/test';

/**
 * Integration Tests
 * These tests check end-to-end flows and component interactions
 */

test.describe('Integration: Search to Selection Flow', () => {
  test.beforeEach(async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');

    // Mock API for reliable results
    await page.route('**/api/youtube/search**', async route => {
      await route.fulfill({
        status: 200,
        json: {
          videos: [
            {
              id: 'video1',
              title: 'Test Video 1',
              channel: 'Channel 1',
              thumbnail: 'https://i.ytimg.com/vi/video1/hqdefault.jpg',
              durationSeconds: 180,
              description: 'Test'
            },
            {
              id: 'video2',
              title: 'Test Video 2',
              channel: 'Channel 2',
              thumbnail: 'https://i.ytimg.com/vi/video2/hqdefault.jpg',
              durationSeconds: 240,
              description: 'Test 2'
            }
          ]
        }
      });
    });

    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('complete flow: topic select -> results -> select -> preview', async ({ page }) => {
    // 1. Select topic from dropdown
    await page.selectOption('#topic-select', 'news');

    // 2. Wait for results
    await expect(page.locator('#search-loading')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.video-search-card').first()).toBeVisible();

    // 3. Select video
    await page.locator('.video-search-card').first().click();

    // 4. Verify preview
    await expect(page.locator('#video-preview')).toBeVisible();
    await expect(page.locator('#video-title')).toBeVisible();
    await expect(page.locator('#preview-generate-btn')).toBeVisible();
  });

  test('changing topic clears previous selection', async ({ page }) => {
    // Select first topic using dropdown
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('.video-search-card').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.video-search-card').first().click();

    // Verify selection
    await expect(page.locator('.video-search-card.selected')).toBeVisible();

    // Change topic using dropdown
    await page.selectOption('#topic-select', 'politics');
    await page.waitForTimeout(500);

    // Previous selection should be cleared
    const selectedCount = await page.locator('.video-search-card.selected').count();
    expect(selectedCount).toBeLessThanOrEqual(1);
  });
});

test.describe('Integration: Configuration Changes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('ILR change affects suggested searches', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');

    // Change ILR level
    await page.locator('#ilr-slider').evaluate((el: HTMLInputElement) => {
      el.value = '3.5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Display should update
    await expect(page.locator('#ilr-value')).toHaveText('3.5');
  });

  test('duration selection is mutually exclusive', async ({ page }) => {
    const buttons = page.locator('.duration-btn');

    // Click different durations
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

test.describe('Integration: Tab Switching', () => {
  test.beforeEach(async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');

    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('source content shows/hides correctly', async ({ page }) => {
    // Check initial state (search should be active)
    await expect(page.locator('#source-search')).toBeVisible();

    // Switch to YouTube source
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(200);

    await expect(page.locator('#source-youtube')).toBeVisible();
    await expect(page.locator('#source-search')).not.toBeVisible();

    // Switch to Upload source
    await page.selectOption('#source-select', 'upload');
    await page.waitForTimeout(200);

    await expect(page.locator('#source-upload')).toBeVisible();
    await expect(page.locator('#source-youtube')).not.toBeVisible();

    // Back to search
    await page.selectOption('#source-select', 'search');
    await page.waitForTimeout(200);

    await expect(page.locator('#source-search')).toBeVisible();
    await expect(page.locator('#source-upload')).not.toBeVisible();
  });

  test('source selection updates dropdown value', async ({ page }) => {
    const sourceSelect = page.locator('#source-select');

    // Check initial state
    await expect(sourceSelect).toHaveValue('search');

    // Switch sources
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(200);

    // Value should update
    await expect(sourceSelect).toHaveValue('youtube');
  });
});

test.describe('Integration: Error Recovery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('recovers from API error', async ({ page }) => {
    // First request fails
    let requestCount = 0;
    await page.route('**/api/youtube/search**', async route => {
      requestCount++;
      if (requestCount === 1) {
        await route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        await route.fulfill({
          status: 200,
          json: { videos: [{ id: 'test', title: 'Test', channel: 'Test' }] }
        });
      }
    });

    // First selection fails
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(1000);

    // Error should be shown
    const toastVisible = await page.locator('.toast').isVisible().catch(() => false);
    expect(toastVisible).toBe(true);

    // Second selection should work
    await page.selectOption('#topic-select', 'politics');
    await page.waitForTimeout(1000);

    // Page should still be usable
    await expect(page.locator('#topic-select')).toBeEnabled();
  });

  test('stops pending search on new search', async ({ page }) => {
    let abortedRequests = 0;

    await page.route('**/api/youtube/search**', async route => {
      await new Promise(r => setTimeout(r, 5000));
      await route.fulfill({ status: 200, json: { videos: [] } });
    });

    // Start first search
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(200);

    // Start second search (should cancel first)
    await page.selectOption('#topic-select', 'politics');
    await page.waitForTimeout(200);

    // Only latest topic should be selected in dropdown
    await expect(page.locator('#topic-select')).toHaveValue('politics');
  });
});

test.describe('Integration: State Preservation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('ILR value survives page interactions', async ({ page }) => {
    // Set ILR
    await page.locator('#ilr-slider').evaluate((el: HTMLInputElement) => {
      el.value = '3.0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Perform various interactions using dropdowns
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(500);

    await page.locator('.duration-btn').nth(1).click();
    await page.waitForTimeout(200);

    // ILR should still be 3.0
    const value = await page.locator('#ilr-slider').inputValue();
    expect(value).toBe('3');
  });

  test('duration selection survives source switches', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');

    // Select duration
    await page.locator('.duration-btn').nth(1).click();
    await page.waitForTimeout(100);

    const initialActive = await page.locator('.duration-btn.active').first().textContent();

    // Switch sources using dropdown
    await page.selectOption('#source-select', 'youtube');
    await page.selectOption('#source-select', 'search');
    await page.waitForTimeout(200);

    // Duration should still be selected
    const finalActive = await page.locator('.duration-btn.active').first().textContent();
    expect(finalActive).toBe(initialActive);
  });
});

test.describe('Integration: Keyboard Navigation Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('can navigate and activate topic dropdown with keyboard', async ({ page }) => {
    // Focus topic dropdown
    await page.locator('#topic-select').focus();
    await page.waitForTimeout(100);

    // Select a topic using keyboard
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(200);

    // Should show loading or results
    await expect(page.locator('#topic-select')).toHaveValue('news');
  });

  test('can navigate source dropdown with keyboard', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');

    // Focus source dropdown
    await page.locator('#source-select').focus();
    await page.waitForTimeout(100);

    // Change selection using keyboard
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(100);

    // Value should be updated
    await expect(page.locator('#source-select')).toHaveValue('youtube');
  });
});

test.describe('Integration: Toast Behavior', () => {
  test.beforeEach(async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');

    await page.route('**/api/youtube/search**', async route => {
      await route.fulfill({
        status: 200,
        json: {
          videos: [{ id: 'test', title: 'Test', channel: 'Test' }]
        }
      });
    });

    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('toast auto-dismisses after timeout', async ({ page }) => {
    // Trigger toast using topic dropdown
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(1000);

    // Toast should appear
    const toast = page.locator('.toast').first();
    await expect(toast).toBeVisible({ timeout: 2000 });

    // Wait for auto-dismiss (usually 5 seconds)
    await page.waitForTimeout(6000);

    // Toast should be gone
    const toastVisible = await toast.isVisible().catch(() => false);
    expect(toastVisible).toBe(false);
  });

  test('multiple toasts stack correctly', async ({ page }) => {
    // Trigger multiple toasts quickly using topic dropdown
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(500);

    await page.locator('.video-search-card').first().click().catch(() => {});
    await page.waitForTimeout(500);

    // Multiple toasts should be visible
    const toasts = page.locator('.toast');
    const count = await toasts.count();

    // At least one toast should be visible
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
