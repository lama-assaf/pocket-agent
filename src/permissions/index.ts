/**
 * Cross-platform Permission Management
 *
 * Dispatches to a platform-specific module, resolved fresh on every call
 * (not cached at import time) so this file stays trivially testable and
 * matches every function in the platform modules themselves (each starts
 * with its own isMacOS()/isWindows() check anyway).
 *
 * macOS: full permission checking via system APIs (./macos.ts).
 * Everything else (Windows is the only other packaged target — see
 * package.json's `build.win`/`build.mac`): best-effort checking where
 * Windows exposes one (camera/microphone via the registry consent store),
 * granted for everything it doesn't gate the same way (./windows.ts).
 */

import * as os from 'os';
import * as macos from './macos';
import * as windows from './windows';
import type { PermissionType, PermissionStatus } from './types';

export type { PermissionType, PermissionStatus } from './types';
export { getAllPermissionTypes } from './types';

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return os.platform() === 'darwin';
}

function impl() {
  return isMacOS() ? macos : windows;
}

export function checkPermission(type: PermissionType): boolean {
  return impl().checkPermission(type);
}

export function getPermissionStatus(type: PermissionType): PermissionStatus {
  return impl().getPermissionStatus(type);
}

export function getPermissionsStatus(types: PermissionType[]): PermissionStatus[] {
  return impl().getPermissionsStatus(types);
}

export function getMissingPermissions(types: PermissionType[]): PermissionType[] {
  return impl().getMissingPermissions(types);
}

export function requestPermission(type: PermissionType): Promise<boolean> {
  return impl().requestPermission(type);
}

export function openPermissionSettings(type: PermissionType): Promise<void> {
  return impl().openPermissionSettings(type);
}
