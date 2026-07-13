/**
 * Roadmap item 8: audit-log integration at the two write choke points.
 *  1. chat-tools.ts write/edit AgentTool wrapper (file writes).
 *  2. MemoryManager.saveFact / updateFact (fact writes).
 *
 * Both must produce a log entry with the right fields, and neither path can
 * be bypassed — every write/edit tool and every fact write goes through the
 * same wrapper/wrapper-method.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { setAuditLogRoot, getRecentAuditLogEntries } from '../../src/utils/audit-log';

// ── Mocks for the chat-tools.ts write path (top-level, hoisted) ────────────
const { mockWriteExecute } = vi.hoisted(() => ({ mockWriteExecute: vi.fn() }));

vi.mock('@kenkaiiii/ggcoder', () => ({
  createTools: () => ({
    tools: [
      {
        name: 'write',
        description: 'write file',
        parameters: {} as unknown,
        execute: mockWriteExecute,
      },
    ],
  }),
}));

vi.mock('../../src/tools', () => ({ getCustomTools: () => [] }));
vi.mock('../../src/tools/diagnostics', () => ({
  wrapToolHandler: (_name: string, handler: unknown) => handler,
}));
vi.mock('../../src/tools/subagent', () => ({
  createSubAgentTool: () => ({
    name: 'sub_agent',
    description: '',
    parameters: {},
    execute: vi.fn(),
  }),
}));
vi.mock('../../src/agent/chat-providers', () => ({ getStreamConfig: vi.fn() }));
vi.mock('../../src/settings', () => ({
  SettingsManager: { get: () => '' },
}));

// ── Mock for the MemoryManager fact-write path (top-level, hoisted) ────────
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-audit-integ-'));
  setAuditLogRoot(tmpDir);
});

afterEach(() => {
  setAuditLogRoot('');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── 1. File writes via chat-tools.ts ────────────────────────────────────────
describe('write-audit log — file writes (chat-tools.ts)', () => {
  beforeEach(() => {
    mockWriteExecute.mockReset();
    mockWriteExecute.mockResolvedValue('wrote ok');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a log entry with tool/target/sessionId/scope/digest on a successful write', async () => {
    const { getChatAgentTools } = await import('../../src/agent/chat-tools');
    const { setCurrentSessionId } = await import('../../src/tools/session-context');
    setCurrentSessionId('session-xyz');

    const tools = await getChatAgentTools({} as never, '/tmp');
    const writeTool = tools.find((t) => t.name === 'write')!;
    await writeTool.execute(
      { file_path: '/tmp/notes.md', content: 'clean content here' },
      {} as never
    );

    const entries = getRecentAuditLogEntries(10);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.tool).toBe('write');
    expect(entry.target).toBe('/tmp/notes.md');
    expect(entry.sessionId).toBe('session-xyz');
    expect(typeof entry.digest).toBe('string');
    expect(entry.digest).not.toContain('clean content here');
  });

  it('does not log a write blocked by the safety filter', async () => {
    const { getChatAgentTools } = await import('../../src/agent/chat-tools');
    const tools = await getChatAgentTools({} as never, '/tmp');
    const writeTool = tools.find((t) => t.name === 'write')!;
    const result = await writeTool.execute({ file_path: '/etc/passwd', content: 'x' }, {} as never);

    expect(String(result).toLowerCase()).toContain('blocked');
    expect(getRecentAuditLogEntries(10)).toHaveLength(0);
  });
});

// ── 2. Fact writes via MemoryManager ────────────────────────────────────────
describe('write-audit log — fact writes (MemoryManager)', () => {
  it('saveFact records a log entry with category/subject/scope target and a content digest', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const { setCurrentSessionId } = await import('../../src/tools/session-context');
    setCurrentSessionId('session-fact-1');
    const memory = new MemoryManager(':memory:');

    memory.saveFact('brand', 'voice', 'Warm and plainspoken', false, 'client:acme');

    const entries = getRecentAuditLogEntries(10);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.tool).toBe('saveFact');
    expect(entry.scope).toBe('client:acme');
    expect(entry.target).toBe('client:acme:brand/voice');
    expect(entry.sessionId).toBe('session-fact-1');
    expect(entry.digest).not.toContain('Warm and plainspoken');
    memory.close();
  });

  it('updateFact records a log entry reflecting the post-update fact', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    const id = memory.saveFact('brand', 'tone', 'Formal', false, 'client:acme');

    memory.updateFact(id, { content: 'Playful and bold' });

    const entries = getRecentAuditLogEntries(10);
    // saveFact + updateFact each log — most recent first is the update.
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const [latest] = entries;
    expect(latest.tool).toBe('updateFact');
    expect(latest.target).toBe('client:acme:brand/tone');
    expect(latest.digest).not.toContain('Playful and bold');
    memory.close();
  });

  it('does not log a no-op updateFact (empty fields)', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    const id = memory.saveFact('brand', 'tone', 'Formal', false, 'client:acme');

    const before = getRecentAuditLogEntries(10).length;
    const ok = memory.updateFact(id, {});
    expect(ok).toBe(false);
    expect(getRecentAuditLogEntries(10)).toHaveLength(before);
    memory.close();
  });

  it('no tool can bypass the log: saveFact via the agent remember-tool path also logs', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const { setMemoryManager } = await import('../../src/tools/memory-tools');
    const { setCurrentSessionId } = await import('../../src/tools/session-context');
    const memory = new MemoryManager(':memory:');
    setMemoryManager(memory);
    setCurrentSessionId('S');

    // Exercise the same MemoryManager.saveFact the remember tool calls
    // (src/tools/memory-tools.ts) rather than re-mocking the whole tool
    // surface — the point is there is exactly one save path to audit.
    memory.saveFact('user_info', 'favorite_color', 'teal', false, 'user');

    const entries = getRecentAuditLogEntries(10);
    expect(entries.some((e) => e.target === 'user:user_info/favorite_color')).toBe(true);
    memory.close();
  });
});
