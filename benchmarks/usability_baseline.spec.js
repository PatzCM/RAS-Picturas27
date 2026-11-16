const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'https://localhost:8080';
const USER_EMAIL = process.env.USER_EMAIL || 'ola@example.com';
const USER_PASSWORD = process.env.USER_PASSWORD || 'ola12345';
const ENV_PROJECT_ID = process.env.PROJECT_ID || '6afadf4d7f9432a51decd5e1';
const N = 5;

test.use({
  baseURL: BASE_URL,
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  actionTimeout: 120000,
});

test.setTimeout(600000); // 10 minutes total for N=5 iterations

function saveResultsCsv(results) {
  const csvPath = path.join(__dirname, 'results.csv');
  const header = 'iteration,metric1_ui_blocking_ms,metric2_recovered,metric2_recovery_time_ms\n';
  const rows = results
    .map(
      (r) =>
        `${r.iteration},${r.metric1_ui_blocking_ms},${r.metric2_recovered},${r.metric2_recovery_time_ms}`
    )
    .join('\n');
  fs.writeFileSync(csvPath, header + rows + '\n', 'utf8');
}

test('Usability Baseline Benchmark: UI Blocking & Post-F5 Recovery', async ({ page }) => {
  // 1. Login
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const emailInput = page
    .locator('#email, input[type="email"], input[name="email"]')
    .first();
  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await emailInput.fill(USER_EMAIL);
    const passInput = page
      .locator('#password, input[type="password"], input[name="password"]')
      .first();
    await passInput.fill(USER_PASSWORD);
    const submitBtn = page
      .locator(
        'button[type="submit"]:has-text("Login"), button:has-text("Login"), button[type="submit"]'
      )
      .first();
    await submitBtn.click();
    await page.waitForURL(
      (url) => !url.pathname.includes('/login') && !url.pathname.includes('/auth'),
      { timeout: 15000 }
    );
    await page.waitForTimeout(1000);
  }

  // 2. Identify test project and a second project in sidebar
  let testPid = ENV_PROJECT_ID;
  if (!testPid) {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const projectLinks = page.locator(
      '[data-sidebar="sidebar"] a[href*="/dashboard/"], aside a[href*="/dashboard/"], nav a[href*="/dashboard/"], a[href*="/dashboard/"]'
    );
    const count = await projectLinks.count();
    const foundPids = [];
    for (let i = 0; i < count; i++) {
      const href = await projectLinks.nth(i).getAttribute('href');
      if (href) {
        const match = href.match(/\/dashboard\/([a-zA-Z0-9_-]+)/);
        if (match && match[1] && !foundPids.includes(match[1])) {
          foundPids.push(match[1]);
        }
      }
    }

    if (foundPids.length === 0) {
      throw new Error(
        'Nenhum projeto encontrado. Cria um projeto com vídeo de teste antes de correr o benchmark.'
      );
    }
    testPid = foundPids[0];
  }

  // Define selectors identified from frontend/app/dashboard/[pid]/page.tsx
  const applyButtonSelector = 'button:has-text("Apply")';
  const overlaySelector = 'div.bg-black\\/70, div[class*="bg-black/70"]';
  const progressBarSelector = '[role="progressbar"]';
  const cancelButtonSelector = 'button:has-text("Cancelar")';

  const results = [];

  for (let iteration = 1; iteration <= N; iteration++) {
    console.log(`\n=================== ITERATION ${iteration}/${N} ===================`);

    // --- SETUP: Open test project in edit mode ---
    await page.goto(`${BASE_URL}/dashboard/${testPid}?mode=edit`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1500);

    const applyButton = page.locator(applyButtonSelector).first();
    await applyButton.waitFor({ state: 'visible', timeout: 15000 });

    // If pipeline is empty (Apply disabled), select an available tool or preset to enable Apply
    if (await applyButton.isDisabled()) {
      const toolButton = page
        .locator(
          'aside button, [data-sidebar] ~ div button, button:has-text("Rotate"), button:has-text("Brightness"), button:has-text("Binarization")'
        )
        .first();
      if (await toolButton.isVisible().catch(() => false)) {
        await toolButton.click();
        await page.waitForTimeout(800);
      }
    }
// --- METRIC 1: UI Blocking ---
    // Find the target project ("teste vazio") in the sidebar
    const otherProjectLink = page
      .locator('[data-sidebar="sidebar"], aside, nav')
      .getByText('teste vazio', { exact: true })
      .first();

    const hasOtherProject = await otherProjectLink.isVisible().catch(() => false);
    if (!hasOtherProject) {
      console.warn(
        'Warning: Project "teste vazio" not found in sidebar; measuring until overlay hides.'
      );
    }

    const tStartApply = Date.now();
    await applyButton.click();

    // Wait for the blocking overlay (bg-black/70) to appear
    const overlay = page.locator(overlaySelector).first();
    await overlay.waitFor({ state: 'visible', timeout: 10000 });

    let metric1_ms = 0;
    if (hasOtherProject) {
      // Clicking is blocked while the bg-black/70 overlay covers the screen.
      // Once processing completes and the overlay is removed, the click takes effect and the URL changes.
      await otherProjectLink.click({ timeout: 120000 });
      await page.waitForURL((url) => !url.pathname.includes(testPid), {
        waitUntil: 'commit',
        timeout: 30000,
      });
      metric1_ms = Date.now() - tStartApply;
    } else {
      await overlay.waitFor({ state: 'hidden', timeout: 120000 });
      metric1_ms = Date.now() - tStartApply;
    }

    console.log(`[Metric 1] UI blocking duration: ${metric1_ms} ms`);

    // --- METRIC 2: Recovery after F5 ---
    // Reopen the test project in edit mode
    await page.goto(`${BASE_URL}/dashboard/${testPid}?mode=edit`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1500);

    const applyButtonM2 = page.locator(applyButtonSelector).first();
    await applyButtonM2.waitFor({ state: 'visible', timeout: 15000 });

    // Submit pipeline
    await applyButtonM2.click();

    // Wait for processing to begin (overlay visible)
    const overlayM2 = page.locator(overlaySelector).first();
    await overlayM2.waitFor({ state: 'visible', timeout: 10000 });

    // Wait 1.5s to reach the midpoint of processing
    await page.waitForTimeout(1500);

    // Execute page.reload()
    const tReloadStart = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Check whether the progress bar and the Cancel button become visible again
    let metric2_recovered = 0;
    let metric2_recovery_ms = 0;

    try {
      const progressBar = page.locator(progressBarSelector).first();
      const cancelButton = page.locator(cancelButtonSelector).first();

      await Promise.all([
        progressBar.waitFor({ state: 'visible', timeout: 4000 }),
        cancelButton.waitFor({ state: 'visible', timeout: 4000 }),
      ]);

      metric2_recovered = 1;
      metric2_recovery_ms = Date.now() - tReloadStart;
      console.log(
        `[Metric 2] Post-F5 recovery SUCCEEDED: ${metric2_recovery_ms} ms`
      );
    } catch {
      metric2_recovered = 0;
      metric2_recovery_ms = 0;
      console.log('[Metric 2] Post-F5 recovery DID NOT OCCUR (0)');
    }

    // Wait for residual background processing to finish before the next iteration
    await page.waitForTimeout(Math.max(5000, metric1_ms));

    results.push({
      iteration,
      metric1_ui_blocking_ms: metric1_ms,
      metric2_recovered,
      metric2_recovery_time_ms: metric2_recovery_ms,
    });

    saveResultsCsv(results);
  }

  console.log('\n--- Benchmark finished. Results saved to benchmarks/results.csv ---');
});
