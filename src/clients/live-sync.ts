// src/clients/live-sync.ts
// Shared "resolve repo / remirror / import" helpers for scoped-memory brain
// sync, extracted from src/main/ipc/settings-ipc.ts's registerSettingsIPC
// closure (pure refactor — same behavior, one definition instead of a
// per-module closure) so every sync path — the manual Pull/Publish/PullAll
// IPC handlers, client-join, the periodic background-pull timer, and
// pull-on-client-switch — shares exactly one implementation.
//
// Electron-free like the rest of src/clients/: the memory manager and
// settings values are passed in by the caller rather than imported globally,
// so this stays unit-testable.

import fs from 'fs';
import path from 'path';
import { SettingsManager } from '../settings';
import { tokenForScope } from './tokens';
import type { MemoryManager } from '../memory/index';

export interface BrainRepoLocation {
  dir: string;
  url: string;
  token: string;
}

/**
 * Resolve the on-disk repo + remote for a scope ('world' or a client id).
 * Token resolution is per-scope: a client's own token override wins over the
 * global github.token (src/clients/tokens.ts).
 */
export async function resolveBrainRepo(
  memory: MemoryManager | null,
  scope: string
): Promise<BrainRepoLocation | null> {
  const token = tokenForScope(scope);
  const { getWorldRoot, clientPaths } = await import('./paths');
  if (scope === 'world') {
    return { dir: getWorldRoot(), url: SettingsManager.get('sync.world.repoUrl') || '', token };
  }
  const client = memory?.getClient(scope);
  if (!client) return null;
  return { dir: clientPaths(scope).rootDir, url: client.repo_url || '', token };
}

/** Re-mirror a freshly synced scope's files into SQLite so recall sees them. */
export async function remirrorScope(memory: MemoryManager | null, scope: string): Promise<void> {
  if (!memory) return;
  const { AtelierMemoryBridge } = await import('../memory/atelier-bridge');
  const { worldScopeRoot, clientScopeRoot } = await import('./paths');
  const root = scope === 'world' ? worldScopeRoot() : clientScopeRoot(scope);
  await new AtelierMemoryBridge(memory).syncScopeRoot(root);
}

/**
 * Re-mirror a freshly pulled client's imported-docs subtree (docs-import.ts's
 * docs/ tree, imported via the Import-docs button) into recallable memory,
 * same moment remirrorScope refreshes .atelier/memory.
 *
 * Closes the propagation gap docs-import.ts's own prune only solves on the
 * NEXT manual import: mirrorDocsDir's full delete-then-readd sweep of the
 * scope's docs/-prefixed facts means a file a teammate deleted at the source
 * (and removed from the git tree before pushing) stops being recallable the
 * moment THIS pull brings that deletion down, with no manual re-import.
 *
 * scope is the bare sync-scope key ('world' | a client id), matching every
 * other function here. World has no docs/ subtree (docs-import is
 * client-only) so this is a no-op there. Also a no-op for a client with no
 * docs/ dir on disk yet (never imported) — otherwise mirrorDocsDir's
 * delete-then-readd would run a pointless DB sweep on every pull for every
 * client, including ones that will never have imported docs.
 */
export async function remirrorImportedDocsForScope(
  memory: MemoryManager | null,
  scope: string
): Promise<void> {
  if (!memory || scope === 'world') return;
  const { clientPaths } = await import('./paths');
  const { clientScope } = await import('../memory/scope');
  const docsRoot = path.join(clientPaths(scope).rootDir, 'docs');
  if (!fs.existsSync(docsRoot)) return;
  const { AtelierMemoryBridge } = await import('../memory/atelier-bridge');
  await new AtelierMemoryBridge(memory).mirrorDocsDir(docsRoot, clientScope(scope), 'docs/');
}

/**
 * Re-import a freshly synced scope's shared analytics-posts.json into
 * post_analytics, so "Pull" makes a teammate's captured numbers queryable
 * offline immediately — same moment remirrorScope makes their voice/lessons
 * visible. Idempotent (importAnalyticsFromBrain dedupes internally); failures
 * are logged and swallowed so a malformed analytics file never blocks the
 * rest of the pull result from reaching the caller.
 */
export async function importAnalyticsForScope(
  memory: MemoryManager | null,
  scope: string
): Promise<void> {
  if (!memory) return;
  try {
    const { importAnalyticsFromBrain } = await import('./analytics-import');
    const memoryScope = scope === 'world' ? 'world' : `client:${scope}`;
    importAnalyticsFromBrain(memory, memoryScope);
  } catch (e) {
    console.error(`[Analytics] Import from brain failed for ${scope}:`, e);
  }
}

/**
 * Re-import a freshly synced scope's shared content-drafts.json +
 * campaigns.json into content_drafts/content_posts/campaigns/
 * campaign_deliverables, same moment/rationale as importAnalyticsForScope
 * above. Idempotent (importContentFromBrain dedupes internally); failures
 * are logged and swallowed so a malformed content file never blocks the
 * rest of the pull result from reaching the caller.
 */
export async function importContentForScope(
  memory: MemoryManager | null,
  scope: string
): Promise<void> {
  if (!memory) return;
  try {
    const { importContentFromBrain } = await import('./content-import');
    const memoryScope = scope === 'world' ? 'world' : `client:${scope}`;
    importContentFromBrain(memory, memoryScope);
  } catch (e) {
    console.error(`[Content] Import from brain failed for ${scope}:`, e);
  }
}
