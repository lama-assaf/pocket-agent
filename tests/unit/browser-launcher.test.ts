/**
 * Unit tests for the browser launcher module
 *
 * Tests browser detection, CDP connection testing, and browser launching
 * with mocked filesystem, child_process, and fetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
}));

// Default mock child: never emits 'exit'/'error' (a healthy, still-running
// process) so existing tests that spawn but don't care about lifecycle
// events keep working unchanged. Tests that need crash/error behavior
// override spawn's return value per-test.
const mockSpawn = vi.fn(() => ({ unref: vi.fn(), on: vi.fn() }));
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  exec: vi.fn((_cmd: string, cb: (err: Error | null, result: { stdout: string }) => void) =>
    cb(null, { stdout: '' }),
  ),
}));

vi.mock('util', () => ({
  promisify: vi.fn(
    (fn: (...args: unknown[]) => void) =>
      vi.fn(
        (...args: unknown[]) =>
          new Promise((resolve, reject) => {
            fn(...args, (err: Error | null, result: unknown) => (err ? reject(err) : resolve(result)));
          }),
      ),
  ),
}));

import { existsSync } from 'fs';
import { detectInstalledBrowsers, testCdpConnection, launchBrowser } from '../../src/browser/launcher';

describe('browser-launcher', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('detectInstalledBrowsers', () => {
    it('returns empty array when no browsers are installed', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const browsers = detectInstalledBrowsers();

      expect(browsers).toEqual([]);
    });

    it('returns browser info when Chrome path exists', () => {
      // Return true for Chrome's macOS path, false for everything else
      (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
        return p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      });

      const browsers = detectInstalledBrowsers();

      expect(browsers.length).toBeGreaterThanOrEqual(1);
      const chrome = browsers.find((b) => b.id === 'chrome');
      expect(chrome).toBeDefined();
      expect(chrome!.name).toBe('Google Chrome');
      expect(chrome!.installed).toBe(true);
    });
  });

  describe('testCdpConnection', () => {
    it('returns connected when fetch succeeds', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ Browser: 'Chrome/120' }),
      });

      const result = await testCdpConnection('http://localhost:9222');

      expect(result.connected).toBe(true);
      expect(result.browserInfo).toEqual({ Browser: 'Chrome/120' });
    });

    it('returns not connected when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const result = await testCdpConnection('http://localhost:9222');

      expect(result.connected).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('returns not connected when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
      });

      const result = await testCdpConnection('http://localhost:9222');

      expect(result.connected).toBe(false);
      expect(result.error).toBe('CDP endpoint not responding');
    });
  });

  describe('launchBrowser', () => {
    it('returns error for unknown browser id', async () => {
      const result = await launchBrowser('unknown-browser');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown browser');
    });

    it('returns error when browser is not installed', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = await launchBrowser('chrome');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not installed');
    });

    // Pre-flight check (fixes the reported "launched but CDP timed out"):
    // if something already answers CDP on the target port (a leftover
    // browser from a previous run, another automation tool, etc.), a
    // second launch attempt is exactly the classic cause of that timeout —
    // the new process can never bind the port. Detect this BEFORE spawning.
    it('short-circuits to success when CDP is already available on the port, without spawning', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockImplementation(
        (p: string) => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      );
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ Browser: 'Chrome/120' }) });

      const result = await launchBrowser('chrome', 9222);

      expect(result.success).toBe(true);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('reports a distinct, actionable error when the spawned process exits immediately (not a generic timeout)', async () => {
      vi.useFakeTimers();
      try {
        (existsSync as ReturnType<typeof vi.fn>).mockImplementation(
          (p: string) => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        );
        // No CDP ever responds — simulates a browser that failed to bind the debug port.
        mockFetch.mockRejectedValue(new Error('Connection refused'));

        let exitCallback: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
        mockSpawn.mockReturnValue({
          unref: vi.fn(),
          on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'exit') exitCallback = cb as typeof exitCallback;
          }),
        });

        const launchPromise = launchBrowser('chrome', 9222);
        // Let the pending awaits (pre-flight CDP check, App Nap exec) resolve
        // so spawn() actually runs and registers the 'exit' handler before we
        // simulate the crash.
        await vi.advanceTimersByTimeAsync(0);
        // Simulate the process crashing (e.g. locked profile) right after spawn.
        exitCallback!(1, null);

        await vi.advanceTimersByTimeAsync(750);
        const result = await launchPromise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('exited immediately');
        expect(result.error).toContain('code 1');
        expect(result.error).toContain('Activity Monitor');
      } finally {
        vi.useRealTimers();
      }
    });

    it('gives an actionable timeout message (port conflict or slow start) when CDP never comes up and the process stays alive', async () => {
      vi.useFakeTimers();
      try {
        (existsSync as ReturnType<typeof vi.fn>).mockImplementation(
          (p: string) => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        );
        mockFetch.mockRejectedValue(new Error('Connection refused'));
        mockSpawn.mockReturnValue({ unref: vi.fn(), on: vi.fn() }); // never exits, never errors

        const launchPromise = launchBrowser('chrome', 9222);
        await vi.advanceTimersByTimeAsync(20 * 750 + 1000);
        const result = await launchPromise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('9222');
        expect(result.error).toContain('Test Connection');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
