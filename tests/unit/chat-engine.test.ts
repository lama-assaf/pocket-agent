/**
 * Unit tests for ChatEngine after migration to @kenkaiiii/gg-agent + @kenkaiiii/gg-ai
 *
 * Tests:
 * - Public interface preservation (processMessage, stopQuery, isQueryProcessing, clearSession, buildSystemPrompt, getDeveloperPrompt)
 * - Thinking level mapping
 * - System prompt building (static/dynamic split)
 * - Session management (abort, queue, clear)
 * - Status event emission
 * - Token tracking from agent events
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

// ── Mock event helpers ────────────────────────────────────────────────

function makeTextDelta(text: string) {
  return { type: 'text_delta' as const, text };
}

function makeTurnEnd(
  turn: number,
  usage: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number }
) {
  return { type: 'turn_end' as const, turn, usage };
}

function makeAgentDone(
  totalTurns: number,
  totalUsage: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number }
) {
  return { type: 'agent_done' as const, totalTurns, totalUsage };
}

// ── Mock Agent class ──────────────────────────────────────────────────

let capturedAgentOptions: Record<string, unknown> | null = null;
let capturedAgentMessages: Array<Record<string, unknown>> | null = null;
let mockAgentEvents: Array<Record<string, unknown>> = [];
/** When set, the plain (non-gated) mocked agentLoop iterator throws this after yielding mockAgentEvents (or immediately if empty), then clears itself. */
let mockAgentError: Error | null = null;

/**
 * Optional gate for controlling iteration timing of the mocked agentLoop.
 * When set, each call to agentLoop builds a fresh async iterator that awaits
 * `gate.start` before yielding events. Tests can use this to pause an in-flight
 * `processMessage` while making concurrent calls.
 */
interface IterationGate {
  start: Promise<void>;
  release: () => void;
  events: Array<Record<string, unknown>>;
}
let pendingGates: IterationGate[] = [];
let gateConsumerIndex = 0;

function createGate(events: Array<Record<string, unknown>>): IterationGate {
  let release!: () => void;
  const start = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { start, release, events };
}

vi.mock('@kenkaiiii/gg-agent', () => ({
  Agent: class MockAgent {
    constructor(options: Record<string, unknown>) {
      capturedAgentOptions = options;
    }
    prompt(_message: string) {
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < mockAgentEvents.length) {
                return { value: mockAgentEvents[i++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };
    }
  },
  agentLoop(messages: Array<Record<string, unknown>>, options: Record<string, unknown>) {
    capturedAgentMessages = messages;
    capturedAgentOptions = options;

    // If gates are queued, consume one in FIFO order so the Nth call to
    // agentLoop drives the Nth processMessage execution.
    const gate = pendingGates[gateConsumerIndex++];
    if (gate) {
      const events = gate.events;
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          let started = false;
          return {
            async next() {
              if (!started) {
                await gate.start;
                started = true;
              }
              if (i < events.length) {
                return { value: events[i++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };
    }

    return {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            if (i < mockAgentEvents.length) {
              return { value: mockAgentEvents[i++], done: false };
            }
            if (mockAgentError) {
              const err = mockAgentError;
              mockAgentError = null;
              throw err;
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
  },
}));

vi.mock('@kenkaiiii/gg-ai', () => ({
  stream: vi.fn(),
}));

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn((key: string) => {
      if (key === 'agent.model') return 'claude-opus-4-8';
      if (key === 'agent.thinkingLevel') return 'normal';
      return undefined;
    }),
    getFormattedProfile: vi.fn(() => ''),
    getFormattedIdentity: vi.fn(() => '# Frankie\n\nYou are a personal AI assistant.'),
    getFormattedUserContext: vi.fn(() => ''),
  },
}));

vi.mock('../../src/memory', () => ({
  MemoryManager: vi.fn(),
}));

vi.mock('../../src/config/system-guidelines', () => ({
  SYSTEM_GUIDELINES: 'Test system guidelines',
  buildSystemGuidelines: () => 'Test system guidelines',
}));

vi.mock('../../src/agent/chat-providers', () => ({
  getStreamConfig: vi.fn(async () => ({
    provider: 'anthropic',
    apiKey: 'test-key',
  })),
  getProviderForModel: vi.fn((model: string) => {
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('kimi-')) return 'moonshot';
    return 'anthropic';
  }),
}));

vi.mock('../../src/agent/chat-tools', () => ({
  getChatAgentTools: vi.fn(() => []),
  getServerTools: vi.fn(() => []),
  getCoderAgentTools: vi.fn(() => []),
}));

vi.mock('fs/promises', () => ({
  default: { readFile: vi.fn(async () => 'mock plan content') },
}));

vi.mock('../../src/tools', () => ({
  setCurrentSessionId: vi.fn(),
  runWithSessionId: vi.fn((_id: string, fn: () => unknown) => fn()),
  getCurrentSessionId: vi.fn(() => 'test-session'),
}));

// Mutable flags so individual tests can override compaction behaviour
const ggcoderMocks = {
  shouldCompact: false as boolean,
  estimatedTokens: 100,
};

vi.mock('@kenkaiiii/ggcoder', () => ({
  buildSystemPrompt: vi.fn(() => ({ staticPrompt: '', dynamicPrompt: '' })),
  shouldCompact: vi.fn(() => ggcoderMocks.shouldCompact),
  estimateConversationTokens: vi.fn(() => ggcoderMocks.estimatedTokens),
  getCoderAgentTools: vi.fn(() => []),
}));

import { ChatEngine } from '../../src/agent/chat-engine';
import { SettingsManager } from '../../src/settings';
import { getStreamConfig } from '../../src/agent/chat-providers';
import { shouldCompact } from '@kenkaiiii/ggcoder';

// ── Helpers ────────────────────────────────────────────────────────────

function createEngine() {
  const memory = {
    setSummarizer: vi.fn(),
    getRecentMessages: vi.fn(() => []),
    getSessionMessageCount: vi.fn(() => 0),
    getFactsForContext: vi.fn(() => ''),
    getSoulContext: vi.fn(() => ''),
    getDailyLogsContext: vi.fn(() => ''),
    embedQuery: vi.fn(async () => null),
    retrieveRelevantFacts: vi.fn(() => ''),
    retrieveRelevantSoul: vi.fn(() => ''),
    retrieveRelevantRollups: vi.fn(() => ''),
    saveMessage: vi.fn(() => 1),
    getSmartContext: vi.fn(async () => ({ recentMessages: [], rollingSummary: null })),
    getSessionMode: vi.fn(() => 'general'),
    getSessionContext: vi.fn(() => ({ contextType: 'personal', clientId: null, projectKey: null })),
    getFactsMemoryUsage: vi.fn(() => ({ usedChars: 0, budgetChars: 50000, pct: 0 })),
    getSoulMemoryUsage: vi.fn(() => ({ usedChars: 0, budgetChars: 50000, pct: 0 })),
    getSessionModel: vi.fn(() => null),
  };

  const statusEmitter = vi.fn();

  const engine = new ChatEngine({
    memory: memory as never,
    toolsConfig: {} as never,
    statusEmitter,
  });

  return { engine, memory, statusEmitter };
}

function setDefaultAgentEvents(text = 'Hello') {
  mockAgentEvents = [
    makeTextDelta(text),
    makeTurnEnd(1, { inputTokens: 100, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
    makeAgentDone(1, { inputTokens: 100, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('ChatEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedAgentOptions = null;
    capturedAgentMessages = null;
    mockAgentEvents = [];
    mockAgentError = null;
    pendingGates = [];
    gateConsumerIndex = 0;

    // Reset default mock implementations
    vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
      if (key === 'agent.model') return 'claude-opus-4-8';
      if (key === 'agent.thinkingLevel') return 'normal';
      return undefined;
    });
    vi.mocked(getStreamConfig).mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'test-key',
    });
  });

  // ─── Public Interface ───────────────────────────────────────────────

  describe('Public interface', () => {
    it('exposes processMessage method', () => {
      const { engine } = createEngine();
      expect(typeof engine.processMessage).toBe('function');
    });

    it('exposes stopQuery method', () => {
      const { engine } = createEngine();
      expect(typeof engine.stopQuery).toBe('function');
    });

    it('exposes isQueryProcessing method', () => {
      const { engine } = createEngine();
      expect(typeof engine.isQueryProcessing).toBe('function');
    });

    it('exposes clearSession method', () => {
      const { engine } = createEngine();
      expect(typeof engine.clearSession).toBe('function');
    });

    it('exposes buildSystemPrompt method', () => {
      const { engine } = createEngine();
      expect(typeof engine.buildSystemPrompt).toBe('function');
    });

    it('exposes getDeveloperPrompt method', () => {
      const { engine } = createEngine();
      expect(typeof engine.getDeveloperPrompt).toBe('function');
    });
  });

  // ─── processMessage ─────────────────────────────────────────────────

  describe('processMessage', () => {
    it('returns ProcessResult with response and tokensUsed', async () => {
      setDefaultAgentEvents('Hello there');
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      expect(result.response).toBe('Hello there');
      expect(result.tokensUsed).toBe(150); // 100 input + 50 output
      expect(typeof result.wasCompacted).toBe('boolean');
    });

    it('passes system prompt to Agent', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      // System prompt is passed as the first message to agentLoop
      expect(capturedAgentMessages).not.toBeNull();
      const systemMsg = capturedAgentMessages!.find((m) => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(typeof systemMsg!.content).toBe('string');
      expect(systemMsg!.content as string).toContain('Test system guidelines');
    });

    it('passes model from settings to Agent', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.model).toBe('claude-opus-4-8');
    });

    it('a session with a model override uses it while another session simultaneously falls back to the global model', async () => {
      const overrideModel = 'claude-haiku-4-5-20251001';
      const globalModel = 'claude-opus-4-8'; // from the mocked SettingsManager.get('agent.model')

      const firstGate = createGate([
        makeTextDelta('override session response'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      const secondGate = createGate([
        makeTextDelta('global session response'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      pendingGates = [firstGate, secondGate];

      const { engine, memory } = createEngine();
      memory.getSessionModel.mockImplementation((sessionId: string) =>
        sessionId === 'session-override' ? overrideModel : null
      );

      // Poll microtasks until agentLoop has been called `count` times — that
      // only happens once model resolution (session override → global
      // fallback) has already run for that call.
      async function flushUntilGateCount(count: number, maxTicks = 50) {
        for (let i = 0; i < maxTicks && gateConsumerIndex < count; i++) {
          await Promise.resolve();
        }
      }

      // Session with an override starts first; capture the model it was
      // resolved with before the other session's call can overwrite the
      // shared capture variable.
      const promiseOverride = engine.processMessage('hi', 'desktop', 'session-override');
      await flushUntilGateCount(1);
      expect(gateConsumerIndex).toBe(1);
      const modelForOverrideSession = capturedAgentOptions!.model;

      // A second, concurrent session with no override starts while the first
      // is still mid-flight (blocked on its gate) and must independently
      // fall back to the global setting.
      const promiseGlobal = engine.processMessage('hi', 'desktop', 'session-global');
      await flushUntilGateCount(2);
      expect(gateConsumerIndex).toBe(2);
      const modelForGlobalSession = capturedAgentOptions!.model;

      expect(modelForOverrideSession).toBe(overrideModel);
      expect(modelForGlobalSession).toBe(globalModel);

      firstGate.release();
      secondGate.release();
      await promiseOverride;
      await promiseGlobal;
    });

    it('passes provider from getStreamConfig to Agent', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.provider).toBe('anthropic');
    });

    it('saves messages to memory after processing', async () => {
      setDefaultAgentEvents('Hello');
      const { engine, memory } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(memory.saveMessage).toHaveBeenCalledWith('user', 'hi', 'test-session', undefined);
      expect(memory.saveMessage).toHaveBeenCalledWith(
        'assistant',
        'Hello',
        'test-session',
        undefined
      );
    });
  });

  // ─── Thinking Level Mapping ─────────────────────────────────────────

  describe('Thinking level mapping', () => {
    it('maps "normal" thinking to "medium"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-8';
        if (key === 'agent.thinkingLevel') return 'normal';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBe('medium');
    });

    it('maps "extended" thinking to "high"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-8';
        if (key === 'agent.thinkingLevel') return 'extended';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBe('high');
    });

    it('maps "minimal" thinking to "low"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-8';
        if (key === 'agent.thinkingLevel') return 'minimal';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBe('low');
    });

    it('disables thinking when level is "none"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-8';
        if (key === 'agent.thinkingLevel') return 'none';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBeUndefined();
    });
  });

  // ─── Multi-Provider Support ─────────────────────────────────────────

  describe('Multi-provider support', () => {
    it('uses moonshot provider for kimi models', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'kimi-k2.6';
        if (key === 'agent.thinkingLevel') return 'normal';
        return undefined;
      });
      vi.mocked(getStreamConfig).mockResolvedValue({
        provider: 'moonshot',
        apiKey: 'moonshot-key',
        baseUrl: 'https://api.moonshot.cn/v1',
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.provider).toBe('moonshot');
      expect(capturedAgentOptions!.apiKey).toBe('moonshot-key');
      expect(capturedAgentOptions!.baseUrl).toBe('https://api.moonshot.cn/v1');
    });

    it('enables cache retention for anthropic provider', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.cacheRetention).toBe('short');
    });

    it('disables cache retention for non-anthropic providers', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'kimi-k2.6';
        if (key === 'agent.thinkingLevel') return 'normal';
        return undefined;
      });
      vi.mocked(getStreamConfig).mockResolvedValue({
        provider: 'moonshot',
        apiKey: 'moonshot-key',
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.cacheRetention).toBe('none');
    });
  });

  // ─── System Prompt Building ─────────────────────────────────────────

  describe('System prompt building', () => {
    it('builds system prompt with static and dynamic parts', async () => {
      const { engine } = createEngine();
      const { staticPrompt, dynamicPrompt } = await engine.buildSystemPrompt();

      expect(staticPrompt).toContain('Frankie');
      expect(staticPrompt).toContain('Test system guidelines');
      expect(typeof dynamicPrompt).toBe('string');
    });

    it('getDeveloperPrompt returns system guidelines', () => {
      const { engine } = createEngine();
      expect(engine.getDeveloperPrompt()).toBe('Test system guidelines');
    });

    it('includes identity in static prompt', async () => {
      const { engine } = createEngine();
      const { staticPrompt } = await engine.buildSystemPrompt();
      expect(staticPrompt).toContain('# Frankie');
    });

    it('includes temporal context in dynamic prompt', async () => {
      const { engine } = createEngine();
      const { dynamicPrompt } = await engine.buildSystemPrompt();
      expect(dynamicPrompt).toContain('Current Time');
    });

    // ── F1: daily_logs/soul carry no scope column, so they're only injected
    // for the personal context — shared (world/client/project) sessions never
    // see the operator's personal journal or self-knowledge. ───────────────
    describe('daily-logs/soul scoping (F1)', () => {
      it('injects soul and daily logs for a personal-context session', async () => {
        const { engine, memory } = createEngine();
        memory.getSessionContext.mockReturnValue({
          contextType: 'personal',
          clientId: null,
          projectKey: null,
        });
        memory.getSoulContext.mockReturnValue('## Soul\nSome soul content');
        memory.getDailyLogsContext.mockReturnValue('## Recent Daily Logs\nToday: did stuff');

        const { dynamicPrompt } = await engine.buildSystemPrompt('session-1');
        expect(dynamicPrompt).toContain('Some soul content');
        expect(dynamicPrompt).toContain('did stuff');
      });

      it('never injects soul or daily logs for a client (shared brand) session', async () => {
        const { engine, memory } = createEngine();
        memory.getSessionContext.mockReturnValue({
          contextType: 'client',
          clientId: 'brandA',
          projectKey: null,
        });
        memory.getSoulContext.mockReturnValue('## Soul\nSome soul content');
        memory.getDailyLogsContext.mockReturnValue('## Recent Daily Logs\nToday: did stuff');

        const { dynamicPrompt } = await engine.buildSystemPrompt('session-1');
        expect(dynamicPrompt).not.toContain('Some soul content');
        expect(dynamicPrompt).not.toContain('did stuff');
        expect(memory.getSoulContext).not.toHaveBeenCalled();
        expect(memory.getDailyLogsContext).not.toHaveBeenCalled();
      });

      it('never injects soul or daily logs for a world (agency-shared) session', async () => {
        const { engine, memory } = createEngine();
        memory.getSessionContext.mockReturnValue({
          contextType: 'world',
          clientId: null,
          projectKey: null,
        });
        memory.getSoulContext.mockReturnValue('## Soul\nSome soul content');
        memory.getDailyLogsContext.mockReturnValue('## Recent Daily Logs\nToday: did stuff');

        const { dynamicPrompt } = await engine.buildSystemPrompt('session-1');
        expect(dynamicPrompt).not.toContain('Some soul content');
        expect(dynamicPrompt).not.toContain('did stuff');
      });

      it('never injects soul or daily logs for a project session', async () => {
        const { engine, memory } = createEngine();
        memory.getSessionContext.mockReturnValue({
          contextType: 'project',
          clientId: 'brandA',
          projectKey: 'site-redesign',
        });
        memory.getSoulContext.mockReturnValue('## Soul\nSome soul content');
        memory.getDailyLogsContext.mockReturnValue('## Recent Daily Logs\nToday: did stuff');

        const { dynamicPrompt } = await engine.buildSystemPrompt('session-1');
        expect(dynamicPrompt).not.toContain('Some soul content');
        expect(dynamicPrompt).not.toContain('did stuff');
      });
    });

    // ── F3: no sessionId (e.g. the Customize preview) must default to the
    // safe personal (user+world) context, never an unscoped dump of every
    // client's shared facts. ────────────────────────────────────────
    describe('safe default context with no sessionId (F3)', () => {
      it('scopes the facts lookup to user+world when no sessionId is supplied', async () => {
        const { engine, memory } = createEngine();
        await engine.buildSystemPrompt();
        expect(memory.getFactsForContext).toHaveBeenCalledWith(['user', 'world']);
      });

      it('still injects soul/daily logs (personal default) when no sessionId is supplied', async () => {
        const { engine, memory } = createEngine();
        memory.getSoulContext.mockReturnValue('## Soul\nSome soul content');
        memory.getDailyLogsContext.mockReturnValue('## Recent Daily Logs\nToday: did stuff');

        const { dynamicPrompt } = await engine.buildSystemPrompt();
        expect(dynamicPrompt).toContain('Some soul content');
        expect(dynamicPrompt).toContain('did stuff');
      });

      it('never resolves session context (no sessionId to look up)', async () => {
        const { engine, memory } = createEngine();
        await engine.buildSystemPrompt();
        expect(memory.getSessionContext).not.toHaveBeenCalled();
      });
    });
  });

  // ─── Status Event Emission ──────────────────────────────────────────

  describe('Status event emission', () => {
    it('emits thinking status at start', async () => {
      setDefaultAgentEvents('Hi');
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const thinkingEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'thinking'
      );
      expect(thinkingEvent).toBeDefined();
    });

    it('emits partial_text for text deltas', async () => {
      mockAgentEvents = [
        makeTextDelta('Hello '),
        makeTextDelta('world'),
        makeTurnEnd(1, { inputTokens: 100, outputTokens: 50 }),
        makeAgentDone(1, { inputTokens: 100, outputTokens: 50 }),
      ];
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const textEvents = statusEmitter.mock.calls.filter(
        (args: unknown[]) => (args[0] as { type: string }).type === 'partial_text'
      );
      expect(textEvents.length).toBe(2);
      expect((textEvents[0][0] as { partialText: string }).partialText).toBe('Hello ');
      expect((textEvents[1][0] as { partialText: string }).partialText).toBe('world');
    });

    it('emits tool_start for tool_call_start events', async () => {
      mockAgentEvents = [
        { type: 'tool_call_start', name: 'web_fetch', args: { url: 'https://example.com' } },
        { type: 'tool_call_end', name: 'web_fetch' },
        makeTextDelta('Done'),
        makeTurnEnd(1, { inputTokens: 100, outputTokens: 50 }),
        makeAgentDone(1, { inputTokens: 100, outputTokens: 50 }),
      ];
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('fetch it', 'desktop', 'test-session');

      const toolStartEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'tool_start'
      );
      expect(toolStartEvent).toBeDefined();
      // formatToolName maps 'web_fetch' → 'fetching that page'
      expect((toolStartEvent![0] as { toolName: string }).toolName).toBe('fetching that page');
    });

    it('emits done status at end', async () => {
      setDefaultAgentEvents('Hi');
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const doneEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'done'
      );
      expect(doneEvent).toBeDefined();
    });

    it('keeps subagent_update/subagent_end paired to the correct tool call when an unrelated tool completes while two subagents are still in flight', async () => {
      // Two subagents are spawned (toolCallId 'call-sub-a' / 'call-sub-b').
      // An unrelated tool call then starts and finishes *before* either
      // subagent's own tool_call_end arrives — its end must not be mistaken
      // for a subagent finishing. Only when 'call-sub-a' itself ends should
      // the count drop to 1 (subagent_update); only when 'call-sub-b' itself
      // ends should it drop to 0 (subagent_end).
      mockAgentEvents = [
        {
          type: 'tool_call_start',
          toolCallId: 'call-sub-a',
          name: 'subagent',
          args: { agent: 'general', task: 'research A' },
        },
        {
          type: 'tool_call_start',
          toolCallId: 'call-sub-b',
          name: 'subagent',
          args: { agent: 'general', task: 'research B' },
        },
        {
          type: 'tool_call_start',
          toolCallId: 'call-other-1',
          name: 'web_fetch',
          args: { url: 'https://example.com' },
        },
        // Unrelated tool finishes first, while both subagents are still running.
        { type: 'tool_call_end', toolCallId: 'call-other-1', name: 'web_fetch' },
        // Then subagent A finishes.
        { type: 'tool_call_end', toolCallId: 'call-sub-a', name: 'subagent' },
        // Then subagent B finishes.
        { type: 'tool_call_end', toolCallId: 'call-sub-b', name: 'subagent' },
        makeTextDelta('Done'),
        makeTurnEnd(1, { inputTokens: 100, outputTokens: 50 }),
        makeAgentDone(1, { inputTokens: 100, outputTokens: 50 }),
      ];
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('go research', 'desktop', 'test-session');

      const statuses = statusEmitter.mock.calls.map(
        (args: unknown[]) => args[0] as { type: string; agentCount?: number }
      );

      // The unrelated tool's end, and each subagent's own end, must appear in
      // this exact order: the unrelated call ending first (as a plain
      // tool_end, leaving both subagents untouched), then subagent A's own
      // end (dropping the count 2 -> 1, a subagent_update), then subagent B's
      // own end (dropping the count 1 -> 0, a subagent_end). A FIFO-pop bug
      // would instead consume the unrelated tool's end as a subagent
      // completion, producing ['subagent_update', 'subagent_end', 'tool_end'].
      const relevantSequence = statuses
        .filter((s) => s.type === 'tool_end' || s.type === 'subagent_update' || s.type === 'subagent_end')
        .map((s) => s.type);
      expect(relevantSequence).toEqual(['tool_end', 'subagent_update', 'subagent_end']);

      const subagentUpdate = statuses.find((s) => s.type === 'subagent_update')!;
      expect(subagentUpdate.agentCount).toBe(1);

      const subagentEnd = statuses.find((s) => s.type === 'subagent_end')!;
      expect(subagentEnd.agentCount).toBe(0);
    });
  });

  // ─── Token Tracking ─────────────────────────────────────────────────

  describe('Token tracking', () => {
    it('returns tokensUsed from single turn', async () => {
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 300, outputTokens: 75, cacheRead: 0, cacheWrite: 0 }),
        makeAgentDone(1, { inputTokens: 300, outputTokens: 75 }),
      ];
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');
      expect(result.tokensUsed).toBe(375);
    });

    it('accumulates tokens across multiple turns', async () => {
      mockAgentEvents = [
        { type: 'tool_call_start', name: 'test_tool', args: {} },
        { type: 'tool_call_end', name: 'test_tool' },
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 30 }),
        makeTextDelta('Done'),
        makeTurnEnd(2, { inputTokens: 400, outputTokens: 60 }),
        makeAgentDone(2, { inputTokens: 600, outputTokens: 90 }),
      ];
      const { engine } = createEngine();

      const result = await engine.processMessage('use tool', 'desktop', 'test-session');

      // 200 + 30 + 400 + 60 = 690
      expect(result.tokensUsed).toBe(690);
    });

    it('tracks cache stats in contextTokens', async () => {
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 50, cacheRead: 400, cacheWrite: 50 }),
        makeAgentDone(1, { inputTokens: 200, outputTokens: 50, cacheRead: 400, cacheWrite: 50 }),
      ];
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      // contextTokens = inputTokens + cacheRead + cacheWrite = 200 + 400 + 50
      expect(result.contextTokens).toBe(650);
    });
  });

  // ─── Performance Logging ────────────────────────────────────────────

  describe('Performance logging', () => {
    it('logs session config at start', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const configLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('Session config')
      );
      expect(configLog).toBeDefined();
      expect(configLog![0]).toContain('claude-opus-4-8');
      expect(configLog![0]).toContain('anthropic');

      consoleSpy.mockRestore();
    });

    it('logs per-turn cache stats', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 500, outputTokens: 100, cacheRead: 400, cacheWrite: 50 }),
        makeAgentDone(1, { inputTokens: 500, outputTokens: 100, cacheRead: 400, cacheWrite: 50 }),
      ];
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const turnLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('Turn 1')
      );
      expect(turnLog).toBeDefined();
      expect(turnLog![0]).toContain('cache_read: 400');
      // cache_hit = 400 / (500 + 400 + 50) = 42%
      expect(turnLog![0]).toContain('cache_hit: 42%');

      consoleSpy.mockRestore();
    });

    it('logs completion summary', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
        makeAgentDone(1, { inputTokens: 200, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
      ];
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const summaryLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[ChatEngine] Done')
      );
      expect(summaryLog).toBeDefined();
      expect(summaryLog![0]).toContain('250 total tokens');

      consoleSpy.mockRestore();
    });
  });

  // ─── Session Management ─────────────────────────────────────────────

  describe('Session management', () => {
    it('isQueryProcessing returns false when idle', () => {
      const { engine } = createEngine();
      expect(engine.isQueryProcessing('test-session')).toBe(false);
    });

    it('clearSession removes conversation history', async () => {
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');
      engine.clearSession('test-session');

      // No error means success — session was cleared
      expect(engine.isQueryProcessing('test-session')).toBe(false);
    });

    it('stopQuery returns false when no query is processing', () => {
      const { engine } = createEngine();
      expect(engine.stopQuery('test-session')).toBe(false);
    });
  });

  // ─── Agent options ──────────────────────────────────────────────────

  describe('Agent options', () => {
    it('sets maxTurns to 20', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.maxTurns).toBe(20);
    });

    it('sets maxTokens to 16384', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.maxTokens).toBe(16384);
    });

    it('passes abort signal', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ─── compactConversation: empty-filter guard ───────────────────────

  describe('compactConversation empty-filter guard', () => {
    it('keeps original conversation when getSmartContext returns only tool-role messages', async () => {
      // Arrange: make shouldCompact return true so compaction is attempted
      ggcoderMocks.shouldCompact = true;
      ggcoderMocks.estimatedTokens = 999_999;

      const { engine, memory } = createEngine();

      // Pre-seed the session with some user/assistant messages by processing one round
      setDefaultAgentEvents('First reply');
      await engine.processMessage('first', 'desktop', 'compact-session');

      // Reset event sequence for the second message
      setDefaultAgentEvents('Second reply');

      // Mock getSmartContext to return only tool-role messages (no user/assistant)
      vi.mocked(memory.getSmartContext).mockResolvedValue({
        recentMessages: [
          { role: 'tool' as never, content: 'tool result 1' },
          { role: 'tool' as never, content: 'tool result 2' },
        ],
        rollingSummary: null,
      });

      // Act: process a second message, which will trigger compactConversation
      const consoleSpy = vi.spyOn(console, 'warn');
      await engine.processMessage('second', 'desktop', 'compact-session');

      // Assert: the warn was logged (fallback path was taken)
      const warnCall = consoleSpy.mock.calls.find(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].includes('smart context produced no user/assistant')
      );
      expect(warnCall).toBeDefined();

      consoleSpy.mockRestore();

      // Cleanup
      ggcoderMocks.shouldCompact = false;
      ggcoderMocks.estimatedTokens = 100;
    });
  });

  describe('Context window resolution', () => {
    it('returns the registry context window for deepseek-v4-pro', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'deepseek-v4-pro';
        if (key === 'agent.thinkingLevel') return 'none';
        if (key === 'deepseek.apiKey') return 'sk-test';
        return undefined;
      });
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      expect(result.contextWindow).toBe(1_048_576);
    });

    it('returns the registry context window for deepseek-v4-flash', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'deepseek-v4-flash';
        if (key === 'agent.thinkingLevel') return 'none';
        if (key === 'deepseek.apiKey') return 'sk-test';
        return undefined;
      });
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      expect(result.contextWindow).toBe(1_048_576);
    });

    it('returns 1_000_000 context window for claude-opus-4-8 (baseline check)', async () => {
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      expect(result.contextWindow).toBe(1_000_000);
    });
  });

  // ─── Concurrency: queue ordering ──────────────────────────────────────────────

  describe('Concurrency — queue ordering', () => {
    it('queues a second processMessage that arrives mid-flight and runs it after the first finishes', async () => {
      // Build two gated iterators, one per processMessage call.
      const firstGate = createGate([
        makeTextDelta('first reply'),
        makeTurnEnd(1, { inputTokens: 100, outputTokens: 50 }),
        makeAgentDone(1, { inputTokens: 100, outputTokens: 50 }),
      ]);
      const secondGate = createGate([
        makeTextDelta('second reply'),
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 60 }),
        makeAgentDone(1, { inputTokens: 200, outputTokens: 60 }),
      ]);
      pendingGates = [firstGate, secondGate];

      const { engine, statusEmitter } = createEngine();

      // Kick off the first message but don't await it — it should occupy the session.
      const firstPromise = engine.processMessage('first', 'desktop', 'queue-session');

      // Yield once so the engine reaches its first await and marks the session as processing.
      await Promise.resolve();
      await Promise.resolve();

      expect(engine.isQueryProcessing('queue-session')).toBe(true);

      // Second call should be queued, not executed immediately.
      const secondPromise = engine.processMessage('second', 'desktop', 'queue-session');

      // A 'queued' status must be emitted with queuePosition 1.
      const queuedEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'queued'
      );
      expect(queuedEvent).toBeDefined();
      expect((queuedEvent![0] as { queuePosition: number }).queuePosition).toBe(1);
      expect((queuedEvent![0] as { queuedMessage: string }).queuedMessage).toBe('second');

      // Release the first iteration so it can complete.
      firstGate.release();
      const firstResult = await firstPromise;
      expect(firstResult.response).toBe('first reply');

      // After the first finishes, processQueue should pick up the second.
      // Yield twice so the queued setTimeout(0) runs and starts execution.
      await new Promise((r) => setTimeout(r, 0));
      await Promise.resolve();
      await Promise.resolve();

      // A 'queue_processing' status should fire for the dequeued message.
      const queueProcessingEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'queue_processing'
      );
      expect(queueProcessingEvent).toBeDefined();
      expect((queueProcessingEvent![0] as { queuedMessage: string }).queuedMessage).toBe('second');

      // Now release the second gate and wait for it to finish.
      secondGate.release();
      const secondResult = await secondPromise;
      expect(secondResult.response).toBe('second reply');
    });

    it('preserves FIFO order for multiple queued messages', async () => {
      const firstGate = createGate([
        makeTextDelta('reply-1'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      const secondGate = createGate([
        makeTextDelta('reply-2'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      const thirdGate = createGate([
        makeTextDelta('reply-3'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      pendingGates = [firstGate, secondGate, thirdGate];

      const { engine, statusEmitter } = createEngine();

      const p1 = engine.processMessage('msg-1', 'desktop', 'fifo-session');
      await Promise.resolve();
      await Promise.resolve();

      const p2 = engine.processMessage('msg-2', 'desktop', 'fifo-session');
      const p3 = engine.processMessage('msg-3', 'desktop', 'fifo-session');

      // Two 'queued' events expected, with positions 1 then 2.
      const queuedEvents = statusEmitter.mock.calls
        .filter((args: unknown[]) => (args[0] as { type: string }).type === 'queued')
        .map((args: unknown[]) => args[0] as { queuePosition: number; queuedMessage: string });
      expect(queuedEvents.length).toBe(2);
      expect(queuedEvents[0].queuePosition).toBe(1);
      expect(queuedEvents[0].queuedMessage).toBe('msg-2');
      expect(queuedEvents[1].queuePosition).toBe(2);
      expect(queuedEvents[1].queuedMessage).toBe('msg-3');

      // Release in order, asserting each completes in turn.
      firstGate.release();
      const r1 = await p1;
      expect(r1.response).toBe('reply-1');

      await new Promise((r) => setTimeout(r, 0));
      secondGate.release();
      const r2 = await p2;
      expect(r2.response).toBe('reply-2');

      await new Promise((r) => setTimeout(r, 0));
      thirdGate.release();
      const r3 = await p3;
      expect(r3.response).toBe('reply-3');
    });
  });

  // ─── Concurrency: stopQuery clears queued work ─────────────────────────────

  describe('Concurrency — stopQuery clears queued work', () => {
    it('rejects all pending queued messages with "Queue cleared" and aborts the in-flight request', async () => {
      const firstGate = createGate([
        makeTextDelta('inflight'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      // No second gate is needed — the queued message must never start executing.
      pendingGates = [firstGate];

      const { engine } = createEngine();

      // Start an in-flight request.
      const inflight = engine.processMessage('first', 'desktop', 'stop-session');
      await Promise.resolve();
      await Promise.resolve();
      expect(engine.isQueryProcessing('stop-session')).toBe(true);

      // Queue two more.
      const queued1 = engine.processMessage('queued-1', 'desktop', 'stop-session');
      const queued2 = engine.processMessage('queued-2', 'desktop', 'stop-session');

      // Attach catchers so unhandled rejections don't blow up the test runner.
      const queued1Err = queued1.catch((e: Error) => e);
      const queued2Err = queued2.catch((e: Error) => e);

      // Stop the session — should reject queued items and abort the in-flight one.
      const stopped = engine.stopQuery('stop-session');
      expect(stopped).toBe(true);

      const e1 = await queued1Err;
      const e2 = await queued2Err;
      expect(e1).toBeInstanceOf(Error);
      expect(e1.message).toBe('Queue cleared');
      expect(e2).toBeInstanceOf(Error);
      expect(e2.message).toBe('Queue cleared');

      // The abort signal passed to agentLoop should be aborted.
      const signal = capturedAgentOptions!.signal as AbortSignal;
      expect(signal.aborted).toBe(true);

      // Release the gate so the in-flight call can wind down. The mocked
      // agentLoop does not honor the abort signal, so the call resolves with
      // its events — we just need it to settle so the engine cleans up.
      firstGate.release();
      const result = await inflight;
      expect(typeof result.response).toBe('string');

      // After everything settles, the session should be idle again.
      expect(engine.isQueryProcessing('stop-session')).toBe(false);
    });

    it('stopQuery returns false (and does nothing) when only queued items exist with no active processing', async () => {
      // Build an engine that will never have an in-flight request because we
      // never trigger one. Calling stopQuery on a sessionId with no queue and
      // no processor must return false.
      const { engine } = createEngine();
      expect(engine.stopQuery('idle-session')).toBe(false);
    });

    it('does not start a queued message after stopQuery clears the queue', async () => {
      const firstGate = createGate([
        makeTextDelta('done'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      // Provide a second gate — if the queue were not cleared, the engine would
      // start consuming it and the test would observe a second agentLoop call.
      const secondGate = createGate([
        makeTextDelta('should-not-run'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      pendingGates = [firstGate, secondGate];

      const { engine } = createEngine();

      const inflight = engine.processMessage('first', 'desktop', 'no-restart-session');
      await Promise.resolve();
      await Promise.resolve();

      const queued = engine.processMessage('queued', 'desktop', 'no-restart-session');
      const queuedErr = queued.catch((e: Error) => e);

      // Stop — clears the queue and aborts in-flight.
      engine.stopQuery('no-restart-session');

      const err = await queuedErr;
      expect((err as Error).message).toBe('Queue cleared');

      // Let the in-flight call wind down.
      firstGate.release();
      await inflight;

      // Drain any setTimeout(0) the engine schedules in finally{}.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      // Only the first gate should have been consumed — gateConsumerIndex tracks
      // how many agentLoop calls actually ran.
      expect(gateConsumerIndex).toBe(1);
    });
  });

  // ─── Heartbeat suppression for cron: channels ───────────────────────────

  describe('Heartbeat suppression for cron channels', () => {
    it('skips memory persistence when a cron: response is HEARTBEAT_OK', async () => {
      mockAgentEvents = [
        makeTextDelta('HEARTBEAT_OK'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      const result = await engine.processMessage(
        'check the inbox',
        'cron:hourly-inbox-check',
        'cron-session'
      );

      expect(result.response).toBe('HEARTBEAT_OK');
      // saveToMemory must short-circuit — no user/assistant messages persisted.
      expect(memory.saveMessage).not.toHaveBeenCalled();
    });

    it('skips memory persistence when a cron: response is bold-wrapped HEARTBEAT_OK', async () => {
      mockAgentEvents = [
        makeTextDelta('**HEARTBEAT_OK**'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      await engine.processMessage('routine', 'cron:nightly-routine', 'cron-session');

      expect(memory.saveMessage).not.toHaveBeenCalled();
    });

    it('persists messages with scheduler metadata for cron: when response is non-heartbeat', async () => {
      mockAgentEvents = [
        makeTextDelta('Three new emails arrived overnight.'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      await engine.processMessage('check the inbox', 'cron:hourly-inbox-check', 'cron-session');

      // Both user and assistant messages should be saved with source: scheduler.
      const userCall = memory.saveMessage.mock.calls.find((args: unknown[]) => args[0] === 'user');
      const assistantCall = memory.saveMessage.mock.calls.find(
        (args: unknown[]) => args[0] === 'assistant'
      );
      expect(userCall).toBeDefined();
      expect(assistantCall).toBeDefined();
      expect((userCall![3] as { source: string }).source).toBe('scheduler');
      expect((userCall![3] as { jobName: string }).jobName).toBe('hourly-inbox-check');
      expect((assistantCall![3] as { source: string }).source).toBe('scheduler');
    });

    it('does NOT suppress HEARTBEAT_OK on non-cron channels (still persists)', async () => {
      mockAgentEvents = [
        makeTextDelta('HEARTBEAT_OK'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      await engine.processMessage('hi', 'desktop', 'desktop-session');

      // saveToMemory only short-circuits when channel.startsWith('cron:').
      expect(memory.saveMessage).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('a non-abort agentLoop failure persists a user+error message pair and rethrows', async () => {
      mockAgentEvents = [];
      mockAgentError = new Error('upstream provider exploded');
      const { engine, memory } = createEngine();

      await expect(engine.processMessage('do the thing', 'desktop', 'S')).rejects.toThrow(
        'upstream provider exploded'
      );

      const userCall = memory.saveMessage.mock.calls.find((args: unknown[]) => args[0] === 'user');
      const assistantCall = memory.saveMessage.mock.calls.find(
        (args: unknown[]) => args[0] === 'assistant'
      );
      expect(userCall).toBeDefined();
      expect(userCall![1]).toBe('do the thing');
      expect(assistantCall).toBeDefined();
      expect(assistantCall![1]).toBe('upstream provider exploded');
      expect((assistantCall![3] as { isError: boolean }).isError).toBe(true);
    });

    it('an abort/interrupt error returns an empty result, emits done, and saves NOTHING (no error bubble)', async () => {
      mockAgentEvents = [];
      mockAgentError = new Error('Request aborted by user');
      const { engine, memory, statusEmitter } = createEngine();

      const result = await engine.processMessage('do the thing', 'desktop', 'S');

      expect(result).toEqual({ response: '', tokensUsed: 0, wasCompacted: false });
      expect(memory.saveMessage).not.toHaveBeenCalled();
      expect(statusEmitter).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'done', sessionId: 'S' })
      );
    });

    it('an "interrupted" error message is treated the same as "aborted" (no error bubble)', async () => {
      mockAgentEvents = [];
      mockAgentError = new Error('stream interrupted mid-turn');
      const { engine, memory } = createEngine();

      const result = await engine.processMessage('do the thing', 'desktop', 'S');

      expect(result.response).toBe('');
      expect(memory.saveMessage).not.toHaveBeenCalled();
    });

    it('a failure still clears the in-flight processing/abort-controller bookkeeping (session usable again)', async () => {
      mockAgentEvents = [];
      mockAgentError = new Error('boom');
      const { engine } = createEngine();

      await expect(engine.processMessage('first', 'desktop', 'S')).rejects.toThrow();
      expect(engine.isQueryProcessing('S')).toBe(false);

      // A follow-up call on the same session must not be permanently wedged by the prior failure.
      setDefaultAgentEvents('recovered');
      const result = await engine.processMessage('second', 'desktop', 'S');
      expect(result.response).toBe('recovered');
    });
  });

  describe('Tool-call coordination (toolsUsed metadata)', () => {
    it('accumulates deduped tool names from tool_call_start + server_tool_call events into cron metadata', async () => {
      mockAgentEvents = [
        { type: 'tool_call_start', name: 'web_fetch', args: { url: 'https://example.com' } },
        { type: 'tool_call_end', name: 'web_fetch' },
        // Same tool invoked twice in one turn — must dedupe, not double-report.
        { type: 'tool_call_start', name: 'web_fetch', args: { url: 'https://example.com/2' } },
        { type: 'tool_call_end', name: 'web_fetch' },
        { type: 'server_tool_call', name: 'web_search' },
        makeTextDelta('Done checking the feed.'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      await engine.processMessage('check the feed', 'cron:feed-check', 'cron-session');

      const assistantCall = memory.saveMessage.mock.calls.find(
        (args: unknown[]) => args[0] === 'assistant'
      );
      expect(assistantCall).toBeDefined();
      const metadata = assistantCall![3] as { toolsUsed: string[] };
      expect(metadata.toolsUsed.sort()).toEqual(['web_fetch', 'web_search']);
    });

    it('non-cron channels never attach toolsUsed metadata (only scheduler runs need the evidence trail)', async () => {
      mockAgentEvents = [
        { type: 'tool_call_start', name: 'web_fetch', args: {} },
        { type: 'tool_call_end', name: 'web_fetch' },
        makeTextDelta('done'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      await engine.processMessage('do it', 'desktop', 'desktop-session');

      const assistantCall = memory.saveMessage.mock.calls.find(
        (args: unknown[]) => args[0] === 'assistant'
      );
      expect(assistantCall![3]).toBeUndefined();
    });

    it('a turn with no tool calls never attaches an empty toolsUsed array', async () => {
      mockAgentEvents = [
        makeTextDelta('no tools needed'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      await engine.processMessage('check the feed', 'cron:feed-check', 'cron-session');

      const assistantCall = memory.saveMessage.mock.calls.find(
        (args: unknown[]) => args[0] === 'assistant'
      );
      const metadata = assistantCall![3] as { toolsUsed?: string[] } | undefined;
      expect(metadata?.toolsUsed).toBeUndefined();
    });
  });

  describe('Multi-turn context assembly', () => {
    it('a second processMessage call on the same session sends the accumulated conversation to agentLoop', async () => {
      const { engine } = createEngine();

      setDefaultAgentEvents('First reply');
      await engine.processMessage('First message', 'desktop', 'S');
      // Turn 1: agentLoop sees the leading system message + the fresh user turn.
      expect(capturedAgentMessages).toHaveLength(2);
      expect(capturedAgentMessages!.map((m) => m.role)).toEqual(['system', 'user']);

      setDefaultAgentEvents('Second reply');
      await engine.processMessage('Second message', 'desktop', 'S');

      // Turn 2's agentLoop call must additionally see turn 1's user+assistant
      // messages PLUS the new user turn — real multi-turn context, not a
      // fresh slate each call.
      expect(capturedAgentMessages).toHaveLength(4);
      const roles = capturedAgentMessages!.map((m) => m.role);
      expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    });

    it('two different sessions never share conversation context', async () => {
      const { engine } = createEngine();

      setDefaultAgentEvents('reply A');
      await engine.processMessage('hello from A', 'desktop', 'session-A');

      setDefaultAgentEvents('reply B');
      await engine.processMessage('hello from B', 'desktop', 'session-B');

      // session-B's first turn must be a fresh conversation (system + its own
      // user turn only), not session-A's leftovers.
      expect(capturedAgentMessages).toHaveLength(2);
      const userMsg = capturedAgentMessages!.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('hello from B');
    });
  });

  // ─── Plan mode (propose — see docs/plan-approval.md) ────────────────
  //
  // The approve/reject/execute legs of the flow live in PlanApprovals
  // (tests/unit/plan-approval.test.ts) and the plan:* IPC handlers
  // (tests/unit/agent-ipc-plan.test.ts). These tests cover the missing link
  // between them: ChatEngine wiring gg-coder's `exit_plan`/`enter_plan`
  // tools (via onExitPlan/onEnterPlan hooks passed into getCoderAgentTools)
  // so a plan produced by the agent actually reaches `planPending` instead
  // of vanishing as dead code.
  describe('Plan mode (exit_plan wiring)', () => {
    function createCoderEngine() {
      const memory = {
        setSummarizer: vi.fn(),
        getRecentMessages: vi.fn(() => []),
        getSessionMessageCount: vi.fn(() => 0),
        getFactsForContext: vi.fn(() => ''),
        getSoulContext: vi.fn(() => ''),
        getDailyLogsContext: vi.fn(() => ''),
        embedQuery: vi.fn(async () => null),
        retrieveRelevantFacts: vi.fn(() => ''),
        retrieveRelevantSoul: vi.fn(() => ''),
        retrieveRelevantRollups: vi.fn(() => ''),
        saveMessage: vi.fn(() => 1),
        getSmartContext: vi.fn(async () => ({ recentMessages: [], rollingSummary: null })),
        getSessionMode: vi.fn(() => 'coder'),
        getSessionContext: vi.fn(() => ({ contextType: 'personal', clientId: null, projectKey: null })),
        getFactsMemoryUsage: vi.fn(() => ({ usedChars: 0, budgetChars: 50000, pct: 0 })),
        getSoulMemoryUsage: vi.fn(() => ({ usedChars: 0, budgetChars: 50000, pct: 0 })),
        getSessionWorkingDirectory: vi.fn(() => '/tmp/workspace/sessions/preset'),
        setSessionWorkingDirectory: vi.fn(),
        getSessionModel: vi.fn(() => null),
      };
      const statusEmitter = vi.fn();
      const engine = new ChatEngine({
        memory: memory as never,
        toolsConfig: {} as never,
        statusEmitter,
        workspace: '/tmp/workspace',
      } as never);
      return { engine, memory, statusEmitter };
    }

    it('surfaces an exit_plan submission as planPending with the plan file content as the response', async () => {
      const { getCoderAgentTools } = await import('../../src/agent/chat-tools');
      // Real gg-coder invokes onExitPlan from inside the exit_plan tool's
      // execute() while the agent loop is running. agentLoop itself is
      // mocked here, so we simulate that call at the point the tool set is
      // built (which happens before the loop starts either way) — the
      // ordering doesn't matter for what we're verifying: that the hook's
      // resolved plan content ends up as `planPending`/`response`.
      vi.mocked(getCoderAgentTools).mockImplementation(async (...args: unknown[]) => {
        const planHooks = args[4] as { onExitPlan: (planPath: string) => Promise<string> };
        await planHooks.onExitPlan('/tmp/workspace/.gg/plans/build-the-thing.md');
        return [];
      });

      const { engine, statusEmitter } = createCoderEngine();
      mockAgentEvents = [
        makeTextDelta("I've submitted the plan for your review."),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];

      const result = await engine.processMessage('build the thing', 'desktop', 'S-coder');

      expect(result.planPending).toBe(true);
      expect(result.response).toBe('mock plan content');
      expect(statusEmitter).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'plan_mode_exited', sessionId: 'S-coder' })
      );
    });

    it('emits plan_mode_entered when the agent calls enter_plan', async () => {
      const { getCoderAgentTools } = await import('../../src/agent/chat-tools');
      vi.mocked(getCoderAgentTools).mockImplementation(async (...args: unknown[]) => {
        const planHooks = args[4] as { onEnterPlan: (reason?: string) => void | Promise<void> };
        await planHooks.onEnterPlan('complex multi-file change');
        return [];
      });

      const { engine, statusEmitter } = createCoderEngine();
      setDefaultAgentEvents('researching first...');

      const result = await engine.processMessage('do something risky', 'desktop', 'S-coder-2');

      expect(result.planPending).toBeFalsy();
      expect(statusEmitter).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'plan_mode_entered',
          sessionId: 'S-coder-2',
          message: 'complex multi-file change',
        })
      );
    });

    it('does not set planPending when exit_plan fails to read the plan file', async () => {
      const { getCoderAgentTools } = await import('../../src/agent/chat-tools');
      const fsPromises = await import('fs/promises');
      vi.mocked(fsPromises.default.readFile).mockRejectedValueOnce(new Error('ENOENT'));
      let toolResult = '';
      vi.mocked(getCoderAgentTools).mockImplementation(async (...args: unknown[]) => {
        const planHooks = args[4] as { onExitPlan: (planPath: string) => Promise<string> };
        toolResult = await planHooks.onExitPlan('/tmp/workspace/.gg/plans/missing.md');
        return [];
      });

      const { engine } = createCoderEngine();
      setDefaultAgentEvents('never mind');

      const result = await engine.processMessage('build the thing', 'desktop', 'S-coder-3');

      expect(toolResult).toMatch(/Error: could not read plan file/);
      expect(result.planPending).toBeFalsy();
    });
  });

  describe('Coder cwd assignment & collision warning', () => {
    function createCoderCwdEngine(overrides: {
      getSessionWorkingDirectory: (sessionId: string) => string | null;
      workspace?: string;
    }) {
      const setSessionWorkingDirectory = vi.fn();
      const memory = {
        setSummarizer: vi.fn(),
        getRecentMessages: vi.fn(() => []),
        getSessionMessageCount: vi.fn(() => 0),
        getFactsForContext: vi.fn(() => ''),
        getSoulContext: vi.fn(() => ''),
        getDailyLogsContext: vi.fn(() => ''),
        embedQuery: vi.fn(async () => null),
        retrieveRelevantFacts: vi.fn(() => ''),
        retrieveRelevantSoul: vi.fn(() => ''),
        retrieveRelevantRollups: vi.fn(() => ''),
        saveMessage: vi.fn(() => 1),
        getSmartContext: vi.fn(async () => ({ recentMessages: [], rollingSummary: null })),
        getSessionMode: vi.fn(() => 'coder'),
        getSessionContext: vi.fn(() => ({ contextType: 'personal', clientId: null, projectKey: null })),
        getFactsMemoryUsage: vi.fn(() => ({ usedChars: 0, budgetChars: 50000, pct: 0 })),
        getSoulMemoryUsage: vi.fn(() => ({ usedChars: 0, budgetChars: 50000, pct: 0 })),
        getSessionWorkingDirectory: vi.fn(overrides.getSessionWorkingDirectory),
        setSessionWorkingDirectory,
        getSessionModel: vi.fn(() => null),
      };
      const statusEmitter = vi.fn();
      const engine = new ChatEngine({
        memory: memory as never,
        toolsConfig: {} as never,
        statusEmitter,
        workspace: overrides.workspace ?? '/tmp/ws',
      } as never);
      return { engine, memory, statusEmitter, setSessionWorkingDirectory };
    }

    it('defaults to and persists a per-session subdirectory when no working directory is set', async () => {
      const { engine, setSessionWorkingDirectory, statusEmitter } = createCoderCwdEngine({
        getSessionWorkingDirectory: () => null,
        workspace: '/tmp/ws',
      });
      setDefaultAgentEvents('sure, on it');

      await engine.processMessage('do something', 'desktop', 'coder-default');

      expect(setSessionWorkingDirectory).toHaveBeenCalledWith(
        'coder-default',
        path.join('/tmp/ws', 'sessions', 'coder-default')
      );
      // A single active coder session must never trigger a collision warning.
      expect(
        statusEmitter.mock.calls.some(
          (args: unknown[]) => (args[0] as { type: string }).type === 'cwd_collision'
        )
      ).toBe(false);
    });

    it('honors an explicit working directory and does not overwrite it', async () => {
      const { engine, setSessionWorkingDirectory } = createCoderCwdEngine({
        getSessionWorkingDirectory: () => '/tmp/ws/custom-project',
      });
      setDefaultAgentEvents('sure, on it');

      await engine.processMessage('do something', 'desktop', 'coder-explicit');

      expect(setSessionWorkingDirectory).not.toHaveBeenCalled();
    });

    it('warns the incoming session when another active coder session already owns its working directory', async () => {
      const firstGate = createGate([
        makeTextDelta('working on A'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      const secondGate = createGate([
        makeTextDelta('working on B'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      pendingGates = [firstGate, secondGate];

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { engine, statusEmitter } = createCoderCwdEngine({
        getSessionWorkingDirectory: () => '/tmp/ws/shared-project',
      });

      // Poll microtasks until agentLoop has actually been called `count`
      // times — that only happens once getCoderCwd (and everything before
      // it) has already run for that call, so this deterministically orders
      // "A reached its gate" before "B starts", instead of guessing how many
      // microtask ticks the awaits before getCoderCwd need.
      async function flushUntilGateCount(count: number, maxTicks = 50) {
        for (let i = 0; i < maxTicks && gateConsumerIndex < count; i++) {
          await Promise.resolve();
        }
      }

      // Session A starts and occupies the shared directory; don't await —
      // it should still be mid-flight (blocked on its own gate) when B starts.
      const promiseA = engine.processMessage('do work as A', 'desktop', 'coder-A');
      await flushUntilGateCount(1);
      expect(gateConsumerIndex).toBe(1);
      expect(engine.isQueryProcessing('coder-A')).toBe(true);

      // Session B starts concurrently, pointed at the same directory. By the
      // time its agentLoop call is made, its getCoderCwd has already run and
      // must have seen session A as active.
      const promiseB = engine.processMessage('do work as B', 'desktop', 'coder-B');
      await flushUntilGateCount(2);
      expect(gateConsumerIndex).toBe(2);

      const collisionEvents = statusEmitter.mock.calls.filter(
        (args: unknown[]) => (args[0] as { type: string }).type === 'cwd_collision'
      );
      // Exactly one warning per turn — the coder cwd is resolved once and
      // reused for both the system prompt and the tool config, so the
      // collision check must not fire twice for the same message.
      expect(collisionEvents).toHaveLength(1);
      const collisionEvent = collisionEvents[0];
      expect((collisionEvent[0] as { sessionId: string }).sessionId).toBe('coder-B');
      expect((collisionEvent[0] as { conflictSessionId: string }).conflictSessionId).toBe(
        'coder-A'
      );
      const cwdCollisionWarnCalls = warnSpy.mock.calls.filter((args) =>
        String(args[0]).includes('cwd collision')
      );
      expect(cwdCollisionWarnCalls).toHaveLength(1);

      firstGate.release();
      secondGate.release();
      await promiseA;
      await promiseB;

      warnSpy.mockRestore();
    });
  });
});
