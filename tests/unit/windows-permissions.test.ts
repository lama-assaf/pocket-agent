/**
 * Unit tests for Windows permission detection and management — mirrors
 * tests/unit/macos-permissions.test.ts's structure (mocked Electron/system
 * APIs, no real registry/network access).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockOpenExternal = vi.fn();

vi.mock('electron', () => ({
  shell: {
    openExternal: (...args: unknown[]) => mockOpenExternal(...args),
  },
}));

const mockExecSync = vi.fn(() => 'Value    REG_BINARY    01000000...\n');

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const mockPlatform = vi.fn(() => 'win32');

vi.mock('os', () => ({
  platform: () => mockPlatform(),
}));

import {
  isWindows,
  checkPermission,
  getMissingPermissions,
  getPermissionStatus,
  getPermissionsStatus,
  getAllPermissionTypes,
  requestPermission,
  openPermissionSettings,
} from '../../src/permissions/windows';

describe('windows-permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.mockReturnValue('win32');
    mockExecSync.mockReturnValue('Value    REG_BINARY    01000000...\n');
  });

  describe('isWindows', () => {
    it('returns true on win32', () => {
      mockPlatform.mockReturnValue('win32');
      expect(isWindows()).toBe(true);
    });

    it('returns false on other platforms', () => {
      mockPlatform.mockReturnValue('darwin');
      expect(isWindows()).toBe(false);
    });
  });

  describe('checkPermission', () => {
    it('returns true for camera when the consent store does not say Deny', () => {
      mockExecSync.mockReturnValue('Value    REG_BINARY    01000000...\n');
      expect(checkPermission('camera')).toBe(true);
    });

    it('returns false for camera when the consent store says Deny', () => {
      mockExecSync.mockReturnValue('Value    REG_SZ    Deny\n');
      expect(checkPermission('camera')).toBe(false);
    });

    it('returns true for microphone when allowed', () => {
      mockExecSync.mockReturnValue('Value    REG_SZ    Allow\n');
      expect(checkPermission('microphone')).toBe(true);
    });

    it('returns false for microphone when denied', () => {
      mockExecSync.mockReturnValue('Value    REG_SZ    Deny\n');
      expect(checkPermission('microphone')).toBe(false);
    });

    it('degrades to granted when the registry key is missing / reg query fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('ERROR: The system was unable to find the specified registry key.');
      });
      expect(checkPermission('camera')).toBe(true);
      expect(checkPermission('microphone')).toBe(true);
    });

    it('returns true (always granted) for permission types Windows does not gate', () => {
      expect(checkPermission('accessibility')).toBe(true);
      expect(checkPermission('screen-recording')).toBe(true);
      expect(checkPermission('full-disk-access')).toBe(true);
      expect(checkPermission('reminders')).toBe(true);
      expect(checkPermission('bluetooth')).toBe(true);
      expect(checkPermission('automation')).toBe(true);
      // No consent-store check should have run for any of these.
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('returns true for contacts/calendar (no readable consent record, not a hard gate)', () => {
      expect(checkPermission('contacts')).toBe(true);
      expect(checkPermission('calendar')).toBe(true);
    });

    it('returns true on non-Windows platforms for all types', () => {
      mockPlatform.mockReturnValue('darwin');
      expect(checkPermission('camera')).toBe(true);
      expect(checkPermission('microphone')).toBe(true);
      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });

  describe('getMissingPermissions', () => {
    it('returns types whose consent store says Deny', () => {
      mockExecSync.mockReturnValue('Value    REG_SZ    Deny\n');

      const missing = getMissingPermissions(['camera', 'microphone', 'bluetooth']);

      expect(missing).toContain('camera');
      expect(missing).toContain('microphone');
      // bluetooth has no Windows gate — never "missing"
      expect(missing).not.toContain('bluetooth');
    });

    it('returns empty array when nothing is denied', () => {
      mockExecSync.mockReturnValue('Value    REG_SZ    Allow\n');
      expect(getMissingPermissions(['camera', 'microphone'])).toEqual([]);
    });

    it('returns empty array on non-Windows platforms', () => {
      mockPlatform.mockReturnValue('darwin');
      expect(getMissingPermissions(['camera', 'microphone'])).toEqual([]);
    });
  });

  describe('getPermissionStatus', () => {
    it('returns correct status shape for a gated permission', () => {
      mockExecSync.mockReturnValue('Value    REG_SZ    Allow\n');
      const status = getPermissionStatus('camera');

      expect(status).toEqual({
        type: 'camera',
        granted: true,
        canRequest: false,
        label: 'Camera',
        description: expect.any(String),
        settingsUrl: 'ms-settings:privacy-webcam',
      });
    });

    it('canRequest is always false (no programmatic prompt API on Windows)', () => {
      expect(getPermissionStatus('camera').canRequest).toBe(false);
      expect(getPermissionStatus('accessibility').canRequest).toBe(false);
    });

    it('settingsUrl is empty for a type Windows has no Settings page for', () => {
      expect(getPermissionStatus('bluetooth').settingsUrl).toBe('');
    });
  });

  describe('getPermissionsStatus', () => {
    it('maps a list of types to their statuses', () => {
      const statuses = getPermissionsStatus(['camera', 'bluetooth']);
      expect(statuses.map((s) => s.type)).toEqual(['camera', 'bluetooth']);
    });
  });

  describe('getAllPermissionTypes', () => {
    it('returns all 10 permission types (shared with macos.ts)', () => {
      expect(getAllPermissionTypes()).toHaveLength(10);
    });
  });

  describe('requestPermission', () => {
    it('opens Settings and returns false (no programmatic prompt API)', async () => {
      const result = await requestPermission('camera');

      expect(result).toBe(false);
      expect(mockOpenExternal).toHaveBeenCalledWith('ms-settings:privacy-webcam');
    });

    it('returns true on non-Windows platforms without opening anything', async () => {
      mockPlatform.mockReturnValue('darwin');
      const result = await requestPermission('camera');

      expect(result).toBe(true);
      expect(mockOpenExternal).not.toHaveBeenCalled();
    });
  });

  describe('openPermissionSettings', () => {
    it('opens the ms-settings deep link for a gated type', async () => {
      await openPermissionSettings('microphone');
      expect(mockOpenExternal).toHaveBeenCalledWith('ms-settings:privacy-microphone');
    });

    it('does nothing for a type with no Windows Settings page', async () => {
      await openPermissionSettings('bluetooth');
      expect(mockOpenExternal).not.toHaveBeenCalled();
    });

    it('is a no-op on non-Windows platforms', async () => {
      mockPlatform.mockReturnValue('darwin');
      await openPermissionSettings('camera');
      expect(mockOpenExternal).not.toHaveBeenCalled();
    });
  });
});
