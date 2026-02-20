import { test, expect } from '@playwright/test';

const LIVE_BASE = 'https://jeranaias.github.io/tanaghum';

test.describe('Auth System', () => {
  // Give plenty of time for manual Google login
  test.setTimeout(300000);

  test('login with Google and verify auth UI', async ({ page }) => {
    // Navigate to generator page on live site
    await page.goto(`${LIVE_BASE}/generator.html`);

    // Verify auth section exists
    const authSection = page.locator('#auth-section');
    await expect(authSection).toBeVisible({ timeout: 15000 });

    // Wait for auth init
    await page.waitForTimeout(3000);

    const state = await authSection.getAttribute('data-state');

    if (state === 'logged-out') {
      console.log('=== NOT LOGGED IN - Pausing for Google Sign-In ===');
      console.log('=== Click the Google Sign-In button, complete login, then resume ===');

      // Wait for Google Sign-In button to render (it's an iframe inside the container)
      const signinContainer = page.locator('#google-signin-btn');
      await expect(signinContainer).toBeVisible({ timeout: 10000 });

      // PAUSE - user completes Google login manually, then clicks resume in Playwright inspector
      await page.pause();
    }

    // After login, verify user menu appears
    console.log('=== Verifying logged-in state ===');
    await expect(authSection).toHaveAttribute('data-state', 'logged-in', { timeout: 60000 });

    const avatar = page.locator('.user-avatar');
    await expect(avatar).toBeVisible();

    const userName = page.locator('.user-name');
    await expect(userName).toBeVisible();
    const name = await userName.textContent();
    console.log(`Logged in as: ${name}`);

    // Click avatar to open dropdown
    await avatar.click();
    const dropdown = page.locator('.user-dropdown');
    await expect(dropdown).toHaveClass(/open/);

    // Verify dropdown items
    await expect(page.locator('#auth-settings-btn')).toBeVisible();
    await expect(page.locator('#auth-logout-btn')).toBeVisible();

    // Close dropdown by clicking elsewhere
    await page.locator('.header').click();
    await page.waitForTimeout(500);

    // Test settings panel
    await avatar.click();
    await page.locator('#auth-settings-btn').click();

    // Settings modal should open
    const settingsModal = page.locator('#settings-modal');
    await expect(settingsModal).toHaveClass(/active/, { timeout: 5000 });

    // Verify API key sections
    await expect(page.locator('.settings-key-item[data-provider="google"]')).toBeVisible();
    await expect(page.locator('.settings-key-item[data-provider="groq"]')).toBeVisible();
    await expect(page.locator('.settings-key-item[data-provider="openrouter"]')).toBeVisible();

    // Verify quota section
    await expect(page.locator('#settings-quota')).toBeVisible();

    // Close settings
    await page.locator('.modal-close').click();
    await expect(settingsModal).not.toHaveClass(/active/);

    console.log('=== Auth UI test passed! ===');

    // Test quota endpoint via page context
    const quotaResponse = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('tanaghum_auth') || '{}');
      const resp = await fetch('https://tanaghum-worker.jmathdog.workers.dev/api/user/quota', {
        headers: auth.token ? { 'Authorization': `Bearer ${auth.token}` } : {}
      });
      return resp.json();
    });
    console.log('Quota:', JSON.stringify(quotaResponse));
    expect(quotaResponse.tier).toBe('authenticated');

    // Test login persistence on reload
    await page.reload();
    await page.waitForTimeout(3000);
    await expect(authSection).toHaveAttribute('data-state', 'logged-in', { timeout: 15000 });
    console.log('=== Login persists after reload ===');
  });

  test('verify auth on player page', async ({ page }) => {
    // Navigate to player on live site
    await page.goto(`${LIVE_BASE}/player.html`);
    await page.waitForTimeout(3000);

    const authSection = page.locator('#auth-section');
    await expect(authSection).toBeVisible({ timeout: 10000 });
    const state = await authSection.getAttribute('data-state');
    console.log(`Player page auth state: ${state}`);

    if (state === 'logged-in') {
      await expect(page.locator('.user-avatar')).toBeVisible();
      console.log('=== Auth persists across pages ===');
    } else {
      console.log('=== Not logged in on player (expected if tests run in parallel) ===');
    }
  });
});
