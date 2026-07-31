// e2e/specs/analytics.spec.ts
// Records a post-analytics snapshot via the real "Record snapshot" form,
// confirms it's listed, then extends the model with media_urls/top_comments
// via the exact same window.pocketAgent.analytics.record contract the form
// itself calls (there is no UI field for those two yet) and confirms they
// round-trip through the real IPC + SQLite layer.
import { test, expect } from '@playwright/test';
import {
  launchApp,
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

const POST_TITLE = `E2E post ${Date.now()}`;
const POST_REF = `https://x.com/e2e/status/${Date.now()}`;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir('analytics');
  launched = await launchApp(userDataDir);
  await bypassOnboardingToUsableState(launched.window);
  // This spec tests Personal-scope analytics specifically. A true first run
  // (ui/chat/clients-view.js's cvLaunch()) now defaults the active workspace
  // to the bundled Zilliqa client instead of Personal, so switch explicitly
  // before recording anything through the UI form below.
  await launched.window.evaluate(
    (ctx) =>
      (window as unknown as { cvSelectWorkspace: (ws: unknown) => Promise<void> }).cvSelectWorkspace(ctx),
    PERSONAL_CONTEXT
  );
});

test.afterAll(async () => {
  await closeApp(launched.app);
  cleanupUserData(userDataDir);
});

test('records a snapshot via the real "Record snapshot" form', async () => {
  const { window: page } = launched;
  await page.click('#sidebar-analytics-btn');
  await expect(page.locator('#analytics-view')).toHaveClass(/active/);

  await page.click('button:has-text("Record snapshot")');
  await page.fill('#ant-new-channel', 'twitter');
  await page.fill('#ant-new-ref', POST_REF);
  await page.fill('#ant-new-title', POST_TITLE);
  await page.fill('#ant-new-impressions', '1000');
  await page.fill('#ant-new-likes', '42');

  await page.click('button:has-text("Save snapshot")');

  await expect(page.locator('#ant-posts')).toContainText(POST_TITLE, { timeout: 10_000 });
});

test('the recorded snapshot is genuinely persisted with the entered numbers', async () => {
  const rows = await launched.window.evaluate(
    (ctx) => window.pocketAgent.analytics.list(ctx),
    PERSONAL_CONTEXT
  );
  const row = rows.find((r) => r.title === POST_TITLE);
  expect(row).toBeTruthy();
  expect(row?.impressions).toBe(1000);
  expect(row?.likes).toBe(42);
  expect(row?.source).toBe('manual');
});

test('media_urls and top_comments round-trip through the real IPC contract', async () => {
  const { window: page } = launched;
  const mediaRef = `https://x.com/e2e/status/${Date.now()}-media`;

  await page.evaluate(
    ({ ctx, externalRef }) =>
      window.pocketAgent.analytics.record(
        {
          channel: 'twitter',
          externalRef,
          title: 'E2E post with media + comments',
          impressions: 500,
          likes: 10,
          comments: 2,
          shares: 0,
          clicks: 0,
          videoViews: 0,
          source: 'manual',
          mediaUrls: ['https://pbs.twimg.com/media/e2e-1.jpg', 'https://pbs.twimg.com/media/e2e-2.jpg'],
          topComments: [{ author: '@e2e_reviewer', text: 'Great post!', likes: 5 }],
        },
        ctx
      ),
    { ctx: PERSONAL_CONTEXT, externalRef: mediaRef }
  );

  const rows = await page.evaluate((ctx) => window.pocketAgent.analytics.list(ctx), PERSONAL_CONTEXT);
  const row = rows.find((r) => r.external_ref === mediaRef);
  expect(row).toBeTruthy();
  expect(row?.media_urls).toEqual([
    'https://pbs.twimg.com/media/e2e-1.jpg',
    'https://pbs.twimg.com/media/e2e-2.jpg',
  ]);
  const topComments = JSON.parse(row?.top_comments ?? '[]');
  expect(topComments).toEqual([{ author: '@e2e_reviewer', text: 'Great post!', likes: 5 }]);
});
