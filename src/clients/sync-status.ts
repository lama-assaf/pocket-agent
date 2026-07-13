/**
 * Sync status helpers (roadmap item 9, relates to F6 from the research):
 * a client's brain is "stale" when it hasn't been pulled recently — a
 * teammate may have pushed updates this operator hasn't seen yet. Pure
 * function, no I/O, so it's trivially unit-testable and the UI/IPC layers
 * just format `computeSyncStatus`'s output.
 */

/** A client is flagged stale once its last pull is older than this. */
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

export type SyncFreshness = 'unconfigured' | 'never_pulled' | 'fresh' | 'stale';

export interface SyncStatusInput {
  /** Whether the client has both a repo URL and (implicitly) sync configured. */
  configured: boolean;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
}

export interface SyncStatus {
  freshness: SyncFreshness;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  /** Milliseconds since the last pull, or null when never pulled / unconfigured. */
  msSincePull: number | null;
}

/**
 * Classify a client's sync freshness relative to `now`. 'unconfigured' (no
 * repo URL) and 'never_pulled' (configured but no successful pull yet) are
 * distinct from 'stale' so the UI can word them differently ("not set up"
 * vs "pull to check for updates").
 */
export function computeSyncStatus(input: SyncStatusInput, now: Date = new Date()): SyncStatus {
  if (!input.configured) {
    return { freshness: 'unconfigured', lastPulledAt: null, lastPushedAt: input.lastPushedAt, msSincePull: null };
  }
  if (!input.lastPulledAt) {
    return {
      freshness: 'never_pulled',
      lastPulledAt: null,
      lastPushedAt: input.lastPushedAt,
      msSincePull: null,
    };
  }
  const pulledAt = new Date(input.lastPulledAt).getTime();
  if (Number.isNaN(pulledAt)) {
    return {
      freshness: 'never_pulled',
      lastPulledAt: input.lastPulledAt,
      lastPushedAt: input.lastPushedAt,
      msSincePull: null,
    };
  }
  const msSincePull = now.getTime() - pulledAt;
  return {
    freshness: msSincePull >= STALE_THRESHOLD_MS ? 'stale' : 'fresh',
    lastPulledAt: input.lastPulledAt,
    lastPushedAt: input.lastPushedAt,
    msSincePull,
  };
}
