/**
 * Injectable encryption backend for SettingsManager, so the settings module
 * (and everything that transitively imports it — e.g. MemoryManager via
 * src/memory/summarizer.ts) can be constructed in plain Node (scripts, CI,
 * vitest) with zero Electron shim.
 *
 * The previous code did `import { safeStorage } from 'electron'` at module
 * top level in src/settings/index.ts. That's a *static* ESM import: it's
 * resolved/linked the moment the module is loaded, regardless of whether
 * encryption is ever used. Outside a real Electron process,
 * node_modules/electron's stub package.json resolves 'electron' to a CJS
 * module whose entire export is a string (the path to the Electron binary),
 * which has no named export 'safeStorage' — so the import throws a
 * SyntaxError at load time:
 *   "Named export 'safeStorage' not found. The requested module 'electron'
 *    is a CommonJS module, which may not support all module.exports as
 *    named exports." (confirmed by running `node --input-type=module -e
 *    "import('./dist/settings/index.js')"` outside Electron.)
 *
 * Fix: never statically import 'electron'. Detect the real Electron main
 * process via `process.versions.electron` (set only when actually running
 * inside Electron) and lazily `require('electron')` ONLY then — outside
 * Electron, fall back to a plaintext passthrough, which is exactly the
 * degrade path SettingsManager already used when
 * safeStorage.isEncryptionAvailable() was false (see
 * migrateTokensToSafeStorage/encrypt in ./index.ts).
 */

import { createRequire } from 'node:module';

/** Minimal shape of Electron's safeStorage API this app depends on. */
export interface EncryptionProvider {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(buffer: Buffer): string;
}

/**
 * Plaintext passthrough used outside a real Electron process (headless
 * scripts, CI, vitest, or Electron builds where safeStorage failed to load).
 * Values round-trip unmodified — matches SettingsManager's existing
 * "encryption unavailable" behavior (store/read as plaintext with a warning)
 * rather than inventing new semantics for the headless case.
 */
export class PlaintextEncryptionProvider implements EncryptionProvider {
  isEncryptionAvailable(): boolean {
    return false;
  }
  encryptString(value: string): Buffer {
    return Buffer.from(value, 'utf-8');
  }
  decryptString(buffer: Buffer): string {
    return buffer.toString('utf-8');
  }
}

/** Node's `require`, resolved relative to this module (ESM has no global `require`). */
const nodeRequire = createRequire(import.meta.url);

/**
 * Real Electron safeStorage-backed provider. Only ever call this when
 * `process.versions.electron` is truthy — `require('electron')` from plain
 * Node resolves to the node_modules/electron stub (a path string, not the
 * API), so calling this outside Electron would throw.
 */
export function createElectronEncryptionProvider(): EncryptionProvider {
  const electronModule = nodeRequire('electron') as {
    safeStorage: {
      isEncryptionAvailable(): boolean;
      encryptString(value: string): Buffer;
      decryptString(buffer: Buffer): string;
    };
  };
  const { safeStorage } = electronModule;
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (buffer) => safeStorage.decryptString(buffer),
  };
}

/**
 * Resolve the default EncryptionProvider for the current process: the real
 * Electron safeStorage API when running inside Electron (`process.versions
 * .electron` set), otherwise a plaintext passthrough. This is what
 * SettingsManager uses unless a caller explicitly overrides it via
 * `setEncryptionProvider` (see src/main/index.ts for the explicit
 * Electron-side wiring).
 */
export function getDefaultEncryptionProvider(): EncryptionProvider {
  if (process.versions.electron) {
    try {
      return createElectronEncryptionProvider();
    } catch (e) {
      console.warn('[Settings] Failed to load Electron safeStorage; falling back to plaintext:', e);
    }
  }
  return new PlaintextEncryptionProvider();
}
