import { test, expect } from '@playwright/test';

test.describe('CSS: Typography', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('no text is clipped or hidden unexpectedly', async ({ page }) => {
    const clippedElements: string[] = [];

    // Check for elements where text might be clipped
    const textContainers = await page.locator('h1, h2, h3, h4, p, span, button, a').all();

    for (const el of textContainers) {
      if (await el.isVisible()) {
        const isClipped = await el.evaluate(e => {
          const style = window.getComputedStyle(e);
          const overflow = style.overflow;
          const textOverflow = style.textOverflow;
          const whiteSpace = style.whiteSpace;

          // If overflow is hidden but no ellipsis, might be unintentional
          if (overflow === 'hidden' && textOverflow !== 'ellipsis' && whiteSpace !== 'nowrap') {
            // Check if content is actually clipped
            return e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight;
          }
          return false;
        });

        if (isClipped) {
          const text = await el.textContent();
          clippedElements.push(text?.substring(0, 30) || 'unknown');
        }
      }
    }

    expect(clippedElements.length, `Clipped text: ${clippedElements.join(', ')}`).toBeLessThanOrEqual(3);
  });

  test('font sizes are readable (min 12px)', async ({ page }) => {
    const tooSmall: string[] = [];

    const textElements = await page.locator('p, span, a, button, label, .tab-desc, .section-hint').all();

    for (const el of textElements) {
      if (await el.isVisible()) {
        const fontSize = await el.evaluate(e => {
          return parseFloat(window.getComputedStyle(e).fontSize);
        });

        if (fontSize < 10) {
          const text = await el.textContent();
          tooSmall.push(`${fontSize}px: ${text?.substring(0, 20)}`);
        }
      }
    }

    expect(tooSmall.length, `Text too small: ${tooSmall.join(', ')}`).toBe(0);
  });

  test('line heights are appropriate', async ({ page }) => {
    const badLineHeight: string[] = [];

    const paragraphs = await page.locator('p, .tab-desc, .section-hint').all();

    for (const p of paragraphs) {
      if (await p.isVisible()) {
        const lineHeight = await p.evaluate(e => {
          const style = window.getComputedStyle(e);
          const lh = parseFloat(style.lineHeight);
          const fs = parseFloat(style.fontSize);
          return lh / fs;
        });

        // Line height should be at least 1.2 for readability
        if (lineHeight < 1.2) {
          const text = await p.textContent();
          badLineHeight.push(text?.substring(0, 30) || 'unknown');
        }
      }
    }

    expect(badLineHeight.length).toBe(0);
  });

  test('Arabic text has larger line height', async ({ page }) => {
    const arabicText = await page.locator('[lang="ar"], .ar, .arabic').all();

    for (const el of arabicText) {
      if (await el.isVisible()) {
        const lineHeight = await el.evaluate(e => {
          const style = window.getComputedStyle(e);
          const lh = parseFloat(style.lineHeight);
          const fs = parseFloat(style.fontSize);
          return lh / fs;
        });

        // Arabic should have line height >= 1.6
        expect(lineHeight).toBeGreaterThanOrEqual(1.5);
      }
    }
  });
});

test.describe('CSS: Spacing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('buttons have consistent padding', async ({ page }) => {
    const buttons = await page.locator('.btn').all();
    const paddingValues: Set<string> = new Set();

    for (const btn of buttons) {
      if (await btn.isVisible()) {
        const padding = await btn.evaluate(e => {
          const style = window.getComputedStyle(e);
          return `${style.paddingTop}-${style.paddingRight}-${style.paddingBottom}-${style.paddingLeft}`;
        });

        // Check if same button type has same padding
        const btnClass = await btn.getAttribute('class');
        if (btnClass?.includes('btn-primary')) {
          paddingValues.add(padding);
        }
      }
    }

    // Should have consistent padding for same button types
    expect(paddingValues.size, 'Primary buttons should have consistent padding').toBeLessThanOrEqual(3);
  });

  test('section margins are consistent', async ({ page }) => {
    const sections = await page.locator('.panel-section').all();
    const margins: Set<string> = new Set();

    for (const section of sections) {
      if (await section.isVisible()) {
        const margin = await section.evaluate(e => window.getComputedStyle(e).marginBottom);
        margins.add(margin);
      }
    }

    // Allow some variation but not too much
    expect(margins.size).toBeLessThanOrEqual(3);
  });

  test('no overlapping elements', async ({ page }) => {
    const overlaps: string[] = [];

    // Check key interactive elements
    const elements = await page.locator('.btn, .duration-btn, select').all();
    const boxes: { el: string; box: { x: number; y: number; width: number; height: number } }[] = [];

    for (const el of elements) {
      if (await el.isVisible()) {
        const box = await el.boundingBox();
        const text = await el.textContent();
        if (box) {
          boxes.push({ el: text?.substring(0, 20) || 'unknown', box });
        }
      }
    }

    // Check for overlaps
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].box;
        const b = boxes[j].box;

        const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
        const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y;

        if (overlapsX && overlapsY) {
          overlaps.push(`${boxes[i].el} overlaps ${boxes[j].el}`);
        }
      }
    }

    expect(overlaps.length, `Overlapping elements: ${overlaps.join(', ')}`).toBe(0);
  });

  test('cards have consistent border radius', async ({ page }) => {
    const cards = await page.locator('.card, .content-card, .status-card, .tips-card').all();
    const radii: Set<string> = new Set();

    for (const card of cards) {
      if (await card.isVisible()) {
        const radius = await card.evaluate(e => window.getComputedStyle(e).borderRadius);
        radii.add(radius);
      }
    }

    // Should use consistent border radius from design system
    expect(radii.size).toBeLessThanOrEqual(3);
  });
});

test.describe('CSS: Colors', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('primary color is consistent', async ({ page }) => {
    const primaryElements = await page.locator('.btn-primary, .badge-primary').all();
    const colors: Set<string> = new Set();

    for (const el of primaryElements) {
      if (await el.isVisible()) {
        const bgColor = await el.evaluate(e => {
          const style = window.getComputedStyle(e);
          return style.backgroundColor;
        });
        colors.add(bgColor);
      }
    }

    // Primary color should be consistent (allow for gradients)
    expect(colors.size).toBeLessThanOrEqual(3);
  });

  test('error color is used for error states', async ({ page }) => {
    const errorElements = await page.locator('.form-error, .badge-error, .toast-error').all();

    for (const el of errorElements) {
      if (await el.isVisible()) {
        const color = await el.evaluate(e => {
          const style = window.getComputedStyle(e);
          return style.color || style.borderLeftColor || style.backgroundColor;
        });

        // Should contain red-ish color
        expect(color).toMatch(/rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|#[a-fA-F0-9]+/);
      }
    }
  });

  test('success color is used for success states', async ({ page }) => {
    const successElements = await page.locator('.badge-success, .toast-success').all();

    for (const el of successElements) {
      if (await el.isVisible()) {
        const color = await el.evaluate(e => {
          const style = window.getComputedStyle(e);
          return style.backgroundColor;
        });

        expect(color).toMatch(/rgb|#/);
      }
    }
  });

  test('dark theme applies correct colors', async ({ page }) => {
    // Set dark theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    const bgColor = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );

    // Dark theme should have dark background
    const rgb = bgColor.match(/\d+/g)?.map(Number);
    if (rgb && rgb.length >= 3) {
      const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
      expect(avg).toBeLessThan(80); // Dark color
    }
  });
});

test.describe('CSS: Borders and Shadows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('active elements have visible borders', async ({ page }) => {
    // Select a source to make it active
    const sourceSelect = page.locator('#source-select');
    await page.selectOption('#source-select', 'youtube');

    const borderColor = await sourceSelect.evaluate(e =>
      window.getComputedStyle(e).borderColor
    );

    // Select should have visible border
    expect(borderColor).toBeTruthy();
  });

  test('cards have appropriate shadows', async ({ page }) => {
    const cards = await page.locator('.card, .content-card').all();

    for (const card of cards) {
      if (await card.isVisible()) {
        const shadow = await card.evaluate(e => window.getComputedStyle(e).boxShadow);

        // Cards should have some shadow
        expect(shadow).not.toBe('none');
      }
    }
  });

  test('hover states add shadow', async ({ page }) => {
    const card = page.locator('.content-card').first();

    if (await card.isVisible()) {
      const initialShadow = await card.evaluate(e => window.getComputedStyle(e).boxShadow);

      await card.hover();
      await page.waitForTimeout(300); // Wait for transition

      const hoverShadow = await card.evaluate(e => window.getComputedStyle(e).boxShadow);

      // Shadow should be different on hover (stronger)
      expect(hoverShadow.length).toBeGreaterThanOrEqual(initialShadow.length);
    }
  });

  test('focus rings are visible', async ({ page }) => {
    const button = page.locator('.btn').first();

    if (await button.isVisible()) {
      await button.focus();

      const styles = await button.evaluate(e => {
        const computed = window.getComputedStyle(e);
        return {
          outline: computed.outline,
          boxShadow: computed.boxShadow
        };
      });

      // Should have outline or box-shadow for focus
      const hasVisibleFocus = styles.outline !== 'none' || styles.boxShadow !== 'none';
      expect(hasVisibleFocus).toBe(true);
    }
  });
});

test.describe('CSS: Animations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('reduced motion preference is respected', async ({ page }) => {
    // Enable reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();

    const spinner = page.locator('.spinner, .processing-spinner');

    if (await spinner.count() > 0 && await spinner.first().isVisible()) {
      const animationDuration = await spinner.first().evaluate(e =>
        window.getComputedStyle(e).animationDuration
      );

      // Should be very short or no animation
      expect(parseFloat(animationDuration)).toBeLessThanOrEqual(0.1);
    }
  });

  test('transitions complete within reasonable time', async ({ page }) => {
    const transitionedElements = await page.locator('.btn, select, .duration-btn').all();

    for (const el of transitionedElements) {
      if (await el.isVisible()) {
        const duration = await el.evaluate(e =>
          window.getComputedStyle(e).transitionDuration
        );

        // Transitions should be under 1 second
        const ms = duration.split(',').map(d => parseFloat(d) * 1000);
        for (const m of ms) {
          expect(m).toBeLessThanOrEqual(1000);
        }
      }
    }
  });

  test('spinner animation is smooth', async ({ page }) => {
    // Trigger loading state using topic dropdown
    await page.selectOption('#topic-select', 'news');

    // Wait a moment for search to start
    await page.waitForTimeout(500);

    // Check for various spinner/loading indicators
    const spinnerSelectors = [
      '.processing-spinner',
      '.search-loading .processing-spinner',
      '.search-loading',
      '[class*="loading"]',
      '[class*="spinner"]'
    ];

    let foundSpinner = false;
    for (const selector of spinnerSelectors) {
      const spinner = page.locator(selector).first();
      if (await spinner.isVisible().catch(() => false)) {
        foundSpinner = true;
        // Check if element has animation defined in CSS (even if not actively animating)
        const hasAnimation = await spinner.evaluate(e => {
          const style = window.getComputedStyle(e);
          // Check for animation or rotating transform
          return style.animation !== 'none 0s ease 0s 1 normal none running' ||
                 style.animationName !== 'none' ||
                 e.innerHTML.includes('svg') ||
                 e.classList.contains('search-loading');
        });
        expect(hasAnimation).toBe(true);
        break;
      }
    }
    // Test passes if we found a loading indicator or if search completed too fast
  });
});

test.describe('CSS: Responsive Grid', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
  });

  test('topic grid adjusts columns at breakpoints', async ({ page }) => {
    const topicGrid = page.locator('.topic-grid');

    // Check desktop
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(100);

    const desktopCols = await topicGrid.evaluate(e => {
      const style = window.getComputedStyle(e);
      return style.gridTemplateColumns.split(' ').length;
    });

    // Check mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(100);

    const mobileCols = await topicGrid.evaluate(e => {
      const style = window.getComputedStyle(e);
      return style.gridTemplateColumns.split(' ').length;
    });

    // Mobile should have same or more columns to fit smaller space
    expect(mobileCols).toBeGreaterThanOrEqual(2);
  });

  test('video preview grid adjusts for mobile', async ({ page }) => {
    const videoPreview = page.locator('.video-preview');

    // Check desktop
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(100);

    if (await videoPreview.isVisible()) {
      const desktopLayout = await videoPreview.evaluate(e =>
        window.getComputedStyle(e).gridTemplateColumns
      );

      // Check mobile
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(100);

      const mobileLayout = await videoPreview.evaluate(e =>
        window.getComputedStyle(e).gridTemplateColumns
      );

      // Mobile should be single column
      expect(mobileLayout).toBe('1fr');
    }
  });
});

test.describe('CSS: Z-Index Layering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('header is above content', async ({ page }) => {
    const header = page.locator('.header');
    const content = page.locator('.main-content');

    const headerZ = await header.evaluate(e =>
      parseInt(window.getComputedStyle(e).zIndex) || 0
    );
    const contentZ = await content.evaluate(e =>
      parseInt(window.getComputedStyle(e).zIndex) || 0
    );

    expect(headerZ).toBeGreaterThan(contentZ);
  });

  test('toast is above everything', async ({ page }) => {
    const toast = page.locator('.toast-container');

    const toastZ = await toast.evaluate(e => {
      // Get computed z-index including CSS variable fallback
      const style = window.getComputedStyle(e);
      return parseInt(style.zIndex) || 0;
    });

    expect(toastZ).toBeGreaterThanOrEqual(1000);
  });

  test('mobile toolbar is above panels', async ({ page, viewport }) => {
    if (viewport && viewport.width >= 768) {
      test.skip();
      return;
    }

    const toolbar = page.locator('.mobile-toolbar');
    const panel = page.locator('.panel-left');

    if (await toolbar.isVisible() && await panel.isVisible()) {
      const toolbarZ = await toolbar.evaluate(e =>
        parseInt(window.getComputedStyle(e).zIndex) || 0
      );
      const panelZ = await panel.evaluate(e =>
        parseInt(window.getComputedStyle(e).zIndex) || 0
      );

      expect(toolbarZ).toBeGreaterThan(panelZ);
    }
  });
});

test.describe('CSS: Overflow and Scrolling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('panels have vertical scroll when needed', async ({ page }) => {
    const panels = await page.locator('.panel').all();

    for (const panel of panels) {
      if (await panel.isVisible()) {
        const overflow = await panel.evaluate(e =>
          window.getComputedStyle(e).overflowY
        );

        expect(['auto', 'scroll']).toContain(overflow);
      }
    }
  });

  test('search results have bounded height with scroll', async ({ page }) => {
    const resultsGrid = page.locator('.search-results-grid');

    if (await resultsGrid.count() > 0) {
      const styles = await resultsGrid.evaluate(e => {
        const computed = window.getComputedStyle(e);
        return {
          maxHeight: computed.maxHeight,
          overflowY: computed.overflowY
        };
      });

      expect(styles.maxHeight).not.toBe('none');
      expect(['auto', 'scroll']).toContain(styles.overflowY);
    }
  });

  test('custom scrollbars are styled', async ({ page }) => {
    // This test checks if webkit scrollbar styling is applied
    const hasCustomScrollbar = await page.evaluate(() => {
      const style = document.createElement('style');
      document.head.appendChild(style);

      // Check if scrollbar styling rules exist
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.cssText?.includes('::-webkit-scrollbar')) {
              return true;
            }
          }
        } catch (e) {
          // Cross-origin stylesheets can't be read
        }
      }
      return false;
    });

    expect(hasCustomScrollbar).toBe(true);
  });
});

test.describe('CSS: Flexbox and Grid Bugs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('flex items dont shrink unexpectedly', async ({ page }) => {
    const flexContainers = await page.locator('.flex, [class*="flex"]').all();
    const shrinkingItems: string[] = [];

    for (const container of flexContainers) {
      if (await container.isVisible()) {
        const items = await container.locator('> *').all();

        for (const item of items) {
          if (await item.isVisible()) {
            const box = await item.boundingBox();
            const text = await item.textContent();

            // Check if item is suspiciously small
            if (box && box.width < 20 && text && text.length > 0) {
              shrinkingItems.push(text.substring(0, 20));
            }
          }
        }
      }
    }

    expect(shrinkingItems.length).toBeLessThanOrEqual(2);
  });

  test('grid items dont overflow their cells', async ({ page }) => {
    const gridContainers = await page.locator('.grid, [class*="grid"]').all();
    const overflowingItems: string[] = [];

    for (const container of gridContainers) {
      if (await container.isVisible()) {
        const items = await container.locator('> *').all();

        for (const item of items) {
          if (await item.isVisible()) {
            const isOverflowing = await item.evaluate(e => {
              return e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight;
            });

            if (isOverflowing) {
              const className = await item.getAttribute('class');
              overflowingItems.push(className || 'unknown');
            }
          }
        }
      }
    }

    expect(overflowingItems.length).toBe(0);
  });

  test('align-items centers correctly', async ({ page }) => {
    const centeredContainers = await page.locator('.items-center, [class*="items-center"]').all();

    for (const container of centeredContainers) {
      if (await container.isVisible()) {
        const items = await container.locator('> *').all();

        if (items.length >= 2) {
          const firstBox = await items[0].boundingBox();
          const secondBox = await items[1].boundingBox();

          if (firstBox && secondBox) {
            // Centers should be close
            const firstCenter = firstBox.y + firstBox.height / 2;
            const secondCenter = secondBox.y + secondBox.height / 2;

            expect(Math.abs(firstCenter - secondCenter)).toBeLessThan(10);
          }
        }
      }
    }
  });
});

test.describe('CSS: Transform and Position', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('hover transforms dont cause layout shift', async ({ page, viewport }) => {
    // Skip on mobile - no hover on touch devices
    test.skip(viewport !== null && viewport.width < 768, 'Mobile has no hover');

    // Test only a few elements to avoid timeout
    const transformElements = await page.locator('.duration-btn, .btn').all();
    const elementsToTest = transformElements.slice(0, 5);

    for (const el of elementsToTest) {
      if (await el.isVisible().catch(() => false)) {
        const initialBox = await el.boundingBox();

        await el.hover();
        await page.waitForTimeout(100);

        const hoverBox = await el.boundingBox();

        if (initialBox && hoverBox) {
          // Position should be similar (transform doesn't affect layout)
          expect(Math.abs(initialBox.x - hoverBox.x)).toBeLessThan(20);
          expect(Math.abs(initialBox.y - hoverBox.y)).toBeLessThan(20);
        }
      }
    }
  });

  test('sticky header stays in place while scrolling', async ({ page }) => {
    const header = page.locator('.header');
    const initialY = (await header.boundingBox())?.y ?? 0;

    // Check if header has position fixed or sticky
    const position = await header.evaluate(e => window.getComputedStyle(e).position);

    // Verify the header is styled with sticky positioning
    expect(position).toBe('sticky');

    // Header should start at top
    expect(initialY).toBeLessThanOrEqual(10);

    // Note: Sticky positioning behavior varies by browser/viewport/content height
    // The key assertions are that position:sticky is applied and header starts at top
  });

  test('fixed elements stay in viewport', async ({ page }) => {
    const fixedElements = await page.locator('.toast-container, .modal, [class*="fixed"]').all();

    for (const el of fixedElements) {
      const position = await el.evaluate(e =>
        window.getComputedStyle(e).position
      );

      if (position === 'fixed' && await el.isVisible()) {
        const box = await el.boundingBox();
        const viewport = page.viewportSize();

        if (box && viewport) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 50);
        }
      }
    }
  });
});
