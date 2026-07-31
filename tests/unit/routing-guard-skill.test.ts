/**
 * skill tool — corrective error + routing log. Split out from
 * routing-guard.test.ts because this file needs to mock '../../src/tools/subagent'
 * (to keep getChatAgentTools lightweight), and vi.mock hoists file-wide —
 * mixing it into the same file as routing-guard.test.ts's direct
 * createSubAgentTool tests would clobber the real implementation those need.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-log-skill-'));
  process.env.AUDIT_LOG_ROOT_OVERRIDE = tmpRoot;
});

afterEach(() => {
  delete process.env.AUDIT_LOG_ROOT_OVERRIDE;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

vi.mock('../../src/tools', () => ({ getCustomTools: () => [] }));
vi.mock('../../src/tools/diagnostics', () => ({
  wrapToolHandler: (_name: string, handler: unknown) => handler,
}));
vi.mock('@kenkaiiii/ggcoder', () => ({
  createTools: () => ({
    tools: [
      { name: 'read', description: '', parameters: {}, execute: vi.fn() },
      { name: 'write', description: '', parameters: {}, execute: vi.fn() },
      { name: 'edit', description: '', parameters: {}, execute: vi.fn() },
    ],
  }),
}));
vi.mock('../../src/tools/subagent', () => ({
  createSubAgentTool: () => ({
    name: 'subagent',
    description: '',
    parameters: {},
    execute: vi.fn(),
  }),
}));

describe('skill tool — corrective error + routing log', () => {
  it('rejects an unknown skill name with the valid skill list, and logs it', async () => {
    const { getChatAgentTools } = await import('../../src/agent/chat-tools');
    const { getRecentRoutingLogEntries } = await import('../../src/utils/routing-log');

    const tools = await getChatAgentTools(
      {} as Parameters<typeof getChatAgentTools>[0],
      '/tmp',
      'design'
    );
    const skillTool = tools.find((t) => t.name === 'skill');
    expect(skillTool).toBeDefined();

    const result = await skillTool!.execute({ skill: 'not-a-real-skill' }, {} as never);
    expect(result).toContain('Unknown skill "not-a-real-skill"');

    const entries = getRecentRoutingLogEntries(20);
    const entry = entries.find((e) => e.kind === 'skill_load' && e.target === 'not-a-real-skill');
    expect(entry?.outcome).toBe('rejected');
  });

  it('logs an accepted skill load for a real design-lane skill', async () => {
    const { getChatAgentTools } = await import('../../src/agent/chat-tools');
    const { getRecentRoutingLogEntries } = await import('../../src/utils/routing-log');

    const tools = await getChatAgentTools(
      {} as Parameters<typeof getChatAgentTools>[0],
      '/tmp',
      'design'
    );
    const skillTool = tools.find((t) => t.name === 'skill');
    const result = await skillTool!.execute({ skill: 'design-review' }, {} as never);
    expect(result).not.toContain('Unknown skill');

    const entries = getRecentRoutingLogEntries(20);
    const entry = entries.find((e) => e.kind === 'skill_load' && e.target === 'design-review');
    expect(entry?.outcome).toBe('accepted');
  });
});
