import { test, expect, Page } from '@playwright/test';

/**
 * Tanaghum Generator - Comprehensive Smoke Tests
 * Complete end-to-end testing of all features and user flows
 */

// ============================================================================
// SECTION 1: PAGE LOAD & STRUCTURE
// ============================================================================

test.describe('Page Structure & Initial Load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') && !e.includes('net::') && !e.includes('404')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('has correct page title', async ({ page }) => {
    await expect(page).toHaveTitle(/Generate Lesson.*Tanaghum/);
  });

  test('header navigation is present and functional', async ({ page }) => {
    const header = page.locator('.header');
    await expect(header).toBeVisible();

    // Logo link
    const logo = page.locator('.logo');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('href', 'index.html');

    // Navigation links
    const navLinks = page.locator('.nav-link');
    await expect(navLinks).toHaveCount(4);

    // Active state on Generate link
    const activeLink = page.locator('.nav-link.active');
    await expect(activeLink).toHaveText('Generate');
    await expect(activeLink).toHaveAttribute('aria-current', 'page');
  });

  test('skip navigation link is present', async ({ page }) => {
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toHaveAttribute('href', '#main-content');
  });

  test('main content area has correct ID for skip link', async ({ page }) => {
    const main = page.locator('#main-content');
    await expect(main).toBeVisible();
  });

  test('step indicator shows 4 steps', async ({ page }) => {
    const steps = page.locator('.step-indicator .step');
    await expect(steps).toHaveCount(4);

    // First step is active
    const firstStep = page.locator('.step[data-step="1"]');
    await expect(firstStep).toHaveClass(/active/);
  });

  test('toast container exists for notifications', async ({ page }) => {
    const toastContainer = page.locator('#toast-container');
    await expect(toastContainer).toBeAttached();
  });
});

// ============================================================================
// SECTION 2: DESKTOP THREE-PANEL LAYOUT
// ============================================================================

test.describe('Desktop Three-Panel Layout', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('all three panels are visible', async ({ page }) => {
    await expect(page.locator('#config-panel')).toBeVisible();
    await expect(page.locator('.main-content')).toBeVisible();
    await expect(page.locator('.panel-right')).toBeVisible();
  });

  test('panels are laid out horizontally without overlap', async ({ page }) => {
    const left = await page.locator('#config-panel').boundingBox();
    const main = await page.locator('.main-content').boundingBox();
    const right = await page.locator('.panel-right').boundingBox();

    expect(left!.x + left!.width).toBeLessThanOrEqual(main!.x + 5);
    expect(main!.x + main!.width).toBeLessThanOrEqual(right!.x + 5);
  });

  test('no horizontal scrolling on any viewport size', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });

  test('mobile toolbar is hidden on desktop', async ({ page }) => {
    const toolbar = page.locator('.mobile-toolbar');
    await expect(toolbar).not.toBeVisible();
  });
});

// ============================================================================
// SECTION 3: SOURCE TAB SWITCHING
// ============================================================================

test.describe('Content Source Dropdown', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('source dropdown is visible with correct options', async ({ page }) => {
    const sourceSelect = page.locator('#source-select');
    await expect(sourceSelect).toBeVisible();

    // Check options
    const options = sourceSelect.locator('option');
    await expect(options).toHaveCount(3);

    await expect(options.nth(0)).toHaveText(/Find Videos/);
    await expect(options.nth(1)).toHaveText(/YouTube URL/);
    await expect(options.nth(2)).toHaveText(/Upload Audio/);
  });

  test('Find Videos (search) is selected by default', async ({ page }) => {
    const sourceSelect = page.locator('#source-select');
    await expect(sourceSelect).toHaveValue('search');

    const searchPanel = page.locator('#source-search');
    await expect(searchPanel).toBeVisible();
  });

  test('selecting YouTube URL switches content', async ({ page }) => {
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(300);

    // Verify YouTube panel is shown
    const youtubePanel = page.locator('#source-youtube');
    await expect(youtubePanel).toBeVisible();

    // Verify search panel is hidden
    const searchPanel = page.locator('#source-search');
    await expect(searchPanel).toHaveClass(/hidden/);
  });

  test('selecting Upload Audio switches content', async ({ page }) => {
    await page.selectOption('#source-select', 'upload');
    await page.waitForTimeout(300);

    const uploadPanel = page.locator('#source-upload');
    await expect(uploadPanel).toBeVisible();
  });
});

// ============================================================================
// SECTION 4: TOPIC SELECTION & SEARCH
// ============================================================================

test.describe('Topic Selection Dropdown', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('topic dropdown is visible with correct options', async ({ page }) => {
    const topicSelect = page.locator('#topic-select');
    await expect(topicSelect).toBeVisible();

    // Check for expected options
    const options = topicSelect.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(8); // At least 8 topics + empty default
  });

  test('topic dropdown has expected topic values', async ({ page }) => {
    const topicSelect = page.locator('#topic-select');
    const topics = ['news', 'politics', 'economy', 'culture', 'sports', 'science', 'religion', 'history'];

    for (const topic of topics) {
      const option = topicSelect.locator(`option[value="${topic}"]`);
      await expect(option).toBeAttached();
    }
  });

  test('selecting topic triggers search', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');

    // Should show loading state
    const loading = page.locator('#search-loading');
    await expect(loading).toBeVisible({ timeout: 2000 });

    // Wait for results or timeout
    await page.waitForTimeout(5000);
  });

  test('selecting different topic updates dropdown value', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');
    await expect(page.locator('#topic-select')).toHaveValue('news');

    await page.waitForTimeout(500);
    await page.selectOption('#topic-select', 'politics');
    await expect(page.locator('#topic-select')).toHaveValue('politics');
  });
});

// ============================================================================
// SECTION 5: DURATION FILTER
// ============================================================================

test.describe('Duration Filter', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('duration filter is visible', async ({ page }) => {
    const durationFilter = page.locator('.duration-filter');
    await expect(durationFilter).toBeVisible();
  });

  test('has 5 duration options', async ({ page }) => {
    const durationBtns = page.locator('.duration-btn');
    await expect(durationBtns).toHaveCount(5);
  });

  test('"Any" is selected by default', async ({ page }) => {
    const anyBtn = page.locator('.duration-btn[data-min="0"][data-max="0"]');
    await expect(anyBtn).toHaveClass(/active/);
  });

  test('clicking duration button changes selection', async ({ page }) => {
    const shortBtn = page.locator('.duration-btn[data-max="60"]');
    await shortBtn.click();

    await expect(shortBtn).toHaveClass(/active/);

    const anyBtn = page.locator('.duration-btn[data-min="0"][data-max="0"]');
    await expect(anyBtn).not.toHaveClass(/active/);
  });

  test('duration filter has correct data attributes', async ({ page }) => {
    // Check all duration ranges
    await expect(page.locator('.duration-btn[data-min="0"][data-max="0"]')).toBeVisible(); // Any
    await expect(page.locator('.duration-btn[data-min="0"][data-max="60"]')).toBeVisible(); // <1 min
    await expect(page.locator('.duration-btn[data-min="60"][data-max="300"]')).toBeVisible(); // 1-5 min
    await expect(page.locator('.duration-btn[data-min="300"][data-max="900"]')).toBeVisible(); // 5-15 min
    await expect(page.locator('.duration-btn[data-min="900"][data-max="0"]')).toBeVisible(); // >15 min
  });
});

// ============================================================================
// SECTION 6: CUSTOM SEARCH
// ============================================================================

test.describe('Custom Search', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('custom search is collapsed by default', async ({ page }) => {
    const searchInput = page.locator('#search-query');
    await expect(searchInput).not.toBeVisible();
  });

  test('clicking toggle expands custom search', async ({ page }) => {
    const toggle = page.locator('.custom-search-toggle');
    await toggle.click();

    const searchInput = page.locator('#search-query');
    await expect(searchInput).toBeVisible();

    const searchBtn = page.locator('#search-btn');
    await expect(searchBtn).toBeVisible();
  });

  test('can type in search input', async ({ page }) => {
    await page.locator('.custom-search-toggle').click();

    const searchInput = page.locator('#search-query');
    await searchInput.fill('Arabic news test');

    await expect(searchInput).toHaveValue('Arabic news test');
  });

  test('search button triggers search', async ({ page }) => {
    await page.locator('.custom-search-toggle').click();

    const searchInput = page.locator('#search-query');
    await searchInput.fill('الجزيرة');

    const searchBtn = page.locator('#search-btn');
    await searchBtn.click();

    // Should show loading
    const loading = page.locator('#search-loading');
    await expect(loading).toBeVisible({ timeout: 2000 });
  });

  test('Enter key triggers search', async ({ page }) => {
    await page.locator('.custom-search-toggle').click();

    const searchInput = page.locator('#search-query');
    await searchInput.fill('Arabic');
    await searchInput.press('Enter');

    const loading = page.locator('#search-loading');
    await expect(loading).toBeVisible({ timeout: 2000 });
  });
});

// ============================================================================
// SECTION 7: SEARCH RESULTS
// ============================================================================

test.describe('Search Results Display', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('search results container is hidden initially', async ({ page }) => {
    const results = page.locator('#search-results');
    await expect(results).toHaveClass(/hidden/);
  });

  test('search loading shows spinner and stop button', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');

    const loading = page.locator('#search-loading');
    await expect(loading).toBeVisible({ timeout: 2000 });

    const spinner = loading.locator('.processing-spinner');
    await expect(spinner).toBeVisible();

    const stopBtn = page.locator('#stop-search-btn');
    await expect(stopBtn).toBeVisible();
  });

  test('clear search button clears results', async ({ page }) => {
    // First trigger a search
    await page.selectOption('#topic-select', 'news');

    // Wait for results to appear
    await page.waitForTimeout(5000);

    const results = page.locator('#search-results');
    if (await results.isVisible()) {
      const clearBtn = page.locator('#clear-search');
      await clearBtn.click();

      await expect(results).toHaveClass(/hidden/);
    }
  });
});

// ============================================================================
// SECTION 8: YOUTUBE URL INPUT
// ============================================================================

test.describe('YouTube URL Input', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // Switch to YouTube source
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(300);
  });

  test('YouTube URL input is visible', async ({ page }) => {
    const urlInput = page.locator('#youtube-url');
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveAttribute('type', 'url');
  });

  test('has helpful placeholder text', async ({ page }) => {
    const urlInput = page.locator('#youtube-url');
    const placeholder = await urlInput.getAttribute('placeholder');
    expect(placeholder).toContain('youtube');
  });

  test('shows hint text', async ({ page }) => {
    const hint = page.locator('#youtube-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Arabic video');
  });

  test('accepts valid YouTube URL formats', async ({ page }) => {
    const urlInput = page.locator('#youtube-url');

    // Standard watch URL
    await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await expect(urlInput).toHaveValue('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // Short URL
    await urlInput.clear();
    await urlInput.fill('https://youtu.be/dQw4w9WgXcQ');
    await expect(urlInput).toHaveValue('https://youtu.be/dQw4w9WgXcQ');
  });
});

// ============================================================================
// SECTION 9: FILE UPLOAD
// ============================================================================

test.describe('File Upload', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // Switch to Upload source
    await page.selectOption('#source-select', 'upload');
    await page.waitForTimeout(300);
  });

  test('drop zone is visible', async ({ page }) => {
    const dropZone = page.locator('#drop-zone');
    await expect(dropZone).toBeVisible();
  });

  test('drop zone has correct ARIA attributes', async ({ page }) => {
    const dropZone = page.locator('#drop-zone');
    await expect(dropZone).toHaveAttribute('role', 'button');
    await expect(dropZone).toHaveAttribute('tabindex', '0');
  });

  test('file input is hidden', async ({ page }) => {
    const fileInput = page.locator('#file-input');
    await expect(fileInput).toBeHidden();
  });

  test('file input accepts audio files', async ({ page }) => {
    const fileInput = page.locator('#file-input');
    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('audio');
  });

  test('file preview is hidden initially', async ({ page }) => {
    const filePreview = page.locator('#file-preview');
    await expect(filePreview).toHaveClass(/hidden/);
  });
});

// ============================================================================
// SECTION 10: ILR SLIDER
// ============================================================================

test.describe('ILR Level Slider', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('ILR slider is visible', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    await expect(slider).toBeVisible();
  });

  test('slider has correct range', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    await expect(slider).toHaveAttribute('min', '1');
    await expect(slider).toHaveAttribute('max', '3.5');
    await expect(slider).toHaveAttribute('step', '0.5');
  });

  test('default value is 2.0', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    await expect(slider).toHaveValue('2');

    const display = page.locator('#ilr-value');
    await expect(display).toHaveText('2.0');
  });

  test('moving slider updates display', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    await slider.fill('3');

    const display = page.locator('#ilr-value');
    await expect(display).toHaveText('3.0');
  });

  test('slider updates level name', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    await slider.fill('3');

    const name = page.locator('#ilr-name');
    await expect(name).toContainText('Professional');
  });

  test('slider updates level description', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    await slider.fill('1');

    const desc = page.locator('#ilr-desc');
    await expect(desc).toBeVisible();
  });

  test('slider has ARIA value attributes', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    await expect(slider).toHaveAttribute('aria-valuemin', '1');
    await expect(slider).toHaveAttribute('aria-valuemax', '3.5');
  });
});

// ============================================================================
// SECTION 11: VIDEO PREVIEW
// ============================================================================

test.describe('Video Preview Card', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('video preview is hidden initially', async ({ page }) => {
    const preview = page.locator('#video-preview');
    await expect(preview).not.toBeVisible();
  });

  test('input state shows placeholder', async ({ page }) => {
    const inputState = page.locator('#input-state');
    await expect(inputState).toBeVisible();
    await expect(inputState).toContainText('Create a New Lesson');
  });

  test('preview has generate and change buttons', async ({ page }) => {
    // These should exist but be hidden until video is selected
    const generateBtn = page.locator('#preview-generate-btn');
    const changeBtn = page.locator('#preview-change-btn');

    await expect(generateBtn).toBeAttached();
    await expect(changeBtn).toBeAttached();
  });
});

// ============================================================================
// SECTION 12: PROCESSING STATE
// ============================================================================

test.describe('Processing State UI', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('processing state is hidden initially', async ({ page }) => {
    const processing = page.locator('#processing-state');
    await expect(processing).not.toBeVisible();
  });

  test('processing state has all step indicators', async ({ page }) => {
    const steps = page.locator('.processing-step');
    // These exist in DOM but processing state is hidden
    await expect(steps).toHaveCount(5);
  });

  test('processing steps have correct data attributes', async ({ page }) => {
    const stepNames = ['fetch', 'transcribe', 'analyze', 'questions', 'assemble'];
    for (const step of stepNames) {
      const stepEl = page.locator(`.processing-step[data-step="${step}"]`);
      await expect(stepEl).toBeAttached();
    }
  });

  test('progress bar exists', async ({ page }) => {
    const progressBar = page.locator('.progress-bar');
    await expect(progressBar).toBeAttached();
    await expect(progressBar).toHaveAttribute('role', 'progressbar');

    const progressFill = page.locator('#progress-fill');
    await expect(progressFill).toBeAttached();
  });
});

// ============================================================================
// SECTION 13: REVIEW STATE
// ============================================================================

test.describe('Review State UI', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('review state is hidden initially', async ({ page }) => {
    const review = page.locator('#review-state');
    await expect(review).not.toBeVisible();
  });

  test('analysis grid has 4 cards', async ({ page }) => {
    const cards = page.locator('.analysis-card');
    await expect(cards).toHaveCount(4);
  });

  test('transcript preview container exists', async ({ page }) => {
    const transcript = page.locator('#transcript-preview');
    await expect(transcript).toBeAttached();
  });

  test('question sections exist', async ({ page }) => {
    await expect(page.locator('#pre-questions')).toBeAttached();
    await expect(page.locator('#while-questions')).toBeAttached();
    await expect(page.locator('#post-questions')).toBeAttached();
  });

  test('question count badges exist', async ({ page }) => {
    await expect(page.locator('#pre-count')).toBeAttached();
    await expect(page.locator('#while-count')).toBeAttached();
    await expect(page.locator('#post-count')).toBeAttached();
  });
});

// ============================================================================
// SECTION 14: ACTION BAR
// ============================================================================

test.describe('Action Bar', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('action bar is visible', async ({ page }) => {
    const actionBar = page.locator('#action-bar');
    await expect(actionBar).toBeVisible();
  });

  test('action bar has toolbar role', async ({ page }) => {
    const actionBar = page.locator('#action-bar');
    await expect(actionBar).toHaveAttribute('role', 'toolbar');
  });

  test('back button exists and is disabled initially', async ({ page }) => {
    const backBtn = page.locator('#back-btn');
    await expect(backBtn).toBeVisible();
    await expect(backBtn).toBeDisabled();
  });

  test('preview button exists and is disabled initially', async ({ page }) => {
    const previewBtn = page.locator('#preview-btn');
    await expect(previewBtn).toBeVisible();
    await expect(previewBtn).toBeDisabled();
  });

  test('export button exists and is disabled initially', async ({ page }) => {
    const exportBtn = page.locator('#export-btn');
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toBeDisabled();
  });
});

// ============================================================================
// SECTION 15: RIGHT PANEL - STATUS
// ============================================================================

test.describe('Status Panel (Right)', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('status panel is visible', async ({ page }) => {
    const panel = page.locator('.panel-right');
    await expect(panel).toBeVisible();
  });

  test('LLM quota section exists', async ({ page }) => {
    const quotaSection = page.locator('.panel-right').getByText('LLM Quota');
    await expect(quotaSection).toBeVisible();
  });

  test('shows provider status cards', async ({ page }) => {
    const statusCards = page.locator('.panel-right .status-card');
    const count = await statusCards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('tips card is visible', async ({ page }) => {
    const tips = page.locator('.tips-card');
    await expect(tips).toBeVisible();
  });

  test('About ILR section exists', async ({ page }) => {
    const aboutIlr = page.locator('.panel-right').getByText('About ILR Levels');
    await expect(aboutIlr).toBeVisible();
  });
});

// ============================================================================
// SECTION 16: MOBILE LAYOUT
// ============================================================================

test.describe('Mobile Layout', () => {
  test.skip(({ viewport }) => viewport!.width > 768, 'Mobile only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('mobile toolbar is visible', async ({ page }) => {
    const toolbar = page.locator('.mobile-toolbar');
    await expect(toolbar).toBeVisible();
  });

  test('mobile toolbar has 3 buttons', async ({ page }) => {
    const buttons = page.locator('.mobile-toolbar-btn');
    await expect(buttons).toHaveCount(3);
  });

  test('config button is active by default', async ({ page }) => {
    const configBtn = page.locator('.mobile-toolbar-btn[data-panel="config"]');
    await expect(configBtn).toHaveClass(/active/);
  });

  test('toolbar has tablist role', async ({ page }) => {
    const toolbar = page.locator('.mobile-toolbar');
    await expect(toolbar).toHaveAttribute('role', 'tablist');
  });

  test('clicking Content button shows main content', async ({ page }) => {
    const contentBtn = page.locator('.mobile-toolbar-btn[data-panel="main"]');
    await contentBtn.click();

    await expect(contentBtn).toHaveClass(/active/);
  });

  test('clicking Status button shows status panel', async ({ page }) => {
    const statusBtn = page.locator('.mobile-toolbar-btn[data-panel="status"]');
    await statusBtn.click();

    await expect(statusBtn).toHaveClass(/active/);
  });

  test('toolbar remains visible when switching panels', async ({ page }) => {
    const toolbar = page.locator('.mobile-toolbar');

    // Click each button and verify toolbar stays visible
    const buttons = page.locator('.mobile-toolbar-btn');
    for (let i = 0; i < 3; i++) {
      await buttons.nth(i).click();
      await page.waitForTimeout(300);
      await expect(toolbar).toBeVisible();
    }
  });

  test('no horizontal scrolling on mobile', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });

  test('ILR slider accessible via config panel', async ({ page }) => {
    const configBtn = page.locator('.mobile-toolbar-btn[data-panel="config"]');
    await configBtn.click();
    await page.waitForTimeout(300);

    const slider = page.locator('#ilr-slider');
    await expect(slider).toBeVisible();
  });
});

// ============================================================================
// SECTION 17: ACCESSIBILITY
// ============================================================================

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('page has heading structure', async ({ page }) => {
    const headings = page.locator('h1, h2, h3, h4');
    const count = await headings.count();
    expect(count).toBeGreaterThan(0);
  });

  test('all images have alt text', async ({ page }) => {
    const images = page.locator('img');
    const count = await images.count();

    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      const ariaHidden = await img.getAttribute('aria-hidden');

      // Either has alt text or is decorative (aria-hidden)
      expect(alt !== null || ariaHidden === 'true').toBeTruthy();
    }
  });

  test('form inputs have labels', async ({ page }) => {
    const slider = page.locator('#ilr-slider');
    const labelledBy = await slider.getAttribute('aria-labelledby');
    expect(labelledBy || await page.locator('label[for="ilr-slider"]').count() > 0).toBeTruthy();
  });

  test('buttons have accessible names', async ({ page }) => {
    const buttons = page.locator('button:visible');
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 10); i++) {
      const btn = buttons.nth(i);
      const text = await btn.textContent();
      const ariaLabel = await btn.getAttribute('aria-label');

      expect(text?.trim() || ariaLabel).toBeTruthy();
    }
  });

  test('interactive elements are keyboard focusable', async ({ page }) => {
    // Tab through first 15 elements
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.tagName);
      expect(focused).toBeTruthy();
    }
  });

  test('focus is visible on interactive elements', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });
});

// ============================================================================
// SECTION 18: LANDING PAGE
// ============================================================================

test.describe('Landing Page', () => {
  test('landing page loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

  test('has Arabic content', async ({ page }) => {
    await page.goto('/');

    // Check for Arabic text in hero section
    const arabicHero = page.locator('.landing-hero-arabic');
    if (await arabicHero.isVisible()) {
      const text = await arabicHero.textContent();
      // Verify it contains Arabic characters
      expect(text).toMatch(/[\u0600-\u06FF]/);
    }

    // Check for تناغم in footer logo
    const arabicLogo = page.locator('.landing-footer-logo-arabic');
    if (await arabicLogo.isVisible()) {
      await expect(arabicLogo).toContainText('تناغم');
    }
  });

  test('Arabic text is centered', async ({ page }) => {
    await page.goto('/');

    const arabicText = page.locator('.landing-hero-arabic').first();
    if (await arabicText.isVisible()) {
      const box = await arabicText.boundingBox();
      const viewportWidth = page.viewportSize()!.width;
      const textCenter = box!.x + box!.width / 2;
      const viewportCenter = viewportWidth / 2;

      expect(Math.abs(textCenter - viewportCenter)).toBeLessThan(100);
    }
  });

  test('has link to generator', async ({ page }) => {
    await page.goto('/');

    const link = page.locator('a[href*="generator"]').first();
    await expect(link).toBeVisible();
  });

  test('navigation to generator works', async ({ page }) => {
    await page.goto('/');

    const link = page.locator('a[href*="generator"]').first();
    if (await link.isVisible()) {
      await link.click();
      await page.waitForURL('**/generator.html');
      await expect(page).toHaveURL(/generator/);
    }
  });

  test('no horizontal scrolling', async ({ page }) => {
    await page.goto('/');

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });
});

// ============================================================================
// SECTION 19: ERROR HANDLING
// ============================================================================

test.describe('Error Handling', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('invalid YouTube URL shows no preview', async ({ page }) => {
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(300);

    const urlInput = page.locator('#youtube-url');
    await urlInput.fill('not-a-valid-url');
    await page.waitForTimeout(1000);

    const preview = page.locator('#video-preview');
    await expect(preview).not.toBeVisible();
  });

  test('empty search shows no results', async ({ page }) => {
    await page.locator('.custom-search-toggle').click();

    const searchBtn = page.locator('#search-btn');
    await searchBtn.click();

    // Should not trigger search with empty query
    await page.waitForTimeout(500);
    const loading = page.locator('#search-loading');
    await expect(loading).not.toBeVisible();
  });
});

// ============================================================================
// SECTION 20: VISUAL REGRESSION SCREENSHOTS
// ============================================================================

test.describe('Visual Screenshots', () => {
  test.skip(({ viewport }) => viewport!.width < 768, 'Desktop only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('capture initial state', async ({ page }) => {
    await page.screenshot({ path: 'test-results/screenshots/01-initial.png', fullPage: true });
  });

  test('capture each source option', async ({ page }) => {
    // Find Videos (search)
    await page.screenshot({ path: 'test-results/screenshots/02-search-tab.png' });

    // YouTube URL
    await page.selectOption('#source-select', 'youtube');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/screenshots/03-youtube-tab.png' });

    // Upload
    await page.selectOption('#source-select', 'upload');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/screenshots/04-upload-tab.png' });
  });

  test('capture topic selection', async ({ page }) => {
    await page.selectOption('#topic-select', 'news');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/screenshots/05-topic-selected.png' });
  });

  test('capture ILR slider positions', async ({ page }) => {
    const slider = page.locator('#ilr-slider');

    await slider.fill('1');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'test-results/screenshots/06-ilr-1.png' });

    await slider.fill('2.5');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'test-results/screenshots/07-ilr-2.5.png' });

    await slider.fill('3.5');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'test-results/screenshots/08-ilr-3.5.png' });
  });

  test('capture custom search expanded', async ({ page }) => {
    await page.locator('.custom-search-toggle').click();
    await page.locator('#search-query').fill('Arabic documentary');
    await page.screenshot({ path: 'test-results/screenshots/09-custom-search.png' });
  });

  test('capture duration filter selection', async ({ page }) => {
    await page.locator('.duration-btn[data-max="300"]').click();
    await page.screenshot({ path: 'test-results/screenshots/10-duration-filter.png' });
  });
});

// ============================================================================
// SECTION 21: MOBILE SCREENSHOTS
// ============================================================================

test.describe('Mobile Screenshots', () => {
  test.skip(({ viewport }) => viewport!.width > 768, 'Mobile only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');
  });

  test('capture mobile initial state', async ({ page }) => {
    await page.screenshot({ path: 'test-results/screenshots/mobile-01-initial.png', fullPage: true });
  });

  test('capture mobile toolbar navigation', async ({ page }) => {
    // Config panel
    await page.locator('.mobile-toolbar-btn[data-panel="config"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/screenshots/mobile-02-config.png' });

    // Content panel
    await page.locator('.mobile-toolbar-btn[data-panel="main"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/screenshots/mobile-03-content.png' });

    // Status panel
    await page.locator('.mobile-toolbar-btn[data-panel="status"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/screenshots/mobile-04-status.png' });
  });

  test('capture mobile topic grid', async ({ page }) => {
    await page.locator('.mobile-toolbar-btn[data-panel="config"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/screenshots/mobile-05-topics.png' });
  });
});
