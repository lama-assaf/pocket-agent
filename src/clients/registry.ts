// src/clients/registry.ts
// Thin index tying a session's selected context to the on-disk world + client
// brains. Parallels src/marketplace/registry.ts. Electron stays out — callers
// inject the userData-derived roots via ./paths.
import fs from 'fs';
import path from 'path';
import type { SessionContext } from '../memory/sessions';
import type { ScopeRoot } from './types';
import {
  clientPaths,
  clientScopeRoot,
  getClientsRoot,
  getWorldRoot,
  worldScopeRoot,
} from './paths';

/** Create the `.atelier/memory` + `guardrails` scaffold for the world brain. */
export function ensureWorldScaffold(): void {
  const root = worldScopeRoot();
  fs.mkdirSync(root.memoryDir, { recursive: true });
  fs.mkdirSync(path.join(getWorldRoot(), 'guardrails'), { recursive: true });
}

/** Create the `.atelier/memory` + `guardrails` scaffold for one client brain. */
export function ensureClientScaffold(id: string): void {
  const p = clientPaths(id);
  fs.mkdirSync(p.memoryDir, { recursive: true });
  fs.mkdirSync(p.guardrailsDir, { recursive: true });
}

/**
 * Resolve the ordered on-disk scope roots implied by a selection, base-first
 * (world → client), so a caller can mirror each into SQLite under its scope.
 * Personal/world-only selections yield just the world root (personal memory
 * never touches disk). An optional resolved project dir is appended nearest-last.
 */
export function scopeRootsForSelection(
  context: SessionContext,
  projectRoot?: { scope: string; rootDir: string; memoryDir: string } | null
): ScopeRoot[] {
  const roots: ScopeRoot[] = [];
  // World is the shared base of every non-personal context.
  if (context.contextType !== 'personal') {
    roots.push(worldScopeRoot());
  }
  if ((context.contextType === 'client' || context.contextType === 'project') && context.clientId) {
    roots.push(clientScopeRoot(context.clientId));
  }
  if (context.contextType === 'project' && projectRoot) {
    roots.push(projectRoot);
  }
  return roots;
}

/**
 * Guardrail file paths (world + active client) for the tone scanner to merge on
 * top of pack rules. Missing files are filtered out by the caller.
 */
export function guardrailFilesForContext(context: SessionContext): string[] {
  const files: string[] = [];
  if (context.contextType !== 'personal') {
    files.push(path.join(getWorldRoot(), 'guardrails', 'banned-words.md'));
  }
  if ((context.contextType === 'client' || context.contextType === 'project') && context.clientId) {
    files.push(path.join(clientPaths(context.clientId).guardrailsDir, 'banned-words.md'));
  }
  return files;
}

/**
 * The active client's `voice.md` path (single-owner brand voice), or null when
 * no client is selected. Appended on top of pack lane rules by lane-context.
 */
export function voiceFileForContext(context: SessionContext): string | null {
  if ((context.contextType === 'client' || context.contextType === 'project') && context.clientId) {
    return path.join(clientPaths(context.clientId).memoryDir, 'voice.md');
  }
  return null;
}

/** True when the clients/world roots have been created on disk. */
export function rootsExist(): boolean {
  return fs.existsSync(getClientsRoot()) || fs.existsSync(getWorldRoot());
}
