const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'https://localhost:8080';
const USER_EMAIL = process.env.USER_EMAIL || 'ola@example.com';
const USER_PASSWORD = process.env.USER_PASSWORD || 'ola12345';
const ENV_PROJECT_ID = process.env.PROJECT_ID || '';
const TEST_PROJECT_NAME = process.env.PROJECT_NAME || 'teste';
const OTHER_PROJECT_NAME = process.env.OTHER_PROJECT_NAME || 'teste vazio';
const N = 5;
const PROGRESS_TIMEOUT = 10000;

test.use({
  baseURL: BASE_URL,
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  actionTimeout: 180000,
});

test.setTimeout(900000);

function saveResultsCsv(results) {
  const csvPath = path.join(__dirname, 'results_experimental_configuration_metric1.csv');
  const header = 'iteration,metric1_ui_blocking_ms,total_processing_ms\n';
  const rows = results
    .map((r) => `${r.iteration},${r.metric1_ui_blocking_ms},${r.total_processing_ms}`)
    .join('\n');
  fs.writeFileSync(csvPath, header + rows + '\n', 'utf8');
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });

  const emailInput = page.getByLabel('Email', { exact: true });
  await expect(emailInput).toBeVisible({ timeout: 10000 });
  await emailInput.fill(USER_EMAIL);

  const passwordInput = page.getByLabel('Password', { exact: true });
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
  await passwordInput.fill(USER_PASSWORD);

  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith('/dashboard') ||
      (!url.pathname.includes('/login') && !url.pathname.includes('/auth')),
    { timeout: 20000 }
  );
}

async function collectSidebarProjects(page) {
  const links = page.locator(
    '[data-sidebar="sidebar"] a[href*="/dashboard/"], aside a[href*="/dashboard/"], nav a[href*="/dashboard/"]'
  );
  const count = await links.count();
  const projects = [];

  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const href = await link.getAttribute('href');
    const match = href && href.match(/\/dashboard\/([a-zA-Z0-9_-]+)(?:\?|$)/);
    if (!match || match[1] === 'account') continue;
    if (projects.some((project) => project.pid === match[1])) continue;
    projects.push({ pid: match[1], name: (await link.innerText()).trim(), link });
  }

  return projects;
}

async function resolveTestProject(page) {
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
  await expect
    .poll(async () => (await collectSidebarProjects(page)).length, { timeout: 15000 })
    .toBeGreaterThan(0);

  const projects = await collectSidebarProjects(page);
  if (ENV_PROJECT_ID && projects.some((project) => project.pid === ENV_PROJECT_ID)) {
    return ENV_PROJECT_ID;
  }

  const namedProject = projects.find((project) => project.name === TEST_PROJECT_NAME);
  return namedProject ? namedProject.pid : projects[0].pid;
}

async function stopResidualProcessing(page) {
  const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true }).first();
  if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cancelButton.click();
    await expect(cancelButton).toBeHidden({ timeout: 30000 });
  }
}

async function addPipelineTool(page) {
  const toolLabels = ['Brightness', 'Binarization', 'Rotate', 'Contrast', 'Saturation'];

  for (const label of toolLabels) {
    const trigger = page.getByRole('button', { name: label, exact: true }).first();
    if (!(await trigger.isVisible().catch(() => false))) continue;
    if (await trigger.isDisabled().catch(() => false)) continue;

    await trigger.click();
    const saveButton = page.getByRole('button', { name: 'Save', exact: true }).first();
    if (!(await saveButton.isVisible().catch(() => false))) continue;

    if (await saveButton.isDisabled()) {
      const slider = page.getByRole('slider').first();
      if (await slider.isVisible().catch(() => false)) {
        await slider.focus();
        await slider.press('ArrowRight');
      }
    }

    if (await saveButton.isEnabled().catch(() => false)) {
      await saveButton.click();
      return;
    }

    await page.keyboard.press('Escape');
  }
}

async function openProject(page, testPid, view = 'grid') {
  const query = view === 'grid' ? '?mode=edit' : `?mode=edit&view=${view}`;
  await page.goto(`${BASE_URL}/dashboard/${testPid}${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Apply', exact: true }).first()).toBeVisible({
    timeout: 15000,
  });
}

async function ensureReadyToApply(page, testPid) {
  await openProject(page, testPid);
  const applyButton = page.getByRole('button', { name: 'Apply', exact: true }).first();

  if (await applyButton.isDisabled()) {
    await stopResidualProcessing(page);
    await expect(applyButton).toBeEnabled({ timeout: 30000 }).catch(() => {});
  }

  if (await applyButton.isDisabled()) {
    await addPipelineTool(page);
    await expect(applyButton).toBeEnabled({ timeout: 30000 }).catch(() => {});
  }

  if (await applyButton.isDisabled()) {
    await openProject(page, testPid, 'carousel');
    await addPipelineTool(page);
  }

  await expect(applyButton).toBeEnabled({ timeout: 15000 });
  return applyButton;
}

async function findOtherProjectLink(page, testPid) {
  const namedLink = page.getByRole('link', { name: OTHER_PROJECT_NAME, exact: true }).first();
  if (await namedLink.isVisible({ timeout: 3000 }).catch(() => false)) return namedLink;

  const otherProject = (await collectSidebarProjects(page)).find((project) => project.pid !== testPid);
  if (otherProject) return otherProject.link;

  throw new Error(`No sidebar link to a project other than "${testPid}" was found.`);
}

test('Usability Experimental Configuration Benchmark: Metric 1 - UI Blocking Duration', async ({ page }) => {
  let applyClickedAt = 0;
  let processingEndedAt = 0;

  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const payload = typeof frame.payload === 'string' ? frame.payload : '';
      const isLegacyDone =
        payload.includes('"preview-ready"') ||
        payload.includes('"process-update"') ||
        payload.includes('"preview-error"') ||
        payload.includes('"process-error"');
      const isExecutionDone =
        payload.includes('"execution-update"') &&
        (payload.includes('"completed"') || payload.includes('"error"'));

      if ((isLegacyDone || isExecutionDone) && applyClickedAt > 0 && processingEndedAt === 0) {
        processingEndedAt = Date.now();
      }
    });
  });

  await login(page);
  const testPid = await resolveTestProject(page);
  const results = [];

  for (let iteration = 1; iteration <= N; iteration++) {
    console.log(`\n=================== ITERATION ${iteration}/${N} ===================`);
    processingEndedAt = 0;

    const applyButton = await ensureReadyToApply(page, testPid);
    const otherProjectLink = await findOtherProjectLink(page, testPid);

    const tStartApply = Date.now();
    applyClickedAt = tStartApply;
    await applyButton.click();

    await page.getByRole('progressbar').first().waitFor({ state: 'visible', timeout: PROGRESS_TIMEOUT });
    await expect(page.getByRole('status').first()).toBeVisible({ timeout: 5000 }).catch(() => {});

    await otherProjectLink.click();
    await page.waitForURL(
      (url) => url.pathname.includes('/dashboard/') && !url.pathname.includes(testPid),
      { waitUntil: 'commit', timeout: 30000 }
    );
    const metric1_ms = Date.now() - tStartApply;

    const observedProcessingMs = processingEndedAt > 0 ? processingEndedAt - tStartApply : 0;

    await openProject(page, testPid);
    await stopResidualProcessing(page);

    const totalProcessingMs = observedProcessingMs > 0 ? observedProcessingMs : Date.now() - tStartApply;
    applyClickedAt = 0;

    console.log(`[Metric 1] Time until navigation to another project: ${metric1_ms} ms`);
    console.log(`[Iteration ${iteration}] Processing duration before cleanup: ${totalProcessingMs} ms`);

    results.push({
      iteration,
      metric1_ui_blocking_ms: metric1_ms,
      total_processing_ms: totalProcessingMs,
    });

    saveResultsCsv(results);
  }

  console.log('\n--- Metric 1 benchmark finished. Results saved to benchmarks/results_experimental_configuration_metric1.csv ---');
});
