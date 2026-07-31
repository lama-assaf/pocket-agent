// e2e/specs/first-run-default-workspace.spec.ts
// A fresh install should open pre-configured with zero setup: land straight
// in the bundled Zilliqa client instead of the picker (ui/chat/clients-view.js
// cvLaunch()). That default must only apply ONCE — any later launch respects
// whatever workspace the user last picked, including switching back to
// Personal or over to LTIN.
import { test, expect } from '@playwright/test';
import {
  launchApp,
  relaunchApp,
  closeApp,
  cleanupUserData,
  makeUserDataDir,
  bypassOnboardingToUsableState,
  PERSONAL_CONTEXT,
  type LaunchedApp,
} from '../fixtures/electron-app';

test.describe.configure({ mode: 'serial' });

let userDataDir: string;
let launched: LaunchedApp;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir('first-run-default-workspace');
  launched = await launchApp(userDataDir);
  await bypassOnboardingToUsableState(launched.window);
});

test.afterAll(async () => {
  await closeApp(launched.app);
  cleanupUserData(userDataDir);
});

test('true first run defaults the active workspace to the bundled Zilliqa client', async () => {
  const { window: page } = launched;
  await expect(page.locator('#clients-view')).not.toHaveClass(/active/, { timeout: 15_000 });
  const activeWorkspace = await page.evaluate(() =>
    (window as unknown as { getActiveWorkspace: () => unknown }).getActiveWorkspace()
  );
  expect(activeWorkspace).toMatchObject({ contextType: 'client', clientId: 'zilliqa' });
});

test('switching to Personal persists across a full app restart instead of re-forcing Zilliqa', async () => {
  const { window: page } = launched;
  await page.evaluate(
    (ctx) => (window as unknown as { cvSelectWorkspace: (ws: unknown) => Promise<void> }).cvSelectWorkspace(ctx),
    PERSONAL_CONTEXT
  );
  const afterSwitch = await page.evaluate(() =>
    (window as unknown as { getActiveWorkspace: () => unknown }).getActiveWorkspace()
  );
  expect(afterSwitch).toMatchObject({ contextType: 'personal' });

  launched = await relaunchApp(launched);
  const { window: page2 } = launched;

  // Second launch: cvLaunch() must NOT re-apply the Zilliqa default — it
  // should resume Personal, the last thing the user explicitly picked.
  await expect(page2.locator('#clients-view')).not.toHaveClass(/active/, { timeout: 15_000 });
  const activeWorkspace = await page2.evaluate(() =>
    (window as unknown as { getActiveWorkspace: () => unknown }).getActiveWorkspace()
  );
  expect(activeWorkspace).toMatchObject({ contextType: 'personal' });
});

test('switching to LTIN also persists across a restart', async () => {
  const { window: page } = launched;
  await page.evaluate(() =>
    (window as unknown as { cvSelectWorkspace: (ws: unknown) => Promise<void> }).cvSelectWorkspace({
      contextType: 'client',
      clientId: 'ltin',
      projectKey: null,
    })
  );
  const afterSwitch = await page.evaluate(() =>
    (window as unknown as { getActiveWorkspace: () => unknown }).getActiveWorkspace()
  );
  expect(afterSwitch).toMatchObject({ contextType: 'client', clientId: 'ltin' });

  launched = await relaunchApp(launched);
  const { window: page2 } = launched;
  const activeWorkspace = await page2.evaluate(() =>
    (window as unknown as { getActiveWorkspace: () => unknown }).getActiveWorkspace()
  );
  expect(activeWorkspace).toMatchObject({ contextType: 'client', clientId: 'ltin' });
});
