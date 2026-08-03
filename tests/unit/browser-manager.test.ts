/**
 * Unit tests for the BrowserManager class
 *
 * Tests tier selection logic, tool input handling, status reporting,
 * and cleanup with mocked electron and CDP tiers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockElectronExecute = vi.fn(async () => ({ success: true, tier: 'electron' as const }));
const mockElectronGetState = vi.fn(() => ({ active: true }));
const mockElectronClose = vi.fn();

const mockCdpExecute = vi.fn(async () => ({ success: true, tier: 'cdp' as const }));
const mockCdpGetState = vi.fn(() => ({ connected: true }));
const mockCdpDisconnect = vi.fn();
const mockCdpIsConnected = vi.fn(() => true);
const mockCdpForceReconnect = vi.fn();

vi.mock('../../src/browser/electron-tier', () => ({
  ElectronTier: class MockElectronTier {
    execute = mockElectronExecute;
    getState = mockElectronGetState;
    close = mockElectronClose;
  },
}));

vi.mock('../../src/browser/cdp-tier', () => ({
  CdpTier: class MockCdpTier {
    execute = mockCdpExecute;
    getState = mockCdpGetState;
    disconnect = mockCdpDisconnect;
    isConnected = mockCdpIsConnected;
    forceReconnect = mockCdpForceReconnect;
  },
}));

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn(() => 'false'),
  },
}));

import {
  BrowserManager,
  getBrowserManager,
  closeBrowserManager,
  closeAllBrowserManagers,
  forEachBrowserManager,
} from '../../src/browser/index';
import { SettingsManager } from '../../src/settings';
import { runWithSessionId } from '../../src/tools/session-context';

describe('BrowserManager', () => {
  let manager: BrowserManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SettingsManager.get).mockReturnValue('false');
    manager = new BrowserManager();
  });

  describe('selectTier (via execute)', () => {
    it('defaults to electron tier when no preferences set', async () => {
      await manager.execute({ action: 'navigate', url: 'https://example.com' });

      expect(mockElectronExecute).toHaveBeenCalled();
      expect(mockCdpExecute).not.toHaveBeenCalled();
    });

    it('uses cdp tier when explicitly requested', async () => {
      await manager.execute({ action: 'navigate', url: 'https://example.com', tier: 'cdp' });

      expect(mockCdpExecute).toHaveBeenCalled();
      expect(mockElectronExecute).not.toHaveBeenCalled();
    });

    it('selects cdp tier when requiresAuth is true', async () => {
      await manager.execute({ action: 'navigate', url: 'https://example.com', requiresAuth: true });

      expect(mockCdpExecute).toHaveBeenCalled();
      expect(mockElectronExecute).not.toHaveBeenCalled();
    });

    it('selects cdp tier when useMyBrowser setting is true', async () => {
      vi.mocked(SettingsManager.get).mockReturnValue('true');

      await manager.execute({ action: 'navigate', url: 'https://example.com' });

      expect(mockCdpExecute).toHaveBeenCalled();
      expect(mockElectronExecute).not.toHaveBeenCalled();
    });
  });

  describe('handleToolInput', () => {
    it('maps input fields to BrowserAction and executes', async () => {
      const input = {
        action: 'navigate',
        url: 'https://example.com',
        requires_auth: false,
        tier: 'electron',
        wait_for: '.content',
        extract_type: 'text',
        extract_selector: 'body',
        scroll_direction: 'down',
        scroll_amount: 500,
        download_path: '/tmp/file.pdf',
        download_timeout: 5000,
        file_path: '/tmp/upload.txt',
        tab_id: 'tab-1',
      };

      await manager.handleToolInput(input);

      expect(mockElectronExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'navigate',
          url: 'https://example.com',
          requiresAuth: false,
          tier: 'electron',
          waitFor: '.content',
          extractType: 'text',
          extractSelector: 'body',
          scrollDirection: 'down',
          scrollAmount: 500,
          downloadPath: '/tmp/file.pdf',
          downloadTimeout: 5000,
          filePath: '/tmp/upload.txt',
          tabId: 'tab-1',
        }),
      );
    });
  });

  describe('close', () => {
    it('calls close on both tiers when initialized', async () => {
      // Initialize both tiers
      await manager.execute({ action: 'navigate', url: 'https://a.com' });
      await manager.execute({ action: 'navigate', url: 'https://b.com', tier: 'cdp' });

      manager.close();

      expect(mockElectronClose).toHaveBeenCalled();
      expect(mockCdpDisconnect).toHaveBeenCalled();
    });
  });

  describe('forceReconnectCdp', () => {
    it('calls forceReconnect on CDP tier when initialized', async () => {
      // Initialize CDP tier
      await manager.execute({ action: 'navigate', url: 'https://a.com', tier: 'cdp' });

      await manager.forceReconnectCdp();

      expect(mockCdpForceReconnect).toHaveBeenCalled();
    });

    it('is a no-op when CDP tier not initialized', async () => {
      await manager.forceReconnectCdp();

      expect(mockCdpForceReconnect).not.toHaveBeenCalled();
    });
  });
});

describe('getBrowserManager / closeBrowserManager (per-session scoping)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SettingsManager.get).mockReturnValue('false');
    // Every session's manager from a previous test must be torn down so
    // tests don't leak instances into one another via the module-level map.
    closeAllBrowserManagers();
  });

  it('gives two different sessions distinct manager instances', () => {
    const managerA = runWithSessionId('session-A', () => getBrowserManager());
    const managerB = runWithSessionId('session-B', () => getBrowserManager());

    expect(managerA).not.toBe(managerB);
  });

  it('returns the same manager instance for repeated calls within the same session', () => {
    const first = runWithSessionId('session-A', () => getBrowserManager());
    const second = runWithSessionId('session-A', () => getBrowserManager());

    expect(first).toBe(second);
  });

  it('falls back to a shared default instance for call sites with no session context', () => {
    // Simulates call sites like app startup / power events that never ran
    // inside runWithSessionId.
    const first = getBrowserManager();
    const second = getBrowserManager();

    expect(first).toBe(second);
  });

  it('closing one session does not close or recreate another session manager', async () => {
    const managerA = runWithSessionId('session-A', () => getBrowserManager());
    const managerB = runWithSessionId('session-B', () => getBrowserManager());

    // Initialize both sessions' Electron tiers so close() has something to tear down.
    await managerA.execute({ action: 'navigate', url: 'https://a.example.com' });
    await managerB.execute({ action: 'navigate', url: 'https://b.example.com' });

    runWithSessionId('session-A', () => closeBrowserManager());

    // Session B's manager must still be the exact same instance — untouched
    // by session A's close — and must still be usable.
    const managerBAfter = runWithSessionId('session-B', () => getBrowserManager());
    expect(managerBAfter).toBe(managerB);
    await expect(
      managerBAfter.execute({ action: 'navigate', url: 'https://b2.example.com' })
    ).resolves.toEqual(expect.objectContaining({ success: true }));

    // Session A must get a fresh manager instance now that its old one was closed/removed.
    const managerAAfter = runWithSessionId('session-A', () => getBrowserManager());
    expect(managerAAfter).not.toBe(managerA);
  });

  it('closeAllBrowserManagers tears down every session and forEachBrowserManager iterates all live sessions', async () => {
    const managerA = runWithSessionId('session-A', () => getBrowserManager());
    const managerB = runWithSessionId('session-B', () => getBrowserManager());

    const seen = new Set<BrowserManager>();
    forEachBrowserManager((manager) => seen.add(manager));
    expect(seen.has(managerA)).toBe(true);
    expect(seen.has(managerB)).toBe(true);
    expect(seen.size).toBe(2);

    closeAllBrowserManagers();

    // Both sessions must now lazily create brand-new instances.
    const managerAAfter = runWithSessionId('session-A', () => getBrowserManager());
    const managerBAfter = runWithSessionId('session-B', () => getBrowserManager());
    expect(managerAAfter).not.toBe(managerA);
    expect(managerBAfter).not.toBe(managerB);
  });
});
