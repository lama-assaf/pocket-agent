// e2e/specs/onboarding.spec.ts
// Drives the real first-run wizard as far as it can go WITHOUT live external
// credentials, then documents + exercises the app's own genuine completion
// path (obFinishSetup) so downstream specs have a legitimate way to reach a
// "usable state". See docs/e2e/PLAN.md's "Onboarding gate needs live
// credentials" section for the full reasoning.
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

test.beforeAll(async () => {
  userDataDir = makeUserDataDir('onboarding');
  launched = await launchApp(userDataDir);
});

test.afterAll(async () => {
  await closeApp(launched.app);
  cleanupUserData(userDataDir);
});

test('first-run wizard renders on the welcome step', async () => {
  await expect(launched.window.locator('#ob-step-welcome')).toHaveClass(/active/);
});

test('walks Welcome -> Keychain -> Permissions -> Auth (every step that needs no live credentials)', async () => {
  const { window: page } = launched;

  await page.click('#ob-step-welcome .ob-btn.primary'); // "Begin Setup"
  await expect(page.locator('#ob-step-keychain')).toHaveClass(/active/);

  // Real local Keychain/safeStorage check — no network involved, safe to
  // drive for real (see obInitKeychain in ui/chat/onboarding.js).
  await page.click('#ob-keychain-btn');
  // Advances to Permissions (macOS) or straight to Auth (non-macOS) on a
  // deliberate 800ms timeout inside the app itself.
  await expect(page.locator('#ob-step-permissions, #ob-step-auth').first()).toHaveClass(
    /active/,
    { timeout: 5_000 }
  );

  const onPermissions = await page.locator('#ob-step-permissions').evaluate((el) =>
    el.classList.contains('active')
  );
  if (onPermissions) {
    await page.click('#ob-step-permissions .ob-btn.primary'); // "Continue"
  }

  await expect(page.locator('#ob-step-auth')).toHaveClass(/active/);
});

test('auth step offers both OAuth and API-key paths (verified reachable, not completed)', async () => {
  await expect(launched.window.locator('#ob-claude-oauth-btn')).toBeVisible();
  await expect(launched.window.locator('#ob-openai-oauth-btn')).toBeVisible();

  // The API-key path lives inside a collapsed "Or connect a different
  // provider" accordion — expand it to confirm the key-entry path genuinely
  // exists and is reachable. Not submitted here (see the skipped test below
  // for why full completion via the UI is out of scope).
  await launched.window.click('.ob-optional-header');
  await expect(launched.window.locator('#ob-api-btn')).toBeVisible();
});

// Genuinely un-automatable without live external credentials — declared as
// a real skipped test (not faked, not silently omitted) so the suite's
// pass/skip/fail totals reflect it honestly in the Playwright report.
test.skip(
  'completes onboarding via a live Anthropic/OpenAI OAuth session or a real, working API key',
  {
    annotation: {
      type: 'skip-reason',
      description:
        'The "Continue" path from the auth step is either OAuth (opens a real external browser ' +
        'and waits for a device/callback code) or an API key gated by ' +
        'settings:validateAnthropic/OpenAI/etc. — a genuine network call to the provider. No ' +
        'credential test double exists in this app, and typing a key and clicking "Save & ' +
        'Continue" would just surface a real "invalid key" toast from the live provider, ' +
        'telling us nothing about the app itself. See "reaches a usable post-onboarding state" ' +
        'below for how the rest of the suite gets past onboarding without faking this step.',
    },
  },
  async () => {
    /* never runs — see the skip annotation above */
  }
);

test("reaches a usable post-onboarding state via the app's own completion path", async () => {
  // Not a UI walk-through of the auth step (see the skip reason above) —
  // writes a placeholder key through the real settings IPC, then calls the
  // app's own obFinishSetup() global (the exact function the real "Finish"
  // button on the success step invokes). Exercises real app code end to end:
  // settings persistence, the onboarding-container teardown, and the
  // initializeChatAfterOnboarding() -> cvLaunch() transition.
  await bypassOnboardingToUsableState(launched.window);

  await expect(launched.window.locator('#onboarding-container')).toHaveCount(0);
  const isFirstRunAfter = await launched.window.evaluate(() =>
    window.pocketAgent.settings.isFirstRun()
  );
  expect(isFirstRunAfter).toBe(false);
});
