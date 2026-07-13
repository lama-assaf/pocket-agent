/**
 * Sync freshness/stale detection (roadmap item 9, relates to F6). Pure
 * function tests against a fixed clock.
 */
import { describe, it, expect } from 'vitest';
import { computeSyncStatus, STALE_THRESHOLD_MS } from '../../src/clients/sync-status';

const NOW = new Date('2026-07-13T12:00:00.000Z');

describe('computeSyncStatus', () => {
  it('reports "unconfigured" when no repo is configured, regardless of timestamps', () => {
    const status = computeSyncStatus(
      { configured: false, lastPulledAt: '2026-07-13T00:00:00.000Z', lastPushedAt: null },
      NOW
    );
    expect(status.freshness).toBe('unconfigured');
    expect(status.msSincePull).toBeNull();
  });

  it('reports "never_pulled" when configured but no pull has happened yet', () => {
    const status = computeSyncStatus({ configured: true, lastPulledAt: null, lastPushedAt: null }, NOW);
    expect(status.freshness).toBe('never_pulled');
    expect(status.msSincePull).toBeNull();
  });

  it('reports "fresh" when pulled well within the stale threshold', () => {
    const recentPull = new Date(NOW.getTime() - 60_000).toISOString(); // 1 minute ago
    const status = computeSyncStatus({ configured: true, lastPulledAt: recentPull, lastPushedAt: null }, NOW);
    expect(status.freshness).toBe('fresh');
    expect(status.msSincePull).toBe(60_000);
  });

  it('reports "fresh" right at the edge (just under the threshold)', () => {
    const almostStale = new Date(NOW.getTime() - (STALE_THRESHOLD_MS - 1000)).toISOString();
    const status = computeSyncStatus({ configured: true, lastPulledAt: almostStale, lastPushedAt: null }, NOW);
    expect(status.freshness).toBe('fresh');
  });

  it('reports "stale" once the pull is older than the threshold', () => {
    const oldPull = new Date(NOW.getTime() - (STALE_THRESHOLD_MS + 1000)).toISOString();
    const status = computeSyncStatus({ configured: true, lastPulledAt: oldPull, lastPushedAt: null }, NOW);
    expect(status.freshness).toBe('stale');
  });

  it('reports "stale" exactly at the threshold boundary (inclusive)', () => {
    const exact = new Date(NOW.getTime() - STALE_THRESHOLD_MS).toISOString();
    const status = computeSyncStatus({ configured: true, lastPulledAt: exact, lastPushedAt: null }, NOW);
    expect(status.freshness).toBe('stale');
  });

  it('preserves lastPushedAt through the computation untouched', () => {
    const pushedAt = '2026-07-12T00:00:00.000Z';
    const status = computeSyncStatus(
      { configured: true, lastPulledAt: null, lastPushedAt: pushedAt },
      NOW
    );
    expect(status.lastPushedAt).toBe(pushedAt);
  });

  it('treats an unparseable lastPulledAt as never_pulled rather than crashing', () => {
    const status = computeSyncStatus(
      { configured: true, lastPulledAt: 'not-a-date', lastPushedAt: null },
      NOW
    );
    expect(status.freshness).toBe('never_pulled');
  });

  it('defaults `now` to the current time when omitted', () => {
    const justNow = new Date().toISOString();
    const status = computeSyncStatus({ configured: true, lastPulledAt: justNow, lastPushedAt: null });
    expect(status.freshness).toBe('fresh');
  });
});
