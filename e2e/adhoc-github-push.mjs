// e2e/adhoc-github-push.mjs
// Ad-hoc, one-off Playwright script (not part of the committed spec suite):
// drives the REAL installed app's userData profile through the UI to save a
// pasted GitHub PAT and Pull+Publish two live clients' brains. Never prints
// the token — only a masked form.
// Uses the 'playwright' package directly (not '@playwright/test', which is
// listed in package.json but not actually present in node_modules here) —
// '_electron' is the same export either way.
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

const REPO_ROOT = process.cwd();
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'main', 'index.js');
const REAL_USER_DATA = path.join(os.homedir(), 'Library/Application Support/pocket-agent');

function mask(token) {
  if (!token) return '(empty)';
  return `${token.slice(0, 4)}...${token.slice(-4)} (len ${token.length})`;
}

/**
 * Wait for a NEW toast beyond whatever's already on screen (stale toasts from
 * app startup, e.g. "Failed to load MCP servers", were observed sitting in
 * the corner during this run — grabbing .last() alone risks reading one of
 * those instead of the toast our own action just triggered).
 */
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
  const token = fs.readFileSync(path.join(REPO_ROOT, '.gh-token'), 'utf8').trim();
  console.log(`[adhoc] Token loaded: ${mask(token)}`);

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
  page.on('console', (msg) => console.log(`[renderer console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => console.log(`[renderer pageerror] ${err.message}`));
  app.process().stdout?.on('data', (d) => console.log(`[main stdout] ${d.toString().trim()}`));
  app.process().stderr?.on('data', (d) => console.log(`[main stderr] ${d.toString().trim()}`));

  const results = {};

  try {
    // --- Settings > GitHub: paste PAT, save ---
    await page.click('#sidebar-settings-btn');
    await page.waitForSelector('#settings-view.active', { timeout: 15_000 });
    await page.click('.settings-nav-item[data-section="github"]');
    await page.waitForSelector('#github.active', { timeout: 5_000 });

    // The PAT input lives inside a collapsed <details> disclosure
    // ("Advanced: use a Personal Access Token instead") — must open it
    // before the input becomes visible/fillable.
    await page.click('#github details summary');
    await page.waitForSelector('#github\\.token', { state: 'visible', timeout: 5_000 });
    await page.fill('#github\\.token', token);
    const preSaveToasts = await toastCount(page);
    // Scoped to the <details> disclosure specifically — '#github .key-input
    // button:has-text("Save")' alone also matches the OAuth App Client ID's
    // Save button (comes first in the DOM) and page.click() clicks the FIRST
    // match rather than erroring on ambiguity, which silently saved the
    // wrong field on the previous run.
    await page.click('#github details .key-input button:has-text("Save")');

    const tokenSaveText = await waitForNewToast(page, preSaveToasts);
    const tokenSaved = tokenSaveText.includes('GitHub token saved');
    console.log(`[adhoc] Token save toast: "${tokenSaveText}" -> saved=${tokenSaved}`);
    results.tokenSaved = tokenSaved;
    results.tokenSaveToast = tokenSaveText;

    // Verify it round-tripped through the real settings IPC (masked presence only).
    const savedPresent = await page.evaluate(async () => {
      const all = await window.pocketAgent.settings.getAll();
      return typeof all['github.token'] === 'string' && all['github.token'].length > 0;
    });
    console.log(`[adhoc] github.token present after save: ${savedPresent}`);
    results.tokenPresentAfterSave = savedPresent;

    // --- Brain panel: pull + publish for each client ---
    // sidebar-brain-btn is a TOGGLE (toggleBrainPanel()) — open it once,
    // outside the loop, then just switch the space-select for each client;
    // clicking it again on the 2nd iteration while already open would close it.
    await page.click('#sidebar-brain-btn');
    await page.waitForSelector('#brain-view.active', { timeout: 10_000 });

    for (const clientId of ['ltin', 'zilliqa']) {
      console.log(`\n[adhoc] === Client: ${clientId} ===`);
      // #brain-space-select's <option value> is the memory SCOPE string
      // ('client:<id>'), not the bare client id — see
      // _brainPopulateSpaceOptions() in ui/chat/brain-panel.js. <option>
      // elements inside a closed <select> are never reported 'visible' by
      // Playwright's actionability model — wait for DOM attachment instead.
      await page.waitForSelector(`#brain-space-select option[value="client:${clientId}"]`, {
        state: 'attached',
        timeout: 10_000,
      });
      await page.selectOption('#brain-space-select', `client:${clientId}`);
      await page.dispatchEvent('#brain-space-select', 'change');
      // Let the space-select's change handler load the new scope's sync bar.
      await page.waitForTimeout(1_000);

      const clientResult = { clientId };

      // Pull — brainPullActive() sets #brain-sync-status to 'pulling…' then
      // awaits sync.pull() and overwrites it again via _brainRefreshSyncStatus;
      // poll until it's no longer the transient 'pulling…' text.
      const prePullToasts = await toastCount(page);
      await page.click('#brain-pull-btn');
      try {
        await page.waitForFunction(
          () => document.getElementById('brain-sync-status')?.textContent !== 'pulling…',
          { timeout: 30_000 }
        );
      } catch {
        /* fall through to toast/status inspection below regardless */
      }
      const pullToast = await waitForNewToast(page, prePullToasts, 5_000);
      const pullStatusText = await page
        .locator('#brain-sync-status')
        .innerText()
        .catch(() => '(status unreadable)');
      console.log(`[adhoc] ${clientId} pull toast: "${pullToast}" | status bar: "${pullStatusText}"`);
      clientResult.pullToast = pullToast;
      clientResult.pullStatusText = pullStatusText;

      // Publish — same transient-text polling pattern as pull above.
      const prePublishToasts = await toastCount(page);
      await page.click('#brain-publish-btn');
      try {
        await page.waitForFunction(
          () => document.getElementById('brain-sync-status')?.textContent !== 'publishing…',
          { timeout: 30_000 }
        );
      } catch {
        /* fall through */
      }
      const publishToast = await waitForNewToast(page, prePublishToasts, 5_000);
      const publishStatusText = await page
        .locator('#brain-sync-status')
        .innerText()
        .catch(() => '(status unreadable)');
      console.log(
        `[adhoc] ${clientId} publish toast: "${publishToast}" | status bar: "${publishStatusText}"`
      );
      clientResult.publishToast = publishToast;
      clientResult.publishStatusText = publishStatusText;

      results[clientId] = clientResult;
    }
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
