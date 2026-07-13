/**
 * On-launch auto-pull for 'live'-mode clients (roadmap item 9). Verifies
 * sync_mode is honored: 'live' clients with a repo are pulled, 'manual'
 * clients and clients with no repo URL are skipped entirely, and a
 * successful pull stamps last_pulled_at on the client row.
 *
 * Mocks the underlying git primitives (src/clients/sync.ts's isRepo/
 * cloneBrain/pullBrain) rather than src/clients/sync-manager.ts itself —
 * autoPullLiveClients calls pullBrainRepo via its own module-internal
 * reference, which a self-mock of sync-manager.ts's exports would not
 * intercept (a standard ESM self-mocking limitation).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub only the async embedding writes so MemoryManager needs no embedding model.
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

const isRepoMock = vi.fn();
const cloneBrainMock = vi.fn();
const pullBrainMock = vi.fn();
vi.mock('../../src/clients/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/clients/sync')>();
  return {
    ...actual,
    isRepo: (...args: unknown[]) => isRepoMock(...args),
    cloneBrain: (...args: unknown[]) => cloneBrainMock(...args),
    pullBrain: (...args: unknown[]) => pullBrainMock(...args),
  };
});

import { MemoryManager } from '../../src/memory/index';
import { autoPullLiveClients } from '../../src/clients/sync-manager';

let memory: MemoryManager;

beforeEach(() => {
  isRepoMock.mockReset();
  cloneBrainMock.mockReset();
  pullBrainMock.mockReset();
  memory = new MemoryManager(':memory:');
});

describe('autoPullLiveClients', () => {
  it('pulls only clients in "live" sync mode with a repo URL configured', async () => {
    memory.createClient({ id: 'live-a', name: 'Live A', syncMode: 'live', repoUrl: 'https://x/a' });
    memory.createClient({ id: 'manual-b', name: 'Manual B', syncMode: 'manual', repoUrl: 'https://x/b' });
    memory.createClient({ id: 'no-repo-c', name: 'No Repo C', syncMode: 'live', repoUrl: null });

    isRepoMock.mockResolvedValue(false); // not cloned yet -> clone path
    cloneBrainMock.mockResolvedValue(undefined);

    const results = await autoPullLiveClients(memory, 'tok');

    expect(results.map((r) => r.id)).toEqual(['live-a']);
    expect(cloneBrainMock).toHaveBeenCalledTimes(1);
    expect(cloneBrainMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://x/a', token: 'tok' })
    );
    memory.close();
  });

  it('stamps last_pulled_at on a successful pull (clone-on-first-use path)', async () => {
    memory.createClient({ id: 'acme', name: 'Acme', syncMode: 'live', repoUrl: 'https://x/acme' });
    isRepoMock.mockResolvedValue(false);
    cloneBrainMock.mockResolvedValue(undefined);

    expect(memory.getClient('acme')!.last_pulled_at).toBeNull();
    const results = await autoPullLiveClients(memory, 'tok');
    expect(results[0].ok).toBe(true);
    expect(memory.getClient('acme')!.last_pulled_at).toBeTruthy();
    memory.close();
  });

  it('stamps last_pulled_at on a successful pull (already-cloned fetch+merge path)', async () => {
    memory.createClient({ id: 'acme', name: 'Acme', syncMode: 'live', repoUrl: 'https://x/acme' });
    isRepoMock.mockResolvedValue(true);
    pullBrainMock.mockResolvedValue({ merged: true });

    const results = await autoPullLiveClients(memory, 'tok');
    expect(results[0].ok).toBe(true);
    expect(memory.getClient('acme')!.last_pulled_at).toBeTruthy();
    memory.close();
  });

  it('does NOT stamp last_pulled_at when the pull fails', async () => {
    memory.createClient({ id: 'acme', name: 'Acme', syncMode: 'live', repoUrl: 'https://x/acme' });
    isRepoMock.mockResolvedValue(true);
    pullBrainMock.mockRejectedValue(new Error('network error'));

    const results = await autoPullLiveClients(memory, 'tok');
    expect(results[0].ok).toBe(false);
    expect(memory.getClient('acme')!.last_pulled_at).toBeNull();
    memory.close();
  });

  it('returns [] and never touches git when there are no live clients', async () => {
    memory.createClient({ id: 'manual-only', name: 'Manual', syncMode: 'manual', repoUrl: 'https://x' });
    const results = await autoPullLiveClients(memory, 'tok');
    expect(results).toEqual([]);
    expect(isRepoMock).not.toHaveBeenCalled();
    memory.close();
  });

  it('one client failing does not stop the others from being pulled', async () => {
    memory.createClient({ id: 'ok-a', name: 'OK A', syncMode: 'live', repoUrl: 'https://x/a' });
    memory.createClient({ id: 'bad-b', name: 'Bad B', syncMode: 'live', repoUrl: 'https://x/b' });
    isRepoMock.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    pullBrainMock
      .mockResolvedValueOnce({ merged: false })
      .mockRejectedValueOnce(new Error('boom'));

    const results = await autoPullLiveClients(memory, 'tok');
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.id === 'ok-a')?.ok).toBe(true);
    expect(results.find((r) => r.id === 'bad-b')?.ok).toBe(false);
    memory.close();
  });

  it('a missing token still returns results with a "not configured" soft error, never throws', async () => {
    memory.createClient({ id: 'acme', name: 'Acme', syncMode: 'live', repoUrl: 'https://x/acme' });
    const results = await autoPullLiveClients(memory, '');
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/not configured/);
    expect(isRepoMock).not.toHaveBeenCalled();
    memory.close();
  });
});
