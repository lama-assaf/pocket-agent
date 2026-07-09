// src/marketplace/paths.ts
// This project is genuine ESM ("type":"module", tsconfig module ES2022). Do NOT use
// require()/bare __dirname — reconstruct __dirname via import.meta.url like src/main/ does.
// Keep electron OUT of this module so unit tests need no electron runtime: the main
// process injects the userData path via setPluginsRoot().
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pluginsRootOverride: string | null = null;

/** Called once by the Electron main process at startup with <userData>/plugins. */
export function setPluginsRoot(dir: string): void {
  pluginsRootOverride = dir;
}

/**
 * Runtime-canonical plugins dir. Resolution order: PACK_ROOT_OVERRIDE (tests) →
 * value injected by main via setPluginsRoot() (production) → bundled seed (fallback).
 */
export function getPluginsRoot(): string {
  return process.env.PACK_ROOT_OVERRIDE || pluginsRootOverride || getSeedRoot();
}

/** Bundled seed (offline fallback). Packaged: <resources>/seed-plugins; dev: src/marketplace/seed. */
export function getSeedRoot(): string {
  const packaged = path.join(process.resourcesPath || '', 'seed-plugins');
  if (process.resourcesPath && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'seed');
}
