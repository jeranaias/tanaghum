import { test, expect } from '@playwright/test';

const LIVE_BASE = 'https://jeranaias.github.io/tanaghum';

test.describe('Auth & Settings — Full Check', () => {
  test.setTimeout(600000); // 10 min max

  test('sign in, check dropdown, settings modal, all providers, quota, cross-page', async ({ page }) => {
    // ── 1. Navigate to generator ──
    console.log('1. Loading generator page...');
    await page.goto(`${LIVE_BASE}/generator.html`, { waitUntil: 'networkidle' });

    const authSection = page.locator('#auth-section');
    await expect(authSection).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);

    const state = await authSection.getAttribute('data-state');

    if (state !== 'logged-in') {
      console.log('');
      console.log('╔══════════════════════════════════════════════╗');
      console.log('║  SIGN IN NOW — you have 60 seconds           ║');
      console.log('║  Click the Google Sign-In button on the page  ║');
      console.log('╚══════════════════════════════════════════════╝');
      console.log('');

      // Wait 60 seconds for the user to sign in
      await page.waitForTimeout(60000);
    }

    // ── 2. Verify logged-in state ──
    console.log('2. Checking logged-in state...');
    await expect(authSection).toHaveAttribute('data-state', 'logged-in', { timeout: 10000 });

    const avatar = page.locator('.user-avatar');
    await expect(avatar).toBeVisible();

    const userName = page.locator('.user-name');
    await expect(userName).toBeVisible();
    const name = await userName.textContent();
    console.log(`   Logged in as: ${name}`);

    // ── 3. Open dropdown and verify ALL items ──
    console.log('3. Checking dropdown menu items...');
    await avatar.click();

    const dropdown = page.locator('.user-dropdown');
    await expect(dropdown).toHaveClass(/open/, { timeout: 3000 });

    // Email
    const email = page.locator('.user-dropdown-email');
    await expect(email).toBeVisible();
    const emailText = await email.textContent();
    console.log(`   Email: ${emailText}`);
    expect(emailText?.length).toBeGreaterThan(3);

    // Quota display
    const quotaDisplay = page.locator('#dropdown-quota');
    await expect(quotaDisplay).toBeVisible();
    console.log('   Quota display: visible');

    // API Keys & Providers button
    const settingsBtn = page.locator('#auth-settings-btn');
    await expect(settingsBtn).toBeVisible();
    await expect(settingsBtn).toContainText('API Keys');
    console.log('   API Keys button: visible');

    // My Usage button
    const usageBtn = page.locator('#auth-usage-btn');
    await expect(usageBtn).toBeVisible();
    await expect(usageBtn).toContainText('My Usage');
    console.log('   My Usage button: visible');

    // About Tanaghum link
    const aboutLink = page.locator('.user-dropdown-link');
    await expect(aboutLink).toBeVisible();
    await expect(aboutLink).toContainText('About');
    console.log('   About link: visible');

    // Sign out button
    const logoutBtn = page.locator('#auth-logout-btn');
    await expect(logoutBtn).toBeVisible();
    await expect(logoutBtn).toContainText('Sign out');
    console.log('   Sign out button: visible');

    // Close dropdown
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);

    // ── 4. Open settings modal via API Keys button ──
    console.log('4. Opening settings modal...');
    await avatar.click();
    await page.waitForTimeout(300);
    await settingsBtn.click();
    await page.waitForTimeout(1000);

    // Check backdrop is active
    const backdrop = page.locator('#settings-modal');
    await expect(backdrop).toHaveClass(/active/, { timeout: 5000 });
    console.log('   Backdrop: active');

    // Check inner modal is visible
    const innerModal = page.locator('#settings-modal .modal');
    await expect(innerModal).toHaveClass(/active/, { timeout: 3000 });
    await expect(innerModal).toBeVisible();
    console.log('   Modal content: visible');

    // ── 5. Verify all 4 provider key sections ──
    console.log('5. Checking provider sections...');

    const providers = ['google', 'groq', 'cerebras', 'openrouter'];
    for (const provider of providers) {
      const item = page.locator(`.settings-key-item[data-provider="${provider}"]`);
      await expect(item).toBeVisible({ timeout: 3000 });

      // Check name and description are shown
      const name = await item.locator('.settings-key-name').textContent();
      const desc = await item.locator('.settings-key-desc').textContent();
      console.log(`   ${provider}: ${name} — ${desc?.substring(0, 50)}...`);

      // Check input and save button exist
      await expect(item.locator('.settings-key-input')).toBeVisible();
      await expect(item.locator('.settings-key-save')).toBeVisible();

      // Check "Get a free key" link exists
      const keyLink = item.locator('.settings-key-link');
      await expect(keyLink).toBeVisible();
      const href = await keyLink.getAttribute('href');
      console.log(`   ${provider} key link: ${href}`);
      expect(href).toBeTruthy();
    }

    // ── 6. Verify quota section in settings ──
    console.log('6. Checking quota section...');
    const quotaSection = page.locator('#settings-quota');
    await expect(quotaSection).toBeVisible();
    const quotaText = await quotaSection.textContent();
    console.log(`   Quota info: ${quotaText?.trim().replace(/\s+/g, ' ')}`);

    // ── 7. Close settings modal ──
    console.log('7. Closing settings modal...');
    await page.locator('#settings-modal .modal-close').click();
    await page.waitForTimeout(500);
    await expect(backdrop).not.toHaveClass(/active/);
    console.log('   Modal closed successfully');

    // ── 8. Open via My Usage button ──
    console.log('8. Testing My Usage button...');
    await avatar.click();
    await page.waitForTimeout(300);
    await usageBtn.click();
    await page.waitForTimeout(1000);
    await expect(backdrop).toHaveClass(/active/, { timeout: 5000 });
    await expect(innerModal).toBeVisible();
    console.log('   My Usage opens settings: OK');

    // Close
    await page.locator('#settings-modal .modal-close').click();
    await page.waitForTimeout(500);

    // ── 9. Test quota API endpoint ──
    console.log('9. Testing quota API...');
    const quotaResponse = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('tanaghum_auth') || '{}');
      const resp = await fetch('https://tanaghum-worker.jmathdog.workers.dev/api/user/quota', {
        headers: auth.token ? { 'Authorization': `Bearer ${auth.token}` } : {}
      });
      return resp.json();
    });
    console.log(`   Tier: ${quotaResponse.tier}, Used: ${quotaResponse.used}, Limit: ${quotaResponse.limit}`);
    expect(quotaResponse.tier).toBe('authenticated');

    // ── 10. Test login persists on reload ──
    console.log('10. Testing login persistence on reload...');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await expect(authSection).toHaveAttribute('data-state', 'logged-in', { timeout: 15000 });
    console.log('    Login survived reload: OK');

    // ── 11. Cross-page: navigate to gallery ──
    console.log('11. Testing cross-page persistence (gallery)...');
    await page.goto(`${LIVE_BASE}/gallery.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const galleryAuth = page.locator('#auth-section');
    await expect(galleryAuth).toHaveAttribute('data-state', 'logged-in', { timeout: 15000 });
    await expect(page.locator('.user-avatar')).toBeVisible();
    console.log('    Gallery page: logged in');

    // Check settings works on gallery too
    await page.locator('.user-avatar').click();
    await page.waitForTimeout(300);
    await page.locator('#auth-settings-btn').click();
    await page.waitForTimeout(1000);

    const galleryModal = page.locator('#settings-modal');
    await expect(galleryModal).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator('#settings-modal .modal')).toBeVisible();
    console.log('    Gallery settings modal: works');

    await page.locator('#settings-modal .modal-close').click();
    await page.waitForTimeout(500);

    // ── 12. Cross-page: navigate to about ──
    console.log('12. Testing cross-page persistence (about)...');
    await page.goto(`${LIVE_BASE}/about.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const aboutAuth = page.locator('#auth-section');
    await expect(aboutAuth).toHaveAttribute('data-state', 'logged-in', { timeout: 15000 });
    console.log('    About page: logged in');

    // ── 13. Cross-page: navigate to player ──
    console.log('13. Testing cross-page persistence (player)...');
    await page.goto(`${LIVE_BASE}/player.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const playerAuth = page.locator('#auth-section');
    await expect(playerAuth).toHaveAttribute('data-state', 'logged-in', { timeout: 15000 });
    console.log('    Player page: logged in');

    console.log('');
    console.log('══════════════════════════════════════════');
    console.log('  ALL CHECKS PASSED');
    console.log('══════════════════════════════════════════');
  });
});
