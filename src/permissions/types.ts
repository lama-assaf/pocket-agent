/**
 * Shared permission types + metadata — used by both platform modules
 * (macos.ts, windows.ts) so neither owns the other's vocabulary. Split out
 * so macos.ts can stay macOS-only (single responsibility) once windows.ts
 * exists, instead of windows.ts importing types from a file named "macos".
 */

export type PermissionType =
  | 'accessibility'
  | 'screen-recording'
  | 'full-disk-access'
  | 'reminders'
  | 'contacts'
  | 'calendar'
  | 'camera'
  | 'microphone'
  | 'bluetooth'
  | 'automation';

export interface PermissionStatus {
  type: PermissionType;
  granted: boolean;
  canRequest: boolean;
  label: string;
  description: string;
  settingsUrl: string;
}

export const PERMISSION_INFO: Record<PermissionType, { label: string; description: string }> = {
  accessibility: {
    label: 'Accessibility',
    description: 'Control your computer and other apps',
  },
  'screen-recording': {
    label: 'Screen Recording',
    description: 'Capture screen content and screenshots',
  },
  'full-disk-access': {
    label: 'Full Disk Access',
    description: 'Access files in protected locations',
  },
  reminders: {
    label: 'Reminders',
    description: 'Read and create reminders',
  },
  contacts: {
    label: 'Contacts',
    description: 'Access your contacts',
  },
  calendar: {
    label: 'Calendar',
    description: 'Access your calendars and events',
  },
  camera: {
    label: 'Camera',
    description: 'Use your camera',
  },
  microphone: {
    label: 'Microphone',
    description: 'Use your microphone',
  },
  bluetooth: {
    label: 'Bluetooth',
    description: 'Discover and connect to Bluetooth devices',
  },
  automation: {
    label: 'Automation',
    description: 'Control other apps via AppleScript',
  },
};

/**
 * Get all permission types
 */
export function getAllPermissionTypes(): PermissionType[] {
  return Object.keys(PERMISSION_INFO) as PermissionType[];
}
