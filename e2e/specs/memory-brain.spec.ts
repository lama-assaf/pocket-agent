// e2e/specs/memory-brain.spec.ts
// Capture a fact in a client scope via the real Brain panel UI, confirm it
// renders back, then confirm user-scope (Personal) isolation — a
// client-scoped fact must never leak into the Personal space (src/memory/scope.ts's
// resolveVisibleScopes contract).
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

const FACT_CONTENT = `E2E fact ${Date.now()} — zilliqa only, must not leak to Personal`;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir('memory-brain');
  launched = await launchApp(userDataDir);
  await bypassOnboardingToUsableState(launched.window);
});

test.afterAll(async () => {
  await closeApp(launched.app);
  cleanupUserData(userDataDir);
});

test('opens the Brain panel scoped to a client via the picker\u2019s "Memory & voice" link', async () => {
  const { window: page } = launched;
  // ui/chat/clients-view.js's cvLaunch() defaults a true first run straight
  // into the bundled Zilliqa client instead of the picker — open it explicitly.
  await page.click('#active-client-header');
  await expect(page.locator('#clients-view')).toHaveClass(/active/, { timeout: 15_000 });
  await page.click('[data-memory="client"][data-client="zilliqa"]');
  await expect(page.locator('#brain-view')).toHaveClass(/active/);
  await expect(page.locator('#brain-space-select')).toHaveValue('client:zilliqa');
});

test('captures a fact in the Facts tab and it renders back in the table', async () => {
  const { window: page } = launched;
  await page.click('.brain-nav-item[data-tab="facts"]');
  await expect(page.locator('#brain-facts')).toHaveClass(/active/);

  await page.fill('#wb-new-facts-subj', 'e2e-test-subject');
  await page.fill('#wb-new-facts-content', FACT_CONTENT);
  await page.click('#brain-facts-create .wb-add-btn');

  await expect(page.locator('#brain-facts-tbody')).toContainText(FACT_CONTENT, { timeout: 10_000 });
});

test('the fact is genuinely persisted (round-trips through the real IPC contract)', async () => {
  const facts = await launched.window.evaluate(() => window.pocketAgent.facts.list('client:zilliqa'));
  expect(facts.some((f) => f.content === FACT_CONTENT)).toBe(true);
});

test('switching the Brain space to Personal does NOT show the client-scoped fact (isolation)', async () => {
  const { window: page } = launched;
  await page.selectOption('#brain-space-select', 'user');
  // Facts tab is still the active tab across a space switch — no need to re-click it.
  await expect(page.locator('#brain-facts-scope')).not.toHaveText('', { timeout: 10_000 });
  await expect(page.locator('#brain-facts-tbody')).not.toContainText(FACT_CONTENT);

  const personalFacts = await page.evaluate(() => window.pocketAgent.facts.list('user'));
  expect(personalFacts.some((f) => f.content === FACT_CONTENT)).toBe(false);
});

test('switching back to the client scope still shows it (not actually deleted, just isolated)', async () => {
  const { window: page } = launched;
  await page.selectOption('#brain-space-select', 'client:zilliqa');
  await expect(page.locator('#brain-facts-tbody')).toContainText(FACT_CONTENT, { timeout: 10_000 });
});
