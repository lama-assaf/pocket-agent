/**
 * Windows Permission Detection and Management
 *
 * Windows only gates a handful of the permission types this app knows about
 * (camera/microphone via its per-app privacy consent store; contacts/
 * calendar have a Settings privacy page but no readable consent record this
 * app can query without a packaged UWP identity). Everything else
 * (accessibility, screen-recording, full-disk-access, reminders, bluetooth,
 * automation) is a macOS-only concept with no Windows equivalent gate, so
 * those are always reported granted here — mirrors macos.ts's own
 * "not on this platform -> granted" convention for permissions it doesn't
 * understand, just inverted.
 *
 * Consent state for camera/microphone is read from the registry's
 * CapabilityAccessManager consent store
 * (HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\<key>),
 * the same store Settings > Privacy writes to when the user flips a toggle.
 * Best-effort, same spirit as macos.ts's checkFullDiskAccess probe: an
 * inconclusive read (key missing, `reg` unavailable, anything else) degrades
 * to granted rather than blocking the app on a permission this module
 * couldn't actually confirm is denied.
 */

import { shell } from 'electron';
import { execSync } from 'child_process';
import * as os from 'os';
import { PERMISSION_INFO, type PermissionType, type PermissionStatus } from './types';

export type { PermissionType, PermissionStatus } from './types';
export { getAllPermissionTypes } from './types';

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return os.platform() === 'win32';
}

// Windows Settings privacy deep links — only the permission types Windows
// actually exposes a Settings > Privacy page for.
const SETTINGS_URLS: Partial<Record<PermissionType, string>> = {
  camera: 'ms-settings:privacy-webcam',
  microphone: 'ms-settings:privacy-microphone',
  calendar: 'ms-settings:privacy-calendar',
  contacts: 'ms-settings:privacy-contacts',
};

// CapabilityAccessManager consent-store subkey for the permission types
// Windows records a readable per-app consent value for.
const CONSENT_STORE_KEYS: Partial<Record<PermissionType, string>> = {
  camera: 'webcam',
  microphone: 'microphone',
};

/**
 * Read one permission's consent state from the registry consent store.
 * Returns false only when the store explicitly says "Deny"; anything else
 * (Allow, missing key, `reg` failing/unavailable) degrades to granted.
 */
function checkConsentStore(key: string): boolean {
  try {
    const result = execSync(
      `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\${key}" /v Value`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    return !/deny/i.test(result);
  } catch {
    return true;
  }
}

/**
 * Check if a specific permission is granted
 */
export function checkPermission(type: PermissionType): boolean {
  if (!isWindows()) {
    // Non-Windows platforms don't need this module's checks
    return true;
  }

  const consentKey = CONSENT_STORE_KEYS[type];
  if (consentKey) return checkConsentStore(consentKey);

  // No Windows-native gate for this permission type — treat as granted,
  // same as macOS's bluetooth/automation "hard to check, assume granted".
  return true;
}

/**
 * Get full status for a permission
 */
export function getPermissionStatus(type: PermissionType): PermissionStatus {
  const info = PERMISSION_INFO[type];
  return {
    type,
    granted: checkPermission(type),
    // Windows has no in-app re-prompt API this app can drive (unlike
    // macOS's systemPreferences.askForMediaAccess) — requestPermission
    // always routes to Settings instead, so nothing is "requestable" here.
    canRequest: false,
    label: info.label,
    description: info.description,
    settingsUrl: SETTINGS_URLS[type] ?? '',
  };
}

/**
 * Get status of multiple permissions
 */
export function getPermissionsStatus(types: PermissionType[]): PermissionStatus[] {
  return types.map((type) => getPermissionStatus(type));
}

/**
 * Check which permissions from a list are missing
 */
export function getMissingPermissions(types: PermissionType[]): PermissionType[] {
  if (!isWindows()) {
    return [];
  }
  return types.filter((type) => !checkPermission(type));
}

/**
 * Request a permission. Windows has no programmatic prompt API reachable
 * from Electron for these — always opens the relevant Settings page (when
 * one exists) and returns false, same "opens Settings, returns false"
 * fallback macos.ts uses for its own non-requestable types.
 */
export async function requestPermission(type: PermissionType): Promise<boolean> {
  if (!isWindows()) {
    return true;
  }
  await openPermissionSettings(type);
  return false;
}

/**
 * Open Windows Settings to the permission's privacy page
 */
export async function openPermissionSettings(type: PermissionType): Promise<void> {
  if (!isWindows()) {
    // Not this platform — src/permissions/index.ts routes macOS calls to
    // src/permissions/macos.ts instead; this is only a defensive no-op for
    // direct callers/tests of this module.
    return;
  }

  const url = SETTINGS_URLS[type];
  if (url) {
    await shell.openExternal(url);
  }
}
