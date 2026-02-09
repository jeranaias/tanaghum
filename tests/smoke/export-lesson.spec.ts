import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate and export a real lesson using the Find Videos search
 */
test.describe('Export Real Lesson', () => {
  test('search for video, generate with audio capture, and export HTML', async ({ page }) => {
    // 15 minute timeout - audio capture takes time
    test.setTimeout(900000);

    // Capture all logs
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        console.log('PAGE ERROR:', text);
      } else if (type === 'warning') {
        console.log('PAGE WARN:', text);
      } else {
        console.log('PAGE:', text);
      }
    });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

    await page.goto('/generator.html');
    await page.waitForLoadState('networkidle');

    // Verify dropdowns are present
    console.log('Checking new dropdown UI...');
    await expect(page.locator('#source-select')).toBeVisible();
    await expect(page.locator('#topic-select')).toBeVisible();
    console.log('Dropdowns found!');

    // Use 1-5 min filter to get short videos (not live streams)
    console.log('Setting duration filter to 1-5 min...');
    await page.click('.duration-btn[data-min="60"][data-max="300"]');
    await page.waitForTimeout(300);

    // Select News topic from dropdown to trigger search
    console.log('Selecting News from topic dropdown...');
    await page.selectOption('#topic-select', 'news');

    // Wait for results
    await expect(page.locator('#search-loading')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.video-search-card').first()).toBeVisible({ timeout: 30000 });

    const count = await page.locator('.video-search-card').count();
    console.log('Found', count, 'videos');

    // Click first video
    await page.locator('.video-search-card').first().click();
    console.log('Selected first video');
    await page.waitForTimeout(1000);

    // Wait for preview to show
    await expect(page.locator('#video-preview')).toBeVisible({ timeout: 15000 });
    const title = await page.locator('#video-title').textContent();
    console.log('Video title:', title);

    // Click generate
    await page.click('#preview-generate-btn');
    console.log('Starting generation...');

    // Wait for processing to start
    await expect(page.locator('#processing-state')).toBeVisible({ timeout: 10000 });
    console.log('Processing started...');

    // Wait for review state - audio capture + whisper can take 10+ minutes
    console.log('Waiting for generation to complete (audio capture + transcription)...');
    await expect(page.locator('#review-state')).toBeVisible({ timeout: 900000 });
    console.log('Generation complete!');

    // Check transcript loaded
    const segments = await page.locator('.transcript-segment').count();
    console.log('Transcript segments:', segments);
    expect(segments).toBeGreaterThan(0);

    // Check questions were generated
    const preQuestions = await page.locator('[data-phase="pre"] .question-item, .question-card[data-timing="pre"]').count();
    const whileQuestions = await page.locator('[data-phase="while"] .question-item, .question-card[data-timing="while"]').count();
    const postQuestions = await page.locator('[data-phase="post"] .question-item, .question-card[data-timing="post"]').count();
    console.log('Questions - Pre:', preQuestions, 'While:', whileQuestions, 'Post:', postQuestions);

    // Check quota display updated (should be less than full)
    const googleQuotaText = await page.locator('#quota-text-google').textContent();
    console.log('Google quota:', googleQuotaText);

    // Click export button
    const exportBtn = page.locator('#export-btn');
    await expect(exportBtn).toBeVisible();

    // Set up download handler
    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();

    const download = await downloadPromise;
    const downloadPath = path.join(process.cwd(), 'exported-lesson.html');
    await download.saveAs(downloadPath);

    console.log('Lesson exported to:', downloadPath);

    // Verify file exists and has content
    const content = fs.readFileSync(downloadPath, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('LESSON_DATA');
    expect(content).toContain('transcript');

    console.log('Export verified! File size:', content.length, 'bytes');
    console.log('\n========================================');
    console.log('SUCCESS! Lesson exported to: exported-lesson.html');
    console.log('========================================\n');
  });
});
