import { describe, expect, it, vi } from 'vitest';
import { PlanApprovalStore } from '../../src/agent/plan-approval';

describe('PlanApprovalStore', () => {
  it('proposes a pending plan', () => {
    const plan = new PlanApprovalStore().propose('s', 'Do work');
    expect(plan).toMatchObject({ sessionId: 's', content: 'Do work', status: 'pending' });
  });

  it('approves a pending plan and rejects duplicate approval', () => {
    const store = new PlanApprovalStore();
    const plan = store.propose('s', 'Do work');
    expect(store.approve('s', plan.id).ok).toBe(true);
    expect(store.approve('s', plan.id)).toMatchObject({ ok: false });
  });

  it('rejects a plan permanently and preserves feedback', async () => {
    const store = new PlanApprovalStore();
    const plan = store.propose('s', 'Do work');
    expect(store.reject('s', plan.id, 'Change it')).toMatchObject({ ok: true, plan: { status: 'rejected', feedback: 'Change it' } });
    const execute = vi.fn();
    expect(await store.executeOnce('s', plan.id, execute)).toMatchObject({ ok: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it('gates execution until approval', async () => {
    const store = new PlanApprovalStore();
    const plan = store.propose('s', 'Do work');
    const execute = vi.fn();
    expect(await store.executeOnce('s', plan.id, execute)).toMatchObject({ ok: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes an approved plan exactly once', async () => {
    const store = new PlanApprovalStore();
    const plan = store.propose('s', 'Do work');
    store.approve('s', plan.id);
    const execute = vi.fn(async () => 'done');
    expect(await store.executeOnce('s', plan.id, execute)).toEqual({ ok: true, value: 'done' });
    expect(await store.executeOnce('s', plan.id, execute)).toMatchObject({ ok: false });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('marks failed execution and never retries implicitly', async () => {
    const store = new PlanApprovalStore();
    const plan = store.propose('s', 'Do work');
    store.approve('s', plan.id);
    const execute = vi.fn(async () => { throw new Error('boom'); });
    expect(await store.executeOnce('s', plan.id, execute)).toEqual({ ok: false, error: 'boom' });
    expect(store.getCurrent('s')).toMatchObject({ status: 'failed', error: 'boom' });
    expect(await store.executeOnce('s', plan.id, execute)).toMatchObject({ ok: false });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('fails stale and cross-session transitions safely', () => {
    const store = new PlanApprovalStore();
    const plan = store.propose('s', 'Do work');
    expect(store.approve('other', plan.id)).toMatchObject({ ok: false, error: 'Plan is invalid or stale.' });
    expect(store.reject('s', 'missing')).toMatchObject({ ok: false });
  });
});
