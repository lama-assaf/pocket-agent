/**
 * On-disk guardrails file — STAGE A #2.
 *
 * `guardrailFilesForContext` (src/clients/registry.ts) was previously only
 * tested for PATH resolution (clients-registry.test.ts, clients-export.test.ts)
 * — no test ever wrote a real `guardrails/banned-words.md` to disk and
 * confirmed the tone scanner actually reads and enforces it. This test writes
 * REAL files under a temp clients/world root and drives the REAL
 * `scanForBannedTone` -> `write` tool path end-to-end (same wrap chain
 * production uses, src/agent/chat-tools.ts's wrapWithWritePathSafety) — no
 * facts, no mocked guardrail resolution, just files on disk.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
  createSubAgentTool: () => ({ name: 'subagent', description: '', parameters: {}, execute: vi.fn() }),
}));
vi.mock('../../src/agent/chat-providers', () => ({ getStreamConfig: vi.fn() }));

// Stub only the async embedding writes — real MemoryManager, real session context.
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

import { getChatAgentTools } from '../../src/agent/chat-tools';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { setCurrentSessionId } from '../../src/tools/session-context';
import { ensureWorldScaffold, ensureClientScaffold } from '../../src/clients/registry';
import { clientPaths, getWorldRoot } from '../../src/clients/paths';
import type { ToolContext } from '@kenkaiiii/gg-agent';
import type { MemoryManager } from '../../src/memory/index';

const ctx = {} as ToolContext;

async function newMemory(): Promise<MemoryManager> {
  const { MemoryManager: MM } = await import('../../src/memory/index');
  return new MM(':memory:');
}

describe('on-disk guardrails file — real file, real scan, real write-tool block', () => {
  let tmpRoot: string;
  let memory: MemoryManager;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrails-fixture-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmpRoot, 'clients');
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmpRoot, 'world');

    ensureWorldScaffold();
    ensureClientScaffold('acme');
    ensureClientScaffold('other-brand');

    // Real files, real bullet-list format (same parser as the pack-shipped
    // banned-words.md — src/agent/write-guards.ts's parseBannedWords).
    fs.writeFileSync(
      path.join(getWorldRoot(), 'guardrails', 'banned-words.md'),
      '# Banned words\n- worldwideban\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(clientPaths('acme').guardrailsDir, 'banned-words.md'),
      '# Acme banned words\n- acmeforbidden\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(clientPaths('other-brand').guardrailsDir, 'banned-words.md'),
      '# Other Brand banned words\n- otherbrandsecret\n',
      'utf-8'
    );

    memory = await newMemory();
    setMemoryManager(memory);
    mockWriteExecute.mockReset();
    mockWriteExecute.mockResolvedValue('wrote ok');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    memory.close();
    setMemoryManager(null as unknown as MemoryManager);
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function writeToolForClient(clientId: string | null): Promise<import('@kenkaiiii/gg-agent').AgentTool> {
    const session = memory.createSession(`guardrails-${clientId ?? 'personal'}`, 'general', null);
    setCurrentSessionId(session.id);
    if (clientId) {
      memory.setSessionContext(session.id, { contextType: 'client', clientId, projectKey: null });
    }
    const tools = await getChatAgentTools({} as Parameters<typeof getChatAgentTools>[0], '/tmp', 'brand');
    const tool = tools.find((t) => t.name === 'write');
    if (!tool) throw new Error('write tool not found');
    return tool;
  }

  it("blocks a write containing the ACTIVE client's on-disk banned word", async () => {
    const tool = await writeToolForClient('acme');
    const result = await tool.execute(
      { file_path: '/tmp/copy.md', content: 'This uses acmeforbidden in the copy.' },
      ctx
    );
    expect(result as string).toContain('blocked by tone guard');
    expect(result as string).toContain('acmeforbidden');
    expect(mockWriteExecute).not.toHaveBeenCalled();
  });

  it("blocks a write containing the WORLD (agency-wide) on-disk banned word, for any client", async () => {
    const tool = await writeToolForClient('acme');
    const result = await tool.execute(
      { file_path: '/tmp/copy.md', content: 'Never say worldwideban in copy.' },
      ctx
    );
    expect(result as string).toContain('blocked by tone guard');
    expect(result as string).toContain('worldwideban');
    expect(mockWriteExecute).not.toHaveBeenCalled();
  });

  it("does NOT block on another brand's on-disk banned word (cross-client isolation)", async () => {
    const tool = await writeToolForClient('acme');
    const result = await tool.execute(
      { file_path: '/tmp/copy.md', content: 'This mentions otherbrandsecret casually.' },
      ctx
    );
    expect(mockWriteExecute).toHaveBeenCalledOnce();
    expect(result).toBe('wrote ok');
  });

  it('a personal-context session never reads any on-disk guardrails file (isolation by construction)', async () => {
    const tool = await writeToolForClient(null); // no setSessionContext call -> personal
    const result = await tool.execute(
      { file_path: '/tmp/copy.md', content: 'Talking about acmeforbidden and worldwideban here.' },
      ctx
    );
    expect(mockWriteExecute).toHaveBeenCalledOnce();
    expect(result).toBe('wrote ok');
  });

  it('clean content (no banned word) writes through with no warning', async () => {
    const tool = await writeToolForClient('acme');
    const result = await tool.execute(
      { file_path: '/tmp/copy.md', content: 'We shipped the login fix today.' },
      ctx
    );
    expect(mockWriteExecute).toHaveBeenCalledOnce();
    expect(result).toBe('wrote ok');
  });
});
