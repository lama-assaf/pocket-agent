// e2e/specs/focus-trap.spec.ts
// Real, end-to-end verification of ui/chat/focus-trap.js's wiring into the
// actual running app — not the fake-DOM unit tests in
// tests/unit/focus-trap.test.ts, which cover the module's own pure logic.
// This drives the REAL compiled renderer via a real keyboard Tab/Shift+Tab/
// Escape, confirming the wiring (not just the utility in isolation) actually
// works: Tab stays inside the About modal instead of escaping to the page
// behind it, Escape closes it, and focus returns to the button that opened
// it. Also spot-checks the client-create prompt (clients-view.js), which
// shares the exact same trap.
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
  userDataDir = makeUserDataDir('focus-trap');
  launched = await launchApp(userDataDir);
  await bypassOnboardingToUsableState(launched.window);
});

test.afterAll(async () => {
  await closeApp(launched.app);
  cleanupUserData(userDataDir);
});

test('About modal: has dialog semantics, traps Tab, Escape closes it, and focus restores to the trigger', async () => {
  const { window: page } = launched;

  // Land on the picker or chat — either way the sidebar "Who made me?"
  // trigger is present and focusable.
  const trigger = page.locator('#sidebar-about-btn');
  await trigger.waitFor({ state: 'visible' });
  await trigger.focus();
  await trigger.press('Enter');

  const modal = page.locator('#about-modal');
  await expect(modal).toHaveClass(/show/);
  await expect(modal).toHaveAttribute('role', 'dialog');
  await expect(modal).toHaveAttribute('aria-modal', 'true');
  const labelledBy = await modal.getAttribute('aria-labelledby');
  expect(labelledBy).toBeTruthy();
  await expect(page.locator(`#${labelledBy}`)).toHaveText('Who made me?');

  // Only one genuinely focusable control inside today (the two footer
  // links have no href — see the task's inventory notes — so they aren't
  // native tab stops); confirm the trap keeps focus ON that one control
  // rather than letting Tab walk it out to the page behind the modal.
  const closeBtn = page.locator('#about-close-btn');
  await expect(closeBtn).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeBtn).toBeFocused();

  // The real regression this whole task fixes: before this change, Tab
  // from inside any modal escaped to the page behind it. Confirm neither
  // the sidebar nor any other background control ever receives focus while
  // the modal is open.
  const sidebarSettingsBtn = page.locator('#sidebar-settings-btn');
  await expect(sidebarSettingsBtn).not.toBeFocused();

  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/show/);
  await expect(trigger).toBeFocused();
});

test('client-create prompt: traps Tab across Cancel/OK, and Escape restores focus to "New Client"', async () => {
  const { window: page } = launched;

  await page.click('#active-client-header');
  await expect(page.locator('#clients-view')).toHaveClass(/active/);

  const newClientBtn = page.locator('#cv-new-client-btn');
  await newClientBtn.focus();
  await newClientBtn.press('Enter');

  const overlay = page.locator('.cv-prompt-overlay');
  await expect(overlay).toHaveClass(/show/);
  await expect(overlay).toHaveAttribute('role', 'dialog');
  await expect(overlay).toHaveAttribute('aria-modal', 'true');
  const labelledBy = await overlay.getAttribute('aria-labelledby');
  expect(labelledBy).toBeTruthy();

  const input = overlay.locator('.cv-prompt-input');
  await expect(input).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(overlay.locator('.cv-prompt-cancel')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(overlay.locator('.cv-prompt-ok')).toBeFocused();
  // Wraps back to the input rather than escaping to the page.
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();

  // Shift+Tab from the input wraps backward to the last control (OK).
  await page.keyboard.press('Shift+Tab');
  await expect(overlay.locator('.cv-prompt-ok')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(newClientBtn).toBeFocused();
});
