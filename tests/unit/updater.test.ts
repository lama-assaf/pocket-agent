/**
 * Unit tests for the auto-updater module
 *
 * Tests updater initialization, status reporting, IPC handler setup,
 * dev-mode behavior, and the unsigned-macOS-build degradation path, all
 * with mocked electron-updater, Electron, and child_process.
 *
 * The module under test keeps state (currentStatus/isInitialized) at module
 * scope, so each test resets the module registry and re-imports it fresh to
 * avoid state leaking between tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as UpdaterModule from '../../src/main/updater';

// Use vi.hoisted to create variables that are available in vi.mock factories
const { mockAutoUpdater, mockIpcMainHandle, mockExecFileSync } = vi.hoisted(() => ({
  mockAutoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  },
  mockIpcMainHandle: vi.fn(),
  mockExecFileSync: vi.fn(),
}));

let mockIsPackaged = false;

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mockAutoUpdater },
  autoUpdater: mockAutoUpdater,
}));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: (...args: unknown[]) => mockIpcMainHandle(...args),
  },
  app: {
    get isPackaged() {
      return mockIsPackaged;
    },
    getPath: vi.fn(() => '/Applications/r3to.os.app/Contents/MacOS/r3to.os'),
  },
}));

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn(() => 'true'),
  },
}));

/** Force process.platform for a single test; Node allows redefining it. */
function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('updater', () => {
  const originalPlatform = process.platform;
  let updater: typeof UpdaterModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackaged = false;
    mockExecFileSync.mockReset();
    // Default: codesign verification succeeds (signed build) so existing
    // "packaged" tests exercise the normal init path unless a test opts
    // into the unsigned scenario below.
    mockExecFileSync.mockReturnValue(Buffer.from(''));
    vi.useFakeTimers();
    updater = await import('../../src/main/updater');
  });

  afterEach(() => {
    vi.useRealTimers();
    stubPlatform(originalPlatform);
  });

  describe('getUpdateStatus', () => {
    it('returns a status object', () => {
      const status = updater.getUpdateStatus();

      expect(status).toBeDefined();
      expect(status).toHaveProperty('status');
    });
  });

  describe('initializeUpdater', () => {
    it('sets status to dev-mode when not packaged', () => {
      mockIsPackaged = false;

      updater.initializeUpdater();

      const status = updater.getUpdateStatus();
      expect(status.status).toBe('dev-mode');
      expect(status.error).toContain('packaged app');
    });

    it('sets up event handlers when packaged (signed build)', () => {
      mockIsPackaged = true;

      updater.initializeUpdater();

      // Should register event handlers on autoUpdater
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('checking-for-update', expect.any(Function));
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('update-available', expect.any(Function));
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('update-not-available', expect.any(Function));
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('download-progress', expect.any(Function));
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('update-downloaded', expect.any(Function));
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('configures autoUpdater settings when packaged (signed build)', () => {
      mockIsPackaged = true;

      updater.initializeUpdater();

      // Downloads happen silently in the background so the only user-facing
      // moment is the "restart to apply" banner once it's ready.
      expect(mockAutoUpdater.autoDownload).toBe(true);
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
    });

    it('disables the updater without error spam on an unsigned macOS build', () => {
      stubPlatform('darwin');
      mockIsPackaged = true;
      // codesign --verify fails on an unsigned app bundle.
      mockExecFileSync.mockImplementation(() => {
        throw new Error('code object is not signed at all');
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      updater.initializeUpdater();

      const status = updater.getUpdateStatus();
      expect(status.status).toBe('unsupported');
      // No event handlers registered — autoUpdater is never touched.
      expect(mockAutoUpdater.on).not.toHaveBeenCalled();
      // Exactly one informational log line, no thrown/console.error spam.
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain('Unsigned macOS build');
    });

    it('initializes normally on non-macOS platforms regardless of signature', () => {
      stubPlatform('win32');
      mockIsPackaged = true;
      mockExecFileSync.mockImplementation(() => {
        throw new Error('codesign is a macOS-only tool');
      });

      updater.initializeUpdater();

      const status = updater.getUpdateStatus();
      expect(status.status).not.toBe('unsupported');
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('checkForUpdates', () => {
    it('returns dev-mode status when not packaged', async () => {
      mockIsPackaged = false;

      const status = await updater.checkForUpdates();

      expect(status.status).toBe('dev-mode');
    });

    it('keeps reporting unsupported instead of relabelling it dev-mode', async () => {
      stubPlatform('darwin');
      mockIsPackaged = true;
      mockExecFileSync.mockImplementation(() => {
        throw new Error('code object is not signed at all');
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      updater.initializeUpdater();

      const status = await updater.checkForUpdates();

      expect(status.status).toBe('unsupported');
    });
  });

  describe('setupUpdaterIPC', () => {
    it('registers 5 IPC handlers', () => {
      updater.setupUpdaterIPC();

      expect(mockIpcMainHandle).toHaveBeenCalledTimes(5);
      expect(mockIpcMainHandle).toHaveBeenCalledWith('updater:checkForUpdates', expect.any(Function));
      expect(mockIpcMainHandle).toHaveBeenCalledWith('updater:downloadUpdate', expect.any(Function));
      expect(mockIpcMainHandle).toHaveBeenCalledWith('updater:installUpdate', expect.any(Function));
      expect(mockIpcMainHandle).toHaveBeenCalledWith('updater:getStatus', expect.any(Function));
      expect(mockIpcMainHandle).toHaveBeenCalledWith('updater:getReleasesUrl', expect.any(Function));
    });
  });
});
