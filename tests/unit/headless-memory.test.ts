/**
 * Proves the memory layer is usable headless: `MemoryManager` (src/memory/index.ts)
 * transitively imports src/memory/summarizer.ts -> src/settings (SettingsManager),
 * which used to do a top-level `import { safeStorage } from 'electron'`. That's a
 * *static* ESM import — resolved the moment the module loads, regardless of whether
 * encryption is ever exercised. Outside a real Electron process, node_modules/electron
 * resolves to a stub whose entire export is a path string with no named export
 * 'safeStorage', so loading the compiled module under plain Node's ESM loader threw:
 *   "SyntaxError: Named export 'safeStorage' not found. The requested module
 *    'electron' is a CommonJS module..."
 * (confirmed by running `node --input-type=module -e "import('./dist/settings/index.js')"`
 * outside Electron, before this fix).
 *
 * This file deliberately mocks NEITHER 'electron' NOR '../../src/settings' —
 * unlike every other test that touches SettingsManager — specifically to prove the
 * real modules load and function with zero Electron shim, using the injectable
 * EncryptionProvider (src/settings/encryption-provider.ts) instead.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/index';
import { SettingsManager } from '../../src/settings';
import { PlaintextEncryptionProvider } from '../../src/settings/encryption-provider';

describe('Headless memory layer (no Electron shim)', () => {
  let memory: MemoryManager | undefined;

  afterEach(() => {
    memory?.close();
    memory = undefined;
  });

  it('constructs a real MemoryManager against an in-memory DB under plain Node/vitest', () => {
    expect(() => {
      memory = new MemoryManager(':memory:');
    }).not.toThrow();
    expect(memory).toBeDefined();
  });

  it('MemoryManager is fully usable (facts CRUD) once constructed headless', () => {
    memory = new MemoryManager(':memory:');
    const id = memory.saveFact('test', 'headless-subject', 'headless-content');
    expect(id).toBeGreaterThan(0);
    const fact = memory.getFact(id);
    expect(fact?.content).toBe('headless-content');
  });

  it('the real SettingsManager singleton initializes and round-trips an encrypted setting headlessly', () => {
    // Not running inside Electron (process.versions.electron is unset under
    // plain Node/vitest) — getDefaultEncryptionProvider() must fall back to
    // PlaintextEncryptionProvider rather than touching `electron` at all.
    expect(process.versions.electron).toBeUndefined();

    expect(() => {
      SettingsManager.initialize(':memory:');
    }).not.toThrow();

    // auth.oauthToken is schema-marked encrypted:true — this exercises the
    // real encrypt()/decrypt() code path (via this.encryptionProvider), not
    // just construction.
    expect(() => {
      SettingsManager.set('auth.oauthToken', 'headless-test-token');
    }).not.toThrow();
    expect(SettingsManager.get('auth.oauthToken')).toBe('headless-test-token');

    SettingsManager.close();
  });

  it('PlaintextEncryptionProvider round-trips values unmodified (the headless degrade path)', () => {
    const provider = new PlaintextEncryptionProvider();
    expect(provider.isEncryptionAvailable()).toBe(false);
    const encrypted = provider.encryptString('secret-value');
    expect(provider.decryptString(encrypted)).toBe('secret-value');
  });
});
