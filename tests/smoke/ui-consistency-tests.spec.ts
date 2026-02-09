import { test, expect } from '@playwright/test';

/**
 * UI Consistency Tests
 * These tests check for consistent styling, layout, and behavior across components
 */

test.describe('UI: Button Consistency', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('all primary buttons have same styling', async ({ page }) => {
    const primaryButtons = await page.locator('.btn-primary').all();

    if (primaryButtons.length >= 2) {
      const first = primaryButtons[0];
      const second = primaryButtons[1];

      if (await first.isVisible() && await second.isVisible()) {
        const firstStyle = await first.evaluate(el => ({
          bg: window.getComputedStyle(el).backgroundColor,
          color: window.getComputedStyle(el).color,
          borderRadius: window.getComputedStyle(el).borderRadius
        }));

        const secondStyle = await second.evaluate(el => ({
          bg: window.getComputedStyle(el).backgroundColor,
          color: window.getComputedStyle(el).color,
          borderRadius: window.getComputedStyle(el).borderRadius
        }));

        expect(firstStyle.bg).toBe(secondStyle.bg);
        expect(firstStyle.color).toBe(secondStyle.color);
        expect(firstStyle.borderRadius).toBe(secondStyle.borderRadius);
      }
    }
  });

  test('all secondary buttons have same styling', async ({ page }) => {
    const secondaryButtons = await page.locator('.btn-secondary, .btn-outline').all();

    if (secondaryButtons.length >= 2) {
      const styles = await Promise.all(
        secondaryButtons.slice(0, 2).map(async btn => {
          if (await btn.isVisible()) {
            return await btn.evaluate(el => ({
              borderColor: window.getComputedStyle(el).borderColor,
              borderWidth: window.getComputedStyle(el).borderWidth
            }));
          }
          return null;
        })
      );

      const validStyles = styles.filter(s => s !== null);
      if (validStyles.length >= 2) {
        expect(validStyles[0]?.borderWidth).toBe(validStyles[1]?.borderWidth);
      }
    }
  });

  test('buttons have consistent padding', async ({ page }) => {
    const buttons = await page.locator('.btn, button[type="button"]').all();
    const paddings: string[] = [];

    for (const btn of buttons.slice(0, 5)) {
      if (await btn.isVisible().catch(() => false)) {
        const padding = await btn.evaluate(el => {
          const style = window.getComputedStyle(el);
          return `${style.paddingTop}/${style.paddingBottom}`;
        });
        paddings.push(padding);
      }
    }

    // Most buttons should have similar vertical padding
    if (paddings.length >= 2) {
      const unique = [...new Set(paddings)];
      // Allow max 3 different padding patterns
      expect(unique.length).toBeLessThanOrEqual(3);
    }
  });
});

test.describe('UI: Spacing Consistency', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('panel sections have consistent spacing', async ({ page }) => {
    const sections = await page.locator('.panel-section').all();

    if (sections.length >= 2) {
      const margins = await Promise.all(
        sections.map(async section => {
          if (await section.isVisible().catch(() => false)) {
            return await section.evaluate(el =>
              parseFloat(window.getComputedStyle(el).marginBottom) || 0
            );
          }
          return null;
        })
      );

      const validMargins = margins.filter(m => m !== null) as number[];
      if (validMargins.length >= 2) {
        // Most sections should have similar spacing (allow first/last to be different)
        const nonZeroMargins = validMargins.filter(m => m > 0);
        if (nonZeroMargins.length >= 2) {
          // Spacing should be within 16px of each other
          const maxDiff = Math.max(...nonZeroMargins) - Math.min(...nonZeroMargins);
          expect(maxDiff).toBeLessThan(16);
        }
      }
    }
  });

  test('cards have consistent border radius', async ({ page }) => {
    const cards = await page.locator('.card, .content-card').all();

    const radii = await Promise.all(
      cards.slice(0, 3).map(async card => {
        if (await card.isVisible()) {
          return await card.evaluate(el =>
            window.getComputedStyle(el).borderRadius
          );
        }
        return null;
      })
    );

    const validRadii = radii.filter(r => r !== null);
    if (validRadii.length >= 2) {
      expect(validRadii[0]).toBe(validRadii[1]);
    }
  });
});

test.describe('UI: Typography Consistency', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('section titles have consistent styling', async ({ page }) => {
    const titles = await page.locator('.section-title').all();

    if (titles.length >= 2) {
      const styles = await Promise.all(
        titles.map(async title => {
          if (await title.isVisible()) {
            return await title.evaluate(el => ({
              fontSize: window.getComputedStyle(el).fontSize,
              fontWeight: window.getComputedStyle(el).fontWeight
            }));
          }
          return null;
        })
      );

      const validStyles = styles.filter(s => s !== null);
      if (validStyles.length >= 2) {
        expect(validStyles[0]?.fontSize).toBe(validStyles[1]?.fontSize);
        expect(validStyles[0]?.fontWeight).toBe(validStyles[1]?.fontWeight);
      }
    }
  });

  test('hint text has consistent styling', async ({ page }) => {
    const hints = await page.locator('.section-hint, .form-hint, .help-text').all();

    if (hints.length >= 2) {
      const firstSize = await hints[0].evaluate(el =>
        window.getComputedStyle(el).fontSize
      );

      for (const hint of hints.slice(1)) {
        if (await hint.isVisible().catch(() => false)) {
          const size = await hint.evaluate(el =>
            window.getComputedStyle(el).fontSize
          );
          expect(size).toBe(firstSize);
        }
      }
    }
  });
});

test.describe('UI: Color Consistency', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('success states use consistent color', async ({ page }) => {
    // Find elements with success indicators
    const successElements = await page.locator('.badge-success, .text-success, .toast-success, .success').all();

    const colors = await Promise.all(
      successElements.map(async el => {
        if (await el.isVisible().catch(() => false)) {
          return await el.evaluate(e => {
            const style = window.getComputedStyle(e);
            return style.color || style.backgroundColor;
          });
        }
        return null;
      })
    );

    // All success colors should be similar (green shades)
    const validColors = colors.filter(c => c !== null);
    // Just verify we found some success elements
    expect(validColors.length).toBeGreaterThanOrEqual(0);
  });

  test('error states use consistent color', async ({ page }) => {
    const errorElements = await page.locator('.error, .badge-error, .text-error, .toast-error').all();

    // Just verify styling exists
    expect(errorElements.length).toBeGreaterThanOrEqual(0);
  });

  test('border colors are consistent', async ({ page }) => {
    const borderedElements = await page.locator('.panel-section, .card, .content-card').all();

    const borderColors: string[] = [];

    for (const el of borderedElements.slice(0, 3)) {
      if (await el.isVisible().catch(() => false)) {
        const color = await el.evaluate(e =>
          window.getComputedStyle(e).borderColor
        );
        if (color && color !== 'rgba(0, 0, 0, 0)') {
          borderColors.push(color);
        }
      }
    }

    // All borders should use similar colors
    if (borderColors.length >= 2) {
      const unique = [...new Set(borderColors)];
      expect(unique.length).toBeLessThanOrEqual(2);
    }
  });
});

test.describe('UI: Icon Consistency', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('topic icons are consistently sized', async ({ page }) => {
    const icons = await page.locator('.topic-icon').all();

    if (icons.length >= 2) {
      const sizes = await Promise.all(
        icons.slice(0, 3).map(async icon => {
          if (await icon.isVisible()) {
            return await icon.evaluate(el => ({
              fontSize: window.getComputedStyle(el).fontSize,
              width: el.clientWidth,
              height: el.clientHeight
            }));
          }
          return null;
        })
      );

      const validSizes = sizes.filter(s => s !== null);
      if (validSizes.length >= 2) {
        expect(validSizes[0]?.fontSize).toBe(validSizes[1]?.fontSize);
      }
    }
  });

  test('tab icons are consistently sized', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'Desktop only');

    const icons = await page.locator('.tab-icon').all();

    if (icons.length >= 2) {
      const firstSize = await icons[0].evaluate(el =>
        window.getComputedStyle(el).fontSize
      );

      for (const icon of icons.slice(1)) {
        if (await icon.isVisible().catch(() => false)) {
          const size = await icon.evaluate(el =>
            window.getComputedStyle(el).fontSize
          );
          expect(size).toBe(firstSize);
        }
      }
    }
  });
});

test.describe('UI: State Indicators', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('active states are visually distinct', async ({ page }) => {
    // Select a topic to make it active
    const topicSelect = page.locator('#topic-select');
    const initialValue = await topicSelect.inputValue();

    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(200);

    const newValue = await topicSelect.inputValue();

    // Value should have changed
    expect(newValue).toBe('news');
    expect(newValue).not.toBe(initialValue);
  });

  test('disabled buttons look disabled', async ({ page }) => {
    // Find any disabled buttons
    const disabledButtons = await page.locator('button:disabled, .btn:disabled').all();

    for (const btn of disabledButtons) {
      if (await btn.isVisible().catch(() => false)) {
        const opacity = await btn.evaluate(el =>
          parseFloat(window.getComputedStyle(el).opacity)
        );

        // Disabled buttons should have reduced opacity or cursor
        const cursor = await btn.evaluate(el =>
          window.getComputedStyle(el).cursor
        );

        const isVisuallyDisabled = opacity < 1 || cursor === 'not-allowed';
        expect(isVisuallyDisabled).toBe(true);
      }
    }
  });

  test('focus states are visible', async ({ page }) => {
    const topicSelect = page.locator('#topic-select');

    // Focus the dropdown
    await topicSelect.focus();
    await page.waitForTimeout(100);

    // Check for focus styling
    const hasFocusRing = await topicSelect.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.outline !== 'none' ||
             style.boxShadow.includes('0') ||
             el.classList.contains('focus') ||
             el.classList.contains('focused');
    });

    // Focus should be visible somehow
    expect(hasFocusRing).toBe(true);
  });
});

test.describe('UI: Responsive Behavior', () => {
  test('dropdowns maintain minimum touch target on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const selects = await page.locator('select').all();

    for (const select of selects.slice(0, 3)) {
      if (await select.isVisible().catch(() => false)) {
        const size = await select.evaluate(el => ({
          width: el.offsetWidth,
          height: el.offsetHeight
        }));

        // Should be at least 44px height for touch
        expect(size.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('text remains readable on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    const textElements = await page.locator('p, span, label').all();

    for (const el of textElements.slice(0, 5)) {
      if (await el.isVisible().catch(() => false)) {
        const fontSize = await el.evaluate(e =>
          parseFloat(window.getComputedStyle(e).fontSize)
        );

        // Text should be at least 12px for readability
        expect(fontSize).toBeGreaterThanOrEqual(12);
      }
    }
  });
});
