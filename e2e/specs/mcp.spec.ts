// e2e/specs/mcp.spec.ts
// Opens Settings > MCP Servers, confirms the catalog lists servers including
// electron-mcp-server (this session's addition to
// src/marketplace/seed/atelier/mcp-configs/mcp-servers.json), toggles it on,
// and confirms the enabled state persists across a full app restart.
//
// Note: mcp:setServerEnabled only flips a config flag (src/main/ipc/mcp-ipc.ts)
// — it never spawns the underlying `npx electron-mcp-server` process, so this
// stays offline/deterministic with no real child-process or network side effect.
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

// The catalog namespaces marketplace-sourced entries as `<packId>:<entryId>`
// (src/marketplace/mcp-status.ts's marketplaceEntryId) so two packs can't
// collide on the same bare id — electron-mcp-server ships in the atelier
// pack's mcp-configs/mcp-servers.json. The row's `data-id` uses this full
// namespaced id; its displayed name (`.mcp-server-name`) stays the bare id.
const ROW = '.mcp-server-row[data-id="atelier:electron-mcp-server"]';

test.beforeAll(async () => {
  userDataDir = makeUserDataDir('mcp');
  launched = await launchApp(userDataDir);
  await bypassOnboardingToUsableState(launched.window);
});

test.afterAll(async () => {
  await closeApp(launched.app);
  cleanupUserData(userDataDir);
});

test('Settings > MCP Servers lists the catalog including electron-mcp-server', async () => {
  const { window: page } = launched;
  await page.click('#sidebar-settings-btn');
  await expect(page.locator('#settings-view')).toHaveClass(/active/);

  await page.click('.settings-nav-item[data-section="mcp"]');
  await expect(page.locator('#mcp')).toHaveClass(/active/);

  await expect(page.locator(ROW)).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(`${ROW} .mcp-server-name`)).toHaveText('electron-mcp-server');
});

test('electron-mcp-server starts disabled by default', async () => {
  await expect(launched.window.locator(ROW)).toContainText('Disabled');
});

test('toggling it on flips the status pill and persists the flag', async () => {
  const { window: page } = launched;
  await page.click(`${ROW} .toggle`);
  await expect(page.locator(ROW)).toContainText('Enabled', { timeout: 10_000 });

  const servers = await page.evaluate(() => window.pocketAgent.mcp.listServers());
  const server = servers.find((s) => s.id === 'atelier:electron-mcp-server');
  expect(server?.enabled).toBe(true);
});

test("a toggled-on server's enabled flag survives a full app restart", async () => {
  // Deliberately uses atelier:filesystem (the long-standing official
  // @modelcontextprotocol/server-filesystem entry), NOT electron-mcp-server,
  // for the restart check specifically: atelier/salon are LIVE marketplace
  // packs (src/marketplace/registry.ts's PACK_SOURCES) that self-update from
  // their real GitHub repos in the background on every launch
  // (PackSyncManager.checkAndUpdate(), fire-and-forget). electron-mcp-server
  // is THIS SESSION's local-only addition to the bundled seed and may not
  // exist upstream yet — on a machine with real internet access, a
  // background refresh landing during the restart could legitimately drop
  // it from the merged catalog, independent of anything this suite does.
  // `mcp.marketplace.config` (the actual persisted enabled-flag store) can't
  // be read directly either — it's an `encrypted` settings key, masked to
  // the renderer by design (src/main/ipc/settings-ipc.ts) since it may carry
  // per-server credentials. filesystem has shipped in the pack for a long
  // time, so it's a stable stand-in for "does the enabled flag survive a
  // restart" without depending on this session's not-yet-upstreamed entry.
  //
  // filesystem's own args carry a ${PROJECT_ROOT} placeholder, which counts
  // as a "required env" (extractRequiredEnv scans args, not just env) that
  // isn't set in this browsing context — so its pill legitimately reads
  // "Missing credentials", not "Enabled", once toggled on. That's a separate
  // concept (configured) from what this test verifies (enabled); asserting
  // on the `enabled` boolean via the real IPC contract sidesteps the
  // distinction entirely rather than depending on one entry's config shape.
  const { window: page } = launched;
  const fsRow = '.mcp-server-row[data-id="atelier:filesystem"]';
  await page.click(`${fsRow} .toggle`);
  await expect(page.locator(fsRow)).not.toContainText('Disabled', { timeout: 10_000 });
  let servers = await page.evaluate(() => window.pocketAgent.mcp.listServers());
  expect(servers.find((s) => s.id === 'atelier:filesystem')?.enabled).toBe(true);

  launched = await relaunchApp(launched);
  await launched.window.click('#sidebar-settings-btn');
  await launched.window.click('.settings-nav-item[data-section="mcp"]');
  await expect(launched.window.locator(fsRow)).not.toContainText('Disabled', { timeout: 10_000 });

  servers = await launched.window.evaluate(() => window.pocketAgent.mcp.listServers());
  expect(servers.find((s) => s.id === 'atelier:filesystem')?.enabled).toBe(true);
});
