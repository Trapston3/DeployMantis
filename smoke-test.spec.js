const { test, expect } = require('@playwright/test');
const path = require('path');

const targetUrl = process.env.TEST_URL || 'https://deploy-mantis.vercel.app/';

test.describe('DeployMantis Landing Page Smoke Tests', () => {

  test('Availability - loads successfully and renders hero section', async ({ page }) => {
    const response = await page.goto(targetUrl);
    expect(response.status()).toBe(200);

    // Hero title is visible
    const heroTitle = page.locator('h1');
    await expect(heroTitle).toBeVisible();
    await expect(heroTitle).toContainText(/Your AI stack/i);

    // CTAs are visible above the fold
    const heroCTA = page.locator('.hero-content .btn-primary').first();
    await expect(heroCTA).toBeVisible();
  });

  test('Navigation - anchor links scroll and mobile menu works', async ({ page }) => {
    await page.goto(targetUrl);

    // Check header navigation links
    const setupLink = page.locator('.nav-links a[href="#how"]');
    await expect(setupLink).toBeVisible();

    // Test mobile drawer
    // Force mobile viewport size
    await page.setViewportSize({ width: 390, height: 844 });
    
    const menuToggle = page.locator('#mobile-toggle');
    await expect(menuToggle).toBeVisible();
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');

    // Click to open mobile nav drawer
    await menuToggle.click();
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
    
    const mobileDrawer = page.locator('#mobile-drawer');
    await expect(mobileDrawer).toBeVisible();
    await expect(mobileDrawer).toHaveAttribute('aria-hidden', 'false');

    // Wait for drawer open transition to complete
    await page.waitForTimeout(2000);

    // Take mobile menu open screenshot
    const screenshotsDir = process.env.SCREENSHOTS_DIR || '.';
    await page.screenshot({ path: path.join(screenshotsDir, 'mobile nav open.png') });

    // Click to close
    await menuToggle.click();
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('CTAs and links pointing to correct sections', async ({ page }) => {
    await page.goto(targetUrl);

    // Verify "Self-host now" button points to "#how" section
    const selfHostDesktop = page.locator('nav .btn-primary:has-text("Self-host now")');
    await expect(selfHostDesktop).toHaveAttribute('href', '#how');

    // Waitlist button points to "#cta"
    const waitlistDesktop = page.locator('nav .btn-ghost:has-text("Join waitlist")');
    await expect(waitlistDesktop).toHaveAttribute('href', '#cta');

    // Verify external links are not empty placeholders
    const githubLink = page.locator('footer a:has-text("GitHub"), footer a[href*="github"]');
    if (await githubLink.count() > 0) {
      const href = await githubLink.first().getAttribute('href');
      expect(href).not.toBe('#');
      expect(href).not.toContain('placeholder');
    }
  });

  test('Form validation and submission with mock API response', async ({ page }) => {
    await page.goto(targetUrl);

    const emailInput = page.locator('#signup-email');
    const submitBtn = page.locator('#signup-btn');
    const errorMsg = page.locator('#signup-error');
    const successCard = page.locator('#signup-success');

    await expect(emailInput).toBeVisible();

    // 1. Submit empty email
    await submitBtn.click();
    
    // 2. Submit invalid email
    await emailInput.fill('invalid-email');
    await submitBtn.click();
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText(/Please enter a valid email address/i);

    // 3. Submit valid email - intercept fetch request to formsubmit.co and mock success
    await page.route('**/formsubmit.co/ajax/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: "Mocked form submission successful" })
      });
    });

    await emailInput.fill('test-user@example.com');
    await submitBtn.click();

    // Success card should become visible, form should be hidden
    await expect(successCard).toBeVisible();
    await expect(page.locator('#signup-form')).not.toBeVisible();
    await expect(page.locator('#success-email')).toHaveText('test-user@example.com');
  });

  test('Theme Toggle - switches theme dark/light', async ({ page }) => {
    await page.goto(targetUrl);

    const html = page.locator('html');
    const initialTheme = await html.getAttribute('data-theme');
    expect(['dark', 'light']).toContain(initialTheme);

    const themeToggle = page.locator('[data-theme-toggle]');
    await expect(themeToggle).toBeVisible();

    // Toggle theme
    await themeToggle.click();
    const toggledTheme = await html.getAttribute('data-theme');
    expect(toggledTheme).not.toBe(initialTheme);

    // Toggle back
    await themeToggle.click();
    const finalTheme = await html.getAttribute('data-theme');
    expect(finalTheme).toBe(initialTheme);
  });

  test('Responsiveness, Layout & Screenshots', async ({ page }) => {
    const viewports = [
      { width: 1440, height: 900, name: 'desktop' },
      { width: 1024, height: 768, name: 'tablet' },
      { width: 390, height: 844, name: 'mobile' },
      { width: 375, height: 667, name: 'small-mobile' }
    ];

    const screenshotsDir = process.env.SCREENSHOTS_DIR || '.';

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(targetUrl);
      
      // Wait for entrance animations to settle
      await page.waitForTimeout(2000);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const innerWidth = await page.evaluate(() => window.innerWidth);
      if (scrollWidth > innerWidth) {
        const overflowingElements = await page.evaluate(() => {
          const elements = [];
          document.querySelectorAll('*').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
              elements.push({
                tagName: el.tagName,
                id: el.id,
                className: el.className,
                right: rect.right,
                width: rect.width
              });
            }
          });
          return elements;
        });
        console.error(`[Overflow Error] Detected horizontal overflow at viewport '${vp.name}' (${vp.width}x${vp.height}): scrollWidth=${scrollWidth}, innerWidth=${innerWidth}. Overflowing elements:`, overflowingElements);
      }
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

      // Take screenshots for desktop, mobile and pricing section
      if (vp.name === 'desktop') {
        await page.screenshot({ path: path.join(screenshotsDir, 'homepage desktop.png') });
        
        // Scroll to pricing section and take screenshot
        const pricingSection = page.locator('#pricing');
        await pricingSection.scrollIntoViewIfNeeded();
        // Wait for scroll transition to settle
        await page.waitForTimeout(2000);
        await page.screenshot({ path: path.join(screenshotsDir, 'pricing section.png') });
      } else if (vp.name === 'mobile') {
        await page.screenshot({ path: path.join(screenshotsDir, 'homepage mobile.png') });
      }
    }
  });

  test('Console error & network fail check', async ({ page }) => {
    const consoleErrors = [];
    const failedRequests = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('requestfailed', request => {
      failedRequests.push(`${request.url()}: ${request.failure().errorText}`);
    });

    await page.goto(targetUrl);

    // Let the page settle and scripts run
    await page.waitForTimeout(1000);

    console.log('Console Errors:', consoleErrors);
    console.log('Failed Requests:', failedRequests);

    // Check if there are any errors or failures.
    if (targetUrl.includes('localhost')) {
      // Allow zero unexpected console errors on local
      expect(consoleErrors.length).toBe(0);
      expect(failedRequests.length).toBe(0);
    }
  });

});
