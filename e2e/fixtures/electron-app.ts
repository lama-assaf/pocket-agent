// e2e/fixtures/electron-app.ts
// Launch/relaunch helpers for driving the real, compiled Electron app under
// Playwright's `_electron` API. Kept framework-light (no custom `test.extend`
// fixture magic) so each spec file can control its own app lifecycle —
// several specs need an explicit close+relaunch against the SAME profile dir
// to prove DB persistence, which a single shared fixture would make awkward.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'main', 'index.js');

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
}

/** Fresh, unique tmp profile dir — never the developer's real userData. */
export function makeUserDataDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pocket-agent-e2e-${label}-`));
}

/**
 * Launch the compiled app (`electron .`, exactly what `npm run electron`
 * runs) pinned to an isolated `--user-data-dir` — the standard
 * Electron/Chromium switch that `app.getPath('userData')` resolves from
 * (Electron parses it before `app.whenReady()` runs, well before
 * src/main/index.ts's first `app.getPath('userData')` call).
 */
export async function launchApp(userDataDir: string): Promise<LaunchedApp> {
  if (!fs.existsSync(DIST_MAIN)) {
    throw new Error(
      `dist/main/index.js not found — build the app first (npm run build), or use ` +
        `"npm run test:e2e" which builds automatically. Looked for: ${DIST_MAIN}`
    );
  }
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    // env defaults to process.env already — no need to spread it (and doing
    // so trips up on process.env's `string | undefined` index signature).
  });
  const window = await ensureMainWindow(app);
  await window.waitForLoadState('domcontentloaded');
  return { app, window, userDataDir };
}

/**
 * This is a tray-resident app (src/main/index.ts): `whenReady()` only calls
 * `openChatWindow()` automatically when `SettingsManager.isFirstRun()` is
 * true. On any other launch (e.g. relaunching a profile that already
 * completed onboarding) the app starts with ZERO windows, exactly like a
 * real user who hasn't clicked the tray icon yet.
 *
 * Give it a window-open grace period first (covers true first-run, where
 * `openChatWindow()` fires on its own). If nothing opens within that
 * window, nudge it open through the exact same path a real macOS Dock
 * click uses — `app.on('activate', () => openChatWindow())`, registered
 * synchronously at module load, well before `whenReady()`'s IPC/window
 * setup runs — via `app.emit('activate')` in the main process. This is
 * real production code, not a test-only shortcut, and `createWindow()`
 * dedupes by window id, so it's always safe even if a window already
 * exists by the time this runs.
 */
async function ensureMainWindow(app: ElectronApplication): Promise<Page> {
  const existing = app.windows();
  if (existing.length > 0) return existing[0];
  try {
    return await app.waitForEvent('window', { timeout: 8_000 });
  } catch {
    const windowPromise = app.waitForEvent('window', { timeout: 20_000 });
    await app.evaluate(({ app: electronApp }) => {
      electronApp.emit('activate', {}, true);
    });
    return windowPromise;
  }
}

/** Close + relaunch against the SAME profile dir — proves DB/on-disk persistence, not just in-memory state. */
export async function relaunchApp(prev: LaunchedApp): Promise<LaunchedApp> {
  await closeApp(prev.app);
  return launchApp(prev.userDataDir);
}

export async function closeApp(app: ElectronApplication): Promise<void> {
  try {
    await app.close();
  } catch {
    /* best-effort — app may already be gone */
  }
}

export function cleanupUserData(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Reach a genuine post-onboarding "usable state" WITHOUT live credentials,
 * using the app's OWN exposed completion path — not a test-only shim.
 *
 * `SettingsManager.hasRequiredKeys()` (src/settings/index.ts) only checks
 * whether a key is PRESENT, never whether it validates — live validation
 * (`settings:validateAnthropic`, a real network call to Anthropic) only
 * gates the onboarding UI's "Continue" button on the auth step, which this
 * helper deliberately does not drive (see e2e/README.md's Onboarding
 * section / docs/e2e/PLAN.md for why full live-credentialed completion is
 * out of scope for an offline e2e run).
 *
 * So: write a placeholder key through the real settings IPC (the same
 * `window.pocketAgent.settings.set` the UI itself calls), then invoke
 * `obFinishSetup()` — the exact global function ui/chat/onboarding.js's own
 * "Finish" button calls — so the transition off onboarding runs through
 * real app code (settings write + agent restart attempt + DOM teardown +
 * `initializeChatAfterOnboarding()` -> `cvLaunch()`), never a manually
 * toggled class or skipped code path.
 */
export async function bypassOnboardingToUsableState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.pocketAgent.settings.set('anthropic.apiKey', 'sk-ant-e2e-placeholder-not-live');
    await window.pocketAgent.settings.set('auth.method', 'api_key');
  });
  await page.evaluate(async () => {
    // obFinishSetup is a real global defined by onboarding.js once it loads
    // (by the time firstWindow()/domcontentloaded resolve, it's present) —
    // not part of the app's typed window.pocketAgent contract, hence the cast.
    const finish = (window as unknown as { obFinishSetup: () => Promise<void> }).obFinishSetup;
    await finish();
  });
  // obFinishSetup's own DOM transition runs on a 500ms timeout (see
  // onboarding.js) before it removes #onboarding-container.
  await page.waitForSelector('#onboarding-container', { state: 'detached', timeout: 15_000 });
}

/** Every visible workspace-context shape the app's IPC surface expects. */
export const PERSONAL_CONTEXT = { contextType: 'personal' as const, clientId: null, projectKey: null };
