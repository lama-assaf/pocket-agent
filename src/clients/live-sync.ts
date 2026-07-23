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

import { SettingsManager } from '../settings';
import type { MemoryManager } from '../memory/index';

export interface BrainRepoLocation {
  dir: string;
  url: string;
  token: string;
}

/** Resolve the on-disk repo + remote for a scope ('world' or a client id). */
export async function resolveBrainRepo(
  memory: MemoryManager | null,
  scope: string
): Promise<BrainRepoLocation | null> {
  const token = SettingsManager.get('github.token') || '';
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
