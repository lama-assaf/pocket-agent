// e2e/specs/clients-projects.spec.ts
// Create a client, create a project under it, select it, then close +
// relaunch the SAME profile dir and requery — proving on-disk persistence,
// not just in-memory renderer state.
import { test, expect } from '@playwright/test';
import {
  launchApp,
  relaunchApp,
  closeApp,
  cleanupUserData,
  makeUserDataDir,
  bypassOnboardingToUsableState,
  type LaunchedApp,
} from '../fixtures/electron-app';

test.describe.configure({ mode: 'serial' });

let userDataDir: string;
let launched: LaunchedApp;

const CLIENT_NAME = `E2E Client ${Date.now()}`;
const CLIENT_ID = CLIENT_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const PROJECT_NAME = 'E2E Project';
const PROJECT_ID = `${CLIENT_ID}-e2e-project`.slice(0, 60);

test.beforeAll(async () => {
  userDataDir = makeUserDataDir('clients-projects');
  launched = await launchApp(userDataDir);
  await bypassOnboardingToUsableState(launched.window);
});

test.afterAll(async () => {
  await closeApp(launched.app);
  cleanupUserData(userDataDir);
});

test('first post-onboarding launch opens straight into the bundled Zilliqa client, not the picker', async () => {
  const { window: page } = launched;
  // ui/chat/clients-view.js's cvLaunch(): a true first run (no 'cvHasLaunched'
  // yet) auto-selects the bundled 'zilliqa' seed client instead of showing
  // the picker, so the app ships pre-configured with zero setup.
  await expect(page.locator('#clients-view')).not.toHaveClass(/active/, { timeout: 15_000 });
  const activeWorkspace = await page.evaluate(() =>
    (window as unknown as { getActiveWorkspace: () => unknown }).getActiveWorkspace()
  );
  expect(activeWorkspace).toMatchObject({ contextType: 'client', clientId: 'zilliqa' });
  await expect(page.locator('#active-client-name')).toHaveText('Zilliqa');
});

test('the picker still shows both bundled clients when opened explicitly', async () => {
  const { window: page } = launched;
  await page.click('#active-client-header');
  await expect(page.locator('#clients-view')).toHaveClass(/active/, { timeout: 10_000 });
  // Bundled defaults from src/clients/seeds/*.json — confirms the picker is
  // reading real seeded data, not an empty grid. Scoped to [data-select]
  // (the card's own click target) since [data-client="zilliqa"] alone also
  // matches that same card's "Memory & voice" link (data-memory="client").
  await expect(page.locator('#cv-grid [data-select="client"][data-client="zilliqa"]')).toHaveCount(1);
  await expect(page.locator('#cv-grid [data-select="client"][data-client="ltin"]')).toHaveCount(1);
});

test('creates a new client via the real picker UI', async () => {
  const { window: page } = launched;
  await page.click('#cv-new-client-btn');
  await page.fill('.cv-prompt-input', CLIENT_NAME);
  await page.click('.cv-prompt-ok');

  const card = page.locator(`#cv-grid [data-select="client"][data-client="${CLIENT_ID}"]`);
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await expect(card.locator('.cv-card-name')).toHaveText(CLIENT_NAME);
});

test('creates a project under the new client', async () => {
  const { window: page } = launched;
  // cvCreateClient() routes straight into the Brain panel for the new client
  // right after creation (a brand-new brand has no voice yet, so the app
  // deep-links there instead of leaving it a dead-end) — navigate back to
  // the picker before interacting with its "+ Project" chip.
  await page.click('#brain-view button:has-text("Back")');
  await page.click('#active-client-header');
  await expect(page.locator('#clients-view')).toHaveClass(/active/);

  await page.click(`[data-new-project="${CLIENT_ID}"]`);
  await page.fill('.cv-prompt-input', PROJECT_NAME);
  await page.click('.cv-prompt-ok');

  const projectChip = page.locator(
    `[data-select="project"][data-client="${CLIENT_ID}"][data-project="${PROJECT_ID}"]`
  );
  await expect(projectChip).toHaveCount(1, { timeout: 10_000 });
});

test('selecting the project makes it the active workspace', async () => {
  const { window: page } = launched;
  await page.click(
    `[data-select="project"][data-client="${CLIENT_ID}"][data-project="${PROJECT_ID}"]`
  );
  await expect(page.locator('#clients-view')).not.toHaveClass(/active/, { timeout: 10_000 });

  const activeWorkspace = await page.evaluate(() => {
    // getActiveWorkspace is a real global from clients-view.js (not part of
    // the typed window.pocketAgent contract, hence the cast).
    return (window as unknown as { getActiveWorkspace: () => unknown }).getActiveWorkspace();
  });
  expect(activeWorkspace).toMatchObject({ contextType: 'project', projectKey: PROJECT_ID });
});

test('both the client and project persist across a full app restart', async () => {
  launched = await relaunchApp(launched);

  const clients = await launched.window.evaluate(() => window.pocketAgent.clients.list());
  expect(clients.some((c) => c.id === CLIENT_ID && c.name === CLIENT_NAME)).toBe(true);

  const projects = await launched.window.evaluate(
    (clientId) => window.pocketAgent.projects.list(clientId),
    CLIENT_ID
  );
  expect(projects.some((p) => p.id === PROJECT_ID && p.name === PROJECT_NAME)).toBe(true);
});
