/**
 * Session-scoped calendar events, tasks, and cron jobs — plus (STAGE A #3)
 * real behavioral replacements for what used to be a "Source Code
 * Verification" block that grepped source text for import statements, SQL
 * fragments, and type-field names. Grepping source proves the code was
 * TYPED a certain way at the time the test was written; it proves nothing
 * about runtime behavior and silently stops meaning anything the moment the
 * implementation is refactored to an equivalent form (e.g. session_id moved
 * to a different parameter position, or the same behavior expressed without
 * that literal substring). Every block below that COULD be turned into a
 * real behavioral assertion has been; the ones that couldn't are removed,
 * documented in the final describe block instead of silently deleted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setCurrentSessionId, getCurrentSessionId, runWithSessionId } from '../../src/tools/session-context';

describe('Session Context', () => {
  beforeEach(() => {
    // Reset to default session before each test
    setCurrentSessionId('default');
  });

  it('should default to "default" session', () => {
    setCurrentSessionId('default'); // Reset first
    expect(getCurrentSessionId()).toBe('default');
  });

  it('should set and get session ID via fallback', () => {
    setCurrentSessionId('work');
    expect(getCurrentSessionId()).toBe('work');

    setCurrentSessionId('personal');
    expect(getCurrentSessionId()).toBe('personal');
  });

  it('should persist session ID across calls', () => {
    setCurrentSessionId('test-session-123');
    expect(getCurrentSessionId()).toBe('test-session-123');
    expect(getCurrentSessionId()).toBe('test-session-123');
  });
});

describe('AsyncLocalStorage Session Isolation', () => {
  beforeEach(() => {
    setCurrentSessionId('default');
  });

  it('should isolate session ID within runWithSessionId', () => {
    runWithSessionId('isolated-session', () => {
      expect(getCurrentSessionId()).toBe('isolated-session');
    });

    // Outside, falls back to the fallback value
    expect(getCurrentSessionId()).toBe('default');
  });

  it('should support nested runWithSessionId with different IDs', () => {
    runWithSessionId('outer', () => {
      expect(getCurrentSessionId()).toBe('outer');

      runWithSessionId('inner', () => {
        expect(getCurrentSessionId()).toBe('inner');
      });

      // Back to outer after inner completes
      expect(getCurrentSessionId()).toBe('outer');
    });
  });

  it('should isolate concurrent async contexts', async () => {
    const results: string[] = [];

    const task1 = runWithSessionId('session-A', async () => {
      results.push(`task1-start: ${getCurrentSessionId()}`);
      await new Promise(resolve => setTimeout(resolve, 10));
      results.push(`task1-end: ${getCurrentSessionId()}`);
    });

    const task2 = runWithSessionId('session-B', async () => {
      results.push(`task2-start: ${getCurrentSessionId()}`);
      await new Promise(resolve => setTimeout(resolve, 5));
      results.push(`task2-end: ${getCurrentSessionId()}`);
    });

    await Promise.all([task1, task2]);

    expect(results).toContain('task1-start: session-A');
    expect(results).toContain('task1-end: session-A');
    expect(results).toContain('task2-start: session-B');
    expect(results).toContain('task2-end: session-B');
  });

  it('should return the value from the wrapped function', () => {
    const result = runWithSessionId('test', () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('should return a promise from an async wrapped function', async () => {
    const result = await runWithSessionId('test', async () => {
      return 'async-result';
    });
    expect(result).toBe('async-result');
  });
});

describe('Session Context Integration', () => {
  it('should maintain session context across tool calls', () => {
    // Simulate agent setting session before processing
    setCurrentSessionId('session-abc');

    // First tool call should see the session
    expect(getCurrentSessionId()).toBe('session-abc');

    // Second tool call should still see the same session
    expect(getCurrentSessionId()).toBe('session-abc');

    // After processing a different session
    setCurrentSessionId('session-xyz');
    expect(getCurrentSessionId()).toBe('session-xyz');
  });

  it('should handle session changes between messages', () => {
    // Message 1 in work session
    setCurrentSessionId('work');
    expect(getCurrentSessionId()).toBe('work');

    // Message 2 in personal session
    setCurrentSessionId('personal');
    expect(getCurrentSessionId()).toBe('personal');

    // Message 3 back to default
    setCurrentSessionId('default');
    expect(getCurrentSessionId()).toBe('default');
  });
});

// ─── tools/index.ts really exports a working session-context surface ───────
// (was: grep tools/index.ts source for the string 'runWithSessionId'.)
describe('tools/index.ts session-context re-export — functional, not textual', () => {
  it('re-exports getCurrentSessionId/setCurrentSessionId/runWithSessionId as the SAME working functions', async () => {
    const tools = await import('../../src/tools');
    tools.setCurrentSessionId('from-tools-barrel');
    expect(tools.getCurrentSessionId()).toBe('from-tools-barrel');

    const result = tools.runWithSessionId('nested-from-barrel', () => tools.getCurrentSessionId());
    expect(result).toBe('nested-from-barrel');
    // Isolated back out afterward, proving it's the real AsyncLocalStorage-backed
    // implementation and not an accidental stub re-export.
    expect(tools.getCurrentSessionId()).toBe('from-tools-barrel');
  });
});

// ─── cron jobs actually persist and distinguish session_id per job ─────────
// (was: grep scheduler-tools.ts source for the string 'session_id' near
// INSERT/UPDATE; grep scheduler/index.ts for a SELECT mentioning session_id.)
// Same mocking pattern as scheduler-tools.test.ts (mocked better-sqlite3 +
// mocked session-context) — but instead of asserting the SQL text contains
// a substring, this captures the actual bound parameters passed to run()
// and proves two jobs created under two different sessions are persisted
// with two DIFFERENT session_id values, not a shared/blank one.
describe('scheduler-tools: session_id actually flows into persisted cron jobs', () => {
  afterEach(() => {
    // Guaranteed even if an assertion above throws — a leaked mock here would
    // silently break every other test file that imports these modules.
    vi.doUnmock('../../src/tools/session-context');
    vi.doUnmock('better-sqlite3');
    vi.doUnmock('fs');
    vi.doUnmock('../../src/scheduler');
    vi.resetModules();
  });

  it("create_routine and create_reminder bind the CURRENT session's id, and different sessions get different values", async () => {
    vi.resetModules();
    let currentSession = 'session-A';

    vi.doMock('../../src/tools/session-context', () => ({
      getCurrentSessionId: () => currentSession,
      setCurrentSessionId: vi.fn(),
      runWithSessionId: (id: string, fn: () => unknown) => fn(),
    }));

    const runCalls: unknown[][] = [];
    const mockRun = vi.fn((...args: unknown[]) => {
      runCalls.push(args);
      return { lastInsertRowid: runCalls.length, changes: 1 };
    });
    const mockGet = vi.fn(() => undefined); // "existing job" lookup — always treat as new
    const mockPrepare = vi.fn(() => ({ run: mockRun, get: mockGet, all: vi.fn(() => []) }));
    const mockDb = {
      prepare: mockPrepare,
      exec: vi.fn(),
      pragma: vi.fn(),
      close: vi.fn(),
    };
    // A real constructor function (not an arrow fn) so `new Database(dbPath)`
    // works — a constructor that explicitly returns an object overrides `this`.
    vi.doMock('better-sqlite3', () => ({
      default: vi.fn(function MockDatabase() {
        return mockDb;
      }),
    }));
    vi.doMock('fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('fs')>();
      return { ...actual, default: { ...actual, existsSync: () => true }, existsSync: () => true };
    });
    vi.doMock('../../src/scheduler', () => ({ getScheduler: vi.fn() }));

    const { handleCreateRoutineTool, handleCreateReminderTool } = await import(
      '../../src/tools/scheduler-tools'
    );

    currentSession = 'session-A';
    await handleCreateRoutineTool({ name: 'routineA', schedule: 'every 30m', prompt: 'do a thing' });

    currentSession = 'session-B';
    await handleCreateReminderTool({ name: 'reminderB', schedule: '30m', reminder: 'take a break' });

    // Two INSERT/UPDATE (upsert) calls, one per job — the sessionId param
    // (upsertCronJob's `params.sessionId` binding) differs between them.
    expect(runCalls.length).toBe(2);
    const sessionIdsUsed = runCalls.map((args) =>
      args.find((a) => typeof a === 'string' && a.startsWith('session-'))
    );
    expect(sessionIdsUsed).toEqual(['session-A', 'session-B']);
  });
});

// ─── a job's sessionId really reaches the registered chat handler ──────────
// (was: grep scheduler/index.ts source for 'routeJobResponse(...sessionId'
// and 'setChatHandler(...sessionId: string'.) This is the actual wiring
// setChatHandler exists for: CronScheduler.getChannels() -> sendToAllChannels
// -> the handler registered via setChatHandler, carrying the FIRED JOB's own
// sessionId (not a global default) through to whoever's listening (the
// chat window). Constructs a bare CronScheduler with no .initialize() (no
// intervals, no real DB) — runJobNow()->executeJob()->routeResponse() is
// reachable standalone once a job is registered via the public scheduleJob().
describe("CronScheduler: a fired job's own sessionId reaches setChatHandler (not a shared default)", () => {
  afterEach(() => {
    vi.doUnmock('node-cron');
    vi.doUnmock('../../src/agent');
    vi.resetModules();
  });

  it('routes the executing job’s sessionId to the chat handler and to AgentManager.processMessage', async () => {
    vi.resetModules();
    vi.doMock('node-cron', () => ({
      default: {
        validate: () => true,
        schedule: (_expr: string, _cb: () => void) => ({ stop: vi.fn() }),
      },
    }));

    const processMessage = vi.fn(async () => ({ response: 'the agent said hi', messages: [] }));
    vi.doMock('../../src/agent', () => ({
      AgentManager: { isInitialized: () => true, processMessage },
    }));

    const { CronScheduler } = await import('../../src/scheduler');
    const scheduler = new CronScheduler();

    const chatHandler = vi.fn();
    scheduler.setChatHandler(chatHandler);

    scheduler.scheduleJob({
      id: 1,
      name: 'session-scoped-job',
      schedule: '* * * * *',
      prompt: 'do the session-scoped thing',
      channel: 'desktop',
      enabled: true,
      sessionId: 'session-B',
    });

    await scheduler.runJobNow('session-scoped-job');

    // AgentManager processed the job under the JOB's session, not 'default'.
    expect(processMessage).toHaveBeenCalledWith(
      'do the session-scoped thing',
      'cron:session-scoped-job',
      'session-B'
    );
    // The chat handler set via setChatHandler received that same sessionId.
    expect(chatHandler).toHaveBeenCalledWith(
      'session-scoped-job',
      'do the session-scoped thing',
      'the agent said hi',
      'session-B'
    );
  });
});

// ─── the live schema really has session_id columns, not just the migration text ───
// (was: grep memory/index.ts source for 'migrateSessionScopedTables' and
// three ALTER TABLE strings.) A fresh MemoryManager always runs its full
// migration chain on construction, so checking a live DB's actual columns
// proves the migration executed successfully, not just that the SQL text
// exists somewhere in the file.
describe('memory schema: calendar_events/tasks/cron_jobs really have a session_id column', () => {
  it('PRAGMA table_info confirms session_id on all three session-scoped tables', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    // @ts-expect-error -- reaching the underlying better-sqlite3 handle for a
    // schema assertion; MemoryManager doesn't otherwise expose raw pragma.
    const db = memory.db as import('better-sqlite3').Database;
    for (const table of ['calendar_events', 'tasks', 'cron_jobs']) {
      const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
      expect(columns.some((c) => c.name === 'session_id')).toBe(true);
    }
    memory.close();
  });
});

// ─── agent:send's status forwarder really filters by sessionId ─────────────
// (was: grep agent-ipc.ts source for 'status.sessionId' and the filter's
// exact if-statement text.) Same electron-mock pattern as
// agent-ipc-plan.test.ts: capture the ipcMain.handle registration and the
// AgentManager.on('status', ...) listener without a real Electron runtime,
// then drive the REAL filtering logic with status events for other
// sessions, this session, and no session at all.
describe('agent-ipc: agent:send status forwarding really filters by sessionId', () => {
  afterEach(() => {
    vi.doUnmock('electron');
    vi.doUnmock('../../src/agent');
    vi.doUnmock('../../src/settings');
    vi.doUnmock('../../src/main/windows');
    vi.resetModules();
  });

  it('forwards only this session’s status events (and legacy no-sessionId events), never another session’s', async () => {
    vi.resetModules();

    const sentEvents: Array<[string, unknown]> = [];
    const mockWebContents = {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => sentEvents.push([channel, payload]),
    };

    let capturedStatusHandler: ((status: Record<string, unknown>) => void) | null = null;
    const handlers = new Map<string, (...args: unknown[]) => unknown>();

    vi.doMock('electron', () => ({
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        },
      },
      app: { getPath: () => '/tmp' },
    }));
    vi.doMock('../../src/agent', () => ({
      AgentManager: {
        isInitialized: () => true,
        processMessage: vi.fn(async () => ({ response: 'ok', tokensUsed: 0, wasCompacted: false })),
        on: (event: string, handler: (status: Record<string, unknown>) => void) => {
          if (event === 'status') capturedStatusHandler = handler;
        },
        off: vi.fn(),
      },
    }));
    vi.doMock('../../src/settings', () => ({
      SettingsManager: { hasRequiredKeys: () => true, get: vi.fn(), set: vi.fn() },
    }));
    vi.doMock('../../src/main/windows', () => ({ getWindow: () => null }));

    const { registerAgentIPC } = await import('../../src/main/ipc/agent-ipc');
    registerAgentIPC({
      getMemory: () => null,
      getTelegramBot: () => null,
      updateTrayMenu: vi.fn(),
      WIN: {} as never,
      initializeAgent: vi.fn(),
      restartAgent: vi.fn(),
    } as never);

    const sendHandler = handlers.get('agent:send')!;
    await sendHandler({ sender: mockWebContents }, 'hello', 'session-B');

    expect(capturedStatusHandler).not.toBeNull();
    const statusHandler = capturedStatusHandler!;

    // A different session's status event must NOT be forwarded to this window.
    statusHandler({ type: 'thinking', sessionId: 'session-A' });
    expect(sentEvents).toHaveLength(0);

    // This session's own status event IS forwarded.
    statusHandler({ type: 'thinking', sessionId: 'session-B' });
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0][0]).toBe('agent:status');

    // A legacy event with no sessionId at all is still forwarded (back-compat).
    statusHandler({ type: 'done' });
    expect(sentEvents).toHaveLength(2);
  });
});

// ─── removed: could not be made behavioral ─────────────────────────────────
// The following "Source Code Verification" checks were deleted rather than
// replaced. Each only ever asserted that a particular string appeared in a
// source file — never anything a running program does — and no reasonable
// behavioral equivalent exists at unit-test level:
//
//  - "scheduler-tools.ts should import getCurrentSessionId": a pure
//    import-statement grep. Its only real value (that the session id
//    actually reaches the persisted job) is now covered above by "session_id
//    actually flows into persisted cron jobs", which exercises the behavior
//    directly instead of the import line.
//  - "main/index.ts scheduler chat handler should include sessionId": grepped
//    Electron main-process wiring. main/index.ts boots the whole app (tray,
//    windows, IPC, scheduler wiring together) and is excluded from coverage
//    in vitest.config.ts for the same reason — it needs a real Electron
//    runtime (e2e), not a unit test. The underlying behavior it gestured at
//    (a job's sessionId reaching the chat handler) is covered above via
//    CronScheduler.setChatHandler directly, which is what main/index.ts
//    merely wires up.
//  - "agent/index.ts AgentStatus type should include sessionId field": a
//    TypeScript type shape has no runtime representation to assert on — this
//    was a regex match against source text standing in for what
//    `npm run typecheck` already enforces at compile time for every real
//    usage of AgentStatus. Re-checking it via string-matching in a unit test
//    adds a second, weaker copy of a check the type checker already does
//    exhaustively.
//  - "agent/index.ts should import getCurrentSessionId": another pure
//    import-statement grep with no behavioral content of its own.
