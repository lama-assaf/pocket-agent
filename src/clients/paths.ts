// src/clients/paths.ts
// Path resolution for world + client brains under <userData>. Mirrors
// src/marketplace/paths.ts: this project is genuine ESM, so reconstruct
// __dirname via import.meta.url and keep Electron OUT of this module (the main
// process injects the userData-derived roots via setClientsRoot/setWorldRoot),
// so unit tests need no Electron runtime.
import path from 'path';
import { fileURLToPath } from 'url';
import type { ClientPaths, ScopeRoot } from './types';
import { WORLD_SCOPE, clientScope } from '../memory/scope';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let clientsRootOverride: string | null = null;
let worldRootOverride: string | null = null;

/** Called once by the Electron main process at startup with <userData>/clients. */
export function setClientsRoot(dir: string): void {
  clientsRootOverride = dir;
}

/** Called once by the Electron main process at startup with <userData>/world. */
export function setWorldRoot(dir: string): void {
  worldRootOverride = dir;
}

/**
 * Runtime-canonical clients dir. Resolution order: CLIENTS_ROOT_OVERRIDE (tests)
 * → value injected by main via setClientsRoot() (production) → a dev-local dir.
 */
export function getClientsRoot(): string {
  return (
    process.env.CLIENTS_ROOT_OVERRIDE || clientsRootOverride || path.join(__dirname, '.clients')
  );
}

/** Runtime-canonical world dir. Same resolution order as getClientsRoot(). */
export function getWorldRoot(): string {
  return process.env.WORLD_ROOT_OVERRIDE || worldRootOverride || path.join(__dirname, '.world');
}

/** Resolve every on-disk path for a client id. */
export function clientPaths(id: string): ClientPaths {
  const rootDir = path.join(getClientsRoot(), id);
  return {
    id,
    rootDir,
    memoryDir: path.join(rootDir, '.atelier', 'memory'),
    guardrailsDir: path.join(rootDir, 'guardrails'),
  };
}

/** The world brain as a ScopeRoot (scope `world`). */
export function worldScopeRoot(): ScopeRoot {
  const rootDir = getWorldRoot();
  return { scope: WORLD_SCOPE, rootDir, memoryDir: path.join(rootDir, '.atelier', 'memory') };
}

/** A client brain as a ScopeRoot (scope `client:<id>`). */
export function clientScopeRoot(id: string): ScopeRoot {
  const p = clientPaths(id);
  return { scope: clientScope(id), rootDir: p.rootDir, memoryDir: p.memoryDir };
}
