/**
 * Sub-agent resource ceilings (STAGE A #1): maxTurns / timeoutMs /
 * maxOutputChars actually forcing graceful termination, not just declared
 * constants nobody exercises.
 *
 * `createSubAgentTool`'s optional 4th param (`limits`, src/tools/subagent.ts)
 * makes these injectable so a test can force each limit with a tiny value
 * instead of waiting out the real 15-turn / 5-minute / 100k-char production
 * defaults. `@kenkaiiii/gg-agent`'s `agentLoop` is mocked (same boundary
 * chat-engine.test.ts mocks at) — real turn-by-turn model streaming can't run
 * in a unit test, so the mock stands in for the provider loop while every
 * limit-enforcement path INSIDE subagent.ts (the Promise.race timeout, the
 * truncateOutput cap) runs for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ToolContext } from '@kenkaiiii/gg-agent';

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn(() => 'claude-sonnet-4-6'),
    getArray: vi.fn(),
    set: vi.fn(),
  },
}));

// Stub only the async embedding writes — none of these tests touch memory,
// but subagent.ts transitively imports agent-overrides -> memory modules.
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

type MockEvent = Record<string, unknown>;

/** Captured on every mocked agentLoop call so tests can assert on options actually passed through. */
let capturedOptions: Record<string, unknown> | null = null;
/** Queue consumed FIFO — each test pushes exactly the behavior its scenario needs. */
let nextIterator: (() => AsyncIterator<MockEvent>) | null = null;

vi.mock('@kenkaiiii/gg-agent', () => ({
  agentLoop(_messages: unknown, options: Record<string, unknown>) {
    capturedOptions = options;
    const build = nextIterator;
    if (!build) throw new Error('test forgot to set nextIterator before calling execute()');
    return { [Symbol.asyncIterator]: build };
  },
}));

import { createSubAgentTool } from '../../src/tools/subagent';

function makeCtx(): ToolContext {
  return { signal: new AbortController().signal } as ToolContext;
}

const getStreamConfig = async () => ({ provider: 'anthropic' as const, apiKey: 'x' });

beforeEach(() => {
  capturedOptions = null;
  nextIterator = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sub-agent resource limits', () => {
  it('passes the injected maxTurns through to agentLoop, and a loop that honors it (simulating real enforcement) ends cleanly at that turn count', async () => {
    // A fake agentLoop that behaves like the real one's `while (turn < maxTurns)`
    // enforcement: emits exactly `maxTurns` turn_end events, never more, then
    // agent_done — proving subagent.ts surfaces a clean result (not a hang, not
    // an error) when the underlying loop terminates at the injected ceiling.
    let turnsEmitted = 0;
    nextIterator = () => {
      let phase: 'turns' | 'done' | 'finished' = 'turns';
      return {
        async next() {
          const maxTurns = capturedOptions!.maxTurns as number;
          if (phase === 'turns') {
            if (turnsEmitted < maxTurns) {
              turnsEmitted++;
              return {
                value: {
                  type: 'turn_end',
                  turn: turnsEmitted,
                  usage: { inputTokens: 10, outputTokens: 10 },
                } as MockEvent,
                done: false,
              };
            }
            phase = 'done';
          }
          if (phase === 'done') {
            phase = 'finished';
            return {
              value: {
                type: 'agent_done',
                totalTurns: turnsEmitted,
                totalUsage: { inputTokens: 10 * turnsEmitted, outputTokens: 10 * turnsEmitted },
              } as MockEvent,
              done: false,
            };
          }
          return { value: undefined, done: true };
        },
      };
    };

    const tool = createSubAgentTool([], getStreamConfig, undefined, {
      maxTurns: 2,
      maxOutputChars: 100_000,
      timeoutMs: 300_000,
    });

    const resultPromise = tool.execute({ task: 'do a multi-step task' }, makeCtx());
    const result = await resultPromise;

    expect(capturedOptions?.maxTurns).toBe(2);
    expect(turnsEmitted).toBe(2); // never exceeded the injected ceiling
    // No text was ever produced — subagent.ts's own "no text output" fallback,
    // proving a turn-ceiling termination surfaces as a clean result, not a crash.
    expect(result).toBe('Sub-agent completed with no text output.');
  });

  it('truncates output at the injected maxOutputChars, with a truncation banner naming the cap', async () => {
    const HUGE = 'x'.repeat(500);
    nextIterator = () => {
      let i = 0;
      const events: MockEvent[] = [
        { type: 'text_delta', text: HUGE },
        { type: 'agent_done', totalTurns: 1, totalUsage: { inputTokens: 1, outputTokens: 1 } },
      ];
      return {
        async next() {
          if (i < events.length) return { value: events[i++], done: false };
          return { value: undefined, done: true };
        },
      };
    };

    const tool = createSubAgentTool([], getStreamConfig, undefined, {
      maxTurns: 15,
      maxOutputChars: 50,
      timeoutMs: 300_000,
    });

    const result = await tool.execute({ task: 'produce a lot of text' }, makeCtx());

    expect(result.startsWith('x'.repeat(50))).toBe(true);
    expect(result).toContain('[Output truncated at 50 chars]');
    // The truncated body plus banner must not silently include the full HUGE text.
    expect(result.length).toBeLessThan(HUGE.length);
  });

  it('does not truncate output that fits within maxOutputChars', async () => {
    nextIterator = () => {
      let i = 0;
      const events: MockEvent[] = [
        { type: 'text_delta', text: 'short result' },
        { type: 'agent_done', totalTurns: 1, totalUsage: { inputTokens: 1, outputTokens: 1 } },
      ];
      return {
        async next() {
          if (i < events.length) return { value: events[i++], done: false };
          return { value: undefined, done: true };
        },
      };
    };

    const tool = createSubAgentTool([], getStreamConfig, undefined, {
      maxTurns: 15,
      maxOutputChars: 100_000,
      timeoutMs: 300_000,
    });

    const result = await tool.execute({ task: 'produce a little text' }, makeCtx());
    expect(result).toBe('short result');
    expect(result).not.toContain('truncated');
  });

  it('terminates gracefully at the injected timeoutMs when the loop never resolves (hang protection)', async () => {
    // A pathological agentLoop that never yields and never completes —
    // exactly the failure mode the timeout race exists to protect against.
    nextIterator = () => ({
      next() {
        return new Promise(() => {}); // never resolves
      },
    });

    const tool = createSubAgentTool([], getStreamConfig, undefined, {
      maxTurns: 15,
      maxOutputChars: 100_000,
      timeoutMs: 20, // tiny — fake timers make this instant, not a real 20ms wait
    });

    const resultPromise = tool.execute({ task: 'hang forever' }, makeCtx());
    // Advance past the timeout; the hung iterator's next() never settles, so
    // only the timeout branch of the Promise.race can resolve this.
    await vi.advanceTimersByTimeAsync(25);
    const result = await resultPromise;

    expect(result).toContain('Sub-agent was stopped');
    expect(result).toContain('timed out');
  });

  it('an abort signal firing before the timeout also terminates gracefully (not a hang)', async () => {
    nextIterator = () => ({
      next() {
        return new Promise(() => {}); // never resolves
      },
    });

    const controller = new AbortController();
    const ctx = { signal: controller.signal } as ToolContext;
    const tool = createSubAgentTool([], getStreamConfig, undefined, {
      maxTurns: 15,
      maxOutputChars: 100_000,
      timeoutMs: 300_000, // long — abort must win, not the timeout
    });

    const resultPromise = tool.execute({ task: 'hang forever' }, ctx);
    // Let execute()'s setup awaits (getStreamConfig, etc.) flush before
    // aborting — the abort listener is only attached once execution reaches
    // the Promise.race/timeout() call; aborting earlier than that would fire
    // the event before any listener exists (a real DOM-event gotcha, not a
    // subagent.ts bug), which isn't what this test is probing.
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    const result = await resultPromise;

    expect(result).toContain('Sub-agent was stopped');
    expect(result).toContain('aborted');
  });
});
