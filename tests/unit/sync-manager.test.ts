import { describe, it, expect, vi } from 'vitest';
import {
  pullBrainRepo,
  publishBrainRepo,
  DebouncedPusher,
  type BrainRepo,
} from '../../src/clients/sync-manager';

describe('sync-manager soft no-op when unconfigured', () => {
  it('pull returns not-ok without url/token (never throws)', async () => {
    const res = await pullBrainRepo({ dir: '/tmp/x', url: '', token: '' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not configured/);
  });

  it('publish returns not-ok without url/token', async () => {
    const res = await publishBrainRepo({ dir: '/tmp/x', url: '', token: '' }, 'msg');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not configured/);
  });
});

describe('DebouncedPusher', () => {
  const repo: BrainRepo = { dir: '/tmp/brandA', url: 'u', token: 't' };

  it('coalesces a burst of edits into a single publish', async () => {
    vi.useFakeTimers();
    const publish = vi.fn(async () => ({ ok: true, committed: true, pushed: true }));
    const pusher = new DebouncedPusher(1000, publish);

    pusher.schedule(repo, 'edit 1');
    pusher.schedule(repo, 'edit 2');
    pusher.schedule(repo, 'edit 3');
    expect(pusher.isPending(repo.dir)).toBe(true);
    expect(publish).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(repo, 'edit 3');
    expect(pusher.isPending(repo.dir)).toBe(false);
    vi.useRealTimers();
  });

  it('separate repos push independently', async () => {
    vi.useFakeTimers();
    const publish = vi.fn(async () => ({ ok: true, committed: true, pushed: true }));
    const pusher = new DebouncedPusher(500, publish);
    pusher.schedule({ dir: '/a', url: 'u', token: 't' }, 'a');
    pusher.schedule({ dir: '/b', url: 'u', token: 't' }, 'b');
    await vi.advanceTimersByTimeAsync(500);
    expect(publish).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('cancel prevents a pending push', async () => {
    vi.useFakeTimers();
    const publish = vi.fn(async () => ({ ok: true, committed: true, pushed: true }));
    const pusher = new DebouncedPusher(500, publish);
    pusher.schedule(repo, 'x');
    pusher.cancel(repo.dir);
    await vi.advanceTimersByTimeAsync(500);
    expect(publish).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
