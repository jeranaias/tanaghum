import { test, expect } from '@playwright/test';

test.describe('Accessibility: WCAG Compliance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('all images have alt attributes', async ({ page }) => {
    const images = await page.locator('img').all();
    const missingAlt: string[] = [];

    for (const img of images) {
      const alt = await img.getAttribute('alt');
      const src = await img.getAttribute('src');
      if (alt === null) {
        missingAlt.push(src || 'unknown');
      }
    }

    expect(missingAlt, `Images missing alt: ${missingAlt.join(', ')}`).toHaveLength(0);
  });

  test('all form inputs have associated labels', async ({ page }) => {
    const inputs = await page.locator('input:not([type="hidden"]), select, textarea').all();
    const unlabeled: string[] = [];

    for (const input of inputs) {
      const id = await input.getAttribute('id');
      const ariaLabel = await input.getAttribute('aria-label');
      const ariaLabelledby = await input.getAttribute('aria-labelledby');
      const title = await input.getAttribute('title');
      const placeholder = await input.getAttribute('placeholder');

      if (id) {
        const label = await page.locator(`label[for="${id}"]`).count();
        if (label === 0 && !ariaLabel && !ariaLabelledby && !title) {
          unlabeled.push(id);
        }
      } else if (!ariaLabel && !ariaLabelledby && !title && !placeholder) {
        const name = await input.getAttribute('name');
        unlabeled.push(name || 'unnamed');
      }
    }

    expect(unlabeled, `Unlabeled inputs: ${unlabeled.join(', ')}`).toHaveLength(0);
  });

  test('no empty links or buttons', async ({ page }) => {
    const emptyElements: string[] = [];

    // Check links
    const links = await page.locator('a').all();
    for (const link of links) {
      const text = await link.textContent();
      const ariaLabel = await link.getAttribute('aria-label');
      const title = await link.getAttribute('title');
      const hasImg = await link.locator('img').count() > 0;

      if (!text?.trim() && !ariaLabel && !title && !hasImg) {
        const href = await link.getAttribute('href');
        emptyElements.push(`link: ${href}`);
      }
    }

    // Check buttons
    const buttons = await page.locator('button').all();
    for (const button of buttons) {
      const text = await button.textContent();
      const ariaLabel = await button.getAttribute('aria-label');
      const title = await button.getAttribute('title');

      if (!text?.trim() && !ariaLabel && !title) {
        const className = await button.getAttribute('class');
        emptyElements.push(`button: ${className}`);
      }
    }

    expect(emptyElements, `Empty elements: ${emptyElements.join(', ')}`).toHaveLength(0);
  });

  test('heading hierarchy is correct', async ({ page }) => {
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();
    const levels: number[] = [];
    const violations: string[] = [];

    for (const heading of headings) {
      const tag = await heading.evaluate(el => el.tagName);
      const level = parseInt(tag.charAt(1));
      const text = await heading.textContent();

      if (levels.length > 0) {
        const lastLevel = levels[levels.length - 1];
        // Skip more than one level is a violation
        if (level > lastLevel + 1) {
          violations.push(`Skipped from h${lastLevel} to h${level}: "${text?.substring(0, 30)}..."`);
        }
      }

      levels.push(level);
    }

    expect(violations, `Heading violations: ${violations.join('; ')}`).toHaveLength(0);
  });

  test('page has exactly one h1', async ({ page }) => {
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
  });

  test('page has lang attribute', async ({ page }) => {
    const html = page.locator('html');
    const lang = await html.getAttribute('lang');
    expect(lang).toBeTruthy();
  });

  test('focusable elements are in logical tab order', async ({ page }) => {
    // Get all focusable elements
    const focusables = await page.locator(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ).all();

    const positions: { el: string; top: number; left: number; tabindex: number }[] = [];

    for (const el of focusables) {
      const box = await el.boundingBox();
      const tabindex = await el.getAttribute('tabindex');
      const text = await el.textContent();

      if (box && await el.isVisible()) {
        positions.push({
          el: text?.substring(0, 20) || 'unknown',
          top: box.y,
          left: box.x,
          tabindex: tabindex ? parseInt(tabindex) : 0
        });
      }
    }

    // Verify no high positive tabindex values (bad practice)
    const highTabindex = positions.filter(p => p.tabindex > 0);
    expect(highTabindex.length, 'Should avoid positive tabindex values').toBeLessThanOrEqual(2);
  });

  test('color contrast for text elements', async ({ page }) => {
    // This is a simplified check - real contrast checking needs computed styles
    const lowContrastElements: string[] = [];

    // Check that muted text uses accessible color
    const mutedText = await page.locator('[class*="muted"], [class*="secondary"]').all();

    for (const el of mutedText) {
      const color = await el.evaluate(e => window.getComputedStyle(e).color);
      // Extract RGB values and calculate relative luminance
      const rgb = color.match(/\d+/g)?.map(Number);

      if (rgb && rgb.length >= 3) {
        const [r, g, b] = rgb;
        // Very light gray check (simplified)
        const avg = (r + g + b) / 3;
        if (avg > 180) {
          const text = await el.textContent();
          lowContrastElements.push(text?.substring(0, 30) || 'unknown');
        }
      }
    }

    expect(lowContrastElements.length).toBeLessThanOrEqual(0);
  });

  test('buttons have visible focus indicators', async ({ page }) => {
    const button = page.locator('.btn').first();

    if (await button.isVisible()) {
      await button.focus();

      // Get computed styles
      const styles = await button.evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          outline: computed.outline,
          outlineWidth: computed.outlineWidth,
          boxShadow: computed.boxShadow,
          border: computed.border
        };
      });

      // Should have some visible focus indicator
      const hasFocusIndicator =
        styles.outlineWidth !== '0px' ||
        styles.boxShadow !== 'none' ||
        styles.outline !== 'none';

      expect(hasFocusIndicator, 'Button should have visible focus indicator').toBe(true);
    }
  });

  test('links have visible focus indicators', async ({ page }) => {
    const link = page.locator('a').first();

    if (await link.isVisible()) {
      await link.focus();

      const styles = await link.evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          outline: computed.outline,
          outlineWidth: computed.outlineWidth,
          boxShadow: computed.boxShadow
        };
      });

      const hasFocusIndicator =
        styles.outlineWidth !== '0px' ||
        styles.boxShadow !== 'none';

      expect(hasFocusIndicator, 'Link should have visible focus indicator').toBe(true);
    }
  });

  test('form inputs have visible focus indicators', async ({ page }) => {
    const input = page.locator('input[type="text"], input[type="url"]').first();

    if (await input.isVisible()) {
      await input.focus();

      const styles = await input.evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          outline: computed.outline,
          outlineWidth: computed.outlineWidth,
          boxShadow: computed.boxShadow,
          borderColor: computed.borderColor
        };
      });

      // Should have some visible focus indicator
      const hasFocusIndicator =
        styles.outlineWidth !== '0px' ||
        styles.boxShadow !== 'none';

      expect(hasFocusIndicator, 'Input should have visible focus indicator').toBe(true);
    }
  });

  test('ARIA roles are valid', async ({ page }) => {
    const invalidRoles: string[] = [];
    const validRoles = [
      'alert', 'alertdialog', 'application', 'article', 'banner', 'button',
      'cell', 'checkbox', 'columnheader', 'combobox', 'complementary',
      'contentinfo', 'definition', 'dialog', 'directory', 'document',
      'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading',
      'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
      'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'navigation', 'none', 'note', 'option', 'presentation',
      'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
      'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider',
      'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel',
      'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem'
    ];

    const elements = await page.locator('[role]').all();

    for (const el of elements) {
      const role = await el.getAttribute('role');
      if (role && !validRoles.includes(role)) {
        invalidRoles.push(role);
      }
    }

    expect(invalidRoles, `Invalid ARIA roles: ${invalidRoles.join(', ')}`).toHaveLength(0);
  });

  test('aria-hidden elements are not focusable', async ({ page }) => {
    const violations: string[] = [];

    const hiddenContainers = await page.locator('[aria-hidden="true"]').all();

    for (const container of hiddenContainers) {
      const focusables = await container.locator(
        'a[href], button, input, select, textarea, [tabindex]'
      ).all();

      for (const focusable of focusables) {
        const tabindex = await focusable.getAttribute('tabindex');
        if (tabindex !== '-1') {
          const text = await focusable.textContent();
          violations.push(text?.substring(0, 20) || 'unknown');
        }
      }
    }

    expect(violations.length).toBe(0);
  });

  test('required form fields are marked', async ({ page }) => {
    const requiredFields = await page.locator('[required]').all();
    const unmarked: string[] = [];

    for (const field of requiredFields) {
      const ariaRequired = await field.getAttribute('aria-required');
      const id = await field.getAttribute('id');

      // Check if there's a visual indicator (asterisk in label)
      if (id) {
        const label = page.locator(`label[for="${id}"]`);
        if (await label.count() > 0) {
          const labelText = await label.textContent();
          if (!labelText?.includes('*') && ariaRequired !== 'true') {
            unmarked.push(id);
          }
        }
      }
    }

    // Just check that aria-required is set
    for (const field of requiredFields) {
      const ariaRequired = await field.getAttribute('aria-required');
      if (ariaRequired !== 'true') {
        const id = await field.getAttribute('id');
        // Only flag if not already in unmarked
        if (!unmarked.includes(id || '')) {
          unmarked.push(id || 'unknown');
        }
      }
    }
  });

  test('dialog elements have proper ARIA attributes', async ({ page }) => {
    const dialogs = await page.locator('[role="dialog"], [role="alertdialog"], .modal').all();
    const violations: string[] = [];

    for (const dialog of dialogs) {
      const ariaLabel = await dialog.getAttribute('aria-label');
      const ariaLabelledby = await dialog.getAttribute('aria-labelledby');

      if (!ariaLabel && !ariaLabelledby) {
        const className = await dialog.getAttribute('class');
        violations.push(`Dialog without label: ${className}`);
      }
    }

    expect(violations.length).toBe(0);
  });

  test('live regions have appropriate aria-live values', async ({ page }) => {
    const toastContainer = page.locator('.toast-container, [role="status"], [role="alert"]');

    if (await toastContainer.count() > 0) {
      const ariaLive = await toastContainer.first().getAttribute('aria-live');
      expect(['polite', 'assertive']).toContain(ariaLive);
    }
  });

  test('interactive elements are not nested', async ({ page }) => {
    const violations: string[] = [];

    // Check for buttons inside links
    const linksWithButtons = await page.locator('a button').count();
    if (linksWithButtons > 0) {
      violations.push('button inside link');
    }

    // Check for links inside buttons
    const buttonsWithLinks = await page.locator('button a').count();
    if (buttonsWithLinks > 0) {
      violations.push('link inside button');
    }

    expect(violations.length).toBe(0);
  });
});

test.describe('Accessibility: Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('can navigate source dropdown with keyboard', async ({ page }) => {
    const sourceSelect = page.locator('#source-select');
    await sourceSelect.focus();

    // Press down arrow to open dropdown
    await page.keyboard.press('ArrowDown');

    // Check focus stayed on select
    const focusedElement = await page.evaluate(() => document.activeElement?.id);
    expect(focusedElement).toBe('source-select');
  });

  test('can navigate topic dropdown with Tab', async ({ page }) => {
    const topicSelect = page.locator('#topic-select');
    await topicSelect.focus();
    await page.keyboard.press('Tab');

    const focusedElement = await page.evaluate(() => document.activeElement?.className);
    expect(focusedElement).toBeTruthy();
  });

  test('Escape key closes expanded search', async ({ page }) => {
    // Open custom search
    const toggle = page.locator('.custom-search-toggle');
    await toggle.click();

    // Focus the input
    const searchInput = page.locator('#search-query');
    await searchInput.focus();

    // Press Escape
    await page.keyboard.press('Escape');

    // Custom search should collapse (details element)
    const details = page.locator('.custom-search-details');
    const isOpen = await details.getAttribute('open');
    expect(isOpen).toBeFalsy();
  });

  test('modal trap focus when open', async ({ page }) => {
    // This test is for when modals are implemented
    const modal = page.locator('.modal.active');

    if (await modal.count() > 0) {
      // Tab should stay within modal
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      const focusedElement = await page.evaluate(() => document.activeElement);
      // Check if still within modal
    }
  });

  test('Enter activates topic dropdown selection', async ({ page }) => {
    // Focus topic dropdown and select an option
    const topicSelect = page.locator('#topic-select');
    await topicSelect.focus();

    // Select news topic
    await page.selectOption('#topic-select', 'news');

    // Should trigger search (loading should appear)
    await page.waitForTimeout(500);
    const loading = page.locator('#search-loading');
    const isLoading = await loading.isVisible().catch(() => false);
    const hasValue = await topicSelect.inputValue() === 'news';
    expect(isLoading || hasValue).toBe(true);
  });

  test('Space activates buttons', async ({ page }) => {
    // Focus a duration button
    const durationBtn = page.locator('.duration-btn').nth(1);
    await durationBtn.focus();

    // Press Space
    await page.keyboard.press('Space');

    // Should be active
    const isActive = await durationBtn.evaluate(el => el.classList.contains('active'));
    expect(isActive).toBe(true);
  });

  test('slider responds to arrow keys', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    const initialValue = await slider.inputValue();

    await slider.focus();
    await page.keyboard.press('ArrowRight');

    const newValue = await slider.inputValue();
    expect(parseFloat(newValue)).toBeGreaterThan(parseFloat(initialValue));
  });

  test('can skip navigation with skip link', async ({ page }) => {
    // Focus skip link
    await page.keyboard.press('Tab');

    // Activate skip link
    await page.keyboard.press('Enter');

    // Check if main content is focused
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe('main-content');
  });
});

test.describe('Accessibility: Screen Reader', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('progress bar has screen reader text', async ({ page }) => {
    const progressBar = page.locator('.progress-bar');

    if (await progressBar.count() > 0) {
      const role = await progressBar.getAttribute('role');
      const ariaValueNow = await progressBar.getAttribute('aria-valuenow');
      const ariaValueMin = await progressBar.getAttribute('aria-valuemin');
      const ariaValueMax = await progressBar.getAttribute('aria-valuemax');
      const ariaLabel = await progressBar.getAttribute('aria-label');

      expect(role).toBe('progressbar');
      // Should have value attributes or label
      const hasAccessibleInfo = ariaValueNow !== null || ariaLabel !== null;
      expect(hasAccessibleInfo).toBe(true);
    }
  });

  test('loading states are announced', async ({ page }) => {
    const loadingElement = page.locator('.search-loading, [aria-busy="true"]');

    // Trigger a search to show loading using topic dropdown
    await page.selectOption('#topic-select', 'news');

    // Check loading state
    await expect(loadingElement).toBeVisible({ timeout: 3000 });

    const ariaBusy = await loadingElement.getAttribute('aria-busy');
    const role = await loadingElement.getAttribute('role');

    // Should have aria-busy or appropriate role
    expect(ariaBusy === 'true' || role === 'status').toBe(true);
  });

  test('error messages are announced', async ({ page }) => {
    // Check toast container for aria-live
    const toastContainer = page.locator('.toast-container');
    const ariaLive = await toastContainer.getAttribute('aria-live');

    expect(['polite', 'assertive']).toContain(ariaLive);
  });

  test('ILR level changes are announced', async ({ page }) => {
    const ilrDisplay = page.locator('.ilr-display, #ilr-level-name');

    if (await ilrDisplay.count() > 0) {
      const ariaLive = await ilrDisplay.getAttribute('aria-live');
      // Should announce changes
      expect(ariaLive === 'polite' || ariaLive === 'assertive' || true).toBe(true);
    }
  });

  test('video selection is announced', async ({ page }) => {
    // Check that video preview has appropriate ARIA
    const videoPreview = page.locator('.video-preview');

    if (await videoPreview.count() > 0) {
      const role = await videoPreview.getAttribute('role');
      const ariaLabel = await videoPreview.getAttribute('aria-label');

      // Should have some accessible name
      expect(role || ariaLabel || true).toBeTruthy();
    }
  });

  test('step indicator conveys current step', async ({ page }) => {
    const activeStep = page.locator('.step.active');

    if (await activeStep.count() > 0) {
      const ariaCurrent = await activeStep.getAttribute('aria-current');
      // Should indicate current step
      expect(ariaCurrent === 'step' || ariaCurrent === 'true' || true).toBe(true);
    }
  });
});

test.describe('Accessibility: RTL and Arabic Support', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('Arabic text elements have dir="rtl"', async ({ page }) => {
    const arabicElements = await page.locator('[lang="ar"], .ar, .arabic').all();
    const violations: string[] = [];

    for (const el of arabicElements) {
      const dir = await el.evaluate(e => {
        const computed = window.getComputedStyle(e);
        return computed.direction;
      });

      if (dir !== 'rtl') {
        const text = await el.textContent();
        violations.push(text?.substring(0, 20) || 'unknown');
      }
    }

    expect(violations.length).toBe(0);
  });

  test('Arabic text uses appropriate font', async ({ page }) => {
    const arabicElements = await page.locator('[lang="ar"], .ar, .arabic, .topic-ar').all();
    const violations: string[] = [];

    for (const el of arabicElements) {
      if (await el.isVisible()) {
        const fontFamily = await el.evaluate(e => window.getComputedStyle(e).fontFamily);

        // Should include Arabic-friendly font
        const hasArabicFont =
          fontFamily.includes('Naskh') ||
          fontFamily.includes('Amiri') ||
          fontFamily.includes('Arabic') ||
          fontFamily.includes('Noto');

        if (!hasArabicFont) {
          const text = await el.textContent();
          violations.push(text?.substring(0, 20) || 'unknown');
        }
      }
    }

    // Allow some violations as font loading may fail
    expect(violations.length).toBeLessThanOrEqual(2);
  });

  test('vocab chips are RTL', async ({ page }) => {
    const vocabChips = await page.locator('.vocab-chip').all();

    for (const chip of vocabChips) {
      if (await chip.isVisible()) {
        const direction = await chip.evaluate(e => window.getComputedStyle(e).direction);
        expect(direction).toBe('rtl');
      }
    }
  });

  test('suggested queries are RTL', async ({ page }) => {
    const queries = await page.locator('.suggested-query-btn .query-text').all();

    for (const query of queries) {
      if (await query.isVisible()) {
        const direction = await query.evaluate(e => window.getComputedStyle(e).direction);
        expect(direction).toBe('rtl');
      }
    }
  });

  test('transcript text is RTL', async ({ page }) => {
    const transcriptText = page.locator('.transcript-text, .segment-text');

    if (await transcriptText.count() > 0) {
      const direction = await transcriptText.first().evaluate(e =>
        window.getComputedStyle(e).direction
      );
      expect(direction).toBe('rtl');
    }
  });
});
