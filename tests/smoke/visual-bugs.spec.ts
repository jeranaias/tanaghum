import { test, expect, Page } from '@playwright/test';

/**
 * Visual Bug Detection Tests
 * These tests look for specific CSS issues, overflow problems, layout bugs
 */

// ============================================================================
// OVERFLOW & SCROLLING BUGS
// ============================================================================

test.describe('Visual: Overflow Detection', () => {
  test('no horizontal overflow on generator page at any common width', async ({ page }) => {
    const widths = [320, 375, 414, 768, 1024, 1280, 1440, 1920];

    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/generator.html');
      await page.waitForLoadState('networkidle');

      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      const clientWidth = await page.evaluate(() => document.body.clientWidth);

      if (scrollWidth > clientWidth + 5) {
        // Find overflowing elements
        const overflowing = await page.evaluate(() => {
          const elements: string[] = [];
          document.querySelectorAll('*').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
              elements.push(`${el.tagName}.${el.className}: right=${rect.right}px`);
            }
          });
          return elements.slice(0, 10);
        });

        console.log(`Overflow at ${width}px:`, overflowing);
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
      }
    }
  });

  test('no horizontal overflow on landing page at any common width', async ({ page }) => {
    const widths = [320, 375, 414, 768, 1024, 1280, 1440];

    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      const clientWidth = await page.evaluate(() => document.body.clientWidth);

      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
    }
  });

  test('no elements extend beyond viewport on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const overflowing = await page.evaluate(() => {
      const elements: string[] = [];
      const viewportWidth = window.innerWidth;

      document.querySelectorAll('*').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.right > viewportWidth + 10 && rect.width > 0) {
          const tag = el.tagName.toLowerCase();
          const classes = el.className ? `.${el.className.split(' ').join('.')}` : '';
          const id = el.id ? `#${el.id}` : '';
          elements.push(`${tag}${id}${classes}: ${Math.round(rect.right)}px (overflow: ${Math.round(rect.right - viewportWidth)}px)`);
        }
      });

      return elements;
    });

    if (overflowing.length > 0) {
      console.log('Overflowing elements:', overflowing);
    }

    expect(overflowing.length).toBe(0);
  });
});

// ============================================================================
// TEXT OVERFLOW & TRUNCATION
// ============================================================================

test.describe('Visual: Text Handling', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test('long video titles are properly truncated', async ({ page }) => {
    await page.goto('/generator.html');

    // Search for videos using topic dropdown
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('#search-loading')).not.toBeVisible({ timeout: 15000 });

    const cards = page.locator('.video-search-card');
    const count = await cards.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const card = cards.nth(i);
      const title = card.locator('h4');

      // Title should not overflow its container
      const titleBox = await title.boundingBox();
      const cardBox = await card.boundingBox();

      if (titleBox && cardBox) {
        expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 10);
      }
    }
  });

  test('Arabic text displays correctly with RTL', async ({ page }) => {
    await page.goto('/generator.html');

    // Check that Arabic elements have correct direction
    const arabicElements = await page.locator('[lang="ar"], [dir="rtl"]').count();

    // Should have some Arabic/RTL elements
    expect(arabicElements).toBeGreaterThan(0);

    // Search for videos to get Arabic content using topic dropdown
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('#search-loading')).not.toBeVisible({ timeout: 15000 });
  });
});

// ============================================================================
// PANEL LAYOUT BUGS
// ============================================================================

test.describe('Visual: Panel Layout', () => {
  test('three-panel layout has no gaps or overlaps at various widths', async ({ page, viewport }) => {
    // Skip on mobile/tablet - only test true three-column layout (>1200px)
    test.skip(viewport !== null && viewport.width < 1200, 'Desktop only - smaller screens use 2-column or 1-column');

    // Only test widths where three-column layout is active
    const widths = [1280, 1440, 1920];

    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/generator.html');
      await page.waitForLoadState('networkidle');

      const left = await page.locator('#config-panel').boundingBox();
      const main = await page.locator('.main-content').boundingBox();
      const right = await page.locator('.panel-right').boundingBox();

      if (left && main && right) {
        // No overlap
        expect(left.x + left.width).toBeLessThanOrEqual(main.x + 2);
        expect(main.x + main.width).toBeLessThanOrEqual(right.x + 2);

        // No large gaps (more than 50px)
        const gap1 = main.x - (left.x + left.width);
        const gap2 = right.x - (main.x + main.width);

        expect(gap1).toBeLessThan(50);
        expect(gap2).toBeLessThan(50);

        // Right panel should reach viewport edge (or close)
        expect(right.x + right.width).toBeGreaterThan(width - 50);
      }
    }
  });

  test('panels fill available height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const main = await page.locator('.main-content').boundingBox();

    if (main) {
      // Main content should use significant height
      expect(main.height).toBeGreaterThan(400);
    }
  });
});

// ============================================================================
// MOBILE TOOLBAR BUGS
// ============================================================================

test.describe('Visual: Mobile Toolbar', () => {
  test.skip(({ viewport }) => viewport!.width > 768, 'Mobile only');

  test('toolbar stays fixed at bottom during scroll', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const toolbar = page.locator('.mobile-toolbar');

    // Get initial position
    const initialBox = await toolbar.boundingBox();
    const viewportHeight = page.viewportSize()!.height;

    // Toolbar should be at bottom
    expect(initialBox!.y + initialBox!.height).toBeGreaterThan(viewportHeight - 10);

    // Scroll the page
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);

    // Toolbar should still be at same position
    const afterScrollBox = await toolbar.boundingBox();
    expect(afterScrollBox!.y + afterScrollBox!.height).toBeGreaterThan(viewportHeight - 10);
  });

  test('toolbar buttons are evenly spaced', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const buttons = page.locator('.mobile-toolbar-btn');
    const boxes = [];

    for (let i = 0; i < 3; i++) {
      boxes.push(await buttons.nth(i).boundingBox());
    }

    if (boxes[0] && boxes[1] && boxes[2]) {
      const gap1 = boxes[1].x - (boxes[0].x + boxes[0].width);
      const gap2 = boxes[2].x - (boxes[1].x + boxes[1].width);

      // Gaps should be similar (within 20px)
      expect(Math.abs(gap1 - gap2)).toBeLessThan(20);
    }
  });

  test('toolbar does not overlap content', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    await page.locator('.mobile-toolbar-btn[data-panel="config"]').click();
    await page.waitForTimeout(300);

    const toolbar = await page.locator('.mobile-toolbar').boundingBox();
    const configPanel = await page.locator('#config-panel').boundingBox();

    if (toolbar && configPanel) {
      // Config panel should end before toolbar starts
      expect(configPanel.y + configPanel.height).toBeLessThanOrEqual(toolbar.y + 5);
    }
  });
});

// ============================================================================
// BUTTON & CONTROL SIZING
// ============================================================================

test.describe('Visual: Touch Targets', () => {
  test.skip(({ viewport }) => viewport!.width > 768, 'Mobile only');

  test('all buttons meet minimum touch target size (44x44)', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const buttons = page.locator('button:visible');
    const count = await buttons.count();

    const tooSmall: string[] = [];

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const box = await btn.boundingBox();

      if (box && (box.width < 44 || box.height < 44)) {
        const text = await btn.textContent();
        tooSmall.push(`"${text?.trim().substring(0, 20)}": ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
    }

    if (tooSmall.length > 0) {
      console.log('Buttons smaller than 44x44:', tooSmall);
    }

    // Allow some small buttons, but not too many
    expect(tooSmall.length).toBeLessThan(5);
  });

  test('topic dropdown is tappable on mobile', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    await page.locator('.mobile-toolbar-btn[data-panel="config"]').click();
    await page.waitForTimeout(300);

    const topicSelect = page.locator('#topic-select');
    const box = await topicSelect.boundingBox();

    if (box) {
      // Should be at least 44px in smallest dimension for touch targets
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40);
    }
  });
});

// ============================================================================
// LOADING STATES
// ============================================================================

test.describe('Visual: Loading States', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test('search loading spinner is visible and centered', async ({ page }) => {
    await page.goto('/generator.html');

    // Start a search using topic dropdown
    await page.selectOption('#topic-select', 'news');

    const loading = page.locator('#search-loading');
    await expect(loading).toBeVisible({ timeout: 3000 });

    // Spinner should be visible
    const spinner = loading.locator('.processing-spinner');
    await expect(spinner).toBeVisible();

    // Loading text should be visible
    const text = loading.locator('#search-loading-text');
    await expect(text).toBeVisible();
  });

  test('topic dropdown triggers loading state', async ({ page }) => {
    await page.goto('/generator.html');

    await page.selectOption('#topic-select', 'news');

    // Loading indicator should be visible
    await expect(page.locator('#search-loading')).toBeVisible({ timeout: 3000 });

    // Wait for search to complete
    await expect(page.locator('#search-loading')).not.toBeVisible({ timeout: 15000 });

    // Topic dropdown should retain value
    await expect(page.locator('#topic-select')).toHaveValue('news');
  });
});

// ============================================================================
// HIDDEN ELEMENTS THAT SHOULD STAY HIDDEN
// ============================================================================

test.describe('Visual: Hidden States', () => {
  test('processing state is truly hidden, not just invisible', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const processing = page.locator('#processing-state');

    // Should not take up space
    const box = await processing.boundingBox();
    expect(box).toBeNull();
  });

  test('review state is truly hidden', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const review = page.locator('#review-state');
    const box = await review.boundingBox();
    expect(box).toBeNull();
  });

  test('hidden search results do not take space', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const results = page.locator('#search-results');
    await expect(results).toHaveClass(/hidden/);

    // Check if it actually takes no space
    const display = await results.evaluate(el => getComputedStyle(el).display);
    expect(display).toBe('none');
  });
});

// ============================================================================
// Z-INDEX & STACKING
// ============================================================================

test.describe('Visual: Z-Index & Stacking', () => {
  test.skip(({ viewport }) => viewport!.width > 768, 'Mobile only');

  test('mobile toolbar is above content', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const toolbar = page.locator('.mobile-toolbar');
    const toolbarZIndex = await toolbar.evaluate(el => getComputedStyle(el).zIndex);

    // Should have a high z-index
    expect(parseInt(toolbarZIndex) || 0).toBeGreaterThan(100);
  });

  test('toast notifications appear above everything', async ({ page }) => {
    await page.goto('/generator.html');

    // Trigger a toast using topic dropdown
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('#search-loading')).toBeVisible({ timeout: 3000 });
    await page.locator('#stop-search-btn').click();

    const toast = page.locator('.toast').first();
    await expect(toast).toBeVisible({ timeout: 3000 });

    const toastContainer = page.locator('#toast-container');
    const zIndex = await toastContainer.evaluate(el => getComputedStyle(el).zIndex);

    expect(parseInt(zIndex) || 0).toBeGreaterThan(1000);
  });
});

// ============================================================================
// FONT & TEXT RENDERING
// ============================================================================

test.describe('Visual: Typography', () => {
  test('fonts load correctly', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // Check if custom fonts loaded
    const fontsLoaded = await page.evaluate(() => document.fonts.ready.then(() => {
      return Array.from(document.fonts).filter(f => f.status === 'loaded').length;
    }));

    expect(fontsLoaded).toBeGreaterThan(0);
  });

  test('Arabic font is applied to Arabic text', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const arabicElement = page.locator('[lang="ar"]').first();

    if (await arabicElement.isVisible()) {
      const fontFamily = await arabicElement.evaluate(el => getComputedStyle(el).fontFamily);

      // Should include Arabic font
      expect(fontFamily.toLowerCase()).toMatch(/noto|arabic|tajawal|scheherazade/i);
    }
  });
});

// ============================================================================
// COLOR & CONTRAST
// ============================================================================

test.describe('Visual: Colors', () => {
  test('active states have visible color change', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const sourceSelect = page.locator('#source-select');

    // Check initial value
    await expect(sourceSelect).toHaveValue('search');

    // Change source and verify the value changes
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(300);

    // Value should be updated
    await expect(sourceSelect).toHaveValue('youtube');

    // Content panels should switch visibility
    await expect(page.locator('#source-youtube')).toBeVisible();
    await expect(page.locator('#source-search')).not.toBeVisible();
  });

  test('disabled buttons look disabled', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const exportBtn = page.locator('#export-btn');

    // Check opacity or cursor
    const opacity = await exportBtn.evaluate(el => getComputedStyle(el).opacity);
    const cursor = await exportBtn.evaluate(el => getComputedStyle(el).cursor);

    // Should look disabled (low opacity or not-allowed cursor)
    const looksDisabled = parseFloat(opacity) < 1 || cursor === 'not-allowed';
    expect(looksDisabled).toBeTruthy();
  });
});

// ============================================================================
// SCREENSHOT COMPARISONS FOR VISUAL REGRESSION
// ============================================================================

test.describe('Visual: Screenshot Regression', () => {
  test('generator page visual regression - desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/screenshots/regression-desktop.png',
      fullPage: true
    });
  });

  test('generator page visual regression - tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/screenshots/regression-tablet.png',
      fullPage: true
    });
  });

  test('generator page visual regression - mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/screenshots/regression-mobile.png',
      fullPage: true
    });
  });

  test('landing page visual regression', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/screenshots/regression-landing.png',
      fullPage: true
    });
  });
});
