// e2e/specs/app-launch.spec.ts
// True first-run smoke test: process launches against a brand-new isolated
// profile, opens its one window (isFirstRun() === true is the only path
// that auto-opens a window — see docs/e2e/PLAN.md), renders onboarding, and
// never logs a fatal main-process error along the way.
import { test, expect } from '@playwright/test';
import {
  launchApp,
  closeApp,
  cleanupUserData,
  makeUserDataDir,
  type LaunchedApp,
} from '../fixtures/electron-app';

test.describe.configure({ mode: 'serial' });

let userDataDir: string;
let launched: LaunchedApp;
const mainProcessStderr: string[] = [];
const rendererErrors: string[] = [];

test.beforeAll(async () => {
  userDataDir = makeUserDataDir('app-launch');
  launched = await launchApp(userDataDir);

  launched.app.process().stderr?.on('data', (chunk: Buffer) => {
    mainProcessStderr.push(chunk.toString());
  });
  launched.window.on('pageerror', (err) => {
    rendererErrors.push(err.message);
  });
});

test.afterAll(async () => {
  await closeApp(launched.app);
  cleanupUserData(userDataDir);
});

test('main window opens with the r3to.os title', async () => {
  const title = await launched.window.title();
  expect(title).toContain('r3to.os');
});

test('renders the app shell (body is ready, no blank window)', async () => {
  await launched.window.waitForSelector('body.app-ready', { timeout: 15_000 });
  const bodyHtml = await launched.window.locator('body').innerHTML();
  expect(bodyHtml.length).toBeGreaterThan(0);
});

test('a fresh install with no credentials shows the onboarding screen', async () => {
  const onboarding = launched.window.locator('#onboarding-container');
  await expect(onboarding).toBeVisible();
  // First step of the wizard — confirms it's actually the welcome step, not
  // some other overlay that happens to share the container.
  await expect(launched.window.locator('#ob-step-welcome')).toHaveClass(/active/);
});

test('no fatal error was logged in the main process during startup', () => {
  const combined = mainProcessStderr.join('\n');
  expect(combined).not.toContain('[Main] FATAL ERROR');
});

test('no uncaught renderer exception during startup', () => {
  expect(rendererErrors).toEqual([]);
});
