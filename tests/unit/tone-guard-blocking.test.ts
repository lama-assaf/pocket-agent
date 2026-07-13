/**
 * Roadmap item 7: tone-guard blocking policy.
 *
 * - Lane modes (design/product/brand/social) block by default on a tone-guard
 *   hit; `features.toneHardBlock='false'` opts OUT (write proceeds, warned).
 * - Non-lane prose modes (general/writer/researcher/therapist, reached via
 *   getChatAgentTools with no lane) stay warn-only by default; opt IN to
 *   blocking with `features.toneHardBlock='true'`.
 * - Coder mode (getCoderAgentTools) never scans at all, any setting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockWriteExecute } = vi.hoisted(() => ({
  mockWriteExecute: vi.fn(),
}));

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

vi.mock('../../src/tools', () => ({
  getCustomTools: () => [],
}));

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

vi.mock('../../src/agent/chat-providers', () => ({
  getStreamConfig: vi.fn(),
}));

const settingsStore = new Map<string, string>();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: (key: string) => settingsStore.get(key) ?? '',
  },
}));

import { getChatAgentTools, getCoderAgentTools } from '../../src/agent/chat-tools';
import type { AgentTool, ToolContext } from '@kenkaiiii/gg-agent';

const ctx = {} as ToolContext;
// 'leverage' is a vendored global AI-tone pattern (write-guards.ts) — fires
// regardless of any marketplace/facts configuration.
const TONE_VIOLATING_CONTENT = 'We should leverage this opportunity.';

async function getWriteTool(
  mode: 'chat' | 'coder',
  lane?: 'design' | 'product' | 'brand' | 'social'
): Promise<AgentTool> {
  const tools =
    mode === 'chat'
      ? await getChatAgentTools({} as Parameters<typeof getChatAgentTools>[0], '/tmp', lane)
      : await getCoderAgentTools({} as Parameters<typeof getCoderAgentTools>[0], '/tmp');
  const tool = tools.find((t) => t.name === 'write');
  if (!tool) throw new Error('write tool not found');
  return tool;
}

describe('tone guard blocking policy', () => {
  beforeEach(() => {
    settingsStore.clear();
    mockWriteExecute.mockReset();
    mockWriteExecute.mockResolvedValue('wrote ok');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('lane modes (design/product/brand/social)', () => {
    it('blocks a tone-guard hit by default (no toneHardBlock setting)', async () => {
      const tool = await getWriteTool('chat', 'brand');
      const result = await tool.execute(
        { file_path: '/tmp/copy.md', content: TONE_VIOLATING_CONTENT },
        ctx
      );

      expect(typeof result).toBe('string');
      expect((result as string).toLowerCase()).toContain('blocked by tone guard');
      expect(mockWriteExecute).not.toHaveBeenCalled();
    });

    it("opts OUT of blocking via features.toneHardBlock='false' (warns, still writes)", async () => {
      settingsStore.set('features.toneHardBlock', 'false');
      const tool = await getWriteTool('chat', 'brand');
      const result = await tool.execute(
        { file_path: '/tmp/copy.md', content: TONE_VIOLATING_CONTENT },
        ctx
      );

      expect(mockWriteExecute).toHaveBeenCalledOnce();
      expect(typeof result).toBe('string');
      expect(result as string).toContain('tone guard');
      expect(result as string).toContain('wrote ok');
    });

    it('clean content writes through with no warning', async () => {
      const tool = await getWriteTool('chat', 'brand');
      const result = await tool.execute(
        { file_path: '/tmp/copy.md', content: 'We shipped the login fix today.' },
        ctx
      );

      expect(mockWriteExecute).toHaveBeenCalledOnce();
      expect(result).toBe('wrote ok');
    });
  });

  describe('non-lane prose modes (general/writer/researcher/therapist)', () => {
    it('warns but does NOT block by default (no toneHardBlock setting)', async () => {
      const tool = await getWriteTool('chat', undefined);
      const result = await tool.execute(
        { file_path: '/tmp/copy.md', content: TONE_VIOLATING_CONTENT },
        ctx
      );

      expect(mockWriteExecute).toHaveBeenCalledOnce();
      expect(typeof result).toBe('string');
      expect(result as string).toContain('tone guard');
      expect(result as string).toContain('wrote ok');
    });

    it("opts IN to blocking via features.toneHardBlock='true'", async () => {
      settingsStore.set('features.toneHardBlock', 'true');
      const tool = await getWriteTool('chat', undefined);
      const result = await tool.execute(
        { file_path: '/tmp/copy.md', content: TONE_VIOLATING_CONTENT },
        ctx
      );

      expect(typeof result).toBe('string');
      expect((result as string).toLowerCase()).toContain('blocked by tone guard');
      expect(mockWriteExecute).not.toHaveBeenCalled();
    });
  });

  describe('global opt-out overrides lane defaults', () => {
    it("features.toneHardBlock='false' disables blocking even in a lane mode", async () => {
      settingsStore.set('features.toneHardBlock', 'false');
      const tool = await getWriteTool('chat', 'design');
      const result = await tool.execute(
        { file_path: '/tmp/copy.md', content: TONE_VIOLATING_CONTENT },
        ctx
      );

      expect(mockWriteExecute).toHaveBeenCalledOnce();
      expect(result as string).toContain('wrote ok');
    });
  });

  describe('features.operatorPacks="false" disables scanning entirely', () => {
    it('skips the tone guard in a lane mode when operator packs are disabled', async () => {
      settingsStore.set('features.operatorPacks', 'false');
      const tool = await getWriteTool('chat', 'brand');
      const result = await tool.execute(
        { file_path: '/tmp/copy.md', content: TONE_VIOLATING_CONTENT },
        ctx
      );

      expect(mockWriteExecute).toHaveBeenCalledOnce();
      expect(result).toBe('wrote ok');
    });
  });

  describe('coder mode is exempt', () => {
    it('never scans, even with toneHardBlock=true', async () => {
      settingsStore.set('features.toneHardBlock', 'true');
      const tool = await getWriteTool('coder');
      const result = await tool.execute(
        { file_path: '/tmp/copy.md', content: TONE_VIOLATING_CONTENT },
        ctx
      );

      expect(mockWriteExecute).toHaveBeenCalledOnce();
      expect(result).toBe('wrote ok');
    });
  });
});
