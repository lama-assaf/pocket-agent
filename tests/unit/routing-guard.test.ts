/**
 * Routing/skill-selection verification layer:
 *  - switch_agent rejects an invalid mode / an out-of-graph handoff with a
 *    corrective, actionable message (valid options listed) instead of a
 *    generic failure, and logs the decision.
 *  - subagent rejects an unknown/disabled named specialist the same way,
 *    BEFORE spawning anything, instead of silently falling back to a
 *    generic worker.
 *  - every one of the above lands in the queryable routing log.
 *
 * The skill-tool coverage lives in routing-guard-skill.test.ts instead of
 * here: it needs to mock '../../src/tools/subagent' (to keep chat-tools.ts's
 * getChatAgentTools lightweight), and vi.mock is hoisted file-wide, which
 * would otherwise clobber the REAL createSubAgentTool this file's "subagent —
 * named specialist validation" tests exercise directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-log-'));
  process.env.AUDIT_LOG_ROOT_OVERRIDE = tmpRoot;
});

afterEach(() => {
  delete process.env.AUDIT_LOG_ROOT_OVERRIDE;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('switch_agent — corrective errors + routing log', () => {
  it('rejects an invalid mode name with the valid mode list, and logs the rejection', async () => {
    const { getSwitchAgentTool, setSwitchModeCallback, setGetSessionIdCallback } = await import(
      '../../src/tools/agent-mode-tools'
    );
    const { getRecentRoutingLogEntries } = await import('../../src/utils/routing-log');

    setGetSessionIdCallback(() => 'session-1');
    setSwitchModeCallback(async () => 'switched');

    const tool = getSwitchAgentTool();
    const result = await tool.handler({ mode: 'not-a-real-mode', reason: 'testing' });

    expect(result).toContain('Invalid mode');
    expect(result).toContain('general'); // valid modes are listed

    const entries = getRecentRoutingLogEntries(10);
    const entry = entries.find((e) => e.kind === 'mode_switch' && e.target === 'not-a-real-mode');
    expect(entry?.outcome).toBe('rejected');
  });

  it("rejects a handoff outside the current mode's directed graph, listing valid targets", async () => {
    const {
      getSwitchAgentTool,
      setSwitchModeCallback,
      setGetSessionIdCallback,
      setGetCurrentModeCallback,
    } = await import('../../src/tools/agent-mode-tools');
    const { getRecentRoutingLogEntries } = await import('../../src/utils/routing-log');

    setGetSessionIdCallback(() => 'session-2');
    setGetCurrentModeCallback(() => 'therapist'); // therapist can only hand off to 'general'
    setSwitchModeCallback(async () => 'switched');

    const tool = getSwitchAgentTool();
    const result = await tool.handler({ mode: 'coder', reason: 'testing' });

    expect(result).toContain('Cannot switch directly from therapist to coder');
    expect(result).toContain('general'); // the one valid target is named

    const entries = getRecentRoutingLogEntries(10);
    const entry = entries.find((e) => e.kind === 'mode_switch' && e.target === 'coder');
    expect(entry?.outcome).toBe('rejected');
  });

  it('logs an accepted mode switch', async () => {
    const {
      getSwitchAgentTool,
      setSwitchModeCallback,
      setGetSessionIdCallback,
      setGetCurrentModeCallback,
    } = await import('../../src/tools/agent-mode-tools');
    const { getRecentRoutingLogEntries } = await import('../../src/utils/routing-log');

    setGetSessionIdCallback(() => 'session-3');
    setGetCurrentModeCallback(() => null); // no directed-graph check when current mode is unknown
    setSwitchModeCallback(async () => 'switched to coder');

    const tool = getSwitchAgentTool();
    const result = await tool.handler({ mode: 'coder', reason: 'user wants to code' });
    expect(result).toBe('switched to coder');

    const entries = getRecentRoutingLogEntries(10);
    const entry = entries.find(
      (e) => e.kind === 'mode_switch' && e.target === 'coder' && e.sessionId === 'session-3'
    );
    expect(entry?.outcome).toBe('accepted');
  });
});

describe('subagent — named specialist validation + routing log', () => {
  it('rejects an unknown specialist name with the valid specialist list, without spawning', async () => {
    const { createSubAgentTool } = await import('../../src/tools/subagent');
    const { getRecentRoutingLogEntries } = await import('../../src/utils/routing-log');

    const tool = createSubAgentTool(
      [],
      async () => ({ provider: 'anthropic', apiKey: 'x' }) as never,
      'design'
    );

    const result = await tool.execute(
      { task: 'do something', agent: 'not-a-real-specialist' },
      { signal: new AbortController().signal } as never
    );

    expect(result).toContain('Unknown or disabled specialist "not-a-real-specialist"');
    expect(result).toContain('design-reviewer'); // a real design-lane specialist is listed

    const entries = getRecentRoutingLogEntries(10);
    const entry = entries.find(
      (e) => e.kind === 'subagent_spawn' && e.target === 'not-a-real-specialist'
    );
    expect(entry?.outcome).toBe('rejected');
  });

  it('rejects a named specialist when no lane is active', async () => {
    const { createSubAgentTool } = await import('../../src/tools/subagent');
    const { getRecentRoutingLogEntries } = await import('../../src/utils/routing-log');

    const tool = createSubAgentTool(
      [],
      async () => ({ provider: 'anthropic', apiKey: 'x' }) as never
      // no lane passed
    );

    const result = await tool.execute(
      { task: 'do something', agent: 'design-reviewer' },
      { signal: new AbortController().signal } as never
    );

    expect(result).toContain('no lane is active');

    const entries = getRecentRoutingLogEntries(10);
    const entry = entries.find((e) => e.kind === 'subagent_spawn' && e.target === 'design-reviewer');
    expect(entry?.outcome).toBe('rejected');
  });
});
