// src/clients/sync-manager.ts
// Orchestrates git transport (src/clients/sync.ts) for world + client brains:
// clone-on-first-use, pull (append-mostly reconcile), and publish (commit+push).
// Electron-free — the token and repo URLs are injected by the caller (IPC),
// so this stays unit-testable and never imports settings or electron directly.

import {
  cloneBrain,
  commitAll,
  isRepo,
  pullBrain,
  pushBrain,
  type GitIdentity,
  type SingleOwnerPreference,
} from './sync';
import { clientPaths } from './paths';
import type { MemoryManager } from '../memory/index';

export interface BrainRepo {
  /** Working-tree root (the repo dir), e.g. <userData>/clients/<id>. */
  dir: string;
  /** Remote git URL. */
  url: string;
  /** GitHub token for auth. */
  token: string;
}

export interface PullResult {
  ok: boolean;
  cloned: boolean;
  merged: boolean;
  error?: string;
}

export interface PublishResult {
  ok: boolean;
  committed: boolean;
  pushed: boolean;
  error?: string;
}

/**
 * Pull a brain repo: clone on first use, otherwise fetch + append-mostly
 * reconcile. Missing url/token is a soft no-op (sync simply isn't configured).
 */
export async function pullBrainRepo(
  repo: BrainRepo,
  prefer: SingleOwnerPreference = 'theirs'
): Promise<PullResult> {
  if (!repo.url || !repo.token) {
    return { ok: false, cloned: false, merged: false, error: 'sync not configured' };
  }
  try {
    if (!(await isRepo(repo.dir))) {
      await cloneBrain({ dir: repo.dir, url: repo.url, token: repo.token });
      return { ok: true, cloned: true, merged: false };
    }
    const { merged } = await pullBrain({
      dir: repo.dir,
      url: repo.url,
      token: repo.token,
      prefer,
    });
    return { ok: true, cloned: false, merged };
  } catch (e) {
    return { ok: false, cloned: false, merged: false, error: (e as Error).message };
  }
}

/**
 * Publish local changes: commit everything, then push. A clean tree is a
 * successful no-op (committed:false, pushed:false).
 */
export async function publishBrainRepo(
  repo: BrainRepo,
  message: string,
  author?: GitIdentity
): Promise<PublishResult> {
  if (!repo.url || !repo.token) {
    return { ok: false, committed: false, pushed: false, error: 'sync not configured' };
  }
  try {
    const sha = await commitAll(repo.dir, message, author);
    if (!sha) return { ok: true, committed: false, pushed: false };
    await pushBrain({ dir: repo.dir, url: repo.url, token: repo.token });
    return { ok: true, committed: true, pushed: true };
  } catch (e) {
    return { ok: false, committed: false, pushed: false, error: (e as Error).message };
  }
}

/**
 * Debounced live push for client brains: append-only edits arrive in bursts, so
 * coalesce them into one commit+push per repo after a quiet period. Keyed by dir
 * so concurrent brands don't clobber each other's timers.
 */
export class DebouncedPusher {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly delayMs: number,
    private readonly publish: (repo: BrainRepo, message: string) => Promise<PublishResult>
  ) {}

  schedule(repo: BrainRepo, message: string): void {
    const existing = this.timers.get(repo.dir);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(repo.dir);
      void this.publish(repo, message).catch(() => {
        /* live push failures are non-fatal — the next edit reschedules */
      });
    }, this.delayMs);
    // Don't keep the event loop alive on account of a pending push.
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(repo.dir, timer);
  }

  /** Cancel any pending push for a repo (e.g. on shutdown). */
  cancel(dir: string): void {
    const t = this.timers.get(dir);
    if (t) {
      clearTimeout(t);
      this.timers.delete(dir);
    }
  }

  /** True when a push is pending for the given repo dir. */
  isPending(dir: string): boolean {
    return this.timers.has(dir);
  }
}

export interface AutoPullResult {
  id: string;
  name: string;
  ok: boolean;
  cloned: boolean;
  merged: boolean;
  error?: string;
}

/**
 * On-launch auto-pull for 'live'-mode clients (roadmap item 9 — honor
 * sync_mode without requiring a manual Pull click every session). Skips
 * clients with no repo URL or 'manual' sync mode entirely (never touches
 * their working tree). A missing GitHub token degrades every client to a
 * soft "not configured" no-op (pullBrainRepo's existing contract) rather
 * than throwing — first-run users with no token yet see zero errors.
 *
 * Deliberately does NOT re-mirror into SQLite here — the caller (main
 * process) already knows how to remirror via AtelierMemoryBridge; doing it
 * inline here would pull that wiring into this otherwise-Electron-free
 * module. Callers should remirror each successfully pulled client's scope
 * afterward (see src/main/index.ts, which uses clientScopeRoot from ./paths).
 */
export async function autoPullLiveClients(
  memory: MemoryManager,
  token: string
): Promise<AutoPullResult[]> {
  const clients = memory.getClients().filter((c) => c.sync_mode === 'live' && c.repo_url);
  const results: AutoPullResult[] = [];
  for (const client of clients) {
    const repo: BrainRepo = { dir: clientPaths(client.id).rootDir, url: client.repo_url || '', token };
    const result = await pullBrainRepo(repo);
    if (result.ok) memory.touchClientPulled(client.id);
    results.push({ id: client.id, name: client.name, ...result });
  }
  return results;
}
