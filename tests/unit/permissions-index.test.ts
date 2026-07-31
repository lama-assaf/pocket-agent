/**
 * Cross-platform dispatch layer (src/permissions/index.ts) — verifies it
 * routes to macos.ts on darwin and windows.ts everywhere else, resolved
 * fresh on every call rather than cached at import time.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPlatform = vi.fn(() => 'darwin');
vi.mock('os', () => ({
  platform: () => mockPlatform(),
}));

const { macosMock, windowsMock } = vi.hoisted(() => ({
  macosMock: {
    checkPermission: vi.fn(() => 'macos-check'),
    getPermissionStatus: vi.fn(() => 'macos-status'),
    getPermissionsStatus: vi.fn(() => 'macos-statuses'),
    getMissingPermissions: vi.fn(() => 'macos-missing'),
    requestPermission: vi.fn(async () => 'macos-request'),
    openPermissionSettings: vi.fn(async () => 'macos-open'),
  },
  windowsMock: {
    checkPermission: vi.fn(() => 'windows-check'),
    getPermissionStatus: vi.fn(() => 'windows-status'),
    getPermissionsStatus: vi.fn(() => 'windows-statuses'),
    getMissingPermissions: vi.fn(() => 'windows-missing'),
    requestPermission: vi.fn(async () => 'windows-request'),
    openPermissionSettings: vi.fn(async () => 'windows-open'),
  },
}));

vi.mock('../../src/permissions/macos', () => macosMock);
vi.mock('../../src/permissions/windows', () => windowsMock);

import {
  isMacOS,
  checkPermission,
  getPermissionStatus,
  getPermissionsStatus,
  getMissingPermissions,
  requestPermission,
  openPermissionSettings,
  getAllPermissionTypes,
} from '../../src/permissions/index';

describe('permissions/index dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.mockReturnValue('darwin');
  });

  describe('isMacOS', () => {
    it('reflects the current platform', () => {
      mockPlatform.mockReturnValue('darwin');
      expect(isMacOS()).toBe(true);
      mockPlatform.mockReturnValue('win32');
      expect(isMacOS()).toBe(false);
    });
  });

  describe('routes to macos.ts on darwin', () => {
    beforeEach(() => mockPlatform.mockReturnValue('darwin'));

    it('checkPermission', () => {
      expect(checkPermission('camera')).toBe('macos-check');
      expect(macosMock.checkPermission).toHaveBeenCalledWith('camera');
      expect(windowsMock.checkPermission).not.toHaveBeenCalled();
    });

    it('getPermissionStatus', () => {
      expect(getPermissionStatus('camera')).toBe('macos-status');
    });

    it('getPermissionsStatus', () => {
      expect(getPermissionsStatus(['camera'])).toBe('macos-statuses');
    });

    it('getMissingPermissions', () => {
      expect(getMissingPermissions(['camera'])).toBe('macos-missing');
    });

    it('requestPermission', async () => {
      expect(await requestPermission('camera')).toBe('macos-request');
    });

    it('openPermissionSettings', async () => {
      expect(await openPermissionSettings('camera')).toBe('macos-open');
    });
  });

  describe('routes to windows.ts on win32', () => {
    beforeEach(() => mockPlatform.mockReturnValue('win32'));

    it('checkPermission', () => {
      expect(checkPermission('camera')).toBe('windows-check');
      expect(windowsMock.checkPermission).toHaveBeenCalledWith('camera');
      expect(macosMock.checkPermission).not.toHaveBeenCalled();
    });

    it('getPermissionStatus', () => {
      expect(getPermissionStatus('camera')).toBe('windows-status');
    });

    it('getPermissionsStatus', () => {
      expect(getPermissionsStatus(['camera'])).toBe('windows-statuses');
    });

    it('getMissingPermissions', () => {
      expect(getMissingPermissions(['camera'])).toBe('windows-missing');
    });

    it('requestPermission', async () => {
      expect(await requestPermission('camera')).toBe('windows-request');
    });

    it('openPermissionSettings', async () => {
      expect(await openPermissionSettings('camera')).toBe('windows-open');
    });
  });

  it('routes to windows.ts on any non-darwin platform (e.g. linux), not just win32', () => {
    mockPlatform.mockReturnValue('linux');
    expect(checkPermission('camera')).toBe('windows-check');
  });

  it('getAllPermissionTypes is platform-independent (shared types module)', () => {
    expect(getAllPermissionTypes()).toHaveLength(10);
  });
});
