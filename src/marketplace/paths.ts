import path from 'path';

/**
 * Runtime-canonical plugins dir: <userData>/plugins. Synced from og repos.
 * In unit tests, PACK_ROOT_OVERRIDE points at a fixture dir (avoids importing electron).
 */
export function getPluginsRoot(): string {
  if (process.env.PACK_ROOT_OVERRIDE) return process.env.PACK_ROOT_OVERRIDE;
  try {
    // Lazy require so tests don't need electron. Matches src/main/index.ts:444.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron');
    if (app?.getPath) return path.join(app.getPath('userData'), 'plugins');
  } catch { /* not running under electron (unit tests) */ }
  return getSeedRoot(); // non-electron fallback → read seed content directly
}

/**
 * Bundled seed (offline fallback). Packaged: <resources>/seed-plugins; dev: src/marketplace/seed.
 */
export function getSeedRoot(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  const packaged = path.join(process.resourcesPath || '', 'seed-plugins');
  if (process.resourcesPath && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'seed');
}
