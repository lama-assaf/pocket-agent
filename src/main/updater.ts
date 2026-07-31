import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
type UpdateInfo = electronUpdater.UpdateInfo;
type ProgressInfo = electronUpdater.ProgressInfo;
import { BrowserWindow, ipcMain, app } from 'electron';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { SettingsManager } from '../settings';

/** Where to point testers when auto-update can't run (unsigned mac builds). */
export const RELEASES_URL = 'https://github.com/lama-assaf/pocket-agent/releases/latest';

export interface UpdateStatus {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'dev-mode'
    | 'unsupported';
  info?: UpdateInfo;
  progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number };
  error?: string;
}

let currentStatus: UpdateStatus = { status: 'idle' };
let settingsWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let isInitialized = false;
let periodicCheckTimer: ReturnType<typeof setInterval> | null = null;

/** How often to re-check for updates while the app is running. */
const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Get the current update status
 */
export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}

/**
 * Send status update to settings window
 */
function sendStatusToRenderer(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('updater:status', currentStatus);
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('updater:status', currentStatus);
  }
}

/**
 * macOS's native Squirrel.Mac updater (what electron-updater's MacUpdater
 * shells out to) refuses to apply an update to a running app it can't
 * verify the code signature of — an unsigned build throws "Could not get
 * code signature for running application" the moment it tries. We build
 * unsigned dmg/zip only (no Apple Developer signing — see RELEASE.md), so
 * detect that up front and never let autoUpdater touch it.
 */
function isMacBuildSigned(): boolean {
  if (process.platform !== 'darwin') return true; // not applicable off mac
  try {
    // app.getPath('exe') -> .../<App>.app/Contents/MacOS/<App>; the signature
    // lives on the .app bundle two levels up.
    const appBundlePath = path.resolve(app.getPath('exe'), '..', '..', '..');
    execFileSync('codesign', ['--verify', '--deep', '--strict', appBundlePath], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize the auto-updater
 */
export function initializeUpdater(): void {
  if (!app.isPackaged) {
    console.log('[Updater] Skipping initialization in development mode');
    currentStatus = { status: 'dev-mode', error: 'Updates only work in packaged app' };
    return;
  }

  if (!isMacBuildSigned()) {
    // Single log line, no retries, no error spam — this is expected for every
    // build we currently ship. The renderer shows a "download the latest DMG"
    // link instead of a restart affordance (see settings-panel.js).
    console.log(
      '[Updater] Unsigned macOS build — auto-update is unavailable; get new versions from GitHub Releases.'
    );
    currentStatus = { status: 'unsupported' };
    return;
  }

  isInitialized = true;

  // Configure updater: download silently in the background once an update
  // is found so the renderer only ever needs to show "restart to apply" —
  // never a forced/silent restart. autoInstallOnAppQuit still applies the
  // update for free if the user quits before clicking "Install & Restart".
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Set up event handlers
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
    currentStatus = { status: 'checking' };
    sendStatusToRenderer();
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[Updater] Update available:', info.version);
    currentStatus = { status: 'available', info };
    sendStatusToRenderer();
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('[Updater] No updates available. Current version is up to date.');
    currentStatus = { status: 'not-available', info };
    sendStatusToRenderer();
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    console.log(`[Updater] Download progress: ${progress.percent.toFixed(1)}%`);
    currentStatus = {
      status: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    };
    sendStatusToRenderer();
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('[Updater] Update downloaded:', info.version);
    currentStatus = { status: 'downloaded', info };
    sendStatusToRenderer();
  });

  autoUpdater.on('error', (error: Error) => {
    console.error('[Updater] Error:', error.message);
    const msg = error.message;

    // Classify errors: some are transient/expected, others are real failures
    if (
      msg.includes('latest-mac.yml') ||
      msg.includes('latest.yml') ||
      (msg.includes('404') && msg.includes('releases/download'))
    ) {
      // Release exists but build artifacts aren't uploaded yet — not a real error
      currentStatus = {
        status: 'not-available',
        error: 'Latest release is still being built. Check back in a few minutes.',
      };
    } else if (msg.includes('read-only volume')) {
      currentStatus = {
        status: 'error',
        error: 'Move r3to.os to Applications folder to enable updates.',
      };
    } else if (
      msg.includes('net::ERR_') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ECONNREFUSED')
    ) {
      currentStatus = {
        status: 'error',
        error: 'Could not reach update server. Check your internet connection.',
      };
    } else if (msg.includes('HttpError') || msg.includes('status code')) {
      currentStatus = {
        status: 'error',
        error: 'Update server returned an error. Try again later.',
      };
    } else {
      currentStatus = { status: 'error', error: msg };
    }

    sendStatusToRenderer();
  });

  // Check for updates on startup if auto-update is enabled
  if (SettingsManager.get('updates.autoCheck') !== 'false') {
    // Delay initial check to avoid slowing down startup
    setTimeout(() => {
      checkForUpdates().catch((err) => {
        console.error('[Updater] Initial check failed:', err);
      });
    }, 10000); // 10 second delay
  }

  // Re-check periodically for the lifetime of the process, re-reading the
  // setting each tick so toggling it in Settings takes effect without a
  // restart. A long-running desktop app can sit open for days; a
  // startup-only check would leave testers on a stale build the whole time.
  if (periodicCheckTimer) clearInterval(periodicCheckTimer);
  periodicCheckTimer = setInterval(() => {
    if (SettingsManager.get('updates.autoCheck') === 'false') return;
    checkForUpdates().catch((err) => {
      console.error('[Updater] Periodic check failed:', err);
    });
  }, PERIODIC_CHECK_INTERVAL_MS);
}

/**
 * Check for updates
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (currentStatus.status === 'unsupported') {
    // Nothing to (re)check - this build can never self-update. Keep the
    // status stable instead of relabelling it 'dev-mode'.
    sendStatusToRenderer();
    return currentStatus;
  }

  if (!isInitialized || !app.isPackaged) {
    currentStatus = { status: 'dev-mode', error: 'Updates only work in packaged app' };
    sendStatusToRenderer();
    return currentStatus;
  }

  try {
    currentStatus = { status: 'checking' };
    sendStatusToRenderer();
    await autoUpdater.checkForUpdates();
    return currentStatus;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    currentStatus = { status: 'error', error: errorMsg };
    sendStatusToRenderer();
    return currentStatus;
  }
}

/**
 * Download the available update
 */
export async function downloadUpdate(): Promise<void> {
  if (currentStatus.status !== 'available') {
    throw new Error('No update available to download');
  }
  await autoUpdater.downloadUpdate();
}

/**
 * Install the downloaded update and restart
 */
export function installUpdate(): void {
  if (currentStatus.status !== 'downloaded') {
    throw new Error('No update downloaded to install');
  }
  autoUpdater.quitAndInstall(false, true);
}

/**
 * Set the settings window reference for status updates
 */
export function setSettingsWindow(window: BrowserWindow | null): void {
  settingsWindow = window;
}

/**
 * Set the chat window reference for status updates
 */
export function setChatWindow(window: BrowserWindow | null): void {
  chatWindow = window;
}

/**
 * Set up IPC handlers for updater
 */
export function setupUpdaterIPC(): void {
  ipcMain.handle('updater:checkForUpdates', async () => {
    return checkForUpdates();
  });

  ipcMain.handle('updater:downloadUpdate', async () => {
    try {
      await downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('updater:installUpdate', () => {
    try {
      installUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('updater:getStatus', () => {
    return currentStatus;
  });

  ipcMain.handle('updater:getReleasesUrl', () => {
    return RELEASES_URL;
  });
}
