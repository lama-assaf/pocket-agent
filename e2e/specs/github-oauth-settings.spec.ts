// e2e/specs/github-oauth-settings.spec.ts
// Settings > GitHub > "OAuth App Client ID": typing a value and clicking Save
// must show the real success toast (not the generic "Oops, couldn't save
// that" error) and the value must actually persist through the real
// settings:set IPC contract — regression coverage for the missing
// `github.clientId`/`github.token` excludedIds entry in
// ui/chat/settings-panel.js's _stgSetupAutoSave(), which used to race the
// button's own save with a duplicate autosave write on blur.
import { test, expect } from '@playwright/test';
import {
  launchApp,
  closeApp,
  cleanupUserData,
  makeUserDataDir,
  bypassOnboardingToUsableState,
  type LaunchedApp,
} from '../fixtures/electron-app';

test.describe.configure({ mode: 'serial' });

let userDataDir: string;
let launched: LaunchedApp;

const CLIENT_ID = 'Ov23liBeg5iTcdoTEJR2';

test.beforeAll(async () => {
  userDataDir = makeUserDataDir('github-oauth-settings');
  launched = await launchApp(userDataDir);
  await bypassOnboardingToUsableState(launched.window);
});

test.afterAll(async () => {
  await closeApp(launched.app);
  cleanupUserData(userDataDir);
});

test('saving a GitHub OAuth App Client ID shows the success toast, not the save-error toast', async () => {
  const { window: page } = launched;

  await page.click('#sidebar-settings-btn');
  await expect(page.locator('#settings-view')).toHaveClass(/active/, { timeout: 15_000 });

  await page.click('.settings-nav-item[data-section="github"]');
  await expect(page.locator('#github')).toHaveClass(/active/);

  await page.fill('#github\\.clientId', CLIENT_ID);
  await page.click('#github .key-input button');

  await expect(page.locator('.notyf__message')).toContainText('GitHub Client ID saved', {
    timeout: 10_000,
  });
  await expect(page.locator('.notyf__message')).not.toContainText("couldn't save that");
});

test('the client ID actually persisted (round-trips through the real IPC contract)', async () => {
  const { window: page } = launched;
  const saved = await page.evaluate(() => window.pocketAgent.settings.get('github.clientId'));
  expect(saved).toBe(CLIENT_ID);
});
