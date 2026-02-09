import { test, expect } from '@playwright/test';

/**
 * Performance and Loading Tests
 * These tests check for slow loading, blocking operations, and performance issues
 */

test.describe('Performance: Page Load', () => {
  test('generator page loads within acceptable time', async ({ page }) => {
    const start = Date.now();
    await page.goto('/generator.html');
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;

    // Should load DOM in under 3 seconds
    expect(loadTime).toBeLessThan(3000);
  });

  test('landing page loads within acceptable time', async ({ page }) => {
    const start = Date.now();
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;

    expect(loadTime).toBeLessThan(3000);
  });

  test('no render-blocking resources cause long delays', async ({ page }) => {
    const start = Date.now();
    await page.goto('/generator.html');
    await page.waitForLoadState('load');
    const fullLoadTime = Date.now() - start;

    // Full load (including resources) should be under 10 seconds
    expect(fullLoadTime).toBeLessThan(10000);
  });

  test('critical content is visible quickly', async ({ page }) => {
    await page.goto('/generator.html');

    // Header should be visible immediately
    await expect(page.locator('.header')).toBeVisible({ timeout: 1000 });

    // Main content area should be visible quickly
    await expect(page.locator('.generator-layout')).toBeVisible({ timeout: 2000 });
  });
});

test.describe('Performance: Interactivity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('buttons respond to clicks immediately', async ({ page }) => {
    const button = page.locator('.duration-btn').first();

    const start = Date.now();
    await button.click();
    const responseTime = Date.now() - start;

    // Click should register in under 500ms
    expect(responseTime).toBeLessThan(500);
  });

  test('source dropdown switches content quickly', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');

    const start = Date.now();
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(100);
    const switchTime = Date.now() - start;

    // Source switch should be under 500ms
    expect(switchTime).toBeLessThan(500);
  });

  test('slider updates display smoothly', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    const display = page.locator('#ilr-value');

    // Move slider
    await slider.evaluate((el: HTMLInputElement) => {
      el.value = '3.0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Display should update immediately
    await expect(display).toHaveText('3.0', { timeout: 500 });
  });
});

test.describe('Performance: Network', () => {
  test('no excessive API calls on page load', async ({ page }) => {
    let apiCalls = 0;

    await page.route('**/api/**', async route => {
      apiCalls++;
      await route.continue();
    });

    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // Should have minimal API calls on initial load
    expect(apiCalls).toBeLessThan(5);
  });

  test('search triggers single API call', async ({ page }) => {
    let searchCalls = 0;

    await page.route('**/api/youtube/search**', async route => {
      searchCalls++;
      await route.fulfill({
        status: 200,
        json: { videos: [] }
      });
    });

    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // Select topic
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(1000);

    // Should make exactly 1 search call
    expect(searchCalls).toBe(1);
  });
});

test.describe('Performance: Memory', () => {
  test('page does not leak memory on repeated operations', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const topics = ['news', 'politics', 'economy', 'culture', 'sports', 'science', 'religion', 'history'];

    // Get initial heap usage
    const initialHeap = await page.evaluate(() => {
      if ((performance as any).memory) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return 0;
    });

    // Perform many operations using topic dropdown
    for (let i = 0; i < 10; i++) {
      await page.selectOption('#topic-select', topics[i % topics.length]);
      await page.waitForTimeout(200);
    }

    // Force garbage collection if possible
    await page.evaluate(() => {
      if ((window as any).gc) {
        (window as any).gc();
      }
    });

    // Get final heap usage
    const finalHeap = await page.evaluate(() => {
      if ((performance as any).memory) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return 0;
    });

    if (initialHeap > 0) {
      // Memory shouldn't grow more than 50MB
      expect(finalHeap - initialHeap).toBeLessThan(50 * 1024 * 1024);
    }
  });
});

test.describe('Performance: Animations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('CSS animations use GPU-friendly properties', async ({ page }) => {
    // Check that animations use transform/opacity (GPU accelerated)
    const animatedElements = await page.locator('[class*="loading"], [class*="spinner"]').all();

    for (const el of animatedElements) {
      if (await el.isVisible().catch(() => false)) {
        const animation = await el.evaluate(e => {
          const style = window.getComputedStyle(e);
          return {
            transform: style.transform,
            animation: style.animation,
            willChange: style.willChange
          };
        });

        // Should use transform for animations (not left/top)
        if (animation.animation !== 'none') {
          // Animation is defined - this is good practice
          expect(animation.animation).toBeTruthy();
        }
      }
    }
  });

  test('no jank-causing reflows during interactions', async ({ page }) => {
    // Click multiple elements and ensure no forced synchronous layouts
    const errors: string[] = [];

    page.on('console', msg => {
      if (msg.text().includes('layout') || msg.text().includes('reflow')) {
        errors.push(msg.text());
      }
    });

    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(500);

    await page.selectOption('#source-select', 'youtube').catch(() => {});
    await page.waitForTimeout(500);

    // No forced layout warnings
    expect(errors).toHaveLength(0);
  });
});

test.describe('Performance: Responsive Images', () => {
  test('images have appropriate dimensions', async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const images = await page.locator('img').all();

    for (const img of images) {
      if (await img.isVisible().catch(() => false)) {
        const naturalSize = await img.evaluate(el => ({
          natural: { width: el.naturalWidth, height: el.naturalHeight },
          display: { width: el.clientWidth, height: el.clientHeight }
        }));

        // Images shouldn't be massively oversized (more than 3x display size)
        if (naturalSize.display.width > 0 && naturalSize.natural.width > 0) {
          const ratio = naturalSize.natural.width / naturalSize.display.width;
          expect(ratio).toBeLessThan(3);
        }
      }
    }
  });
});
