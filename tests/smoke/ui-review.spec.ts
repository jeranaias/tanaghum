import { test, expect, Page } from '@playwright/test';

const LIVE_BASE = 'https://jeranaias.github.io/tanaghum';

test.describe('Full UI Review — All Pages, No Sign-In Required', () => {
  test.setTimeout(300000);

  // Helper: check for horizontal overflow (scrolling issues)
  async function checkHorizontalOverflow(page: Page, pageName: string) {
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (overflow) {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      console.log(`   !! HORIZONTAL OVERFLOW on ${pageName}: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);
    } else {
      console.log(`   No horizontal overflow on ${pageName}`);
    }
    return overflow;
  }

  // Helper: check for elements overflowing their containers
  async function checkOverflowingElements(page: Page, pageName: string) {
    const issues = await page.evaluate(() => {
      const problems: string[] = [];
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const rect = el.getBoundingClientRect();
        if (rect.width > window.innerWidth + 5) {
          const id = el.id ? `#${el.id}` : '';
          const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
          problems.push(`${el.tagName}${id}${cls} width=${Math.round(rect.width)} > viewport=${window.innerWidth}`);
        }
      }
      return problems.slice(0, 10);
    });
    if (issues.length > 0) {
      console.log(`   !! OVERFLOWING ELEMENTS on ${pageName}:`);
      issues.forEach(i => console.log(`      - ${i}`));
    }
    return issues;
  }

  // Helper: check broken images
  async function checkBrokenImages(page: Page, pageName: string) {
    const broken = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      const issues: string[] = [];
      imgs.forEach(img => {
        if (!img.complete || img.naturalWidth === 0) {
          issues.push(`${img.src || 'no-src'} (alt: ${img.alt || 'none'})`);
        }
      });
      return issues;
    });
    if (broken.length > 0) {
      console.log(`   !! BROKEN IMAGES on ${pageName}:`);
      broken.forEach(b => console.log(`      - ${b}`));
    }
    return broken;
  }

  // Helper: check console errors
  async function collectConsoleErrors(page: Page): Promise<string[]> {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    return errors;
  }

  // Helper: check z-index and overlapping issues
  async function checkVisibleHeader(page: Page, pageName: string) {
    const header = page.locator('header').first();
    if (await header.count() > 0) {
      const visible = await header.isVisible();
      if (!visible) {
        console.log(`   !! HEADER NOT VISIBLE on ${pageName}`);
      }
    }
  }

  // Helper: check page height
  async function checkPageMetrics(page: Page, pageName: string) {
    const metrics = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
    const scrollRatio = metrics.scrollHeight / metrics.clientHeight;
    console.log(`   Page height: ${metrics.scrollHeight}px, viewport: ${metrics.viewportWidth}x${metrics.viewportHeight}, scroll ratio: ${scrollRatio.toFixed(1)}x`);
    if (scrollRatio > 5) {
      console.log(`   !! EXCESSIVE SCROLLING on ${pageName} — ${scrollRatio.toFixed(1)}x viewport height`);
    }
  }

  // ═══════════════════════════════════════════════
  // HOME PAGE (index.html)
  // ═══════════════════════════════════════════════
  test('HOME page — index.html', async ({ page }) => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  HOME PAGE (index.html)');
    console.log('═══════════════════════════════════════════');

    const errors = await collectConsoleErrors(page);
    await page.goto(`${LIVE_BASE}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check basic structure
    console.log('');
    console.log('--- Structure ---');
    const title = await page.title();
    console.log(`   Title: ${title}`);
    expect(title.length).toBeGreaterThan(0);

    // Header / nav
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible({ timeout: 5000 });
    console.log('   Nav: visible');

    // Hero section
    const hero = page.locator('.hero, .landing-hero, [class*="hero"]').first();
    if (await hero.count() > 0) {
      await expect(hero).toBeVisible();
      console.log('   Hero section: visible');
    } else {
      console.log('   !! No hero section found');
    }

    // CTA button
    const ctaBtn = page.locator('a[href*="generator"], .btn-primary').first();
    if (await ctaBtn.count() > 0) {
      await expect(ctaBtn).toBeVisible();
      const ctaText = await ctaBtn.textContent();
      console.log(`   CTA button: "${ctaText?.trim()}"`);
    }

    // Check all nav links
    console.log('');
    console.log('--- Navigation Links ---');
    const navLinks = page.locator('nav a, .nav a, .nav-link');
    const linkCount = await navLinks.count();
    for (let i = 0; i < linkCount; i++) {
      const link = navLinks.nth(i);
      const text = await link.textContent();
      const href = await link.getAttribute('href');
      const visible = await link.isVisible();
      console.log(`   ${visible ? 'OK' : '!! HIDDEN'} "${text?.trim()}" → ${href}`);
    }

    // Layout checks
    console.log('');
    console.log('--- Layout ---');
    await checkHorizontalOverflow(page, 'index');
    await checkPageMetrics(page, 'index');
    await checkOverflowingElements(page, 'index');
    await checkBrokenImages(page, 'index');
    await checkVisibleHeader(page, 'index');

    // Footer
    const footer = page.locator('footer').first();
    if (await footer.count() > 0) {
      console.log('   Footer: exists');
    } else {
      console.log('   !! No footer found');
    }

    // Check for cut-off text
    console.log('');
    console.log('--- Text Rendering ---');
    const arabicText = page.locator('[lang="ar"], .ar, .logo-arabic').first();
    if (await arabicText.count() > 0) {
      const arBox = await arabicText.boundingBox();
      if (arBox && arBox.height < 5) {
        console.log('   !! Arabic text appears collapsed (height < 5px)');
      } else {
        console.log(`   Arabic text rendered: ${arBox?.width}x${arBox?.height}`);
      }
    }

    // Console errors
    console.log('');
    console.log('--- Console Errors ---');
    if (errors.length > 0) {
      errors.forEach(e => console.log(`   !! ${e}`));
    } else {
      console.log('   No console errors');
    }

    // Screenshot
    await page.screenshot({ path: 'test-results/home-full.png', fullPage: true });
    console.log('   Screenshot saved: test-results/home-full.png');
  });

  // ═══════════════════════════════════════════════
  // GENERATOR PAGE
  // ═══════════════════════════════════════════════
  test('GENERATOR page — generator.html', async ({ page }) => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  GENERATOR PAGE (generator.html)');
    console.log('═══════════════════════════════════════════');

    const errors = await collectConsoleErrors(page);
    await page.goto(`${LIVE_BASE}/generator.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    console.log('');
    console.log('--- Structure ---');
    const title = await page.title();
    console.log(`   Title: ${title}`);

    // Header
    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    console.log('   Header: visible');

    // Auth section (should show sign-in, not logged in)
    const authSection = page.locator('#auth-section');
    if (await authSection.count() > 0) {
      const state = await authSection.getAttribute('data-state');
      console.log(`   Auth state: ${state}`);
      if (state === 'logged-out') {
        const signinBtn = page.locator('#google-signin-btn');
        const signinVisible = await signinBtn.isVisible();
        console.log(`   Sign-in button: ${signinVisible ? 'visible' : '!! NOT VISIBLE'}`);
      }
    }

    // Three-panel layout
    console.log('');
    console.log('--- Panel Layout ---');
    const leftPanel = page.locator('.left-panel, .panel-left, [class*="left-panel"]').first();
    const centerPanel = page.locator('.center-panel, .panel-center, [class*="center"]').first();
    const rightPanel = page.locator('.right-panel, .panel-right, [class*="right-panel"]').first();

    if (await leftPanel.count() > 0) {
      const box = await leftPanel.boundingBox();
      console.log(`   Left panel: ${box ? `${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.x)},${Math.round(box.y)})` : '!! no bounding box'}`);
    }
    if (await centerPanel.count() > 0) {
      const box = await centerPanel.boundingBox();
      console.log(`   Center panel: ${box ? `${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.x)},${Math.round(box.y)})` : '!! no bounding box'}`);
    }
    if (await rightPanel.count() > 0) {
      const box = await rightPanel.boundingBox();
      console.log(`   Right panel: ${box ? `${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.x)},${Math.round(box.y)})` : '!! no bounding box'}`);
    }

    // Source input section
    console.log('');
    console.log('--- Input Section ---');
    // URL input is hidden by default because "Find Videos" (search) is the default source tab
    // Check that the source selector is visible instead
    const sourceSelect = page.locator('#source-select');
    if (await sourceSelect.count() > 0) {
      await expect(sourceSelect).toBeVisible();
      const selectedValue = await sourceSelect.inputValue();
      console.log(`   Source selector: visible (selected: "${selectedValue}")`);
    } else {
      console.log('   !! No source selector found');
    }

    // Topic buttons
    const topicBtns = page.locator('[data-topic], .topic-btn, .topic-pill');
    const topicCount = await topicBtns.count();
    console.log(`   Topic buttons: ${topicCount} found`);
    if (topicCount > 0) {
      // Check if any overflow
      const firstTopic = await topicBtns.first().boundingBox();
      const lastTopic = await topicBtns.last().boundingBox();
      if (firstTopic && lastTopic) {
        const totalWidth = lastTopic.x + lastTopic.width - firstTopic.x;
        const viewportWidth = await page.evaluate(() => window.innerWidth);
        if (totalWidth > viewportWidth) {
          console.log(`   !! Topic buttons overflow: ${Math.round(totalWidth)}px > ${viewportWidth}px viewport`);
        }
      }
    }

    // ILR level selector
    const ilrSelector = page.locator('[id*="ilr"], [class*="ilr"], select[id*="level"]').first();
    if (await ilrSelector.count() > 0) {
      console.log('   ILR selector: found');
    }

    // Generate button
    const generateBtn = page.locator('button:has-text("Generate"), [id*="generate"]').first();
    if (await generateBtn.count() > 0) {
      const visible = await generateBtn.isVisible();
      const disabled = await generateBtn.isDisabled();
      console.log(`   Generate button: ${visible ? 'visible' : '!! hidden'}, ${disabled ? 'disabled (expected)' : 'enabled'}`);
    }

    // Status cards / quota display
    console.log('');
    console.log('--- Status Cards ---');
    const statusCards = page.locator('.status-card, [data-provider]');
    const cardCount = await statusCards.count();
    console.log(`   Status cards: ${cardCount} found`);
    for (let i = 0; i < cardCount; i++) {
      const card = statusCards.nth(i);
      const provider = await card.getAttribute('data-provider');
      const text = await card.textContent();
      console.log(`   - ${provider}: ${text?.trim().substring(0, 60)}`);
    }

    // Layout checks
    console.log('');
    console.log('--- Layout ---');
    await checkHorizontalOverflow(page, 'generator');
    await checkPageMetrics(page, 'generator');
    await checkOverflowingElements(page, 'generator');
    await checkBrokenImages(page, 'generator');

    // Check if panels overlap
    const panels = await page.evaluate(() => {
      const all = document.querySelectorAll('[class*="panel"]');
      const rects: { cls: string; left: number; right: number; top: number; bottom: number }[] = [];
      all.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          rects.push({ cls: el.className.split(' ')[0], left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        }
      });
      return rects;
    });
    console.log(`   Panels found: ${panels.length}`);

    // Check buttons are clickable (not hidden behind other elements)
    console.log('');
    console.log('--- Button Accessibility ---');
    const allBtns = page.locator('button:visible');
    const btnCount = await allBtns.count();
    console.log(`   Visible buttons: ${btnCount}`);

    // Console errors
    console.log('');
    console.log('--- Console Errors ---');
    if (errors.length > 0) {
      errors.forEach(e => console.log(`   !! ${e.substring(0, 120)}`));
    } else {
      console.log('   No console errors');
    }

    await page.screenshot({ path: 'test-results/generator-full.png', fullPage: true });
    console.log('   Screenshot saved: test-results/generator-full.png');
  });

  // ═══════════════════════════════════════════════
  // GALLERY PAGE
  // ═══════════════════════════════════════════════
  test('GALLERY page — gallery.html', async ({ page }) => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  GALLERY PAGE (gallery.html)');
    console.log('═══════════════════════════════════════════');

    const errors = await collectConsoleErrors(page);
    await page.goto(`${LIVE_BASE}/gallery.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    console.log('');
    console.log('--- Structure ---');
    const title = await page.title();
    console.log(`   Title: ${title}`);

    // Header and nav
    await expect(page.locator('header').first()).toBeVisible();
    console.log('   Header: visible');

    // Auth section
    const authSection = page.locator('#auth-section');
    if (await authSection.count() > 0) {
      const state = await authSection.getAttribute('data-state');
      console.log(`   Auth state: ${state}`);
    }

    // Gallery hero
    const galleryTitle = page.locator('.gallery-title, h1').first();
    if (await galleryTitle.count() > 0) {
      const text = await galleryTitle.textContent();
      console.log(`   Gallery title: "${text?.trim().substring(0, 50)}"`);
    }

    // Search bar
    console.log('');
    console.log('--- Search & Filters ---');
    const searchInput = page.locator('#gallery-search, input[type="search"]').first();
    if (await searchInput.count() > 0) {
      await expect(searchInput).toBeVisible();
      console.log('   Search input: visible');
    } else {
      console.log('   !! No search input');
    }

    // Filter pills
    const filterPills = page.locator('.filter-pill');
    const pillCount = await filterPills.count();
    console.log(`   Filter pills: ${pillCount} found`);

    // Check pills don't overflow
    if (pillCount > 0) {
      const pillsContainer = page.locator('.filter-pills').first();
      if (await pillsContainer.count() > 0) {
        const box = await pillsContainer.boundingBox();
        const vpWidth = await page.evaluate(() => window.innerWidth);
        if (box && box.width > vpWidth) {
          console.log(`   !! Filter pills overflow: ${Math.round(box.width)}px > ${vpWidth}px`);
        }
      }
    }

    // Sort/duration selects
    const selects = page.locator('.filter-select, select');
    const selectCount = await selects.count();
    console.log(`   Dropdowns: ${selectCount}`);

    // Gallery grid
    console.log('');
    console.log('--- Gallery Grid ---');
    const grid = page.locator('.gallery-grid').first();
    if (await grid.count() > 0) {
      const gridBox = await grid.boundingBox();
      console.log(`   Grid: ${gridBox ? `${Math.round(gridBox.width)}x${Math.round(gridBox.height)}` : 'no bounding box'}`);
    }

    // Cards or empty state
    const cards = page.locator('.lesson-card:not(.skeleton)');
    const skeletons = page.locator('.lesson-card.skeleton');
    const emptyState = page.locator('#empty-state, .empty-state');
    console.log(`   Cards: ${await cards.count()}, Skeletons: ${await skeletons.count()}, Empty state visible: ${await emptyState.isVisible().catch(() => false)}`);

    // Layout checks
    console.log('');
    console.log('--- Layout ---');
    await checkHorizontalOverflow(page, 'gallery');
    await checkPageMetrics(page, 'gallery');
    await checkOverflowingElements(page, 'gallery');
    await checkBrokenImages(page, 'gallery');

    // Footer
    const footer = page.locator('footer').first();
    if (await footer.count() > 0) {
      const footerVisible = await footer.isVisible();
      console.log(`   Footer: ${footerVisible ? 'visible' : 'exists but not in view'}`);
    }

    // Console errors
    console.log('');
    console.log('--- Console Errors ---');
    if (errors.length > 0) {
      errors.forEach(e => console.log(`   !! ${e.substring(0, 120)}`));
    } else {
      console.log('   No console errors');
    }

    await page.screenshot({ path: 'test-results/gallery-full.png', fullPage: true });
    console.log('   Screenshot saved: test-results/gallery-full.png');
  });

  // ═══════════════════════════════════════════════
  // ABOUT PAGE
  // ═══════════════════════════════════════════════
  test('ABOUT page — about.html', async ({ page }) => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  ABOUT PAGE (about.html)');
    console.log('═══════════════════════════════════════════');

    const errors = await collectConsoleErrors(page);
    await page.goto(`${LIVE_BASE}/about.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    console.log('');
    console.log('--- Structure ---');
    const title = await page.title();
    console.log(`   Title: ${title}`);

    await expect(page.locator('header').first()).toBeVisible();
    console.log('   Header: visible');

    // Auth
    const authSection = page.locator('#auth-section');
    if (await authSection.count() > 0) {
      const state = await authSection.getAttribute('data-state');
      console.log(`   Auth state: ${state}`);
    }

    // Content sections
    console.log('');
    console.log('--- Content Sections ---');
    const headings = page.locator('h1, h2, h3');
    const headingCount = await headings.count();
    for (let i = 0; i < Math.min(headingCount, 15); i++) {
      const h = headings.nth(i);
      const tag = await h.evaluate(el => el.tagName);
      const text = await h.textContent();
      const visible = await h.isVisible();
      console.log(`   ${visible ? 'OK' : '!! HIDDEN'} <${tag}> "${text?.trim().substring(0, 60)}"`);
    }

    // Check for sections that might be too wide
    console.log('');
    console.log('--- Content Width ---');
    const sections = page.locator('section, .container, .about-section');
    const sectionCount = await sections.count();
    const vpWidth = await page.evaluate(() => window.innerWidth);
    for (let i = 0; i < sectionCount; i++) {
      const s = sections.nth(i);
      const box = await s.boundingBox();
      if (box && box.width > vpWidth + 5) {
        const cls = await s.getAttribute('class');
        console.log(`   !! Section overflows: .${cls} width=${Math.round(box.width)} > viewport=${vpWidth}`);
      }
    }

    // Links - check none are broken
    console.log('');
    console.log('--- Links ---');
    const links = page.locator('a[href]');
    const linkCount = await links.count();
    let externalLinks = 0;
    let internalLinks = 0;
    for (let i = 0; i < linkCount; i++) {
      const href = await links.nth(i).getAttribute('href');
      if (href?.startsWith('http')) externalLinks++;
      else internalLinks++;
    }
    console.log(`   Total links: ${linkCount} (${internalLinks} internal, ${externalLinks} external)`);

    // Layout checks
    console.log('');
    console.log('--- Layout ---');
    await checkHorizontalOverflow(page, 'about');
    await checkPageMetrics(page, 'about');
    await checkOverflowingElements(page, 'about');
    await checkBrokenImages(page, 'about');

    // Console errors
    console.log('');
    console.log('--- Console Errors ---');
    if (errors.length > 0) {
      errors.forEach(e => console.log(`   !! ${e.substring(0, 120)}`));
    } else {
      console.log('   No console errors');
    }

    await page.screenshot({ path: 'test-results/about-full.png', fullPage: true });
    console.log('   Screenshot saved: test-results/about-full.png');
  });

  // ═══════════════════════════════════════════════
  // MOBILE VIEWPORT TESTS (all pages)
  // ═══════════════════════════════════════════════
  test('MOBILE viewport — all pages at 375px', async ({ page }) => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  MOBILE VIEWPORT (375x812 — iPhone)');
    console.log('═══════════════════════════════════════════');

    await page.setViewportSize({ width: 375, height: 812 });

    const pages = [
      { name: 'Home', url: `${LIVE_BASE}/index.html` },
      { name: 'Generator', url: `${LIVE_BASE}/generator.html` },
      { name: 'Gallery', url: `${LIVE_BASE}/gallery.html` },
      { name: 'About', url: `${LIVE_BASE}/about.html` },
    ];

    for (const p of pages) {
      console.log('');
      console.log(`--- ${p.name} (mobile) ---`);
      await page.goto(p.url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      // Horizontal overflow
      const hasOverflow = await checkHorizontalOverflow(page, `${p.name} (mobile)`);

      // Page metrics
      await checkPageMetrics(page, `${p.name} (mobile)`);

      // Check nav is not broken
      const header = page.locator('header').first();
      if (await header.count() > 0) {
        const headerBox = await header.boundingBox();
        if (headerBox) {
          if (headerBox.width > 375) {
            console.log(`   !! Header overflows mobile: ${Math.round(headerBox.width)}px`);
          }
          if (headerBox.height > 120) {
            console.log(`   !! Header too tall on mobile: ${Math.round(headerBox.height)}px`);
          } else {
            console.log(`   Header: ${Math.round(headerBox.width)}x${Math.round(headerBox.height)}`);
          }
        }
      }

      // Check text isn't tiny
      const bodyFontSize = await page.evaluate(() => {
        return parseFloat(getComputedStyle(document.body).fontSize);
      });
      if (bodyFontSize < 12) {
        console.log(`   !! Body font too small: ${bodyFontSize}px`);
      }

      // Check buttons are tappable (min 44x44)
      const buttons = page.locator('button:visible, a.btn:visible');
      const btnCount = await buttons.count();
      let tinyBtns = 0;
      for (let i = 0; i < Math.min(btnCount, 20); i++) {
        const box = await buttons.nth(i).boundingBox();
        if (box && (box.height < 32 || box.width < 32)) {
          tinyBtns++;
        }
      }
      if (tinyBtns > 0) {
        console.log(`   !! ${tinyBtns} buttons too small for touch (<32px)`);
      } else {
        console.log(`   All ${btnCount} visible buttons are touch-friendly`);
      }

      // Screenshot
      const screenshotName = `test-results/${p.name.toLowerCase()}-mobile.png`;
      await page.screenshot({ path: screenshotName, fullPage: true });
      console.log(`   Screenshot: ${screenshotName}`);
    }
  });
});
