// e2e/adhoc-zilliqa-publish.mjs
// Ad-hoc, one-off Playwright script (not part of the committed spec suite):
// drives the REAL installed app's userData profile through the UI to
// Pull+Publish the zilliqa client's brain after a large local docs/ +
// .atelier/memory addition (see the Zilliqa-comms import task). Token is
// already saved from a prior run — this only verifies presence, doesn't
// re-save. Never prints the token — only a masked form.
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

const REPO_ROOT = process.cwd();
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'main', 'index.js');
const REAL_USER_DATA = path.join(os.homedir(), 'Library/Application Support/pocket-agent');

async function waitForNewToast(page, priorCount, timeoutMs = 10_000) {
  await page
    .waitForFunction(
      (n) => document.querySelectorAll('.notyf__message').length > n,
      priorCount,
      { timeout: timeoutMs }
    )
    .catch(() => {});
  return page
    .locator('.notyf__message')
    .last()
    .innerText()
    .catch(() => '(no toast)');
}

async function toastCount(page) {
  return page.locator('.notyf__message').count();
}

async function main() {
  if (!fs.existsSync(DIST_MAIN)) {
    throw new Error(`dist/main/index.js not found at ${DIST_MAIN}`);
  }

  console.log(`[adhoc] Launching app against REAL userData dir: ${REAL_USER_DATA}`);
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${REAL_USER_DATA}`],
    cwd: REPO_ROOT,
  });

  let page = app.windows()[0];
  if (!page) {
    try {
      page = await app.waitForEvent('window', { timeout: 8_000 });
    } catch {
      const windowPromise = app.waitForEvent('window', { timeout: 20_000 });
      await app.evaluate(({ app: electronApp }) => {
        electronApp.emit('activate', {}, true);
      });
      page = await windowPromise;
    }
  }
  await page.waitForLoadState('domcontentloaded');
  console.log('[adhoc] Renderer window ready');
  page.on('pageerror', (err) => console.log(`[renderer pageerror] ${err.message}`));

  const results = {};

  try {
    // Verify the token is still present (saved in a prior run) — do NOT re-save.
    const tokenPresent = await page.evaluate(async () => {
      const all = await window.pocketAgent.settings.getAll();
      return typeof all['github.token'] === 'string' && all['github.token'].length > 0;
    });
    console.log(`[adhoc] github.token present: ${tokenPresent}`);
    results.tokenPresent = tokenPresent;
    if (!tokenPresent) throw new Error('github.token not set — cannot publish');

    await page.click('#sidebar-brain-btn');
    await page.waitForSelector('#brain-view.active', { timeout: 10_000 });

    const clientId = 'zilliqa';
    await page.waitForSelector(`#brain-space-select option[value="client:${clientId}"]`, {
      state: 'attached',
      timeout: 10_000,
    });
    await page.selectOption('#brain-space-select', `client:${clientId}`);
    await page.dispatchEvent('#brain-space-select', 'change');
    await page.waitForTimeout(1_000);

    // Pull first (per task instructions) — merges any remote-only changes
    // before we publish our large local addition on top.
    const prePullToasts = await toastCount(page);
    await page.click('#brain-pull-btn');
    try {
      await page.waitForFunction(
        () => document.getElementById('brain-sync-status')?.textContent !== 'pulling…',
        { timeout: 30_000 }
      );
    } catch {
      /* fall through */
    }
    const pullToast = await waitForNewToast(page, prePullToasts, 5_000);
    const pullStatusText = await page
      .locator('#brain-sync-status')
      .innerText()
      .catch(() => '(status unreadable)');
    console.log(`[adhoc] zilliqa pull toast: "${pullToast}" | status bar: "${pullStatusText}"`);
    results.pullToast = pullToast;
    results.pullStatusText = pullStatusText;

    // Publish — there's a lot of new content (docs/ ~69 files + 6 new memory
    // items), so give the commit+push a generous timeout.
    const prePublishToasts = await toastCount(page);
    await page.click('#brain-publish-btn');
    try {
      await page.waitForFunction(
        () => document.getElementById('brain-sync-status')?.textContent !== 'publishing…',
        { timeout: 90_000 }
      );
    } catch {
      /* fall through */
    }
    const publishToast = await waitForNewToast(page, prePublishToasts, 15_000);
    const publishStatusText = await page
      .locator('#brain-sync-status')
      .innerText()
      .catch(() => '(status unreadable)');
    console.log(
      `[adhoc] zilliqa publish toast: "${publishToast}" | status bar: "${publishStatusText}"`
    );
    results.publishToast = publishToast;
    results.publishStatusText = publishStatusText;
  } finally {
    await app.close();
    console.log('\n[adhoc] App closed');
  }

  console.log('\n[adhoc] === SUMMARY (JSON) ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error('[adhoc] FAILED:', err);
  process.exit(1);
});
