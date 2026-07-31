/**
 * plan:* IPC surface (propose -> approve/reject -> execute).
 *
 * Same mocking pattern as campaign-ipc.test.ts/content-ipc.test.ts: capture
 * ipcMain.handle registrations without a real Electron runtime. Unlike those
 * files, PlanApprovals (src/agent/plan-approval.ts) is used for real here —
 * it's the in-memory state machine the whole flow is built on, and the
 * point of these tests is to prove the IPC handlers drive it correctly, not
 * to re-mock it away. Each test uses a unique sessionId since the store is
 * a module-level singleton shared across tests in this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers.set(channel, handler);
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: [string, (...a: unknown[]) => unknown]) => mockIpcMainHandle(...args),
  },
  app: { getPath: vi.fn(() => '/tmp') },
}));

const { processMessage } = vi.hoisted(() => ({
  processMessage: vi.fn(async () => ({ response: 'done', tokensUsed: 0, wasCompacted: false })),
}));

vi.mock('../../src/agent', () => ({
  AgentManager: {
    isInitialized: vi.fn(() => true),
    processMessage,
    on: vi.fn(),
    off: vi.fn(),
    getRecentMessages: vi.fn(() => []),
    getStats: vi.fn(() => ({})),
    clearQueue: vi.fn(),
    clearConversation: vi.fn(),
    stopQuery: vi.fn(() => true),
    setMode: vi.fn(),
    getMode: vi.fn(() => 'coder'),
  },
}));

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    hasRequiredKeys: vi.fn(() => true),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../src/main/windows', () => ({
  getWindow: vi.fn(() => null),
}));

import { registerAgentIPC } from '../../src/main/ipc/agent-ipc';

function register() {
  handlers.clear();
  mockIpcMainHandle.mockClear();
  registerAgentIPC({
    getMemory: () => null,
    getTelegramBot: () => null,
    updateTrayMenu: vi.fn(),
    WIN: {} as never,
    initializeAgent: vi.fn(),
    restartAgent: vi.fn(),
  } as never);
}

describe('agent-ipc: plan:* registration', () => {
  beforeEach(register);

  it('registers propose/getCurrent/approve/reject channels', () => {
    expect(handlers.has('plan:propose')).toBe(true);
    expect(handlers.has('plan:getCurrent')).toBe(true);
    expect(handlers.has('plan:approve')).toBe(true);
    expect(handlers.has('plan:reject')).toBe(true);
  });
});

describe('agent-ipc: propose', () => {
  beforeEach(() => {
    register();
    processMessage.mockClear();
  });

  it('creates a pending plan visible via plan:getCurrent', async () => {
    const proposed = (await handlers.get('plan:propose')!({}, 'propose-s1', 'Do the thing')) as {
      success: boolean;
      plan?: { id: string; status: string; content: string };
    };
    expect(proposed.success).toBe(true);
    expect(proposed.plan).toMatchObject({ status: 'pending', content: 'Do the thing' });

    const current = await handlers.get('plan:getCurrent')!({}, 'propose-s1');
    expect(current).toMatchObject({ id: proposed.plan!.id, status: 'pending' });
  });

  it('rejects a second concurrent proposal on the same session', async () => {
    await handlers.get('plan:propose')!({}, 'propose-s2', 'First plan');
    const second = (await handlers.get('plan:propose')!({}, 'propose-s2', 'Second plan')) as {
      success: boolean;
      error?: string;
    };
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already has an active plan/);
  });
});

describe('agent-ipc: approve -> execute', () => {
  beforeEach(() => {
    register();
    processMessage.mockClear();
  });

  it('approves a pending plan and executes it exactly once via AgentManager.processMessage', async () => {
    const proposed = (await handlers.get('plan:propose')!({}, 'approve-s1', 'Ship the feature')) as {
      plan: { id: string };
    };
    const planId = proposed.plan.id;

    processMessage.mockResolvedValueOnce({ response: 'Executed successfully', tokensUsed: 42, wasCompacted: false });

    const result = (await handlers.get('plan:approve')!({}, 'approve-s1', planId)) as {
      success: boolean;
      result?: { response: string };
    };

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ response: 'Executed successfully' });
    expect(processMessage).toHaveBeenCalledTimes(1);
    const [message, channel, sessionId] = processMessage.mock.calls[0];
    expect(message).toContain('Ship the feature');
    expect(message).toContain('approved');
    expect(channel).toBe('desktop');
    expect(sessionId).toBe('approve-s1');

    // The plan is now executed — approving it again must fail, and must not
    // trigger a second execution (no duplicate side effects).
    const secondApprove = (await handlers.get('plan:approve')!({}, 'approve-s1', planId)) as {
      success: boolean;
      error?: string;
    };
    expect(secondApprove.success).toBe(false);
    expect(processMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects approval of an unknown/stale plan id without executing anything', async () => {
    const result = (await handlers.get('plan:approve')!({}, 'approve-s2', 'not-a-real-id')) as {
      success: boolean;
      error?: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('surfaces an execution failure as success: false without leaving the plan approved', async () => {
    const proposed = (await handlers.get('plan:propose')!({}, 'approve-s3', 'Risky plan')) as {
      plan: { id: string };
    };
    const planId = proposed.plan.id;

    processMessage.mockRejectedValueOnce(new Error('provider exploded'));

    const result = (await handlers.get('plan:approve')!({}, 'approve-s3', planId)) as {
      success: boolean;
      error?: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/provider exploded/);

    const current = await handlers.get('plan:getCurrent')!({}, 'approve-s3');
    expect(current).toMatchObject({ status: 'failed' });
  });
});

describe('agent-ipc: reject', () => {
  beforeEach(() => {
    register();
    processMessage.mockClear();
  });

  it('discards a pending plan with feedback and never executes it', async () => {
    const proposed = (await handlers.get('plan:propose')!({}, 'reject-s1', 'Bad plan')) as {
      plan: { id: string };
    };
    const planId = proposed.plan.id;

    const result = (await handlers.get('plan:reject')!({}, 'reject-s1', planId, 'too risky')) as {
      success: boolean;
      plan?: { status: string; feedback?: string };
    };

    expect(result.success).toBe(true);
    expect(result.plan).toMatchObject({ status: 'rejected', feedback: 'too risky' });
    expect(processMessage).not.toHaveBeenCalled();

    // A rejected plan can never transition to approved/executed.
    const approveAfterReject = (await handlers.get('plan:approve')!({}, 'reject-s1', planId)) as {
      success: boolean;
    };
    expect(approveAfterReject.success).toBe(false);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('rejects without feedback', async () => {
    const proposed = (await handlers.get('plan:propose')!({}, 'reject-s2', 'Another plan')) as {
      plan: { id: string };
    };
    const result = (await handlers.get('plan:reject')!({}, 'reject-s2', proposed.plan.id)) as {
      success: boolean;
      plan?: { status: string; feedback?: string };
    };
    expect(result.success).toBe(true);
    expect(result.plan?.status).toBe('rejected');
    expect(result.plan?.feedback).toBeUndefined();
  });
});
